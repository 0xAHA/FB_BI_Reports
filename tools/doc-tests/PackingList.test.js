// Render tests: the Packing Slip (Ship/PackingList.jrxml replica — SO, PO
// and TO layouts) in headless Chrome against a live Fishbowl database
// (read-only), checking pagination on every sheet and the PDF.
//
//   node --test tools/doc-tests/PackingList.test.js
//
// Needs: Chrome, playwright-core and DB access — see doc-util.js / harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./doc-util.js');
const { A4, LETTER } = U;

const T = U.suite(['PackingList.htm']);
const PAGE = 'PackingList.htm';
const SEL = { pg: '.pl-foot .pg', last: null, tables: ['items', 'cartons'] };
const opts = size => Object.assign({ size: size || A4 }, SEL);

// demodb shipments (ship.id), chosen on first use by what they hold (the suite's
// before hook starts the harness, so pick lazily rather than in another hook).
const SHIP = {};
let picked = null;
function ships() { return picked || (picked = pickShips()); }

async function pickShips() {
  const one = async (sql, why) => {
    const r = await T.sql(sql);
    assert.ok(r.length, 'no demodb shipment for: ' + why);
    return r[0].id;
  };
  const items = 'SELECT COUNT(*) FROM shipitem i WHERE i.shipId = s.id';
  const cartons = 'SELECT COUNT(*) FROM shipcarton c WHERE c.shipId = s.id';
  const tracked = 'SELECT COUNT(*) FROM shipitem i JOIN trackinginfo ti ON ti.tableId = 1555030112 AND ti.recordId = i.id WHERE i.shipId = s.id';
  const kitKids = 'SELECT COUNT(*) FROM shipitem i JOIN objecttoobject o ON o.recordId1 = i.soItemId AND o.typeId = 30 WHERE i.shipId = s.id';
  // SO, several cartons + kit children + tracking (S25 on demodb)
  SHIP.kits = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 20 AND (${kitKids}) > 0 AND (${cartons}) > 1 AND (${tracked}) > 0 ORDER BY s.id LIMIT 1`, 'kits + cartons + tracking');
  // SO, the most cartons
  SHIP.cartons = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 20 ORDER BY (${cartons}) DESC, (${items}) DESC, s.id LIMIT 1`, 'many cartons');
  // SO, the most tracking rows (serials / lots)
  SHIP.tracking = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 20 ORDER BY (${tracked}) DESC, s.id LIMIT 1`, 'tracking');
  // SO packed (not yet shipped: date = today) and entered
  SHIP.packed = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 20 AND s.statusId = 20 ORDER BY (${items}) DESC, s.id LIMIT 1`, 'packed');
  SHIP.entered = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 20 AND s.statusId = 10 ORDER BY (${items}) DESC, s.id LIMIT 1`, 'entered');
  // SO with a shipment note and carton tracking numbers
  SHIP.note = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 20 AND s.note <> '' AND EXISTS (SELECT 1 FROM shipcarton c WHERE c.shipId = s.id AND c.trackingNum <> '') ORDER BY s.id LIMIT 1`, 'note + tracking #');
  // SO with a captured delivery signature
  SHIP.signed = await one(`SELECT s.id FROM ship s JOIN image i ON LOWER(i.tableName) = 'ship' AND i.recordId = s.id WHERE s.orderTypeId = 20 ORDER BY (${cartons}) DESC, s.id LIMIT 1`, 'signature');
  // PO (vendor return / outsourced) and TO shipments
  SHIP.po = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 10 ORDER BY s.id LIMIT 1`, 'PO shipment');
  SHIP.to = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 40 ORDER BY (${items}) DESC, s.id LIMIT 1`, 'TO shipment');
  SHIP.to2 = await one(`SELECT s.id FROM ship s WHERE s.orderTypeId = 40 ORDER BY (${items}) ASC, s.id LIMIT 1`, 'small TO shipment');
  // SO with a date-typed SO custom field (id 41) set — for the custom-field strip
  SHIP.cf = await one(`SELECT s.id FROM ship s JOIN so ON so.id = s.soId WHERE CustomFieldById(so.customFields, 41) LIKE '2%' ORDER BY s.id LIMIT 1`, 'SO custom field');
  console.log('demodb shipments: ' + JSON.stringify(SHIP));
}

const load = async (page, id) => { await page.evaluate(id => window.FBDocPage.load(id), id); await T.rendered(page); };
const text = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent));

test('demodb shipments render cleanly (A4 default): SO, PO and TO layouts', async () => {
  await ships();
  const page = await T.open(PAGE, 'set.SHIP=' + SHIP.kits);
  for (const [name, id] of Object.entries(SHIP)) {
    await load(page, id);
    const r = await T.check(page, 'pl-' + name, opts());
    assert.ok(r.sheets >= 1);
  }
  await page.close();
});

test('content: kits, tracking, cartons, back-orders, order types', async () => {
  await ships();
  const page = await T.open(PAGE, 'set.SHIP=' + SHIP.kits);
  // Kits: a kit header followed by its indented children, tracking text under a description.
  let model = await page.evaluate(() => window.FBDocPage.model);
  assert.equal(model.type, 'SO');
  const kidRow = model.lines.find(l => l.kitparentline != null);
  assert.ok(kidRow, 'kit child line');
  const parts = await text(page, 'table[data-fbdoc-table="items"] tbody td:nth-child(2) .pre');
  assert.ok(parts.some(t => t.startsWith('     ')), 'kit child Part # indented 5 spaces');
  const descs = await text(page, 'table[data-fbdoc-table="items"] tbody td:nth-child(3) .pre');
  assert.ok(descs.some(t => /\n[\d.,]+ \S+ - (SN\(s\)|Lot#|Batch#|ExpDate)/.test(t)), 'tracking text under a description: ' + JSON.stringify(descs));
  // Cartons: one row per carton + the footer "<Container> Count: n".
  const cartonRows = await page.$$eval('table[data-fbdoc-table="cartons"] tbody', b => b.length);
  assert.equal(cartonRows, model.cartons.length + 1);
  const container = await page.evaluate(() => FBDocPage.env.container);
  assert.ok((await text(page, '.pl-cartons .tc')).some(t => t === container + ' Count: ' + model.cartons.length));
  // Order # = DI prefix + SO number; the barcode carries the same text.
  const orderNo = await page.evaluate(() => document.querySelector('.fbdoc-header .pl-box.pl-center').textContent);
  const di = await page.evaluate(() => FBDocPage.env.barcodeDI);
  assert.equal(orderNo, (di ? 'S' : '') + model.h.ordernum);
  assert.equal(await page.getAttribute('.fbdoc-header svg.fbdoc-barcode', 'aria-label'), orderNo);

  // PO: Ship To from the shipment, Bill To = remit-to, Unit Cost header when on.
  await load(page, SHIP.po);
  model = await page.evaluate(() => window.FBDocPage.model);
  assert.equal(model.type, 'PO');
  assert.match(await page.textContent('#docTitle'), /^Packing Slip /);
  assert.deepEqual(await text(page, '.pl-addresses .h'), ['Ship To:', 'Bill To:']);

  // TO: From / To headers with the location-group names, Owner column.
  await load(page, SHIP.to);
  model = await page.evaluate(() => window.FBDocPage.model);
  assert.equal(model.type, 'TO');
  const hdrs = await text(page, '.pl-addresses .h');
  assert.equal(hdrs[0], 'From: ' + model.h.fromlgname);
  assert.equal(hdrs[1], 'To: ' + model.h.shiptolgname);
  assert.ok((await text(page, '.pl-strip th')).includes('Owner'));
  const toCols = await text(page, 'table[data-fbdoc-table="items"] thead th');
  assert.deepEqual(toCols.map(t => t.replace(/\n/g, ' ')), ['Line #', 'Part #', 'Description', 'Qty Ordered', 'Qty Shipped', 'Qty Remaining']);
  assert.deepEqual(page._errors, []);
  await page.close();
});

test('options: columns, totals, kit/back-order switches, logo/blind, signature, custom fields', async () => {
  await ships();
  const page = await T.open(PAGE, 'set.SHIP=' + SHIP.kits);
  const base = await page.evaluate(() => window.FBDocPage.model.lines.length);

  // Everything on: all SO columns (compact), totals, custom fields, signature, top logo, contact names.
  await page.evaluate(() => window.FBDocPage.setSession({
    PartNumDescription: true, UnitPrice: true, TotalPrice: true, ShowCfItem1: true, ShowCfItem2: true, ShowCfItem3: true,
    'CustomField:Item1': 52, 'CustomField:SO1': 41, 'CustomField:SO2': 48,
    ShowSOCustomFields: true, ShowTotalQty: true, ShowDeliverySignature: true, cbLogoAlignment: 'top', cbContactToShow: 'contact',
    ShowUniqueShipNumbers: true }));
  for (const id of [SHIP.kits, SHIP.cf, SHIP.signed, SHIP.po, SHIP.to]) {
    await load(page, id);
    await T.check(page, 'pl-options-' + id, opts());
  }
  await load(page, SHIP.signed);
  assert.ok(await page.$('.pl-sig img'), 'delivery signature image');
  assert.ok((await text(page, 'tr.tot .lab')).some(t => t === 'Total Qty: '), 'Total Qty footer');
  const shipNum = await page.evaluate(() => FBDocPage.model.h.shipnum);
  assert.equal(await page.evaluate(() => document.querySelector('.fbdoc-header .pl-box.pl-center').textContent), shipNum, 'unique ship number, no DI prefix');
  await load(page, SHIP.cf);
  const cfCells = await text(page, '.pl-strip.cf td');
  assert.match(cfCells[0], /^\d{2}\/\d{2}\/\d{4}$|^\d/, 'date custom field formatted: ' + cfCells[0]);

  // Back-orders and kit headers off, kit headers only, country off, blind, no cartons, no barcode.
  await page.evaluate(() => window.FBDocPage.setSession({ ckShowBackOrderItems: '101', ckShowKitHeaders: '90', ckShowCountry: '0' }));
  await load(page, SHIP.kits);
  let m = await page.evaluate(() => window.FBDocPage.model);
  assert.ok(m.lines.length < base, 'fewer lines without back-orders / kit headers');
  assert.ok(m.lines.every(l => +l.sotype !== 80), 'no kit header line');
  assert.ok(m.lines.every(l => l.shipitemid), 'only lines on this shipment');
  await T.check(page, 'pl-options-nobackorder', opts());

  await page.evaluate(() => window.FBDocPage.setSession({ ShowKitHeadersOnly: true, BlindShipment: true, ShowCartonInfo: false, ShowBarcode: false, ShowTracking: false }));
  await load(page, SHIP.kits);
  m = await page.evaluate(() => window.FBDocPage.model);
  assert.ok(m.lines.every(l => l.kitparentline == null), 'kit headers only: no kit children');
  assert.equal(await page.$('.fbdoc-header .pl-company'), null, 'blind: no company name');
  assert.equal(await page.$('.fbdoc-header svg'), null, 'no barcode');
  assert.equal(await page.$('table[data-fbdoc-table="cartons"]'), null, 'no carton list');
  await T.check(page, 'pl-options-blind', opts());

  // Logo hidden (V2 ShowLogo): address only.
  await page.evaluate(() => window.FBDocPage.setSession({ ShowLogo: false }));
  await load(page, SHIP.kits);
  assert.equal(await page.$('.fbdoc-header .pl-logo'), null);
  await T.check(page, 'pl-options-nologo', opts());
  assert.deepEqual(page._errors, []);
  await page.close();
});

test('carton tracking links by carrier (UPS / FedEx / USPS / other)', async () => {
  await ships();
  const page = await T.open(PAGE, 'set.SHIP=' + SHIP.cartons);
  const links = await page.evaluate(async id => {
    const m = await window.FBDocPage.fetch(id);
    const c0 = m.cartons[0];
    m.cartons = ['UPS Ground', 'FedEx', 'USPS Priority', 'StarTrack'].map((car, i) => Object.assign({}, c0, { cartonnum: i + 1, carriername: car, trackingnumber: '1Z99' + i }));
    await window.FBDocPage.render(m);
    return Array.from(document.querySelectorAll('.pl-cartons tbody td.r')).map(td => { const a = td.querySelector('a'); return a ? a.href : td.textContent; });
  }, SHIP.cartons);
  assert.match(links[0], /wwwapps\.ups\.com.*InquiryNumber1=1Z990/);
  assert.match(links[1], /fedex\.com\/fedextrack\/\?trknbr=1Z991/);
  assert.match(links[2], /usps\.com.*strOrigTrackNum=1Z992/);
  assert.equal(links[3], '1Z993');
  await T.check(page, 'pl-carrier-links', opts());

  // A shipment of order type None / Work Order: one sheet with a notice (no demodb record has one).
  await page.evaluate(async id => {
    const m = await window.FBDocPage.fetch(id);
    await window.FBDocPage.render({ type: null, orderType: 30, h: { id: m.h.id, num: m.h.num }, lines: [], cartons: [], tracking: {} });
  }, SHIP.cartons);
  assert.match(await page.textContent('.pl-notice'), /has order type Work Order/);
  await T.check(page, 'pl-wo-type', opts());
  await page.close();
});

test('paper sizes from the Page_setup setting', async () => {
  await ships();
  for (const [q, size] of [['Letter', LETTER], ['A4 landscape', [A4[1], A4[0]]], ['Letter:landscape', [LETTER[1], LETTER[0]]]]) {
    for (const id of [SHIP.kits, SHIP.to]) {
      const page = await T.open(PAGE, 'set.SHIP=' + id + '&print=' + encodeURIComponent(q));
      await T.check(page, 'pl-paper-' + id + '-' + q.replace(/\W+/g, '_'), opts(size));
      await page.close();
    }
  }
});

test('in-page shipment picker: browse, status filter, search by order number, pick', async () => {
  await ships();
  const page = await T.open(PAGE, 'set.SHIP=' + SHIP.kits);
  await page.evaluate(() => FBLib.Common.togglePanel('filtersPanel', true));
  await page.click('#recBrowse');
  await page.click('.fbdoc-chip[data-f="1"][data-v="all"]');          // period: All (demodb shipments are old)
  // A chip click re-runs the search ("Searching…" replaces the rows), so wait for the list itself.
  await page.waitForFunction(() => document.querySelectorAll('.fbdoc-pick-row').length > 1, null, { timeout: 10000 });
  await page.click('.fbdoc-chip:text-is("Shipped")');
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row'));
    return rows.length && rows.every(r => /Shipped/.test(r.textContent));
  }, null, { timeout: 10000 });
  await page.click('.fbdoc-chip[data-f="0"][data-v="*"]');            // back to All statuses
  // Search by the TO's order number: the row label is the shipment number.
  const to = (await T.sql('SELECT s.num, xo.num AS ordernum FROM ship s JOIN xo ON xo.id = s.xoId WHERE s.id = ?', [SHIP.to]))[0];
  await page.fill('#recInput', '');
  await page.type('#recInput', to.ordernum);
  await page.waitForFunction(n => Array.from(document.querySelectorAll('.fbdoc-pick-row .lb')).some(r => r.textContent === n), to.num, { timeout: 10000 });
  await page.click('.fbdoc-pick-row:has(.lb:text-is("' + to.num + '"))');
  await page.waitForFunction(n => document.getElementById('docTitle').textContent.endsWith(' ' + n), to.num, { timeout: 15000 });
  await T.rendered(page);
  await T.check(page, 'pl-picker', opts());
  await page.close();
});

test('launch from the Shipping module: that shipment, fixed; no picker, previous / next or Refresh', async () => {
  await ships();
  // The picker's controls count as shown when the Filters panel would show them (not hidden by the launch lock).
  const visible = page => page.evaluate(() => {
    FBLib.Common.togglePanel('filtersPanel', true);
    return ['recPrev', 'recInput', 'recBrowse', 'recNext', 'refreshBtn', 'printBtn', 'setBtn']
      .filter(id => { const e = document.getElementById(id); return e && e.offsetParent !== null; });
  });
  const numOf = async id => (await T.sql('SELECT num FROM ship WHERE id = ?', [id]))[0].num;

  let page = await T.open(PAGE, 'set.SHIP=' + SHIP.kits + '&' + U.launch({ module: 'SHIP', moduleName: 'Shipping', id: SHIP.po }));
  assert.equal(await page.inputValue('#recInput'), await numOf(SHIP.po));
  assert.match(await page.textContent('#statusLine'), /from Shipping module$/);
  assert.deepEqual(await visible(page), ['printBtn', 'setBtn'], 'launched: picker, previous / next and Refresh hidden');
  await T.check(page, 'pl-launch-id', opts());
  await page.close();

  // By number only.
  const toNum = await numOf(SHIP.to);
  page = await T.open(PAGE, 'set.SHIP=' + SHIP.kits + '&' + U.launch({ module: 'SHIP', moduleName: 'Shipping', num: toNum }));
  assert.equal(await page.inputValue('#recInput'), toNum);
  assert.match(await page.textContent('#statusLine'), /from Shipping module$/);
  await page.close();

  // Another module's record: ignored, the setting stands and the picker is back.
  page = await T.open(PAGE, 'set.SHIP=' + SHIP.kits + '&' + U.launch({ module: 'SO', moduleName: 'Sales Order', id: 1 }));
  assert.equal(await page.inputValue('#recInput'), await numOf(SHIP.kits));
  assert.doesNotMatch(await page.textContent('#statusLine'), /from .* module/);
  assert.ok((await visible(page)).includes('recInput'), 'picker shown');
  assert.deepEqual(page._errors, []);
  await page.close();
});

// Synthetic shipments built from real ones: every last-sheet fill level, kits
// straddling breaks, long line notes and tracking, a multi-page shipment note,
// many cartons, totals on.
test('stress: 1..30 copies of an SO shipment (kits, cartons, tracking, long notes)', async () => {
  await ships();
  const page = await T.open(PAGE, 'set.SHIP=' + SHIP.kits);
  await page.evaluate(() => window.FBDocPage.setSession({ ShowTotalQty: true, PartNumDescription: true }));
  const results = [];
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 30]) {
    await page.evaluate(async ({ n, id }) => {
      const m = await window.FBDocPage.fetch(id);
      const base = m.lines, lines = [], trk = {};
      for (let r = 0; r < n; r++) base.forEach(l => {
        const c = Object.assign({}, l, { itemid: +l.itemid * 1000 + r, lineno: lines.length + 1,
          kitparentline: l.kitparentline != null ? +l.kitparentline * 1000 + r : null });
        if (m.tracking[l.itemid]) trk[c.itemid] = m.tracking[l.itemid].repeat(1 + (r % 3));
        lines.push(c);
      });
      lines.forEach((l, i) => { if (i % 23 === 7) l.note = ('Line note ' + i + '. ').repeat(i % 2 ? 60 : 8); });
      m.lines = lines; m.tracking = trk;
      const c0 = m.cartons[0];
      m.cartons = Array.from({ length: Math.max(1, Math.round(n * 1.5)) }, (_, i) => Object.assign({}, c0, { cartonnum: i + 1 }));
      m.h.note = n % 5 === 0 ? ('Shipment note paragraph ' + n + '. ').repeat(n * 25) : m.h.note;
      await window.FBDocPage.render(m);
    }, { n, id: SHIP.kits });
    const r = await T.check(page, 'pl-stress-' + n, opts());
    results.push(n + ':' + r.sheets + (r.splits ? '/' + r.splits + 'split' : ''));
  }
  console.log('stress SO sheets ' + results.join(' '));
  await page.close();
});

test('stress: PO and TO shipments multiplied (1..30 copies)', async () => {
  await ships();
  const page = await T.open(PAGE, 'set.SHIP=' + SHIP.to);
  const results = [];
  for (const id of [SHIP.po, SHIP.to]) {
    for (const n of [1, 5, 12, 30]) {
      await page.evaluate(async ({ n, id }) => {
        const m = await window.FBDocPage.fetch(id);
        const base = m.lines, lines = [];
        for (let r = 0; r < n * 4; r++) base.forEach(l => lines.push(Object.assign({}, l, { itemid: +l.itemid * 1000 + r, lineno: lines.length + 1,
          note: r % 7 === 3 ? ('Transfer note ' + r + '. ').repeat(40) : l.note })));
        m.lines = lines;
        await window.FBDocPage.render(m);
      }, { n, id });
      const r = await T.check(page, 'pl-stress-' + id + '-' + n, opts());
      results.push(id + 'x' + n + ':' + r.sheets);
    }
  }
  console.log('stress PO/TO sheets ' + results.join(' '));
  await page.close();
});
