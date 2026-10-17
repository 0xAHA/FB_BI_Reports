// node --test tools/report-builder/test
// The formula language: parsing, types, SQL and evaluation.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const FBReport = require('../../../scripts/fb-report.js');
const { Expr, Lit, ReportError } = FBReport;

// A tiny field set: a dimension, two base measures (value per line and total) and a total.
const FIELDS = {
    'c.name': { label: 'Customer', type: 'text', level: 'row', sql: 'cust.name' },
    'd.when': { label: 'Posted', type: 'date', level: 'row', sql: 'pso.dateCreated' },
    'm.rev': { label: 'Revenue', type: 'money', level: 'both', sql: 'psi.rev' },
    'm.cost': { label: 'Cost', type: 'money', level: 'both', sql: 'psi.cost' },
    'm.qty': { label: 'Qty', type: 'qty', level: 'both', sql: 'psi.qty' },
    'm.pct': { label: 'Margin %', type: 'percent', level: 'agg' }
};
const env = { describe: id => FIELDS[id] || null, sql: id => FIELDS[id].sql };
const typeOf = (text, mode) => Expr.check(Expr.parse(text), mode || 'agg', env, []);

test('parses precedence and functions', () => {
    const ast = Expr.parse('IF([m.rev] > 0, ([m.rev] - [m.cost]) / [m.rev], 0)');
    assert.strictEqual(ast.k, 'call');
    assert.strictEqual(ast.fn, 'IF');
    assert.strictEqual(Expr.parse('1 + 2 * 3').op, '+');
    assert.strictEqual(Expr.parse('NOT 1 = 2 AND 3 < 4').op, 'AND');
    assert.deepStrictEqual([...Expr.refs(Expr.parse('[m.rev] - [m.cost]'))], ['m.rev', 'm.cost']);
});

test('rejects what the language does not have', () => {
    assert.throws(() => Expr.parse('[m.rev]; DROP TABLE so'), ReportError);
    assert.throws(() => Expr.parse('SLEEP(5)'), /isn't a function/);
    assert.throws(() => Expr.parse("'unclosed"), /isn't closed/);
    assert.throws(() => Expr.parse('ROUND(1, 2, 3)'), /takes/);
    assert.throws(() => Expr.parse('x'.repeat(501)), /at most 500/);
    assert.throws(() => Expr.parse('('.repeat(30) + '1' + ')'.repeat(30)), /nested too deeply/);
    assert.throws(() => Expr.parse('1 +'), /ends too soon/);
});

test('infers types and explains mistakes in plain words', () => {
    assert.strictEqual(typeOf('[m.rev] - [m.cost]'), 'money');
    assert.strictEqual(typeOf('[m.rev] / [m.qty]'), 'money');            // a unit price
    assert.strictEqual(typeOf('[m.rev] / [m.cost]'), 'number');
    assert.strictEqual(typeOf('[m.qty] * 2'), 'qty');
    assert.strictEqual(typeOf("[c.name] & ' (' & [c.name] & ')'", 'row'), 'text');
    assert.throws(() => typeOf('[m.rev] + [m.qty]'), /money and a quantity/);
    assert.throws(() => typeOf('[d.when] + 1', 'row'), /DAYS_BETWEEN or ADD_DAYS/);
    assert.throws(() => typeOf('[c.name]'), /value per line/);          // a dimension in a formula over totals
    assert.throws(() => typeOf('[m.pct] * 2', 'row'), /is a total/);    // a total in a per-line formula
    assert.throws(() => typeOf('SUM([m.rev])', 'row'), /formula over totals/);
    assert.strictEqual(typeOf('COUNTDISTINCT([c.name])'), 'int');       // a dimension inside an aggregate is fine
    assert.strictEqual(typeOf('SUM([m.qty])'), 'qty');
});

test('compiles to SQL with safe division and literals', () => {
    const ast = Expr.parse("IF([c.name] = 'O''Brien', [m.rev] / [m.cost], 0)");
    Expr.check(ast, 'row', env, []);
    const sql = Expr.toSql(ast, 'row', env, {});
    assert.match(sql, /NULLIF\(\(psi\.cost\), 0\)/);
    assert.match(sql, /'O''Brien'/);
    assert.strictEqual(Expr.toSql(Expr.parse('TODAY()'), 'row', env, { today: '2026-10-14' }), "'2026-10-14'");
});

test('evaluates totals like SQL: blanks and division by zero give blank', () => {
    const vals = { 'm.rev': 200, 'm.cost': 150 };
    const ev = (t, v) => Expr.evaluate(Expr.parse(t), id => (v || vals)[id], () => null, {});
    assert.strictEqual(ev('IF([m.rev] > 0, ([m.rev] - [m.cost]) / [m.rev], 0)'), 0.25);
    assert.strictEqual(ev('[m.rev] / 0'), null);
    assert.strictEqual(ev('[m.rev] - [m.cost]', { 'm.rev': null, 'm.cost': 1 }), null);
    assert.strictEqual(ev('DIVIDE([m.rev], 0, -1)'), -1);
    assert.strictEqual(ev('ROUND(2.345, 2)'), 2.35);
    assert.strictEqual(ev('ROUND(-2.5)'), -3);                           // half away from zero, as MySQL
    assert.strictEqual(ev("DAYS_BETWEEN('2026-01-01', '2026-03-01')"), 59);
    assert.strictEqual(ev("ADD_DAYS('2026-02-27', 2)"), '2026-03-01');
});

test('literals are escaped for MySQL', () => {
    assert.strictEqual(Lit.str("a'b"), "'a''b'");
    assert.strictEqual(Lit.str('a\\\'b'), "'a\\\\''b'");                 // a backslash can't escape the quote
    assert.strictEqual(Lit.str('x\u0000y\u001fz'), "'xyz'");
    assert.throws(() => Lit.num('1; DROP'), /not a number/);
    assert.throws(() => Lit.date("2026-01-01' OR '1"), /not a date/);
    assert.strictEqual(Lit.date('2026-01-31'), "'2026-01-31'");
});
