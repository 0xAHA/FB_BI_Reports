/*
 * fb-report: the Report Builder's runtime.
 *
 * A builder report's page holds only its spec (JSON). Every time the report
 * runs, this compiles the spec against the fb-model catalog into SQL, runs it,
 * and shapes the rows into groups and totals. Pure parts (Dates, Expr, Sql,
 * Agg) run in Node too, so tools/report-builder tests them.
 *
 *   FBReport.Dates.resolve(value, ctx)     date presets -> { from, to } (inclusive)
 *   FBReport.Expr.parse(text)              the formula language -> AST
 *   FBReport.Sql.compile(spec, cat, ctx)   spec -> plan { queries, levels, columns, ... }
 *   FBReport.Agg.shape(plan, results)      query rows -> { groups, grand, rows }
 *
 * Totals are always exact: they come from SQL (GROUP BY ... WITH ROLLUP), never
 * from adding up the rows on screen. Formula measures (Margin %) are worked
 * out again at every level from that level's own figures.
 */
(function (global) {
    'use strict';

    const BUILD = '2026.10.15-c7fd0a0';   // @fb-build
    const SPEC_VERSION = 1;

    // ================================================================ helpers
    class ReportError extends Error {
        constructor(code, message, ref) {
            super(message);
            this.code = code;
            this.ref = ref || null;
        }
    }

    const NUMERIC = { number: 1, int: 1, money: 1, qty: 1, percent: 1 };
    const isNumeric = t => !!NUMERIC[t];

    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    // ================================================================ Dates
    // Calendar arithmetic on 'YYYY-MM-DD' strings, in UTC so no time zone shifts a day.
    const Dates = {
        parse(s) {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
            return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
        },
        fmt(d) {
            return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
        },
        addDays(s, n) {
            const d = Dates.parse(s);
            d.setUTCDate(d.getUTCDate() + n);
            return Dates.fmt(d);
        },
        ymd(y, m, d) {
            return Dates.fmt(new Date(Date.UTC(y, m - 1, d)));
        },
        lastOfMonth(y, m) {
            return Dates.fmt(new Date(Date.UTC(y, m, 0)));
        },
        /** The presets the builder offers, in order. */
        PRESETS: [
            ['today', 'Today'], ['yesterday', 'Yesterday'],
            ['this_week', 'This week'], ['last_week', 'Last week'],
            ['this_month', 'This month'], ['last_month', 'Last month'],
            ['this_quarter', 'This quarter'], ['last_quarter', 'Last quarter'],
            ['current_fy', 'This financial year'], ['last_fy', 'Last financial year'], ['fy_to_date', 'Financial year to date'],
            ['this_year', 'This calendar year'], ['last_year', 'Last calendar year'], ['year_to_date', 'Year to date'],
            ['last_7', 'Last 7 days'], ['last_30', 'Last 30 days'], ['last_90', 'Last 90 days'], ['last_365', 'Last 365 days']
        ],
        /**
         * A filter's date value -> { from, to }, both inclusive 'YYYY-MM-DD'.
         * value: { preset } | { from, to } | 'YYYY-MM-DD'. ctx: { today, fyStart (1-12) }.
         */
        resolve(value, ctx) {
            const today = (ctx && ctx.today) || Dates.fmt(new Date());
            const fyStart = Math.min(12, Math.max(1, parseInt((ctx && ctx.fyStart) || 7, 10) || 7));
            if (typeof value === 'string') {
                return Dates.parse(value) ? { from: value.slice(0, 10), to: value.slice(0, 10) } : null;
            }
            if (!value || typeof value !== 'object') {
                return null;
            }
            if (!value.preset) {
                const from = value.from && Dates.parse(value.from) ? String(value.from).slice(0, 10) : null;
                const to = value.to && Dates.parse(value.to) ? String(value.to).slice(0, 10) : null;
                return from || to ? { from, to } : null;
            }
            const t = Dates.parse(today);
            const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
            const dow = (t.getUTCDay() + 6) % 7;   // Monday 0
            const q = Math.floor((m - 1) / 3);
            const fyFirstYear = m >= fyStart ? y : y - 1;   // the calendar year the current FY starts in
            const fy = back => {
                const sy = fyFirstYear - back;
                const from = Dates.ymd(sy, fyStart, 1);
                const end = fyStart === 1 ? Dates.ymd(sy, 12, 31) : Dates.lastOfMonth(sy + 1, fyStart - 1);
                return { from, to: end };
            };
            switch (value.preset) {
                case 'today': return { from: today, to: today };
                case 'yesterday': { const d = Dates.addDays(today, -1); return { from: d, to: d }; }
                case 'this_week': { const s = Dates.addDays(today, -dow); return { from: s, to: Dates.addDays(s, 6) }; }
                case 'last_week': { const s = Dates.addDays(today, -dow - 7); return { from: s, to: Dates.addDays(s, 6) }; }
                case 'this_month': return { from: Dates.ymd(y, m, 1), to: Dates.lastOfMonth(y, m) };
                case 'last_month': { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return { from: Dates.ymd(py, pm, 1), to: Dates.lastOfMonth(py, pm) }; }
                case 'this_quarter': return { from: Dates.ymd(y, q * 3 + 1, 1), to: Dates.lastOfMonth(y, q * 3 + 3) };
                case 'last_quarter': { const pq = q === 0 ? 3 : q - 1, py = q === 0 ? y - 1 : y; return { from: Dates.ymd(py, pq * 3 + 1, 1), to: Dates.lastOfMonth(py, pq * 3 + 3) }; }
                case 'current_fy': return fy(0);
                case 'last_fy': return fy(1);
                case 'fy_to_date': return { from: fy(0).from, to: today };
                case 'this_year': return { from: Dates.ymd(y, 1, 1), to: Dates.ymd(y, 12, 31) };
                case 'last_year': return { from: Dates.ymd(y - 1, 1, 1), to: Dates.ymd(y - 1, 12, 31) };
                case 'year_to_date': return { from: Dates.ymd(y, 1, 1), to: today };
                case 'last_7': return { from: Dates.addDays(today, -6), to: today };
                case 'last_30': return { from: Dates.addDays(today, -29), to: today };
                case 'last_90': return { from: Dates.addDays(today, -89), to: today };
                case 'last_365': return { from: Dates.addDays(today, -364), to: today };
                default: return null;
            }
        }
    };

    // ================================================================ SQL literals
    // Every value from a spec reaches SQL through these, and only these.
    const Lit = {
        str(v) {
            // Control characters are dropped (Fishbowl strips them anyway); quotes doubled; backslashes escaped.
            const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '');
            return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
        },
        num(v) {
            const n = typeof v === 'number' ? v : Number(String(v).trim());
            if (v === '' || v == null || !isFinite(n)) {
                throw new ReportError('badNumber', '"' + v + '" is not a number.');
            }
            return String(n);
        },
        int(v) {
            const n = Number(v);
            if (!Number.isInteger(n)) {
                throw new ReportError('badNumber', '"' + v + '" is not a whole number.');
            }
            return String(n);
        },
        date(v) {
            const s = String(v || '');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Dates.parse(s)) {
                throw new ReportError('badDate', '"' + v + '" is not a date (YYYY-MM-DD).');
            }
            return "'" + s + "'";
        }
    };

    // ================================================================ Expr
    // The formula language: IF/AND/OR/NOT, comparisons, + - * / &, [field],
    // numbers, 'text', TRUE/FALSE/BLANK and a fixed list of functions. It is
    // parsed into a tree, type-checked, and either compiled to SQL (row level)
    // or evaluated in JS at every total level (aggregate level). No eval.
    const ROW_FNS = {
        IF: [3, 3], COALESCE: [2, 8], ISBLANK: [1, 1], ROUND: [1, 2], ABS: [1, 1], MIN: [2, 8], MAX: [2, 8],
        DIVIDE: [2, 3], UPPER: [1, 1], LOWER: [1, 1], TRIM: [1, 1], LEFT: [2, 2], RIGHT: [2, 2], LEN: [1, 1],
        YEAR: [1, 1], QUARTER: [1, 1], MONTH: [1, 1], DAY: [1, 1], DAYS_BETWEEN: [2, 2], ADD_DAYS: [2, 2], TODAY: [0, 0]
    };
    const AGG_FNS = { SUM: 'sum', AVG: 'avg', COUNT: 'count', COUNTDISTINCT: 'distinct', MINOF: 'min', MAXOF: 'max' };
    const KEYWORDS = { AND: 1, OR: 1, NOT: 1, TRUE: 1, FALSE: 1, BLANK: 1 };
    const MAX_EXPR = 500, MAX_DEPTH = 20;

    const Expr = {
        lex(text) {
            const s = String(text == null ? '' : text);
            if (s.length > MAX_EXPR) {
                throw new ReportError('exprTooLong', 'A formula can be at most ' + MAX_EXPR + ' characters.');
            }
            const out = [];
            let i = 0;
            while (i < s.length) {
                const c = s[i];
                if (/\s/.test(c)) { i++; continue; }
                if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
                    const m = /^(\d+(\.\d+)?|\.\d+)/.exec(s.slice(i));
                    out.push({ t: 'num', v: Number(m[0]), at: i });
                    i += m[0].length;
                    continue;
                }
                if (c === "'") {
                    let j = i + 1, v = '';
                    for (;;) {
                        if (j >= s.length) throw new ReportError('exprSyntax', 'A piece of text in quotes isn\'t closed.');
                        if (s[j] === "'") {
                            if (s[j + 1] === "'") { v += "'"; j += 2; continue; }
                            break;
                        }
                        v += s[j++];
                    }
                    out.push({ t: 'str', v, at: i });
                    i = j + 1;
                    continue;
                }
                if (c === '[') {
                    const m = /^\[([A-Za-z0-9_.]+)\]/.exec(s.slice(i));
                    if (!m) throw new ReportError('exprSyntax', 'A field in [ ] isn\'t written right.');
                    out.push({ t: 'field', v: m[1], at: i });
                    i += m[0].length;
                    continue;
                }
                if (/[A-Za-z_]/.test(c)) {
                    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
                    out.push({ t: 'id', v: m[0].toUpperCase(), at: i });
                    i += m[0].length;
                    continue;
                }
                const two = s.slice(i, i + 2);
                if (two === '<=' || two === '>=' || two === '<>') {
                    out.push({ t: 'op', v: two, at: i });
                    i += 2;
                    continue;
                }
                if ('+-*/&=<>(),'.includes(c)) {
                    out.push({ t: 'op', v: c, at: i });
                    i++;
                    continue;
                }
                throw new ReportError('exprSyntax', 'A formula can\'t contain "' + c + '".');
            }
            return out;
        },

        parse(text) {
            const toks = Expr.lex(text);
            let p = 0, depth = 0;
            const peek = () => toks[p];
            const isOp = v => toks[p] && toks[p].t === 'op' && toks[p].v === v;
            const isKw = v => toks[p] && toks[p].t === 'id' && toks[p].v === v;
            const expect = v => {
                if (!isOp(v)) throw new ReportError('exprSyntax', 'Expected "' + v + '" in the formula.');
                p++;
            };
            const deeper = fn => {
                if (++depth > MAX_DEPTH) throw new ReportError('exprTooDeep', 'The formula is nested too deeply.');
                try { return fn(); } finally { depth--; }
            };
            function or() {
                let a = and();
                while (isKw('OR')) { p++; a = { k: 'bin', op: 'OR', a, b: and() }; }
                return a;
            }
            function and() {
                let a = not();
                while (isKw('AND')) { p++; a = { k: 'bin', op: 'AND', a, b: not() }; }
                return a;
            }
            function not() {
                if (isKw('NOT')) { p++; return deeper(() => ({ k: 'un', op: 'NOT', a: not() })); }
                return cmp();
            }
            function cmp() {
                const a = add();
                const t = peek();
                if (t && t.t === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(t.v)) {
                    p++;
                    return { k: 'bin', op: t.v, a, b: add() };
                }
                return a;
            }
            function add() {
                let a = mul();
                while (isOp('+') || isOp('-') || isOp('&')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: mul() }; }
                return a;
            }
            function mul() {
                let a = un();
                while (isOp('*') || isOp('/')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: un() }; }
                return a;
            }
            function un() {
                if (isOp('-')) { p++; return deeper(() => ({ k: 'un', op: '-', a: un() })); }
                return prim();
            }
            function prim() {
                const t = peek();
                if (!t) throw new ReportError('exprSyntax', 'The formula ends too soon.');
                if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
                if (t.t === 'str') { p++; return { k: 'str', v: t.v }; }
                if (t.t === 'field') { p++; return { k: 'field', id: t.v }; }
                if (t.t === 'op' && t.v === '(') {
                    p++;
                    const e = deeper(or);
                    expect(')');
                    return e;
                }
                if (t.t === 'id') {
                    p++;
                    if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'bool', v: t.v === 'TRUE' };
                    if (t.v === 'BLANK') return { k: 'blank' };
                    if (KEYWORDS[t.v]) throw new ReportError('exprSyntax', '"' + t.v + '" is in the wrong place.');
                    if (!ROW_FNS[t.v] && !AGG_FNS[t.v]) throw new ReportError('exprUnknownFn', '"' + t.v + '" isn\'t a function the formula language knows.');
                    expect('(');
                    const args = [];
                    if (!isOp(')')) {
                        args.push(deeper(or));
                        while (isOp(',')) { p++; args.push(deeper(or)); }
                    }
                    expect(')');
                    const n = ROW_FNS[t.v] || [AGG_FNS[t.v] === 'count' ? 0 : 1, 1];
                    if (args.length < n[0] || args.length > n[1]) {
                        throw new ReportError('exprArgs', t.v + ' takes ' + (n[0] === n[1] ? n[0] : n[0] + ' to ' + n[1]) + ' value' + (n[1] === 1 ? '' : 's') + '.');
                    }
                    return { k: 'call', fn: t.v, args };
                }
                throw new ReportError('exprSyntax', '"' + t.v + '" is in the wrong place.');
            }
            const ast = or();
            if (p < toks.length) throw new ReportError('exprSyntax', '"' + toks[p].v + '" is in the wrong place.');
            return ast;
        },

        /** Field ids a formula refers to. */
        refs(ast, out) {
            out = out || new Set();
            if (!ast) return out;
            if (ast.k === 'field') out.add(ast.id);
            if (ast.a) Expr.refs(ast.a, out);
            if (ast.b) Expr.refs(ast.b, out);
            (ast.args || []).forEach(x => Expr.refs(x, out));
            return out;
        },

        /** Field ids used as totals: those outside SUM(...), COUNT(...) and the other aggregate functions. */
        topRefs(ast, out) {
            out = out || new Set();
            if (!ast) return out;
            if (ast.k === 'call' && AGG_FNS[ast.fn]) return out;
            if (ast.k === 'field') out.add(ast.id);
            if (ast.a) Expr.topRefs(ast.a, out);
            if (ast.b) Expr.topRefs(ast.b, out);
            (ast.args || []).forEach(x => Expr.topRefs(x, out));
            return out;
        },

        /**
         * Type-checks a formula. mode 'row' (a value per line) or 'agg' (a value per
         * group). env.describe(id) -> { type, level: 'row'|'agg', label } or null.
         * Returns the result type; records aggregate-function parts in parts[] (agg mode).
         */
        check(ast, mode, env, parts) {
            const label = id => { const d = env.describe(id); return d ? d.label : id; };
            function merge(a, b, what) {
                if (a === 'blank') return b;
                if (b === 'blank') return a;
                if (a === b) return a;
                // A plain number (or whole number) takes the other's kind: IF(x, [Revenue], 0) is money.
                if (isNumeric(a) && isNumeric(b)) return a === 'number' || a === 'int' ? b : b === 'number' || b === 'int' ? a : 'number';
                throw new ReportError('exprType', what);
            }
            function t(n, m) {
                switch (n.k) {
                    case 'num': return Number.isInteger(n.v) ? 'int' : 'number';
                    case 'str': return 'text';
                    case 'bool': return 'bool';
                    case 'blank': return 'blank';
                    case 'field': {
                        const d = env.describe(n.id);
                        if (!d) throw new ReportError('exprUnknownField', '[' + n.id + '] isn\'t a field here.', n.id);
                        // 'both': a base measure has a value per line and a total.
                        if (m === 'row' && d.level === 'agg') {
                            throw new ReportError('exprLevel', label(n.id) + ' is a total, so it can\'t be used in a per-line formula.', n.id);
                        }
                        if (m === 'agg' && d.level === 'row') {
                            throw new ReportError('exprLevel', label(n.id) + ' has a value per line: put it inside SUM(...), or another total, or group by it.', n.id);
                        }
                        n.type = d.type;
                        return d.type;
                    }
                    case 'un': {
                        const a = t(n.a, m);
                        if (n.op === 'NOT') {
                            if (a !== 'bool' && a !== 'blank') throw new ReportError('exprType', 'NOT needs a yes/no value.');
                            return 'bool';
                        }
                        if (!isNumeric(a) && a !== 'blank') throw new ReportError('exprType', 'Only numbers can be negative.');
                        return a;
                    }
                    case 'bin': {
                        const a = t(n.a, m), b = t(n.b, m), op = n.op;
                        if (op === 'AND' || op === 'OR') {
                            if ((a !== 'bool' && a !== 'blank') || (b !== 'bool' && b !== 'blank')) throw new ReportError('exprType', op + ' joins yes/no conditions.');
                            return 'bool';
                        }
                        if (['=', '<>', '<', '<=', '>', '>='].includes(op)) {
                            const ok = a === 'blank' || b === 'blank' || a === b || (isNumeric(a) && isNumeric(b))
                                || (a === 'date' && b === 'text') || (a === 'text' && b === 'date');
                            if (!ok) throw new ReportError('exprType', 'Those two values can\'t be compared.');
                            return 'bool';
                        }
                        if (op === '&') return 'text';
                        if (a === 'date' || b === 'date') {
                            throw new ReportError('exprType', 'Use DAYS_BETWEEN or ADD_DAYS to calculate with dates.');
                        }
                        if ((!isNumeric(a) && a !== 'blank') || (!isNumeric(b) && b !== 'blank')) {
                            throw new ReportError('exprType', '"' + op + '" works on numbers. Use & to join text.');
                        }
                        if (op === '+' || op === '-') {
                            if ((a === 'money' && b === 'qty') || (a === 'qty' && b === 'money')) {
                                throw new ReportError('exprType', 'An amount of money and a quantity can\'t be added together.');
                            }
                            return merge(a, b, 'Those two values can\'t be added.');
                        }
                        if (op === '*') {
                            if (a === 'money' || b === 'money') return 'money';
                            if (a === 'qty' || b === 'qty') return 'qty';
                            if (a === 'int' && b === 'int') return 'int';
                            if (a === 'percent' && b === 'percent') return 'number';
                            return a === 'blank' ? b : b === 'blank' ? a : (a === 'number' ? b : b === 'number' ? a : 'number');
                        }
                        // '/'
                        if (a === 'money' && (b === 'money')) return 'number';
                        if (a === 'money') return 'money';     // money / qty = a unit price
                        if (a === 'qty' && b !== 'qty') return 'qty';
                        return 'number';
                    }
                    case 'call': {
                        const fn = n.fn, args = n.args;
                        if (AGG_FNS[fn]) {
                            if (m !== 'agg') throw new ReportError('exprLevel', fn + ' adds up lines, so it can only be used in a formula over totals.');
                            if (fn === 'COUNT' && args.length === 0) {
                                parts.push({ node: n, agg: 'count', arg: null });
                                return 'int';
                            }
                            const at = t(args[0], 'row');
                            if ((fn === 'SUM' || fn === 'AVG') && !isNumeric(at)) throw new ReportError('exprType', fn + ' needs numbers.');
                            parts.push({ node: n, agg: AGG_FNS[fn], arg: args[0] });
                            return fn === 'COUNT' || fn === 'COUNTDISTINCT' ? 'int' : fn === 'AVG' && at === 'int' ? 'number' : at;
                        }
                        const at = args.map(x => t(x, m));
                        switch (fn) {
                            case 'IF':
                                if (at[0] !== 'bool' && at[0] !== 'blank') throw new ReportError('exprType', 'The first value of IF is a yes/no condition.');
                                return merge(at[1], at[2], 'IF\'s two results must be the same kind of value.');
                            case 'COALESCE': return at.reduce((x, y) => merge(x, y, 'COALESCE\'s values must be the same kind.'), 'blank');
                            case 'ISBLANK': return 'bool';
                            case 'ROUND':
                                if (args[1] && !(args[1].k === 'num' && Number.isInteger(args[1].v) && args[1].v >= 0 && args[1].v <= 6)) {
                                    throw new ReportError('exprArgs', 'ROUND\'s second value is a whole number of decimals from 0 to 6.');
                                }
                                if (!isNumeric(at[0]) && at[0] !== 'blank') throw new ReportError('exprType', 'ROUND needs a number.');
                                return at[0];
                            case 'ABS':
                                if (!isNumeric(at[0]) && at[0] !== 'blank') throw new ReportError('exprType', 'ABS needs a number.');
                                return at[0];
                            case 'MIN': case 'MAX': return at.reduce((x, y) => merge(x, y, fn + '\'s values must be the same kind.'), 'blank');
                            case 'DIVIDE': {
                                const q = t({ k: 'bin', op: '/', a: args[0], b: args[1] }, m);
                                return args[2] ? merge(q, at[2], 'DIVIDE\'s result and fallback must be the same kind.') : q;
                            }
                            case 'UPPER': case 'LOWER': case 'TRIM': case 'LEFT': case 'RIGHT': return 'text';
                            case 'LEN': return 'int';
                            case 'YEAR': case 'QUARTER': case 'MONTH': case 'DAY':
                                if (at[0] !== 'date' && at[0] !== 'blank') throw new ReportError('exprType', fn + ' needs a date.');
                                return 'int';
                            case 'DAYS_BETWEEN': return 'int';
                            case 'ADD_DAYS': return 'date';
                            case 'TODAY': return 'date';
                            default: throw new ReportError('exprUnknownFn', fn);
                        }
                    }
                    default: throw new ReportError('exprSyntax', 'Unknown formula part.');
                }
            }
            const type = t(ast, mode);
            ast.type = type;
            return type;
        },

        /**
         * SQL for a formula. env.sql(id, mode) gives a field's SQL; partSql(part) the
         * SQL of an aggregate-function part (agg mode, for HAVING/ORDER only).
         */
        toSql(ast, mode, env, ctx) {
            const nul = type => type === 'date' ? 'CAST(NULL AS DATE)' : type === 'text' ? 'CAST(NULL AS CHAR)' : 'CAST(NULL AS DECIMAL(28,8))';
            function s(n, m) {
                switch (n.k) {
                    case 'num': return String(n.v);
                    case 'str': return Lit.str(n.v);
                    case 'bool': return n.v ? '1' : '0';
                    case 'blank': return nul(n.type);
                    case 'field': return '(' + env.sql(n.id, m) + ')';
                    case 'un': return n.op === 'NOT' ? '(NOT ' + s(n.a, m) + ')' : '(-' + s(n.a, m) + ')';
                    case 'bin': {
                        const a = s(n.a, m), b = s(n.b, m);
                        if (n.op === '/') return '(' + a + ' / NULLIF(' + b + ', 0))';
                        if (n.op === '&') return 'CONCAT(COALESCE(' + a + ", ''), COALESCE(" + b + ", ''))";
                        return '(' + a + ' ' + n.op + ' ' + b + ')';
                    }
                    case 'call': {
                        const a = n.args.map(x => s(x, AGG_FNS[n.fn] ? 'row' : m));
                        switch (n.fn) {
                            case 'SUM': return 'SUM(' + a[0] + ')';
                            case 'AVG': return 'AVG(' + a[0] + ')';
                            case 'COUNT': return a.length ? 'COUNT(' + a[0] + ')' : 'COUNT(*)';
                            case 'COUNTDISTINCT': return 'COUNT(DISTINCT ' + a[0] + ')';
                            case 'MINOF': return 'MIN(' + a[0] + ')';
                            case 'MAXOF': return 'MAX(' + a[0] + ')';
                            case 'IF': return '(CASE WHEN ' + a[0] + ' THEN ' + a[1] + ' ELSE ' + a[2] + ' END)';
                            case 'COALESCE': return 'COALESCE(' + a.join(', ') + ')';
                            case 'ISBLANK': return n.args[0].type === 'text' ? '(' + a[0] + " IS NULL OR " + a[0] + " = '')" : '(' + a[0] + ' IS NULL)';
                            case 'ROUND': return 'ROUND(' + a[0] + ', ' + (a[1] || '0') + ')';
                            case 'ABS': return 'ABS(' + a[0] + ')';
                            case 'MIN': return 'LEAST(' + a.join(', ') + ')';
                            case 'MAX': return 'GREATEST(' + a.join(', ') + ')';
                            case 'DIVIDE': return a[2] ? 'COALESCE(' + a[0] + ' / NULLIF(' + a[1] + ', 0), ' + a[2] + ')' : '(' + a[0] + ' / NULLIF(' + a[1] + ', 0))';
                            case 'UPPER': return 'UPPER(' + a[0] + ')';
                            case 'LOWER': return 'LOWER(' + a[0] + ')';
                            case 'TRIM': return 'TRIM(' + a[0] + ')';
                            case 'LEFT': return 'LEFT(' + a[0] + ', ' + a[1] + ')';
                            case 'RIGHT': return 'RIGHT(' + a[0] + ', ' + a[1] + ')';
                            case 'LEN': return 'CHAR_LENGTH(' + a[0] + ')';
                            case 'YEAR': return 'YEAR(' + a[0] + ')';
                            case 'QUARTER': return 'QUARTER(' + a[0] + ')';
                            case 'MONTH': return 'MONTH(' + a[0] + ')';
                            case 'DAY': return 'DAY(' + a[0] + ')';
                            case 'DAYS_BETWEEN': return 'DATEDIFF(' + a[1] + ', ' + a[0] + ')';
                            case 'ADD_DAYS': return 'DATE_ADD(' + a[0] + ', INTERVAL (' + a[1] + ') DAY)';
                            case 'TODAY': return Lit.date((ctx && ctx.today) || Dates.fmt(new Date()));
                            default: throw new ReportError('exprUnknownFn', n.fn);
                        }
                    }
                    default: throw new ReportError('exprSyntax', 'Unknown formula part.');
                }
            }
            return s(ast, mode);
        },

        /**
         * Evaluates an aggregate-level formula in JS. get(id) -> a measure's value at
         * this level; part(node) -> an aggregate-function part's value. SQL rules:
         * blank in, blank out; dividing by 0 gives blank.
         */
        evaluate(ast, get, part, ctx) {
            const num = v => (v == null || v === '' ? null : typeof v === 'number' ? v : Number(v));
            function e(n) {
                switch (n.k) {
                    case 'num': return n.v;
                    case 'str': return n.v;
                    case 'bool': return n.v;
                    case 'blank': return null;
                    case 'field': return get(n.id);
                    case 'un': {
                        const a = e(n.a);
                        if (a == null) return null;
                        return n.op === 'NOT' ? !a : -num(a);
                    }
                    case 'bin': {
                        const op = n.op;
                        if (op === 'AND') { const a = e(n.a), b = e(n.b); return a === false || b === false ? false : a == null || b == null ? null : true; }
                        if (op === 'OR') { const a = e(n.a), b = e(n.b); return a === true || b === true ? true : a == null || b == null ? null : false; }
                        const a = e(n.a), b = e(n.b);
                        if (op === '&') return String(a == null ? '' : a) + String(b == null ? '' : b);
                        if (a == null || b == null) return null;
                        const isNum = typeof a === 'number' || typeof b === 'number' || (isFinite(Number(a)) && isFinite(Number(b)) && a !== '' && b !== '');
                        const x = isNum ? num(a) : String(a), y = isNum ? num(b) : String(b);
                        switch (op) {
                            case '+': return x + y;
                            case '-': return x - y;
                            case '*': return x * y;
                            case '/': return y === 0 ? null : x / y;
                            case '=': return x === y;
                            case '<>': return x !== y;
                            case '<': return x < y;
                            case '<=': return x <= y;
                            case '>': return x > y;
                            case '>=': return x >= y;
                        }
                        return null;
                    }
                    case 'call': {
                        if (AGG_FNS[n.fn]) return part(n);
                        const v = () => n.args.map(e);
                        switch (n.fn) {
                            case 'IF': { const c = e(n.args[0]); return c === true ? e(n.args[1]) : e(n.args[2]); }
                            case 'COALESCE': { for (const x of n.args) { const y = e(x); if (y != null) return y; } return null; }
                            case 'ISBLANK': { const x = e(n.args[0]); return x == null || x === ''; }
                            case 'ROUND': {
                                const x = num(e(n.args[0])), d = n.args[1] ? n.args[1].v : 0;
                                if (x == null) return null;
                                const f = Math.pow(10, d);
                                return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f;
                            }
                            case 'ABS': { const x = num(e(n.args[0])); return x == null ? null : Math.abs(x); }
                            case 'MIN': case 'MAX': {
                                const xs = v();
                                if (xs.some(x => x == null)) return null;
                                return n.fn === 'MIN' ? xs.reduce((p, q) => (q < p ? q : p)) : xs.reduce((p, q) => (q > p ? q : p));
                            }
                            case 'DIVIDE': {
                                const a = num(e(n.args[0])), b = num(e(n.args[1]));
                                const q = a == null || b == null || b === 0 ? null : a / b;
                                return q == null && n.args[2] ? e(n.args[2]) : q;
                            }
                            case 'UPPER': { const x = e(n.args[0]); return x == null ? null : String(x).toUpperCase(); }
                            case 'LOWER': { const x = e(n.args[0]); return x == null ? null : String(x).toLowerCase(); }
                            case 'TRIM': { const x = e(n.args[0]); return x == null ? null : String(x).trim(); }
                            case 'LEFT': { const x = e(n.args[0]); return x == null ? null : String(x).slice(0, num(e(n.args[1]))); }
                            case 'RIGHT': { const x = e(n.args[0]); const k = num(e(n.args[1])); return x == null ? null : k <= 0 ? '' : String(x).slice(-k); }
                            case 'LEN': { const x = e(n.args[0]); return x == null ? null : String(x).length; }
                            case 'YEAR': case 'QUARTER': case 'MONTH': case 'DAY': {
                                const d = Dates.parse(e(n.args[0]));
                                if (!d) return null;
                                const mo = d.getUTCMonth() + 1;
                                return n.fn === 'YEAR' ? d.getUTCFullYear() : n.fn === 'MONTH' ? mo : n.fn === 'DAY' ? d.getUTCDate() : Math.floor((mo - 1) / 3) + 1;
                            }
                            case 'DAYS_BETWEEN': {
                                const a = Dates.parse(e(n.args[0])), b = Dates.parse(e(n.args[1]));
                                return a && b ? Math.round((b - a) / 86400000) : null;
                            }
                            case 'ADD_DAYS': {
                                const a = e(n.args[0]), k = num(e(n.args[1]));
                                return Dates.parse(a) && k != null ? Dates.addDays(String(a).slice(0, 10), Math.trunc(k)) : null;
                            }
                            case 'TODAY': return (ctx && ctx.today) || Dates.fmt(new Date());
                        }
                        return null;
                    }
                }
                return null;
            }
            return e(ast);
        }
    };

    // ================================================================ catalog access
    /**
     * A catalog bound to one subject: which fields it offers, the join closure,
     * and each field's descriptor for the formula checker.
     */
    function bind(cat, subjectId) {
        const subject = cat.subjects[subjectId];
        if (!subject) {
            throw new ReportError('unknownSubject', 'This report is built on "' + subjectId + '", which this version of the catalog doesn\'t have.');
        }
        const has = new Set(subject.has);
        const joinOrder = Object.keys(cat.joins);

        function reachable(aliases) {
            return (aliases || []).every(a => has.has(a) || (cat.joins[a] && reachable(cat.joins[a].needs)));
        }
        function available(id) {
            const f = cat.fields[id];
            if (!f || f.hidden || f.deprecated) return false;
            if (f.only && f.only.indexOf(subjectId) < 0) return false;
            if (f.calc) {
                try {
                    return [...Expr.refs(Expr.parse(f.calc))].every(available);
                } catch (e) {
                    return false;
                }
            }
            return reachable(f.uses);
        }
        /** The joins needed for a set of aliases, in the catalog's order. */
        function closure(aliases) {
            const need = new Set();
            (function add(list) {
                (list || []).forEach(a => {
                    if (has.has(a) || need.has(a)) return;
                    const j = cat.joins[a];
                    if (!j) throw new ReportError('badCatalog', 'The catalog has no join "' + a + '".');
                    add(j.needs);
                    need.add(a);
                });
            })(aliases);
            return joinOrder.filter(a => need.has(a));
        }
        return { cat, subject, subjectId, available, closure, reachable };
    }

    /** Every field a subject offers, grouped by folder (the builder's field tree). */
    function fieldsFor(cat, subjectId) {
        const b = bind(cat, subjectId);
        return Object.keys(cat.fields).filter(b.available).map(id => {
            const f = cat.fields[id];
            return { id, label: f.label, folder: f.folder || 'Other', type: f.type, desc: f.desc || '',
                measure: !!(f.agg || f.calc), gate: f.gate || null, fanout: !!f.fanout, link: f.link || null };
        });
    }

    // ================================================================ Sql
    const BUCKETS = { day: 1, week: 1, month: 1, quarter: 1, year: 1, fy: 1 };
    const BUCKET_LABEL = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year', fy: 'financial year' };
    const MAX_LEVELS = 4, MAX_COLUMNS = 30;

    function bucketSql(sql, bucket, ctx) {
        const fy = Math.min(12, Math.max(1, parseInt((ctx && ctx.fyStart) || 7, 10) || 7));
        switch (bucket) {
            case 'day': return 'DATE(' + sql + ')';
            case 'week': return 'DATE(DATE_SUB(' + sql + ', INTERVAL WEEKDAY(' + sql + ') DAY))';
            case 'month': return "DATE_FORMAT(" + sql + ", '%Y-%m-01')";
            case 'quarter': return "CONCAT(YEAR(" + sql + "), '-Q', QUARTER(" + sql + '))';
            case 'year': return 'YEAR(' + sql + ')';
            // A financial year is named by the year it ends in.
            case 'fy': return fy === 1 ? 'YEAR(' + sql + ')' : 'YEAR(DATE_ADD(' + sql + ', INTERVAL ' + (13 - fy) + ' MONTH))';
            default: return sql;
        }
    }

    /**
     * Compiles a spec. ctx: { lgIds: [int], rights: { gateName: bool }, today,
     * fyStart, values: { paramId: value } }. Returns a plan; plan.errors (plain
     * language) stop the report, plan.warnings are shown above it.
     */
    function compile(spec, cat, ctx) {
        ctx = ctx || {};
        const errors = [], warnings = [];
        const fail = (code, message, ref) => { errors.push({ code, message, ref: ref || null }); };
        const plan = { v: SPEC_VERSION, subject: spec && spec.subject, mode: 'summary', levels: [], columns: [], parts: [],
            calcs: {}, queries: [], errors, warnings, fanoutLevel: -1 };
        if (!spec || spec.kind !== 'fb-report-spec') {
            fail('badSpec', 'This isn\'t a report definition.');
            return plan;
        }
        if (spec.v > SPEC_VERSION) {
            fail('newerSpec', 'This report was made with a newer App Builder. Update the shared scripts to run it.');
            return plan;
        }
        let b;
        try {
            b = bind(cat, spec.subject);
        } catch (e) {
            fail(e.code || 'error', e.message);
            return plan;
        }
        const steps = spec.steps || [];
        const step = type => steps.find(s => s.type === type) || null;
        const grp = step('group') || { levels: [], detail: true };
        const tbl = step('table') || { columns: [] };
        const flt = step('filter') || { all: [] };
        plan.mode = grp.detail ? 'detail' : 'summary';
        const rights = ctx.rights || {};

        // ---- fields: catalog fields plus the report's own formulas
        const calcs = {};
        (spec.calcs || []).forEach(c => {
            if (!c || typeof c.id !== 'string' || !/^calc\.[A-Za-z0-9_]+$/.test(c.id)) {
                fail('badCalc', 'A formula has an invalid id.');
                return;
            }
            calcs[c.id] = c;
        });
        const parsed = {};
        function parsedOf(id) {
            if (parsed[id]) return parsed[id];
            const src = calcs[id] ? calcs[id].expr : cat.fields[id] && cat.fields[id].calc;
            parsed[id] = Expr.parse(src);
            return parsed[id];
        }
        function exists(id) {
            return !!calcs[id] || (cat.fields[id] && b.available(id));
        }
        function labelOf(id) {
            return calcs[id] ? calcs[id].label || id : cat.fields[id] ? cat.fields[id].label : id;
        }
        // A field's level: row (a value per line) or agg (a value per group).
        const levelCache = {}, gateCache = {};
        const visiting = new Set();
        function levelOf(id) {
            if (levelCache[id]) return levelCache[id];
            if (calcs[id]) {
                levelCache[id] = calcs[id].kind === 'row' ? 'row' : 'agg';
            } else {
                const f = cat.fields[id];
                levelCache[id] = f.calc ? 'agg' : f.agg ? 'both' : 'row';
            }
            return levelCache[id];
        }
        // The rights a field needs: its own gate and those of everything its formula uses.
        function gatesOf(id) {
            if (gateCache[id]) return gateCache[id];
            if (visiting.has(id)) throw new ReportError('calcCycle', 'The formula "' + labelOf(id) + '" refers to itself.', id);
            visiting.add(id);
            const out = new Set();
            const f = cat.fields[id];
            if (f && f.gate) out.add(f.gate);
            // A catalog formula with its own gate needs only that right (Margin needs
            // the margin right, not the cost right too); a user's formula needs every
            // right its fields need.
            if (calcs[id] || (f && f.calc && !f.gate)) {
                Expr.refs(parsedOf(id)).forEach(r => { if (exists(r)) gatesOf(r).forEach(g => out.add(g)); });
            }
            visiting.delete(id);
            gateCache[id] = out;
            return out;
        }
        function allowed(id) {
            return [...gatesOf(id)].every(g => rights[g] === true);
        }
        function gateNote(id) {
            const names = [...gatesOf(id)].filter(g => rights[g] !== true).map(g => (cat.gates[g] && cat.gates[g].right) || g);
            return labelOf(id) + ' is hidden: it needs the ' + names.join(' and ') + ' right.';
        }
        const describe = id => {
            if (!exists(id)) return null;
            const type = calcs[id] ? calcs[id].type || null : cat.fields[id].type;
            return { label: labelOf(id), level: levelOf(id), type: type || typeOf(id) };
        };
        const typeCache = {};
        function typeOf(id) {
            if (typeCache[id]) return typeCache[id];
            if (calcs[id] && !calcs[id].type) {
                const mode = levelOf(id) === 'row' ? 'row' : 'agg';
                typeCache[id] = 'number';
                typeCache[id] = Expr.check(parsedOf(id), mode, { describe }, []);
                return typeCache[id];
            }
            return calcs[id] ? calcs[id].type : cat.fields[id].type;
        }
        // Check each formula once: syntax, levels, types, cycles.
        Object.keys(calcs).forEach(id => {
            try {
                gatesOf(id);
                const ast = parsedOf(id);
                Expr.refs(ast).forEach(r => { if (!exists(r)) throw new ReportError('exprUnknownField', '"' + labelOf(id) + '" uses [' + r + '], which isn\'t in this subject.', id); });
                typeOf(id);
            } catch (e) {
                fail(e.code || 'badCalc', '"' + labelOf(id) + '": ' + e.message, id);
            }
        });
        if (errors.length) return plan;

        // ---- row SQL of a dimension, a base measure's row, or a per-line formula
        const usedAliases = new Set();
        function rowSql(id) {
            if (calcs[id]) {
                return Expr.toSql(parsedOf(id), 'row', { sql: rid => rowSql(rid) }, ctx);
            }
            const f = cat.fields[id];
            (f.uses || []).forEach(a => usedAliases.add(a));
            if (f.agg) return f.row;
            if (f.calc) throw new ReportError('exprLevel', f.label + ' is a total, so it has no value per line.', id);
            return f.sql;
        }
        // A dimension shown on detail rows: fan-out fields list every value instead of multiplying rows.
        function detailSql(id) {
            const f = cat.fields[id];
            if (f && f.fanout && f.listSql) {
                (f.listUses || []).forEach(a => usedAliases.add(a));
                return f.listSql;
            }
            return rowSql(id);
        }

        // ---- base measure parts: one SQL aggregate each, shared by every column and formula
        const partsByKey = {};
        function addPart(agg, sql, of) {
            const key = agg + '|' + sql;
            if (!partsByKey[key]) {
                const alias = 'm' + plan.parts.length;
                partsByKey[key] = { alias, agg, sql, of: of || null };
                plan.parts.push(partsByKey[key]);
            }
            return partsByKey[key];
        }
        function aggSql(part) {
            switch (part.agg) {
                case 'sum': return 'SUM(' + part.sql + ')';
                case 'count': return part.sql ? 'COUNT(' + part.sql + ')' : 'COUNT(*)';
                case 'distinct': return 'COUNT(DISTINCT ' + part.sql + ')';
                case 'min': return 'MIN(' + part.sql + ')';
                case 'max': return 'MAX(' + part.sql + ')';
                case 'avg': return 'AVG(' + part.sql + ')';
                default: throw new ReportError('badCatalog', 'Unknown aggregate ' + part.agg);
            }
        }
        // A measure (catalog or formula) -> how to compute it at any level.
        // { part } for a base measure; { ast, deps } for a formula over totals.
        const measureCache = {};
        function measure(id) {
            if (measureCache[id]) return measureCache[id];
            const f = cat.fields[id];
            let m;
            if (f && f.agg) {
                const part = addPart(f.agg, rowSql(id), id);
                m = { id, part, type: f.type };
                plan.measureParts[id] = part.alias;
            } else if ((f && f.calc) || (calcs[id] && levelOf(id) === 'agg')) {
                const ast = parsedOf(id);
                const fparts = [];
                Expr.check(ast, 'agg', { describe }, fparts);
                fparts.forEach(p => {
                    p.part = p.agg === 'count' && !p.arg ? addPart('count', null, null)
                        : addPart(p.agg, Expr.toSql(p.arg, 'row', { sql: rid => rowSql(rid) }, ctx), null);
                });
                Expr.topRefs(ast).forEach(r => measure(r));
                m = { id, ast, fparts, type: f ? f.type : typeOf(id) };
                plan.calcs[id] = m;
            } else if (calcs[id] && levelOf(id) === 'row') {
                // A per-line formula used as a measure: summed.
                const part = addPart('sum', rowSql(id), id);
                m = { id, part, type: typeOf(id) };
                plan.measureParts[id] = part.alias;
            } else {
                throw new ReportError('notMeasure', labelOf(id) + ' isn\'t a figure that can be totalled.', id);
            }
            measureCache[id] = m;
            return m;
        }
        const isMeasure = id => {
            if (calcs[id]) return calcs[id].kind !== 'row' || isNumeric(typeOf(id));
            const f = cat.fields[id];
            return !!(f && (f.agg || f.calc));
        };
        plan.measureParts = {};

        // ---- levels. Group by gives the group headings; in a summary, the other
        // per-line columns (row levels, added below) decide what a row is.
        const levels = (grp.levels || []).slice();
        if (levels.length > MAX_LEVELS) fail('tooManyLevels', 'A report can group by at most ' + MAX_LEVELS + ' fields.');
        // Adds a level; false (after an error or a note) when it can't be one.
        function addLevel(id, bucket, row) {
            if (!exists(id)) { fail('unknownField', '"' + labelOf(id) + '" isn\'t in this subject.', id); return false; }
            if (!allowed(id)) { warnings.push({ code: 'gated', message: gateNote(id), ref: id }); return false; }
            if (levelOf(id) !== 'row') { fail('groupByMeasure', labelOf(id) + ' is a figure to total, so it can\'t be grouped by.', id); return false; }
            const type = typeOf(id);
            if (bucket && (!BUCKETS[bucket] || type !== 'date')) { fail('badBucket', 'Only dates can be grouped by day, week, month, quarter or year.', id); return false; }
            const f = cat.fields[id];
            if (f && f.fanout) {
                if (plan.fanoutLevel >= 0) { fail('twoFanouts', 'Only one field that counts things more than once (like customer group) can be used to group or as a column.', id); return false; }
                plan.fanoutLevel = plan.levels.length;
                warnings.push({ code: 'fanout', message: (f.desc || (f.label + ' can repeat a line under several groups.')), ref: id });
            }
            const sql = bucket ? bucketSql(rowSql(id), bucket, ctx) : rowSql(id);
            // Values: day, week and month buckets are dates (a month is its 1st);
            // quarters read '2026-Q1'; years and financial years are numbers.
            const btype = !bucket ? type : bucket === 'quarter' ? 'text' : bucket === 'year' || bucket === 'fy' ? 'int' : 'date';
            plan.levels.push({ field: id, bucket: bucket || null, alias: 'g' + plan.levels.length, sql, row: !!row,
                label: labelOf(id) + (bucket ? ' (' + BUCKET_LABEL[bucket] + ')' : ''), type: btype,
                link: f && f.link && !bucket ? f.link : null, uses: f ? (f.uses || []).slice() : [] });
            return true;
        }
        levels.forEach(lv => { if (lv && lv.field) addLevel(lv.field, lv.bucket || null, false); });
        if (errors.length) return plan;
        plan.headerCount = plan.levels.length;

        // ---- columns
        const cols = (tbl.columns || []).slice();
        if (cols.length > MAX_COLUMNS) fail('tooManyColumns', 'A report can show at most ' + MAX_COLUMNS + ' columns.');
        let dcount = 0;
        cols.forEach(c => {
            const id = c && c.ref;
            if (!exists(id)) {
                const old = cat.fields[id] && cat.fields[id].deprecated;
                warnings.push({ code: 'missingField', message: '"' + (c.label || labelOf(id)) + '" was left out: ' + (old ? old.note || 'it was retired.' : 'it isn\'t in this subject.'), ref: id });
                return;
            }
            if (!allowed(id)) { warnings.push({ code: 'gated', message: gateNote(id), ref: id }); return; }
            const f = cat.fields[id];
            const col = { id: c.id || id, ref: id, label: c.label || labelOf(id), format: c.format || null, total: c.total !== false };
            let lv = plan.levels.findIndex(l => l.field === id && (l.bucket || null) === (c.bucket || null));
            if (lv < 0 && plan.mode === 'summary' && !isMeasure(id)) {
                // A per-line column in a summary: one row per value (with the other such columns).
                if (plan.levels.length >= MAX_LEVELS + MAX_COLUMNS || !addLevel(id, c.bucket || null, true)) return;
                lv = plan.levels.length - 1;
            }
            if (lv >= 0) {
                col.kind = 'level';
                col.level = lv;
                col.alias = plan.levels[lv].alias;
                col.type = plan.levels[lv].type;
                col.bucket = plan.levels[lv].bucket;
                col.link = plan.levels[lv].link;
                if (!c.label) col.label = plan.levels[lv].label;
            } else if (isMeasure(id)) {
                const m = measure(id);
                col.kind = m.part ? 'measure' : 'calc';
                col.part = m.part ? m.part.alias : null;
                col.type = m.type || typeOf(id);
            } else {
                col.kind = 'detail';
                col.alias = 'd' + (dcount++);
                col.sql = c.bucket ? bucketSql(detailSql(id), c.bucket, ctx) : detailSql(id);
                col.type = typeOf(id);
                col.bucket = c.bucket || null;
                col.link = f && f.link && !c.bucket ? f.link : null;
            }
            plan.columns.push(col);
        });
        if (!plan.columns.length && !errors.length) fail('noColumns', 'Add at least one column.');
        if (errors.length) return plan;
        // Where the group headings stop and the rows start (see Agg.shape). A summary with no
        // per-line columns of its own shows its last group as the rows.
        const H = plan.headerCount;
        const rowLevels = plan.levels.length - H;
        plan.rowDepth = plan.mode === 'detail' ? plan.levels.length : rowLevels > 0 ? H : Math.max(0, H - 1);
        plan.rowLabelLevel = plan.mode === 'summary' && !rowLevels && H > 0 && !plan.columns.some(c => c.kind === 'level' && c.level === H - 1) ? H - 1 : null;

        // ---- filters (WHERE)
        const where = (b.subject.where || []).slice();
        const lgIds = Array.isArray(ctx.lgIds) ? ctx.lgIds.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n)) : null;
        if (!lgIds) {
            fail('noLgs', 'The report can\'t tell which location groups you may see.');
            return plan;
        }
        if (!lgIds.length) {
            where.push('1 = 0');
            warnings.push({ code: 'noLgs', message: 'You have no location groups, so nothing is shown.' });
        } else {
            where.push(b.subject.lg + ' IN (' + lgIds.join(',') + ')');
        }
        const pushdown = {};
        let hasDate = false;
        const params = {};
        (spec.params || []).forEach(p => { if (p && p.id) params[p.id] = p; });
        const values = ctx.values || {};
        (flt.all || []).forEach(cond => {
            let c = cond;
            if (cond && cond.param) {
                const p = params[cond.param];
                if (!p) return;
                c = Object.assign({}, p, Object.prototype.hasOwnProperty.call(values, p.id) ? { value: values[p.id] } : {});
            }
            if (!c || !c.field) return;
            if (!exists(c.field)) { warnings.push({ code: 'missingField', message: 'A filter on "' + labelOf(c.field) + '" was left out: it isn\'t in this subject.', ref: c.field }); return; }
            if (!allowed(c.field)) { warnings.push({ code: 'gated', message: 'A filter on ' + gateNote(c.field), ref: c.field }); return; }
            if (levelOf(c.field) === 'agg') { fail('filterOnTotal', 'Filters work on values per line. ' + labelOf(c.field) + ' is a total.', c.field); return; }
            try {
                const sql = condSql(c, ctx);
                if (sql == null) return;   // an empty value means "any"
                if ((b.subject.dates || []).indexOf(c.field) >= 0) hasDate = true;
                where.push(sql);
                const pd = b.subject.pushdown && b.subject.pushdown[c.field];
                if (pd) {
                    pd.forEach(x => {
                        const inner = condSql(Object.assign({}, c, { __col: x.col }), ctx);
                        pushdown[x.mark] = (pushdown[x.mark] || '') + ' AND ' + inner;
                    });
                }
            } catch (e) {
                fail(e.code || 'badFilter', 'The filter on ' + labelOf(c.field) + ': ' + e.message, c.field);
            }
        });
        if (b.subject.requireDate && !hasDate) {
            fail('needDate', 'Choose a date range: ' + b.subject.label.toLowerCase() + ' are reported for a period.');
        }
        if (errors.length) return plan;

        // A filter -> SQL, or null when it has no value (no filter).
        function condSql(c, ctx) {
            const f = cat.fields[c.field];
            const type = typeOf(c.field);
            const op = c.op || 'eq';
            const v = c.value;
            let col = c.__col || (f && f.fanout ? null : rowSql(c.field));
            if (f && f.fanout) {
                (f.filterIn.uses || []).forEach(a => usedAliases.add(a));
                const list = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String);
                if (op === 'blank') return f.filterIn.noneSql;
                if (!list.length) return null;
                const real = list.filter(x => x !== f.filterIn.none);
                const ors = [];
                if (real.length) ors.push(f.filterIn.sql.replace(':list', real.map(Lit.str).join(', ')));
                if (real.length !== list.length) ors.push(f.filterIn.noneSql);
                const any = '(' + ors.join(' OR ') + ')';
                if (op === 'in' || op === 'eq') return any;
                if (op === 'notIn' || op === 'neq') return '(NOT ' + any + ')';
                throw new ReportError('badOp', 'This field can only be filtered by "is one of".');
            }
            if (op === 'blank') return type === 'text' ? '(' + col + ' IS NULL OR ' + col + " = '')" : '(' + col + ' IS NULL)';
            if (op === 'notBlank') return type === 'text' ? '(' + col + ' IS NOT NULL AND ' + col + " <> '')" : '(' + col + ' IS NOT NULL)';
            if (f && f.key && !c.__col && ['eq', 'neq', 'in', 'notIn'].includes(op)) {
                // A looked-up field (statuses, types) filters on its id, as picked from the list.
                const ids = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(Lit.int);
                if (!ids.length) return null;
                const k = f.key;
                if (op === 'eq' || op === 'in') return k + ' IN (' + ids.join(',') + ')';
                return '(' + k + ' NOT IN (' + ids.join(',') + ') OR ' + k + ' IS NULL)';
            }
            if (type === 'date') {
                const r = op === 'between' ? Dates.resolve(v, ctx) : op === 'on' || op === 'before' || op === 'after' ? Dates.resolve(String(v || ''), ctx) : null;
                if (op !== 'between' && op !== 'on' && op !== 'before' && op !== 'after') throw new ReportError('badOp', 'Dates are filtered by a range, on, before or after.');
                if (!r) return null;
                const parts = [];
                if (op === 'before') return col + ' < ' + Lit.date(r.from);
                if (op === 'after') return col + ' >= ' + Lit.date(Dates.addDays(r.to, 1));
                if (r.from) parts.push(col + ' >= ' + Lit.date(r.from));
                if (r.to) parts.push(col + ' < ' + Lit.date(Dates.addDays(r.to, 1)));
                return parts.length ? '(' + parts.join(' AND ') + ')' : null;
            }
            if (isNumeric(type)) {
                const cmp = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
                if (cmp) {
                    if (v == null || v === '') return null;
                    return op === 'neq' ? '(' + col + ' <> ' + Lit.num(v) + ' OR ' + col + ' IS NULL)' : col + ' ' + cmp + ' ' + Lit.num(v);
                }
                if (op === 'between') {
                    const lo = v && v.from !== '' && v.from != null ? Lit.num(v.from) : null;
                    const hi = v && v.to !== '' && v.to != null ? Lit.num(v.to) : null;
                    const ps = [];
                    if (lo != null) ps.push(col + ' >= ' + lo);
                    if (hi != null) ps.push(col + ' <= ' + hi);
                    return ps.length ? '(' + ps.join(' AND ') + ')' : null;
                }
                if (op === 'in' || op === 'notIn') {
                    const list = (Array.isArray(v) ? v : []).map(Lit.num);
                    if (!list.length) return null;
                    return op === 'in' ? col + ' IN (' + list.join(',') + ')' : '(' + col + ' NOT IN (' + list.join(',') + ') OR ' + col + ' IS NULL)';
                }
                throw new ReportError('badOp', 'That comparison doesn\'t work on numbers.');
            }
            // text and anything else compared as text
            switch (op) {
                case 'eq': return v == null || v === '' ? null : col + ' = ' + Lit.str(v);
                case 'neq': return v == null || v === '' ? null : '(' + col + ' <> ' + Lit.str(v) + ' OR ' + col + ' IS NULL)';
                case 'in': case 'notIn': {
                    const list = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(Lit.str);
                    if (!list.length) return null;
                    return op === 'in' ? col + ' IN (' + list.join(', ') + ')' : '(' + col + ' NOT IN (' + list.join(', ') + ') OR ' + col + ' IS NULL)';
                }
                case 'contains': return v == null || v === '' ? null : 'LOCATE(' + Lit.str(v) + ', ' + col + ') > 0';
                case 'notContains': return v == null || v === '' ? null : '(' + col + ' IS NULL OR LOCATE(' + Lit.str(v) + ', ' + col + ') = 0)';
                case 'startsWith': return v == null || v === '' ? null : 'LEFT(' + col + ', ' + String(v).length + ') = ' + Lit.str(v);
                default: throw new ReportError('badOp', 'That comparison doesn\'t work on text.');
            }
        }

        // ---- FROM + joins
        plan.levels.forEach(l => l.uses.forEach(a => usedAliases.add(a)));
        const fanoutJoins = new Set();
        if (plan.fanoutLevel >= 0) {
            const f = cat.fields[plan.levels[plan.fanoutLevel].field];
            (f.uses || []).forEach(a => { if (cat.joins[a] && cat.joins[a].card === 'many') fanoutJoins.add(a); });
        }
        let from = b.subject.from;
        Object.keys(pushdown).forEach(mark => { from = from.split(mark).join(pushdown[mark]); });
        Object.keys(b.subject.pushdown || {}).forEach(k => b.subject.pushdown[k].forEach(x => { from = from.split(x.mark).join(''); }));
        function fromSql(withFanout) {
            const aliases = [...usedAliases].filter(a => withFanout || !fanoutJoins.has(a));
            const js = b.closure(aliases).filter(a => withFanout || !fanoutJoins.has(a));
            return 'FROM ' + from + js.map(a => ' ' + cat.joins[a].sql).join('');
        }
        const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

        // ---- queries
        const L = plan.levels;
        const partSel = plan.parts.map(p => aggSql(p) + ' AS ' + p.alias);
        if (plan.mode === 'summary') {
            const sel = L.map(l => l.sql + ' AS ' + l.alias).concat(partSel);
            plan.queries.push({ role: 'leaf', capped: true,
                sql: 'SELECT ' + sel.join(', ') + ' ' + fromSql(true) + whereSql
                    + (L.length ? ' GROUP BY ' + L.map(l => l.sql).join(', ') + ' ORDER BY ' + L.map(l => l.sql).join(', ') : '') });
            totals(plan.rowDepth);
        } else {
            const detail = plan.columns.filter(c => c.kind === 'detail');
            const sel = L.map(l => l.sql + ' AS ' + l.alias)
                .concat(detail.map(c => c.sql + ' AS ' + c.alias))
                .concat(plan.parts.map(p => (p.agg === 'count' ? (p.sql ? 'CASE WHEN ' + p.sql + ' IS NULL THEN 0 ELSE 1 END' : '1')
                    : p.agg === 'distinct' ? 'CAST(NULL AS DECIMAL(28,8))' : p.sql) + ' AS ' + p.alias));
            const order = L.map(l => l.sql).concat((tbl.sort || []).map(s => {
                const c = plan.columns.find(x => x.id === s.col);
                if (!c) return null;
                const expr = c.kind === 'detail' ? c.sql : c.kind === 'measure' ? plan.parts.find(p => p.alias === c.part).sql : c.kind === 'level' ? L[c.level].sql : null;
                return expr ? expr + (s.dir === 'desc' ? ' DESC' : ' ASC') : null;
            }).filter(Boolean));
            plan.queries.push({ role: 'detail', capped: true,
                sql: 'SELECT ' + sel.join(', ') + ' ' + fromSql(true) + whereSql + (order.length ? ' ORDER BY ' + order.join(', ') : '') });
            totals(L.length);
        }

        // Totals for every group prefix 0..maxPrefix (0 = grand total), exact, from SQL.
        // Prefixes that don't include the fan-out level come from a query without its join,
        // so a customer in two groups counts once in every total above the groups.
        function totals(maxPrefix) {
            if (maxPrefix < 0 || !plan.parts.length) return;
            const k = plan.fanoutLevel;
            const run = (upTo, withFanout, role, minPrefix) => {
                const lv = L.slice(0, upTo);
                const flags = lv.map((l, i) => 'GROUPING(' + l.sql + ') AS gp' + i);
                const sel = lv.map(l => l.sql + ' AS ' + l.alias).concat(partSel).concat(flags);
                plan.queries.push({ role, minPrefix, maxPrefix: upTo,
                    sql: 'SELECT ' + sel.join(', ') + ' ' + fromSql(withFanout) + whereSql
                        + (lv.length ? ' GROUP BY ' + lv.map(l => l.sql).join(', ') + ' WITH ROLLUP' : '') });
            };
            if (k < 0) {
                run(maxPrefix, false, 'totals', 0);
            } else {
                // prefixes 0..k come without the fan-out join; k+1..maxPrefix with it
                run(Math.min(k, maxPrefix), false, 'totals', 0);
                if (maxPrefix > k) run(maxPrefix, true, 'totalsFanout', k + 1);
            }
        }
        return plan;
    }

    // ================================================================ Agg
    const toNum = v => (v == null || v === '' ? null : typeof v === 'number' ? v : isFinite(Number(v)) ? Number(v) : v);

    /**
     * Shapes query results into a tree. results: { leaf|detail: rows, totals: rows,
     * totalsFanout: rows }. Every node gets values for every column; formula
     * columns are evaluated from that node's own parts.
     */
    function shape(plan, results, ctx) {
        const L = plan.levels;
        const keyOf = (row, upTo) => JSON.stringify(L.slice(0, upTo).map(l => row[l.alias] == null ? null : String(row[l.alias])));
        function values(row, detail) {
            const out = {};
            const get = id => {
                const m = plan.calcs[id];
                if (m) return Expr.evaluate(m.ast, get, n => partValue(n), ctx);
                const alias = plan.measureParts[id];
                return alias ? toNum(row[alias]) : null;
            };
            const partValue = node => {
                for (const id in plan.calcs) {
                    const fp = plan.calcs[id].fparts.find(p => p.node === node);
                    if (fp) return toNum(row[fp.part.alias]);
                }
                return null;
            };
            plan.columns.forEach(c => {
                if (c.kind === 'level') out[c.id] = row[c.alias];
                else if (c.kind === 'detail') out[c.id] = row[c.alias];
                else if (c.kind === 'measure') out[c.id] = toNum(row[c.part]);
                else if (c.kind === 'calc') out[c.id] = get(c.ref);
            });
            return out;
        }
        // Totals rows by prefix length and key.
        const totals = {};
        ['totals', 'totalsFanout'].forEach(role => {
            const q = plan.queries.find(x => x.role === role);
            (results[role] || []).forEach(row => {
                let p = 0;
                while (p < q.maxPrefix && Number(row['gp' + p]) === 0) p++;
                if (p < q.minPrefix || p > q.maxPrefix) return;
                totals[p + '|' + keyOf(row, p)] = row;
            });
        });
        const leafRows = results.leaf || results.detail || [];
        // With no Group by, a summary's single row is the grand total.
        const grandRow = totals['0|' + keyOf({}, 0)] || (plan.mode === 'summary' && !L.length ? leafRows[0] : null) || null;
        const root = { level: -1, key: [], values: grandRow ? values(grandRow) : null, children: [], rows: [] };
        const index = { '': root };
        const leafDepth = plan.rowDepth != null ? plan.rowDepth : plan.mode === 'summary' ? L.length - 1 : L.length;
        leafRows.forEach(row => {
            let parent = root;
            for (let i = 0; i < leafDepth; i++) {
                const k = keyOf(row, i + 1);
                let node = index[k];
                if (!node) {
                    const t = totals[(i + 1) + '|' + k];
                    node = { level: i, key: L.slice(0, i + 1).map(l => row[l.alias]), label: row[L[i].alias],
                        values: t ? values(t) : null, children: [], rows: [] };
                    index[k] = node;
                    parent.children.push(node);
                }
                parent = node;
            }
            parent.rows.push({ values: values(row), raw: row });
        });
        return { root, grand: root.values };
    }

    // ================================================================ View
    // The report on screen, in the iReport ports' chrome (fb-styles §4 header,
    // §35 filters and group rows, §29 table): grouped table with exact totals,
    // ask-at-run-time filters, column tools (FBLib.RptCols), large results
    // (FBLib.RowCap), Excel (FBLib.Export) and the App / PDF views (fb-doc).
    const View = (function () {
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const CHUNK = 600;
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const L = () => (global.FBLib || {});
        const debug = (msg, kind) => { try { L().Common.debugLog(msg, kind); } catch (_) { /* no console */ } };
        const SVG = {
            filter: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>',
            refresh: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>',
            excel: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
            print: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>',
            help: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            gear: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.62.06-.94 0-.32-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96a7.03 7.03 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94 0 .32.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 018.4 12 3.6 3.6 0 0112 8.4a3.6 3.6 0 013.6 3.6 3.6 3.6 0 01-3.6 3.6z"/></svg>'
        };
        const CSS = '.fbr-banner{margin:8px 20px 0;border-radius:8px;padding:8px 12px;font-size:12.5px;flex-shrink:0;border:1px solid #D9A4B2;background:var(--acc-maroon-bg,#FBEFF2);color:#8A1E30}'
            + '.fbr-banner.info{border-color:#BFD7E6;background:var(--tint-blue,#EEF6FB);color:#204A63}.fbr-banner:empty{display:none}'
            + '.fbr-banner div+div{margin-top:3px}.rpt-table td.fbr-neg,.rpt-table .fbr-neg{color:#B4232F}.rpt-table tfoot .fbr-neg{color:#FFC2CA}'
            + '.rpt-table th.num-cell{text-align:right}.rpt-table tr.rpt-grp,.rpt-table tr.rpt-sub{cursor:pointer}'
            + '.rpt-table tr.rpt-sub .rpt-grp-inner{padding-left:16px}.rpt-table tr.rpt-sub.l2 .rpt-grp-inner{padding-left:32px}'
            + '.rpt-table tr.rpt-sub.l3 .rpt-grp-inner{padding-left:48px}.fbr-link{color:var(--link);cursor:pointer;font-weight:600;text-decoration:none}'
            + '.fbr-link:hover{text-decoration:underline}.fbr-grid{display:flex;flex-wrap:wrap;gap:14px 22px;align-items:flex-start}'
            + '.fbr-group{flex:1 1 240px;min-width:220px}.fbr-group-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;'
            + 'color:var(--c-secondary);border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:8px}'
            + '.fbr-group p,.fbr-group li{font-size:12px;color:#415157;line-height:1.5;margin:4px 0}.fbr-group ul{padding-left:18px;margin:4px 0}'
            + '.fbr-dates{display:flex;gap:6px;margin-top:6px}.fbr-dates[hidden]{display:none}.fbr-loading{display:none}.fbr-loading.show{display:flex}';

        function bucketLabel(bucket, v) {
            const s = String(v);
            if (bucket === 'month') { const d = Dates.parse(s); return d ? MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : s; }
            if (bucket === 'quarter') { const m = /^(\d{4})-Q(\d)$/.exec(s); return m ? 'Q' + m[2] + ' ' + m[1] : s; }
            if (bucket === 'fy') return 'FY' + s;
            if (bucket === 'week') return 'Week of ' + fmtDate(s);
            if (bucket === 'day') return fmtDate(s);
            return s;
        }
        function fmtDate(v) {
            try { return L().Common.formatDate(String(v)); } catch (_) { return String(v).slice(0, 10); }
        }
        const isNumCol = c => !c.bucket && (c.kind === 'measure' || c.kind === 'calc' || isNumeric(c.type));
        /** A value as text (not escaped). */
        function text(c, v) {
            if (v == null || v === '') return '';
            if (c.bucket) return bucketLabel(c.bucket, v);
            const f = c.format || {};
            const type = f.type || c.type;
            const n = Number(v);
            const dp = Number.isInteger(f.dp) ? f.dp : null;
            switch (type) {
                case 'money':
                    if (dp == null) { try { return L().Common.formatMoney(n); } catch (_) { /* below */ } }
                    return n.toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
                case 'percent': return (n * 100).toFixed(dp == null ? 1 : dp) + '%';
                case 'qty': try { return L().Common.formatQty(n); } catch (_) { return String(n); }
                case 'int': return Math.round(n).toLocaleString();
                case 'number': return n.toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
                case 'date': return fmtDate(v);
                default: return String(v);
            }
        }
        function cellHtml(c, v, forPrint) {
            const t = text(c, v);
            if (t === '') return '';
            if (c.link && !forPrint && !c.bucket) {
                return '<a class="fbr-link" data-open="' + esc(c.link.module) + '" data-num="' + esc(v) + '">' + esc(t) + '</a>';
            }
            return isNumCol(c) && Number(v) < 0 ? '<span class="fbr-neg">' + esc(t) + '</span>' : esc(t);
        }

        function lgIds() {
            try {
                if (typeof getLocationGroupList !== 'function') return null;
                const ids = getLocationGroupList();
                const arr = ids == null ? null : Array.isArray(ids) ? ids : typeof ids === 'string' ? JSON.parse(ids) : Array.from(ids);
                return Array.isArray(arr) ? arr.map(x => parseInt(x, 10)).filter(x => x > 0) : null;
            } catch (e) {
                debug('getLocationGroupList failed: ' + (e && e.message || e), 'warn');
                return null;
            }
        }
        // Fishbowl's admin is the user named admin (no access right says so).
        function isAdmin() {
            try { const u = JSON.parse((typeof getUser === 'function' && getUser()) || '{}'); return !!u && u.userName === 'admin'; } catch (_) { return false; }
        }
        function hasRight(right) {
            if (typeof hasUserAccess !== 'function') return false;
            try { const v = hasUserAccess(right); return v === true || v === 'true'; } catch (_) { return false; }
        }
        async function runSql(name, sql) {
            const t0 = Date.now();
            sql = String(sql).trim();
            debug(name + ': ' + sql, 'query');
            try {
                let rows;
                if (typeof runQueryAsync === 'function') {
                    rows = await runQueryAsync(sql);
                } else {
                    const raw = runQuery(sql);
                    rows = raw ? JSON.parse(raw) : [];
                }
                rows = Array.isArray(rows) ? rows : [];
                debug(name + ': ' + rows.length + ' rows in ' + (Date.now() - t0) + ' ms', 'success');
                return rows;
            } catch (e) {
                const msg = typeof e === 'string' ? e : (e && e.message) || String(e);
                debug(name + ' failed: ' + msg, 'error');
                throw new Error(msg);
            }
        }

        function mount(host, spec, opts) {
            opts = opts || {};
            const cat = opts.catalog || (global.FBModel && global.FBModel.catalog);
            const fbr = global.FB_REPORT || {};
            const title = spec.title || fbr.name || 'Report';
            const subject = cat && cat.subjects[spec.subject];
            const S = { values: {}, collapsed: new Set(), noCap: false, plan: null, tree: null, loadedAt: null, company: '',
                lookups: {}, token: 0, paint: { html: [], shown: 0 }, capped: null };
            let COLS = null, PDF = null;
            const $ = id => host.querySelector('#' + id) || document.getElementById(id);
            const askParams = (spec.params || []).filter(p => p && p.ask && cat && cat.fields[p.field]);
            // Preview (the builder's): no drawers, no saved choices, a small row cap.
            const preview = !!opts.preview;

            // ---- settings: the user's own filter values and display choices
            if (!preview) {
                try {
                    // The company's filter values ('values') and paper (fb-doc's 'docPaper') live in the shared
                    // master; every open starts from them. Admin or the report's Edit Settings users set them.
                    const key = fbr.key || 'cdx.bi.rb.preview';
                    L().Settings.init({ masterStorage: 'userProperties', company: { keys: ['values'], editors: true },
                        userKey: key + '.user.v1', masterKey: key + '.master.v1',
                        defaults: { v: 1, values: null, remember: true, showDebug: false } });
                } catch (e) { debug('Settings failed: ' + (e && e.message || e), 'warn'); }
            }
            const resolve = preview ? (k, d) => d : (k, d) => { try { const v = L().Settings.resolve(k); return v == null ? d : v; } catch (_) { return d; } };
            const saveUser = preview ? () => {} : obj => { try { Object.keys(obj).forEach(k => L().Settings.setUserKey(k, obj[k])); L().Settings.saveUser(); } catch (_) { /* preview */ } };
            const admin = isAdmin();

            // ---- the page
            if (!document.getElementById('fbr-css')) {
                const st = document.createElement('style');
                st.id = 'fbr-css';
                st.textContent = CSS;
                document.head.appendChild(st);
            }
            const hasFilters = askParams.length > 0;
            host.innerHTML = '<header><div><h1>' + esc(title) + '</h1><p id="statusLine">Loading…</p></div><div class="hdr-actions">'
                + (hasFilters ? '<button id="filtersBtn" class="hdr-btn" type="button" title="Show / hide filters">' + SVG.filter + 'Filters</button><span class="hdr-divider"></span>' : '')
                + '<button id="refreshBtn" class="hdr-btn" type="button" title="Reload from Fishbowl">' + SVG.refresh + 'Refresh</button><span class="hdr-divider"></span>'
                + '<button id="exportBtn" class="hdr-btn" type="button" title="Download as an Excel workbook">' + SVG.excel + 'Excel</button>'
                + (preview ? '' : '<button id="printBtn" class="hdr-btn" type="button" title="Print the PDF view\'s pages: collapsed groups print as their totals">' + SVG.print + 'Print</button><span class="hdr-divider"></span>')
                + (preview ? '' : '<button id="helpBtn" class="hdr-btn hdr-btn-icon" type="button" title="How this report works">' + SVG.help + '</button>'
                    + '<button id="setBtn" class="hdr-btn hdr-btn-icon" type="button" title="Settings">' + SVG.gear + '</button>') + '</div></header>'
                + (hasFilters ? '<div id="filtersPanel" class="rpt-filters"><div class="rpt-fgrid">' + askParams.map(filterControl).join('')
                    + '<div class="rpt-fgroup"><div class="rpt-fgroup-title">&nbsp;</div><button type="button" class="hdr-btn" id="resetFiltersBtn" style="align-self:flex-start">Reset filters</button></div></div></div>' : '')
                + (preview ? '' : drawer('setOverlay', '⚙ Settings', '<div class="fbr-grid"><div class="fbr-group"><div class="fbr-group-title">Display</div>'
                    + (hasFilters ? '<label class="rpt-fcheck"><input type="checkbox" id="setRemember"> Remember my filters</label>' : '')
                    + (hasFilters ? '<div id="companyFilters" hidden style="margin-top:10px"><div class="fbr-group-title">Everyone</div>'
                        + '<p style="margin:2px 0 6px;font-size:12px">Make the current filters what everyone sees each time this report opens. Anyone can still change them while it is open.</p>'
                        + '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="hdr-btn ds-btn-admin" id="companyPubBtn">Use these filters for everyone</button>'
                        + '<button type="button" class="hdr-btn" id="companyUnpubBtn" title="Everyone goes back to their own last choices">Stop using them</button></div></div>' : '')
                    + '<label class="rpt-fcheck" style="margin-top:6px"><input type="checkbox" id="setShowDebug"> Show debug console</label>'
                    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="hdr-btn" id="expandBtn">Expand all</button>'
                    + '<button type="button" class="hdr-btn" id="collapseBtn">Collapse all</button><button type="button" class="hdr-btn" id="resetColsBtn">Reset column layout</button></div>'
                    + '<p class="rpt-fnote">The debug console logs every query and how long it took.</p></div></div>')
                + drawer('helpOverlay', '📖 How this report works', helpHtml()))
                + '<div class="fbr-banner" id="fbrErrors"></div><div class="fbr-banner info" id="fbrNotes"></div>'
                + '<div class="rpt-app" id="appView"><div class="rpt-scroll" id="rptWrap">'
                + '<div class="loading-overlay fbr-loading" id="fbrLoading"><span class="lo-label">Loading…</span></div>'
                + '<table class="rpt-table" id="rpt"><thead></thead><tbody></tbody><tfoot></tfoot></table><div class="rpt-empty" id="rptEmpty"></div></div></div>'
                + '<div class="toast-container" id="toasts"></div>';

            function drawer(id, head, body) {
                return '<div id="' + id + '" class="fb-drawer"><div class="fb-drawer-head"><h2>' + head + '</h2>'
                    + '<button type="button" class="fb-drawer-close" data-close="' + id + '" aria-label="Close">&times;</button></div>'
                    + '<div class="fb-drawer-body">' + body + '</div><div class="fb-drawer-foot"><span></span>'
                    + '<button type="button" class="ds-btn ds-btn-primary" data-close="' + id + '">Done</button></div></div>';
            }
            function filterControl(p, i) {
                const f = cat.fields[p.field];
                const id = 'fp' + i;
                let ctl;
                if (f.type === 'date') {
                    ctl = '<select id="' + id + '">' + Dates.PRESETS.map(x => '<option value="' + x[0] + '">' + esc(x[1]) + '</option>').join('')
                        + '<option value="custom">Custom range…</option></select>'
                        + '<div class="fbr-dates" id="' + id + 'd" hidden><input type="date" id="' + id + 'f"><input type="date" id="' + id + 't"></div>';
                } else if (f.lookup || f.key) {
                    ctl = '<div class="ms-container" id="' + id + 'ms"><div class="ms-trigger" id="' + id + 'ms-trigger"><span class="ms-placeholder" id="' + id + 'ms-placeholder">Any</span></div>'
                        + '<div class="ms-dropdown hidden" id="' + id + 'ms-dropdown"><div class="ms-search"><input type="text" id="' + id + 'ms-search" placeholder="Search…"></div>'
                        + '<div class="ms-actions"><span id="' + id + 'ms-all">Select All</span><span id="' + id + 'ms-clear">Clear All</span></div>'
                        + '<div class="ms-list" id="' + id + 'ms-list"></div></div></div>';
                } else {
                    ctl = '<input type="text" id="' + id + '" placeholder="' + (p.op === 'contains' || !p.op ? 'Contains…' : 'Any') + '">';
                }
                return '<div class="rpt-fgroup"><div class="rpt-fgroup-title">' + esc(p.label || f.label) + '</div><div>' + ctl + '</div></div>';
            }
            function helpHtml() {
                const used = new Set();
                (spec.steps || []).forEach(s => {
                    (s.columns || []).forEach(c => used.add(c.ref));
                    (s.levels || []).forEach(l => used.add(l.field));
                });
                const items = [...used].map(id => {
                    const f = cat && cat.fields[id];
                    const c = (spec.calcs || []).find(x => x.id === id);
                    if (c) return '<li><strong>' + esc(c.label || id) + '</strong>: a formula, ' + esc(c.expr) + '</li>';
                    return f ? '<li><strong>' + esc(f.label) + '</strong>' + (f.desc ? ': ' + esc(f.desc) : '') + '</li>' : '';
                }).join('');
                return '<div class="fbr-grid"><div class="fbr-group"><div class="fbr-group-title">What it shows</div><p>'
                    + esc(spec.description || '') + '</p><p>' + esc(subject ? subject.label + ': ' + subject.desc : '') + '</p></div>'
                    + '<div class="fbr-group"><div class="fbr-group-title">The figures</div><ul>' + items + '</ul></div>'
                    + '<div class="fbr-group"><div class="fbr-group-title">Using it</div><ul>'
                    + '<li>Totals are always for every row that matches the filters, even when only the first rows are shown.</li>'
                    + '<li>Percentages such as Margin % are worked out again for each total, never averaged.</li>'
                    + '<li>Click a group to fold it; Settings has Expand all and Collapse all. Click a heading to sort, drag it to move the column, drag its edge to resize.</li>'
                    + '<li>Only the location groups you can see are included.</li>'
                    + '<li>The App / PDF buttons switch to printable pages; Print prints them. Excel downloads what is on screen.</li></ul></div></div>';
            }

            // ---- wiring
            if (!preview) {
                try {
                    if (hasFilters) L().Common.registerPanel({ id: 'filtersPanel', triggerId: 'filtersBtn' });
                    L().Common.registerDrawer({ id: 'setOverlay', triggerId: 'setBtn' });
                    L().Common.registerDrawer({ id: 'helpOverlay', triggerId: 'helpBtn' });
                } catch (e) { debug('Panels failed: ' + (e && e.message || e), 'warn'); }
            }
            host.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => { try { L().Common.closeDrawer(b.dataset.close); } catch (_) { /* none */ } }; });
            // The buttons open and close their panel and drawers (registration only adds outside-click closing).
            if (hasFilters) {
                $('filtersBtn').onclick = preview
                    ? () => { $('filtersPanel').classList.toggle('open'); $('filtersBtn').classList.toggle('active'); }
                    : () => { try { L().Common.togglePanel('filtersPanel'); } catch (_) { /* none */ } };
            }
            if (!preview) {
                $('setBtn').onclick = () => { try { L().Common.toggleDrawer('setOverlay'); } catch (_) { /* none */ } };
                $('helpBtn').onclick = () => { try { L().Common.toggleDrawer('helpOverlay'); } catch (_) { /* none */ } };
            }
            let debugApi = null;
            const showDebug = on => {
                try {
                    if (!debugApi) debugApi = L().Common.mountDebugDrawer();
                    if (on) { debugApi.show(); debugApi.expand(); } else debugApi.hide();
                } catch (_) { /* no drawer */ }
            };
            if (!preview) {
                showDebug(!!resolve('showDebug', false));
                const dbg = $('setShowDebug');
                dbg.checked = !!resolve('showDebug', false);
                dbg.onchange = () => { saveUser({ showDebug: dbg.checked }); showDebug(dbg.checked); };
            }
            debug('App Builder runtime ' + BUILD + ' · catalog ' + (cat ? cat.id + ' v' + cat.version : 'missing') + ' · page ' + (fbr.build || ''));
            try {
                if (L().RptCols) COLS = L().RptCols.attach({ table: $('rpt'), onSort: () => render(true), onReorder: () => render(true) });
            } catch (e) { debug('Column tools failed: ' + (e && e.message || e), 'warn'); }
            if (!preview) {
                $('resetColsBtn').onclick = () => { if (COLS) { COLS.reset(); render(false); } };
                $('expandBtn').onclick = () => { S.collapsed.clear(); render(true); };
                $('collapseBtn').onclick = () => { allGroupKeys().forEach(k => S.collapsed.add(k)); render(false); };
            }
            $('refreshBtn').onclick = () => load();
            $('exportBtn').onclick = exportWorkbook;
            if (!preview) $('printBtn').onclick = () => {
                if (PDF) PDF.print().catch(e => toast('Printing failed: ' + esc(e && e.message || e), 'error'));
                else toast('The PDF view isn\'t available: the fb-doc script isn\'t loaded.', 'warn');
            };
            const wrap = $('rptWrap');
            wrap.addEventListener('scroll', () => { if (wrap.scrollTop + wrap.clientHeight > wrap.scrollHeight - 400) appendChunk(); });
            $('rpt').addEventListener('click', e => {
                const a = e.target.closest('[data-open]');
                if (a) {
                    e.preventDefault();
                    try { if (typeof openModule === 'function') openModule(a.dataset.open, a.dataset.num); } catch (err) { debug('openModule failed: ' + (err && err.message || err), 'error'); }
                    return;
                }
                const tr = e.target.closest('tr[data-grp]');
                if (tr) {
                    const k = tr.dataset.grp;
                    if (S.collapsed.has(k)) S.collapsed.delete(k); else S.collapsed.add(k);
                    render(true);
                }
            });
            try {
                if (!preview && global.FBDoc && global.FBDoc.Report) {
                    PDF = global.FBDoc.Report.view({ app: $('appView'), toggleBefore: $('exportBtn'),
                        page: { size: (spec.page && spec.page.size) || 'Letter', orientation: (spec.page && spec.page.orientation) || 'portrait' },
                        doc: docSpec, title: () => title });
                }
            } catch (e) { debug('The PDF view failed: ' + (e && e.message || e), 'warn'); }

            // ---- filters: the saved values, else the report's own
            // The company's values, when set, apply every time; else the user's remembered ones.
            let company = false;
            try { company = !preview && L().Settings.hasCompany('values'); } catch (_) { company = false; }
            const saved = company || resolve('remember', true) ? resolve('values', null) : null;
            askParams.forEach(p => { S.values[p.id] = saved && Object.prototype.hasOwnProperty.call(saved, p.id) ? saved[p.id] : p.value; });
            let applyTimer = null;
            const applySoon = () => {
                clearTimeout(applyTimer);
                applyTimer = setTimeout(() => {
                    readFilters();
                    if (resolve('remember', true)) saveUser({ values: S.values });
                    load();
                }, 350);
            };
            const ms = {};
            if (hasFilters) {
                const rem = $('setRemember');
                if (rem) {
                    rem.checked = !!resolve('remember', true);
                    rem.onchange = () => saveUser(rem.checked ? { remember: true, values: S.values } : { remember: false, values: null });
                }
                $('resetFiltersBtn').onclick = () => { askParams.forEach(p => { S.values[p.id] = p.value; }); writeFilters(); applySoon(); };
                let mayPublish = false;
                try { mayPublish = !preview && !!L().Settings.isAdmin(); } catch (_) { mayPublish = false; }
                const box = $('companyFilters');
                if (box && mayPublish) {
                    box.hidden = false;
                    $('companyPubBtn').onclick = () => {
                        if (!confirm('Make the current filters what everyone sees each time this report opens?')) return;
                        readFilters();
                        const ok = L().Settings.publishCompany('values', Object.assign({}, S.values)) !== false;
                        toast(ok ? 'Everyone now opens this report with these filters.' : 'That was not saved.', ok ? 'success' : 'error');
                    };
                    $('companyUnpubBtn').onclick = () => {
                        if (!confirm('Stop using company filters for this report? Everyone goes back to their own last choices.')) return;
                        const ok = L().Settings.clearCompany('values') !== false;
                        toast(ok ? 'This report no longer has company filters.' : 'That was not saved.', ok ? 'success' : 'error');
                    };
                }
                askParams.forEach((p, i) => {
                    const f = cat.fields[p.field];
                    const id = 'fp' + i;
                    if (f.type === 'date') {
                        $(id).onchange = () => { $(id + 'd').hidden = $(id).value !== 'custom'; applySoon(); };
                        $(id + 'f').onchange = applySoon;
                        $(id + 't').onchange = applySoon;
                    } else if (f.lookup || f.key) {
                        try {
                            ms[p.id] = L().Common.MultiSelect.create({ containerId: id + 'ms', items: [], placeholder: 'Any', maxTags: 2, onClose: applySoon });
                        } catch (e) { debug('Filter list failed: ' + (e && e.message || e), 'warn'); }
                    } else {
                        $(id).addEventListener('change', applySoon);
                        $(id).addEventListener('keydown', e => { if (e.key === 'Enter') applySoon(); });
                    }
                });
            }
            function writeFilters() {
                askParams.forEach((p, i) => {
                    const f = cat.fields[p.field];
                    const id = 'fp' + i;
                    const v = S.values[p.id];
                    if (f.type === 'date') {
                        const custom = !v || !v.preset;
                        $(id).value = custom ? 'custom' : v.preset;
                        $(id + 'd').hidden = !custom;
                        $(id + 'f').value = custom && v && v.from ? v.from : '';
                        $(id + 't').value = custom && v && v.to ? v.to : '';
                    } else if (ms[p.id]) {
                        ms[p.id].setSelected((Array.isArray(v) ? v : []).map(String));
                    } else if ($(id)) {
                        $(id).value = v == null ? '' : String(v);
                    }
                });
            }
            function readFilters() {
                askParams.forEach((p, i) => {
                    const f = cat.fields[p.field];
                    const id = 'fp' + i;
                    if (f.type === 'date') {
                        S.values[p.id] = $(id).value === 'custom' ? { from: $(id + 'f').value || null, to: $(id + 't').value || null } : { preset: $(id).value };
                    } else if (ms[p.id]) {
                        S.values[p.id] = ms[p.id].getSelected();
                    } else {
                        S.values[p.id] = $(id).value.trim();
                    }
                });
            }
            async function loadLookups() {
                for (const p of askParams) {
                    const f = cat.fields[p.field];
                    if (!ms[p.id] || !f.lookup) continue;
                    try {
                        const rows = await runSql('Values for ' + f.label, f.lookup);
                        S.lookups[p.id] = rows.map(r => ({ value: String(r.v), label: String(r.l == null ? r.v : r.l) }));
                        ms[p.id].setItems(S.lookups[p.id]);
                    } catch (e) {
                        notes([], ['The list for ' + f.label + ' didn\'t load: ' + e.message]);
                    }
                }
            }

            // ---- loading
            function context() {
                const rights = {};
                Object.keys((cat && cat.gates) || {}).forEach(g => { rights[g] = admin || hasRight(cat.gates[g].right); });
                let fy = 7;
                try { fy = parseInt(getProperty('BI_FY_START_MONTH', '7'), 10) || 7; } catch (_) { fy = 7; }
                const d = new Date();
                const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
                return { lgIds: lgIds(), rights, today, fyStart: fy, values: S.values };
            }
            function notes(errors, warnings) {
                $('fbrErrors').innerHTML = errors.map(m => '<div>' + esc(m) + '</div>').join('');
                $('fbrNotes').innerHTML = warnings.map(m => '<div>' + esc(m) + '</div>').join('');
            }
            async function load() {
                const tok = ++S.token;
                if (!cat) {
                    notes(['The report catalog (the fb-model script) isn\'t loaded, so this report can\'t run.'], []);
                    setStatus('Not loaded');
                    return;
                }
                const ctx = context();
                const plan = compile(spec, cat, ctx);
                S.plan = plan;
                notes(plan.errors.map(e => e.message), plan.warnings.map(w => w.message));
                if (plan.errors.length) {
                    S.tree = null;
                    S.loadedAt = null;
                    render(false);
                    setStatus('Can\'t run this report');
                    return;
                }
                $('fbrLoading').classList.add('show');
                setStatus('Loading…');
                const cap = S.noCap ? 0 : (opts.cap || undefined);
                const results = {};
                try {
                    await Promise.all(plan.queries.map(async q => {
                        const sql = q.capped && L().RowCap ? L().RowCap.sql(q.sql, cap) : q.sql;
                        results[q.role] = await runSql(q.role === 'leaf' || q.role === 'detail' ? 'Rows' : 'Totals', sql);
                    }));
                } catch (e) {
                    if (tok !== S.token) return;
                    $('fbrLoading').classList.remove('show');
                    notes(['The query failed: ' + e.message + '. Settings → Show debug console has the SQL.'], plan.warnings.map(w => w.message));
                    S.tree = null;
                    render(false);
                    setStatus('Query failed');
                    return;
                }
                if (tok !== S.token) return;
                $('fbrLoading').classList.remove('show');
                const role = plan.mode === 'summary' ? 'leaf' : 'detail';
                if (L().RowCap) {
                    const first = plan.levels[0] && plan.levels[0].alias;
                    const c = L().RowCap.apply(results[role], cap, first ? { keyOf: r => r[first] } : undefined);
                    results[role] = c.rows;
                    S.capped = c;
                    L().RowCap.notice({ before: $('appView'), capped: c.capped, limit: c.limit,
                        html: c.capped ? 'Showing the first <strong>' + Number(c.limit).toLocaleString() + '</strong> rows: more match these filters. The totals still cover every row. Narrow the filters, or' : '',
                        onLoadAll: () => { S.noCap = true; load(); } });
                }
                S.tree = shape(plan, results, ctx);
                S.loadedAt = new Date();
                render(false);
            }
            function setStatus(t) { $('statusLine').textContent = t; }

            // ---- rendering
            function columns() {
                const plan = S.plan;
                const base = (plan ? plan.columns : []).map(c => Object.assign({}, c, { key: c.id, num: isNumCol(c) }));
                return COLS ? COLS.arrange(base, c => c.key) : base;
            }
            const headRow = cs => '<tr>' + cs.map(c => '<th data-col="' + esc(c.key) + '" class="' + (c.num ? 'num-cell' : '') + '">' + esc(c.label) + '</th>').join('') + '</tr>';
            function figures(cs, values, forPrint) {
                const figs = {};
                cs.forEach(c => { if (c.num && values) figs[c.key] = cellHtml(c, values[c.id], forPrint) || null; });
                return figs;
            }
            function sortVal(c, node) {
                const v = node.values ? node.values[c.id] : null;
                return v == null ? null : isNumCol(c) ? Number(v) : String(v);
            }
            // The user's heading click, else the report's own sort.
            const tblStep = (spec.steps || []).find(x => x.type === 'table') || {};
            const specSort = (tblStep.sort || []).filter(x => x && x.col)[0];
            function sorted(list, depth, isRows) {
                const s = (COLS && COLS.sort()) || (specSort ? { key: specSort.col, dir: specSort.dir === 'desc' ? 'desc' : 'asc' } : null);
                if (!s) return list;
                const c = (S.plan.columns || []).find(x => x.id === s.key);
                if (!c) return list;
                // Rows sort by the column; groups by their own total (measures) or their own label (this level's column).
                if (!isRows && !(c.kind === 'measure' || c.kind === 'calc' || (c.kind === 'level' && c.level === depth))) return list;
                const val = n => (isRows || c.kind !== 'level' ? sortVal(c, n) : n.label);
                return list.slice().sort((a, b) => {
                    const x = val(a), y = val(b);
                    if (x == null && y == null) return 0;
                    if (x == null) return 1;
                    if (y == null) return -1;
                    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
                    return s.dir === 'desc' ? -r : r;
                });
            }
            function rowsHtml(cs, forPrint) {
                const out = [];
                const plan = S.plan;
                const walk = (node, depth) => {
                    sorted(node.children, depth, false).forEach(ch => {
                        const key = JSON.stringify(ch.key);
                        const lv = plan.levels[ch.level];
                        const open = !S.collapsed.has(key);
                        const count = ch.children.length || ch.rows.length;
                        const label = (forPrint ? '' : '<span class="rpt-toggle">' + (open ? '▼' : '▶') + '</span>')
                            + '<span>' + (esc(text(lv, ch.label)) || '<em>(blank)</em>') + '</span>'
                            + '<span class="rpt-grp-meta">' + count + ' ' + (ch.children.length ? 'group' : 'row') + (count === 1 ? '' : 's') + '</span>';
                        const cls = ch.level === 0 ? 'rpt-grp' : 'rpt-sub l' + ch.level;
                        out.push('<tr class="' + cls + '" data-grp="' + esc(key) + '">'
                            + L().RptCols.totalsCells(cs, '<div class="rpt-grp-inner">' + label + '</div>', figures(cs, ch.values, forPrint)) + '</tr>');
                        if (open) walk(ch, depth + 1);
                    });
                    const labelLv = plan.rowLabelLevel != null ? plan.levels[plan.rowLabelLevel] : null;
                    sorted(node.rows, depth, true).forEach(r => {
                        if (labelLv) {
                            // The last group is the row: its value labels the row.
                            const lbl = esc(text(labelLv, r.raw[labelLv.alias])) || '<em>(blank)</em>';
                            out.push('<tr>' + L().RptCols.totalsCells(cs, lbl, figures(cs, r.values, forPrint)) + '</tr>');
                            return;
                        }
                        out.push('<tr>' + cs.map(c => {
                            // Columns of the groups above this row are shown on the group rows instead.
                            const shown = !(c.kind === 'level' && c.level < depth);
                            return '<td class="' + (c.num ? 'num-cell' : '') + '">' + (shown ? cellHtml(c, r.values[c.id], forPrint) : '') + '</td>';
                        }).join('') + '</tr>');
                    });
                };
                if (S.tree) walk(S.tree.root, 0);
                return out;
            }
            function footRow(cs, forPrint) {
                const g = S.tree && S.tree.grand;
                if (!g || !S.plan.parts.length) return '';
                return '<tr>' + L().RptCols.totalsCells(cs, 'Total', figures(cs, g, forPrint)) + '</tr>';
            }
            function allGroupKeys() {
                const keys = [];
                const walk = n => n.children.forEach(ch => { keys.push(JSON.stringify(ch.key)); walk(ch); });
                if (S.tree) walk(S.tree.root);
                return keys;
            }
            function appendChunk() {
                if (S.paint.shown >= S.paint.html.length) return;
                const next = S.paint.html.slice(S.paint.shown, S.paint.shown + CHUNK);
                $('rpt').querySelector('tbody').insertAdjacentHTML('beforeend', next.join(''));
                S.paint.shown += next.length;
            }
            function render(keepScroll) {
                const tbl = $('rpt');
                const top = wrap.scrollTop;
                const cs = columns();
                tbl.querySelector('thead').innerHTML = cs.length ? headRow(cs) : '';
                S.paint = { html: S.tree ? rowsHtml(cs, false) : [], shown: 0 };
                tbl.querySelector('tbody').innerHTML = '';
                appendChunk();
                while (keepScroll && S.paint.shown < S.paint.html.length && wrap.scrollHeight < top + wrap.clientHeight) appendChunk();
                tbl.querySelector('tfoot').innerHTML = S.tree ? footRow(cs, false) : '';
                const empty = S.tree && !S.paint.html.length;
                tbl.style.display = S.tree && !empty ? '' : 'none';
                $('rptEmpty').textContent = empty ? 'Nothing matches these filters.' : '';
                wrap.scrollTop = keepScroll ? top : 0;
                if (S.tree && S.loadedAt) {
                    const n = S.tree.root.children.length || S.tree.root.rows.length;
                    setStatus([S.company, subject ? subject.label : '', filterText(),
                        'as of ' + S.loadedAt.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')
                        + (n ? '' : ''));
                }
                if (PDF) { try { PDF.refresh(); } catch (_) { /* no pages */ } }
            }
            function filterText() {
                const parts = [];
                (spec.params || []).forEach(p => {
                    const f = cat && cat.fields[p.field];
                    if (!f) return;
                    const v = Object.prototype.hasOwnProperty.call(S.values, p.id) ? S.values[p.id] : p.value;
                    if (f.type === 'date') {
                        const r = Dates.resolve(v, context());
                        if (!r) return;
                        const name = v && v.preset ? (Dates.PRESETS.find(x => x[0] === v.preset) || [0, ''])[1] + ', ' : '';
                        parts.push((p.label || f.label) + ': ' + name + (r.from ? fmtDate(r.from) : '…') + ' – ' + (r.to ? fmtDate(r.to) : '…'));
                    } else if (Array.isArray(v) ? v.length : v != null && v !== '') {
                        const list = Array.isArray(v) ? v : [v];
                        const items = S.lookups[p.id] || [];
                        const names = list.map(x => { const it = items.find(i => String(i.value) === String(x)); return it ? it.label : x; });
                        parts.push((p.label || f.label) + ': ' + names.join(', '));
                    }
                });
                return parts.join(' · ');
            }

            // ---- PDF view and Excel
            function docSpec() {
                if (!S.tree) return null;
                const cs = columns();
                return { company: S.company, title, subtitle: filterText(), titleEveryPage: true,
                    head: headRow(cs), rows: rowsHtml(cs, true), foot: footRow(cs, true),
                    empty: 'Nothing matches these filters.', fontPt: 9 };
            }
            async function exportWorkbook() {
                if (!S.tree) { toast('Nothing to export.', 'warn'); return; }
                const cs = columns();
                const xlType = c => (c.bucket ? 'text' : ({ money: 'money', qty: 'qty', int: 'int', percent: 'percent', date: 'date', number: 'qty' }[(c.format && c.format.type) || c.type] || 'text'));
                const rows = [];
                const plan = S.plan;
                const raw = (c, v) => (v == null ? '' : c.bucket ? bucketLabel(c.bucket, v) : isNumCol(c) ? Number(v) : v);
                const labelCol = (cs.find(c => !c.num) || cs[0]).key;
                const walk = (node, depth) => {
                    sorted(node.children, depth, false).forEach(ch => {
                        const r = { __row: 'total' };
                        cs.forEach(c => { if (c.num) r[c.key] = raw(c, ch.values && ch.values[c.id]); });
                        r[labelCol] = '  '.repeat(ch.level) + text(plan.levels[ch.level], ch.label);
                        rows.push(r);
                        walk(ch, depth + 1);
                    });
                    const labelLv = plan.rowLabelLevel != null ? plan.levels[plan.rowLabelLevel] : null;
                    sorted(node.rows, depth, true).forEach(x => {
                        const r = {};
                        cs.forEach(c => { r[c.key] = c.kind === 'level' && c.level < depth ? '' : raw(c, x.values[c.id]); });
                        if (labelLv) r[labelCol] = text(labelLv, x.raw[labelLv.alias]);
                        rows.push(r);
                    });
                };
                walk(S.tree.root, 0);
                if (S.tree.grand && plan.parts.length) {
                    const r = { __row: 'total' };
                    cs.forEach(c => { if (c.num) r[c.key] = raw(c, S.tree.grand[c.id]); });
                    r[labelCol] = 'Total';
                    rows.push(r);
                }
                try {
                    const name = await L().Export.xlsx({ filename: title.replace(/[^A-Za-z0-9]+/g, '_'), sheets: [{
                        name: title.slice(0, 31), title, subtitle: [S.company, filterText()].filter(Boolean),
                        cols: cs.map(c => ({ key: c.key, label: c.label, w: c.num ? 100 : 180, type: xlType(c), noTotal: true })),
                        rows, totals: false, freeze: true }] });
                    toast('Saved ' + esc(name) + '. If nothing appears, the save dialog may be behind Fishbowl: Alt+Tab.', 'success', 6000);
                } catch (e) {
                    debug('Export failed: ' + (e && e.message || e), 'error');
                    toast('The export failed. The debug console has the details.', 'error');
                }
            }
            function toast(html, type, ms) {
                const hostEl = $('toasts');
                const el = document.createElement('div');
                el.className = 'toast ' + (type || 'info');
                el.innerHTML = '<span class="toast-msg">' + html + '</span><button type="button" class="toast-x" aria-label="Dismiss">&times;</button>';
                el.querySelector('.toast-x').onclick = () => el.remove();
                hostEl.appendChild(el);
                setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms || 4000);
            }

            // ---- start
            (async () => {
                try {
                    if (opts.company != null) {
                        S.company = opts.company;
                    } else {
                        const co = await runSql('Company', 'SELECT name FROM company WHERE id = 1');
                        S.company = (co[0] && co[0].name) || '';
                    }
                } catch (_) { S.company = ''; }
                await loadLookups();
                writeFilters();
                await load();
            })().catch(e => {
                debug('The report failed to start: ' + (e && e.stack || e), 'error');
                notes(['The report failed to start: ' + (e && e.message || e)], []);
            });
            return { reload: load, state: S };
        }
        return { mount, text, bucketLabel, isAdmin, hasRight, runSql };
    })();

    /**
     * Starts a builder report page: reads its spec (the JSON block
     * #fb-report-spec), merges the company's catalog extension, and mounts the view.
     */
    async function boot() {
        const host = document.getElementById('fbr') || document.body;
        let spec;
        try {
            spec = migrate(JSON.parse(document.getElementById('fb-report-spec').textContent));
        } catch (e) {
            host.innerHTML = '<div class="fbr-banner" style="margin:20px">This report\'s definition can\'t be read: ' + String(e && e.message || e).replace(/</g, '&lt;') + '</div>';
            return null;
        }
        let cat = global.FBModel ? global.FBModel.catalog : null;
        if (cat && typeof runQueryAsync === 'function') {
            try {
                const rows = await runQueryAsync("SELECT data FROM biscript WHERE name = 'fb-model-local' AND typeId = 20 AND active+0 = 1");
                if (Array.isArray(rows) && rows[0] && rows[0].data) cat = global.FBModel.merge(JSON.parse(rows[0].data));
            } catch (_) { /* no extension */ }
        }
        return View.mount(host, spec, { catalog: cat });
    }

    // ================================================================ spec helpers
    function migrate(spec) {
        if (!spec || typeof spec !== 'object') return spec;
        // v1 is the first version; later versions add steps here, v -> v+1.
        return spec;
    }

    const FBReport = {
        BUILD,
        SPEC_VERSION,
        ReportError,
        Dates,
        Lit,
        Expr,
        Sql: { compile, bucketSql },
        Agg: { shape },
        catalog: { bind, fieldsFor },
        View,
        boot,
        migrate
    };

    global.FBReport = FBReport;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FBReport;
    }
})(typeof window !== 'undefined' ? window : globalThis);
