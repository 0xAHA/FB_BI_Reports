// Regression for the real PF-CUSTOM BOM shape.
//
// Every bomitem row on the install carries a non-null stageBomId, and the
// adjustable components are variable-quantity lines. The first cut keyed stage
// detection off `!!stagebomid` alone, so EVERY component — including the
// finished good, which this query also returns — was refused as a "staged
// sub-assembly" and no MO could be created.
//
// Asserts: the finished good is not treated as a component; nothing is refused
// for being staged, variable-quantity or optional; the build still goes ahead;
// and the bit(1) columns are decoded rather than string-compared.
//
// Modes:
//   default  - stageBomId set on every row, variable quantities, optional line
//   truestage - one line with the stage BIT genuinely set -> warns, still builds
//   rawbit   - bit columns arrive as raw bytes (String.fromCharCode) as the
//              Fishbowl bridge can deliver them
const fs = require('fs');
const { JSDOM } = require('jsdom');

const REPORT = process.argv[2];
const MODE = process.argv[3] || 'default';

let src = fs.readFileSync(REPORT, 'utf8');
src = src.replace(/<script>\s*\{%[^%]*%\}\s*<\/script>/g, '');
src = src.replace(/<style>\s*\{%[^%]*%\}\s*<\/style>/g, '');
src = src.replace(/<script src="https:[^"]*"><\/script>/g, '');

const restLog = [];
let created = null;

const SO_ROWS = [{
  so_id: 1, so_num: 'SO-60001', so_status: 20, ship_date: '2026-09-25T00:00:00',
  locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
  soitem_id: 8001, line_num: 1, note: 'Flavour: Banana, Electrolyte Mix: High, Caffeine: 100mg',
  qty_ordered: 2, qty_fulfilled: 0, line_status: 10,
  line_desc: 'Premium Fuel 75g custom', product_num: 'PF-CUST-75-25',
  uom_id: 1, uom_code: 'ea', part_id: 900, part_num: 'PF-CUSTOM-75G',
  existing_mo_id: null, existing_mo_num: null,
}];

const ZERO = () => (MODE === 'rawbit' ? String.fromCharCode(0) : 0);
const ONE  = () => (MODE === 'rawbit' ? String.fromCharCode(1) : 1);

// The real BOM: 6 components. stagebomid is populated on EVERY row (as on the
// install). The adjustable ones are variableqty. Flavour is a normal optional
// raw good. Row 0 is the FINISHED GOOD, which bomComponentSQL also returns
// because it deliberately applies no typeid filter.
function bomComps() {
  const rows = [
    ['PF-CUSTOM-75G',       900, 1,       10, 0],   // finished good (typeid 10)
    ['RAW-MALT',            201, 1127.57, 20, 0],
    ['FLV-RTU-BAN',         204, 253.25,  20, 0],
    ['RAW-FRUCTOSE',        202, 500,     20, 0],
    ['RAW-DEXTROSE',        203, 12.43,   20, 0],
    ['RTU-ELECTROLYTE-MIX', 205, 49.07,   20, 1],   // variable qty
    ['RAW-CAFFEINE',        206, 5,       20, 1],   // variable qty (config overrides)
  ];
  return rows.map(([pn, pid, q, tid, varq], i) => ({
    bomitemid: i + 1, bitypeid: tid,
    bitypename: tid === 10 ? 'Finished Good' : 'Raw Good',
    bomqty: q, bomuomid: tid === 10 ? 1 : 7, bomuom: tid === 10 ? 'ea' : 'g',
    bomdesc: pn, sortid: i + 1,
    // THE BUG: non-null on every row, including the finished good.
    stagebomid: 77,
    // Genuine stage bit only in truestage mode, and only on one line.
    stageflag: (MODE === 'truestage' && pn === 'RTU-ELECTROLYTE-MIX') ? ONE() : ZERO(),
    variableqty: varq ? ONE() : ZERO(),
    minqty: 0, maxqty: 0, onetimeitem: ZERO(),
    partid: pid, partnum: pn, partdesc: pn,
    partactive: ONE(), convok: 1,
  }));
}

// 6 components, x2 ordered, FG excluded. Every variable quantity comes from
// the RECIPE CONFIG, not the BOM:
//   base ingredients keep the BOM figure    MALT/FRUCTOSE/DEXTROSE x2
//   Flavour  config '*' 253.25 (and the BOM already carries FLV-RTU-BAN)
//   Electrolyte Mix: High   config 122.28   x2 = 244.56
//     (the BOM says 49.07 — the Low figure — so this proves the config's
//      figure REPLACES the BOM rather than scaling it)
//   Caffeine: 100mg         config 5        x2 = 10
const EXPECT = {
  'RAW-MALT': 2255.14, 'FLV-RTU-BAN': 506.5, 'RAW-FRUCTOSE': 1000,
  'RAW-DEXTROSE': 24.86, 'RTU-ELECTROLYTE-MIX': 244.56, 'RAW-CAFFEINE': 10,
};

function moitemRows() {
  const rows = [
    { id: 1, parentid: null, typeid: 50, uomid: 1, qtytofulfill: 2, part_num: '', mo_id: 6001 },
    { id: 2, parentid: 1, typeid: 10, uomid: 1, qtytofulfill: 2, part_num: 'PF-CUSTOM-75G', mo_id: 6001 },
  ];
  let id = 3;
  Object.keys(EXPECT).forEach(pn => {
    rows.push({ id: id++, parentid: 1, typeid: 20, uomid: 7, qtytofulfill: EXPECT[pn], part_num: pn, mo_id: 6001 });
  });
  return rows;
}

function stubQuery(sql) {
  const s = sql.replace(/\s+/g, ' ');
  if (/FROM sostatus/i.test(s)) return [{ id: 20, name: 'Issued' }, { id: 10, name: 'Estimate' }, { id: 25, name: 'In Progress' }];
  if (/FROM usergroup\b/i.test(s)) return [{ id: 3, name: 'Production' }];
  if (/FROM usergrouprel/i.test(s)) return [{ group_id: 3 }];
  if (/FROM userproperties/i.test(s)) return [];
  if (/FROM soitem si/i.test(s)) return SO_ROWS;
  if (/FROM bom\b/i.test(s) && /fgbi/.test(s)) {
    return /fgbi\.partid = 900/.test(s) ? [{
      bomid: 77, bomnum: 'BOM-PF-CUSTOM-75G', bomdesc: 'PF Custom 75g', configurable: 1,
      fgbomitemid: 1001, fgqty: 1, fguomid: 1, fgdesc: 'PF Custom 75g', fguom: 'ea',
      fgpartid: 900, fgpartnum: 'PF-CUSTOM-75G', fgpartdesc: 'PF Custom 75g',
    }] : [];
  }
  if (/FROM bomitem\b/i.test(s)) return bomComps();
  if (/INNER JOIN moitem mi ON mi\.moid = mo\.id/i.test(s)) return moitemRows();
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
win.runRestApiAsync = (req) => {
  restLog.push(req.method + ' ' + req.path);
  if (req.method === 'POST' && req.path === '/api/manufacture-orders') {
    created = JSON.parse(req.body);
    return Promise.resolve({ number: created.number, id: 6001 });
  }
  return Promise.resolve({ ok: true });
};

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

function autoConfirm() {
  const iv = win.setInterval(() => {
    const b = D.querySelector('.ps-confirm-ok');
    if (b) { win.clearInterval(iv); b.click(); }
  }, 10);
  win.setTimeout(() => win.clearInterval(iv), 3000);
}

console.log('MODE = ' + MODE + '\n');

setTimeout(() => {
  win.setCreateMOEnabled(true);
  win.setCreateMODryRun(false);
  win.CSBuild.open('1');

  setTimeout(() => {
    const p = D.getElementById('buildPanel');
    const blockers = [...p.querySelectorAll('.pf-blocker-list li')].map(x => x.textContent);
    const warns = [...p.querySelectorAll('.pf-warn-list li')].map(x => x.textContent);

    console.log('=== blockers ===');
    blockers.forEach(b => console.log('   BLOCKER: ' + b));
    console.log('=== warnings ===');
    warns.forEach(w => console.log('   warn: ' + w));

    console.log('\n=== the false positive is gone ===');
    ok('NOTHING is refused as a staged sub-assembly',
       !blockers.some(b => /staged sub-assembly/i.test(b)),
       'this blocked every component on the real BOM');
    ok('the FINISHED GOOD is not treated as a component',
       !blockers.some(b => /PF-CUSTOM-75G/.test(b)) &&
       !warns.some(w => /PF-CUSTOM-75G/.test(w)),
       'bomComponentSQL returns it, but it is resolved from the header');
    ok('no blockers at all', blockers.length === 0, blockers.join(' | '));
    ok('no variable-quantity nag — the config set both of them',
       !warns.some(w => /variable-quantity/i.test(w)),
       'the BOM default is only a default when nothing replaced it');
    ok('the config supplied the variable quantities',
       [...p.querySelectorAll('.pf-table td.cfgq')].length >= 2,
       [...p.querySelectorAll('.pf-table td.cfgq')].length + ' config-sourced cells');
    if (MODE === 'truestage') {
      ok('a GENUINE stage bit still warns',
         warns.some(w => /staged sub-assembly on the BOM/i.test(w)));
      ok('and does not block', blockers.length === 0);
    }

    console.log('\n=== component table ===');
    const rows = p.querySelectorAll('.pf-table tbody tr');
    ok('6 components + 1 finished good', rows.length === 7, rows.length + ' rows');
    ok('no row painted as an error', p.querySelectorAll('.pf-table tr.bad-line').length === 0,
       p.querySelectorAll('.pf-table tr.bad-line').length + ' bad rows');
    ok('Create is enabled', !p.querySelector('.dsec .ps-btn.primary[disabled]'));

    autoConfirm();
    win.CSBuild.create();
    setTimeout(() => {
      console.log('\n=== payload ===');
      ok('the MO was created', !!created);
      if (!created) { console.log('\n*** ' + (fails || 1) + ' FAILED ***'); process.exitCode = 1; return; }
      ok('mo.num = so.num', created.number === 'SO-60001', created.number);
      const items = created.configurations[0].items;
      const raws = items.filter(i => i.type === 'Raw Good');
      console.log('  items: ' + items.length + ' (1 FG + ' + raws.length + ' raw)');
      raws.forEach(r => console.log('   ' + r.part.id + ' qty=' + r.quantity));
      ok('1 Finished Good', items.filter(i => i.type === 'Finished Good').length === 1);
      ok('6 Raw Goods — every component carried through', raws.length === 6, raws.length + '');
      const byId = {}; raws.forEach(r => { byId[r.part.id] = Number(r.quantity); });
      ok('RAW-MALT 1127.57x2 = 2255.14', Math.abs(byId[201] - 2255.14) < 1e-6, byId[201]);
      ok('FLV-RTU-BAN 253.25x2 = 506.5', Math.abs(byId[204] - 506.5) < 1e-6, byId[204]);
      ok('RTU-ELECTROLYTE-MIX High: config 122.28 x2 = 244.56',
         Math.abs(byId[205] - 244.56) < 1e-6, byId[205] + ' (BOM says 49.07 — the config must REPLACE it)');
      ok('RAW-CAFFEINE 100mg: config 5 x2 = 10',
         Math.abs(byId[206] - 10) < 1e-6, byId[206]);
      ok('the pack resolved in the recipe config — no fallback warning',
         !warns.some(w => /no recipe configuration for pack/i.test(w)), warns.join(' | '));
      ok('no "add the value to the configuration" warning',
         !warns.some(w => /add the value to the configuration/i.test(w)), warns.join(' | '));
      ok('issued after verification', restLog.includes('POST /api/manufacture-orders/6001/issue'),
         restLog.join(' | '));
      ok('no DELETE — read-back matched', !restLog.some(r => r.startsWith('DELETE')));

      console.log(fails ? ('\n*** ' + fails + ' FAILED ***') : '\nPASSED');
      process.exitCode = fails ? 1 : 0;
    }, 350);
  }, 220);
}, 250);
