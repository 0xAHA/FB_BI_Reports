// Compiling specs against the shipped catalog: SQL shape, security, and messages.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const FBModel = require('../../../scripts/fb-model.js');
const FBReport = require('../../../scripts/fb-report.js');

const CAT = FBModel.catalog;
const CTX = { lgIds: [1, 2], rights: { cost: true, margin: true }, today: '2026-10-14', fyStart: 7 };
const FY = { param: 'p.date' };

function spec(subject, opts) {
    const o = opts || {};
    return {
        kind: 'fb-report-spec', v: 1, subject,
        calcs: o.calcs || [],
        params: [{ id: 'p.date', field: o.dateField || 'posted.date', op: 'between', value: { preset: 'current_fy' } }],
        steps: [
            { id: 'src', type: 'source', subject },
            { id: 'flt', type: 'filter', in: 'src', all: o.filters || [FY] },
            { id: 'grp', type: 'group', in: 'flt', detail: !!o.detail, levels: o.levels || [] },
            { id: 'tbl', type: 'table', in: 'grp', columns: o.columns || [], sort: o.sort || [] }
        ]
    };
}
const compile = (s, ctx) => FBReport.Sql.compile(s, CAT, Object.assign({}, CTX, ctx || {}));
const sqlOf = (plan, role) => (plan.queries.find(q => q.role === role) || {}).sql || '';

test('every catalog formula parses and every field resolves in some subject', () => {
    Object.keys(CAT.fields).forEach(id => {
        const f = CAT.fields[id];
        if (f.calc) FBReport.Expr.parse(f.calc);
        const somewhere = Object.keys(CAT.subjects).some(s => FBReport.catalog.bind(CAT, s).available(id));
        assert.ok(somewhere, id + ' is in no subject');
    });
});

test('a grouped margin report: grouped leaf, rollup totals, location groups, exact date bounds', () => {
    const plan = compile(spec('sales.posted', {
        levels: [{ field: 'customer.name' }, { field: 'posted.date', bucket: 'month' }],
        columns: [{ ref: 'customer.name' }, { ref: 'posted.date', bucket: 'month' }, { ref: 'posted.revenue' }, { ref: 'posted.marginPct' }]
    }));
    assert.deepStrictEqual(plan.errors, []);
    const leaf = sqlOf(plan, 'leaf');
    assert.match(leaf, /^SELECT /);
    assert.match(leaf, /GROUP BY cust\.name, DATE_FORMAT\(pso\.dateCreated, '%Y-%m-01'\)/);
    assert.match(leaf, /so\.locationGroupId IN \(1,2\)/);
    assert.match(leaf, /pso\.dateCreated >= '2026-07-01' AND pso\.dateCreated < '2027-07-01'/);
    assert.match(leaf, /soi\.typeId NOT IN \(30,40,60,70,90\)/);
    assert.match(leaf, /LEFT JOIN postsoitem psd/);                  // the discount join that revenue needs
    assert.doesNotMatch(leaf, /cgrp/);                                 // no join it doesn't need
    assert.match(sqlOf(plan, 'totals'), /WITH ROLLUP/);
    assert.strictEqual(plan.columns.find(c => c.ref === 'posted.marginPct').kind, 'calc');
});

test('cost and margin need their rights; margin needs only the margin right', () => {
    const s = spec('sales.posted', { levels: [{ field: 'customer.name' }],
        columns: [{ ref: 'customer.name' }, { ref: 'posted.cogs' }, { ref: 'posted.marginPct' }] });
    const noCost = compile(s, { rights: { margin: true } });
    assert.deepStrictEqual(noCost.columns.map(c => c.ref), ['customer.name', 'posted.marginPct']);
    assert.match(noCost.warnings.map(w => w.message).join(' '), /Sales Order-Cost/);
    const none = compile(s, { rights: {} });
    assert.deepStrictEqual(none.columns.map(c => c.ref), ['customer.name']);
    // A user's formula over cost needs the cost right.
    const own = spec('sales.posted', { levels: [{ field: 'customer.name' }],
        calcs: [{ id: 'calc.gp', label: 'Gross profit', kind: 'aggregate', expr: '[posted.revenue] - [posted.cogs]' }],
        columns: [{ ref: 'customer.name' }, { ref: 'calc.gp' }] });
    assert.deepStrictEqual(compile(own, { rights: { margin: true } }).columns.map(c => c.ref), ['customer.name']);
});

test('no location groups shows nothing; unknown location groups stop the report', () => {
    const s = spec('sales.posted', { levels: [{ field: 'customer.name' }], columns: [{ ref: 'customer.name' }, { ref: 'posted.revenue' }] });
    assert.match(sqlOf(compile(s, { lgIds: [] }), 'leaf'), /1 = 0/);
    assert.strictEqual(compile(s, { lgIds: null }).errors[0].code, 'noLgs');
});

test('plain-language errors', () => {
    const noDate = spec('sales.posted', { filters: [], levels: [{ field: 'customer.name' }], columns: [{ ref: 'customer.name' }, { ref: 'posted.revenue' }] });
    assert.match(compile(noDate).errors[0].message, /Choose a date range/);
    const noColumns = spec('sales.posted', { levels: [{ field: 'customer.name' }], columns: [] });
    assert.match(compile(noColumns).errors[0].message, /Add at least one column/);
    const headerOnLines = spec('sales.posted', { levels: [{ field: 'customer.name' }], columns: [{ ref: 'customer.name' }, { ref: 'orders.total' }] });
    assert.match(compile(headerOnLines).warnings[0].message, /isn't in this subject/);
    const groupByTotal = spec('sales.posted', { levels: [{ field: 'posted.revenue' }], columns: [{ ref: 'posted.revenue' }] });
    assert.match(compile(groupByTotal).errors[0].message, /can't be grouped by/);
    const badCalc = spec('sales.posted', { levels: [{ field: 'customer.name' }],
        calcs: [{ id: 'calc.x', label: 'Mix', kind: 'aggregate', expr: '[posted.revenue] + [posted.qty]' }],
        columns: [{ ref: 'customer.name' }, { ref: 'calc.x' }] });
    assert.match(compile(badCalc).errors[0].message, /"Mix": .*money and a quantity/);
});

test('customer groups: grouping fans out, totals above it count each customer once, filters use EXISTS', () => {
    const plan = compile(spec('sales.posted', {
        levels: [{ field: 'customer.group' }, { field: 'customer.name' }],
        columns: [{ ref: 'customer.group' }, { ref: 'customer.name' }, { ref: 'posted.revenue' }]
    }));
    assert.deepStrictEqual(plan.errors, []);
    assert.match(sqlOf(plan, 'leaf'), /LEFT JOIN accountgroup cgrp/);
    assert.doesNotMatch(sqlOf(plan, 'totals'), /accountgroup cgrp/);        // grand total without the fan-out
    assert.match(sqlOf(plan, 'totalsFanout'), /accountgroup cgrp/);         // group totals with it
    assert.ok(plan.warnings.some(w => w.code === 'fanout'));
    const f = compile(spec('sales.posted', { filters: [FY, { field: 'customer.group', op: 'in', value: ["Bike Club", 'No Group'] }],
        levels: [{ field: 'customer.name' }], columns: [{ ref: 'customer.name' }, { ref: 'posted.revenue' }] }));
    const leaf = sqlOf(f, 'leaf');
    assert.match(leaf, /EXISTS \(SELECT 1 FROM accountgrouprelation r JOIN accountgroup g .* g\.name IN \('Bike Club'\)\)/);
    assert.match(leaf, /NOT EXISTS \(SELECT 1 FROM accountgrouprelation r WHERE r\.accountId = cust\.accountId\)/);
    assert.doesNotMatch(leaf, /accountgroup cgrp/);                          // the filter doesn't multiply rows
});

test('looked-up fields filter by id; text filters never use LIKE; values are escaped', () => {
    const plan = compile(spec('sales.orderLines', { dateField: 'order.dateIssued',
        filters: [FY, { field: 'order.status', op: 'in', value: [20, 25] }, { field: 'customer.name', op: 'contains', value: "O'Brien%_" }],
        detail: true, columns: [{ ref: 'order.num' }, { ref: 'customer.name' }, { ref: 'lines.valueRemaining' }] }));
    assert.deepStrictEqual(plan.errors, []);
    const sql = sqlOf(plan, 'detail');
    assert.match(sql, /so\.statusId IN \(20,25\)/);
    assert.match(sql, /LOCATE\('O''Brien%_', cust\.name\) > 0/);
    assert.doesNotMatch(sql, /LIKE/);
    assert.throws(() => FBReport.Lit.int('20) OR (1=1'), /whole number/);
    const bad = compile(spec('sales.orderLines', { dateField: 'order.dateIssued',
        filters: [FY, { field: 'order.status', op: 'in', value: ['20) OR (1=1'] }], detail: true, columns: [{ ref: 'order.num' }] }));
    assert.match(bad.errors[0].message, /whole number/);
});

test('the invoiced subject pushes the date filter into both legs', () => {
    const plan = compile(spec('sales.invoiced', { dateField: 'invoice.date', levels: [{ field: 'customer.name' }],
        columns: [{ ref: 'customer.name' }, { ref: 'invoice.amount' }, { ref: 'invoice.marginPct' }] }));
    assert.deepStrictEqual(plan.errors, []);
    const leaf = sqlOf(plan, 'leaf');
    assert.match(leaf, /COALESCE\(shi\.qtyShipped, 0\) > 0 AND \(sh\.dateShipped >= '2026-07-01'/);
    assert.match(leaf, /WHERE statusId = 30 AND \(dateShipped >= '2026-07-01'/);
    assert.doesNotMatch(leaf, /\/\*@d/);
    assert.match(leaf, /inv\.lgId IN \(1,2\)/);
});

test('header totals belong to the Sales orders subject only', () => {
    const ok = compile(spec('sales.orders', { filters: [], levels: [{ field: 'order.salesperson' }],
        columns: [{ ref: 'order.salesperson' }, { ref: 'orders.total' }, { ref: 'orders.avgValue' }, { ref: 'orders.marginPct' }] }));
    assert.deepStrictEqual(ok.errors, []);
    assert.strictEqual(ok.columns.length, 4);
    const fields = FBReport.catalog.fieldsFor(CAT, 'sales.orderLines').map(f => f.id);
    assert.ok(!fields.includes('orders.total') && fields.includes('lines.value'));
});

test('a per-line formula can be grouped by and filtered; aggregate formulas get their own parts', () => {
    const plan = compile(spec('sales.posted', {
        calcs: [
            { id: 'calc.yr', label: 'Posted year', kind: 'row', expr: 'YEAR([posted.date])' },
            { id: 'calc.upo', label: 'Units per order', kind: 'aggregate', expr: 'SUM([posted.qty]) / COUNTDISTINCT([order.num])' }
        ],
        levels: [{ field: 'calc.yr' }],
        columns: [{ ref: 'calc.yr' }, { ref: 'calc.upo' }]
    }));
    assert.deepStrictEqual(plan.errors, []);
    assert.match(sqlOf(plan, 'leaf'), /GROUP BY YEAR\(\(pso\.dateCreated\)\)/);
    assert.ok(plan.parts.some(p => p.agg === 'distinct' && p.sql === '(so.num)'));
});

test('Columns and Group by are separate: per-line columns are the rows, groups are headings', () => {
    // No Group by: one row per customer.
    const flat = compile(spec('sales.posted', { columns: [{ ref: 'customer.name' }, { ref: 'posted.revenue' }] }));
    assert.deepStrictEqual(flat.errors, []);
    assert.strictEqual(flat.headerCount, 0);
    assert.strictEqual(flat.rowDepth, 0);
    assert.match(sqlOf(flat, 'leaf'), /GROUP BY cust\.name/);
    // Grouped by customer group, rows by customer: totals are for the groups only.
    const g = compile(spec('sales.posted', { levels: [{ field: 'customer.group' }],
        columns: [{ ref: 'customer.name' }, { ref: 'order.num' }, { ref: 'posted.revenue' }] }));
    assert.deepStrictEqual(g.errors, []);
    assert.strictEqual(g.headerCount, 1);
    assert.strictEqual(g.rowDepth, 1);
    assert.match(sqlOf(g, 'leaf'), /GROUP BY COALESCE\(cgrp\.name, 'No Group'\), cust\.name, so\.num/);
    assert.doesNotMatch(sqlOf(g, 'totals'), /cust\.name/);
    // A group with no column of its own labels the rows when it is the only per-line field.
    const label = compile(spec('sales.posted', { levels: [{ field: 'customer.name' }], columns: [{ ref: 'posted.revenue' }] }));
    assert.strictEqual(label.rowLabelLevel, 0);
    // A date column in a summary is a row level by its bucket.
    const months = compile(spec('sales.posted', { levels: [{ field: 'customer.name' }], columns: [{ ref: 'posted.date', bucket: 'month' }, { ref: 'posted.revenue' }] }));
    assert.match(sqlOf(months, 'leaf'), /GROUP BY cust\.name, DATE_FORMAT\(pso\.dateCreated, '%Y-%m-01'\)/);
    assert.strictEqual(months.rowLabelLevel, null);
});

test('no SQL in a compiled plan contains Fishbowl substitution hazards', () => {
    const plan = compile(spec('sales.posted', {
        filters: [FY, { field: 'customer.name', op: 'eq', value: '{% Script fb-lib %} $SO{x}' }],
        levels: [{ field: 'customer.name' }], columns: [{ ref: 'customer.name' }, { ref: 'posted.revenue' }] }));
    // Values are data in SQL strings; the page never holds this SQL, so substitution can't reach it.
    assert.match(sqlOf(plan, 'leaf'), /cust\.name = '\{% Script fb-lib %\} \$SO\{x\}'/);
});
