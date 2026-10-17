// Render tests: the BUILT Sales Order report (and its Sales Invoice variant) in
// headless Chrome against a live Fishbowl database (read-only), checking
// pagination on every sheet and the PDF.
//
//   node --test Other_NOT_FOR_PRODUCTION/Paperwork_POC/tests/SOReport.test.js
//
// Needs: Chrome, playwright-core and DB access — see doc-util.js / harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('./doc-util.js');
const { A4, LETTER } = U;

const T = U.suite(['SOReport.htm']);   // + its SOInvoiceReport variant
const PAGE = 'SOReport.htm';
const SEL = { pg: '.so-foot .pg', last: '.so-last', tables: ['items'] };
const opts = size => Object.assign({ size: size || A4 }, SEL);

// demodb sales orders (id) chosen for their line types
const SO = { kits: 290, discount: 40, misc: 210, shipping: 133, usd: 268, usd2: 269, gst: 310, payments: 32, wo: 54 };

test('demodb orders render cleanly (A4 default)', async () => {
  const page = await T.open(PAGE, 'so=' + SO.kits);
  for (const [name, id] of Object.entries(SO)) {
    await page.evaluate(id => window.FBDocApp.load(id), id);
    await T.rendered(page);
    await T.check(page, 'so-' + name, opts());
  }
  await page.close();
});

test('options: payments, memos, custom fields, Number/Description + BOM rows, all columns', async () => {
  const page = await T.open(PAGE, 'so=' + SO.payments);
  await page.evaluate(() => window.FBDocApp.setSession({ ShowPayments: true, ShowMemos: true, ShowSOCustomFields: true, 'Column:PONumber': true,
    'Column:ItemNumberAndDescription': true, 'Column:ItemType': true, 'Column:ItemDateScheduled': true, 'Column:ItemTaxAmount': true,
    'Column:ItemCurrencyTax': true, 'Column:ItemUnitPrice': true, 'Column:ItemTotalPrice': true, ShowCfItem1: true, ShowCfItem2: true, ShowCfItem3: true,
    'Column:OrderCurrencyCode': true, 'Column:OrderCurrencyRate': true, 'Column:TaxIntegrationEstimatedTax': true, ShowHomeCurrencyTotals: true }));
  for (const id of [SO.payments, SO.wo, SO.usd]) {
    await page.evaluate(id => window.FBDocApp.load(id), id);
    await T.rendered(page);
    await T.check(page, 'options-' + id, opts());
  }
  await page.close();
});

test('paper sizes from the Page_setup setting (name and CSS forms)', async () => {
  for (const [q, size] of [['Letter', LETTER], ['A4 landscape', [A4[1], A4[0]]], ['size: 8.5in 11in portrait; margin: 0.5in;', LETTER], ['Letter:landscape', [LETTER[1], LETTER[0]]]]) {
    const page = await T.open(PAGE, 'so=' + SO.kits + '&print=' + encodeURIComponent(q));
    await T.check(page, 'paper-' + q.replace(/\W+/g, '_'), opts(size));
    await page.close();
  }
});

test('in-page SO picker: browse, status filter, search, pick, render', async () => {
  const page = await T.open(PAGE, 'so=' + SO.kits);
  // Opening the box browses recent orders without typing.
  await page.click('#recBrowse');
  // Wait for the browse list itself (rows can arrive a moment after the first one).
  await page.waitForFunction(() => document.querySelectorAll('.fbdoc-pick-row').length > 1, null, { timeout: 15000 });
  assert.ok((await page.$$('.fbdoc-pick-row')).length > 1, 'browse lists orders');
  // Status chip: only that status remains.
  await page.click('.fbdoc-chip:text-is("Fulfilled")');
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row'));
    return rows.length && rows.every(r => /Fulfilled/.test(r.textContent));
  }, null, { timeout: 10000 });
  // Typing searches number / customer / PO within the filters.
  await page.click('.fbdoc-chip[data-f="0"][data-v="*"]');           // back to All statuses
  await page.click('.fbdoc-chip[data-f="1"][data-v="all"]');         // period: All (10028 etc. are old)
  await page.fill('#recInput', '');
  await page.type('#recInput', '1002');
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row .lb'));
    return rows.length && rows.every(r => r.textContent.startsWith('1002'));
  }, null, { timeout: 10000 });
  const label = await page.textContent('.fbdoc-pick-row .lb');
  await page.click('.fbdoc-pick-row[data-i="0"]');
  await page.waitForFunction(l => document.getElementById('docTitle').textContent.endsWith(' ' + l), label, { timeout: 15000 });
  await T.rendered(page);
  await T.check(page, 'picker', opts());
  // No match -> a message, not an empty list.
  await page.fill('#recInput', '');
  await page.type('#recInput', 'zzzz-no-such');
  await page.waitForFunction(() => /No match/.test((document.querySelector('.fbdoc-pick') || {}).textContent || ''), null, { timeout: 10000 });
  await page.close();
});

test('in-page Print opens a print window with the same sheets, printing at 100%', async () => {
  const page = await T.open(PAGE, 'so=' + SO.kits);
  // 3 copies -> several sheets
  await page.evaluate(async id => {
    const m = await window.FBDocApp.fetch(id); const base = m.lines; m.lines = [];
    for (let r = 0; r < 3; r++) base.forEach(l => m.lines.push(Object.assign({}, l, { itemid: +l.itemid * 10 + r, kitparent: l.kitparent != null ? +l.kitparent * 10 + r : null })));
    await window.FBDocApp.render(m);
  }, SO.kits);
  const sheets = await page.$$eval('#docCanvas .fbdoc-sheet', e => e.length);
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#printBtn')]);
  await popup.waitForLoadState();
  await popup.waitForFunction(() => document.fonts.check('9pt "FB Doc Open Sans"'), null, { timeout: 10000 });
  assert.equal(await popup.$$eval('.fbdoc-sheet', e => e.length), sheets, 'print window sheet count');
  const buf = await popup.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' } });
  fs.writeFileSync(path.join(U.OUT, 'print-window.pdf'), buf);
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  assert.equal(pages, sheets, 'print window PDF pages');
  await popup.close(); await page.close();
});

test('launch from the Sales Order module: that order, fixed; toolbar = Print + Settings', async () => {
  const shown = async page => ({ num: await page.inputValue('#recInput'), status: await page.textContent('#statusLine') });
  const numOf = async (page, id) => (await page.evaluate(id => FBDoc.q('SELECT num FROM so WHERE id = ?', [id]), id))[0].num;
  const visible = page => page.evaluate(() => ['prevBtn', 'recInput', 'recBrowse', 'nextBtn', 'refreshBtn', 'printBtn', 'setBtn']
    .filter(id => { const e = document.getElementById(id); return e && e.offsetParent !== null; }));

  // By id, over the Sales_Order setting.
  let page = await T.open(PAGE, 'so=' + SO.kits + '&' + U.launch({ module: 'SO', moduleName: 'Sales Order', id: SO.wo }));
  let s = await shown(page);
  assert.equal(s.num, await numOf(page, SO.wo));
  assert.match(s.status, /from Sales Order module/);
  assert.deepEqual(await visible(page), ['printBtn', 'setBtn'], 'launched toolbar');
  await T.check(page, 'launch-id', opts());
  await page.close();

  // By number only (a host that has no id).
  page = await T.open(PAGE, 'so=' + SO.kits);
  const gstNum = await numOf(page, SO.gst);
  assert.deepEqual(await visible(page), ['prevBtn', 'recInput', 'recBrowse', 'nextBtn', 'refreshBtn', 'printBtn', 'setBtn'], 'normal toolbar');
  await page.close();
  page = await T.open(PAGE, 'so=' + SO.kits + '&' + U.launch({ module: 'SO', num: gstNum }));
  assert.equal((await shown(page)).num, gstNum);
  await page.close();

  // Another module's record: ignored, the setting stands and the picker is back.
  page = await T.open(PAGE, 'so=' + SO.kits + '&' + U.launch({ module: 'SHIP', id: 1 }));
  s = await shown(page);
  assert.equal(s.num, await numOf(page, SO.kits));
  assert.doesNotMatch(s.status, /from .* module/);
  assert.ok((await visible(page)).includes('recInput'), 'picker shown');
  assert.deepEqual(page._errors, []);
  await page.close();
});

test('invoice mode (Invoice setting) and the SOInvoiceReport variant', async () => {
  let page = await T.open(PAGE, 'so=' + SO.gst + '&invoice=true');
  assert.match(await page.textContent('#docTitle'), /Tax Invoice|Invoice/);
  await T.check(page, 'invoice', opts());
  await page.close();
  // The variant defaults to invoice with no setting at all.
  page = await T.open('SOInvoiceReport.htm', 'so=' + SO.gst);
  assert.match(await page.textContent('#docTitle'), /Tax Invoice|Invoice/);
  assert.equal(await page.evaluate(() => window.FB_REPORT.name), 'Sales Invoice');
  await T.check(page, 'invoice-variant', opts());
  await page.close();
});

// Synthetic orders built from a real one: every last-page fill level, kits
// straddling breaks, long line notes, a multi-page order note.
test('stress: 1..30 copies of a kitted order, long notes, multi-page order note', async () => {
  const page = await T.open(PAGE, 'so=' + SO.kits);
  const results = [];
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 30]) {
    await page.evaluate(async ({ n, kitsId }) => {
      const m = await window.FBDocApp.fetch(kitsId);
      const base = m.lines, lines = [];
      for (let r = 0; r < n; r++) base.forEach(l => lines.push(Object.assign({}, l, {
        itemid: +l.itemid * 1000 + r, lineno: lines.length + 1,
        kitparent: l.kitparent != null ? +l.kitparent * 1000 + r : null })));
      lines.forEach((l, i) => { if (i % 23 === 7) l.note = ('Line note ' + i + '. ').repeat(i % 2 ? 60 : 8); });
      m.lines = lines;
      m.h.note = n % 5 === 0 ? ('Order note paragraph ' + n + '. ').repeat(n * 25) : m.h.note;
      await window.FBDocApp.render(m);
    }, { n, kitsId: SO.kits });
    const r = await T.check(page, 'stress-' + n, opts());
    results.push(n + ':' + r.sheets + (r.splits ? '/' + r.splits + 'split' : ''));
  }
  console.log('stress sheets ' + results.join(' '));
  await page.close();
});
