// Render tests: the BUILT Shipping Invoice (invoice / pro-forma, AU / US / CA) in
// headless Chrome against a live Fishbowl database (read-only), checking
// pagination on every sheet and the PDF.
//
//   node --test Other_NOT_FOR_PRODUCTION/Paperwork_POC/tests/ShippingInvoice.test.js
//
// Needs: Chrome, playwright-core and DB access — see doc-util.js / harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('./doc-util.js');
const { A4, LETTER } = U;

const T = U.suite(['ShippingInvoice.htm']);
const PAGE = 'ShippingInvoice.htm';
const SEL = { pg: '.si-foot .pg', last: '.si-last', tables: ['items', 'carton'] };
const opts = size => Object.assign({ size: size || A4 }, SEL);
const D = '\x24';   // a dollar sign, so this file never holds a setting-token literal

// ---- demodb shipments (ship.id), chosen by query for what they exercise ----
let PICKS = null;
async function picks() {
  if (PICKS) return PICKS;
  const one = async (sql) => { const r = await T.sql(sql); return r.length ? +r[0].id : 0; };
  const SO_SHIP = 's.orderTypeId = 20';
  PICKS = {
    // invoices (status 30, posted)
    mostLines: await one(`SELECT s.id FROM ship s JOIN shipitem si ON si.shipId = s.id JOIN postsoitem p ON p.shipItemId = si.id
                          WHERE s.statusId = 30 AND ${SO_SHIP} GROUP BY s.id ORDER BY COUNT(*) DESC, s.id LIMIT 1`),
    kits: await one(`SELECT s.id FROM ship s JOIN shipitem si ON si.shipId = s.id JOIN soitem i ON i.id = si.soItemId
                     JOIN objecttoobject o ON o.recordId1 = i.id AND o.typeId = 30 JOIN postsoitem p ON p.shipItemId = si.id
                     WHERE s.statusId = 30 AND ${SO_SHIP} GROUP BY s.id ORDER BY COUNT(*) DESC, s.id LIMIT 1`),
    discountShipping: await one(`SELECT MIN(s.id) AS id FROM postsoitem p JOIN soitem i ON i.id = p.soItemId
                     JOIN shipitem si ON si.id = (SELECT MIN(p2.shipItemId) FROM postsoitem p2 WHERE p2.postSoId = p.postSoId)
                     JOIN ship s ON s.id = si.shipId WHERE i.typeId IN (30, 60) GROUP BY p.postSoId
                     HAVING COUNT(DISTINCT i.typeId) = 2 ORDER BY id LIMIT 1`),
    subtotalLine: await one(`SELECT MIN(s.id) AS id FROM postsoitem p JOIN soitem i ON i.id = p.soItemId
                     JOIN shipitem si ON si.id = (SELECT MIN(p2.shipItemId) FROM postsoitem p2 WHERE p2.postSoId = p.postSoId)
                     JOIN ship s ON s.id = si.shipId WHERE i.typeId = 40 GROUP BY p.postSoId ORDER BY id LIMIT 1`),
    foreign: await one(`SELECT s.id FROM ship s JOIN so ON so.id = s.soId WHERE s.statusId = 30 AND ${SO_SHIP} AND so.currencyRate <> 1
                        ORDER BY s.id LIMIT 1`),
    serials: await one(`SELECT s.id FROM ship s JOIN shipitem si ON si.shipId = s.id JOIN inventorylog il ON il.tableId = 1555030112 AND il.recordId = si.id
                        JOIN tiinventorylog til ON til.inventoryLogId = il.id WHERE s.statusId = 30 AND ${SO_SHIP}
                        GROUP BY s.id ORDER BY COUNT(*) DESC, s.id LIMIT 1`),
    signature: await one(`SELECT s.id FROM ship s JOIN image im ON LOWER(im.tableName) = 'ship' AND im.recordId = s.id
                          WHERE s.statusId = 30 AND ${SO_SHIP} ORDER BY (SELECT COUNT(*) FROM shipcarton c WHERE c.shipId = s.id) DESC, s.id LIMIT 1`),
    trackingNo: await one(`SELECT s.id FROM ship s JOIN shipcarton c ON c.shipId = s.id WHERE TRIM(COALESCE(c.trackingNum, '')) <> ''
                           AND s.statusId = 30 AND ${SO_SHIP} GROUP BY s.id ORDER BY COUNT(*) DESC, s.id LIMIT 1`),
    // pro-formas (any other status, live shipment data)
    packed: await one(`SELECT s.id FROM ship s WHERE s.statusId = 20 AND ${SO_SHIP}
                       ORDER BY (SELECT COUNT(*) FROM shipitem si WHERE si.shipId = s.id) DESC, s.id LIMIT 1`),
    enteredNote: await one(`SELECT s.id FROM ship s JOIN so ON so.id = s.soId WHERE s.statusId = 10 AND ${SO_SHIP}
                            ORDER BY LENGTH(COALESCE(so.note, '')) DESC, (SELECT COUNT(*) FROM shipitem si WHERE si.shipId = s.id) DESC, s.id LIMIT 1`),
    // not a sales-order shipment: the red "Cannot create invoice" message
    transfer: await one(`SELECT s.id FROM ship s WHERE s.orderTypeId <> 20 ORDER BY s.id LIMIT 1`)
  };
  for (const [k, v] of Object.entries(PICKS)) assert.ok(v > 0, 'demodb has a shipment for ' + k);
  console.log('demodb shipments ' + JSON.stringify(PICKS));
  return PICKS;
}

const load = async (page, id) => { await page.evaluate(id => window.FBDocApp.load(id), id); return T.rendered(page); };
const text = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
const rawText = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent).join(''));
const amount = s =>parseFloat(String(s).replace(/[^0-9.-]/g, ''));

test('lint: setting tokens, directives and the fb-launch tag appear once', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', PAGE), 'utf8');
  const count = s => src.split(s).length - 1;
  assert.equal(count(D + 'SHIP{'), 1, 'shipment setting token');
  assert.equal(count(D + 'PRINT{'), 1, 'page setting token');
  assert.equal(count('{' + '% Script fb-lib %}'), 1, 'fb-lib directive');
  assert.equal(count('{' + '% Style fb-styles %}'), 1, 'fb-styles directive');
  assert.equal((src.match(/\$[A-Z][A-Z0-9_]*\{/g) || []).length, 2, 'no other setting-token literal');
  assert.equal((src.match(/name="fb-launch"/g) || []).length, 1, 'one fb-launch tag');
  const first = src.indexOf('name="fb-launch"');
  assert.ok(first > src.indexOf('<head>') && first < src.indexOf('</head>'), 'the fb-launch tag sits in <head>');
  assert.equal(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(src), false, 'no control characters');
  assert.equal(/window\.FB_REPORT[\s\S]*key:\s*'cdx\.bi\.paperwork\.shipinv'[\s\S]*name:\s*'Shipping Invoice'[\s\S]*build:\s*'UNSTAMPED'/.test(src), true, 'FB_REPORT');
});

test('demodb shipments render cleanly (A4): invoices, pro-formas, the error case', async () => {
  const P = await picks();
  const page = await T.open(PAGE, 'set.SHIP=' + P.kits);
  const titles = {};
  for (const name of ['mostLines', 'kits', 'discountShipping', 'subtotalLine', 'foreign', 'serials', 'signature', 'trackingNo', 'packed', 'enteredNote', 'transfer']) {
    await load(page, P[name]);
    const r = await T.check(page, 'ship-' + name, opts());
    titles[name] = (await page.textContent('#docTitle')).split(' ')[0] + ' ' + (await page.textContent('#docTitle')).split(' ')[1] + ':' + r.sheets;
  }
  console.log('titles ' + JSON.stringify(titles));
  // Dispatch: status 30 = invoice, else pro-forma; AU edition titles.
  assert.match(titles.kits, /^Tax Invoice/);
  assert.match(titles.packed, /^Tax Proforma/);
  assert.match(titles.enteredNote, /^Tax Proforma/);
  await load(page, P.transfer);
  assert.deepEqual(await text(page, '#docCanvas .si-err'), ['Cannot create invoice. Order must be shipped and be a Sales Order type.']);
  await page.close();
});

test('AU invoice: GST totals match the posted lines; kits indented, tracking under the line', async () => {
  const P = await picks();
  const page = await T.open(PAGE, 'set.SHIP=' + P.kits);
  for (const id of [P.kits, P.discountShipping, P.foreign, P.serials]) {
    await load(page, id);
    const [exp] = await T.sql(`SELECT SUM(p.totalPrice / so.currencyRate) AS sub, SUM(ROUND(p.totalPrice * i.taxRate / so.currencyRate, 2)) AS tax
      FROM postsoitem p JOIN soitem i ON i.id = p.soItemId JOIN so ON so.id = i.soId
      WHERE p.postSoId = (SELECT MIN(p2.postSoId) FROM shipitem si JOIN postsoitem p2 ON p2.shipItemId = si.id WHERE si.shipId = ?) AND i.typeId <> 40`, [id]);
    const rows = await page.$$eval('#docCanvas .si-last .tot tbody tr', trs => trs.map(tr => Array.from(tr.cells).map(td => td.textContent.trim()).filter(Boolean)));
    assert.deepEqual(rows.map(r => r[0]), ['Subtotal:', 'GST:', 'Total:'], 'labels ' + id);
    const sub = Math.round(+exp.sub * 100) / 100, tax = Math.round(+exp.tax * 100) / 100;
    assert.equal(amount(rows[0][1]), sub, 'subtotal ' + id);
    assert.equal(amount(rows[1][1]), tax, 'GST ' + id);
    assert.equal(amount(rows[2][1]), Math.round((+exp.sub + +exp.tax) * 100) / 100, 'total ' + id);
  }
  // Kit components are indented under their kit.
  await load(page, P.kits);
  const items = await page.$$eval('#docCanvas table[data-fbdoc-table="items"] tbody tr', trs => trs.map(tr => Array.from(tr.cells).map(td => td.textContent)));
  assert.ok(items.some(r => r.some(c => /^ {5}\S/.test(c))), 'a kit component is indented 5 spaces');
  // Serial numbers print under the shipped line.
  await load(page, P.serials);
  assert.match((await text(page, '#docCanvas table[data-fbdoc-table="items"]')).join(' '), /SN\(s\): \S+/);
  await page.close();
});

test('options: cartons, signature, custom fields, every column, home totals, total qty, order # / logo choices', async () => {
  const P = await picks();
  const page = await T.open(PAGE, 'set.SHIP=' + P.signature);
  await page.evaluate(() => window.FBDocApp.setSession({
    ShowCartonInfo: true, ShowDeliverySignature: true, ShowSOCustomFields: true, ItemNumberAndDescription: true,
    UnitPrice: true, ExtendedPrice: true, ItemCurrencyTax: true, ShowHomeCurrencyTotals: true, ShowTotalQty: true,
    OrderCurrency: true, OrderCurrencyRate: true, IncludeKitsInItemNumbering: false, cbOrderNumber: 'PO', cbLogoAlignment: 'top',
    ShowCountry: true, ShowCfItem1: true, ShowCfItem2: true, ShowCfItem3: true }));
  for (const id of [P.signature, P.kits, P.foreign, P.trackingNo, P.packed]) {
    await load(page, id);
    await T.check(page, 'options-' + id, opts());
  }
  // Signature shown in place of the approval line; cartons block with its count.
  await load(page, P.signature);
  assert.equal(await page.$$eval('#docCanvas .si-last .sig img', e => e.length), 1, 'signature image');
  assert.deepEqual(await text(page, '#docCanvas .si-last .rcv'), ['Received By:']);
  assert.ok((await text(page, '#docCanvas .si-csum')).some(t => /Count: \d+/.test(t)), 'carton count');
  // Home + order-currency totals: a header row with both currency codes (foreign order).
  await load(page, P.foreign);
  const heads = await text(page, '#docCanvas .si-last .tot thead th');
  assert.ok(heads.includes('USD') && heads.includes('AUD'), 'currency columns ' + heads.join('/'));
  // Kit rows unnumbered when kits are not counted.
  await load(page, P.kits);
  const nums = await page.$$eval('#docCanvas table[data-fbdoc-table="items"] tbody tr:not(.tq)', trs => trs.map(tr => tr.cells[0].textContent.trim()));
  assert.ok(nums.includes(''), 'kit line has no number');

  // Second set: single-currency mode, home totals only / no totals.
  await page.evaluate(() => { window.FBDocApp.env.multiCurrency = false; window.FBDocApp.setSession({ UnitPrice: true, ExtendedPrice: true,
    CurrencyUnitPrice: false, CurrencyExtendedPrice: false, ShowCartonInfo: true, cbOrderNumber: 'SO' }); });
  for (const id of [P.mostLines, P.packed]) {
    await load(page, id);
    await T.check(page, 'single-currency-' + id, opts());
  }
  await page.evaluate(() => { window.FBDocApp.env.multiCurrency = true; window.FBDocApp.setSession({ ShowCurrencyTotals: false, ShowHomeCurrencyTotals: true }); });
  await load(page, P.foreign);
  assert.deepEqual(await text(page, '#docCanvas .si-last .tot thead th:not(.sp)'), ['AUD'], 'home column only');
  await T.check(page, 'home-only', opts());
  await page.evaluate(() => window.FBDocApp.setSession({ ShowCurrencyTotals: false, ShowHomeCurrencyTotals: false }));
  await load(page, P.foreign);
  assert.equal(await page.$$eval('#docCanvas .si-last .tot', e => e.length), 0, 'no totals');
  await page.close();
});

test('editions: US and CA invoice / pro-forma (titles, tax columns, labels, Pay Online)', async () => {
  const P = await picks();
  const page = await T.open(PAGE, 'set.SHIP=' + P.kits);
  // US and CA print on Letter (the all-reports paper by edition; Page_setup is left at its
  // default), unless an admin set a size for all reports in the database the harness reads.
  const all = await T.sql("SELECT up.userValue AS v FROM userproperties up JOIN sysuser su ON su.id = up.userId " +
    "WHERE up.userKey = 'cdx.bi.paper.v1' AND su.userName = 'admin' ORDER BY up.id DESC LIMIT 1");
  const allSize = all.length ? (JSON.parse(all[0].v || '{}').size || '') : '';
  const usPaper = allSize === 'A4' ? A4 : LETTER;
  for (const ed of ['US', 'CA']) {
    await page.evaluate(ed => { window.FBDocApp.env.edition = ed; }, ed);
    await load(page, P.discountShipping);
    assert.match(await page.textContent('#docTitle'), /^Invoice /, ed + ' invoice title');
    const heads = (await text(page, '#docCanvas table[data-fbdoc-table="items"] thead th')).join('|');
    if (ed === 'US') assert.doesNotMatch(heads, /Tax Code/, 'US has no tax columns');
    else assert.match(heads, /Tax Code/, 'CA keeps the tax code');
    assert.ok((await text(page, '#docCanvas .si-last .tot td')).includes('Sales Tax:'), ed + ' tax label');
    await T.check(page, 'edition-' + ed + '-invoice', opts(usPaper));
    await load(page, P.packed);
    assert.match(await page.textContent('#docTitle'), /^Proforma /, ed + ' pro-forma title');
    await T.check(page, 'edition-' + ed + '-proforma', opts(usPaper));
  }
  // US: Pay Online button + caption when the order has a payment link; the longer approval line on the pro-forma.
  await page.evaluate(() => { window.FBDocApp.env.edition = 'US'; });
  await load(page, P.packed);
  assert.match((await rawText(page, '#docCanvas .si-last .msg')), /^Approval:_{29} {5}Date:_{13}$/);
  await page.evaluate(async id => {
    const m = await window.FBDocApp.fetch(id); m.h.paymentlink = 'https://pay.example.com/i/1';
    await window.FBDocApp.render(m);
  }, P.discountShipping);
  assert.deepEqual(await text(page, '#docCanvas .si-last .si-pay'), ['Pay Online']);
  assert.match((await text(page, '#docCanvas .si-last .si-paytxt')).join(''), /only the invoice total is due/);
  await T.check(page, 'edition-US-pay', opts(usPaper));
  // AU again: approval line of the AU sub.
  await page.evaluate(() => { window.FBDocApp.env.edition = 'AU'; });
  await load(page, P.kits);
  assert.match((await rawText(page, '#docCanvas .si-last .msg')), /^Approval:_{25} {5}Date:_{13}$/);
  await page.close();
});

test('paper sizes from the Page_setup setting', async () => {
  const P = await picks();
  for (const [q, size] of [['Letter', LETTER], ['A4 landscape', [A4[1], A4[0]]], ['Letter:landscape', [LETTER[1], LETTER[0]]]]) {
    const page = await T.open(PAGE, 'set.SHIP=' + P.mostLines + '&print=' + encodeURIComponent(q));
    await T.check(page, 'paper-' + q.replace(/\W+/g, '_'), opts(size));
    await page.close();
  }
});

test('in-page shipment picker: browse, status filter, search by SO number, pick', async () => {
  const P = await picks();
  const page = await T.open(PAGE, 'set.SHIP=' + P.kits);
  await page.click('#recBrowse');
  await page.click('.fbdoc-chip[data-f="1"][data-v="all"]');          // period: All (demodb shipments are old)
  // The chip's search is debounced (200 ms), and until it fires the previous
  // period's rows still satisfy the wait below. Let it start, then wait for its list.
  await page.waitForTimeout(300);
  await page.waitForFunction(() => document.querySelectorAll('.fbdoc-pick-row').length > 1, null, { timeout: 15000 });
  assert.ok((await page.$$('.fbdoc-pick-row')).length > 1, 'browse lists shipments');
  await page.click('.fbdoc-chip:text-is("Packed")');
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row'));
    return rows.length && rows.every(r => /Packed/.test(r.textContent));
  }, null, { timeout: 10000 });
  await page.click('.fbdoc-chip[data-f="0"][data-v="*"]');
  const [{ sonum, num }] = await T.sql('SELECT so.num AS sonum, s.num FROM ship s JOIN so ON so.id = s.soId WHERE s.id = ?', [P.packed]);
  await page.fill('#recInput', '');
  await page.type('#recInput', sonum);
  await page.waitForFunction(n => Array.from(document.querySelectorAll('.fbdoc-pick-row .lb')).some(r => r.textContent === n), num, { timeout: 10000 });
  await page.click('.fbdoc-pick-row:has(.lb:text-is("' + num + '"))');
  await page.waitForFunction(n => document.getElementById('docTitle').textContent.endsWith(' ' + n), num, { timeout: 15000 });
  await T.rendered(page);
  await T.check(page, 'picker', opts());
  await page.close();
});

test('launch from the Shipping module: that shipment, fixed; toolbar = Print + Settings', async () => {
  const P = await picks();
  const visible = page => page.evaluate(() => ['prevBtn', 'recInput', 'recBrowse', 'nextBtn', 'refreshBtn', 'printBtn', 'setBtn']
    .filter(id => { const e = document.getElementById(id); return e && e.offsetParent !== null; }));
  const [{ num }] = await T.sql('SELECT num FROM ship WHERE id = ?', [P.packed]);
  let page = await T.open(PAGE, 'set.SHIP=' + P.kits + '&' + U.launch({ module: 'SHIP', moduleName: 'Shipping', id: P.packed }));
  assert.equal(await page.inputValue('#recInput'), num);
  assert.match(await page.textContent('#statusLine'), /from Shipping module/);
  assert.deepEqual(await visible(page), ['printBtn', 'setBtn'], 'launched toolbar');
  await T.check(page, 'launch-id', opts());
  await page.close();
  // By number only.
  page = await T.open(PAGE, 'set.SHIP=' + P.kits + '&' + U.launch({ module: 'SHIP', num }));
  assert.equal(await page.inputValue('#recInput'), num);
  await page.close();
  // Another module's record: ignored, the setting stands and the picker is back.
  const [{ num: kitsNum }] = await T.sql('SELECT num FROM ship WHERE id = ?', [P.kits]);
  page = await T.open(PAGE, 'set.SHIP=' + P.kits + '&' + U.launch({ module: 'SO', moduleName: 'Sales Order', id: 1 }));
  assert.equal(await page.inputValue('#recInput'), kitsNum);
  assert.doesNotMatch(await page.textContent('#statusLine'), /from .* module/);
  assert.ok((await visible(page)).includes('recInput'), 'picker shown');
  assert.deepEqual(page._errors, []);
  await page.close();
});

// Synthetic shipments built from a real one: every last-page fill level, kits
// straddling breaks, long tracking / line notes, a multi-page SO note, cartons.
test('stress: 1..30 copies of a kitted invoice, long notes and tracking, cartons', async () => {
  const P = await picks();
  const page = await T.open(PAGE, 'set.SHIP=' + P.kits);
  await page.evaluate(() => window.FBDocApp.setSession({ ShowCartonInfo: true, ShowTotalQty: true }));
  await load(page, P.kits);
  const results = [];
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 30]) {
    await page.evaluate(async ({ n, id }) => {
      const m = await window.FBDocApp.fetch(id);
      const base = m.lines, lines = [];
      for (let r = 0; r < n; r++) base.forEach(l => lines.push(Object.assign({}, l, {
        rowid: +l.rowid * 1000 + r, soitemid: +l.soitemid * 1000 + r, lineno: lines.length + 1,
        kitparent: l.kitparent != null ? +l.kitparent * 1000 + r : null })));
      lines.forEach((l, i) => {
        if (i % 23 === 7) l.note = ('Line note ' + i + '. ').repeat(i % 2 ? 60 : 8);
        if (i % 17 === 3) l.tracking = 'SN(s): ' + Array.from({ length: 40 + i }, (_, k) => 'FG2100-' + (6878000 + k)).join(', ');
      });
      m.lines = lines;
      const cartons = m.cartons;
      m.cartons = [];
      for (let r = 0; r < (n % 3 === 0 ? n : 1); r++) cartons.forEach(c => m.cartons.push(Object.assign({}, c, { cartonnum: m.cartons.length + 1 })));
      m.h.sonote = n % 5 === 0 ? ('Order note paragraph ' + n + '. ').repeat(n * 25) : m.h.sonote;
      await window.FBDocApp.render(m);
    }, { n, id: P.kits });
    const r = await T.check(page, 'stress-' + n, opts());
    results.push(n + ':' + r.sheets + (r.splits ? '/' + r.splits + 'split' : ''));
  }
  console.log('stress sheets ' + results.join(' '));
  await page.close();
});
