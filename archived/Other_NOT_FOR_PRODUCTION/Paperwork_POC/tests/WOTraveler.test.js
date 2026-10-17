// Render tests: the BUILT Work Order Traveler in headless Chrome against a live
// Fishbowl database (read-only), checking pagination on every sheet and the PDF.
//
//   node --test Other_NOT_FOR_PRODUCTION/Paperwork_POC/tests/WOTraveler.test.js
//
// Needs: Chrome, playwright-core and DB access — see doc-util.js / harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('./doc-util.js');
const { A4, LETTER } = U;

const T = U.suite(['WOTraveler.htm']);
const PAGE = 'WOTraveler.htm';
const SEL = { pg: '.wt-foot .pg', last: null, tables: ['fg', 'rg', 'woi', 'bomi'] };
const opts = (size, o) => Object.assign({ size: size || A4 }, SEL, o || {});

// demodb work orders chosen for variety (picked by query; the ids in the
// comments are what demodb holds today).
let WO = null;
async function pick() {
  if (WO) return WO;
  const one = async (sql, why) => {
    const r = await T.sql(sql);
    assert.ok(r.length, 'no demodb work order for: ' + why);
    return +r[0].id;
  };
  const items = 'SELECT wo.id FROM wo JOIN woitem wi ON wi.woId = wo.id ';
  const tracked = 'JOIN parttotracking ptt ON ptt.partId = wi.partId ';
  WO = {
    // fulfilled, most items, tracked items with recorded values, MO linked to an SO (2: 1:001)
    many: await one(items + tracked + 'JOIN moitem mi ON mi.id = wi.moItemId JOIN mo ON mo.id = mi.moId ' +
      'WHERE wo.statusId = 40 AND mo.soId IS NOT NULL GROUP BY wo.id ORDER BY (SELECT COUNT(*) FROM woitem x WHERE x.woId = wo.id) DESC, wo.id LIMIT 1', 'many items + SO'),
    // entered (not fulfilled), most items, tracked parts -> write-in prompts (127: 112:001)
    entered: await one(items + tracked + 'WHERE wo.statusId <> 40 GROUP BY wo.id ' +
      'ORDER BY (SELECT COUNT(*) FROM woitem x WHERE x.woId = wo.id) DESC, wo.id LIMIT 1', 'entered + tracked'),
    // a part with several tracking types on an unfulfilled WO (140: 119-1:001, also no BOM)
    multiTrack: await one(items + 'WHERE wo.statusId <> 40 AND wi.partId IN (SELECT partId FROM parttotracking GROUP BY partId HAVING COUNT(*) > 1) ' +
      'ORDER BY wo.id DESC LIMIT 1', 'multi tracking types'),
    // calendar category with a colour (111: 99:001)
    category: await one("SELECT wo.id FROM wo JOIN calcategory c ON c.id = wo.calCategoryId WHERE c.color IS NOT NULL AND c.color <> '' ORDER BY wo.id DESC LIMIT 1", 'category'),
    // several finished goods on one WO (116: 105:001)
    multiFg: await one(items + 'WHERE wi.typeId IN (10, 31) GROUP BY wo.id HAVING COUNT(*) > 2 ORDER BY COUNT(*) DESC, wo.id LIMIT 1', 'several finished goods'),
    // BOM with instruction items + WO instructions, unfulfilled (131: 114:001)
    instr: await one('SELECT wo.id FROM wo JOIN woitem wi ON wi.woId = wo.id AND wi.typeId = 10 JOIN moitem mi ON mi.id = wi.moItemId ' +
      'WHERE wo.statusId <> 40 AND mi.bomId IN (SELECT bomId FROM bominstructionitem) AND wo.id IN (SELECT woId FROM woinstruction) ORDER BY wo.id LIMIT 1', 'instructions'),
    // fulfilled with completed WO instructions (status icons)
    instrDone: await one('SELECT wo.id FROM wo WHERE wo.statusId = 40 AND wo.id IN (SELECT woId FROM woinstruction WHERE qtyReady = 0 AND qtyFulfilled > 0) ' +
      'ORDER BY wo.id DESC LIMIT 1', 'completed instructions'),
    // no BOM on any item
    noBom: await one('SELECT wo.id FROM wo WHERE NOT EXISTS (SELECT 1 FROM woitem wi JOIN moitem mi ON mi.id = wi.moItemId WHERE wi.woId = wo.id AND mi.bomId IS NOT NULL) ' +
      'AND EXISTS (SELECT 1 FROM woitem wi WHERE wi.woId = wo.id) ORDER BY wo.id LIMIT 1', 'no BOM')
  };
  console.log('demodb work orders ' + JSON.stringify(WO));
  return WO;
}
const load = async (page, id) => { await page.evaluate(id => window.FBDocApp.load(id), id); await T.rendered(page); };
const text = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent));

test('demodb work orders render cleanly (A4 default)', async () => {
  const W = await pick();
  const page = await T.open(PAGE, 'set.WO=' + W.many);
  for (const [name, id] of Object.entries(W)) {
    await load(page, id);
    await T.check(page, 'wo-' + name, opts());
  }

  // Fulfilled WO: header data, recorded tracking values, the customer / SO line.
  await load(page, W.many);
  const h = (await T.sql('SELECT wo.num, so.num AS sonum FROM wo JOIN moitem mi ON mi.id = wo.moItemId JOIN mo ON mo.id = mi.moId ' +
    'LEFT JOIN so ON so.id = mo.soId WHERE wo.id = ?', [W.many]))[0];
  const di = (await T.sql("SELECT sysValue AS v FROM sysproperties WHERE sysKey = 'Barcodes have DI'"))[0];
  const woBox = (di && di.v === 'true' ? 'W' : '') + h.num;
  const hdr = await page.textContent('.fbdoc-sheet .fbdoc-header');
  assert.ok(hdr.includes(woBox), 'WO # box ' + woBox);
  assert.ok(hdr.includes('Work Order Traveler'), 'default title');
  if (h.sonum) assert.match(hdr, new RegExp('SO#: ' + h.sonum), 'SO line');
  assert.equal(await page.$$eval('.fbdoc-sheet .fbdoc-header svg.fbdoc-barcode', e => e.length), 1, 'barcode');
  const vals = await text(page, 'td.trk');
  assert.ok(vals.some(v => /^[^\s:]+: \S/.test(v)), 'recorded tracking values (Abbr: value): ' + vals.join(' | '));

  // Unfulfilled WO: write-in prompts at the first tab stop, one per tracking type.
  await load(page, W.multiTrack);
  const prompts = await page.$$eval('td.trk .ind', els => els.map(e => e.textContent));
  assert.ok(prompts.length && prompts.some(p => p.split('\n').length > 1 && p.split('\n').every(l => /:$/.test(l))), 'prompts: ' + prompts.join(' | '));

  // Category text + colour swatch.
  await load(page, W.category);
  assert.match(await page.textContent('.fbdoc-header .wt-cat'), /^Category: \S/);
  assert.equal(await page.$$eval('.fbdoc-sheet .wt-cat .sw', e => e.length), 1, 'swatch');

  // No BOM: the "BOM:" line stays empty, its slot is kept.
  await load(page, W.noBom);
  assert.equal((await page.textContent('.fbdoc-sheet .wt-bomline')).trim(), '');
  await page.close();
});

test('options: instructions (WO / BOM), columns, header, footer flips', async () => {
  const W = await pick();
  const page = await T.open(PAGE, 'set.WO=' + W.instr);
  const flip = async (session, id, name, o) => {
    await page.evaluate(s => window.FBDocApp.setSession(s), session);
    await load(page, id);
    return T.check(page, 'options-' + name, opts(A4, o));
  };

  // WO instructions with every extra, URL variant.
  await flip({ cbShowInstructions: 'wo', ShowWOInstructionDetails: true, ShowWOInstructionCompleted: true, ShowWOInstructionStatus: true,
    'colWOInstructions: URL': true, DisplayTime: true }, W.instrDone, 'wo-all');
  const woiHead = await text(page, 'table[data-fbdoc-table="woi"] thead th');
  assert.deepEqual(woiHead.slice(2), ['Ready', 'Completed', 'Status', 'URL']);
  assert.ok(await page.$$eval('table[data-fbdoc-table="woi"] .ic img, table[data-fbdoc-table="woi"] .ic svg', e => e.length) > 0, 'status icons');
  assert.match(await page.textContent('.fbdoc-header .wt-sched'), /\d{1,2}:\d{2} [AP]M/, 'scheduled time');

  // WO instructions defaults (no URL column, blank write-ins).
  await flip({ cbShowInstructions: 'wo' }, W.instr, 'wo-default');
  assert.equal((await text(page, 'table[data-fbdoc-table="woi"] thead th')).length, 5);

  // BOM instructions.
  await flip({ cbShowInstructions: 'bom' }, W.instr, 'bom');
  assert.deepEqual(await text(page, 'table[data-fbdoc-table="bomi"] thead th'), ['Order', 'Name', 'Description', 'Details', 'URL']);
  // BOM instructions on a WO with no BOM: the strip, no table.
  await flip({ cbShowInstructions: 'bom' }, W.noBom, 'bom-none');
  assert.equal(await page.$$eval('table[data-fbdoc-table="bomi"]', e => e.length), 0);

  // Columns off everywhere, header off, footer off.
  await flip({ 'colPart#': false, colBOMQty: false, colFinished: false, colScrapped: false, 'colHeader:Priority': false,
    'colHeader:Class': false, ShowBarcode: false, ShowCategory: false, ShowPageFooter: false }, W.category, 'columns-off', { pg: null });
  assert.deepEqual(await text(page, '.fbdoc-paper:first-child .fbdoc-sheet table[data-fbdoc-table="fg"] thead th'), ['Description', 'WO Qty', 'UOM']);
  assert.deepEqual(await text(page, '.fbdoc-paper:first-child .fbdoc-sheet table.wt-ht th'), ['Customer Job', 'WO Qty', 'Location'], 'Status follows Class');
  assert.equal(await page.$$eval('.fbdoc-sheet svg.fbdoc-barcode', e => e.length), 0, 'no barcode');
  assert.equal(await page.$$eval('.fbdoc-sheet .wt-cat', e => e.length), 0, 'no category');
  assert.equal(await page.$$eval('.fbdoc-sheet .wt-foot .pg', e => e.length), 0, 'no footer');

  // Status alone off; timestamp off; a custom title.
  await flip({ 'colHeader:Status': false, ShowTimeStamp: false, ReportTitle: 'Shop Traveler' }, W.many, 'status-off');
  assert.ok(!(await text(page, '.fbdoc-paper:first-child .fbdoc-sheet table.wt-ht th')).includes('Status'));
  assert.equal(await page.textContent('.fbdoc-paper:first-child .fbdoc-sheet .wt-title'), 'Shop Traveler');
  assert.equal(await page.$$eval('.fbdoc-paper:first-child .fbdoc-sheet .wt-foot > span', e => e.length), 1, 'page number only');
  await flip({ ReportTitle: '%' }, W.many, 'title-percent');
  assert.equal(await page.textContent('.fbdoc-paper:first-child .fbdoc-sheet .wt-title'), 'Work Order Traveler');
  await page.close();
});

test('paper sizes from the Page_setup setting', async () => {
  const W = await pick();
  for (const [q, size] of [['Letter', LETTER], ['A4 landscape', [A4[1], A4[0]]], ['Letter:landscape', [LETTER[1], LETTER[0]]]]) {
    const page = await T.open(PAGE, 'set.WO=' + W.many + '&print=' + encodeURIComponent(q));
    await T.check(page, 'paper-' + q.replace(/\W+/g, '_'), opts(size));
    await page.close();
  }
});

test('in-page WO picker: browse, status filter, search by WO / MO / part, pick, render', async () => {
  const W = await pick();
  const page = await T.open(PAGE, 'set.WO=' + W.many);
  await page.click('#recBrowse');
  await page.click('.fbdoc-chip[data-f="1"][data-v="all"]');          // period: All (demodb is old)
  await page.waitForFunction(() => document.querySelectorAll('.fbdoc-pick-row').length > 1, null, { timeout: 10000 });
  await page.click('.fbdoc-chip:text-is("Entered")');
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row'));
    return rows.length && rows.every(r => /Entered/.test(r.textContent));
  }, null, { timeout: 10000 });
  await page.click('.fbdoc-chip[data-f="0"][data-v="*"]');            // back to All statuses
  // By WO number prefix.
  const num = (await T.sql('SELECT num FROM wo WHERE id = ?', [W.multiFg]))[0].num;
  await page.fill('#recInput', '');
  await page.type('#recInput', num);
  await page.waitForFunction(n => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row .lb'));
    return rows.length && rows.some(r => r.textContent === n);
  }, num, { timeout: 10000 });
  // By finished-good part.
  const part = (await T.sql('SELECT p.num FROM woitem wi JOIN part p ON p.id = wi.partId WHERE wi.woId = ? AND wi.typeId = 10 ORDER BY wi.id LIMIT 1', [W.many]))[0].num;
  await page.fill('#recInput', '');
  await page.type('#recInput', part);
  await page.waitForFunction(p => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row .sb'));
    return rows.length && rows.some(r => r.textContent.toLowerCase().includes(p.toLowerCase()));
  }, part, { timeout: 10000 });
  // By MO number.
  const mo = (await T.sql('SELECT mo.num FROM wo JOIN moitem mi ON mi.id = wo.moItemId JOIN mo ON mo.id = mi.moId WHERE wo.id = ?', [W.instr]))[0].num;
  await page.fill('#recInput', '');
  await page.type('#recInput', mo);
  await page.waitForFunction(m => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row .sb'));
    return rows.length && rows.some(r => r.textContent.includes('MO ' + m));
  }, mo, { timeout: 10000 });
  const label = await page.textContent('.fbdoc-pick-row .lb');
  await page.click('.fbdoc-pick-row[data-i="0"]');
  await page.waitForFunction(l => document.getElementById('docTitle').textContent.endsWith(' ' + l), label, { timeout: 15000 });
  await T.rendered(page);
  await T.check(page, 'picker', opts());
  await page.fill('#recInput', '');
  await page.type('#recInput', 'zzzz-no-such');
  await page.waitForFunction(() => /No match/.test((document.querySelector('.fbdoc-pick') || {}).textContent || ''), null, { timeout: 10000 });
  await page.close();
});

test('in-page Print opens a print window with the same sheets', async () => {
  const W = await pick();
  const page = await T.open(PAGE, 'set.WO=' + W.many);
  await page.evaluate(async id => {
    const m = await window.FBDocApp.fetch(id); const base = m.items; m.items = [];
    for (let r = 0; r < 4; r++) base.forEach(it => m.items.push(Object.assign({}, it, { woitemid: +it.woitemid * 10 + r })));
    await window.FBDocApp.render(m);
  }, W.many);
  const sheets = await page.$$eval('#docCanvas .fbdoc-sheet', e => e.length);
  assert.ok(sheets > 1, 'several sheets');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#printBtn')]);
  await popup.waitForLoadState();
  await popup.waitForFunction(() => document.fonts.check('9pt "FB Doc Open Sans"'), null, { timeout: 10000 });
  assert.equal(await popup.$$eval('.fbdoc-sheet', e => e.length), sheets, 'print window sheet count');
  const buf = await popup.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' } });
  fs.writeFileSync(path.join(U.OUT, 'wo-print-window.pdf'), buf);
  assert.equal((buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length, sheets, 'print window PDF pages');
  await popup.close(); await page.close();
});

test('launch from the Work Order module: that work order, fixed; toolbar = Print + Settings', async () => {
  const W = await pick();
  const numOf = async id => (await T.sql('SELECT num FROM wo WHERE id = ?', [id]))[0].num;
  const shown = async page => ({ num: await page.inputValue('#recInput'), status: await page.textContent('#statusLine') });
  const visible = page => page.evaluate(() => ['prevBtn', 'recInput', 'recBrowse', 'nextBtn', 'refreshBtn', 'printBtn', 'setBtn']
    .filter(id => { const e = document.getElementById(id); return e && e.offsetParent !== null; }));

  // By id, over the Work_Order setting.
  let page = await T.open(PAGE, 'set.WO=' + W.many + '&' + U.launch({ module: 'WO', moduleName: 'Work Order', id: W.instr }));
  let s = await shown(page);
  assert.equal(s.num, await numOf(W.instr));
  assert.match(s.status, /from Work Order module$/);
  assert.deepEqual(await visible(page), ['printBtn', 'setBtn'], 'launched toolbar');
  await T.check(page, 'launch-id', opts());
  await page.close();

  // By number only.
  const n = await numOf(W.category);
  page = await T.open(PAGE, 'set.WO=' + W.many + '&' + U.launch({ module: 'WO', moduleName: 'Work Order', num: n }));
  assert.equal((await shown(page)).num, n);
  await page.close();

  // Another module's record: ignored, the setting stands and the picker is back.
  page = await T.open(PAGE, 'set.WO=' + W.many + '&' + U.launch({ module: 'SO', moduleName: 'Sales Order', id: 1 }));
  s = await shown(page);
  assert.equal(s.num, await numOf(W.many));
  assert.doesNotMatch(s.status, /from .* module/);
  assert.ok((await visible(page)).includes('recInput'), 'picker shown');
  assert.deepEqual(page._errors, []);
  await page.close();
});

// Synthetic work orders built from real ones: 1..30 copies of every item, long
// notes and instruction details, long tracking text, NOTE items — every sheet
// must check clean (no overflow, header + column headers, footer numbering).
test('stress: 1..30 copies of a work order, long notes, instructions, tracking', async () => {
  const W = await pick();
  const page = await T.open(PAGE, 'set.WO=' + W.many);
  await page.evaluate(() => window.FBDocApp.setSession({ cbShowInstructions: 'wo', ShowWOInstructionDetails: true, ShowWOInstructionStatus: true }));
  const results = [];
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 30]) {
    const base = n % 2 ? W.many : W.entered;
    await page.evaluate(async ({ n, base }) => {
      const m = await window.FBDocApp.fetch(base);
      const items = [], values = {};
      for (let r = 0; r < n; r++) m.items.forEach((it, i) => {
        const id = +it.woitemid * 1000 + r;
        const c = Object.assign({}, it, { woitemid: id });
        if ((items.length % 17) === 5) Object.assign(c, { typeid: 40, itemname: 'Check the assembly against drawing ' + items.length });
        items.push(c);
        const v = m.values[+it.woitemid];
        values[id] = (items.length % 13 === 3) ? 'SN(s): ' + Array.from({ length: 40 + n }, (_, k) => 'SER-' + (100000 + k)).join(', ') : v;
      });
      m.items = items; m.values = values;
      const steps = m.woInstr.length ? m.woInstr : [{ sortorder: 1, name: 'Step', description: '', details: '', qtyready: 0, qtyfulfilled: 1 }];
      m.woInstr = [];
      for (let r = 0; r < Math.min(n, 6); r++) steps.forEach((s, i) => m.woInstr.push(Object.assign({}, s, {
        sortorder: m.woInstr.length + 1, details: (i % 2 ? 'Detail line. ' : 'Long instruction detail ' + r + '. ').repeat(i % 2 ? 4 : 30 * (r + 1)) })));
      m.h.note = n % 5 === 0 ? ('Work order note paragraph ' + n + '. ').repeat(n * 25) : (n % 3 === 0 ? 'Short note.' : m.h.note);
      await window.FBDocApp.render(m);
    }, { n, base });
    const r = await T.check(page, 'stress-' + n, opts());
    results.push(n + ':' + r.sheets + (r.splits ? '/' + r.splits + 'split' : ''));
  }
  console.log('stress sheets ' + results.join(' '));
  await page.close();
});
