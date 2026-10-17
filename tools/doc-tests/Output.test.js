// Document output (docs/launch-context.md §6): with FB_LAUNCH.output 'pdf' each
// document renders its launched record and reports window.FB_DOC, which the
// report_btn documents PoC waits on before printing the page to a PDF.
//
//   node --test tools/doc-tests/Output.test.js
//
// Needs: Chrome, playwright-core and DB access — see doc-util.js / harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./doc-util.js');

const DOCS = [
  { file: 'SOReport.htm', module: 'SO', moduleName: 'Sales Order', table: 'so' },
  { file: 'SOInvoiceReport.htm', module: 'SO', moduleName: 'Sales Order', table: 'so' },
  { file: 'PackingList.htm', module: 'SHIP', moduleName: 'Shipping', table: 'ship' },
  { file: 'ShippingInvoice.htm', module: 'SHIP', moduleName: 'Shipping', table: 'ship' }
];
const T = U.suite(['SOReport.htm', 'SOInvoiceReport.htm', 'PackingList.htm', 'ShippingInvoice.htm']);

for (const d of DOCS) {
  test(d.file + ': output mode reports ready with its sheet count', async () => {
    const rows = await T.sql('SELECT MAX(id) AS id FROM ' + d.table);
    const id = rows[0].id;
    const page = await T.open(d.file, U.launch({ module: d.module, moduleName: d.moduleName, id, output: 'pdf' }), { output: true });
    const doc = await page.evaluate(() => window.FB_DOC);
    assert.equal(doc.state, 'ready', d.file + ': ' + JSON.stringify(doc));
    assert.ok(doc.paper && doc.paper.wMm > 0 && doc.paper.hMm > 0, d.file + ': paper ' + JSON.stringify(doc.paper));
    const r = await T.check(page, 'output-' + d.file.replace('.htm', ''), {});
    assert.equal(doc.pages, r.sheets, d.file + ': FB_DOC.pages ' + doc.pages + ' vs sheets ' + r.sheets);
    await page.close();
  });
}

test('output mode for another module\'s record reports an error', async () => {
  const page = await T.open('PackingList.htm', U.launch({ module: 'SO', moduleName: 'Sales Order', id: 290, output: 'pdf' }), { output: true });
  const doc = await page.evaluate(() => window.FB_DOC);
  assert.equal(doc.state, 'error');
  assert.match(doc.message, /takes .*\(SHIP\)/);
  await page.close();
});

test('without output nothing reports', async () => {
  const page = await T.open('SOReport.htm', U.launch({ module: 'SO', moduleName: 'Sales Order', id: 290 }));
  assert.equal(await page.evaluate(() => window.FB_DOC === undefined), true);
  await page.close();
});
