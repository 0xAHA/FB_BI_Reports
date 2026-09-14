// One MO per SALES ORDER: mo.num = so.num, one configuration per custom line.
//
// Modes:
//   happy   - 2 custom lines -> 1 MO numbered SO-50001 with 2 configurations,
//             verified against a 2-root moitem tree, then issued.
//   suffix  - MO SO-50001 already exists covering line 1 -> the build takes
//             SO-50001-2 and covers only line 2.
//   covered - every line already covered -> nothing to build, Create disabled.
//   partial - line 2's note is unparsable -> line 1 still builds, line 2 is
//             named as excluded (never silently dropped).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const REPORT = process.argv[2];
const MODE = process.argv[3] || 'happy';

let src = fs.readFileSync(REPORT, 'utf8');
src = src.replace(/<script>\s*\{%[^%]*%\}\s*<\/script>/g, '');
src = src.replace(/<style>\s*\{%[^%]*%\}\s*<\/style>/g, '');
src = src.replace(/<script src="https:[^"]*"><\/script>/g, '');

const restLog = [];
let created = null;

// Flavour alone: it targets the BOM's FLV-RTU-* line and substitutes the part
// the BOM already carries. These fixture packs (PF75-25SRV / PF90-25SRV) are
// NOT in the recipe config, so the quantity falls back to the BOM figure and
// warns — which is the intended behaviour and keeps this suite measuring MO
// numbering rather than recipe arithmetic.
const NOTE_OK = 'Flavour: Banana';
// Off the caffeine scale. Caffeine is a CLOSED attribute, so this is an
// unknown level and the line is refused.
const NOTE_BAD = 'Caffeine: 200mg';

const SO_ROWS = [
  { so_id: 1, so_num: 'SO-50001', so_status: 20, ship_date: '2026-09-25T00:00:00',
    locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
    soitem_id: 7001, line_num: 1, note: NOTE_OK,
    qty_ordered: 2, qty_fulfilled: 0, line_status: 10,
    line_desc: 'Premium Fuel 75g 25 serve', product_num: 'PF-CUST-75-25',
    uom_id: 1, uom_code: 'ea', part_id: 900, part_num: 'PF75-25SRV',
    existing_mo_id: null, existing_mo_num: null },
  { so_id: 1, so_num: 'SO-50001', so_status: 20, ship_date: '2026-09-25T00:00:00',
    locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
    soitem_id: 7002, line_num: 2, note: (MODE === 'partial' ? NOTE_BAD : NOTE_OK),
    qty_ordered: 3, qty_fulfilled: 0, line_status: 10,
    line_desc: 'Premium Fuel 90g 25 serve', product_num: 'PF-CUST-90-25',
    uom_id: 1, uom_code: 'ea', part_id: 901, part_num: 'PF90-25SRV',
    existing_mo_id: null, existing_mo_num: null },
];

// Two BOMs, one per part. Components deliberately overlap (both use
// RAW-MALTODEXTRIN) so the order-wide total check is exercised.
const BOMS = {
  900: { bomid: 77, bomnum: 'BOM-PF75-25', fgpartid: 900, fgpartnum: 'PF75-25SRV',
         comps: [['RAW-MALTODEXTRIN', 201, 1127.57], ['FLV-RTU-BAN', 204, 253.25]] },
  901: { bomid: 78, bomnum: 'BOM-PF90-25', fgpartid: 901, fgpartnum: 'PF90-25SRV',
         comps: [['RAW-MALTODEXTRIN', 201, 1379.86], ['FLV-RTU-BAN', 204, 253.25]] },
};

// Expected order-wide totals for the happy path:
//   line1 qty2: MALTO 2255.14, FLV 506.5
//   line2 qty3: MALTO 4139.58, FLV 759.75
//   totals:     MALTO 6394.72, FLV 1266.25
const EXPECT_ALL = { 'RAW-MALTODEXTRIN': 6394.72, 'FLV-RTU-BAN': 1266.25 };
// suffix / partial build only ONE line (line 2 / line 1 respectively)
const EXPECT_LINE2 = { 'RAW-MALTODEXTRIN': 4139.58, 'FLV-RTU-BAN': 759.75 };
const EXPECT_LINE1 = { 'RAW-MALTODEXTRIN': 2255.14, 'FLV-RTU-BAN': 506.5 };

function expectedTotals() {
  if (MODE === 'suffix') return EXPECT_LINE2;
  if (MODE === 'partial') return EXPECT_LINE1;
  return EXPECT_ALL;
}
function expectedConfigs() { return (MODE === 'happy') ? 2 : 1; }

// moitem tree matching what we asked for: one typeid-50 root per config.
function moitemRows() {
  const want = expectedTotals();
  const n = expectedConfigs();
  const rows = [];
  let id = 1;
  const perConfig = Object.keys(want).map(k => [k, want[k] / n]);
  for (let c = 0; c < n; c++) {
    const rootId = id++;
    rows.push({ id: rootId, parentid: null, typeid: 50, uomid: 1, qtytofulfill: 1, part_num: '', mo_id: 5551 });
    rows.push({ id: id++, parentid: rootId, typeid: 10, uomid: 1, qtytofulfill: 1, part_num: 'FG', mo_id: 5551 });
    perConfig.forEach(([pn, q]) => {
      rows.push({ id: id++, parentid: rootId, typeid: 20, uomid: 7, qtytofulfill: q, part_num: pn, mo_id: 5551 });
    });
  }
  return rows;
}

// Pre-existing MOs, by mode.
function existingMoRows() {
  if (MODE === 'suffix') {
    return [{ mo_num: 'SO-50001', mo_status: 20, created: '2026-09-20T09:00:00',
              note: '[SUPPWO v1] so=SO-50001 lines=1 cust=Infinit by=admin 2026-09-20T09:00:00',
              created_by: 'admin', via: 'marker', line_num: null }];
  }
  if (MODE === 'covered') {
    return [{ mo_num: 'SO-50001', mo_status: 20, created: '2026-09-20T09:00:00',
              note: '[SUPPWO v1] so=SO-50001 lines=1,2 cust=Infinit by=admin 2026-09-20T09:00:00',
              created_by: 'admin', via: 'marker', line_num: null }];
  }
  return [];
}

function stubQuery(sql) {
  const s = sql.replace(/\s+/g, ' ');
  if (/FROM sostatus/i.test(s)) return [{ id: 20, name: 'Issued' }, { id: 10, name: 'Estimate' }, { id: 25, name: 'In Progress' }];
  if (/FROM usergroup\b/i.test(s)) return [{ id: 3, name: 'Production' }];
  if (/FROM usergrouprel/i.test(s)) return [{ group_id: 3 }];
  if (/FROM userproperties/i.test(s)) return [];
  if (/FROM soitem si/i.test(s)) return SO_ROWS;
  if (/FROM bom\b/i.test(s) && /fgbi/.test(s)) {
    const m = s.match(/fgbi\.partid = (\d+)/);
    const b = m && BOMS[m[1]];
    if (!b) return [];
    return [{ bomid: b.bomid, bomnum: b.bomnum, bomdesc: b.bomnum, configurable: 0,
              fgbomitemid: 1000 + b.bomid, fgqty: 1, fguomid: 1, fgdesc: b.fgpartnum, fguom: 'ea',
              fgpartid: b.fgpartid, fgpartnum: b.fgpartnum, fgpartdesc: b.fgpartnum }];
  }
  if (/FROM bomitem\b/i.test(s)) {
    const m = s.match(/bomitem\.bomid = (\d+)/);
    const b = Object.values(BOMS).find(x => String(x.bomid) === (m && m[1]));
    if (!b) return [];
    return b.comps.map(([pn, pid, q], i) => ({
      bomitemid: i + 1, bitypeid: 20, bitypename: 'Raw Good', bomqty: q,
      bomuomid: 7, bomuom: 'g', bomdesc: pn, sortid: i + 1,
      stageflag: 0, stagebomid: null, variableqty: 0, minqty: 0, maxqty: 0,
      onetimeitem: 0, partid: pid, partnum: pn, partdesc: pn, partactive: 1, convok: 1,
    }));
  }
  if (/INNER JOIN moitem mi ON mi\.moid = mo\.id/i.test(s)) return moitemRows();
  if (/'marker' AS via/i.test(s) || /UNION ALL/i.test(s)) return existingMoRows();
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
    return Promise.resolve({ number: created.number, id: 5551 });
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
const done = () => { console.log(fails ? ('\n*** ' + fails + ' FAILED ***') : '\nPASSED'); process.exitCode = fails ? 1 : 0; };
const panel = () => D.getElementById('buildPanel');

function autoConfirm() {
  const iv = win.setInterval(() => {
    const b = D.querySelector('.ps-confirm-ok');
    if (b) { win.clearInterval(iv); b.click(); }
  }, 10);
  win.setTimeout(() => win.clearInterval(iv), 3000);
}

console.log('MODE = ' + MODE + '\n');

setTimeout(() => {
  console.log('=== the Build button is on the SO row, not the lines ===');
  ok('1 SO row', D.querySelectorAll('tr.so-row').length === 1);
  ok('2 line rows', D.querySelectorAll('tr.line-row').length === 2);
  win.setCreateMOEnabled(true);
  win.setCreateMODryRun(false);
  ok('exactly 1 Build button, on the SO row',
     D.querySelectorAll('tr.so-row .row-build').length === 1 &&
     D.querySelectorAll('tr.line-row .row-build').length === 0,
     'so=' + D.querySelectorAll('tr.so-row .row-build').length +
     ' line=' + D.querySelectorAll('tr.line-row .row-build').length);

  win.CSBuild.open('1');
  setTimeout(() => {
    const p = panel();
    const blockers = [...p.querySelectorAll('.pf-blocker-list li')].map(x => x.textContent);
    console.log('\n=== drawer ===');
    console.log('  header: ' + (p.querySelector('.detail-head .sub') || {}).textContent);
    blockers.forEach(b => console.log('   BLOCKER: ' + b));

    // Every existing MO the drawer names carries its own Open MO button —
    // the reason for surfacing it is that somebody should go and look.
    const openMoBtns = [...p.querySelectorAll('.pf-existing .ps-btn')];
    if (MODE === 'suffix' || MODE === 'covered') {
      ok('the existing MO has an Open MO button', openMoBtns.length === 1,
         openMoBtns.length + ' buttons');
      ok('it says Open MO', /Open MO/.test((openMoBtns[0] || {}).textContent || ''),
         (openMoBtns[0] || {}).textContent);
      ok('and opens the MO it is next to',
         /openMO\('SO-50001'\)/.test((openMoBtns[0] || {}).getAttribute('onclick') || ''),
         (openMoBtns[0] || {}).getAttribute('onclick'));
    } else {
      ok('no existing MO, so no Open MO button', openMoBtns.length === 0,
         openMoBtns.length + ' buttons');
    }

    if (MODE === 'covered') {
      ok('nothing to build', blockers.some(b => /already covered by an MO/i.test(b)));
      ok('Create disabled', !!p.querySelector('.dsec .ps-btn.primary[disabled]'));
      ok('names the existing MO', /SO-50001/.test(p.textContent));
      return done();
    }

    ok('MO number shown in the header',
       new RegExp(MODE === 'suffix' ? 'SO-50001-2' : 'SO-50001').test(p.textContent));
    if (MODE === 'suffix') {
      ok('flags the number as suffixed', /suffixed/i.test(p.textContent));
      ok('shows the existing MO and its covered line', /lines? 1/.test(p.textContent));
    }
    if (MODE === 'partial') {
      ok('line 2 marked Blocked', /Blocked/.test(p.textContent));
      ok('names the off-scale level', /200mg/.test(p.textContent));
      ok('still offers to build the good line', !p.querySelector('.dsec .ps-btn.primary[disabled]'));
    }

    autoConfirm();
    win.CSBuild.create();
    setTimeout(() => {
      console.log('\n=== REST ===');
      restLog.forEach(r => console.log('   ' + r));
      ok('created via POST /api/manufacture-orders', restLog[0] === 'POST /api/manufacture-orders');
      ok('created as Entered', created && created.status === 'Entered', created && created.status);

      console.log('\n=== payload ===');
      console.log('  number: ' + created.number);
      console.log('  note[0]: ' + String(created.note).split('\n')[0]);
      console.log('  configurations: ' + created.configurations.length);
      created.configurations.forEach((c, i) => {
        console.log('   cfg' + i + ' bom=' + c.bom.id + ' qty=' + c.quantity +
                    ' items=' + c.items.length + ' note=' + c.note);
      });

      ok('mo.num = so.num' + (MODE === 'suffix' ? ' + suffix' : ''),
         created.number === (MODE === 'suffix' ? 'SO-50001-2' : 'SO-50001'), created.number);
      ok(expectedConfigs() + ' configuration(s) — one per built line',
         created.configurations.length === expectedConfigs(), created.configurations.length + '');
      ok('each configuration has its own BOM',
         new Set(created.configurations.map(c => c.bom.id)).size === created.configurations.length);
      ok('each configuration names its SO line',
         created.configurations.every(c => /SO line \d/.test(c.note || '')));
      ok('note records the covered lines',
         /\slines=[\d,]+/.test(created.note), String(created.note).split('\n')[0]);
      const wantLines = MODE === 'suffix' ? '2' : (MODE === 'partial' ? '1' : '1,2');
      ok('covered lines = ' + wantLines,
         new RegExp('\\slines=' + wantLines.replace(/,/g, ',') + '\\s').test(created.note));
      ok('every item has a part and uom id',
         created.configurations.every(c => c.items.every(i => i.part.id > 0 && i.uom.id > 0)));
      ok('one Finished Good per configuration',
         created.configurations.every(c => c.items.filter(i => i.type === 'Finished Good').length === 1));
      ok('quantities are strings',
         created.configurations.every(c => c.items.every(i => typeof i.quantity === 'string')));

      console.log('\n=== verify -> issue ===');
      ok('issued after verification', restLog.includes('POST /api/manufacture-orders/5551/issue'),
         restLog.join(' | '));
      ok('no DELETE', !restLog.some(r => r.startsWith('DELETE')));
      done();
    }, 350);
  }, 200);
}, 250);
