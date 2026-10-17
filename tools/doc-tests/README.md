# Record-document tests

Tests for fb-doc (`scripts/fb-doc.js`) and the paperwork documents built on it:
Sales Order Report, Sales Invoice, Packing Slip and Shipping Invoice. They were
the Paperwork POC's tests (`tools/paperwork-tests` until 2026-10-16).

| File | What it checks |
|---|---|
| `unit.test.js` | fb-doc's pure parts (settings tokens, launch, paper, formats, layout, Code 128) and the lint: no setting-token or directive literal, no fb-launch tag, in the shared source. No browser |
| `SOReport.test.js`, `PackingList.test.js`, `ShippingInvoice.test.js` | Each document against a live database: every sheet's body fits, blocks in order and placed once, a column header on every sheet, "Page X of Y", the last-page footer, the printed PDF's page count and paper; options, editions, the picker, the launch lock, stress (1 to 30 copies) |
| `Output.test.js` | Document output (`FB_LAUNCH.output 'pdf'`): `window.FB_DOC` ready with the sheet count, error for another module's record, nothing without output |
| `variant-check.js` | `SalesOrder/SOInvoiceReport.htm` is `SOReport.htm` plus exactly the five swaps in `variant-swaps.js` |
| `harness.js`, `doc-util.js` | The live-SQL harness: serves the pages with the bridge stubbed and `runQuery` proxied, read-only, to MySQL; opens them in headless Chrome |

```
node --test tools/doc-tests/*.test.js
node tools/doc-tests/variant-check.js
```

The pages drive a test hook each page exposes, `window.FBDocPage`
(`load`, `fetch`, `render(model)`, `setSession(options)`, `pdf()`,
`settled()`, `env`, `model`, `lastDoc`); the sheets are read from the PDF
view (`.fbdoc-view-canvas`).

**Needs:** Chrome, playwright-core (`PLAYWRIGHT_CORE_PATH`, else the npx
cache), mysql2 (`MYSQL2_PATH`), and a database: `FB_DB_HOST` / `FB_DB_PORT` /
`FB_DB_USER` / `FB_DB_PASSWORD` / `FB_DB_NAME`, else the local MySQL MCP
server's settings. The record ids are chosen by query, so any Fishbowl
database with sales orders and shipments will do. Pages come from
`iReport_Ports/` (`FBDOC_PAGES_ROOT` to test copies), shared scripts from
`scripts/` (`SCRIPTS_DIR` to test another fb-doc). PDFs land in
`<tmp>/fbdoc-render` (`FBDOC_OUT`).

Other record documents (travelers, PO, pick, receiving, RMA, TO) are tested
with `tools/report-harness/ab.js --launch CODE:id` on recorded fixtures.
