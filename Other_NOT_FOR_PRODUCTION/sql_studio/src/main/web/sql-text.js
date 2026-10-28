/*
 * sql-text.js: SQL Studio's text tools.
 *
 * A port of fb-api-tool's SqlHighlighter, SqlFormat, SqlComments, SqlLimit,
 * SqlReorder, SqlContext, Tone and CellStyle, plus statement splitting and a
 * linter built on the same lexer. One file, no dependencies, because it is
 * inlined into a Fishbowl BI page and also run under Node for its tests.
 *
 * Everything here works on the lexer's tokens rather than on the raw text.
 * A regex pass over a whole statement would happily read a keyword inside a
 * string literal or a comment, and silently change what the query matches;
 * here a literal or a comment is a single token and decides nothing.
 *
 * Fishbowl rewrites BI pages with a global text replacement and strips
 * control characters from saved scripts, so this source never contains the
 * replacement's markers and builds the one control character it needs.
 */
(function (root) {
    'use strict';

    // ------------------------------------------------------------------
    // Lexer
    // ------------------------------------------------------------------

    // The keyword set from the tool this was ported from, so the same words
    // light up in both. Matched case-insensitively.
    const KEYWORDS = Object.freeze([
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS',
        'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
        'DISTINCT', 'UNION', 'ALL', 'INTERSECT', 'EXCEPT', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
        'FULL', 'CROSS', 'ON', 'USING', 'INSERT', 'UPDATE', 'DELETE', 'INTO', 'VALUES', 'SET', 'CREATE',
        'DROP', 'ALTER', 'TABLE', 'VIEW', 'INDEX', 'DATABASE', 'SCHEMA', 'AS', 'WITH', 'TOP', 'FETCH',
        'NEXT', 'ROWS', 'ONLY', 'FOR', 'OVER', 'PARTITION', 'WINDOW', 'RECURSIVE', 'COUNT', 'SUM', 'AVG',
        'MIN', 'MAX', 'COALESCE', 'ISNULL', 'NULLIF', 'CAST', 'CONVERT', 'UPPER', 'LOWER', 'TRIM',
        'SUBSTRING', 'LEN', 'LENGTH', 'REPLACE', 'CONCAT', 'GETDATE', 'NOW', 'DATE', 'YEAR', 'MONTH',
        'DAY', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'UNIQUE', 'TRUE',
        'FALSE', 'ASC', 'DESC',
    ]);
    const KEYWORD_SET = new Set(KEYWORDS);

    const TOKEN_KINDS = Object.freeze(['plain', 'keyword', 'string', 'number', 'comment']);

    // The C# lexer asks char.IsLetter / char.IsDigit, which are Unicode-aware,
    // so an accented column name stays one word. ASCII is checked by hand
    // first because it is nearly all an editor ever holds.
    const LETTER_RX = /\p{L}/u;
    const DIGIT_RX = /\p{Nd}/u;
    const SPACE_RX = /\s/;

    function isLetter(c) {
        const n = c.charCodeAt(0);
        if (n < 128) return (n >= 65 && n <= 90) || (n >= 97 && n <= 122);
        return LETTER_RX.test(c);
    }

    function isDigit(c) {
        const n = c.charCodeAt(0);
        if (n < 128) return n >= 48 && n <= 57;
        return DIGIT_RX.test(c);
    }

    function isLetterOrDigit(c) { return isLetter(c) || isDigit(c); }
    function isSpace(c) { return SPACE_RX.test(c); }
    function str(v) { return v == null ? '' : String(v); }
    function trimEnd(s) { return s.replace(/\s+$/, ''); }

    /*
     * A lexer, not a parser: it recognises comments, quoted literals, keywords
     * and numbers, and leaves everything else alone. That is all colouring
     * needs, and it means an unfinished statement (which is what an editor
     * holds most of the time) still colours sensibly instead of failing.
     *
     * `open` marks a literal or block comment that never closes; it is kept
     * off the public tokens and used by the linter.
     */
    function scan(sql) {
        const text = str(sql);
        const n = text.length;
        const tokens = [];
        let i = 0;

        while (i < n) {
            const c = text[i];

            // -- to end of line
            if (c === '-' && text[i + 1] === '-') {
                const end = text.indexOf('\n', i);
                const stop = end < 0 ? n : end;
                tokens.push({ text: text.slice(i, stop), kind: 'comment', start: i });
                i = stop;
                continue;
            }

            // A block comment, possibly unterminated while it is being typed.
            if (c === '/' && text[i + 1] === '*') {
                const end = text.indexOf('*/', i + 2);
                const stop = end < 0 ? n : end + 2;
                const t = { text: text.slice(i, stop), kind: 'comment', start: i };
                if (end < 0) t.open = true;
                tokens.push(t);
                i = stop;
                continue;
            }

            // A quoted run. MySQL reads '...' and "..." as literals and `...` as
            // an identifier, and in all three the delimiter doubled inside is
            // an escape. MySQL also honours a backslash escape inside the two
            // literal forms (not inside backticks); without it 'it\'s' would
            // end early and leave the rest of the line looking unterminated.
            if (c === '\'' || c === '"' || c === '`') {
                let j = i + 1;
                let closed = false;
                while (j < n) {
                    const d = text[j];
                    if (d === '\\' && c !== '`') { j += 2; continue; }
                    if (d === c) {
                        if (text[j + 1] === c) { j += 2; continue; }
                        j++;
                        closed = true;
                        break;
                    }
                    j++;
                }
                const stop = Math.min(j, n);

                // A backtick names a column rather than holding data, so it is
                // not coloured as a literal; but it is still one token, which
                // is what stops anything being inserted into it.
                const t = { text: text.slice(i, stop), kind: c === '`' ? 'plain' : 'string', start: i };
                if (!closed) t.open = true;
                tokens.push(t);
                i = stop;
                continue;
            }

            if (isLetter(c) || c === '_') {
                let j = i;
                while (j < n && (isLetterOrDigit(text[j]) || text[j] === '_')) j++;
                const word = text.slice(i, j);
                tokens.push({ text: word, kind: KEYWORD_SET.has(word.toUpperCase()) ? 'keyword' : 'plain', start: i });
                i = j;
                continue;
            }

            if (isDigit(c)) {
                let j = i;
                while (j < n && (isDigit(text[j]) || text[j] === '.')) j++;
                tokens.push({ text: text.slice(i, j), kind: 'number', start: i });
                i = j;
                continue;
            }

            // Whitespace and punctuation, gathered so the run count stays low.
            let k = i;
            while (k < n && !isLetterOrDigit(text[k]) && text[k] !== '_'
                   && text[k] !== '\'' && text[k] !== '"' && text[k] !== '`'
                   && !(text[k] === '-' && text[k + 1] === '-')
                   && !(text[k] === '/' && text[k + 1] === '*')) k++;
            if (k === i) k++;                       // never stall
            tokens.push({ text: text.slice(i, k), kind: 'plain', start: i });
            i = k;
        }

        return tokens;
    }

    function tokenize(sql) {
        return scan(sql).map(t => ({ text: t.text, kind: t.kind, start: t.start }));
    }

    const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

    function escapeHtml(s) {
        return s.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
    }

    /*
     * For an overlay behind a textarea: it has to line up with the text
     * character for character, so nothing is added but markup, and plain runs
     * are left bare to keep the DOM small.
     */
    function highlightHtml(sql) {
        let html = '';
        for (const t of scan(sql)) {
            const body = escapeHtml(t.text);
            html += t.kind === 'plain' ? body : `<span class="tk-${t.kind}">${body}</span>`;
        }
        return html;
    }

    // ------------------------------------------------------------------
    // Formatting (SqlFormat)
    // ------------------------------------------------------------------

    /*
     * What the formatter does is deliberately limited: uppercase the reserved
     * words, put each clause on its own line, tidy the spacing. That is the
     * common ground between every formatter worth copying; anything further
     * needs a real parser and gets it wrong often enough to be worse than
     * doing nothing.
     */

    // Words that start a new line. Longest match wins, so LEFT OUTER JOIN
    // beats LEFT JOIN and UNION ALL beats UNION.
    const CLAUSES = [
        ['LEFT', 'OUTER', 'JOIN'], ['RIGHT', 'OUTER', 'JOIN'], ['FULL', 'OUTER', 'JOIN'],
        ['INSERT', 'INTO'], ['DELETE', 'FROM'], ['UNION', 'ALL'], ['GROUP', 'BY'], ['ORDER', 'BY'],
        ['LEFT', 'JOIN'], ['RIGHT', 'JOIN'], ['INNER', 'JOIN'], ['OUTER', 'JOIN'],
        ['FULL', 'JOIN'], ['CROSS', 'JOIN'],
        ['SELECT'], ['FROM'], ['WHERE'], ['HAVING'], ['LIMIT'], ['OFFSET'], ['UNION'],
        ['INTERSECT'], ['EXCEPT'], ['JOIN'], ['VALUES'], ['UPDATE'], ['SET'], ['WITH'],
    ];

    // ON belongs to the JOIN above it rather than starting something of its
    // own, and indenting it says so: a list of joins reads as pairs.
    const CONTINUATIONS = new Set(['AND', 'OR', 'ON', 'USING']);

    // Clauses whose body is a list break after the keyword, so EVERY item is
    // indented on its own line: adding a column then changes one line in a
    // diff rather than two.
    const LIST_CLAUSES = new Set(['SELECT', 'GROUP BY', 'ORDER BY', 'SET', 'VALUES']);

    // Called rather than declared, so they bind onto their bracket: COUNT(*),
    // while a clause keyword keeps the space, as in WHERE (a = 1).
    const FUNCTIONS = new Set([
        'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'ISNULL', 'NULLIF', 'CAST', 'CONVERT',
        'UPPER', 'LOWER', 'TRIM', 'SUBSTRING', 'LEN', 'LENGTH', 'REPLACE', 'CONCAT', 'GETDATE',
        'NOW', 'DATE', 'YEAR', 'MONTH', 'DAY',
    ]);

    function pretty(sql) {
        const source = str(sql);
        if (source.trim().length === 0) return '';

        // Significant tokens only; the lexer's whitespace runs are rebuilt.
        const all = [];
        for (const t of scan(source)) splitPunctuation(t, all);
        const tokens = all.filter(t => t.text.trim().length > 0);
        if (tokens.length === 0) return '';

        let out = '';
        let atLineStart = true;
        let prev = null;

        // Bracket depth, so a comma separating select columns starts a new
        // line while one inside COALESCE(a, b) stays part of its expression.
        let depth = 0;

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const text = t.kind === 'keyword' ? t.text.toUpperCase() : t.text;

            // A comment keeps its own line. Appending it to one would swallow
            // everything after it the next time the statement is read.
            if (t.kind === 'comment') {
                if (!atLineStart) out += '\n';
                out += text + '\n';
                atLineStart = true;
                prev = t;
                continue;
            }

            if (t.kind === 'keyword') {
                const run = clauseAt(tokens, i);
                if (run > 0) {
                    if (!atLineStart) out += '\n';
                    const head = tokens.slice(i, i + run).map(x => x.text.toUpperCase()).join(' ');
                    out += head;
                    prev = tokens[i + run - 1];
                    i += run - 1;
                    atLineStart = false;

                    // Only when there really is a list: SELECT * and
                    // SELECT COUNT(*) are one item, with nothing to line up.
                    if (LIST_CLAUSES.has(head) && hasListComma(tokens, i + 1)) {
                        out += '\n  ';
                        atLineStart = true;
                    }
                    continue;
                }

                if (CONTINUATIONS.has(t.text.toUpperCase())) {
                    if (!atLineStart) out += '\n';
                    out += '  ' + text;
                    atLineStart = false;
                    prev = t;
                    continue;
                }
            }

            if (text === '(') depth++;
            else if (text === ')') depth = Math.max(0, depth - 1);

            if (!atLineStart && needsSpace(out, prev, text)) out += ' ';
            out += text;
            prev = t;

            // One item per line for a list: a twelve-column SELECT on one line
            // is a line nobody reads to the end.
            if (text === ',' && depth === 0) {
                out += '\n  ';
                atLineStart = true;
                continue;
            }

            atLineStart = false;
        }

        return out.split('\n').map(trimEnd).join('\n').replace(/^[\n ]+|[\n ]+$/g, '');
    }

    // Does the clause starting here hold more than one item? A comma inside
    // brackets separates arguments, not columns.
    function hasListComma(tokens, from) {
        let depth = 0;
        for (let i = from; i < tokens.length; i++) {
            const text = tokens[i].text;
            if (text === '(') { depth++; continue; }
            if (text === ')') { depth = Math.max(0, depth - 1); continue; }
            if (depth > 0) continue;
            if (text === ',') return true;
            if (tokens[i].kind === 'keyword' && clauseAt(tokens, i) > 0) return false;
        }
        return false;
    }

    // How many tokens from i form a clause, or 0 if none do.
    function clauseAt(tokens, i) {
        let best = 0;
        for (const clause of CLAUSES) {
            if (clause.length <= best) continue;
            if (i + clause.length > tokens.length) continue;
            let match = true;
            for (let k = 0; k < clause.length; k++) {
                const t = tokens[i + k];
                if (t.kind !== 'keyword' || t.text.toUpperCase() !== clause[k]) { match = false; break; }
            }
            if (match) best = clause.length;
        }
        return best;
    }

    // The spacing every formatter agrees on: nothing before a comma or a
    // closing bracket, nothing after an opening one, none around the dot of a
    // qualified name, and a call bound to its bracket.
    function needsSpace(out, prev, next) {
        if (out.length === 0) return false;
        const last = out[out.length - 1];
        if (last === '(' || last === '.' || last === '\n') return false;

        const c = next[0];
        if (c === ',' || c === ')' || c === '.' || c === ';') return false;

        if (c === '(' && prev &&
            (prev.kind === 'plain' || (prev.kind === 'keyword' && FUNCTIONS.has(prev.text.toUpperCase()))))
            return false;

        return true;
    }

    // The lexer gathers runs of punctuation; the formatter needs them one at
    // a time so spacing can be decided per character. A backticked name is
    // passed through whole: splitting it would let the formatter put a line
    // break inside `a,b`, which renames the column.
    function splitPunctuation(t, out) {
        if (t.kind !== 'plain' || t.text[0] === '`') { out.push(t); return; }

        let buf = '';
        for (let i = 0; i < t.text.length; i++) {
            const c = t.text[i];
            if (isSpace(c)) {
                if (buf) { out.push({ text: buf, kind: 'plain' }); buf = ''; }
                continue;
            }
            if (c === ',' || c === '(' || c === ')' || c === ';' || c === '.') {
                if (buf) { out.push({ text: buf, kind: 'plain' }); buf = ''; }
                out.push({ text: c, kind: 'plain' });
                continue;
            }
            buf += c;
        }
        if (buf) out.push({ text: buf, kind: 'plain' });
    }

    /*
     * SqlFormat.StripComments: drop -- comments and collapse runs of
     * whitespace, leaving quoted runs exactly as they were. A comment marker
     * or a run of spaces inside a literal is data, and squeezing it would
     * change what the query matches. Tracks which delimiter opened the run,
     * since a flag for the apostrophe alone read a marker inside "..." as a
     * real comment.
     */
    function formatStripComments(sql) {
        const text = str(sql);
        let out = '';
        let quote = null;
        let pendingSpace = false;
        let i = 0;

        while (i < text.length) {
            const c = text[i];

            if (quote !== null) {
                out += c;
                if (c === '\\' && quote !== '`' && i + 1 < text.length) {
                    out += text[i + 1];
                    i += 2;
                    continue;
                }
                if (c === quote) {
                    if (text[i + 1] === quote) { out += quote; i++; }    // doubled = escape
                    else quote = null;
                }
                i++;
            } else if (c === '\'' || c === '"' || c === '`') {
                if (pendingSpace) { out += ' '; pendingSpace = false; }
                quote = c;
                out += c;
                i++;
            } else if (c === '-' && text[i + 1] === '-') {
                while (i < text.length && text[i] !== '\n') i++;     // to end of line
            } else if (isSpace(c)) {
                pendingSpace = true;
                i++;
            } else {
                if (pendingSpace) { out += ' '; pendingSpace = false; }
                out += c;
                i++;
            }
        }
        return out.trim();
    }

    // ------------------------------------------------------------------
    // Comments out before sending (SqlComments)
    // ------------------------------------------------------------------

    /*
     * Fishbowl's data-query endpoint refuses a statement that starts with a
     * comment, though MySQL would run it. Comments are worth keeping in the
     * editor, so they come out here, as the statement is sent. Every comment
     * goes, not only a leading one: one at the end of the last line would
     * otherwise comment out the LIMIT the row limit appends. MySQL's /*! and
     * /*+ forms look like comments but are run, so they stay.
     */

    // Where a comment was, while the lines around it are tidied: a character
    // SQL has no use for. Built rather than written, because Fishbowl strips
    // control characters from saved scripts.
    const MARK = String.fromCharCode(1);

    function isRemovable(t) {
        return t.kind === 'comment' && !t.text.startsWith('/*!') && !t.text.startsWith('/*+');
    }

    // A line left blank by a comment goes with it; a line that was blank to
    // begin with stays, since inside a literal it is data. A statement with
    // no comments comes back exactly as it was.
    function stripComments(sql) {
        const text = str(sql);
        if (text.includes(MARK)) return text;

        const tokens = scan(text);
        if (!tokens.some(isRemovable)) return text;

        let marked = '';
        for (const t of tokens) {
            if (!isRemovable(t)) { marked += t.text; continue; }

            // A block comment can sit between two words, as in SELECT/**/num,
            // and taking it out must not join them into one.
            marked += MARK;
            if (t.text.startsWith('/*')) marked += ' ';
        }

        const kept = [];
        for (const line of marked.replace(/\r\n/g, '\n').split('\n')) {
            if (!line.includes(MARK)) { kept.push(line); continue; }
            const rest = trimEnd(line.split(MARK).join(''));
            if (rest.trim().length > 0) kept.push(rest);
        }
        return kept.join('\n').trim();
    }

    // ------------------------------------------------------------------
    // Row limit (SqlLimit)
    // ------------------------------------------------------------------

    /*
     * The data-query endpoint returns whatever the statement selects, so a
     * limit appended to the statement is the only guard the server honours.
     * Rewriting someone's SQL is the kind of help that becomes a bug report,
     * so a statement is only touched when the extra clause cannot change what
     * it means: one statement, starting with SELECT, with no LIMIT of its own.
     * WITH ... SELECT is left alone because its shape is harder to be sure of.
     */
    function limitApplies(sql) {
        const text = str(sql).trim();
        if (text.length === 0) return false;

        let sawSelect = false;
        for (const t of scan(text)) {
            // Comments and literals carry no syntax, so they decide nothing.
            if (t.kind === 'comment' || t.kind === 'string') continue;

            // Nor does a backticked name, though a semicolon inside one would
            // otherwise read as a second statement.
            if (t.text[0] === '`') {
                if (!sawSelect) return false;
                continue;
            }

            if (t.kind === 'keyword') {
                const word = t.text.toUpperCase();
                if (!sawSelect) {
                    if (word !== 'SELECT') return false;
                    sawSelect = true;
                    continue;
                }
                if (word === 'LIMIT') return false;
                continue;
            }

            // A semicolon anywhere but trailing means more than one statement.
            if (t.text.includes(';') && !isTrailingSemicolon(text, t)) return false;

            // Anything before the SELECT that is not whitespace is not a plain
            // query: a leading bracket, a stray word, an assignment.
            if (!sawSelect && t.text.trim().length > 0) return false;
        }

        return sawSelect;
    }

    // Only semicolons (and whitespace) from the first one to the very end of
    // the text. Checked by offset: matching the token's text against the end
    // of the statement also accepted the ";" between two statements whenever
    // the last one ended with a semicolon too.
    function isTrailingSemicolon(text, t) {
        if (t.start + trimEnd(t.text).length !== text.length) return false;
        return /^[;\s]*$/.test(t.text.slice(t.text.indexOf(';')));
    }

    // Only call this when limitApplies said yes. A trailing semicolon is
    // dropped rather than worked around: "SELECT 1; LIMIT 10" does not parse.
    function applyLimit(sql, rows) {
        let text = trimEnd(str(sql));
        while (text.endsWith(';')) text = trimEnd(text.slice(0, -1));
        return text + ' LIMIT ' + rows;
    }

    // ------------------------------------------------------------------
    // FROM-first statements (SqlReorder)
    // ------------------------------------------------------------------

    /*
     * Writing the FROM first is the natural order for completion: once the
     * tables are named, the column list only offers their columns. MySQL does
     * not accept it, and its syntax error does not say order is the only
     * problem. This moves the SELECT, UPDATE or DELETE to where MySQL wants
     * it, just before sending. Only statements that START with FROM are
     * touched, so nothing that would have run anyway changes meaning.
     */

    // Where one clause ends and the next begins, at the statement's own level.
    const REORDER_CLAUSES = new Set([
        'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW', 'SELECT', 'UPDATE', 'DELETE',
    ]);

    // A join is part of the FROM, so one written after the SELECT still goes
    // back with the tables.
    const REORDER_JOINS = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'FULL', 'NATURAL', 'STRAIGHT_JOIN']);
    const SET_OPERATORS = new Set(['UNION', 'INTERSECT', 'EXCEPT']);

    function normalise(sql) {
        const text = str(sql);

        // Each statement's span, its words at depth 0, and where its first
        // real token is.
        const statements = [];
        let words = [];
        let start = 0;
        let first = -1;
        let depth = 0;

        for (const t of scan(text)) {
            const at = t.start;

            // A backticked name is one token, like a literal, and a bracket
            // inside one is part of the name.
            if (t.kind === 'comment' || t.kind === 'string' || t.text[0] === '`') {
                if (first < 0 && t.kind !== 'comment') first = at;
                continue;
            }

            const c0 = t.text[0];
            if (t.text.length > 0 && (isLetter(c0) || c0 === '_')) {
                if (first < 0) first = at;
                if (depth === 0) words.push({ at, text: t.text });
                continue;
            }

            // Punctuation and whitespace, char by char, for brackets and the
            // semicolons between statements.
            for (let i = 0; i < t.text.length; i++) {
                const c = t.text[i];
                if (c === '(') depth++;
                else if (c === ')') depth = Math.max(0, depth - 1);
                else if (c === ';' && depth === 0) {
                    statements.push({ s: start, e: at + i, words, first });
                    words = [];
                    start = at + i + 1;
                    first = -1;
                    continue;
                }
                if (first < 0 && !isSpace(c)) first = at + i;
            }
        }
        statements.push({ s: start, e: text.length, words, first });

        let output = '';
        let changed = false;
        let last = 0;

        for (const { s, e, words: w, first: f } of statements) {
            if (w.length === 0 || f < 0 || w[0].at !== f || w[0].text.toUpperCase() !== 'FROM') continue;

            const r = reorder(text, s, e, w);
            if (r.problem !== null) return { sql: text, changed: false, problem: r.problem };

            output += text.slice(last, s) + r.sql;
            last = e;
            changed = true;
        }

        if (!changed) return { sql: text, changed: false, problem: null };
        output += text.slice(last);
        return { sql: output, changed: true, problem: null };
    }

    // One FROM-first statement, span [s, e) of the text.
    function reorder(text, s, e, words) {
        const verbIndex = words.findIndex(x => {
            const u = x.text.toUpperCase();
            return u === 'SELECT' || u === 'UPDATE' || u === 'DELETE';
        });
        if (verbIndex < 0)
            return problem('This query starts with FROM but has no SELECT.\n\n' +
                           'Writing the FROM first is fine, and it helps completion. Add the SELECT after it, ' +
                           'for example:\n\n  FROM part SELECT num, description');

        if (words.some(x => SET_OPERATORS.has(x.text.toUpperCase())))
            return problem('A query combined with UNION, INTERSECT or EXCEPT has to be written with its SELECT ' +
                           'first. Only a single query can start with FROM.');

        if (words.slice(1).some(x => x.text.toUpperCase() === 'FROM'))
            return problem('This query starts with FROM and has another FROM later on, so it isn\'t clear which ' +
                           'tables the SELECT belongs to. Write it with the SELECT first.');

        // Each clause runs from its keyword to the next clause keyword, or to
        // the next join after the verb.
        const verb = words[verbIndex].text.toUpperCase();
        const cuts = [];
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const upper = word.text.toUpperCase();
            if (REORDER_CLAUSES.has(upper)) {
                cuts.push({ at: word.at, kind: i === verbIndex ? 'verb' : upper === 'FROM' ? 'from' : 'other' });
            } else if (i > verbIndex && REORDER_JOINS.has(upper) && !isCall(text, word, e) && !continuesJoin(words, i)) {
                cuts.push({ at: word.at, kind: 'join' });
            }
        }

        const pieces = cuts.map((cut, i) => ({
            kind: cut.kind,
            text: text.slice(cut.at, i + 1 < cuts.length ? cuts[i + 1].at : e).trim(),
        }));

        const fromText = pieces.find(p => p.kind === 'from').text;
        const verbText = pieces.find(p => p.kind === 'verb').text;
        const joins = pieces.filter(p => p.kind === 'join').map(p => p.text);
        const rest = pieces.filter(p => p.kind === 'other').map(p => p.text);

        // Separate lines when the statement was written on several; one line
        // otherwise, so a one-liner stays a one-liner.
        const span = text.slice(s, e);
        const sep = span.includes('\n') ? '\n' : ' ';
        const lead = text.slice(s, words[0].at);              // comments before the FROM stay first
        const trail = span.length - trimEnd(span).length;

        let parts;
        if (verb === 'UPDATE') {
            // MySQL's UPDATE names its tables straight after the keyword, joins
            // and all, then SET: UPDATE part p JOIN ... SET p.x = 1 WHERE ...
            const set = verbText.slice(6).trim();
            if (!/^SET/i.test(set))
                return problem('An UPDATE needs SET after it, for example:\n\n  FROM part UPDATE SET description = \'x\' WHERE id = 1');
            parts = ['UPDATE ' + fromText.slice(4).trim(), ...joins, set, ...rest];
        } else {
            // SELECT ... FROM ..., and DELETE [targets] FROM ..., the same shape.
            parts = [verbText, fromText, ...joins, ...rest];
        }

        return { sql: lead + parts.join(sep) + text.slice(e - trail, e), problem: null };
    }

    function problem(message) { return { sql: '', problem: message }; }

    // LEFT( and RIGHT( are string functions, not joins.
    function isCall(text, word, end) {
        let i = word.at + word.text.length;
        while (i < end && isSpace(text[i])) i++;
        return i < end && text[i] === '(';
    }

    // In LEFT OUTER JOIN only the LEFT begins a piece; the JOIN after it
    // belongs to the same one.
    function continuesJoin(words, i) {
        if (i === 0) return false;
        const prev = words[i - 1].text.toUpperCase();
        return prev === 'INNER' || prev === 'LEFT' || prev === 'RIGHT' || prev === 'CROSS' ||
               prev === 'FULL' || prev === 'NATURAL' || prev === 'OUTER';
    }

    // ------------------------------------------------------------------
    // Where the caret is (SqlContext)
    // ------------------------------------------------------------------

    /*
     * Position is most of what decides whether a keyword or a column is
     * wanted: straight after FROM only a table can be legal, and in the middle
     * of a WHERE a column is far more likely than the word EXCEPT.
     */

    // The last clause keyword before the caret.
    const CLAUSE_RX = /\b(SELECT|FROM|WHERE|JOIN|ON|GROUP\s+BY|ORDER\s+BY|HAVING|SET|INTO|UPDATE|VALUES)\b/gi;

    // Directly after FROM/JOIN, with at most a partial word typed. The
    // lookahead stands in for .NET's end anchor, which also matches before a
    // final newline.
    const EXPECTS_TABLE_RX = /\b(?:FROM|JOIN|INTO|UPDATE)\s+[A-Za-z0-9_]*(?=\n?$)/i;

    function place(before) {
        // Deliberately NOT trimmed: the space after FROM is what says the
        // table name has not been typed yet.
        let text = str(before);
        if (text.trim().length === 0) return 'start';

        // A statement boundary resets everything.
        const semi = text.lastIndexOf(';');
        if (semi >= 0) text = text.slice(semi + 1);
        if (text.trim().length === 0) return 'start';

        if (EXPECTS_TABLE_RX.test(text)) return 'tablename';

        const matches = text.match(CLAUSE_RX);
        if (!matches) return 'start';

        switch (matches[matches.length - 1].toUpperCase().replace(/\s+/g, ' ')) {
            case 'SELECT': return 'selectlist';
            case 'FROM': case 'JOIN': case 'INTO': case 'UPDATE': return 'unknown';   // past the table name
            case 'WHERE': case 'ON': case 'HAVING': case 'SET': return 'condition';
            case 'GROUP BY': case 'ORDER BY': return 'columnlist';
            default: return 'unknown';
        }
    }

    // Used only for ordering, never to exclude anything: a keyword is legal
    // almost everywhere, and hiding one on a guess would be worse than
    // showing it second.
    function prefersColumns(where) {
        const p = str(where).toLowerCase();
        return p === 'selectlist' || p === 'condition' || p === 'columnlist';
    }

    // What a completion is, and the short label on the left of its row.
    const ITEM_KINDS = Object.freeze(['keyword', 'table', 'view', 'column', 'variable', 'join']);
    const ITEM_LABELS = { keyword: 'kw', table: 'tbl', view: 'view', variable: 'var', join: 'join' };

    function itemKindLabel(kind) {
        return ITEM_LABELS[str(kind).toLowerCase()] || 'col';
    }

    // ------------------------------------------------------------------
    // Value tones (Tone, CellStyle)
    // ------------------------------------------------------------------

    /*
     * Fishbowl's own status words, grouped by what they mean rather than by
     * which module they came from: "Fulfilled" on a sales order and
     * "Received" on a purchase order are the same news to whoever reads the
     * table. Unknown values are left alone; guessing from a substring would
     * eventually colour a part description.
     */
    const lowerSet = words => new Set(words.map(w => w.toLowerCase()));

    const TONE_POSITIVE = lowerSet([
        'Fulfilled', 'Shipped', 'Received', 'Closed', 'Completed', 'Complete', 'Finished',
        'Approved', 'Paid', 'Posted', 'Packed', 'Picked', 'Committed', 'Active', 'Enabled',
        'Success', 'Successful', 'Available', 'OK', 'true', 'yes',
    ]);
    const TONE_ACTIVE = lowerSet([
        'Issued', 'In Progress', 'InProgress', 'Started', 'Picking', 'Partial', 'Partially Fulfilled',
        'Scheduled', 'Planned', 'Printed', 'Processing', 'Open', 'Running', 'Reserved', 'Split',
    ]);
    const TONE_WARNING = lowerSet([
        'Pending Approval', 'Bid Request', 'Estimate', 'Expired', 'On Hold', 'Hold',
        'Closed Short', 'Short', 'Backordered', 'Back Ordered', 'Overdue', 'Late',
        'Warning', 'Unapproved', 'Awaiting Approval', 'Quote', 'Not Available', 'Unpaid',
    ]);
    const TONE_NEGATIVE = lowerSet([
        'Void', 'Voided', 'Cancelled', 'Canceled', 'Rejected', 'Failed', 'Error', 'Deleted',
        'Inactive', 'Disabled', 'Unfulfilled', 'false', 'no',
    ]);
    const TONE_QUIET = lowerSet([
        'Entered', 'Draft', 'New', 'Historical', 'Archived', 'None', 'Pending', 'Unknown',
        'Not Started', 'Created',
    ]);

    function tone(value) {
        const v = str(value).trim().toLowerCase();
        if (v.length === 0 || v === 'null') return 'empty';
        if (TONE_POSITIVE.has(v)) return 'positive';
        if (TONE_ACTIVE.has(v)) return 'active';
        if (TONE_WARNING.has(v)) return 'warning';
        if (TONE_NEGATIVE.has(v)) return 'negative';
        if (TONE_QUIET.has(v)) return 'quiet';
        return 'none';
    }

    // A chip only for a value with a recognised meaning: around every cell it
    // would be noise, and around a part number a lie.
    function isChip(value) {
        const t = tone(value);
        return t !== 'none' && t !== 'empty';
    }

    function isBoolean(v) {
        const l = v.toLowerCase();
        return l === 'true' || l === 'false' || l === 'yes' || l === 'no';
    }

    // Stands in for .NET's double.TryParse (float style with thousands
    // separators), assuming the '.' decimal and ',' group of en-AU/en-US.
    function looksNumeric(v) {
        if (/^[+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v)) return true;
        return /^[+-]?(?:nan|infinity|∞)$/i.test(v);
    }

    /*
     * The tone for one result cell, or 'none' when it is ordinary data. A
     * boolean is coloured wherever it appears, because true and false read
     * the same in every column. A status word only in a column that says it
     * holds a state: "Open" is a state on an order and an ordinary word in a
     * description.
     */
    function cellTone(column, value) {
        const v = str(value).trim();
        if (v.length === 0) return 'none';

        const col = str(column).toLowerCase();

        if (isBoolean(v)) return tone(v);

        // A bit(1) that came back as a digit. Gated on the column name,
        // because a bare 1 or 0 anywhere else is a number, not a state.
        if (col.endsWith('flag')) {
            if (v === '1') return 'positive';
            if (v === '0') return 'negative';
        }

        if (!col.includes('status') && !col.includes('state')) return 'none';

        // A status id is a number. Colouring 20 tells nobody anything, and it
        // would drag the whole column into pill mode.
        if (looksNumeric(v)) return 'none';

        // An unknown word in a column that says it holds a state still gets a
        // pill, a neutral one: a lone bare value among them looks like a fault.
        const t = tone(v);
        return t === 'none' || t === 'empty' ? 'active' : t;
    }

    /*
     * All or nothing, per column: one where only some rows are coloured reads
     * as a rendering fault rather than a distinction. The distinct-value cap
     * is the second guard: a column of a hundred different words is prose.
     */
    function isPillColumn(column, values, maxDistinct = 12) {
        const distinct = new Set();
        let any = false;

        for (const value of values || []) {
            const v = str(value).trim();
            if (v.length === 0) continue;                // a blank cell is just blank

            if (cellTone(column, v) === 'none') return false;

            any = true;
            distinct.add(v.toUpperCase());
            if (distinct.size > maxDistinct) return false;
        }

        return any;
    }

    // ------------------------------------------------------------------
    // Statements
    // ------------------------------------------------------------------

    /*
     * The lexer's tokens cut finer for analysis: comments dropped, punctuation
     * one character at a time, each piece typed. 'kw' is a keyword, 'word' an
     * ordinary identifier, 'qid' a backticked one.
     */
    function lexemes(tokens) {
        const out = [];
        for (const t of tokens) {
            if (t.kind === 'comment') continue;
            const c0 = t.text[0];
            if (t.kind === 'plain' && c0 !== '`' && !(isLetter(c0) || c0 === '_')) {
                for (let i = 0; i < t.text.length; i++) {
                    if (!isSpace(t.text[i])) out.push(lexeme(t.text[i], 'punct', t.start + i));
                }
                continue;
            }
            const type = t.kind === 'keyword' ? 'kw'
                       : t.kind === 'string' ? 'str'
                       : t.kind === 'number' ? 'num'
                       : c0 === '`' ? 'qid' : 'word';
            out.push(lexeme(t.text, type, t.start));
        }
        return out;
    }

    function lexeme(text, type, start) {
        return { text, type, start, end: start + text.length, upper: text.toUpperCase() };
    }

    // A name as MySQL reads it: quotes off, doubled quotes single.
    function nameOf(l) {
        if (l.type !== 'qid' && l.type !== 'str') return l.text;
        const q = l.text[0];
        let inner = l.text.slice(1);
        if (inner.length > 0 && inner.endsWith(q)) inner = inner.slice(0, -1);
        return inner.split(q + q).join(q);
    }

    const isId = l => !!l && (l.type === 'word' || l.type === 'qid');
    const isPunct = (l, ch) => !!l && l.type === 'punct' && l.text === ch;
    const isKw = (l, word) => !!l && l.type === 'kw' && l.upper === word;

    // Statement spans [start, end), split on every semicolon the lexer leaves
    // as punctuation; one inside a literal, a comment or backticks is data.
    function statementSpans(tokens, length) {
        const spans = [];
        let start = 0;
        for (const t of tokens) {
            if (t.kind !== 'plain' || t.text[0] === '`') continue;
            for (let i = 0; i < t.text.length; i++) {
                if (t.text[i] !== ';') continue;
                spans.push({ start, end: t.start + i });
                start = t.start + i + 1;
            }
        }
        spans.push({ start, end: length });
        return spans;
    }

    // The spans that hold any code, with their lexemes. One holding only
    // whitespace or comments is dropped: "SELECT 1; -- done" is one statement.
    function statementsOf(tokens, lx, length) {
        const out = [];
        let p = 0;
        for (const sp of statementSpans(tokens, length)) {
            const L = [];
            while (p < lx.length && lx[p].start < sp.end) {
                if (lx[p].start >= sp.start) L.push(lx[p]);
                p++;
            }
            if (L.length) out.push({ start: sp.start, end: sp.end, L });
        }
        return out;
    }

    function splitStatements(sql) {
        const text = str(sql);
        const tokens = scan(text);
        return statementsOf(tokens, lexemes(tokens), text.length)
            .map(s => ({ text: text.slice(s.start, s.end).trim(), start: s.start, end: s.end }));
    }

    // The kind of one statement's lexemes, and the word that decided it.
    function kindOf(L) {
        if (!L.length) return { kind: 'empty', at: null };
        let i = 0;
        let paren = false;
        while (i < L.length && isPunct(L[i], '(')) { paren = true; i++; }
        const w = L[i];
        if (!w || w.type !== 'kw') return { kind: 'other', at: w || null };
        if (w.upper === 'SELECT') return { kind: 'select', at: w };
        if (!paren) {
            switch (w.upper) {
                case 'INSERT': return { kind: 'insert', at: w };
                case 'UPDATE': return { kind: 'update', at: w };
                case 'DELETE': return { kind: 'delete', at: w };
                case 'WITH': return { kind: 'with', at: w };
            }
        }
        return { kind: 'other', at: w };
    }

    // The first statement's kind. An empty statement before it (a stray
    // leading semicolon) is skipped like the comments are.
    function statementKind(sql) {
        const text = str(sql);
        const tokens = scan(text);
        const statements = statementsOf(tokens, lexemes(tokens), text.length);
        return statements.length ? kindOf(statements[0].L).kind : 'empty';
    }

    // ------------------------------------------------------------------
    // Lint
    // ------------------------------------------------------------------

    /*
     * Every rule here leans towards silence: a false alarm teaches people to
     * ignore the panel, which costs more than the occasional missed mistake.
     * So each rule only fires on a shape it can name with certainty, and a
     * statement the lexer could not close is checked only for what its start
     * already says.
     */

    const WITH_MESSAGE = 'Fishbowl only runs statements that start with SELECT. ' +
                         'Wrap it: SELECT * FROM (WITH … SELECT …) AS t';

    function lint(sql, schema) {
        const text = str(sql);
        const issues = [];
        const tokens = scan(text);

        // An unterminated run always reaches the end of the text, so there is
        // at most one, and it is in the last statement.
        let openAt = -1;
        for (const t of tokens) {
            if (!t.open) continue;
            openAt = t.start;
            const what = t.kind === 'comment' ? 'This block comment is never closed.'
                       : t.text[0] === '`' ? 'This backticked name is never closed.'
                       : 'This string is never closed.';
            issues.push({ severity: 'error', message: what, start: t.start, end: t.start + t.text.length });
        }

        const statements = statementsOf(tokens, lexemes(tokens), text.length);
        for (const st of statements) {
            lintStatement(st.L, openAt >= st.start, schema, issues);
        }

        if (statements.length > 1) {
            const at = statements[0].end;
            issues.push({
                severity: 'info',
                message: `${statements.length} statements: Run executes the one under the caret.`,
                start: at,
                end: Math.min(at + 1, text.length),
            });
        }

        const rank = { error: 0, warning: 1, info: 2 };
        issues.sort((a, b) => a.start - b.start || rank[a.severity] - rank[b.severity]);
        return issues;
    }

    // Its kind, reading a FROM-first statement by the verb it will be
    // reordered around, so FROM part DELETE is still a DELETE.
    function verbOf(L) {
        const k = kindOf(L);
        if (k.kind !== 'other' || k.at !== L[0] || !isKw(L[0], 'FROM')) return k;
        let depth = 0;
        for (const l of L) {
            if (isPunct(l, '(')) depth++;
            else if (isPunct(l, ')')) depth = Math.max(0, depth - 1);
            else if (depth === 0 && l.type === 'kw' &&
                     (l.upper === 'SELECT' || l.upper === 'UPDATE' || l.upper === 'DELETE')) {
                return { kind: l.upper.toLowerCase(), at: l };
            }
        }
        return k;
    }

    function issue(issues, severity, message, from, to) {
        issues.push({ severity, message, start: from.start, end: (to || from).end });
    }

    function lintStatement(L, broken, schema, issues) {
        const verb = verbOf(L);

        if (verb.kind === 'with') issue(issues, 'error', WITH_MESSAGE, verb.at);
        if (verb.kind === 'delete') issue(issues, 'error', 'DELETE statements are not supported.', verb.at);

        // The rest reads structure, which an unclosed literal has swallowed.
        if (broken) return;

        const balanced = lintBrackets(L, issues);

        if (verb.kind === 'update' && !hasTopLevel(L, 'WHERE')) {
            issue(issues, 'warning', 'This UPDATE has no WHERE clause: it changes every row in the table.', verb.at);
        }

        lintTrailingCommas(L, issues);

        if (!balanced) return;
        if (isKw(L[0], 'SELECT')) lintDuplicateColumns(L, issues);
        if (schema && typeof schema.hasTable === 'function') lintSchema(L, schema, issues);
    }

    function lintBrackets(L, issues) {
        const stack = [];
        let ok = true;
        for (const l of L) {
            if (isPunct(l, '(')) stack.push(l);
            else if (isPunct(l, ')')) {
                if (stack.length) stack.pop();
                else { issue(issues, 'error', 'This closing bracket has no opening one.', l); ok = false; }
            }
        }
        for (const l of stack) { issue(issues, 'error', 'This bracket is never closed.', l); ok = false; }
        return ok;
    }

    function hasTopLevel(L, word) {
        let depth = 0;
        for (const l of L) {
            if (isPunct(l, '(')) depth++;
            else if (isPunct(l, ')')) depth = Math.max(0, depth - 1);
            else if (depth === 0 && isKw(l, word)) return true;
        }
        return false;
    }

    const COMMA_STOPS = new Set(['FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT']);

    function lintTrailingCommas(L, issues) {
        for (let i = 0; i + 1 < L.length; i++) {
            if (!isPunct(L[i], ',')) continue;
            const next = L[i + 1];
            if (isPunct(next, ')')) {
                issue(issues, 'error', 'Trailing comma before the closing bracket.', L[i]);
            } else if (next.type === 'kw' && COMMA_STOPS.has(next.upper)) {
                const what = (next.upper === 'GROUP' || next.upper === 'ORDER') && isKw(L[i + 2], 'BY')
                    ? next.upper + ' BY' : next.upper;
                issue(issues, 'error', `Trailing comma before ${what}.`, L[i]);
            }
        }
    }

    // Where a top-level select list stops.
    const SELECT_END = new Set([
        'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'INTO', 'WINDOW', 'FOR',
        'INTERSECT', 'EXCEPT',
    ]);
    const SELECT_MODIFIERS = /^(?:DISTINCT|DISTINCTROW|ALL|HIGH_PRIORITY|STRAIGHT_JOIN|SQL_\w+)$/;

    /*
     * runQuery hands rows back as objects keyed by lower-cased column name,
     * so two columns called num (p.num and pr.num, say) arrive as one. Only
     * items whose name can be read off with certainty are compared: an
     * expression MySQL names after its own text is skipped.
     */
    function lintDuplicateColumns(L, issues) {
        const seen = new Set();
        for (const item of selectItems(L)) {
            const named = itemName(item);
            if (!named) continue;
            const name = nameOf(named);
            const key = name.toLowerCase();
            if (seen.has(key)) {
                issue(issues, 'warning',
                      `Two columns are named ${name}; give one an alias, or only one will be shown.`,
                      item[0], item[item.length - 1]);
            } else {
                seen.add(key);
            }
        }
    }

    function selectItems(L) {
        let i = 1;
        while (i < L.length && (L[i].type === 'kw' || L[i].type === 'word') && SELECT_MODIFIERS.test(L[i].upper)) i++;

        const items = [];
        let current = [];
        let depth = 0;
        for (; i < L.length; i++) {
            const l = L[i];
            if (l.type === 'punct') {
                if (l.text === '(') depth++;
                else if (l.text === ')') { if (depth === 0) break; depth--; }
                else if (l.text === ',' && depth === 0) { items.push(current); current = []; continue; }
            } else if (depth === 0 && l.type === 'kw' && SELECT_END.has(l.upper)) {
                break;
            }
            current.push(l);
        }
        items.push(current);
        return items;
    }

    // ident ( . ident )*, the part after a dot allowed to be a keyword.
    function isChain(item, length) {
        if (length < 1 || length % 2 === 0) return false;
        for (let k = 0; k < length; k++) {
            const l = item[k];
            if (k % 2 === 1) { if (!isPunct(l, '.')) return false; }
            else if (k === 0) { if (!isId(l)) return false; }
            else if (!(isId(l) || l.type === 'kw')) return false;
        }
        return true;
    }

    // The lexeme that names a select item, or null when it cannot be told.
    function itemName(item) {
        const n = item.length;
        if (n === 0) return null;
        const last = item[n - 1];

        // expr AS alias: whatever the expression, the alias names it.
        if (n >= 3 && isKw(item[n - 2], 'AS')) {
            return isId(last) || last.type === 'kw' || last.type === 'str' ? last : null;
        }

        // col, t.col, db.t.col
        if (isChain(item, n)) return last;

        // A bare alias, only after shapes where a trailing word cannot be
        // anything else: a column, a closing bracket, CASE ... END, a literal.
        // "a DIV b" or "x COLLATE y" end in a word too, and must not match.
        if (n < 2 || !isId(last)) return null;
        const prev = item[n - 2];
        if (isPunct(prev, ')')) return last;
        if (isKw(prev, 'END') && isKw(item[0], 'CASE')) return last;

        const spaced = prev.end < last.start || prev.type === 'qid' || last.type === 'qid';
        if (!spaced) return null;
        if (isChain(item, n - 1)) return last;
        if (n === 2 && (prev.type === 'str' || prev.type === 'num')) return last;
        return null;
    }

    // Words that follow a table without being its alias.
    const NOT_ALIAS = new Set(['NATURAL', 'STRAIGHT_JOIN', 'USE', 'FORCE', 'IGNORE', 'LATERAL', 'TABLESAMPLE']);
    // Words where a table would be, that are not one.
    const NOT_TABLE = new Set(['LATERAL', 'DUAL']);
    const UPDATE_MODIFIERS = new Set(['LOW_PRIORITY', 'IGNORE']);
    const SYSTEM_SCHEMAS = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);

    function lintSchema(L, schema, issues) {
        // A lookup that throws must not raise an alarm.
        const hasTable = name => { try { return !!schema.hasTable(name); } catch (e) { return true; } };
        const columnsOf = table => {
            if (typeof schema.columns !== 'function') return [];
            try { const c = schema.columns(table); return Array.isArray(c) ? c : []; } catch (e) { return []; }
        };

        // CTE names (name AS ( or name (cols) AS ( ) are tables for this
        // statement only, so the schema has never heard of them.
        const cte = new Set();
        for (let i = 1; i + 1 < L.length; i++) {
            if (!isKw(L[i], 'AS') || !isPunct(L[i + 1], '(')) continue;
            let p = i - 1;
            if (isPunct(L[p], ')')) p = openerOf(L, p) - 1;
            if (p >= 0 && isId(L[p])) cte.add(nameOf(L[p]).toLowerCase());
        }

        const refs = collectTableRefs(L);

        for (const r of refs) {
            if (r.qualified) continue;
            const lower = r.name.toLowerCase();
            if (cte.has(lower) || SYSTEM_SCHEMAS.has(lower)) continue;
            r.known = hasTable(r.name);
            if (!r.known) issue(issues, 'warning', `Unknown table ${r.name}.`, r.lx);
        }

        // Which table each qualifier means. A qualifier that could mean two
        // things (the same alias in two subqueries, or a derived table's alias
        // or a column alias of the same name) is not checked at all.
        const aliasStarts = new Set(refs.filter(r => r.alias).map(r => r.alias.start));
        const refStarts = new Set(refs.map(r => r.lx.start));
        const tables = new Map();
        const blocked = new Set();

        for (const r of refs) {
            const key = (r.alias ? nameOf(r.alias) : r.name).toLowerCase();
            if (!r.known) { blocked.add(key); continue; }
            const entry = tables.get(key) || { name: r.name, tables: new Set() };
            entry.tables.add(r.name.toLowerCase());
            tables.set(key, entry);
        }
        for (let i = 0; i + 1 < L.length; i++) {
            if ((isKw(L[i], 'AS') || isPunct(L[i], ')')) && isId(L[i + 1]) && !aliasStarts.has(L[i + 1].start)) {
                blocked.add(nameOf(L[i + 1]).toLowerCase());
            }
        }

        for (let i = 0; i + 2 < L.length; i++) {
            const q = L[i];
            const col = L[i + 2];
            if (!isId(q) || !isPunct(L[i + 1], '.') || !(isId(col) || col.type === 'kw')) continue;
            if (i > 0 && (isPunct(L[i - 1], '.') || isPunct(L[i - 1], '@'))) continue;
            if (isPunct(L[i + 3], '.') || isPunct(L[i + 3], '(')) continue;   // db.t.col, or a schema function
            if (refStarts.has(q.start)) continue;                            // a qualified table name itself

            const key = nameOf(q).toLowerCase();
            if (blocked.has(key)) continue;
            const entry = tables.get(key);
            if (!entry || entry.tables.size !== 1) continue;

            const columns = columnsOf(entry.name);
            if (!columns.length) continue;                                   // nothing known, nothing to say
            const want = nameOf(col).toLowerCase();
            if (columns.some(c => str(c).toLowerCase() === want)) continue;
            issue(issues, 'warning', `${entry.name} has no column ${nameOf(col)}.`, col);
        }
    }

    function openerOf(L, close) {
        let depth = 0;
        for (let i = close; i >= 0; i--) {
            if (isPunct(L[i], ')')) depth++;
            else if (isPunct(L[i], '(') && --depth === 0) return i;
        }
        return -1;
    }

    /*
     * The tables a statement names, after FROM, JOIN, a leading UPDATE and
     * INSERT/REPLACE ... INTO. A FROM only counts when it belongs to a SELECT
     * or DELETE at its own bracket depth (or opens it, FROM-first), because
     * EXTRACT(YEAR FROM d) and TRIM('x' FROM s) put a column there.
     */
    function collectTableRefs(L) {
        const refs = [];
        const levels = [{ verb: false, count: 0 }];
        const inserting = isKw(L[0], 'INSERT') || isKw(L[0], 'REPLACE');
        let sawInto = false;

        for (let i = 0; i < L.length; i++) {
            const l = L[i];
            const top = levels[levels.length - 1];
            if (isPunct(l, '(')) { top.count++; levels.push({ verb: false, count: 0 }); continue; }
            if (isPunct(l, ')')) { if (levels.length > 1) levels.pop(); continue; }

            let context = null;
            if (l.type === 'kw') {
                if (l.upper === 'SELECT' || l.upper === 'DELETE') top.verb = true;
                else if (l.upper === 'FROM' && (top.verb || top.count === 0)) context = 'from';
                else if (l.upper === 'JOIN') context = 'join';
                else if (l.upper === 'UPDATE' && i === 0) context = 'update';
                else if (l.upper === 'INTO' && inserting && levels.length === 1 && !sawInto) {
                    sawInto = true;
                    context = 'into';
                }
            }
            top.count++;
            if (context) readTables(L, i + 1, context, refs);
        }
        return refs;
    }

    function readTables(L, j, context, refs) {
        for (;;) {
            while (context === 'update' && L[j] && L[j].type === 'word' && UPDATE_MODIFIERS.has(L[j].upper)) j++;

            const t = L[j];
            if (!isId(t) || NOT_TABLE.has(t.upper)) return;       // a derived table, a keyword, DUAL

            let k = j + 1;
            let qualified = t.type === 'qid' && nameOf(t).includes('.');
            while (isPunct(L[k], '.') && L[k + 1] && (isId(L[k + 1]) || L[k + 1].type === 'kw')) {
                qualified = true;
                k += 2;
            }
            // A table function such as JSON_TABLE(...); after INTO the
            // bracket is the column list instead.
            if (isPunct(L[k], '(') && context !== 'into') return;

            let alias = null;
            if (isKw(L[k], 'AS') && isId(L[k + 1])) { alias = L[k + 1]; k += 2; }
            else if (isId(L[k]) && !NOT_ALIAS.has(L[k].upper)) { alias = L[k]; k++; }

            refs.push({ lx: t, name: nameOf(t), qualified, alias, known: false });

            if (context !== 'into' && isPunct(L[k], ',')) { j = k + 1; continue; }
            return;
        }
    }

    // ------------------------------------------------------------------

    /**
     * The output columns of a statement's top-level SELECT list, in the order
     * written: [{ name }] for a column, an alias or an expression (MySQL
     * labels an expression with its own text), [{ star: '' }] for * and
     * [{ star: 'p' }] for p.*. Empty when there is no SELECT list to read.
     *
     * The REST data query answers with JSON objects whose keys come out in
     * the server's map order, not the statement's: SELECT id, num arrives as
     * num, id. A CSV exported in that order is not the file that was asked
     * for, so the results grid puts the columns back in this order.
     */
    function selectColumns(sql) {
        const s = str(sql);
        const words = [];       // top-level words: { word, start, end, depth }
        const commas = [];
        let depth = 0;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (c === "'" || c === '"' || c === '`') {
                // Strings and backticked names, with doubled or backslashed quotes inside.
                for (i++; i < s.length; i++) {
                    if (s[i] === '\\' && c !== '`') { i++; continue; }
                    if (s[i] === c) { if (s[i + 1] === c) { i++; continue; } break; }
                }
            } else if (c === '(') depth++;
            else if (c === ')') depth--;
            else if (c === ',') commas.push({ at: i, depth });
            else if (/[A-Za-z_]/.test(c) && (i === 0 || !/[A-Za-z0-9_$.]/.test(s[i - 1]))) {
                let j = i;
                while (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) j++;
                words.push({ word: s.slice(i, j).toUpperCase(), start: i, end: j, depth });
                i = j - 1;
            }
        }
        const select = words.find(w => w.word === 'SELECT');
        if (!select) return [];
        const base = select.depth;
        const stop = words.find(w => w.start > select.start && w.depth === base
            && /^(FROM|INTO|WHERE|GROUP|HAVING|ORDER|LIMIT|UNION|WINDOW|FOR|LOCK)$/.test(w.word));
        const end = stop ? stop.start : s.length;
        const cuts = commas.filter(c => c.depth === base && c.at > select.end && c.at < end).map(c => c.at);
        const items = [];
        let from = select.end;
        cuts.concat([end]).forEach(at => { items.push(s.slice(from, at)); from = at + 1; });

        const unquote = n => /^[`"']/.test(n) ? n.slice(1, -1) : n;
        const ident = '(`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)';
        return items.map((raw, k) => {
            let item = raw.trim().replace(/\s+/g, ' ');
            if (k === 0) {
                let m;
                while ((m = /^(DISTINCTROW|DISTINCT|ALL|HIGH_PRIORITY|STRAIGHT_JOIN|SQL_[A-Z_]+)\s+/i.exec(item))) item = item.slice(m[0].length);
            }
            if (!item) return null;
            if (item === '*') return { star: '' };
            let m = new RegExp('^' + ident + '\\s*\\.\\s*\\*$').exec(item);
            if (m) return { star: unquote(m[1]) };
            // Where a plain column comes from (p.num, or num): its qualifier, if
            // any, and column, so the schema diagram can mark the field.
            const ref = expr => {
                const r = new RegExp('^(?:' + ident + '\\s*\\.\\s*)?' + ident + '$').exec(expr.trim());
                return r ? { qualifier: r[1] ? unquote(r[1]) : null, column: unquote(r[2]) } : {};
            };
            m = new RegExp('\\sAS\\s+(' + ident.slice(1, -1) + '|"[^"]*"|\'[^\']*\')$', 'i').exec(item);
            if (m) return Object.assign({ name: unquote(m[1]) }, ref(item.slice(0, m.index)));
            m = new RegExp('^(?:' + ident + '\\s*\\.\\s*)*' + ident + '$').exec(item);
            if (m) return Object.assign({ name: unquote(m[m.length - 1]) }, ref(item));
            // A bare alias: a name after a column, a bracket, a literal or END, that isn't a keyword.
            m = new RegExp('[A-Za-z0-9_`\'")]\\s(' + ident.slice(1, -1) + '|"[^"]*"|\'[^\']*\')$').exec(item);
            if (m && !KEYWORDS.includes(m[1].toUpperCase())) return Object.assign({ name: unquote(m[1]) }, ref(item.slice(0, m.index + 1)));
            return { name: item };
        }).filter(Boolean);
    }

    /**
     * The column a value at [start, end) is compared with, or null: the
     * `num` of `p.num = <value>`, `num LIKE <value>`, `num IN (…, <value>)`
     * or `<value> = p.num`. Quotes around the value are looked through.
     *
     * A record parameter is its id, as in the Data module, but compared with
     * a part's num it should be the part's number: this says which.
     */
    function comparedColumn(sql, start, end) {
        const s = str(sql);
        let a = start, b = end;
        if (s[a - 1] === "'" && s[b] === "'") { a--; b++; }
        const before = s.slice(0, a);
        const after = s.slice(b);
        const name = '(?:`?[A-Za-z_][A-Za-z0-9_$]*`?\\s*\\.\\s*)?`?([A-Za-z_][A-Za-z0-9_$]*)`?';
        const op = '(?:<=>|<>|!=|<=|>=|=|<|>|\\bNOT\\s+LIKE\\b|\\bLIKE\\b)';
        let m = new RegExp(name + '\\s*' + op + '\\s*$', 'i').exec(before)
            || new RegExp(name + '\\s+(?:NOT\\s+)?IN\\s*\\((?:[^()]*,)?\\s*$', 'i').exec(before);
        if (m) return m[1];
        m = new RegExp('^\\s*' + op + '\\s*' + name, 'i').exec(after);
        return m && !KEYWORDS.includes(m[1].toUpperCase()) ? m[1] : null;
    }

    const SqlText = {
        selectColumns, comparedColumn,
        tokenize, highlightHtml, pretty, stripComments, limitApplies, applyLimit,
        normalise, place, prefersColumns, statementKind, splitStatements, lint,
        tone, cellTone, isPillColumn, KEYWORDS,
        formatStripComments, isChip, itemKindLabel, ITEM_KINDS, TOKEN_KINDS,
    };
    if (typeof module === 'object' && module.exports) module.exports = SqlText; else root.SqlText = SqlText;
})(this);
