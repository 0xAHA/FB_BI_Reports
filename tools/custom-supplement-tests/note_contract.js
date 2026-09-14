// The PF-CUSTOM note contract, and the RECIPE CONFIGURATION behind it.
//
//   Flavour          open list, substitution, one mass for every flavour
//   Electrolyte Mix  Low / Med / High   -> 49.07 / 61.14 / 122.28 g per pack
//   Caffeine         0 / 25 / 50 / 75 / 100 mg per serve -> 0 / 1.3 / 2.5 / 3.8 / 5 g
//
// Every other BOM line is a fixed base ingredient, so naming one in the note
// is an unknown attribute and blocks.
//
// The point of this suite is that the variable quantities come from the recipe
// CONFIG and not from the BOM. The stub BOM therefore holds deliberately
// different figures (electrolyte 60, caffeine 2.5, flavour 250) so every
// config override is visible: if the engine ever fell back to scaling the BOM
// quantity, these assertions would all move.
//
// Under test:
//   1. the three attributes resolve to the CONFIGURED per-pack figures
//   2. the config REPLACES the BOM quantity rather than scaling it
//   3. flavour substitutes the part and never changes the mass
//   4. a substitution target missing from Fishbowl warns, keeps the BOM part
//   5. case, spacing, aliases, a bare caffeine number and the mg-per-serve
//      labels all parse
//   6. an off-scale caffeine value BLOCKS (closed attribute)
//   7. a base ingredient named in the note BLOCKS (unknown attribute)
//   8. an unmapped flavour WARNS and keeps the BOM's own flavour line
//   9. a pack with no recipe config WARNS and keeps every BOM figure
//
// The moitem read-back is generated from the payload here on purpose: this
// suite measures the recipe contract, and the verification path has its own
// independent expectations in realbom.js and stage_moper_so.js.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const REPORT = process.argv[2];

let src = fs.readFileSync(REPORT, 'utf8');
src = src.replace(/<script>\s*\{%[^%]*%\}\s*<\/script>/g, '');
src = src.replace(/<style>\s*\{%[^%]*%\}\s*<\/style>/g, '');
src = src.replace(/<script src="https:[^"]*"><\/script>/g, '');

const restLog = [];
let created = null;

// One SO, one line per case, qty 1 everywhere so the arithmetic is readable.
// Part 900 = PF-CUSTOM-75G and 901 = PF-CUSTOM-90G are both in the recipe
// config; 902 = PF-CUSTOM-XX deliberately is not.
const CASES = [
  [1, 900, 'Flavour: Banana, Electrolyte Mix: Med, Caffeine: 100mg'],
  [2, 900, 'Flavour: Banana, Electrolyte Mix: Low, Caffeine: 25mg'],
  [3, 900, 'electrolyte: high, caffeine: 50 mg, flavor: BANANA'],
  [4, 900, 'Caffeine: 200mg'],
  [5, 900, 'Sweetness: High, Electrolyte Mix: Med'],
  [6, 900, 'Flavour: Choc Mint, Caffeine: 0mg'],
  [7, 900, 'Electrolyte Mix: Medium'],
  [8, 900, 'Caffeine: None'],
  [9, 902, 'Caffeine: 50mg'],
  [10, 900, 'Flavour: Chocolate, Electrolyte Mix: Low'],
  [11, 900, 'Flavour: Orange, Caffeine: 75mg'],
  [12, 901, 'Electrolyte Mix: 500mg, Caffeine: 75'],
];

const PART_NUM = { 900: 'PF-CUSTOM-75G', 901: 'PF-CUSTOM-90G', 902: 'PF-CUSTOM-XX' };

const SO_ROWS = CASES.map(([ln, pid, note]) => ({
  so_id: 1, so_num: 'SO-70001', so_status: 20, ship_date: '2026-09-25T00:00:00',
  locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
  soitem_id: 8100 + ln, line_num: ln, note: note,
  qty_ordered: 1, qty_fulfilled: 0, line_status: 10,
  line_desc: 'Premium Fuel custom', product_num: 'PF-CUST-' + pid,
  uom_id: 1, uom_code: 'ea', part_id: pid, part_num: PART_NUM[pid],
  existing_mo_id: null, existing_mo_num: null,
}));

// One BOM shape for every pack: a fixed base ingredient plus the three
// variable lines. The figures are deliberately NOT the configured ones.
const COMPS = [
  ['RAW-MALT',            201, 1000, 0],
  ['FLV-RTU-BAN',         204, 250,  0],
  ['RTU-ELECTROLYTE-MIX', 205, 60,   1],
  ['RAW-CAFFEINE',        206, 2.5,  1],
];
const BOMS = { 900: 77, 901: 78, 902: 79 };

// The parts the recipe config can name, as they exist in Fishbowl. FLV-RTU-ORG
// is deliberately ABSENT so an unresolvable substitution can be exercised.
const CONFIG_PARTS = [
  { partid: 204, partnum: 'FLV-RTU-BAN',         uomid: 7, uomcode: 'g', partactive: 1 },
  { partid: 207, partnum: 'FLV-RTU-CHOC',        uomid: 7, uomcode: 'g', partactive: 1 },
  { partid: 205, partnum: 'RTU-ELECTROLYTE-MIX', uomid: 7, uomcode: 'g', partactive: 1 },
  { partid: 206, partnum: 'RAW-CAFFEINE',        uomid: 7, uomcode: 'g', partactive: 1 },
];

const PART_NUM_BY_ID = { 900: 'PF-CUSTOM-75G', 901: 'PF-CUSTOM-90G', 902: 'PF-CUSTOM-XX', 207: 'FLV-RTU-CHOC' };
COMPS.forEach(([pn, pid]) => { PART_NUM_BY_ID[pid] = pn; });

function bomComps() {
  return COMPS.map(([pn, pid, q, varq], i) => ({
    bomitemid: i + 1, bitypeid: 20, bitypename: 'Raw Good',
    bomqty: q, bomuomid: 7, bomuom: 'g', bomdesc: pn, sortid: i + 1,
    stageflag: 0, stagebomid: null, variableqty: varq,
    minqty: 0, maxqty: 0, onetimeitem: 0,
    partid: pid, partnum: pn, partdesc: pn, partactive: 1, convok: 1,
  }));
}

function moitemFromCreated() {
  if (!created) return [];
  const rows = [];
  let id = 1;
  created.configurations.forEach(cfg => {
    const root = id++;
    rows.push({ id: root, parentid: null, typeid: 50, uomid: 1, qtytofulfill: 1, part_num: '', mo_id: 7001 });
    cfg.items.forEach(it => {
      rows.push({
        id: id++, parentid: root,
        typeid: it.type === 'Finished Good' ? 10 : 20,
        uomid: it.uom.id, qtytofulfill: Number(it.quantity),
        part_num: PART_NUM_BY_ID[it.part.id] || '', mo_id: 7001,
      });
    });
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
  // The recipe-config part lookup.
  if (/FROM part\b/i.test(s) && /part\.num IN/i.test(s)) {
    return CONFIG_PARTS.filter(p => s.indexOf("'" + p.partnum + "'") !== -1);
  }
  if (/FROM bom\b/i.test(s) && /fgbi/.test(s)) {
    const m = s.match(/fgbi\.partid = (\d+)/);
    const bid = m && BOMS[m[1]];
    if (!bid) return [];
    return [{ bomid: bid, bomnum: 'BOM-' + PART_NUM[m[1]], bomdesc: 'x', configurable: 0,
              fgbomitemid: 1000 + bid, fgqty: 1, fguomid: 1,
              fgdesc: PART_NUM[m[1]], fguom: 'ea',
              fgpartid: Number(m[1]), fgpartnum: PART_NUM[m[1]], fgpartdesc: PART_NUM[m[1]] }];
  }
  if (/FROM bomitem\b/i.test(s)) return bomComps();
  if (/INNER JOIN moitem mi ON mi\.moid = mo\.id/i.test(s)) return moitemFromCreated();
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
    return Promise.resolve({ number: created.number, id: 7001 });
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

const DOC = win.document;
let fails = 0;
const ok = (l, c, e) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + l + (e ? '  [' + e + ']' : '')); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;

function autoConfirm() {
  const iv = win.setInterval(() => {
    const b = DOC.querySelector('.ps-confirm-ok');
    if (b) { win.clearInterval(iv); b.click(); }
  }, 10);
  win.setTimeout(() => win.clearInterval(iv), 3000);
}

// Per-line drawer sections, keyed by SO line number.
function sections() {
  const out = {};
  [...DOC.getElementById('buildPanel').querySelectorAll('.dsec')].forEach(d => {
    const h = d.querySelector('h4');
    const m = h && h.textContent.match(/Line\s+(\d+)/);
    if (!m) return;
    out[Number(m[1])] = {
      blockers: [...d.querySelectorAll('.pf-blocker-list li')].map(x => x.textContent),
      warns: [...d.querySelectorAll('.pf-warn-list li')].map(x => x.textContent),
      cfgCells: [...d.querySelectorAll('.pf-table td.cfgq')].map(x => x.textContent.trim()),
      parts: [...d.querySelectorAll('.pf-table .pf-partn')].map(x => x.textContent.trim()),
      text: d.textContent,
    };
  });
  return out;
}

setTimeout(() => {
  win.setCreateMOEnabled(true);
  win.setCreateMODryRun(false);
  win.CSBuild.open('1');

  setTimeout(() => {
    const S = sections();
    Object.keys(S).forEach(k => {
      S[k].blockers.forEach(b => console.log('  L' + k + ' BLOCKER: ' + b));
      S[k].warns.forEach(w => console.log('  L' + k + ' warn:    ' + w));
    });

    console.log('\n=== only the three attributes are accepted ===');
    ok('L4 off-scale caffeine BLOCKS',
       S[4].blockers.some(b => /Unknown level "200mg" for Caffeine/.test(b)),
       S[4].blockers.join(' | '));
    ok('L4 names the whole scale',
       S[4].blockers.some(b => /0mg \/ 25mg \/ 50mg \/ 75mg \/ 100mg/.test(b)));
    ok('L5 a base ingredient in the note BLOCKS',
       S[5].blockers.some(b => /Unknown attribute "Sweetness"/.test(b)),
       S[5].blockers.join(' | '));
    ok('L5 says what IS customisable',
       S[5].blockers.some(b => /Flavour \/ Electrolyte Mix \/ Caffeine/.test(b)));

    console.log('\n=== warnings, not blockers ===');
    ok('L6 unmapped flavour WARNS',
       S[6].warns.some(w => /Flavour "Choc Mint" is not mapped to a part/.test(w)),
       S[6].warns.join(' | '));
    ok('L6 is still buildable', S[6].blockers.length === 0, S[6].blockers.join(' | '));
    ok('L9 a pack with no recipe config WARNS',
       S[9].warns.some(w => /no recipe configuration for pack "PF-CUSTOM-XX"/.test(w)),
       S[9].warns.join(' | '));
    ok('L9 is still buildable', S[9].blockers.length === 0, S[9].blockers.join(' | '));
    ok('L11 a substitution target missing from Fishbowl WARNS',
       S[11].warns.some(w => /needs part FLV-RTU-ORG, which is not in Fishbowl/.test(w)),
       S[11].warns.join(' | '));
    ok('L11 is still buildable', S[11].blockers.length === 0, S[11].blockers.join(' | '));

    console.log('\n=== the config is visibly the source ===');
    ok('L1 marks 3 config-sourced quantities', S[1].cfgCells.length === 3, S[1].cfgCells.join(' / '));
    ok('L9 marks NONE — it fell back to the BOM', S[9].cfgCells.length === 0, S[9].cfgCells.join(' / '));
    ok('L9 says the BOM default was not replaced',
       S[9].warns.some(w => /variable-quantity BOM line/.test(w)), S[9].warns.join(' | '));
    ok('L1 no variable-quantity nag — the config set them',
       !S[1].warns.some(w => /variable-quantity BOM line/.test(w)), S[1].warns.join(' | '));

    console.log('\n=== flavour substitution ===');
    ok('L10 swapped in FLV-RTU-CHOC',
       S[10].parts.indexOf('FLV-RTU-CHOC') !== -1, S[10].parts.join(' / '));
    ok('L10 says what it replaced', /replaces FLV-RTU-BAN/.test(S[10].text));
    ok('L11 kept FLV-RTU-BAN — the target does not exist',
       S[11].parts.indexOf('FLV-RTU-BAN') !== -1 && S[11].parts.indexOf('FLV-RTU-ORG') === -1,
       S[11].parts.join(' / '));

    console.log('\n=== clean lines have no noise ===');
    ok('L1 no blockers', S[1].blockers.length === 0, S[1].blockers.join(' | '));
    ok('L1 no warnings at all', S[1].warns.length === 0, S[1].warns.join(' | '));
    ok('L3 (aliases / case / spacing) parsed', S[3].blockers.length === 0, S[3].blockers.join(' | '));
    ok('L7 "Medium" resolved as Med', S[7].blockers.length === 0, S[7].blockers.join(' | '));
    ok('L8 "None" resolved as 0mg', S[8].blockers.length === 0, S[8].blockers.join(' | '));
    ok('L12 the mg-per-serve labels resolved', S[12].blockers.length === 0, S[12].blockers.join(' | '));

    autoConfirm();
    win.CSBuild.create();

    setTimeout(() => {
      ok('the MO was created', !!created);
      if (!created) { console.log('\n*** ' + (fails || 1) + ' FAILED ***'); process.exitCode = 1; return; }

      // Map each configuration back to its SO line via cfg.note.
      const byLine = {};
      created.configurations.forEach(c => {
        const m = String(c.note || '').match(/SO line (\d+)/);
        if (!m) return;
        const q = {};
        c.items.forEach(it => {
          if (it.type === 'Finished Good') return;
          q[PART_NUM_BY_ID[it.part.id]] = Number(it.quantity);
        });
        byLine[Number(m[1])] = q;
      });
      console.log('\n=== resolved quantities per line ===');
      Object.keys(byLine).sort((a, b) => a - b).forEach(k => {
        console.log('  L' + k + ': ' + JSON.stringify(byLine[k]));
      });

      ok('10 configurations — the two bad lines are excluded',
         created.configurations.length === 10, created.configurations.length + '');
      ok('line 4 is not in the payload', !byLine[4]);
      ok('line 5 is not in the payload', !byLine[5]);

      console.log('\n=== Caffeine: the CONFIGURED grams per pack ===');
      ok('L1 100mg -> 5 g (BOM says 2.5)', near(byLine[1]['RAW-CAFFEINE'], 5), byLine[1]['RAW-CAFFEINE']);
      ok('L2 25mg  -> 1.3 g',              near(byLine[2]['RAW-CAFFEINE'], 1.3), byLine[2]['RAW-CAFFEINE']);
      ok('L3 50mg  -> 2.5 g',              near(byLine[3]['RAW-CAFFEINE'], 2.5), byLine[3]['RAW-CAFFEINE']);
      ok('L11 75mg -> 3.8 g',              near(byLine[11]['RAW-CAFFEINE'], 3.8), byLine[11]['RAW-CAFFEINE']);
      ok('L6 0mg drops the caffeine line entirely',
         byLine[6]['RAW-CAFFEINE'] === undefined, String(byLine[6]['RAW-CAFFEINE']));
      ok('L8 "None" drops it too',
         byLine[8]['RAW-CAFFEINE'] === undefined, String(byLine[8]['RAW-CAFFEINE']));
      ok('L9 unconfigured pack keeps the BOM 2.5, not a guess',
         near(byLine[9]['RAW-CAFFEINE'], 2.5), byLine[9]['RAW-CAFFEINE']);

      console.log('\n=== Electrolyte Mix: the CONFIGURED grams per pack ===');
      ok('L1 Med  -> 61.14  (BOM says 60)', near(byLine[1]['RTU-ELECTROLYTE-MIX'], 61.14), byLine[1]['RTU-ELECTROLYTE-MIX']);
      ok('L2 Low  -> 49.07',                near(byLine[2]['RTU-ELECTROLYTE-MIX'], 49.07), byLine[2]['RTU-ELECTROLYTE-MIX']);
      ok('L3 High -> 122.28',               near(byLine[3]['RTU-ELECTROLYTE-MIX'], 122.28), byLine[3]['RTU-ELECTROLYTE-MIX']);
      ok('L7 "Medium" -> 61.14',            near(byLine[7]['RTU-ELECTROLYTE-MIX'], 61.14), byLine[7]['RTU-ELECTROLYTE-MIX']);
      ok('L12 "500mg" -> 61.14',            near(byLine[12]['RTU-ELECTROLYTE-MIX'], 61.14), byLine[12]['RTU-ELECTROLYTE-MIX']);
      ok('L6 no electrolyte attribute -> the BOM 60 is untouched',
         near(byLine[6]['RTU-ELECTROLYTE-MIX'], 60), byLine[6]['RTU-ELECTROLYTE-MIX']);
      ok('L9 unconfigured pack keeps the BOM 60',
         near(byLine[9]['RTU-ELECTROLYTE-MIX'], 60), byLine[9]['RTU-ELECTROLYTE-MIX']);

      console.log('\n=== Flavour: one mass, whichever flavour ===');
      ok('L1 Banana     -> 253.25 (BOM says 250)', near(byLine[1]['FLV-RTU-BAN'], 253.25), byLine[1]['FLV-RTU-BAN']);
      ok('L10 Chocolate -> 253.25 on FLV-RTU-CHOC',
         near(byLine[10]['FLV-RTU-CHOC'], 253.25) && byLine[10]['FLV-RTU-BAN'] === undefined,
         JSON.stringify(byLine[10]));
      ok('L11 Orange    -> 253.25, still on FLV-RTU-BAN',
         near(byLine[11]['FLV-RTU-BAN'], 253.25), byLine[11]['FLV-RTU-BAN']);
      ok('L6 unmapped flavour keeps the BOM 250',
         near(byLine[6]['FLV-RTU-BAN'], 250), byLine[6]['FLV-RTU-BAN']);

      console.log('\n=== base ingredients are never touched ===');
      [1, 2, 3, 6, 7, 8, 9, 10, 11, 12].forEach(ln => {
        ok('L' + ln + ' RAW-MALT = 1000', near(byLine[ln]['RAW-MALT'], 1000), byLine[ln]['RAW-MALT']);
      });

      ok('mo.num = so.num', created.number === 'SO-70001', created.number);
      ok('issued after verification', restLog.includes('POST /api/manufacture-orders/7001/issue'),
         restLog.join(' | '));
      ok('no DELETE — read-back matched', !restLog.some(r => r.startsWith('DELETE')));

      console.log(fails ? ('\n*** ' + fails + ' FAILED ***') : '\nPASSED');
      process.exitCode = fails ? 1 : 0;
    }, 400);
  }, 300);
}, 300);
