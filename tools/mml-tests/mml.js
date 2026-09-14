// Drives Custom/Malmet/MML_Build_Planner.htm in jsdom against the REAL
// reference sheet, with Fishbowl's host globals stubbed.
//
//   node mml.js [report.htm] [sheet.csv]
//
// The report is exercised through the same entry point a user's drop uses
// (MMLP.ingest), so the parser, the enrichment and the planner are all tested
// as they actually run rather than as re-implementations.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT = process.argv[2] || path.join(ROOT, 'Custom/Malmet/MML_Build_Planner.htm');
const SHEET = process.argv[3] || path.join(ROOT, 'Custom/Malmet/MML - BWFW 105 Litre (AE2510NT).csv');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function eq(name, got, want) { ok(name + '  = ' + JSON.stringify(got), got === want, 'wanted ' + JSON.stringify(want)); }

let html = fs.readFileSync(REPORT, 'utf8')
  .replace(/\{%[^%]*%\}/g, '')
  .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window;

// ── Fishbowl host stubs ─────────────────────────────────────────────
// A small fake catalogue: most MML parts resolve, one deliberately does not,
// so the "not found" path is exercised rather than assumed.
const SHEET_TEXT = fs.readFileSync(SHEET, 'utf8');
const MISSING_PART = '100-2205';          // withheld from the fake catalogue
let sqlLog = [];

function fakeParts() {
  // Build a catalogue from the sheet itself, minus the withheld part.
  const nums = new Set();
  SHEET_TEXT.split('\n').forEach(l => {
    const c = l.split(',');
    if (c[0] && /^[0-9]/.test(c[0].trim())) nums.add(c[0].trim());
    if (c[0] && /^8-M00/.test(c[0].trim())) nums.add(c[0].trim());
    if (c[14] && c[14].trim()) nums.add(c[14].trim());
  });
  nums.delete(MISSING_PART);
  const out = new Map();
  let id = 100;
  [...nums].forEach(n => out.set(n, { id: id++, num: n, descr: 'FB ' + n, uom: 'ea' }));
  return out;
}
const CATALOGUE = fakeParts();

win.runQueryAsync = async (sql) => {
  sqlLog.push(sql);
  if (/FROM part p/i.test(sql)) {
    const nums = (sql.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
    return nums.filter(n => CATALOGUE.has(n)).map(n => {
      const p = CATALOGUE.get(n);
      return { id: p.id, num: p.num, descr: p.descr, uom: p.uom };
    });
  }
  if (/FROM tag t/i.test(sql)) {
    const ids = (sql.match(/t\.partid IN \(([^)]*)\)/i) || [, ''])[1].split(',').map(s => parseInt(s, 10)).filter(Boolean);
    // Deterministic pseudo-stock so assertions can be exact.
    return ids.map(id => ({ partid: id, onhand: (id % 7) * 10, committed: (id % 3), notavail: (id % 5) }));
  }
  if (/qtyallocated/i.test(sql)) {
    const ids = (sql.match(/part\.id IN \(([^)]*)\)/i) || [, ''])[1].split(',').map(s => parseInt(s, 10)).filter(Boolean);
    return ids.map(id => ({ partid: id, allocated: (id % 4), dropship: 0, onorder: (id % 11) }));
  }
  return [];
};
win.runQuery = () => '[]';
win.getLocationGroupList = () => [1, 2];
win.openModule = () => {};
win.getUser = () => JSON.stringify({ userName: 'tester' });
win.hasUserAccess = () => false;
win.currencyLocale = () => ({ locale: 'en-US', symbol: '$' });
win.getProperty = (n, d) => d;
win.saveSettings = () => {};
win.loadSettings = () => null;
win.alert = () => {};
win.confirm = () => true;

const drawers = {};
win.FBLib = {
  Settings: {
    init() {}, resolve: () => null, effective: () => ({}),
    setUserKey() {}, saveUser: () => true, clearUser() {},
    isAdmin: () => false, getMaster: () => ({}), publishMaster() {},
    setLock() {}, userEditingAllowed: () => true
  },
  Common: {
    DEBUG_MODE: false,
    formatQty: v => (v % 1 === 0 ? String(Math.round(v)) : String(v)),
    formatMoney: v => String(v), formatDate: s => String(s || ''),
    debugLog() {}, clearDebugLog() {},
    registerDrawer(cfg) { drawers[cfg.id] = cfg; return {}; },
    openDrawer(id) { const e = win.document.getElementById(id); if (e) e.classList.add('open'); },
    closeDrawer(id) { const e = win.document.getElementById(id); if (e) e.classList.remove('open'); },
    toggleDrawer(id) { const e = win.document.getElementById(id);
                       if (e && e.classList.contains('open')) this.closeDrawer(id); else this.openDrawer(id); }
  }
};

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
win.eval(scripts[scripts.length - 1]);
const M = win.MMLP;
const D = win.document;

(async function () {
  console.log('\nMML Build Planner — ' + path.basename(REPORT) + '\n');

  // ── 1. the raw CSV parser ────────────────────────────────────────
  console.log('RFC4180 parser');
  const Q = String.fromCharCode(34);
  eq('a plain row splits', M.parseCSV('a,b,c')[0].join('|'), 'a|b|c');
  eq('a quoted comma stays in its field',
     M.parseCSV(Q + 'a,b' + Q + ',c')[0].join('|'), 'a,b|c');
  eq('a doubled quote is one literal quote',
     M.parseCSV(Q + 'say ' + Q + Q + 'hi' + Q + Q + Q + ',x')[0][0], 'say ' + Q + 'hi' + Q);
  eq('an embedded newline stays inside the field',
     M.parseCSV(Q + 'a\nb' + Q + ',c').length, 1);
  eq('CRLF is handled', M.parseCSV('a,b\r\nc,d').length, 2);
  eq('trailing empty cells are preserved', M.parseCSV('a,,')[0].length, 3);

  // ── 2. structure detection on the REAL sheet ─────────────────────
  console.log('\nstructure of the real sheet');
  const parsed = M.parseMML(SHEET_TEXT);
  ok('a header row was found', parsed.headers.length > 0);
  eq('data rows', parsed.rows.length, 66);
  // Only the COMMON PARTS banner is a section. The trailing "ECN1481" note has
  // no rows under it, so it must NOT invent an empty section.
  eq('sections detected', parsed.sections.length, 1);
  ok('  the trailing ECN note was recorded as skipped, not as a section',
     parsed.skipped.some(s2 => /ECN1481/.test(s2.text || "")),
     JSON.stringify(parsed.skipped.map(s2 => s2.text)));
  ok('the section is the COMMON PARTS banner',
     /COMMON PARTS/i.test(parsed.sections[0]), parsed.sections[0]);
  ok('the title banner did NOT become a section',
     !parsed.sections.some(s => /DO NOT CHANGE/i.test(s)));
  ok('no data row is a repeated header',
     !parsed.rows.some(r => /^part\s*no/i.test(String(r.cells[0]).trim())));
  ok('no data row is blank', !parsed.rows.some(r => r.cells.every(c => !String(c || '').trim())));
  ok('the stray ECN1481 note did not become a part',
     !parsed.rows.some(r => /^ECN\d+$/i.test(String(r.cells[0]).trim())));

  console.log('\nheader resolution (by TEXT, not position)');
  const f = parsed.fields;
  ok('Part No. located',           f.partNo >= 0, f.partNo);
  ok('Parts per Unit located',     f.perUnit >= 0, f.perUnit);
  ok('Parts per Blank located',    f.perBlank >= 0, f.perBlank);
  ok('Material Part No. located',  f.matPartNo >= 0, f.matPartNo);
  ok('Description located',        f.desc >= 0, f.desc);
  ok('no required column is missing',
     !parsed.issues.some(i => /Could not find/.test(i)), parsed.issues.join(' | '));
  // The two-row header must be folded, not left as the group label. The group
  // name is kept as a prefix so the grid still reads like the sheet, EXCEPT
  // where that would double a shared word — "Blank Size" + "Exact Size" has to
  // stay "Exact Size", or the field resolver stops finding the nesting-note
  // column and every offcut part silently overstates its material.
  ok('the Blank Size sub-header folded into its columns',
     parsed.headers.some(h => /blank\s*size\s*width/i.test(h)) &&
     parsed.headers.some(h => /blank\s*size\s*length/i.test(h)),
     JSON.stringify(parsed.headers.slice(7, 11)));
  ok('  a shared word is not doubled ("Exact Size", not "Blank Size Exact Size")',
     parsed.headers.some(h => /^exact\s*size$/i.test(String(h).trim())),
     JSON.stringify(parsed.headers.slice(7, 11)));

  // ── 3. ingest end to end ─────────────────────────────────────────
  console.log('\ningest');
  M.ingest(SHEET_TEXT);
  await new Promise(r => win.setTimeout(r, 0));
  eq('rows loaded', M.rows.length, 66);
  ok('columns built from the CSV header + extras', M.cols.length > parsed.headers.length);
  ok('a CSV column carries src "csv"', M.cols.some(c => c.src === 'csv'));
  ok('Fishbowl columns were appended', M.cols.some(c => c.src === 'fb'));
  ok('planner columns were appended', M.cols.some(c => c.src === 'plan'));
  ok('every column has a tooltip', M.cols.every(c => c.tip), M.cols.filter(c => !c.tip).map(c => c.label).join(','));
  ok('the toolbar is revealed', D.getElementById('toolbar').classList.contains('on'));
  ok('the drop zone collapsed to the loaded bar', D.getElementById('dropZone').classList.contains('loaded'));

  const byNum = {}; M.rows.forEach(r => { byNum[r.partNo] = r; });
  const r1 = byNum['100-2201'];
  ok('a known row parsed its numbers', !!r1 && r1.perUnit === 1 && r1.perBlank === 2,
     r1 && (r1.perUnit + '/' + r1.perBlank));
  eq('…and its material', r1 ? r1.matPartNo : '', '8-0219');
  const sec = M.rows.find(r => r.section);
  ok('rows after the banner carry the section', !!sec && /COMMON PARTS/i.test(sec.section));
  ok('rows before it do not', !byNum['100-2201'].section);

  // Nesting notes must be recognised — those parts consume no material.
  const nested = M.rows.filter(r => r.nested).map(r => r.partNo);
  eq('nested/offcut rows found', nested.length, 4);
  ok('  they are the Offcut/Nested rows',
     nested.includes('8-M00-83-0023') && nested.includes('8-M00-83-0031'), nested.join(','));
  ok('"Rotate Blank" is NOT treated as nested',
     !nested.includes('8-M00-83-2087'));

  // ── 4. the planner arithmetic ────────────────────────────────────
  console.log('\nplanner arithmetic');
  eq('gcd', M.gcd(12, 18), 6);
  eq('lcm', M.lcm(4, 6), 12);
  // 1 per unit, 2 per blank: 3 units need 3 parts = 2 blanks (4 capacity), 1 wasted
  const p3 = M.rowPlan({ perUnit: 1, perBlank: 2 }, 3);
  eq('blanks round UP', p3.blanks, 2);
  eq('capacity', p3.capacity, 4);
  eq('waste', p3.waste, 1);
  eq('not exact', p3.exact, false);
  const p4 = M.rowPlan({ perUnit: 1, perBlank: 2 }, 4);
  eq('an even quantity is exact', p4.exact, true);
  eq('…with no waste', p4.waste, 0);
  eq('period of 1-per-unit 2-per-blank', M.rowPeriod({ perUnit: 1, perBlank: 2 }), 2);
  eq('period of 2-per-unit 7-per-blank', M.rowPeriod({ perUnit: 2, perBlank: 7 }), 7);
  // 2 per unit, 4 per blank -> need is always even, so every 2nd unit is exact
  eq('period accounts for parts-per-unit', M.rowPeriod({ perUnit: 2, perBlank: 4 }), 2);
  eq('a zero parts-per-blank is not plannable', M.rowPlan({ perUnit: 1, perBlank: 0 }, 5), null);

  // The period really is the first exact quantity — verified by brute force.
  console.log('\nperiod is provably the first exact quantity');
  let periodOk = true, firstBad = '';
  [[1, 2], [2, 7], [1, 52], [2, 12], [3, 8], [4, 22], [5, 15], [2, 560]].forEach(([pu, pb]) => {
    const per = M.rowPeriod({ perUnit: pu, perBlank: pb });
    let firstExact = 0;
    for (let q = 1; q <= 5000 && !firstExact; q++) if (M.rowPlan({ perUnit: pu, perBlank: pb }, q).exact) firstExact = q;
    if (firstExact !== per) { periodOk = false; firstBad = pu + '/' + pb + ' period ' + per + ' but first exact ' + firstExact; }
  });
  ok('across 8 ratios, period === first exact quantity', periodOk, firstBad);

  // And every multiple of the period stays exact.
  let multOk = true;
  [[2, 7], [3, 8], [4, 22]].forEach(([pu, pb]) => {
    const per = M.rowPeriod({ perUnit: pu, perBlank: pb });
    for (let k = 1; k <= 20; k++) if (!M.rowPlan({ perUnit: pu, perBlank: pb }, per * k).exact) multOk = false;
  });
  ok('every multiple of the period is also exact', multOk);

  // ── 5. material grouping on the real sheet ───────────────────────
  console.log('\nmaterial grouping (real sheet)');
  ok('materials were grouped', M.plan.length > 0, M.plan.length);
  const mats = M.plan.map(m => m.matPartNo);
  ok('8-0219 is one of them', mats.includes('8-0219'));
  const m0219 = M.plan.find(m => m.matPartNo === '8-0219');
  ok('it gathered several parts', m0219.rows.length > 1, m0219.rows.length);
  ok('nested rows are excluded from the counted set',
     m0219.countedRows === m0219.rows.length - m0219.nestedRows);
  ok('each material offers ranked quantities', M.plan.every(m => !m.countedRows || m.best.length > 0));
  ok('suggestions are sorted by waste ascending',
     M.plan.every(m => m.best.every((b, i) => i === 0 || m.best[i - 1].wastePct <= b.wastePct + 1e-9)));
  ok('the exact quantity, when inside the scan, really is waste-free',
     M.plan.filter(m => m.exactWithinScan).every(m => {
       const g = M.groupPlan(m.rows.filter(r => !r.nested && r.perUnit > 0 && r.perBlank > 0), m.exactQ);
       return g.waste === 0 && g.allExact;
     }));
  // The headline claim of the whole feature.
  ok('a zero-waste suggestion has every part exact',
     M.plan.every(m => m.best.filter(b => b.wastePct === 0).every(b => b.allExact)));

  // ── 6. per-row figures at a chosen quantity ──────────────────────
  console.log('\nper-row figures');
  M.setQty(10);
  const r10 = M.rows.find(r => r.partNo === '100-2201');   // 1/unit, 2/blank
  eq('need at qty 10', r10.plan.need, 10);
  eq('blanks at qty 10', r10.plan.blanks, 5);
  eq('waste at qty 10', r10.plan.waste, 0);
  const rOdd = M.rows.find(r => r.perUnit === 1 && r.perBlank === 12);
  if (rOdd) {
    eq('a 12-per-blank row at qty 10 needs 1 blank', rOdd.plan.blanks, 1);
    eq('…wasting 2', rOdd.plan.waste, 2);
  } else ok('a 12-per-blank row exists to test', false);
  M.setQty(1);
  eq('qty 1 needs 1 blank for a 2-per-blank part',
     M.rows.find(r => r.partNo === '100-2201').plan.blanks, 1);

  // ── 7. Fishbowl enrichment ──────────────────────────────────────
  console.log('\nFishbowl enrichment');
  const matchedCount = M.rows.filter(r => r.fb).length;
  ok('most rows matched a part', matchedCount >= 60, matchedCount + '/' + M.rows.length);
  ok('the withheld part reports NOT found', !byNum[MISSING_PART].fb);
  const anyFb = M.rows.find(r => r.fb);
  ok('a matched row carries inventory fields',
     anyFb && typeof anyFb.fb.onHand === 'number' && typeof anyFb.fb.available === 'number');
  ok('Available is never negative', M.rows.filter(r => r.fb).every(r => r.fb.available >= 0));
  ok('Available = max(0, onHand - allocated - notAvail + dropship)',
     M.rows.filter(r => r.fb).every(r => r.fb.available ===
        Math.max(0, r.fb.onHand - r.fb.allocated - r.fb.notAvail + r.fb.dropship)));
  ok('the raw material part is looked up too', M.rows.some(r => r.matFb));
  ok('the part query matched on part.num exactly',
     sqlLog.some(s => /FROM part p/i.test(s) && /p\.num IN \(/i.test(s) && !/LIKE/i.test(s)));
  ok('inventory was scoped to the accessible location groups',
     sqlLog.some(s => /l\.locationgroupid IN \(1,2\)/i.test(s)));

  // ── 8. the grid ─────────────────────────────────────────────────
  console.log('\ngrid');
  const ths = [...D.querySelectorAll('#mmlHead th')];
  ok('the header rendered', ths.length > 0, ths.length);
  ok('it shows only visible columns', ths.length === M.cols.filter(c => c.vis).length);
  ok('no <th> carries a native title (it would race the popover)',
     ths.every(t => !t.getAttribute('title')));
  ok('every <th> carries a rich-tooltip payload', ths.every(t => !!t.dataset.ttDesc));
  const bodyRows = [...D.querySelectorAll('#mmlBody tr.data-row')];
  eq('a row is rendered per part', bodyRows.length, 66);
  ok('the unmatched row is tinted', !!D.querySelector('#mmlBody tr.data-row.nomatch'));
  ok('a section band is rendered', !!D.querySelector('#mmlBody tr.sec-row'));
  eq('cells per row match the visible column count',
     bodyRows[0].children.length, M.cols.filter(c => c.vis).length);

  console.log('\nsorting');
  M.sortBy('_blanks');
  let vals = [...D.querySelectorAll('#mmlBody tr.data-row')].map(tr => {
    const i = M.cols.filter(c => c.vis).findIndex(c => c.key === '_blanks');
    return parseFloat(tr.children[i].textContent) || 0;
  });
  ok('ascending sort on a planner column', vals.every((v, i) => i === 0 || vals[i - 1] <= v));
  M.sortBy('_blanks');
  vals = [...D.querySelectorAll('#mmlBody tr.data-row')].map(tr => {
    const i = M.cols.filter(c => c.vis).findIndex(c => c.key === '_blanks');
    return parseFloat(tr.children[i].textContent) || 0;
  });
  ok('second click reverses it', vals.every((v, i) => i === 0 || vals[i - 1] >= v));
  ok('sorting suppresses the section bands (they would mislabel rows)',
     !D.querySelector('#mmlBody tr.sec-row'));
  M.sortBy('_blanks');
  ok('third click returns to natural order, bands back',
     !!D.querySelector('#mmlBody tr.sec-row'));

  console.log('\nfilters');
  D.getElementById('matFilter').value = '8-0219';
  M.applyFilters();
  ok('material filter narrows the grid',
     M.shown.length > 0 && M.shown.every(r => r.matPartNo === '8-0219'), M.shown.length);
  D.getElementById('matFilter').value = '';
  D.getElementById('onlyMatched').checked = true;
  M.applyFilters();
  ok('matched-only hides the unmatched row', M.shown.every(r => !!r.fb));
  D.getElementById('onlyMatched').checked = false;
  D.getElementById('qSearch').value = 'PANEL';
  M.applyFilters();
  ok('search matches the description',
     M.shown.length > 0 && M.shown.every(r => /panel/i.test(r.partNo + r.desc + r.matPartNo)), M.shown.length);
  D.getElementById('qSearch').value = '';
  M.applyFilters();
  eq('clearing restores every row', M.shown.length, 66);

  // ── 9. the planner panel ────────────────────────────────────────
  console.log('\nplanner panel');
  const cards = [...D.querySelectorAll('#plannerBody .pl-mat')];
  ok('a card per material is rendered', cards.length === M.plan.length, cards.length + '/' + M.plan.length);
  ok('each card names its material', cards.every(c => !!c.querySelector('.pl-mat-num').textContent.trim()));
  ok('each card offers quantities', cards.every(c => c.querySelector('.pl-qty-tbl') || c.querySelector('.pl-exact')));
  ok('the current quantity is marked', !!D.querySelector('#plannerBody tr.cur'));

  // ── 10. tolerance for a "very close" format ─────────────────────
  console.log('\nformat tolerance');
  // Columns moved, renamed slightly, and an extra column inserted.
  const alt = [
    'Some other title,,,,,,',
    'Part No.,Description,Extra Col,Parts Per Unit,Parts Per Blank,Material Part Number,Status',
    'AAA-1,Widget,zz,2,8,MAT-1,Active',
    'AAA-2,Gadget,zz,1,4,MAT-1,Active',
    'BBB-1,Doodad,zz,3,9,MAT-2,Active'
  ].join('\n');
  const ap = M.parseMML(alt);
  eq('reordered/renamed headers still resolve — rows', ap.rows.length, 3);
  ok('  Parts Per Unit found despite the capitalisation', ap.fields.perUnit === 3, ap.fields.perUnit);
  ok('  "Material Part Number" found', ap.fields.matPartNo === 5, ap.fields.matPartNo);
  ok('  no missing-column issues', !ap.issues.some(i => /Could not find/.test(i)), ap.issues.join('|'));
  M.ingest(alt);
  await new Promise(r => win.setTimeout(r, 0));
  eq('the alternate sheet ingests', M.rows.length, 3);
  // MAT-1: AAA-1 is 2/8 (period 4), AAA-2 is 1/4 (period 4) -> exact at 4
  const mat1 = M.plan.find(m => m.matPartNo === 'MAT-1');
  eq('MAT-1 exact quantity', mat1.exactQ, 4);
  ok('  and it is flagged as reachable', mat1.exactWithinScan);
  const g4 = M.groupPlan(mat1.rows, 4);
  eq('  at qty 4 there is no waste', g4.waste, 0);
  eq('  …using 1 blank of AAA-1 and 1 of AAA-2', g4.blanks, 2);

  // A missing required column must be reported, not silently produce nonsense.
  const bad = 'Title,,\nPart No.,Description,Status\nX-1,Thing,Active';
  const bp = M.parseMML(bad);
  ok('a sheet with no Parts per Blank reports the problem',
     bp.issues.some(i => /Parts per Blank/i.test(i)), bp.issues.join('|'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR\n', e); process.exit(1); });
