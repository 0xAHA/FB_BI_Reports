// Stage 0: the BOM is looked up by part.id, not by product number.
//
// Three things under test:
//   1. bomHeaderSQL matches on fgbi.partid with the row's part_id.
//   2. A product whose part.num DIFFERS from its product.num still resolves.
//   3. A null product.partId blocks with "not linked to a part", which is a
//      different failure — and a different fix — from "no BOM found".
const fs = require('fs');
const { JSDOM } = require('jsdom');

const REPORT = process.argv[2];
let src = fs.readFileSync(REPORT, 'utf8');
src = src.replace(/<script>\s*\{%[^%]*%\}\s*<\/script>/g, '');
src = src.replace(/<style>\s*\{%[^%]*%\}\s*<\/style>/g, '');
src = src.replace(/<script src="https:[^"]*"><\/script>/g, '');

const sqlLog = [];

// Live SO line: product PF75-CUST-25, part PF75-25SRV (id 900) — deliberately
// different numbers, mirroring the real records being created on the install.
const SO_ROWS = [
  { so_id: 1, so_num: 'SO-30001', so_status: 20, ship_date: '2026-09-25T00:00:00',
    locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
    soitem_id: 9901, line_num: 1, note: 'Flavour: Banana',
    qty_ordered: 2, qty_fulfilled: 0, line_status: 10,
    line_desc: 'Premium Fuel 75g 25 serve', product_num: 'PF75-CUST-25',
    uom_id: 1, uom_code: 'ea', part_id: 900, part_num: 'PF75-25SRV',
    existing_mo_id: null, existing_mo_num: null },
  // product.partId is NULL.
  { so_id: 1, so_num: 'SO-30001', so_status: 20, ship_date: '2026-09-25T00:00:00',
    locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
    soitem_id: 9902, line_num: 2, note: 'Flavour: Banana',
    qty_ordered: 1, qty_fulfilled: 0, line_status: 10,
    line_desc: 'Custom SKU with no part', product_num: 'PF90-CUST-UNLINKED',
    uom_id: 1, uom_code: 'ea', part_id: null, part_num: null,
    existing_mo_id: null, existing_mo_num: null },
];

// The BOM answers ONLY to partid 900. If the report asks by name it gets nothing.
const BOM_HDR = [{
  bomid: 77, bomnum: 'BOM-PF75-25', bomdesc: 'Premium Fuel 75g 25 serve', configurable: 0,
  fgbomitemid: 1001, fgqty: 1, fguomid: 1, fgdesc: 'Premium Fuel 75g 25 serve', fguom: 'ea',
  fgpartid: 900, fgpartnum: 'PF75-25SRV', fgpartdesc: 'Premium Fuel 75g 25 serve',
}];
const BOM_COMPS = [
  { bomitemid: 1, bitypeid: 20, bitypename: 'Raw Good', bomqty: 1127.57, bomuomid: 7, bomuom: 'g',
    bomdesc: 'Maltodextrin', sortid: 1, stageflag: 0, stagebomid: null, variableqty: 0,
    minqty: 0, maxqty: 0, onetimeitem: 0, partid: 201, partnum: 'RAW-MALTODEXTRIN',
    partdesc: 'Maltodextrin', partactive: 1, convok: 1 },
  { bomitemid: 2, bitypeid: 20, bitypename: 'Raw Good', bomqty: 500, bomuomid: 7, bomuom: 'g',
    bomdesc: 'Fructose', sortid: 2, stageflag: 0, stagebomid: null, variableqty: 0,
    minqty: 0, maxqty: 0, onetimeitem: 0, partid: 202, partnum: 'RAW-FRUCTOSE',
    partdesc: 'Fructose', partactive: 1, convok: 1 },
  { bomitemid: 3, bitypeid: 20, bitypename: 'Raw Good', bomqty: 12.43, bomuomid: 7, bomuom: 'g',
    bomdesc: 'Dextrose', sortid: 3, stageflag: 0, stagebomid: null, variableqty: 0,
    minqty: 0, maxqty: 0, onetimeitem: 0, partid: 203, partnum: 'RAW-DEXTROSE',
    partdesc: 'Dextrose', partactive: 1, convok: 1 },
  { bomitemid: 4, bitypeid: 20, bitypename: 'Raw Good', bomqty: 253.25, bomuomid: 7, bomuom: 'g',
    bomdesc: 'Flavour RTU', sortid: 4, stageflag: 0, stagebomid: null, variableqty: 0,
    minqty: 0, maxqty: 0, onetimeitem: 0, partid: 204, partnum: 'FLV-RTU-BAN',
    partdesc: 'Flavour RTU banana', partactive: 1, convok: 1 },
];

function stubQuery(sql) {
  sqlLog.push(sql);
  const s = sql.replace(/\s+/g, ' ');
  if (/FROM sostatus/i.test(s)) return [{ id: 20, name: 'Issued' }, { id: 10, name: 'Estimate' }, { id: 25, name: 'In Progress' }];
  if (/FROM usergroup\b/i.test(s)) return [{ id: 3, name: 'Production' }];
  if (/FROM usergrouprel/i.test(s)) return [{ group_id: 3 }];
  if (/FROM userproperties/i.test(s)) return [];
  if (/FROM soitem si/i.test(s)) return SO_ROWS;
  // The BOM header query: honour it ONLY when it asks by partid 900.
  if (/FROM bom\b/i.test(s) && /fgbi/.test(s)) {
    return /fgbi\.partid\s*=\s*900/.test(s) ? BOM_HDR : [];
  }
  if (/FROM bomitem\b/i.test(s)) return BOM_COMPS;
  if (/INNER JOIN moitem mi ON mi\.moid = mo\.id/i.test(s)) return [];
  if (/'marker' AS via/i.test(s) || /UNION ALL/i.test(s)) return [];
  return [];
}

const dom = new JSDOM(src, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/r' });
const win = dom.window;
win.runQuery = (sql) => JSON.stringify(stubQuery(sql));
win.runQueryAsync = (sql) => Promise.resolve(stubQuery(sql));
win.getUser = () => JSON.stringify({ userName: 'admin' });
win.hasUserAccess = () => true;
win.getProperty = (n, d) => d;
win.currencyLocale = () => ({ locale: 'en-AU', symbol: '$' });
win.getLocationGroupList = () => [1];
win.openModule = () => {};
const store = {};
win.saveSettings = (k, v) => { store[k] = v; return true; };
win.loadSettings = (k) => store[k] || '';
win.moment = require('moment');
win.ResizeObserver = class { observe() {} disconnect() {} };
win.runRestApiAsync = () => Promise.resolve({});

const MASTER = {}; const USER = {}; let cfg = { defaults: {} };
win.FBLib = {
  Common: {
    get DEBUG_MODE() { return false; },
    formatDate: (d) => d ? String(d).slice(0, 10) : '',
    formatMoney: (v) => '$' + (Number(v) || 0).toFixed(2),
    formatQty: (v) => { const n = Number(v); return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(4))); },
    escSQL: (s) => String(s == null ? '' : s).replace(/'/g, "''"),
    currency: () => ({ locale: 'en-AU', symbol: '$' }),
    debugLog: () => {}, mountDebugDrawer: () => null,
    registerDrawer: () => ({}), openDrawer: () => {}, closeDrawer: () => {}, toggleDrawer: () => {},
  },
  Settings: {
    _initialised: true,
    init(c) { cfg = c || { defaults: {} }; },
    resolve(k) { if (k in USER) return USER[k]; if (k in MASTER) return MASTER[k]; return (cfg.defaults || {})[k]; },
    isAdmin: () => true, userEditingAllowed: () => true,
    getUser: () => USER, getMaster: () => MASTER,
    setUserKey(k, v) { USER[k] = v; }, saveUser: () => true,
    clearUser() { Object.keys(USER).forEach(k => delete USER[k]); },
    publishMaster(p) { Object.keys(MASTER).forEach(k => delete MASTER[k]); Object.assign(MASTER, p); return true; },
    setLock: () => true, activeCfsFor: () => [],
  },
  Export: { csv: () => 'x', stamp: () => '2026-09-10' },
};
win.FBMfg = { Finisher: { CFG: {} }, Scrap: {}, Staging: { DEP_QUERY: '' },
              setLogger() {}, setDiag() {}, effectiveUsedQty: (l) => l.target || 0 };

const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
win.eval(blocks[blocks.length - 1]);

const D = win.document;
let fails = 0;
const ok = (l, c, e) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + l + (e ? '  [' + e + ']' : '')); };
const blockersIn = () => [...D.getElementById('buildPanel')
  .querySelectorAll('.pf-blocker-list li')].map(x => x.textContent);

setTimeout(() => {
  console.log('=== live rows loaded ===');
  ok('2 line rows from live SQL', D.querySelectorAll('tr.line-row').length === 2);
  ok('not on the sample path', !/SAMPLE/i.test(D.getElementById('statusLine').textContent));

  win.setCreateMOEnabled(true);
  win.setCreateMODryRun(true);

  console.log('\n=== the BOM header query is keyed on part.id ===');
  // One MO covers the whole order, so the drawer opens on the SO and resolves
  // BOTH lines at once: line 1 has a part and a BOM, line 2 has a null partId.
  win.CSBuild.open('1');
  setTimeout(() => {
    const bomSql = sqlLog.filter(s => /FROM bom\b/i.test(s) && /fgbi/.test(s));
    ok('a BOM header query ran', bomSql.length > 0);
    const q = bomSql[bomSql.length - 1] || '';
    ok('matches on fgbi.partid = 900', /fgbi\.partid\s*=\s*900/.test(q));
    ok('does NOT match on a part/product NUMBER',
       !/fgpart\.num\s*=/.test(q), 'a name match is the bug being fixed');
    ok('never sends the product number to the BOM lookup',
       q.indexOf('PF75-CUST-25') === -1);

    const panel = D.getElementById('buildPanel');
    const all = blockersIn();
    all.forEach(b => console.log('   BLOCKER: ' + b));

    console.log('\n=== line 1: part.num differs from product.num and still resolves ===');
    ok('no "No active BOM found" anywhere',
       !all.some(b => /No active BOM found/i.test(b)),
       'the whole point of Stage 0');
    ok('resolved the live BOM number', /BOM-PF75-25/.test(panel.textContent));
    const rows = panel.querySelectorAll('.pf-table tbody tr').length;
    ok('4 base components + 1 finished good', rows === 5, rows + ' rows');

    console.log('\n=== line 2: a NULL product.partId blocks distinctly ===');
    ok('blocks with "not linked to a part"', all.some(b => /not linked to a part/i.test(b)));
    ok('does NOT masquerade as a missing BOM',
       !all.some(b => /No active BOM found/i.test(b)));
    ok('names the product', all.some(b => /PF90-CUST-UNLINKED/.test(b)));
    ok('no BOM query was attempted for it',
       !sqlLog.some(s => /fgbi\.partid\s*=\s*0\b/.test(s)),
       'a null partId should short-circuit before the query');

    console.log('\n=== the good line still builds ===');
    // One bad line no longer sinks the order: line 1 builds, line 2 is excluded
    // and named. Nothing is silently dropped.
    ok('Create is ENABLED — line 1 is buildable',
       !panel.querySelector('.dsec .ps-btn.primary[disabled]'));
    ok('the excluded line is flagged', /Blocked/.test(panel.textContent));

    console.log(fails ? ('\n*** ' + fails + ' FAILED ***') : '\nSTAGE 0 PASSED');
    process.exitCode = fails ? 1 : 0;
  }, 200);
}, 250);
