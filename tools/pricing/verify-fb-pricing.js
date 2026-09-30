#!/usr/bin/env node
// ============================================================================
//  tools/pricing/verify-fb-pricing.js — hold scripts/fb-pricing.js to its spec
// ============================================================================
//
// scripts/fb-pricing.js is a JavaScript port of Custom/Babor/GetPrices.sql.
// This runs BOTH against a Fishbowl database and compares every price the SQL
// schedules: for each customer, every product, every quantity x date band —
// unit price, list price, both winning rule ids and the requires-native flag.
// Run it after any change to either file. Exit code 1 on any difference.
//
// USAGE
//   node tools/pricing/verify-fb-pricing.js [--customers 12,34] [--limit N] [--verbose]
//
// Connection comes from the environment (read-only access is enough):
//   FB_DB_HOST (127.0.0.1)  FB_DB_PORT (3306)  FB_DB_USER  FB_DB_PASSWORD  FB_DB_NAME
// Needs mysql2: `npm i mysql2` somewhere node can resolve it, or point
// MYSQL2_PATH at an existing copy's `promise` entry.
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SPEC = path.join(ROOT, 'Custom', 'Babor', 'GetPrices.sql');
const PORT = path.join(ROOT, 'scripts', 'fb-pricing.js');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const verbose = args.includes('--verbose');

let mysql;
try { mysql = require(process.env.MYSQL2_PATH || 'mysql2/promise'); }
catch (e) { console.error('mysql2 is not installed — `npm i mysql2`, or set MYSQL2_PATH.'); process.exit(2); }

(async () => {
    const db = await mysql.createConnection({
        host: process.env.FB_DB_HOST || '127.0.0.1', port: +(process.env.FB_DB_PORT || 3306),
        user: process.env.FB_DB_USER, password: process.env.FB_DB_PASSWORD, database: process.env.FB_DB_NAME,
    });
    const query = async sql => (await db.query(sql))[0];

    const win = {}; vm.createContext(win); win.window = win;
    vm.runInContext(fs.readFileSync(PORT, 'utf8'), win);
    const FB = win.FBPricing;
    const spec = fs.readFileSync(SPEC, 'utf8');
    if (!spec.includes('CAST(123 AS SIGNED) AS customer_id')) throw new Error('GetPrices.sql parameter line changed; update this tool');

    let ids = opt('--customers') ? opt('--customers').split(',').map(Number)
            : (await query('SELECT id FROM customer WHERE id > 0 ORDER BY id')).map(r => r.id);
    if (opt('--limit')) ids = ids.slice(0, +opt('--limit'));

    let cells = 0, diffs = 0;
    const eq = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9);
    for (const cid of ids) {
        const [row] = await query(spec.replace('CAST(123 AS SIGNED) AS customer_id', 'CAST(' + cid + ' AS SIGNED) AS customer_id'));
        let doc = row.customer_pricing_json;
        if (typeof doc === 'string') doc = JSON.parse(doc);
        const book = await FB.loadBook({ customerId: cid, query });
        if (doc.status !== book.status) { diffs++; console.log(`customer ${cid}: status sql ${doc.status} vs js ${book.status}`); continue; }
        if (doc.status !== 'OK') continue;
        let mine = 0;
        for (const p of doc.products) {
            for (const b of p.priceSchedule) {
                cells++;
                const q = +b.quantityFrom, d = b.dateFrom || '1000-01-01';
                const r = book.resolve(p.productId, q, d);
                const want = {
                    native: b.requiresNativePricing === true,
                    unit: b.unitPrice == null ? null : +b.unitPrice,
                    list: b.listPrice == null ? null : +b.listPrice,
                    t2: b.tier2RuleId, t3: b.tier3RuleId,
                };
                const got = r && {
                    native: !!r.native,
                    unit: r.native ? null : r.unitPrice, list: r.native ? null : r.listPrice,
                    t2: r.tier2RuleId, t3: r.tier3RuleId,
                };
                const same = got && got.native === want.native && eq(got.unit, want.unit) && eq(got.list, want.list)
                          && got.t2 === want.t2 && got.t3 === want.t3;
                if (!same) {
                    diffs++; mine++;
                    if (verbose || mine <= 3) console.log(`  customer ${cid} ${p.productNumber} qty ${q} date ${d}\n    sql ${JSON.stringify(want)}\n    js  ${JSON.stringify(got)}`);
                }
            }
        }
        console.log(`customer ${cid}: ${doc.products.length} products, ${mine ? mine + ' DIFFERENCES' : 'identical'}`);
    }
    await db.end();
    console.log(`\n${ids.length} customers, ${cells} price cells, ${diffs} difference${diffs === 1 ? '' : 's'}`);
    process.exit(diffs ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
