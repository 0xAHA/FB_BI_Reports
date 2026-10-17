#!/usr/bin/env node
// Checks the Report Builder catalog (scripts/fb-model.js) against a live Fishbowl
// database, read-only, through the deploy tool's REST session (tools/deploy,
// fishbowl.local.json). Every statement it sends starts with SELECT.
//
//   node tools/report-builder/validate-catalog.js          probes + parity
//   node tools/report-builder/validate-catalog.js --probe  every field in every subject
//   node tools/report-builder/validate-catalog.js --parity figures against the reports they replicate
//
// Probes: each field, in each subject that offers it, compiles and runs (first rows only).
// Parity:
//   P1 posted revenue / cost / margin by customer = Sales_Dashboard_v1.2's own SQL
//      (REV_EXPR and BASE_JOIN are read from the dashboard, so drift there shows up here)
//   P2 order-line values = SalesOrderSummary's oprice / fprice / rprice
//   P3 invoiced = SOA_Report's two legs (all customer groups)
//   P4 every total = the sum of the rows under it (sums), and a customer-group
//      grouping's grand total = the ungrouped grand total
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const FBModel = require(path.join(REPO, 'scripts', 'fb-model.js'));
const FBReport = require(path.join(REPO, 'scripts', 'fb-report.js'));
const { withSession, loadConfig } = require(path.join(REPO, 'tools', 'deploy', 'fbdeploy.js'));

const CAT = FBModel.catalog;
const args = process.argv.slice(2);
const doProbe = !args.includes('--parity');
const doParity = !args.includes('--probe');
const TODAY = new Date().toISOString().slice(0, 10);

let failures = 0;
const ok = (what, cond, detail) => {
    if (!cond) failures++;
    console.log((cond ? '  ok   ' : '  FAIL ') + what + (detail ? '  (' + detail + ')' : ''));
};
const near = (a, b, tol) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= (tol == null ? 0.005 : tol);

function spec(subject, o) {
    const s = CAT.subjects[subject];
    const dateField = o.dateField || s.defaultDate.field;
    return {
        kind: 'fb-report-spec', v: 1, subject, calcs: o.calcs || [],
        params: [{ id: 'p.date', field: dateField, op: 'between', value: o.range || { preset: 'last_365' } }],
        steps: [
            { type: 'filter', all: [{ param: 'p.date' }].concat(o.filters || []) },
            { type: 'group', detail: !!o.detail, levels: o.levels || [] },
            { type: 'table', columns: o.columns }
        ]
    };
}

async function main() {
    const cfg = loadConfig();
    if (!cfg) throw new Error('No tools/deploy/fishbowl.local.json: nothing to validate against.');
    await withSession(cfg, async rawSql => {
        const sql = async text => {
            if (!/^\s*SELECT\b/i.test(text)) throw new Error('refusing a non-SELECT statement');
            return rawSql(text);
        };
        const lgs = (await sql('SELECT id FROM locationgroup')).map(r => Number(r.id));
        const ctx = { lgIds: lgs, rights: { cost: true, margin: true }, today: TODAY, fyStart: 7 };
        const run = async plan => {
            if (plan.errors.length) throw new Error(plan.errors.map(e => e.message).join('; '));
            const results = {};
            for (const q of plan.queries) {
                const t = Date.now();
                results[q.role] = await sql(q.sql);
                results[q.role].ms = Date.now() - t;
            }
            return results;
        };

        if (doProbe) {
            console.log('Probes: every field in every subject');
            for (const subject of Object.keys(CAT.subjects)) {
                const fields = FBReport.catalog.fieldsFor(CAT, subject);
                let n = 0, slow = [];
                for (const f of fields) {
                    const measure = f.measure;
                    const s = measure
                        ? spec(subject, { levels: [], columns: [{ ref: f.id }] })
                        : spec(subject, { levels: [{ field: f.id }], columns: [{ ref: f.id }, { ref: fields.find(x => x.measure && !x.gate).id }] });
                    try {
                        const plan = FBReport.Sql.compile(s, CAT, ctx);
                        const r = await run(plan);
                        const ms = Math.max.apply(null, Object.values(r).map(x => x.ms || 0));
                        if (ms > 2000) slow.push(f.id + ' ' + ms + ' ms');
                        n++;
                    } catch (e) {
                        ok(subject + ' / ' + f.id, false, e.message.slice(0, 200));
                    }
                }
                ok(subject + ': ' + n + ' of ' + fields.length + ' fields run', n === fields.length, slow.length ? 'slow: ' + slow.join(', ') : '');
            }
        }

        if (doParity) {
            console.log('Parity');
            const range = { from: '2025-01-01', to: TODAY };

            // P1: the Sales dashboard's own SQL, read from the dashboard.
            const dash = fs.readFileSync(path.join(REPO, 'Dashboards', 'Sales_Dashboard_v1.2.htm'), 'utf8');
            const REV = /const REV_EXPR\s*=\s*`([^`]+)`/.exec(dash)[1];
            const BASE = /const BASE_JOIN\s*=\s*`([^`]+)`/.exec(dash)[1];
            const EXCL = /const EXCLUDED_LINE_TYPES = '([^']+)'/.exec(dash)[1];
            const ref = await sql('SELECT Customer.Name AS name, SUM(' + REV + ') AS rev, SUM(PostSoItem.PostedTotalCost) AS cost ' + BASE
                + " WHERE PostSo.DateCreated >= '" + range.from + "' AND PostSo.DateCreated < '" + FBReport.Dates.addDays(range.to, 1) + "'"
                + ' AND SoItem.typeId NOT IN (' + EXCL + ') GROUP BY Customer.Name');
            const p1 = FBReport.Sql.compile(spec('sales.posted', { range, levels: [{ field: 'customer.name' }],
                columns: [{ ref: 'customer.name' }, { ref: 'posted.revenue' }, { ref: 'posted.cogs' }, { ref: 'posted.marginPct' }] }), CAT, ctx);
            const r1 = await run(p1);
            const t1 = FBReport.Agg.shape(p1, r1, ctx);
            const mine = new Map(t1.root.rows.map(r => [String(r.values['customer.name']), r.values]));
            let bad = 0, revRef = 0, costRef = 0;
            ref.forEach(r => {
                revRef += Number(r.rev) || 0;
                costRef += Number(r.cost) || 0;
                const m = mine.get(String(r.name));
                if (!m || !near(m['posted.revenue'], r.rev, 0.01) || !near(m['posted.cogs'], r.cost, 0.01)) bad++;
            });
            ok('P1 posted revenue and cost by customer = Sales dashboard (' + ref.length + ' customers)', bad === 0 && ref.length === mine.size, bad + ' differ');
            const g = t1.grand;
            const mref = revRef > 0 ? (revRef - costRef) / revRef : 0;
            ok('P1 grand total revenue / cost / margin %', near(g['posted.revenue'], revRef, 0.02) && near(g['posted.cogs'], costRef, 0.02)
                && near(g['posted.marginPct'], mref, 1e-9), 'revenue ' + g['posted.revenue'].toFixed(2) + ' vs ' + revRef.toFixed(2)
                + ', margin ' + (g['posted.marginPct'] * 100).toFixed(2) + '% vs ' + (mref * 100).toFixed(2) + '%');

            // P2: SalesOrderSummary's line values, for every line issued in the range.
            const refLines = await sql('SELECT SUM(soitem.unitprice * soitem.qtytofulfill + soitem.adjustamount) AS oprice,'
                + ' SUM(ROUND(((soitem.qtyfulfilled * soitem.unitprice) + IF(soitem.qtytofulfill=0,0,soitem.adjustamount/soitem.qtytofulfill) * soitem.qtyfulfilled)*10,1)/10) AS fprice'
                + ' FROM so JOIN soitem ON soitem.soid = so.id'
                + " WHERE so.dateIssued >= '" + range.from + "' AND so.dateIssued < '" + FBReport.Dates.addDays(range.to, 1) + "' AND soitem.typeid NOT IN (40,70,90)");
            const p2 = FBReport.Sql.compile(spec('sales.orderLines', { range, dateField: 'order.dateIssued', levels: [],
                columns: [{ ref: 'lines.value' }, { ref: 'lines.valueFulfilled' }] }), CAT, ctx);
            const g2 = FBReport.Agg.shape(p2, await run(p2), ctx).grand;
            ok('P2 ordered and fulfilled value = SalesOrderSummary', near(g2['lines.value'], refLines[0].oprice, 0.02) && near(g2['lines.valueFulfilled'], refLines[0].fprice, 0.02),
                g2['lines.value'] + ' vs ' + refLines[0].oprice);

            // P3: SOA_Report's two legs, every customer group.
            const d1 = FBReport.Dates.addDays(range.to, 1);
            const refInv = await sql('SELECT SUM(qty * unitprice) AS amt FROM ('
                + 'SELECT shipitem.qtyshipped AS qty, soitem.unitprice AS unitprice FROM shipitem JOIN ship ON ship.id = shipitem.shipid JOIN soitem ON soitem.id = shipitem.soitemid'
                + " WHERE ship.statusid = 30 AND shipitem.soitemid IS NOT NULL AND COALESCE(shipitem.qtyshipped,0) > 0 AND ship.dateshipped >= '" + range.from + "' AND ship.dateshipped < '" + d1 + "'"
                + ' UNION ALL SELECT soitem.qtyfulfilled, soitem.unitprice FROM soitem JOIN so ON so.id = soitem.soid'
                + " JOIN (SELECT soid FROM ship WHERE statusid = 30 AND dateshipped >= '" + range.from + "' AND dateshipped < '" + d1 + "' GROUP BY soid) shx ON shx.soid = so.id"
                + ' WHERE soitem.productid IS NOT NULL AND soitem.showitemflag = 1 AND COALESCE(soitem.qtyfulfilled,0) > 0'
                + ' AND NOT EXISTS (SELECT 1 FROM shipitem si2 WHERE si2.soitemid = soitem.id AND COALESCE(si2.qtyshipped,0) > 0)) u');
            const p3 = FBReport.Sql.compile(spec('sales.invoiced', { range, levels: [], columns: [{ ref: 'invoice.amount' }] }), CAT, ctx);
            const g3 = FBReport.Agg.shape(p3, await run(p3), ctx).grand;
            ok('P3 invoiced (ex tax) = SOA statement legs', near(g3['invoice.amount'], refInv[0].amt, 0.02), g3['invoice.amount'] + ' vs ' + refInv[0].amt);

            // P4: totals are the sum of what is under them; a fan-out grouping keeps the grand total.
            const p4 = FBReport.Sql.compile(spec('sales.posted', { range, levels: [{ field: 'customer.name' }, { field: 'posted.date', bucket: 'month' }],
                columns: [{ ref: 'customer.name' }, { ref: 'posted.date', bucket: 'month' }, { ref: 'posted.revenue' }, { ref: 'posted.lines' }, { ref: 'posted.orders' }] }), CAT, ctx);
            const t4 = FBReport.Agg.shape(p4, await run(p4), ctx);
            let off = 0;
            t4.root.children.forEach(n => {
                const s = n.rows.reduce((a, r) => a + (r.values['posted.revenue'] || 0), 0);
                const c = n.rows.reduce((a, r) => a + (r.values['posted.lines'] || 0), 0);
                if (!near(n.values['posted.revenue'], s, 0.01) || n.values['posted.lines'] !== c) off++;
            });
            ok('P4 each customer\'s total = the sum of its months (' + t4.root.children.length + ' customers)', off === 0, off + ' differ');
            const sumGroups = t4.root.children.reduce((a, n) => a + n.values['posted.revenue'], 0);
            ok('P4 grand total = the sum of the customers', near(t4.grand['posted.revenue'], sumGroups, 0.02));
            const orderSum = t4.root.children.reduce((a, n) => a + n.values['posted.orders'], 0);
            ok('P4 distinct orders: the grand total counts an order once', t4.grand['posted.orders'] <= orderSum,
                t4.grand['posted.orders'] + ' orders overall; ' + orderSum + ' summed over customers');
            const p5 = FBReport.Sql.compile(spec('sales.posted', { range, levels: [{ field: 'customer.group' }],
                columns: [{ ref: 'customer.group' }, { ref: 'posted.revenue' }] }), CAT, ctx);
            const t5 = FBReport.Agg.shape(p5, await run(p5), ctx);
            ok('P4 grouped by customer group: grand total = ungrouped grand total', near(t5.grand['posted.revenue'], t1.grand['posted.revenue'], 0.02),
                t5.grand['posted.revenue'] + ' vs ' + t1.grand['posted.revenue'] + '; groups sum to '
                + t5.root.rows.reduce((a, r) => a + (r.values['posted.revenue'] || 0), 0).toFixed(2));
        }
    });
    console.log(failures ? failures + ' check(s) failed' : 'All checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(2); });
