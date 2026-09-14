// Stage 2: discovery is a LIKE pattern, not a hardcoded product list.
//
// Under test:
//   1. The emitted SQL matches the pattern on product number AND description,
//      OR-ed, and carries no hardcoded CUSTOM-* IN list.
//   2. A product found only by its DESCRIPTION is discovered.
//   3. The product dropdown is derived from what the query returned.
//   4. Selecting a product NARROWS the pattern (extra AND) rather than
//      replacing it — the old behaviour silently defeated discovery.
//   5. A miss names the pattern in the empty state.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const REPORT = process.argv[2];
const MODE = process.argv[3] || 'found';   // found | none

let src = fs.readFileSync(REPORT, 'utf8');
src = src.replace(/<script>\s*\{%[^%]*%\}\s*<\/script>/g, '');
src = src.replace(/<style>\s*\{%[^%]*%\}\s*<\/style>/g, '');
src = src.replace(/<script src="https:[^"]*"><\/script>/g, '');

const sqlLog = [];

function row(o) {
  return Object.assign({
    so_id: 1, so_num: 'SO-40001', so_status: 20, ship_date: '2026-09-25T00:00:00',
    locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
    line_num: 1, note: 'Flavour: Banana', qty_ordered: 1, qty_fulfilled: 0,
    line_status: 10, uom_id: 1, uom_code: 'ea',
    existing_mo_id: null, existing_mo_num: null,
  }, o);
}

// Three products: matched by number, matched by description only, and a
// PF75 pack. The description-only row is the one an IN-list could never find.
const SO_ROWS = [
  row({ soitem_id: 9911, product_num: 'PF-CUST-75-25', part_id: 900, part_num: 'PF75-25SRV',
        line_desc: 'Premium Fuel 75g 25 serve' }),
  row({ soitem_id: 9912, product_num: 'WIDGET-01', part_id: 901, part_num: 'PT-WIDGET',
        line_desc: 'A PF-CUST blend sold under an odd number', line_num: 2 }),
  row({ soitem_id: 9913, product_num: 'PF-CUST-90-25', part_id: 902, part_num: 'PF90-25SRV',
        line_desc: 'Premium Fuel 90g 25 serve', line_num: 3 }),
];

function stubQuery(sql) {
  sqlLog.push(sql);
  const s = sql.replace(/\s+/g, ' ');
  if (/FROM sostatus/i.test(s)) return [{ id: 20, name: 'Issued' }, { id: 10, name: 'Estimate' }, { id: 25, name: 'In Progress' }];
  if (/FROM usergroup\b/i.test(s)) return [{ id: 3, name: 'Production' }];
  if (/FROM usergrouprel/i.test(s)) return [{ group_id: 3 }];
  if (/FROM userproperties/i.test(s)) return [];
  if (/FROM soitem si/i.test(s)) {
    if (MODE === 'none') return [];
    // Honour the product-filter narrowing so test 4 is meaningful.
    const m = s.match(/COALESCE\(p\.num, si\.productNum\) IN \(([^)]*)\)/);
    if (m) {
      const picked = m[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
      return SO_ROWS.filter(r => picked.indexOf(r.product_num) !== -1);
    }
    return SO_ROWS;
  }
  if (/FROM bom\b/i.test(s) && /fgbi/.test(s)) return [];
  if (/FROM bomitem\b/i.test(s)) return [];
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
const mainSql = () => sqlLog.filter(s => /FROM soitem si/i.test(s)).pop() || '';

console.log('MODE = ' + MODE + '\n');

setTimeout(() => {
  if (MODE === 'none') {
    // dataSource must be 'live': under 'auto' a zero-row result correctly falls
    // back to SAMPLE_ROWS, so the empty state never renders.
    win.FBLib.Settings.setUserKey('dataSource', 'live');
    win.loadAll();
    setTimeout(() => {
    console.log('=== a miss names the pattern ===');
    const txt = D.getElementById('csBody').textContent;
    console.log('  empty state: ' + txt.replace(/\s+/g, ' ').trim().slice(0, 160));
    ok('empty state quotes the pattern', /%PF-CUST%/.test(txt));
    ok('tells the user where to widen it', /DISCOVERY_PATTERNS/.test(txt));
    ok('mentions the open-order requirement', /open order/i.test(txt));
    console.log(fails ? ('\n*** ' + fails + ' FAILED ***') : '\nSTAGE 2 (none) PASSED');
    process.exitCode = fails ? 1 : 0;
    }, 150);
    return;
  }

  console.log('=== the emitted SQL is a pattern, not a list ===');
  const q = mainSql();
  ok('matches the pattern on the product number',
     /COALESCE\(p\.num, si\.productNum\) LIKE '%PF-CUST%'/.test(q));
  ok('ALSO matches on the product description',
     /p\.description LIKE '%PF-CUST%'/.test(q));
  ok('the two are OR-ed inside their own parens',
     /\(COALESCE\(p\.num, si\.productNum\) LIKE '%PF-CUST%' OR p\.description LIKE '%PF-CUST%'\)/.test(q));
  ok('no hardcoded CUSTOM-* IN list survives',
     q.indexOf('CUSTOM-PROTEIN-BLEND') === -1 && q.indexOf('CUSTOM-GREENS') === -1);
  ok('keeps the open-status floor', /so\.statusId IN \(10, 20, 25\)/.test(q));
  ok('keeps the sale/drop-ship line types', /si\.typeId IN \(10, 12\)/.test(q));

  console.log('\n=== rows discovered ===');
  ok('3 line rows', D.querySelectorAll('tr.line-row').length === 3,
     D.querySelectorAll('tr.line-row').length + '');
  const body = D.getElementById('csBody').textContent;
  ok('found by product number', /PF-CUST-75-25/.test(body));
  ok('found by DESCRIPTION alone (an IN-list could not)', /WIDGET-01/.test(body),
     'this is what pattern discovery buys');
  ok('status line names the pattern',
     /%PF-CUST%/.test(D.getElementById('statusLine').textContent));

  console.log('\n=== the product dropdown is derived from the results ===');
  win.MS.toggle('prod');
  setTimeout(() => {
    const opts = [...D.querySelectorAll('#prodList .ms-item')].map(x => x.textContent.trim());
    console.log('  options: ' + opts.join(', '));
    ok('3 options, one per discovered product', opts.length === 3, opts.length + '');
    ok('includes the description-only match', opts.indexOf('WIDGET-01') !== -1);
    ok('offers no product the pattern never matched',
       opts.every(o => /PF-CUST|WIDGET-01/.test(o)));

    console.log('\n=== selecting a product NARROWS the pattern ===');
    win.MS.toggleItem('prod', 'PF-CUST-75-25');
    setTimeout(() => {
      const q2 = mainSql();
      ok('the pattern group is STILL present',
         /LIKE '%PF-CUST%'/.test(q2), 'the filter must not replace discovery');
      ok('an additional IN clause was added',
         /COALESCE\(p\.num, si\.productNum\) IN \('PF-CUST-75-25'\)/.test(q2));
      ok('narrowed to 1 row', D.querySelectorAll('tr.line-row').length === 1,
         D.querySelectorAll('tr.line-row').length + '');

      console.log(fails ? ('\n*** ' + fails + ' FAILED ***') : '\nSTAGE 2 PASSED');
      process.exitCode = fails ? 1 : 0;
    }, 150);
  }, 60);
}, 250);
