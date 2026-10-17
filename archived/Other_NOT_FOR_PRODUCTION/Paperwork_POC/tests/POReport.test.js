// Render tests: the BUILT Purchase Order report in headless Chrome against a
// live Fishbowl database (read-only), checking pagination on every sheet and
// the PDF.
//
//   node --test Other_NOT_FOR_PRODUCTION/Paperwork_POC/tests/POReport.test.js
//
// Needs: Chrome, playwright-core and DB access — see doc-util.js / harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./doc-util.js');
const { A4, LETTER } = U;

const T = U.suite(['POReport.htm']);
const PAGE = 'POReport.htm';
const SEL = { pg: '.po-foot .pg', last: '.po-last', tables: ['items'] };
const opts = size => Object.assign({ size: size || A4 }, SEL);
const PO_TABLE = 397076832;   // memo / custom-field table id of po

// demodb purchase orders, chosen by query for variety (fallback ids from demodb 2026-10).
let PO = null;
async function pos() {
  if (PO) return PO;
  const one = async (sql, fallback) => { const r = await T.sql(sql); return r.length ? +r[0].id : fallback; };
  PO = {
    manyLines: await one('SELECT poId AS id FROM poitem GROUP BY poId ORDER BY COUNT(*) DESC, poId LIMIT 1', 130),
    foreignTaxed: await one('SELECT po.id FROM po JOIN currency c ON c.id = COALESCE(po.currencyId, (SELECT v.currencyId FROM vendor v WHERE v.id = po.vendorId)) ' +
      'JOIN poitem pi ON pi.poId = po.id WHERE c.homeCurrency = 0 AND po.currencyRate <> 1 AND pi.taxRate > 0 ORDER BY po.id LIMIT 1', 224),
    foreignRate: await one('SELECT po.id FROM po JOIN currency c ON c.id = po.currencyId WHERE c.homeCurrency = 0 AND po.currencyRate > 1.5 ORDER BY po.id DESC LIMIT 1', 235),
    foreignNoRate: await one('SELECT po.id FROM po JOIN currency c ON c.id = po.currencyId WHERE c.homeCurrency = 0 AND po.currencyRate = 1 ORDER BY po.id LIMIT 1', 150),
    notesMemos: await one('SELECT po.id FROM po JOIN memo m ON m.tableId = ' + PO_TABLE + ' AND m.recordId = po.id WHERE LENGTH(po.note) > 0 ORDER BY po.id DESC LIMIT 1', 191),
    credit: await one('SELECT poId AS id FROM poitem WHERE typeId = 20 ORDER BY poId DESC LIMIT 1', 227),
    outsourced: await one("SELECT poId AS id FROM poitem WHERE typeId = 30 AND outsourcedPartNumber <> '' AND outsourcedPartNumber <> partNum ORDER BY poId LIMIT 1", 197),
    shipping: await one('SELECT poId AS id FROM poitem WHERE typeId = 40 ORDER BY poId LIMIT 1', 222),
    bid: await one('SELECT po.id FROM po JOIN poitem pi ON pi.poId = po.id WHERE po.statusId < 20 GROUP BY po.id ORDER BY COUNT(*) DESC, po.id LIMIT 1', 236),
    customFields: await one("SELECT id FROM po WHERE COALESCE(CustomFieldById(customFields, 70), '') <> '' ORDER BY id LIMIT 1", 129),
    lineCf: await one("SELECT poId AS id FROM poitem WHERE COALESCE(CustomFieldById(customFields, 74), '') <> '' ORDER BY poId LIMIT 1", 213)
  };
  const cf = await T.sql('SELECT id, name FROM customfield WHERE tableId = ? ORDER BY id', [PO_TABLE]);
  PO.poCfIds = cf.map(r => +r.id);
  return PO;
}

const load = async (page, id) => { await page.evaluate(id => window.FBDocApp.load(id), id); await T.rendered(page); };
const env = page => page.evaluate(() => ({ ed: FBDocApp.env.edition, mc: FBDocApp.env.multiCurrency, di: FBDocApp.env.barcodeDI }));
const text = (page, sel) => page.evaluate(sel => Array.from(document.querySelectorAll('#docCanvas ' + sel)).map(e => e.textContent).join('\n'), sel);

test('demodb purchase orders render cleanly (A4 default)', async () => {
  const P = await pos();
  console.log('POs ' + JSON.stringify(P));
  const page = await T.open(PAGE, 'set.PO=' + P.manyLines);
  const E = await env(page);
  for (const name of ['manyLines', 'foreignTaxed', 'foreignRate', 'foreignNoRate', 'notesMemos', 'credit', 'outsourced', 'shipping', 'bid', 'customFields', 'lineCf']) {
    const id = P[name];
    await load(page, id);
    await T.check(page, 'po-' + name, opts());
    const num = (await T.sql('SELECT num, statusId FROM po WHERE id = ?', [id]))[0];
    // Order # (with the DI prefix when barcodes carry one) and the title on every sheet.
    const hdr = await text(page, '.fbdoc-header');
    assert.ok(hdr.includes((E.di ? 'P' : '') + num.num), name + ': order number in the header');
    const title = num.statusid < 20 ? (E.ed === 'AU' ? 'Request for Quote' : 'Bid Request') : 'Purchase Order';
    assert.ok(hdr.includes(title), name + ': title ' + title);
    const lines = (await T.sql('SELECT COUNT(*) AS n FROM poitem WHERE poId = ?', [id]))[0].n;
    assert.equal(await page.evaluate(() => document.querySelectorAll('#docCanvas table[data-fbdoc-table="items"] tbody[data-fbdoc-stripe="row"]').length), +lines, name + ': one row per line');
  }
  // Multi-currency: the vendor-currency columns and totals carry the PO's currency.
  if (E.mc) {
    await load(page, P.foreignTaxed);
    const code = (await T.sql('SELECT c.code FROM po JOIN currency c ON c.id = po.currencyId WHERE po.id = ?', [P.foreignTaxed]))[0].code;
    assert.match(await text(page, 'table[data-fbdoc-table="items"] thead'), new RegExp(code + ' Unit Cost'));
    if (E.ed !== 'US') assert.match(await text(page, '.po-last .tot'), /GST:|Sales Tax:/);
  }
  // Notes print once, above the items.
  await load(page, P.notesMemos);
  assert.match(await text(page, '.po-notes'), /Notes:/);
  await page.close();
});

test('options on: memos, custom fields, every column, dual-currency totals, top logo', async () => {
  const P = await pos();
  const page = await T.open(PAGE, 'set.PO=' + P.notesMemos);
  const [c1, c2, c3, c4] = P.poCfIds.concat([-1, -1, -1, -1]);
  const lineCf = await T.sql("SELECT id FROM customfield WHERE name IN ('Cntr #', 'Location', 'Tower ID') AND tableId <> ? ORDER BY id LIMIT 3", [PO_TABLE]);
  await page.evaluate(o => window.FBDocApp.setSession(o), {
    ShowMemos: true, ShowPOCustomFields: true, 'CustomField:PO1': c1, 'CustomField:PO2': c2, 'CustomField:PO3': c3, 'CustomField:PO4': c4,
    ShowCfItem1: true, ShowCfItem2: true, ShowCfItem3: true,
    'CustomField:Item1': lineCf[0] ? +lineCf[0].id : -1, 'CustomField:Item2': lineCf[1] ? +lineCf[1].id : -1, 'CustomField:Item3': lineCf[2] ? +lineCf[2].id : -1,
    ItemNumberAndDescription: true, ItemRevision: true, ItemFulfillmentDate: true, ItemUnitPrice: true, ItemExtendedPrice: true,
    ItemCurrencyUnitCost: true, ItemCurrencyTotal: true, ItemTaxCode: true, ItemTax: true, ItemCurrencyTax: true,
    OrderShipService: true, OrderCurrency: true, OrderCurrencyRate: true, ShowHomeCurrencyTotals: true, ShowCurrencyTotals: true,
    ShowStatus: true, ShowPartNumber: true, ShowVendorAccountNumber: true, ShowCountry: true, ShowTotalQty: true, cbLogoAlignment: 'top' });
  for (const id of [P.notesMemos, P.customFields, P.lineCf, P.outsourced, P.foreignTaxed, P.manyLines]) {
    await load(page, id);
    await T.check(page, 'po-options-' + id, opts());
  }
  // The foreign PO shows both currency columns in the totals (case iii).
  const E = await env(page);
  if (E.mc) {
    await load(page, P.foreignTaxed);
    const tot = await text(page, '.po-last .tot thead');
    const codes = (await T.sql('SELECT c.code, h.code AS home FROM po JOIN currency c ON c.id = po.currencyId JOIN currency h ON h.homeCurrency = 1 WHERE po.id = ?', [P.foreignTaxed]))[0];
    assert.ok(tot.includes(codes.code) && tot.includes(codes.home), 'dual totals header: ' + tot);
  }
  // Memos, custom-field strip, out-sourced "Returning As" in Number / Description.
  await load(page, P.notesMemos);
  assert.match(await text(page, '.po-memotitle'), /Memos/);
  assert.ok(await page.evaluate(() => document.querySelectorAll('#docCanvas table[data-fbdoc-table="memo"] tbody').length) > 0, 'memo rows');
  await load(page, P.customFields);
  const cfStrip = await text(page, '.po-strip.cf');
  assert.match(cfStrip, /Custom Field 1/);
  await load(page, P.outsourced);
  assert.match(await text(page, 'table[data-fbdoc-table="items"] tbody'), /Returning As:/);
  await load(page, P.lineCf);
  const cfv = (await T.sql('SELECT CustomFieldById(customFields, 74) AS v FROM poitem WHERE poId = ? AND CustomFieldById(customFields, 74) IS NOT NULL LIMIT 1', [P.lineCf]))[0];
  if (cfv && lineCf.length) assert.ok((await text(page, 'table[data-fbdoc-table="items"] tbody')).includes(cfv.v), 'item custom field value');
  await page.close();
});

test('options off: no notes, strip, barcode, company, totals; vendor name off', async () => {
  const P = await pos();
  const page = await T.open(PAGE, 'set.PO=' + P.notesMemos);
  await page.evaluate(() => window.FBDocApp.setSession({
    ShowNotes: false, ShowBarcode: false, ShowCompanyName: false, ShowCompanyAddress: false, ShowVendorContact: false,
    UseVendorNameInAddress: false, ShowBillToPhone: false, ShowBillToEmail: false, ShowBillToFax: false, ShowLineItemNotes: false,
    OrderBuyer: false, OrderPaymentTerms: false, OrderFOBPoint: false, OrderShippingTerms: false, OrderShipVia: false, OrderDateScheduled: false,
    ShowTotals: false, ShowCurrencyTotals: false, ShowHomeCurrencyTotals: false, 'Item#': false, ItemType: false, cbLogoAlignment: 'none' }));
  for (const id of [P.notesMemos, P.manyLines]) {
    await load(page, id);
    await T.check(page, 'po-options-off-' + id, opts());
    const n = await page.evaluate(() => ({
      notes: document.querySelectorAll('#docCanvas .po-notes').length, strip: document.querySelectorAll('#docCanvas .po-strip').length,
      barcode: document.querySelectorAll('#docCanvas .fbdoc-barcode').length, tot: document.querySelectorAll('#docCanvas .po-last .tot').length,
      cols: document.querySelectorAll('#docCanvas table[data-fbdoc-table="items"] thead th').length }));
    assert.deepEqual([n.notes, n.strip, n.barcode, n.tot], [0, 0, 0, 0], 'sections hidden ' + JSON.stringify(n));
  }
  await page.close();
});

test('paper sizes from the Page_setup setting (Letter, A4 landscape, CSS form)', async () => {
  const P = await pos();
  for (const [q, size] of [['Letter', LETTER], ['A4 landscape', [A4[1], A4[0]]], ['size: 8.5in 11in portrait; margin: 0.5in;', LETTER], ['Letter:landscape', [LETTER[1], LETTER[0]]]]) {
    const page = await T.open(PAGE, 'set.PO=' + P.manyLines + '&print=' + encodeURIComponent(q));
    await T.check(page, 'po-paper-' + q.replace(/\W+/g, '_'), opts(size));
    await page.close();
  }
});

// demodb is an AU, multi-currency company: switch the edition / currency mode in
// the page to exercise the US (Total Qty footer, no tax) and CA (tax columns,
// CA cost maths) tables and the single-currency columns.
test('editions: US table (+ Total Qty), CA table (tax columns), single currency', async () => {
  const P = await pos();
  const page = await T.open(PAGE, 'set.PO=' + P.foreignTaxed);
  const setEnv = o => page.evaluate(o => Object.assign(window.FBDocApp.env, o), o);
  const cols = () => page.evaluate(() => Array.from(document.querySelector('#docCanvas table[data-fbdoc-table="items"]').tHead.querySelectorAll('th')).map(t => t.textContent));

  await setEnv({ edition: 'US', isUS: true, isAU: false, isCaOrIntl: false });
  await page.evaluate(() => window.FBDocApp.setSession({ ShowTotalQty: true, ItemTaxCode: true, ItemTax: true }));
  for (const id of [P.foreignTaxed, P.manyLines]) {
    await load(page, id);
    await T.check(page, 'po-edition-US-' + id, opts());
    assert.ok(!(await cols()).some(c => /Tax/.test(c)), 'US table has no tax columns');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#docCanvas tr.tq').length), 1, 'US Total Qty row');
    assert.doesNotMatch(await text(page, '.po-last .tot'), /Tax|GST/);
  }
  await setEnv({ edition: 'CA', isUS: false, isAU: false, isCaOrIntl: true });
  for (const id of [P.foreignTaxed, P.manyLines]) {
    await load(page, id);
    await T.check(page, 'po-edition-CA-' + id, opts());
    assert.ok((await cols()).some(c => /Tax Code/.test(c)), 'CA tax code column');
    assert.match(await text(page, '.po-last .tot'), /Sales Tax:/);
    assert.match(await text(page, '.po-addresses'), /GST\/HST:/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#docCanvas tr.tq').length), 0, 'no Total Qty outside the US');
  }
  await setEnv({ edition: 'AU', isUS: false, isAU: true, isCaOrIntl: false, multiCurrency: false });
  await page.evaluate(() => window.FBDocApp.setSession({ ItemUnitPrice: true, ItemExtendedPrice: true, ItemCurrencyUnitCost: false, ItemCurrencyTotal: false, ShowTotals: true }));
  await load(page, P.manyLines);
  await T.check(page, 'po-single-currency', opts());
  assert.deepEqual((await cols()).filter(c => /Cost/.test(c)), ['Unit Cost', 'Total Cost']);
  await page.close();
});

test('in-page PO picker: browse, status filter, search, pick', async () => {
  const P = await pos();
  const page = await T.open(PAGE, 'set.PO=' + P.manyLines);
  await page.click('#recBrowse');
  await page.waitForSelector('.fbdoc-pick-row', { timeout: 10000 });
  await page.click('.fbdoc-chip[data-f="1"][data-v="all"]');          // period: All (demodb POs are old)
  await page.click('.fbdoc-chip:text-is("Fulfilled")');
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row'));
    return rows.length && rows.every(r => /Fulfilled/.test(r.textContent));
  }, null, { timeout: 10000 });
  await page.click('.fbdoc-chip[data-f="0"][data-v="*"]');            // back to All statuses
  const vendor = (await T.sql('SELECT v.name FROM po JOIN vendor v ON v.id = po.vendorId WHERE po.id = ?', [P.foreignTaxed]))[0].name;
  await page.fill('#recInput', '');
  await page.type('#recInput', vendor.slice(0, 6));
  await page.waitForFunction(v => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row'));
    return rows.length && rows.some(r => r.textContent.includes(v));
  }, vendor, { timeout: 10000 });
  const label = await page.textContent('.fbdoc-pick-row .lb');
  await page.click('.fbdoc-pick-row[data-i="0"]');
  await page.waitForFunction(l => document.getElementById('docTitle').textContent.endsWith(' ' + l), label, { timeout: 15000 });
  await T.rendered(page);
  await T.check(page, 'po-picker', opts());
  await page.close();
});

test('launch from the Purchase Order module: that order, fixed; toolbar = Print + Settings', async () => {
  const P = await pos();
  const shown = async page => ({ num: await page.inputValue('#recInput'), status: await page.textContent('#statusLine') });
  const numOf = async id => (await T.sql('SELECT num FROM po WHERE id = ?', [id]))[0].num;
  const visible = page => page.evaluate(() => ['prevBtn', 'recInput', 'recBrowse', 'nextBtn', 'refreshBtn', 'printBtn', 'setBtn']
    .filter(id => { const e = document.getElementById(id); return e && e.offsetParent !== null; }));

  // By id, over the Purchase_Order setting.
  let page = await T.open(PAGE, 'set.PO=' + P.manyLines + '&' + U.launch({ module: 'PO', moduleName: 'Purchase Order', id: P.foreignTaxed }));
  let s = await shown(page);
  assert.equal(s.num, await numOf(P.foreignTaxed));
  assert.match(s.status, /from Purchase Order module/);
  assert.deepEqual(await visible(page), ['printBtn', 'setBtn'], 'launched toolbar');
  await T.check(page, 'po-launch-id', opts());
  await page.close();

  // By number only.
  const num = await numOf(P.notesMemos);
  page = await T.open(PAGE, 'set.PO=' + P.manyLines + '&' + U.launch({ module: 'PO', moduleName: 'Purchase Order', num }));
  assert.equal((await shown(page)).num, num);
  await page.close();

  // Another module's record: ignored, the setting stands and the picker is back.
  page = await T.open(PAGE, 'set.PO=' + P.manyLines + '&' + U.launch({ module: 'SO', moduleName: 'Sales Order', id: 290 }));
  s = await shown(page);
  assert.equal(s.num, await numOf(P.manyLines));
  assert.doesNotMatch(s.status, /from .* module/);
  assert.ok((await visible(page)).includes('recInput'), 'picker shown');
  assert.deepEqual(page._errors, []);
  await page.close();
});

// Synthetic orders built from a real one: every last-page fill level, long line
// notes and descriptions, a multi-page order note.
test('stress: 1..30 copies of a many-line PO, long notes, multi-page order note', async () => {
  const P = await pos();
  const page = await T.open(PAGE, 'set.PO=' + P.manyLines);
  await page.evaluate(() => window.FBDocApp.setSession({ ShowMemos: true }));
  const results = [];
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 30]) {
    await page.evaluate(async ({ n, id }) => {
      const m = await window.FBDocApp.fetch(id);
      const base = m.lines, lines = [];
      for (let r = 0; r < n; r++) base.forEach(l => lines.push(Object.assign({}, l, { itemid: +l.itemid * 1000 + r, lineno: lines.length + 1 })));
      lines.forEach((l, i) => {
        if (i % 17 === 5) l.note = ('Line note ' + i + '. ').repeat(i % 2 ? 60 : 8);
        if (i % 13 === 3) l.description = ('Long description ' + i + ' ').repeat(12);
      });
      m.lines = lines;
      m.h.note = n % 5 === 0 ? ('Order note paragraph ' + n + '. ').repeat(n * 25) : (m.h.note || 'Short order note.');
      m.memos = n % 3 === 0 ? Array.from({ length: n }, (x, i) => ({ memo: 'Memo ' + i + ' ' + 'text '.repeat(i * 7), username: 'admin', datecreated: '2026-10-12 10:00:00' })) : [];
      await window.FBDocApp.render(m);
    }, { n, id: P.manyLines });
    const r = await T.check(page, 'po-stress-' + n, opts());
    results.push(n + ':' + r.sheets + (r.splits ? '/' + r.splits + 'split' : ''));
  }
  console.log('stress sheets ' + results.join(' '));
  await page.close();
});
