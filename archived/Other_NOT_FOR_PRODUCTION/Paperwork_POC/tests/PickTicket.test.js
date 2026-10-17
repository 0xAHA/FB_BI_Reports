// Render tests: the BUILT Pick Ticket in headless Chrome against a live Fishbowl
// database (read-only), checking pagination on every sheet and the PDF.
//
//   node --test Other_NOT_FOR_PRODUCTION/Paperwork_POC/tests/PickTicket.test.js
//
// Needs: Chrome, playwright-core and DB access — see doc-util.js / harness.js.
'use strict';
// harness.start(0) falls back to port 8732, which collides when several suites
// run at once; PORT=0 makes it listen on a free port.
if (process.env.PORT == null) process.env.PORT = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./doc-util.js');
const { A4, LETTER } = U;

const T = U.suite(['PickTicket.htm']);
const PAGE = 'PickTicket.htm';
const SEL = { pg: '.pk-foot .pg', last: null, tables: ['items'] };
const opts = size => Object.assign({ size: size || A4 }, SEL);
const PICKITEM_TABLE = -1515431424;

// demodb picks chosen for variety (queried once; the fallbacks are their ids on
// the demodb of 2026-10-12).
let P = null;
async function picks() {
  if (P) return P;
  const one = async (sql, dflt) => { const r = await T.sql(sql); return r.length && r[0].id ? +r[0].id : dflt; };
  P = {
    // Started SO pick with kit components (kit headers, indented components)
    kits: await one(`SELECT pi.pickId AS id FROM pickitem pi JOIN objecttoobject o ON o.recordId1 = pi.soItemId AND o.typeId = 30
                     WHERE pi.orderTypeId = 20 AND pi.statusId = 20 GROUP BY pi.pickId ORDER BY COUNT(*) DESC, pi.pickId DESC LIMIT 1`, 453),
    // Started grouped (G) pick over several orders and slots
    group: await one(`SELECT p.id FROM pick p JOIN pickitem pi ON pi.pickId = p.id WHERE p.num LIKE 'G%' AND pi.statusId = 20
                      GROUP BY p.id ORDER BY COUNT(DISTINCT pi.orderId) DESC, p.id LIMIT 1`, 52),
    // SO pick with the most Started items
    many: await one(`SELECT p.id FROM pick p JOIN pickitem pi ON pi.pickId = p.id WHERE p.num LIKE 'S%' AND pi.statusId = 20
                     GROUP BY p.id ORDER BY COUNT(*) DESC, p.id LIMIT 1`, 98),
    // Started item with serial-number tracking
    serial: await one(`SELECT pi.pickId AS id FROM pickitem pi JOIN trackinginfo ti ON ti.recordId = pi.id AND ti.tableId = ${PICKITEM_TABLE}
                       JOIN parttracking pt ON pt.id = ti.partTrackingId AND pt.typeId = 40 WHERE pi.statusId = 20 ORDER BY pi.pickId LIMIT 1`, 420),
    // Committed items with lot/batch tracking (shown only with ckShowCommitted = 30)
    committed: await one(`SELECT pi.pickId AS id FROM pickitem pi JOIN trackinginfo ti ON ti.recordId = pi.id AND ti.tableId = ${PICKITEM_TABLE}
                          WHERE pi.statusId = 30 GROUP BY pi.pickId ORDER BY COUNT(*) DESC, pi.pickId LIMIT 1`, 348),
    // WO pick whose non-inventory part qualifies in any status but Hold / Finished
    wo: await one(`SELECT p.id FROM pick p JOIN pickitem pi ON pi.pickId = p.id JOIN part ON part.id = pi.partId
                   WHERE p.num LIKE 'W%' AND part.typeId = 30 AND pi.statusId NOT IN (6, 40) ORDER BY p.id LIMIT 1`, 452),
    // TO pick with the most items (none Started: header + orders + "No items")
    to: await one(`SELECT p.id FROM pick p JOIN pickitem pi ON pi.pickId = p.id WHERE p.num LIKE 'T%' GROUP BY p.id ORDER BY COUNT(*) DESC LIMIT 1`, 412),
    // PO pick
    po: await one(`SELECT p.id FROM pick p JOIN pickitem pi ON pi.pickId = p.id WHERE p.num LIKE 'P%' ORDER BY p.id DESC LIMIT 1`, 414)
  };
  return P;
}
const load = async (page, id) => { await page.evaluate(id => window.FBDocApp.load(id), id); await T.rendered(page); };
const texts = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));

test('demodb picks render cleanly (A4 default): SO, kits, grouped, WO, TO, PO', async () => {
  const p = await picks();
  console.log('picks ' + JSON.stringify(p));
  const page = await T.open(PAGE, 'set.PICK=' + p.kits);
  for (const [name, id] of Object.entries(p)) {
    await load(page, id);
    const r = await T.check(page, 'pick-' + name, opts());
    const num = (await T.sql('SELECT num FROM pick WHERE id = ?', [id]))[0].num;
    assert.equal(await page.textContent('#docTitle'), 'Pick Ticket ' + num, name + ': title');
    // Big number + small number under the barcode (Barcodes have DI = true in demodb -> the pick number).
    const nums = await texts(page, '.fbdoc-sheet[data-fbdoc-page="1"] .pk-num, .fbdoc-sheet[data-fbdoc-page="1"] .pk-small');
    assert.deepEqual(nums, [num, num.substring(1)], name + ': numbers');
    assert.equal(await page.$$eval('.fbdoc-sheet[data-fbdoc-page="1"] .pk-bc svg', e => e.length), 1, name + ': barcode');
    // Orders block: one row per order on the pick.
    const orders = (await T.sql('SELECT COUNT(DISTINCT orderTypeId, orderId) AS n FROM pickitem WHERE pickId = ?', [id]))[0].n;
    assert.equal(await page.$$eval('.pk-ord', e => e.length), +orders, name + ': order rows');
    const started = (await T.sql(`SELECT COUNT(*) AS n FROM pickitem pi JOIN part ON part.id = pi.partId
      WHERE pi.pickId = ? AND (pi.statusId = 20 OR (part.typeId = 30 AND pi.statusId NOT IN (6, 40)))`, [id]))[0].n;
    assert.equal(await page.$$eval('tbody.it', e => e.length), +started, name + ': item rows');
    if (!+started) assert.equal(await page.$$eval('tr.none', e => e.length), 1, name + ': "No items" line');
    console.log('  ' + name + ' #' + id + ' ' + num + ': ' + r.sheets + ' sheet(s), ' + orders + ' order(s), ' + started + ' item(s)');
  }
  // Kits: a bold header per kit, components indented under it.
  await load(page, p.kits);
  assert.ok(await page.$$eval('tr.kh', e => e.length) >= 1, 'kit headers');
  assert.ok(await page.$$eval('tbody.it td[style*="padding-left"]', e => e.length) >= 1, 'indented kit components');
  await page.close();
});

test('tracking: SQL fallback (serials, committed batches) and the BI bridge when present', async () => {
  const p = await picks();
  const page = await T.open(PAGE, 'set.PICK=' + p.serial);
  const want = await T.sql(`SELECT sn.serialNum AS s FROM pickitem pi JOIN trackinginfo ti ON ti.recordId = pi.id AND ti.tableId = ${PICKITEM_TABLE}
    JOIN trackinginfosn sn ON sn.trackingInfoId = ti.id WHERE pi.pickId = ? AND pi.statusId = 20 ORDER BY ti.id, sn.id`, [p.serial]);
  const trk = (await texts(page, 'tr.x .pre')).join(' | ');
  assert.ok(want.length && want.every(w => trk.includes(w.s)), 'serials printed: ' + trk);
  assert.match(trk, /SN\(s\): /);
  await T.check(page, 'tracking-serial', opts());

  // Committed items only show with ckShowCommitted = 30 ("Committed items too").
  await load(page, p.committed);
  assert.equal(await page.$$eval('tbody.it', e => e.length), 0, 'committed hidden by default');
  await page.evaluate(() => window.FBDocApp.setSession({ ckShowCommitted: '30' }));
  await load(page, p.committed);
  const lots = await T.sql(`SELECT ti.info FROM pickitem pi JOIN trackinginfo ti ON ti.recordId = pi.id AND ti.tableId = ${PICKITEM_TABLE}
    WHERE pi.pickId = ? AND pi.statusId = 30 AND ti.info <> ''`, [p.committed]);
  const trk2 = (await texts(page, 'tr.x .pre')).join(' | ');
  assert.ok(lots.length && lots.every(l => trk2.includes(l.info)), 'committed tracking: ' + trk2);
  await T.check(page, 'tracking-committed', opts());

  // The BI bridge, when the client provides it, wins over SQL (JSON map shape).
  await page.evaluate(() => { window.getAllTrackingInfo = (t, ids) => JSON.stringify(Object.fromEntries(String(ids).split(',').map(i => [i, 'Lot#: BRIDGE-' + i + '  ' + t]))); });
  await load(page, p.committed);
  assert.match(await page.$$eval('tr.x .pre', e => e.map(x => x.textContent).join(' | ')), /Lot#: BRIDGE-\d+ {2}PickItem/);
  assert.equal(await page.evaluate(() => window.FBDocApp.model.trackingSource), 'bridge');
  // A bridge that throws falls back to the trackinginfo SQL.
  await page.evaluate(() => { window.getAllTrackingInfo = () => { throw new Error('not here'); }; });
  await load(page, p.committed);
  assert.equal(await page.evaluate(() => window.FBDocApp.model.trackingSource), 'sql');
  assert.deepEqual(page._errors, []);
  await page.close();
});

test('options: every jrxml parameter flipped', async () => {
  const p = await picks();
  const page = await T.open(PAGE, 'set.PICK=' + p.group);
  await page.evaluate(() => window.FBDocApp.setSession({
    ReportTitle: 'Pick List', ShowBarcode: false, cbShowBarcodeAs: 'Pick', ShowCountry: true,
    ShowAddress: true, ShowCustomerPO: false, ShowSlotNumber: true, cbSalesOrderContact: '2',
    ckShowCommitted: '30', CombineLikeItems: true, ShowKitHeaders: false, 'Show SO Item Description': false,
    ShowLocationGroup: false, cbPrimarySortBy: 'mainlocation.sortorder', cbSecondarySortBy: 'part.num' }));
  for (const id of [p.group, p.kits, p.to, p.many]) {
    await load(page, id);
    assert.match(await page.textContent('#docTitle'), /^Pick List /);
    assert.equal(await page.$$eval('.pk-bc', e => e.length), 0, 'no barcode');
    assert.equal(await page.$$eval('tr.kh', e => e.length), 0, 'no kit headers');
    assert.ok(await page.$$eval('.pk-ordh', e => e[0].textContent.includes('Slot #')), 'Slot # header');
    assert.equal(await page.$$eval('.pk-items th', e => e[4].textContent), '', 'S# header hidden when combining');
    const locs = await page.$$eval('tbody.it tr.r', rows => rows.map(r => r.cells[3].textContent));
    assert.ok(locs.every(l => !/ - /.test(l)), 'locations without the group: ' + locs.join(', '));
    await T.check(page, 'options-' + id, opts());
  }
  // SO customer instead of the contact; addresses with the country.
  await load(page, p.group);
  const cust = await T.sql(`SELECT DISTINCT c.name FROM pickitem pi JOIN so ON so.id = pi.orderId JOIN customer c ON c.id = so.customerId
    WHERE pi.pickId = ? AND pi.orderTypeId = 20`, [p.group]);
  const r2 = await texts(page, '.pk-ord .r2');
  assert.ok(cust.every(c => r2.includes(c.name)), 'customer names: ' + r2.join(', '));
  assert.ok(await page.$$eval('.pk-ord .ad2', e => e.length) > 0, 'address band');

  // Back to defaults: the stock layout.
  await page.evaluate(() => window.FBDocApp.setSession({}));
  await load(page, p.group);
  assert.equal(await page.$$eval('.pk-items th', e => e[4].textContent), 'S#');
  await page.close();
});

test('sorting, Combine Like Items and the barcode number rules', async () => {
  const p = await picks();
  const page = await T.open(PAGE, 'set.PICK=' + p.many);
  // Two copies of every item: combined, each row's quantity doubles and the row count halves.
  const res = await page.evaluate(async id => {
    const A = window.FBDocApp, m = await A.fetch(id);
    const base = m.items.filter(i => +i.statusid === 20);
    m.items = base.concat(base.map(i => Object.assign({}, i, { itemid: +i.itemid + 100000, note: 'second copy' })));
    A.setSession({ CombineLikeItems: true });
    await A.render(m);
    const rows = Array.from(document.querySelectorAll('tbody.it tr.r')).map(r => [r.cells[0].textContent, r.cells[1].textContent]);
    const notes = Array.from(document.querySelectorAll('tbody.it tr.x')).map(r => r.textContent);
    A.setSession({});
    await A.render(m);
    const single = document.querySelectorAll('tbody.it').length;
    return { rows, notes, base: base.map(i => +i.qty), single };
  }, p.many);
  assert.equal(res.single, res.base.length * 2, 'uncombined rows');
  assert.ok(res.rows.length <= res.base.length, 'combined rows ' + res.rows.length);
  assert.ok(res.notes.every(n => /second copy/.test(n)), 'merged notes');
  const sumBase = res.base.reduce((a, b) => a + b, 0) * 2;
  const sumRows = res.rows.reduce((a, r) => a + parseFloat(r[1].replace(/,/g, '')), 0);
  assert.equal(sumRows, sumBase, 'combined quantities');

  // Primary sort by location name (default) vs part number secondary.
  await page.evaluate(() => window.FBDocApp.setSession({ cbPrimarySortBy: 'Location Name', cbSecondarySortBy: 'Part', ShowLocationGroup: false }));
  await load(page, p.many);
  const locs = await page.$$eval('tbody.it tr.r', rows => rows.map(r => r.cells[3].textContent.toLowerCase()));
  assert.deepEqual(locs, locs.slice().sort(), 'rows by location name');

  // ORDERNUMBER: Order + "Barcodes have DI" false -> the number without its prefix letter.
  await page.evaluate(() => window.FBDocApp.setSession({}));
  const num = (await T.sql('SELECT num FROM pick WHERE id = ?', [p.many]))[0].num;
  await page.evaluate(async () => { window.FBDocApp.env.sys['Barcodes have DI'] = 'false'; await window.FBDocApp.rerender(); });
  assert.equal(await page.textContent('.pk-num'), num.substring(1), 'order number without DI');
  assert.equal(await page.getAttribute('.pk-bc svg', 'aria-label'), num.substring(1), 'barcode value');
  await page.evaluate(async () => { window.FBDocApp.setSession({ cbShowBarcodeAs: 'Pick' }); await window.FBDocApp.rerender(); });
  assert.equal(await page.textContent('.pk-num'), num, 'Pick always prints the pick number');
  await page.evaluate(async () => { window.FBDocApp.setSession({}); delete window.FBDocApp.env.sys['Barcodes have DI']; await window.FBDocApp.rerender(); });
  assert.equal(await page.textContent('.pk-num'), num, 'missing property -> pick number');
  await T.check(page, 'barcode-rules', opts());
  await page.close();
});

test('paper sizes from the Page_setup setting', async () => {
  const p = await picks();
  for (const [q, size] of [['Letter', LETTER], ['A4 landscape', [A4[1], A4[0]]], ['Letter:landscape', [LETTER[1], LETTER[0]]]]) {
    const page = await T.open(PAGE, 'set.PICK=' + p.group + '&print=' + encodeURIComponent(q));
    await T.check(page, 'paper-' + q.replace(/\W+/g, '_'), opts(size));
    await page.close();
  }
});

test('in-page pick picker: browse, status filter, search by order number, pick', async () => {
  const p = await picks();
  const page = await T.open(PAGE, 'set.PICK=' + p.kits);
  await page.click('#recBrowse');
  await page.click('.fbdoc-chip[data-f="1"][data-v="all"]');          // period: All
  await page.waitForFunction(() => document.querySelectorAll('.fbdoc-pick-row').length > 1, null, { timeout: 10000 });
  await page.click('.fbdoc-chip:text-is("Started")');
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.fbdoc-pick-row'));
    return rows.length && rows.every(r => /Started/.test(r.textContent));
  }, null, { timeout: 10000 });
  // Typing an order number finds the grouped pick that holds it.
  const so = (await T.sql('SELECT so.num FROM pickitem pi JOIN so ON so.id = pi.orderId WHERE pi.pickId = ? AND pi.orderTypeId = 20 ORDER BY so.id DESC LIMIT 1', [p.group]))[0].num;
  const gnum = (await T.sql('SELECT num FROM pick WHERE id = ?', [p.group]))[0].num;
  await page.fill('#recInput', '');
  await page.type('#recInput', so);
  await page.waitForFunction(g => Array.from(document.querySelectorAll('.fbdoc-pick-row .lb')).some(r => r.textContent === g), gnum, { timeout: 10000 });
  const idx = await page.$$eval('.fbdoc-pick-row .lb', (els, g) => els.findIndex(e => e.textContent === g), gnum);
  await page.click('.fbdoc-pick-row[data-i="' + idx + '"]');
  await page.waitForFunction(g => document.getElementById('docTitle').textContent.endsWith(' ' + g), gnum, { timeout: 15000 });
  await T.rendered(page);
  await T.check(page, 'picker', opts());
  await page.fill('#recInput', '');
  await page.type('#recInput', 'zzzz-no-such');
  await page.waitForFunction(() => /No match/.test((document.querySelector('.fbdoc-pick') || {}).textContent || ''), null, { timeout: 10000 });
  await page.close();
});

test('launch from the Picking module: that pick, fixed; toolbar = Print + Settings', async () => {
  const p = await picks();
  const visible = page => page.evaluate(() => ['prevBtn', 'recInput', 'recBrowse', 'nextBtn', 'refreshBtn', 'printBtn', 'setBtn']
    .filter(id => { const e = document.getElementById(id); return e && e.offsetParent !== null; }));
  const numOf = async id => (await T.sql('SELECT num FROM pick WHERE id = ?', [id]))[0].num;

  let page = await T.open(PAGE, 'set.PICK=' + p.kits + '&' + U.launch({ module: 'PICK', moduleName: 'Picking', id: p.group }));
  assert.equal(await page.inputValue('#recInput'), await numOf(p.group));
  assert.match(await page.textContent('#statusLine'), /from Picking module/);
  assert.deepEqual(await visible(page), ['printBtn', 'setBtn'], 'launched toolbar');
  await T.check(page, 'launch-id', opts());
  await page.close();

  // By number only.
  page = await T.open(PAGE, 'set.PICK=' + p.kits + '&' + U.launch({ module: 'PICK', moduleName: 'Picking', num: await numOf(p.wo) }));
  assert.equal(await page.inputValue('#recInput'), await numOf(p.wo));
  await page.close();

  // Another module's record: ignored, the setting stands and the picker is back.
  page = await T.open(PAGE, 'set.PICK=' + p.kits + '&' + U.launch({ module: 'SO', moduleName: 'Sales Order', id: 1 }));
  assert.equal(await page.inputValue('#recInput'), await numOf(p.kits));
  assert.doesNotMatch(await page.textContent('#statusLine'), /from .* module/);
  assert.ok((await visible(page)).includes('recInput'), 'picker shown');
  assert.deepEqual(page._errors, []);
  await page.close();

  // No setting, no last pick: the newest Started / Committed pick.
  page = await T.open(PAGE, '');
  const newest = (await T.sql('SELECT id FROM pick WHERE statusId IN (20, 30) ORDER BY dateCreated DESC, id DESC LIMIT 1'))[0].id;
  assert.equal(await page.inputValue('#recInput'), await numOf(newest));
  await page.close();
});

// Synthetic picks built from real ones: every page fill level, kits straddling
// breaks, long item notes and tracking lists, many orders with long notes.
test('stress: 1..30 copies of a kitted pick, long notes, many orders', async () => {
  const p = await picks();
  const page = await T.open(PAGE, 'set.PICK=' + p.kits);
  const results = [];
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 30]) {
    await page.evaluate(async ({ n, kitsId, groupId }) => {
      const A = window.FBDocApp;
      const m = await A.fetch(kitsId), g = await A.fetch(groupId);
      const base = m.items.filter(i => +i.statusid === 20), items = [], tracking = {};
      for (let r = 0; r < n; r++) base.forEach(i => {
        const id = +i.itemid * 1000 + r;
        items.push(Object.assign({}, i, { itemid: id, kitid: i.kitid != null ? +i.kitid * 1000 + r : null, lineitem: items.length + 1 }));
      });
      items.forEach((it, k) => {
        if (k % 23 === 7) it.note = ('Item note ' + k + '. ').repeat(k % 2 ? 140 : 10);
        if (k % 5 === 2) tracking[it.itemid] = 'Lot#: L' + k + '  ExpDate: 01/01/2027';
        if (k % 41 === 9) tracking[it.itemid] = 'SN(s): ' + Array.from({ length: 300 }, (_, s) => 'SN' + (100000 + s)).join(', ');
      });
      m.items = items; m.tracking = tracking;
      const orders = [];
      for (let r = 0; r < Math.ceil(n / 2); r++) g.orders.forEach(o => orders.push(Object.assign({}, o, { orderid: +o.orderid * 1000 + r })));
      orders.forEach((o, k) => { if (k % 7 === 3) o.sonote = ('Order note ' + k + '. ').repeat(n % 5 === 0 ? 220 : 6); });
      m.orders = orders;
      await A.render(m);
    }, { n, kitsId: p.kits, groupId: p.group });
    const r = await T.check(page, 'stress-' + n, opts());
    results.push(n + ':' + r.sheets + (r.splits ? '/' + r.splits + 'split' : ''));
  }
  console.log('stress sheets ' + results.join(' '));
  await page.close();
});

test('stress: a large TO pick with every item Started, combined and not', async () => {
  const p = await picks();
  const page = await T.open(PAGE, 'set.PICK=' + p.to);
  const out = [];
  for (const combine of [false, true]) {
    const rows = await page.evaluate(async ({ id, combine }) => {
      const A = window.FBDocApp, m = await A.fetch(id);
      m.items.forEach((i, k) => { i.statusid = 20; if (k % 9 === 4) i.note = 'Check carton seal before picking.'; });
      A.setSession({ CombineLikeItems: combine, ShowAddress: true, ShowSlotNumber: true });
      await A.render(m);
      return document.querySelectorAll('tbody.it').length;
    }, { id: p.to, combine });
    const r = await T.check(page, 'to-all-' + (combine ? 'combined' : 'single'), opts());
    out.push((combine ? 'combined ' : 'single ') + rows + ' rows / ' + r.sheets + ' sheets');
  }
  console.log('TO stress ' + out.join(', '));
  await page.close();
});
