/*
 * Tests for sql-text.js. Run from this folder: node sql-text.test.js
 *
 * The checks under the C# section names are ported from fb-api-tool's
 * selftest (Program.cs) so the two implementations stay answerable to the
 * same cases; the rest cover what the port adds.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', '..', 'main', 'web', 'sql-text.js');
const S = require(SOURCE);

let passed = 0;
let failed = 0;

function section(name) { console.log('\n=== ' + name + ' ==='); }

// A check passes when fn neither throws nor returns false.
function check(name, fn) {
    try {
        const ok = fn();
        if (ok === false) throw new Error('returned false');
        passed++;
        console.log('PASS  ' + name);
    } catch (e) {
        failed++;
        console.log('FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        '));
    }
}

const kinds = (toks, kind) => toks.filter(t => t.kind === kind).map(t => t.text.trim()).join('|');
const show = s => JSON.stringify(s);

// Lint helpers: the messages of one severity, and whether a message matches.
const lintOf = (sql, schema) => S.lint(sql, schema);
const msgs = (sql, schema, severity) =>
    lintOf(sql, schema).filter(i => !severity || i.severity === severity).map(i => i.message);
const has = (sql, re, schema) => msgs(sql, schema).some(m => re.test(m));
function none(sql, re, schema) {
    const found = msgs(sql, schema).filter(m => re.test(m));
    assert.deepStrictEqual(found, [], show(sql));
}

// ---------------------------------------------------------------------------
section('0. Source constraints (the file is inlined into a Fishbowl BI page)');

const source = fs.readFileSync(SOURCE, 'utf8');
check('never contains the {% directive marker', () => !source.includes('{' + '%'));
check('never has $ before an upper-case letter', () => {
    const m = source.match(/\$[A-Z]/);
    assert.strictEqual(m, null, m && source.slice(m.index - 30, m.index + 10));
});
check('no literal control characters but line breaks', () => {
    for (let i = 0; i < source.length; i++) {
        const n = source.charCodeAt(i);
        if (n < 32 && n !== 10 && n !== 13) assert.fail('control character ' + n + ' at ' + i);
    }
});
check('exports the agreed names', () => {
    for (const k of ['tokenize', 'highlightHtml', 'pretty', 'stripComments', 'limitApplies', 'applyLimit',
                     'normalise', 'place', 'prefersColumns', 'statementKind', 'splitStatements', 'lint',
                     'tone', 'cellTone', 'isPillColumn', 'KEYWORDS']) {
        assert.ok(k in S, k);
    }
});
check('loads as a browser global when there is no module', () => {
    const sandbox = {};
    new Function(source).call(sandbox);
    assert.strictEqual(typeof sandbox.SqlText.tokenize, 'function');
});

// ---------------------------------------------------------------------------
section('9c. SQL editor');

const pretty = S.pretty('select a,b from part p left join uom u on u.id=p.uomId where p.activeFlag=1 and a>0 order by a');
const plines = pretty.split('\n');
check('each clause starts a line', () => plines.length >= 5);
check('SELECT leads', () => /^select/i.test(plines[0]));
check('LEFT JOIN is kept whole, not split at JOIN',
      () => /\nleft join/i.test(pretty) && !/left \njoin/i.test(pretty));
check('ON gets its own line', () => plines.some(l => /^on/i.test(l.trimStart())));
check('AND is indented under its condition', () => plines.some(l => /^ {2}and/i.test(l)));
check('UNION ALL is kept whole', () => /union all/i.test(S.pretty('select 1 union all select 2')));
check('formatting twice changes nothing more', () => assert.strictEqual(S.pretty(pretty), pretty));
check('an empty query survives', () => assert.strictEqual(S.pretty('   '), ''));

// Squeezing a string literal would change what the query matches.
check('a line comment is dropped',
      () => assert.strictEqual(S.formatStripComments('SELECT 1 -- a note\nFROM part'), 'SELECT 1 FROM part'));
check('a comment marker inside a literal is left alone',
      () => assert.strictEqual(S.formatStripComments("SELECT '-- not a comment' FROM t"), "SELECT '-- not a comment' FROM t"));
check('spacing inside a literal is preserved',
      () => assert.strictEqual(S.formatStripComments("SELECT 'a   b'  FROM t"), "SELECT 'a   b' FROM t"));
check('a doubled quote inside a literal survives',
      () => assert.strictEqual(S.formatStripComments("SELECT 'it''s' FROM t"), "SELECT 'it''s' FROM t"));

// ---------------------------------------------------------------------------
section('9d. SQL syntax colouring');

const sample = "SELECT id -- a note\nFROM part WHERE num = 'A-1' AND qty > 12.5";
const toks = S.tokenize(sample);
check('every character survives tokenising', () => assert.strictEqual(toks.map(t => t.text).join(''), sample));
check('keywords are found', () => {
    const k = kinds(toks, 'keyword');
    return k.includes('SELECT') && k.includes('FROM') && k.includes('WHERE');
});
check('a table name is not a keyword', () => toks.some(t => t.text === 'part' && t.kind === 'plain'));
check('the literal is one token', () => assert.strictEqual(kinds(toks, 'string'), "'A-1'"));
check('the number is one token', () => assert.strictEqual(kinds(toks, 'number'), '12.5'));
check('the comment stops at the newline', () => assert.strictEqual(kinds(toks, 'comment'), '-- a note'));

const loose = S.tokenize("SELECT 'unterminated");
check('an unterminated literal does not hang',
      () => assert.strictEqual(loose.map(t => t.text).join(''), "SELECT 'unterminated"));
const blockC = S.tokenize('/* still typing');
check('an unterminated block comment does not hang', () => blockC.length === 1 && blockC[0].kind === 'comment');
check('empty input gives no tokens', () => S.tokenize('').length === 0);
check('keyword matching ignores case', () => {
    const t = S.tokenize('select');
    return t.length === 1 && t[0].kind === 'keyword';
});
check('a doubled quote does not end the literal',
      () => assert.deepStrictEqual(S.tokenize("'it''s'").filter(t => t.kind === 'string').map(t => t.text), ["'it''s'"]));

// ---------------------------------------------------------------------------
section('9e. SQL keyword casing and spacing');

const cased = S.pretty("select id from part where num = 'lower case string' and qty > 0");
check('reserved words are uppercased', () => cased.includes('SELECT') && cased.includes('FROM') && cased.includes('WHERE'));
check('identifiers keep their case', () => cased.includes('id') && cased.includes('part') && cased.includes('num'));
check('a keyword inside a string literal is untouched',
      () => S.pretty("SELECT * FROM t WHERE a = 'select from where'").includes("'select from where'"));
check('a keyword inside a comment is untouched',
      () => S.pretty('SELECT 1 -- select from where\nFROM t').includes('-- select from where'));
check('a comment keeps its own line, so it swallows nothing',
      () => S.pretty('SELECT 1 -- note\nFROM t').split('\n').some(l => l.trim() === '-- note'));

const spaced = S.pretty('select a , b ,count( * ) from t . u where ( a = 1 )');
check('no space before a comma', () => !spaced.includes(' ,'));
check('no space after an opening bracket', () => !spaced.includes('( '));
check('no space before a closing bracket', () => !spaced.includes(' )'));
check('a qualified name keeps no spaces around its dot', () => spaced.includes('t.u'));
check('LEFT OUTER JOIN is kept on one line',
      () => S.pretty('select 1 from a left outer join b on a.id=b.id').split('\n').some(l => l.trim().startsWith('LEFT OUTER JOIN')));
check('formatting is stable on a second pass', () => assert.strictEqual(S.pretty(cased), cased));

// ---------------------------------------------------------------------------
section('9f. Value tones');

check('a completed status reads positive', () => S.tone('Fulfilled') === 'positive' && S.tone('Shipped') === 'positive');
check('an in-flight status reads active', () => S.tone('Issued') === 'active' && S.tone('In Progress') === 'active');
check('a status wanting a human reads warning',
      () => S.tone('Pending Approval') === 'warning' && S.tone('Closed Short') === 'warning');
check('an undone status reads negative', () => S.tone('Voided') === 'negative' && S.tone('Cancelled') === 'negative');
check('a not-started status reads quiet', () => S.tone('Entered') === 'quiet');
check('booleans are classified', () => S.tone('true') === 'positive' && S.tone('false') === 'negative');
check('matching ignores case', () => S.tone('fulfilled') === 'positive');
check('null and blank read as empty',
      () => S.tone(null) === 'empty' && S.tone('') === 'empty' && S.tone('null') === 'empty');
check('an unknown value gets no chip',
      () => !S.isChip('WIDGET-A') && !S.isChip('Shipped goods to Acme') && !S.isChip('10042'));
check('a recognised value does', () => S.isChip('Fulfilled') && S.isChip('Voided'));

// ---------------------------------------------------------------------------
section('9i. Keyword completion');

check('the keyword list is shared with the highlighter',
      () => S.KEYWORDS.includes('SELECT') && S.KEYWORDS.includes('INNER'));
const se = S.KEYWORDS.filter(k => k.toUpperCase().startsWith('SE'));
check('a two-letter prefix narrows to a usable list', () => se.length > 0 && se.length < 8);
check('prefix matching ignores case', () => S.KEYWORDS.some(k => k.toLowerCase().startsWith('se')));

// ---------------------------------------------------------------------------
section('9r1. FROM-first statements, reordered to send');

const R = sql => { const r = S.normalise(sql); return r.problem === null ? r.sql : 'PROBLEM'; };
const eqR = (sql, want) => () => assert.strictEqual(R(sql), want);
check('the simplest case', eqR('from part select num', 'select num from part'));
check('a statement already in order is untouched', () => S.normalise('SELECT num FROM part').changed === false);
check('joins stay with the FROM, WHERE and ORDER come after',
      eqR('FROM part p JOIN uom u ON u.id = p.uomId SELECT p.num, u.code WHERE p.activeFlag = 1 ORDER BY p.num',
          'SELECT p.num, u.code FROM part p JOIN uom u ON u.id = p.uomId WHERE p.activeFlag = 1 ORDER BY p.num'));
check('a SELECT written last',
      eqR('FROM part WHERE activeFlag = 1 SELECT num', 'SELECT num FROM part WHERE activeFlag = 1'));
check('a join written after the SELECT goes back with the tables',
      eqR('FROM part p SELECT p.num, u.code LEFT JOIN uom u ON u.id = p.uomId',
          'SELECT p.num, u.code FROM part p LEFT JOIN uom u ON u.id = p.uomId'));
check('LEFT( in the SELECT list is a function, not a join',
      eqR('FROM part SELECT LEFT(num, 3) AS pre', 'SELECT LEFT(num, 3) AS pre FROM part'));
check('GROUP BY and a subquery in the SELECT list',
      eqR('FROM so s SELECT s.statusId, (SELECT COUNT(*) FROM soitem WHERE soId = s.id) n GROUP BY s.statusId',
          'SELECT s.statusId, (SELECT COUNT(*) FROM soitem WHERE soId = s.id) n FROM so s GROUP BY s.statusId'));
check('a keyword inside a string or comment decides nothing',
      eqR("FROM part -- then SELECT it\nSELECT num WHERE num <> 'SELECT x FROM y'",
          "SELECT num\nFROM part -- then SELECT it\nWHERE num <> 'SELECT x FROM y'"));
check('several lines stay on several lines',
      eqR('FROM part p\nJOIN uom u ON u.id = p.uomId\nSELECT p.num\nWHERE p.activeFlag = 1',
          'SELECT p.num\nFROM part p\nJOIN uom u ON u.id = p.uomId\nWHERE p.activeFlag = 1'));
check('a trailing semicolon is kept', eqR('FROM part SELECT num;', 'SELECT num FROM part;'));
check('UPDATE takes the tables straight after it',
      eqR("FROM part p UPDATE SET p.description = 'x' WHERE p.id = 1",
          "UPDATE part p SET p.description = 'x' WHERE p.id = 1"));
check('DELETE becomes DELETE FROM', eqR('FROM part DELETE WHERE id = 1', 'DELETE FROM part WHERE id = 1'));
check('with no SELECT, it says so rather than sending',
      () => (S.normalise('FROM part WHERE id = 1').problem || '').includes('no SELECT'));
check('a UNION has to be written SELECT-first',
      () => S.normalise('FROM part SELECT num UNION SELECT num FROM so').problem !== null);
check('and the row limit then applies to the reordered statement', () => S.limitApplies(R('from part select num')));
// Beyond the C# selftest.
check('the result has the agreed shape',
      () => assert.deepStrictEqual(S.normalise('SELECT 1'), { sql: 'SELECT 1', changed: false, problem: null }));
check('a FROM-first statement after another is reordered in place',
      eqR('SELECT 1; FROM part SELECT num', 'SELECT 1; SELECT num FROM part'));
check('an UPDATE without SET is a problem, not a rewrite',
      () => S.normalise('FROM part UPDATE WHERE id = 1').problem !== null);

// ---------------------------------------------------------------------------
section('9q2. Comments out before sending');

const commented = "-- PO 148 export\n\nSELECT num, -- the PO number\n  note\nFROM po\n  /* whole line */\nWHERE num = '148' -- last";
check('comment lines go, and a leading one most of all',
      () => assert.strictEqual(S.stripComments(commented), "SELECT num,\n  note\nFROM po\nWHERE num = '148'"));
check('a -- inside a string is data, and stays',
      () => assert.strictEqual(S.stripComments("SELECT '--x' AS a -- gone"), "SELECT '--x' AS a"));
check("a block comment between words doesn't join them",
      () => assert.strictEqual(S.stripComments('SELECT/**/num FROM part'), 'SELECT num FROM part'));
check("MySQL's /*! */ and /*+ */ are code, and stay",
      () => assert.strictEqual(S.stripComments('SELECT /*+ MAX_EXECUTION_TIME(1000) */ num FROM part'),
                               'SELECT /*+ MAX_EXECUTION_TIME(1000) */ num FROM part'));
check('a statement with no comments is untouched',
      () => assert.strictEqual(S.stripComments('SELECT num\n\nFROM part '), 'SELECT num\n\nFROM part '));
check("and the row limit then applies to what's left",
      () => S.limitApplies(S.stripComments(commented)) && !S.applyLimit(S.stripComments(commented), 100).includes('--'));
// Beyond the C# selftest.
check('the /*! form stays too',
      () => assert.strictEqual(S.stripComments('SELECT /*!40001 SQL_NO_CACHE */ num FROM part'),
                               'SELECT /*!40001 SQL_NO_CACHE */ num FROM part'));
check('CRLF line endings come back as LF once a comment is taken out',
      () => assert.strictEqual(S.stripComments('SELECT 1 -- x\r\nFROM t'), 'SELECT 1\nFROM t'));

// ---------------------------------------------------------------------------
section('9r2. Where the caret is');

check('an empty statement is the start', () => S.place('') === 'start');
check('after SELECT comes a column list', () => S.place('SELECT ') === 'selectlist');
check('straight after FROM comes a table',
      () => S.place('SELECT a FROM ') === 'tablename' && S.place('SELECT a FROM so') === 'tablename');
check('past the table name it is no longer a table', () => S.place('SELECT a FROM soitem ') === 'unknown');
check('after JOIN comes a table too', () => S.place('SELECT a FROM x JOIN ') === 'tablename');
check('WHERE and ON are conditions',
      () => S.place('SELECT a FROM x WHERE ') === 'condition' && S.place('SELECT a FROM x JOIN y ON ') === 'condition');
check('ORDER BY is a column list', () => S.place('SELECT a FROM x ORDER BY ') === 'columnlist');
check('a semicolon starts over', () => S.place('SELECT 1 FROM x; ') === 'start');
check('columns are preferred where they belong',
      () => S.prefersColumns('selectlist') && S.prefersColumns('condition') && !S.prefersColumns('start'));
// Beyond the C# selftest.
check('GROUP  BY across spaces is a column list', () => S.place('SELECT a FROM x GROUP  BY ') === 'columnlist');
check('null is the start', () => S.place(null) === 'start');
// .NET's end anchor also matches before one final newline, and the C# reads
// "FROM so" followed by a line break as still naming the table. Kept as is.
check('a table name followed by one newline still reads as the table (as in C#)',
      () => S.place('SELECT a FROM so\n') === 'tablename' && S.place('SELECT a FROM so\n\n') === 'unknown');
check('completion kinds have their short labels',
      () => S.itemKindLabel('keyword') === 'kw' && S.itemKindLabel('table') === 'tbl' &&
            S.itemKindLabel('view') === 'view' && S.itemKindLabel('column') === 'col' &&
            S.itemKindLabel('variable') === 'var' && S.itemKindLabel('join') === 'join');

// ---------------------------------------------------------------------------
section('Lexer contract (port)');

check('every token carries its offset', () => {
    for (const t of toks) assert.strictEqual(sample.slice(t.start, t.start + t.text.length), t.text);
});
check('token kinds are the C# enum names, lower case',
      () => assert.deepStrictEqual(S.TOKEN_KINDS, ['plain', 'keyword', 'string', 'number', 'comment']));
check('a double-quoted literal is one string token',
      () => assert.strictEqual(kinds(S.tokenize('SELECT "%e%"'), 'string'), '"%e%"'));
check('a backticked name is one plain token', () => {
    const t = S.tokenize('SELECT `my col` FROM t').find(x => x.text.startsWith('`'));
    return t.text === '`my col`' && t.kind === 'plain';
});
check('a backslash-escaped quote does not end the literal',
      () => assert.strictEqual(kinds(S.tokenize("SELECT 'it\\'s' FROM t"), 'string'), "'it\\'s'"));
check('an accented identifier is one word',
      () => S.tokenize('SELECT désignation FROM t').some(t => t.text === 'désignation'));
check('tokenising never drops a character of awkward input', () => {
    const awkward = "x'' \"\" `` /**/ -- \n /* -- */ 'a\\' 1.2.3 ;; ((";
    assert.strictEqual(S.tokenize(awkward).map(t => t.text).join(''), awkward);
});

// ---------------------------------------------------------------------------
section('highlightHtml');

const unescape = h => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
check('wraps each coloured token in its kind',
      () => assert.strictEqual(S.highlightHtml("SELECT 'a' -- c"),
                               '<span class="tk-keyword">SELECT</span> <span class="tk-string">&#39;a&#39;</span> <span class="tk-comment">-- c</span>'));
check('reproduces the text character for character', () => {
    const sql = "SELECT a<b, \"x&y\" FROM t -- <script>\nWHERE n > 1.5";
    assert.strictEqual(unescape(S.highlightHtml(sql)), sql);
});
check('markup in the SQL is escaped, never live', () => !S.highlightHtml("SELECT '<b>'").includes('<b>'));
check('plain text is left unwrapped', () => assert.strictEqual(S.highlightHtml('part'), 'part'));

// ---------------------------------------------------------------------------
section('Pretty (port details)');

check('a backticked name with a comma inside is not broken',
      () => S.pretty('select `a,b`, c from t').includes('`a,b`'));
check('COUNT binds to its bracket, WHERE keeps the space', () => {
    const p = S.pretty('select count(*) from t where (a=1)');
    return p.includes('COUNT(*)') && p.includes('WHERE (a = 1)');
});
check('a single-item SELECT stays on one line', () => S.pretty('select * from t').split('\n')[0] === 'SELECT *');

// ---------------------------------------------------------------------------
section('SqlLimit');

check('a plain SELECT takes a limit', () => S.limitApplies('SELECT num FROM part'));
check('a limit of its own wins', () => !S.limitApplies('SELECT num FROM part LIMIT 5'));
check('LIMIT inside a comment or literal decides nothing',
      () => S.limitApplies("SELECT 'LIMIT' FROM t -- LIMIT 3"));
check('WITH is left alone', () => !S.limitApplies('WITH a AS (SELECT 1) SELECT * FROM a'));
check('a leading bracket is left alone', () => !S.limitApplies('(SELECT 1)'));
check('an UPDATE is left alone', () => !S.limitApplies('UPDATE t SET a = 1'));
check('two statements are left alone', () => !S.limitApplies('SELECT 1; SELECT 2'));
check('two statements are left alone even with a trailing semicolon',
      () => !S.limitApplies('SELECT 1; SELECT 2;'));
check('a trailing semicolon is fine', () => S.limitApplies('SELECT 1 ;'));
check('a semicolon in a backticked name is not a second statement',
      () => S.limitApplies('SELECT `a;b` FROM t'));
check('the limit replaces a trailing semicolon',
      () => assert.strictEqual(S.applyLimit('SELECT 1 ; ; ', 100), 'SELECT 1 LIMIT 100'));
check('empty input takes no limit', () => !S.limitApplies('  ') && !S.limitApplies(null));

// ---------------------------------------------------------------------------
section('CellStyle');

check('a boolean is coloured in any column',
      () => S.cellTone('description', 'true') === 'positive' && S.cellTone('x', 'No') === 'negative');
check('a flag column reads 1 and 0',
      () => S.cellTone('activeFlag', '1') === 'positive' && S.cellTone('ACTIVEFLAG', '0') === 'negative');
check('a bare 1 elsewhere is a number', () => S.cellTone('qty', '1') === 'none');
check('a status word only in a status column',
      () => S.cellTone('status', 'Open') === 'active' && S.cellTone('description', 'Open') === 'none');
check('a status id is left a number',
      () => S.cellTone('statusId', '20') === 'none' && S.cellTone('status', '1,000.5') === 'none');
check('an unknown word in a state column gets a neutral pill', () => S.cellTone('state', 'Wibble') === 'active');
check('a known word in a status column keeps its tone', () => S.cellTone('soStatus', 'Voided') === 'negative');
check('blank is nothing', () => S.cellTone('status', '  ') === 'none' && S.cellTone('status', null) === 'none');
check('values that are not strings are read as text',
      () => S.cellTone('flag', 1) === 'positive' && S.cellTone('x', true) === 'positive');
check('a column of known states is a pill column',
      () => S.isPillColumn('status', ['Issued', 'Fulfilled', '', null, 'issued']));
check('one plain value keeps the whole column as text',
      () => !S.isPillColumn('description', ['true', 'Widget']));
check('too many distinct values is prose', () => {
    const many = Array.from({ length: 13 }, (_, i) => 'State' + i);
    return !S.isPillColumn('status', many) && S.isPillColumn('status', many.slice(0, 12)) &&
           S.isPillColumn('status', many, 13);
});
check('an all-blank column is not a pill column', () => !S.isPillColumn('status', ['', null, ' ']));

// ---------------------------------------------------------------------------
section('statementKind');

check('select', () => S.statementKind('SELECT 1') === 'select');
check('select after comments and whitespace', () => S.statementKind('-- note\n /* x */  select 1') === 'select');
check('a leading bracket before SELECT is a select', () => S.statementKind('((SELECT 1) UNION (SELECT 2))') === 'select');
check('a leading bracket before anything else is other', () => S.statementKind('(UPDATE t SET a = 1)') === 'other');
check('insert, update, delete, with', () =>
    S.statementKind('insert into t values (1)') === 'insert' &&
    S.statementKind('Update t set a = 1') === 'update' &&
    S.statementKind('DELETE FROM t') === 'delete' &&
    S.statementKind('WITH a AS (SELECT 1) SELECT * FROM a') === 'with');
check('show, describe, desc and explain are other', () =>
    ['SHOW TABLES', 'DESCRIBE part', 'DESC part', 'EXPLAIN SELECT 1'].every(s => S.statementKind(s) === 'other'));
check('empty for nothing but whitespace or comments', () =>
    S.statementKind('') === 'empty' && S.statementKind('  \n') === 'empty' &&
    S.statementKind('-- only a note') === 'empty' && S.statementKind(null) === 'empty');
check('a keyword in a string or a word that merely starts like one decides nothing', () =>
    S.statementKind("'SELECT'") === 'other' && S.statementKind('selected FROM t') === 'other');
check('a FROM-first statement is other (normalise reorders it)', () => S.statementKind('FROM part SELECT num') === 'other');
check('the first statement decides', () => S.statementKind('SELECT 1; DELETE FROM t') === 'select');

// ---------------------------------------------------------------------------
section('splitStatements');

check('splits on semicolons', () => {
    const sql = 'SELECT 1; SELECT 2';
    assert.deepStrictEqual(S.splitStatements(sql), [
        { text: 'SELECT 1', start: 0, end: 8 },
        { text: 'SELECT 2', start: 9, end: sql.length },
    ]);
});
check('offsets are the untrimmed span', () => {
    const sql = '  SELECT 1 ;\n\n  SELECT 2  ';
    const parts = S.splitStatements(sql);
    assert.strictEqual(parts.length, 2);
    assert.strictEqual(sql.slice(parts[0].start, parts[0].end), '  SELECT 1 ');
    assert.strictEqual(sql.slice(parts[1].start, parts[1].end), '\n\n  SELECT 2  ');
    assert.strictEqual(parts[1].text, 'SELECT 2');
});
check('a semicolon in a string, comment or backticks does not split', () => {
    const sql = "SELECT ';', \";\", `a;b` FROM t -- x; y\n/* ; */ WHERE 1";
    const parts = S.splitStatements(sql);
    return parts.length === 1 && parts[0].text === sql;
});
check('empty statements are dropped', () =>
    S.splitStatements(';; SELECT 1 ;  ; ').map(p => p.text).join('|') === 'SELECT 1');
check('a statement of nothing but a comment is dropped', () =>
    S.splitStatements('SELECT 1; -- done').length === 1);
check('nothing gives nothing', () => S.splitStatements('').length === 0 && S.splitStatements(null).length === 0);
check('the statement under a caret can be found by its span', () => {
    const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3';
    const caret = sql.indexOf('2');
    const under = S.splitStatements(sql).find(p => caret >= p.start && caret <= p.end);
    return under.text === 'SELECT 2';
});

// ---------------------------------------------------------------------------
section('lint: clean statements');

check('a clean SELECT gives nothing', () => assert.deepStrictEqual(S.lint('SELECT num, description FROM part WHERE id = 1'), []));
check('empty gives nothing', () => assert.deepStrictEqual(S.lint(''), []) || true);
check('a big clean query gives nothing', () => assert.deepStrictEqual(S.lint(
    "SELECT so.num, c.name AS customer, COUNT(*) n, SUM(si.totalPrice) total,\n" +
    "       CASE WHEN so.statusId = 20 THEN 'Issued' ELSE 'Other' END state\n" +
    "FROM so JOIN customer c ON c.id = so.customerId\n" +
    "LEFT JOIN soitem si ON si.soId = so.id\n" +
    "WHERE so.dateIssued >= '2026-01-01' AND EXTRACT(YEAR FROM so.dateIssued) = 2026\n" +
    "GROUP BY so.num, c.name ORDER BY total DESC LIMIT 50"), []));
check('every issue has the agreed shape', () => {
    for (const i of S.lint("DELETE FROM t; SELECT 'x")) {
        assert.ok(['error', 'warning', 'info'].includes(i.severity));
        assert.strictEqual(typeof i.message, 'string');
        assert.ok(Number.isInteger(i.start) && Number.isInteger(i.end) && i.end >= i.start);
    }
});

// ---------------------------------------------------------------------------
section('lint 1: unterminated string, backtick, block comment');

check('an unterminated string is an error, from its quote to the end', () => {
    const sql = "SELECT 'abc FROM t";
    const e = S.lint(sql).find(i => /string is never closed/.test(i.message));
    return e.severity === 'error' && e.start === sql.indexOf("'") && e.end === sql.length;
});
check('an unterminated backtick is an error', () => has('SELECT `num FROM t', /backticked name is never closed/));
check('an unterminated block comment is an error', () => has('SELECT 1 /* note', /block comment is never closed/));
check("a string ending in a doubled quote is still open", () => has("SELECT 'abc''", /string is never closed/));
check('an unterminated double-quoted string is an error', () => has('SELECT "abc', /string is never closed/));
check('not inside a comment: an apostrophe there is prose',
      () => none("SELECT 1 -- it's fine\nFROM t /* don't */", /never closed/));
check('not inside a string: an apostrophe in "..." or a /* in a literal',
      () => none("SELECT \"it's\", '/* x', 'it\\'s' FROM t", /never closed/));
check('an unclosed string swallows the rest, so brackets are not counted too', () => {
    const m = msgs("SELECT COUNT( 'x FROM t");
    assert.deepStrictEqual(m, ['This string is never closed.']);
});

// ---------------------------------------------------------------------------
section('lint 2: unbalanced brackets');

check('an unclosed bracket is an error at the bracket', () => {
    const sql = 'SELECT COUNT(* FROM t';
    const e = S.lint(sql).find(i => /never closed/.test(i.message));
    return e.severity === 'error' && e.start === sql.indexOf('(') && e.end === e.start + 1;
});
check('a stray closing bracket is an error', () => has('SELECT a) FROM t', /closing bracket has no opening one/));
check('nested ones are counted properly', () =>
    has('SELECT ((a) FROM t', /bracket is never closed/) && none('SELECT ((a)) FROM t', /bracket/) === undefined);
check('not for brackets inside strings, comments or backticks',
      () => none("SELECT ')', '(', `a(b` FROM t -- (\n/* ) */", /bracket/));

// ---------------------------------------------------------------------------
section('lint 3: leading WITH');

const WITH_RX = /^Fishbowl only runs statements that start with SELECT\. Wrap it: SELECT \* FROM \(WITH … SELECT …\) AS t$/;
check('a leading WITH is an error with the wrapping advice', () => {
    const e = S.lint('WITH a AS (SELECT 1 x) SELECT x FROM a').find(i => WITH_RX.test(i.message));
    return e.severity === 'error' && e.start === 0 && e.end === 4;
});
check('after comments too', () => has('-- why\n/* x */ with recursive r AS (SELECT 1) SELECT * FROM r', WITH_RX));
check('in a second statement too', () => has('SELECT 1; WITH a AS (SELECT 1) SELECT * FROM a', WITH_RX));
check('not the wrapped form', () => none('SELECT * FROM (WITH c AS (SELECT 1 a) SELECT a FROM c) AS t', WITH_RX));
check('not inside a string or comment', () => none("-- WITH x\nSELECT 'WITH a AS' FROM t", WITH_RX));

// ---------------------------------------------------------------------------
section('lint 4: DELETE');

check('DELETE is an error', () => {
    const e = S.lint('DELETE FROM part WHERE id = 1').find(i => i.message === 'DELETE statements are not supported.');
    return e.severity === 'error' && e.start === 0 && e.end === 6;
});
check('a FROM-first DELETE too', () => has('FROM part DELETE WHERE id = 1', /^DELETE statements are not supported\.$/));
check('lower case and after a comment', () => has('/* tidy */ delete p FROM part p', /^DELETE statements/));
check('not inside a string or comment, nor a word that starts like it',
      () => none("/* DELETE */ SELECT 'DELETE FROM t', deleted FROM t -- DELETE", /DELETE/));

// ---------------------------------------------------------------------------
section('lint 5: UPDATE with no WHERE');

const NO_WHERE = /^This UPDATE has no WHERE clause: it changes every row in the table\.$/;
check('UPDATE with no WHERE is a warning at UPDATE', () => {
    const w = S.lint("UPDATE part SET description = 'x'").find(i => NO_WHERE.test(i.message));
    return w.severity === 'warning' && w.start === 0 && w.end === 6;
});
check('a WHERE only in a subquery does not count',
      () => has('UPDATE part SET qty = (SELECT 1 FROM t WHERE x = 1)', NO_WHERE));
check('a WHERE only in a string or comment does not count',
      () => has("UPDATE part SET note = 'WHERE id = 1' -- WHERE", NO_WHERE));
check('a FROM-first UPDATE is read by its verb', () => has("FROM part UPDATE SET description = 'x'", NO_WHERE));
check('not when there is a WHERE', () => none("UPDATE part SET description = 'x' WHERE id = 1", NO_WHERE));
check('not for an UPDATE inside a string or comment',
      () => none("SELECT 'UPDATE t SET a = 1' FROM t -- UPDATE t SET a = 1", NO_WHERE));
check('not for ON DUPLICATE KEY UPDATE',
      () => none('INSERT INTO t (a) VALUES (1) ON DUPLICATE KEY UPDATE a = 2', NO_WHERE));

// ---------------------------------------------------------------------------
section('lint 6: trailing comma');

check('before FROM, at the comma', () => {
    const sql = 'SELECT a, b, FROM t';
    const e = S.lint(sql).find(i => i.message === 'Trailing comma before FROM.');
    return e.severity === 'error' && e.start === sql.lastIndexOf(',') && e.end === e.start + 1;
});
check('before WHERE, GROUP BY, ORDER BY, LIMIT', () =>
    has('UPDATE t SET a = 1, WHERE id = 1', /^Trailing comma before WHERE\.$/) &&
    has('SELECT a FROM t GROUP BY a, ORDER BY a', /^Trailing comma before ORDER BY\.$/) &&
    has('SELECT a, GROUP BY a', /^Trailing comma before GROUP BY\.$/) &&
    has('SELECT a FROM t ORDER BY a, LIMIT 5', /^Trailing comma before LIMIT\.$/));
check('before a closing bracket', () => has('SELECT COALESCE(a, ) FROM t', /^Trailing comma before the closing bracket\.$/));
check('a comment between them does not hide it', () => has('SELECT a, -- last\nFROM t', /Trailing comma before FROM/));
check('not inside a string or comment', () => none("SELECT 'a, FROM b', c /* , FROM */ FROM t -- ,)", /Trailing comma/));
check('not for a backticked `from` column', () => none('SELECT a, `from` FROM t', /Trailing comma/));

// ---------------------------------------------------------------------------
section('lint 7: two columns with the same name');

const DUP = /^Two columns are named (\w+); give one an alias, or only one will be shown\.$/;
check('t.col and u.col clash, flagged on the second', () => {
    const sql = 'SELECT p.num, pr.num FROM part p JOIN product pr ON pr.partId = p.id';
    const w = S.lint(sql).find(i => DUP.test(i.message));
    return w.severity === 'warning' && w.message.includes('named num;') &&
           w.start === sql.indexOf('pr.num') && w.end === sql.indexOf('pr.num') + 6;
});
check('aliases clash case-insensitively', () => has('SELECT a AS Total, b total, c AS `TOTAL` FROM t', DUP) &&
    msgs('SELECT a AS Total, b total, c AS `TOTAL` FROM t').filter(m => DUP.test(m)).length === 2);
check('an alias against a column, and after a bracket or CASE ... END', () =>
    has('SELECT id, COUNT(*) id FROM t', DUP) &&
    has("SELECT CASE WHEN a THEN 1 END x, x FROM t", DUP) &&
    has('SELECT DISTINCT num, num FROM part', DUP));
check('an alias settles it', () => none('SELECT p.num, pr.num AS productNum FROM part p, product pr', DUP));
check('star and unnamed expressions are skipped',
      () => none('SELECT *, t.*, COUNT(*), COUNT(*), a + 1, a + 1, a DIV b, c DIV b FROM t', DUP));
check('not inside a string or comment', () => none("SELECT num, 'num' -- , num\nFROM t /* num, num */", DUP));
check('not across a UNION or into a subquery',
      () => none('SELECT num, (SELECT num FROM x LIMIT 1) other FROM t UNION SELECT num, num FROM u', DUP));

// ---------------------------------------------------------------------------
section('lint 8: unknown tables and columns (with a schema)');

const TABLES = {
    part: ['id', 'num', 'description', 'uomId', 'activeFlag'],
    product: ['id', 'partId', 'num', 'price'],
    uom: ['id', 'code'],
    so: ['id', 'num', 'statusId', 'date'],
    nocols: [],
};
const schema = {
    hasTable: name => Object.prototype.hasOwnProperty.call(TABLES, String(name).toLowerCase()),
    columns: name => TABLES[String(name).toLowerCase()] || [],
};

check('an unknown table is a warning at its name', () => {
    const sql = 'SELECT * FROM parts p';
    const w = S.lint(sql, schema).find(i => i.message === 'Unknown table parts.');
    return w.severity === 'warning' && w.start === 14 && w.end === 19;
});
check('after JOIN, UPDATE and INSERT ... INTO, and in a FROM list', () =>
    has('SELECT 1 FROM part p JOIN nosuch n ON n.id = p.id', /^Unknown table nosuch\.$/, schema) &&
    has('UPDATE ghost SET a = 1 WHERE id = 1', /^Unknown table ghost\.$/, schema) &&
    has('INSERT INTO ghost (a) VALUES (1)', /^Unknown table ghost\.$/, schema) &&
    has('SELECT 1 FROM part, ghost g', /^Unknown table ghost\.$/, schema));
check('known tables pass, whatever their case', () => none('SELECT * FROM PART p JOIN Uom u ON u.id = p.uomId', /Unknown/, schema));
check('derived tables, CTEs, DUAL and schema-qualified names are skipped', () => none(
    'SELECT * FROM (SELECT 1 a) d, information_schema.tables it, otherdb.part x, `odd.name` y, dual ' +
    'JOIN (WITH c AS (SELECT 1) SELECT * FROM c) w ON 1 = 1', /Unknown/, schema));
check('a FROM inside EXTRACT or TRIM is not a table',
      () => none("SELECT EXTRACT(YEAR FROM dateIssued), TRIM('x' FROM num) FROM so", /Unknown/, schema));
check('a column the table lacks is a warning at the column', () => {
    const sql = 'SELECT p.nmu FROM part p';
    const w = S.lint(sql, schema).find(i => i.message === 'part has no column nmu.');
    return w.severity === 'warning' && w.start === 9 && w.end === 12;
});
check('through the table name too, and in WHERE and ON',
      () => has('SELECT 1 FROM part WHERE part.colour = 1', /^part has no column colour\.$/, schema) &&
            has('SELECT 1 FROM part p JOIN uom u ON u.idd = p.uomId', /^uom has no column idd\.$/, schema));
check('a column named like a keyword is read as a column',
      () => none('SELECT s.date FROM so s', /no column/, schema) && has('SELECT s.year FROM so s', /so has no column year/, schema));
check('unqualified columns are never flagged', () => none('SELECT nosuchcolumn FROM part', /no column/, schema));
check('an alias that means two tables is not checked',
      () => none('SELECT p.price FROM part p WHERE EXISTS (SELECT 1 FROM product p WHERE p.price > 0)', /no column/, schema));
check('an alias of a derived table or unknown table is not checked', () =>
    none('SELECT d.anything, g.whatever FROM (SELECT 1) d, ghost g', /no column/, schema) &&
    none('SELECT x.zzz FROM otherdb.part x', /no column/, schema));
check('a table the schema has no columns for is not checked', () => none('SELECT n.zzz FROM nocols n', /no column/, schema));
check('not inside a string or comment', () =>
    none("SELECT 'FROM ghost', p.num FROM part p -- JOIN ghost g\n/* p.nope */ WHERE p.num = 'p.nope'", /Unknown|no column/, schema));
check('nothing without a schema', () => none('SELECT g.x FROM ghost g', /Unknown|no column/));
check('a schema that throws raises no alarm', () =>
    none('SELECT g.x FROM ghost g', /Unknown|no column/, { hasTable() { throw new Error('x'); }, columns() { throw new Error('y'); } }));

// ---------------------------------------------------------------------------
section('lint 9: more than one statement');

check('two statements are reported as info at the first semicolon', () => {
    const sql = 'SELECT 1; SELECT 2';
    const i = S.lint(sql).find(x => x.severity === 'info');
    return i.message === '2 statements: Run executes the one under the caret.' && i.start === 8 && i.end === 9;
});
check('and three as three', () => has('SELECT 1; SELECT 2;\nSELECT 3;', /^3 statements: /));
check('a trailing semicolon or comment is not a second statement',
      () => none('SELECT 1;', /statements/) === undefined && none('SELECT 1; -- done', /statements/) === undefined);
check('not for a semicolon in a string or comment',
      () => none("SELECT ';' FROM t -- ; SELECT 2\n/* ; */", /statements/));
check('each statement is linted on its own',
      () => has('SELECT 1; DELETE FROM t', /^DELETE statements/) && has('SELECT a, FROM t; SELECT 2', /Trailing comma/));

// ---------------------------------------------------------------------------
section('selectColumns: the SELECT list, in the order written');
const cols = sql => JSON.stringify(S.selectColumns(sql).map(i => (i.star != null ? { star: i.star } : { name: i.name })));
check('plain columns, in order', () => cols('SELECT id, num FROM part') === '[{"name":"id"},{"name":"num"}]');
check('a qualified column is named by its column', () => cols('SELECT so.num, c.name FROM so') === '[{"name":"num"},{"name":"name"}]');
check('AS and bare aliases', () => cols("SELECT c.name Customer, COUNT(*) AS n, 'x' AS \"Quoted Name\" FROM c")
    === '[{"name":"Customer"},{"name":"n"},{"name":"Quoted Name"}]');
check('backticked names lose their backticks', () => cols('SELECT `x y`, t.`a b` FROM t') === '[{"name":"x y"},{"name":"a b"}]');
check('* and t.* are stars', () => cols('SELECT p.*, * FROM part p') === '[{"star":"p"},{"star":""}]');
check('an expression is named by its text', () => cols('SELECT a + b, CASE WHEN a THEN 1 ELSE 0 END FROM t')
    === '[{"name":"a + b"},{"name":"CASE WHEN a THEN 1 ELSE 0 END"}]');
check('commas in brackets and strings don\'t split', () => cols("SELECT f(a, b), 'x,y' AS s, (SELECT MAX(id) FROM so) AS mx FROM t")
    === '[{"name":"f(a, b)"},{"name":"s"},{"name":"mx"}]');
check('DISTINCT and other modifiers are not a column', () => cols('SELECT DISTINCT SQL_NO_CACHE num FROM part') === '[{"name":"num"}]');
check('a trailing keyword is not taken for an alias', () => cols('SELECT INTERVAL 1 DAY FROM t').includes('INTERVAL 1 DAY'));
check('a statement without a SELECT list gives nothing', () => cols('UPDATE t SET a = 1') === '[]' && cols('') === '[]');
const src = sql => S.selectColumns(sql).map(i => (i.qualifier || '') + '.' + (i.column || '')).join(' ');
check('a plain column says where it comes from', () => src('SELECT p.num, description, c.name AS customer, s.num soNum FROM t')
    === 'p.num .description c.name s.num');
check('an expression comes from nowhere', () => src('SELECT COUNT(*) AS n, a + b FROM t') === '. .');

// ---------------------------------------------------------------------------
section('comparedColumn: what a parameter is compared with');
// V marks the value; the column is read from around it.
const cmp = sql => { const at = sql.indexOf('V'); return S.comparedColumn(sql.replace('V', 'X'), at, at + 1); };
check('= after a column', () => cmp('SELECT * FROM part WHERE num = V') === 'num');
check('a qualified column is named by its column', () => cmp('WHERE p.num=V') === 'num' && cmp('WHERE `p`.`id` = V') === 'id');
check('<>, LIKE and NOT LIKE', () => cmp('WHERE num <> V') === 'num' && cmp('WHERE num LIKE V') === 'num' && cmp('WHERE num NOT LIKE V') === 'num');
check('quotes around the value are looked through', () => cmp("WHERE num = 'V'") === 'num');
check('IN, first or later in the list', () => cmp('WHERE p.id IN (V)') === 'id' && cmp("WHERE num IN ('A', V, 'B')") === 'num');
check('the value first', () => cmp('WHERE V = p.num') === 'num');
check('nothing to compare with', () => cmp('SELECT V FROM t') === null && cmp('LIMIT V') === null);

// ---------------------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' checks');
process.exitCode = failed ? 1 : 0;
