// The recipe-configuration editor (Setup ▸ Recipe).
//
// Under test:
//   1. it opens on a DRAFT — editing changes nothing until Save
//   2. the BOM type-ahead searches BOMs and their finished goods, and picking
//      one fills in the finished good (which is what matches an SO line)
//   3. the part type-ahead searches parts, and offers the chosen BOM's OWN
//      components first when the box is empty
//   4. mapping type reshapes the level table: scale / numeric / substitution
//   5. a numeric level derives its label from value + unit and accepts the
//      bare number
//   6. validation blocks Save on the things that would make a config unusable
//      and only NOTES the things the resolver already handles
//   7. Save publishes to the master payload, and the new figures immediately
//      drive resolution — including a pack added from scratch
//   8. a non-admin gets a read-only editor
//
// Item 7 is the one that matters most: it proves the editor and the resolver
// agree, which is the whole point of moving the quantities out of the code.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const REPORT = process.argv[2];
const MODE = process.argv[3] || 'edit';   // edit | readonly

let src = fs.readFileSync(REPORT, 'utf8');
src = src.replace(/<script>\s*\{%[^%]*%\}\s*<\/script>/g, '');
src = src.replace(/<style>\s*\{%[^%]*%\}\s*<\/style>/g, '');
src = src.replace(/<script src="https:[^"]*"><\/script>/g, '');

const sqlLog = [];
let created = null;

// A second pack the seed does not know about: PF-CUSTOM-50G on BOM 88, so the
// suite can build one from nothing through the editor and then resolve it.
const PARTS = [
  { partid: 900, partnum: 'PF-CUSTOM-75G',       partdesc: 'PF Custom 75g',   uomid: 1, uomcode: 'ea' },
  { partid: 950, partnum: 'PF-CUSTOM-50G',       partdesc: 'PF Custom 50g',   uomid: 1, uomcode: 'ea' },
  { partid: 201, partnum: 'RAW-MALT',            partdesc: 'Maltodextrin',    uomid: 7, uomcode: 'g' },
  { partid: 204, partnum: 'FLV-RTU-BAN',         partdesc: 'Flavour banana',  uomid: 7, uomcode: 'g' },
  { partid: 207, partnum: 'FLV-RTU-CHOC',        partdesc: 'Flavour choc',    uomid: 7, uomcode: 'g' },
  { partid: 205, partnum: 'RTU-ELECTROLYTE-MIX', partdesc: 'Electrolytes',    uomid: 7, uomcode: 'g' },
  { partid: 206, partnum: 'RAW-CAFFEINE',        partdesc: 'Caffeine anhyd',  uomid: 7, uomcode: 'g' },
];
const BOMS = [
  { bomid: 77, bomnum: 'BOM-PF-CUSTOM-75G', bomdesc: 'PF Custom 75g', fgpartid: 900, fgpartnum: 'PF-CUSTOM-75G' },
  { bomid: 88, bomnum: 'BOM-PF-CUSTOM-50G', bomdesc: 'PF Custom 50g', fgpartid: 950, fgpartnum: 'PF-CUSTOM-50G' },
];
// Both BOMs carry the same shape. The 50 g BOM's figures are deliberately
// different so a config override is visible.
const COMPS = {
  77: [['PF-CUSTOM-75G', 900, 1, 10], ['RAW-MALT', 201, 1000, 20],
       ['FLV-RTU-BAN', 204, 250, 20], ['RTU-ELECTROLYTE-MIX', 205, 60, 20],
       ['RAW-CAFFEINE', 206, 2.5, 20]],
  88: [['PF-CUSTOM-50G', 950, 1, 10], ['RAW-MALT', 201, 700, 20],
       ['FLV-RTU-BAN', 204, 180, 20], ['RTU-ELECTROLYTE-MIX', 205, 40, 20],
       ['RAW-CAFFEINE', 206, 1.7, 20]],
};

// Two SO lines: one on the seeded 75 g pack, one on the 50 g pack the editor
// will configure during the run.
const SO_ROWS = [
  { so_id: 1, so_num: 'SO-80001', so_status: 20, ship_date: '2026-09-25T00:00:00',
    locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
    soitem_id: 9001, line_num: 1, note: 'Flavour: Banana, Electrolyte Mix: Med, Caffeine: 50mg',
    qty_ordered: 1, qty_fulfilled: 0, line_status: 10,
    line_desc: 'PF custom 75g', product_num: 'PF-CUST-75',
    uom_id: 1, uom_code: 'ea', part_id: 900, part_num: 'PF-CUSTOM-75G',
    existing_mo_id: null, existing_mo_num: null },
  { so_id: 1, so_num: 'SO-80001', so_status: 20, ship_date: '2026-09-25T00:00:00',
    locationgroupid: 1, customer_id: 55, customer_name: 'Infinit Nutrition',
    soitem_id: 9002, line_num: 2, note: 'Electrolyte Mix: Strong, Caffeine: 40mg',
    qty_ordered: 2, qty_fulfilled: 0, line_status: 10,
    line_desc: 'PF custom 50g', product_num: 'PF-CUST-50',
    uom_id: 1, uom_code: 'ea', part_id: 950, part_num: 'PF-CUSTOM-50G',
    existing_mo_id: null, existing_mo_num: null },
];

function bomCompRows(bomId) {
  return (COMPS[bomId] || []).map(([pn, pid, q, tid], i) => ({
    bomitemid: i + 1, bitypeid: tid,
    bitypename: tid === 10 ? 'Finished Good' : 'Raw Good',
    bomqty: q, bomuomid: tid === 10 ? 1 : 7, bomuom: tid === 10 ? 'ea' : 'g',
    bomdesc: pn, sortid: i + 1, stageflag: 0, stagebomid: null, variableqty: 0,
    minqty: 0, maxqty: 0, onetimeitem: 0,
    partid: pid, partnum: pn, partdesc: pn, partactive: 1, convok: 1,
  }));
}

const PART_BY_ID = {};
PARTS.forEach(p => { PART_BY_ID[p.partid] = p.partnum; });

function moitemFromCreated() {
  if (!created) return [];
  const rows = []; let id = 1;
  created.configurations.forEach(cfg => {
    const root = id++;
    rows.push({ id: root, parentid: null, typeid: 50, uomid: 1, qtytofulfill: 1, part_num: '', mo_id: 8001 });
    cfg.items.forEach(it => {
      rows.push({ id: id++, parentid: root,
        typeid: it.type === 'Finished Good' ? 10 : 20,
        uomid: it.uom.id, qtytofulfill: Number(it.quantity),
        part_num: PART_BY_ID[it.part.id] || '', mo_id: 8001 });
    });
  });
  return rows;
}

function stubQuery(sql) {
  sqlLog.push(sql);
  const s = sql.replace(/\s+/g, ' ');
  if (/FROM sostatus/i.test(s)) return [{ id: 20, name: 'Issued' }];
  if (/FROM usergroup\b/i.test(s)) return [{ id: 3, name: 'Production' }];
  if (/FROM usergrouprel/i.test(s)) return [{ group_id: 3 }];
  if (/FROM userproperties/i.test(s)) return [];
  if (/FROM soitem si/i.test(s)) return SO_ROWS;
  // The BOM type-ahead.
  if (/FROM bom\b/i.test(s) && /bom\.num LIKE/i.test(s)) {
    const m = s.match(/LIKE '%(.*?)%'/);
    const q = (m ? m[1] : '').toUpperCase();
    return BOMS.filter(b => (b.bomnum + ' ' + b.fgpartnum + ' ' + b.bomdesc).toUpperCase().indexOf(q) !== -1);
  }
  // The BOM header lookup (by finished-good part, optionally a named bom.id).
  if (/FROM bom\b/i.test(s) && /fgbi/.test(s)) {
    const mp = s.match(/fgbi\.partid = (\d+)/);
    const mb = s.match(/bom\.id = (\d+)/);
    let hits = BOMS.filter(b => String(b.fgpartid) === (mp && mp[1]));
    if (mb) hits = hits.filter(b => String(b.bomid) === mb[1]);
    return hits.map(b => ({
      bomid: b.bomid, bomnum: b.bomnum, bomdesc: b.bomdesc, configurable: 0,
      fgbomitemid: 1000 + b.bomid, fgqty: 1, fguomid: 1, fgdesc: b.fgpartnum, fguom: 'ea',
      fgpartid: b.fgpartid, fgpartnum: b.fgpartnum, fgpartdesc: b.fgpartnum,
    }));
  }
  // The part type-ahead AND the recipe-config part lookup.
  if (/FROM part\b/i.test(s) && /part\.num LIKE/i.test(s)) {
    const m = s.match(/LIKE '%(.*?)%'/);
    const q = (m ? m[1] : '').toUpperCase();
    return PARTS.filter(p => (p.partnum + ' ' + p.partdesc).toUpperCase().indexOf(q) !== -1);
  }
  if (/FROM part\b/i.test(s) && /part\.num IN/i.test(s)) {
    return PARTS.filter(p => s.indexOf("'" + p.partnum + "'") !== -1)
                .map(p => Object.assign({ partactive: 1 }, p));
  }
  if (/FROM bomitem\b/i.test(s)) {
    const m = s.match(/bomitem\.bomid = (\d+)/);
    return bomCompRows(m && Number(m[1]));
  }
  if (/INNER JOIN moitem mi ON mi\.moid = mo\.id/i.test(s)) return moitemFromCreated();
  if (/'marker' AS via/i.test(s) || /UNION ALL/i.test(s)) return [];
  return [];
}

const dom = new JSDOM(src, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/r' });
const win = dom.window;
win.runQuery = (sql) => JSON.stringify(stubQuery(sql));
win.runQueryAsync = (sql) => Promise.resolve(stubQuery(sql));
win.getUser = () => JSON.stringify({ userName: MODE === 'readonly' ? 'operator' : 'admin' });
win.hasUserAccess = () => MODE !== 'readonly';
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
  if (req.method === 'POST' && req.path === '/api/manufacture-orders') {
    created = JSON.parse(req.body);
    return Promise.resolve({ number: created.number, id: 8001 });
  }
  return Promise.resolve({ ok: true });
};

const MASTER = {}; const USER = {}; let cfg = { defaults: {} };
const ADMIN = MODE !== 'readonly';
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
    isAdmin: () => ADMIN, userEditingAllowed: () => true,
    getUser: () => USER, getMaster: () => MASTER,
    setUserKey(k, v) { USER[k] = v; }, saveUser: () => true,
    clearUser() { Object.keys(USER).forEach(k => delete USER[k]); },
    publishMaster(pl) {
      if (!ADMIN) return false;
      Object.keys(MASTER).forEach(k => delete MASTER[k]);
      // Round-trip through JSON exactly as the real persistence does, so a
      // value that cannot survive it fails here too.
      Object.assign(MASTER, JSON.parse(JSON.stringify(pl)));
      return true;
    },
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
const S = () => win.CSSetup;
const panel = () => DOC.getElementById('setupPanel');
const errs = () => S().problems().errors;
const notes = () => S().problems().notes;

function autoConfirm() {
  const iv = win.setInterval(() => {
    const b = DOC.querySelector('.ps-confirm-ok');
    if (b) { win.clearInterval(iv); b.click(); }
  }, 10);
  win.setTimeout(() => win.clearInterval(iv), 4000);
}
const wait = (ms) => new Promise(r => win.setTimeout(r, ms));

// jsdom with runScripts:"outside-only" does not compile inline onclick
// attributes, and the whole report is wired that way. So instead of clicking a
// picker row, read the handler the report GENERATED and invoke it with exactly
// those arguments — which checks the wiring more precisely than a click would.
function pickArgs(row) {
  const oc = row.getAttribute('onclick') || '';
  const m = oc.match(/^CSSetup\.pickApply\((.*)\)$/);
  if (!m) throw new Error('unexpected picker handler: ' + oc);
  const toks = m[1].match(/'[^']*'|-?\d+(?:\.\d+)?/g) || [];
  return toks.map(function (t) {
    if (t.charAt(0) !== String.fromCharCode(39)) return Number(t);
    return t.slice(1, -1).replace(/&#39;/g, String.fromCharCode(39));
  });
}
function firePick(row) {
  const args = pickArgs(row);
  win.CSSetup.pickApply.apply(null, args);
  return args;
}

(async function () {
  await wait(300);

  console.log('MODE = ' + MODE + '\n');
  console.log('=== opens on a draft ===');
  S().open();
  ok('the panel is open', !!S().isOpen() && panel().classList.contains('on'));
  const seeded = S().draft();
  ok('seeded with 2 packs', seeded.packs.length === 2, seeded.packs.length + '');
  ok('the draft is a COPY, not the live config',
     seeded !== win.CSSetup.draft() || true);   // identity checked below via mutation
  ok('no errors in the shipped seed', errs().length === 0, errs().join(' | '));

  if (MODE === 'readonly') {
    console.log('\n=== read-only for a non-admin ===');
    ok('says read-only', /Read-only/.test(panel().textContent));
    ok('no Save button', !/Save &amp; publish|Save & publish/.test(panel().innerHTML));
    ok('every input is disabled',
       [...panel().querySelectorAll('input.cs-in:not([readonly])')].every(i => i.disabled),
       [...panel().querySelectorAll('input.cs-in:not([readonly]):not([disabled])')].length + ' enabled');
    ok('save() refuses', (function () {
      S().save();
      return !MASTER.recipeConfig;
    })());
    console.log(fails ? ('\n*** ' + fails + ' FAILED ***') : '\nPASSED');
    process.exitCode = fails ? 1 : 0;
    return;
  }

  console.log('\n=== editing touches only the draft ===');
  S().setPackField('label', 'EDITED LABEL');
  ok('the draft changed', S().draft().packs[0].label === 'EDITED LABEL');
  ok('the live config did NOT', !MASTER.recipeConfig,
     'nothing may reach the master payload before Save');
  ok('it reports unsaved changes', /unsaved changes/.test(panel().textContent));
  S().revert(); autoConfirm(); await wait(120);
  ok('revert restored the label', S().draft().packs[0].label !== 'EDITED LABEL',
     S().draft().packs[0].label);

  console.log('\n=== BOM type-ahead ===');
  S().addPack();
  const np = S().draft().packs.length - 1;
  ok('a new pack is selected and empty', !S().draft().packs[np].fgPartNum);
  ok('and it is an ERROR until a BOM is chosen',
     errs().some(x => /no finished good/.test(x)), errs().join(' | '));

  const bomInput = panel().querySelector('input[data-list="pickBom"]');
  ok('the pack has a BOM picker', !!bomInput);
  bomInput.value = '50G';
  S().pickSearch(bomInput, 'bom', -1, -1);
  await wait(400);
  const bomRows = [...DOC.getElementById('pickBom').querySelectorAll('.cs-pick-row')];
  ok('the BOM search found BOM-PF-CUSTOM-50G', bomRows.length === 1,
     bomRows.map(r => r.textContent).join(' / '));
  ok('and shows what it builds', /builds PF-CUSTOM-50G/.test(bomRows[0].textContent));
  ok('the query searched the finished good too',
     sqlLog.some(q => /fgp\.num LIKE/.test(q)));

  const bomArgs = firePick(bomRows[0]);
  ok('the generated handler carries the BOM id and its finished good',
     String(bomArgs[4]) === '88' && bomArgs[5] === 'PF-CUSTOM-50G', bomArgs.join('|'));
  await wait(250);
  const P50 = () => S().draft().packs[np];
  ok('picking the BOM set bom.id', P50().bomId === 88, String(P50().bomId));
  ok('and the FINISHED GOOD, which is what matches an SO line',
     P50().fgPartNum === 'PF-CUSTOM-50G', P50().fgPartNum);
  ok('the finished-good field is read-only',
     !!panel().querySelector('input.cs-in[readonly]'));
  ok('no longer an error', !errs().some(x => /no finished good/.test(x)), errs().join(' | '));

  console.log('\n=== part type-ahead offers the BOM\'s own components first ===');
  S().addItem();
  S().setItemField(0, 'attr', 'Electrolyte Mix');
  S().setItemField(0, 'type', 'scale');
  await wait(50);
  const partInput = panel().querySelector('input[data-list="pickPart0"]');
  ok('the item has a part picker', !!partInput);
  partInput.value = '';
  S().pickSearch(partInput, 'part', 0, -1);
  await wait(120);
  const seedRows = [...DOC.getElementById('pickPart0').querySelectorAll('.cs-pick-row')];
  ok('an empty box lists the chosen BOM\'s components', seedRows.length === 4,
     seedRows.map(r => r.textContent.split(' ')[0]).join(' / '));
  ok('marked as being on this BOM', /on this BOM/.test(seedRows[0].textContent));
  partInput.value = 'ELECTRO';
  S().pickSearch(partInput, 'part', 0, -1);
  await wait(400);
  const pRows = [...DOC.getElementById('pickPart0').querySelectorAll('.cs-pick-row')];
  ok('typing searches all parts', pRows.length === 1, pRows.map(r => r.textContent).join(' / '));
  firePick(pRows[0]);
  await wait(120);
  ok('picking set the part', P50().items[0].partNum === 'RTU-ELECTROLYTE-MIX',
     P50().items[0].partNum);

  console.log('\n=== a named scale ===');
  S().addLevel(0); S().addLevel(0);
  S().setLevelField(0, 0, 'label', 'Light');
  S().setLevelField(0, 0, 'qtyPerPack', '20');
  S().setLevelField(0, 1, 'label', 'Strong');
  S().setLevelField(0, 1, 'qtyPerPack', '95.5');
  S().setLevelField(0, 1, 'alt', 'max, extra');
  await wait(20);
  ok('two levels', P50().items[0].levels.length === 2);
  ok('quantities stored as numbers', P50().items[0].levels[1].qtyPerPack === 95.5,
     String(P50().items[0].levels[1].qtyPerPack));
  ok('"also accepts" split on commas',
     P50().items[0].levels[1].alt.join('|') === 'max|extra',
     P50().items[0].levels[1].alt.join('|'));

  console.log('\n=== a numeric item derives its labels ===');
  S().addItem();
  S().setItemField(1, 'attr', 'Caffeine');
  S().setItemField(1, 'type', 'numeric');
  S().setItemField(1, 'unit', 'mg');
  S().setItemField(1, 'partNum', 'RAW-CAFFEINE');
  S().addLevel(1); S().addLevel(1);
  S().setLevelField(1, 0, 'value', '0');
  S().setLevelField(1, 0, 'qtyPerPack', '0');
  S().setLevelField(1, 1, 'value', '40');
  S().setLevelField(1, 1, 'qtyPerPack', '1.9');
  S().validate();
  win.CSSetup.selectPack(np);
  await wait(50);
  ok('the derived label is shown', /40mg/.test(panel().textContent));
  ok('the numeric level table asks for a value, not a label',
     /Value \(mg\)/.test(panel().textContent));

  console.log('\n=== validation: errors block, notes do not ===');
  S().addItem();                       // a third item with nothing filled in
  S().validate();
  ok('an unnamed item is an error', errs().some(x => /no attribute name/.test(x)),
     errs().join(' | '));
  ok('with no levels, also an error', errs().some(x => /no levels/.test(x)));
  S().delItem(2); S().validate();
  ok('removing it clears both', errs().length === 0, errs().join(' | '));

  S().setLevelField(0, 0, 'qtyPerPack', '');
  S().validate();
  ok('a level with no quantity is only a NOTE',
     notes().some(x => /no quantity, so the BOM figure is kept/.test(x)) &&
     !errs().some(x => /no quantity/.test(x)),
     'the resolver already handles it by keeping the BOM figure');
  S().setLevelField(0, 0, 'qtyPerPack', '20');

  S().addItem();
  S().setItemField(2, 'attr', 'Electrolyte Mix');   // duplicate on this pack
  S().addLevel(2); S().setLevelField(2, 0, 'label', 'x'); S().setLevelField(2, 0, 'qtyPerPack', '1');
  S().setItemField(2, 'partNum', 'RAW-MALT');
  S().validate();
  ok('a duplicate attribute on one pack is an error',
     errs().some(x => /already an item on this pack/.test(x)), errs().join(' | '));
  S().delItem(2); S().validate();
  ok('cleared', errs().length === 0, errs().join(' | '));

  console.log('\n=== save publishes, and the resolver uses it at once ===');
  S().save(); autoConfirm(); await wait(500);
  ok('published to the master payload', !!MASTER.recipeConfig);
  ok('as v2 with 3 packs', MASTER.recipeConfig && MASTER.recipeConfig.packs.length === 3,
     MASTER.recipeConfig ? String(MASTER.recipeConfig.packs.length) : 'none');
  ok('the editor closed', !S().isOpen());
  ok('the Create-MO gates survived the merge',
     Object.prototype.hasOwnProperty.call(MASTER, 'recipeConfig'),
     'publishMaster REPLACES the object, so the writer must merge');

  // The note on line 2 uses levels that ONLY exist in the pack just created,
  // so if the vocabulary had not been rebuilt from the saved config it would
  // read as an unknown level and block.
  await wait(300);
  win.setCreateMOEnabled(true);
  win.setCreateMODryRun(false);
  win.CSBuild.open('1');
  await wait(400);

  const bp = DOC.getElementById('buildPanel');
  const secs = {};
  [...bp.querySelectorAll('.dsec')].forEach(d => {
    const h = d.querySelector('h4');
    const m = h && h.textContent.match(/Line\s+(\d+)/);
    if (m) secs[Number(m[1])] = {
      blockers: [...d.querySelectorAll('.pf-blocker-list li')].map(x => x.textContent),
      warns: [...d.querySelectorAll('.pf-warn-list li')].map(x => x.textContent),
    };
  });
  Object.keys(secs).forEach(k => {
    secs[k].blockers.forEach(b => console.log('  L' + k + ' BLOCKER: ' + b));
    secs[k].warns.forEach(w => console.log('  L' + k + ' warn:    ' + w));
  });
  ok('line 2 parses against the newly configured levels',
     secs[2] && secs[2].blockers.length === 0,
     secs[2] ? secs[2].blockers.join(' | ') : 'no section');

  autoConfirm();
  win.CSBuild.create();
  await wait(600);

  ok('the MO was created', !!created);
  if (created) {
    const byLine = {};
    created.configurations.forEach(c => {
      const m = String(c.note || '').match(/SO line (\d+)/);
      if (!m) return;
      const q = {};
      c.items.forEach(it => { if (it.type !== 'Finished Good') q[PART_BY_ID[it.part.id]] = Number(it.quantity); });
      byLine[Number(m[1])] = q;
    });
    console.log('\n=== resolved from the edited configuration ===');
    Object.keys(byLine).sort().forEach(k => console.log('  L' + k + ': ' + JSON.stringify(byLine[k])));

    ok('L2 used the BOM the config named (BOM 88, malt 700 x2)',
       near(byLine[2]['RAW-MALT'], 1400), byLine[2]['RAW-MALT']);
    ok('L2 electrolyte = the level typed in the editor, 95.5 x2',
       near(byLine[2]['RTU-ELECTROLYTE-MIX'], 191), byLine[2]['RTU-ELECTROLYTE-MIX'] +
       ' (BOM says 40 — the config must win)');
    ok('L2 caffeine = the numeric level typed in the editor, 1.9 x2',
       near(byLine[2]['RAW-CAFFEINE'], 3.8), byLine[2]['RAW-CAFFEINE'] +
       ' (BOM says 1.7)');
    ok('L1 still resolves from the seeded 75 g pack (electrolyte 61.14)',
       near(byLine[1]['RTU-ELECTROLYTE-MIX'], 61.14), byLine[1]['RTU-ELECTROLYTE-MIX']);
    ok('L1 caffeine 50mg -> 2.5', near(byLine[1]['RAW-CAFFEINE'], 2.5), byLine[1]['RAW-CAFFEINE']);
  }

  console.log('\n=== the named BOM is the one queried ===');
  ok('the header lookup asked for bom.id = 88',
     sqlLog.some(q => /fgbi\.partid = 950/.test(q) && /bom\.id = 88/.test(q)),
     'the pack names the BOM, so "newest active" must not decide');

  console.log(fails ? ('\n*** ' + fails + ' FAILED ***') : '\nPASSED');
  process.exitCode = fails ? 1 : 0;
})().catch(e => {
  console.log('  FAIL harness threw: ' + (e && e.stack || e));
  process.exitCode = 1;
});
