# Building a BI app or report

How to build a Fishbowl BI report (an "app") in this repo: which template to
start from, which shared library does what, how it prints, and how it ships.
The JavaScript API Fishbowl gives a report (`runQuery`, `openModule`,
`runRestApiAsync`…) is in [CLAUDE.md](../CLAUDE.md); the database is in
[schema/schema-index.md](../schema/schema-index.md). The Claude Code skill
`create-bi-app` walks through this page step by step.

## The rules every app follows

1. **It runs standalone in the plain BI Reports viewer.** Nothing may depend on
   the report_btn plugin. A launch from a module (`window.FB_LAUNCH`), the
   Apps menus and document output are extras the page handles when present.
2. **It prints.** A list report or a record document has a PDF view (fb-doc,
   below); any other screen has a Print button that builds a print window.
   `window.print()` on the report page is unreliable in Fishbowl's browser.
3. **It never stores in the browser.** No `localStorage` / `sessionStorage`:
   settings go through `FBLib.Settings` (Fishbowl user properties).
4. **It reads with SELECTs and writes through the API**, with an access check,
   one confirm listing the change, the request logged, the response checked
   and the result read back. No dry-run switches, no admin "enable" switches.
5. **It identifies itself**: the head tags, `window.FB_REPORT`, a build stamp
   (below).
6. **Shared code lives in `scripts/`**, included by directive, never copied
   into a page.

## Start from a template

| You are building | Template | Full examples |
|---|---|---|
| A list of rows with groups and totals (most reports) | [`Template/List_Report_Template.htm`](../Template/List_Report_Template.htm) | `iReport_Ports/Inventory/AgingReport.htm`, `PurchaseOrder/PurchaseOrderSummary.htm` |
| A document for one record (an order, a pick, a traveler) | [`Template/Record_Document_Template.htm`](../Template/Record_Document_Template.htm) | `iReport_Ports/WorkOrder/WOTraveler.htm`; a form-like document: `iReport_Ports/SalesOrder/SOReport.htm` |
| A screen that changes data (an import, an adjustment) | [`Template/Form_Tool_Template.htm`](../Template/Form_Tool_Template.htm) | `Custom/Inventory/Inventory_Adjustment_Helper.htm`, `Custom/Customer/CustomerStatus.htm` |
| A port of a stock iReport | the list or record template | [porting-ireport.md](porting-ireport.md) |
| A dashboard | none: see [dashboards-review.md](dashboards-review.md) | `Dashboards/` |

Each template is a working report on real data. Copy it, run it, then search
for `TEMPLATE:` and replace each marked part. Its header comment lists the steps.

**Before creating a report, settle with whoever asked for it:** its record
name (a plain name, no prefix), its folder, and whether any module's Apps
menu should list it (only paperwork documents normally are).

## Identity, tags and stamps

Every page starts its `<head>` like this (CLAUDE.md, "Report identity"):

```html
<meta charset="UTF-8">
<meta name="fb-launch" content="SO">        <!-- only a paperwork document a module's Apps menu lists -->
<meta name="fb-folder" content="Sales Order">
<meta name="description" content="One sentence.">
<script>
    window.FB_REPORT = { key: 'cdx.bi.myReport', name: 'My Report', build: 'UNSTAMPED' };   // @fb-build
</script>
```

- Each tag at most once in the file, and only in `<head>`: report_btn reads
  the first one it finds.
- `fb-origin` `system` marks an app that ships with Fishbowl (the iReport
  ports, the dashboards). A new report is custom: leave it out.
- `key`: the prefix of every stored setting (≤ 31 characters). `name`: the
  Fishbowl record name, `null` until published. Never rename a published
  record by editing `name` (it creates a duplicate): use the deploy tools'
  `--rename`.
- `build` is written by `tools/stamp` (a Claude Code hook and the git
  pre-commit hook). Never edit it.

## The libraries

Include each by directive, exactly once, in this order (a list report or a
document needs all four; a tool usually needs fb-lib and fb-styles):

```html
<script>{% Script fb-lib %}</script>
<script>{% Script fb-doc %}</script>
<style>{% Style fb-styles %}</style>
<style>{% Style fb-doc-fonts %}</style>
```

Fishbowl replaces directives (and report-setting tokens) by **global text
replacement**: never write one twice, or in a comment or string. Refer to
them in words.

### fb-lib (`scripts/fb-lib.js`, namespace `FBLib`)

| Module | Use it for |
|---|---|
| `Common` | `formatMoney`, `formatQty`, `formatDate`, `escSQL`; the debug console (`mountDebugDrawer`, `debugLog`); drawers and the Filters panel (`registerDrawer`, `toggleDrawer`, `registerPanel`, `togglePanel`); `MultiSelect.create` |
| `Settings` | Per-user settings and the company defaults. `init({ masterStorage: 'userProperties', company: { keys: ['filters'], editors: true }, userKey: FB_REPORT.key + '.user.v1', masterKey: FB_REPORT.key + '.master.v1', defaults })`, then `resolve`, `setUserKey` + `saveUser`, `publishCompany`, `clearCompany`, `isAdmin` |
| `SharedData` | An org-wide payload every user reads and admins write (e.g. the paper size for every report) |
| `FilterViews` | Saved views (mine and the company's) behind one header button |
| `RowCap` | A big result: `RowCap.sql(sql)` adds a LIMIT, `RowCap.apply` / `notice` show "Load all" |
| `RptCols` | Column resize, heading-click sort and drag-reorder on a `.rpt-table` the page renders itself; `totalsCells` for group / total rows |
| `Pivot` | A pivot (cross-tab) view of the page's rows, with drill-down, Excel and a PDF spec |
| `Export` | `xlsx({ filename, sheets })`: a native Excel workbook, no CDN (quantities as General, totals need a spacer row) |
| `CfCatalog`, `CfCols` | Custom-field columns |
| `Columns`, `Picker`, `Table` | The dashboard tiles' column registry and table. **Not for new reports**: use the REPORT chrome and `RptCols` |

### fb-styles (`scripts/fb-styles.css`)

The brand tokens and every shared component. A report uses **§35 REPORT
chrome** (`body.rpt-page`: the 56px header, the push-down `.rpt-filters`
panel, `.rpt-app` / `.rpt-scroll`), **§29 `.rpt-table`**, **§36** table tools /
row cap / pivot host, §4 header buttons, §11 drawers, §14 toasts, §27 status
pills (`.spill`), §31 row links, §32 multi-select. §22–28 and §30 are the
dashboards' chrome. Add page CSS for the report's own bits only. Don't
override the drawer scrim's z-index; avoid Tailwind (its `collapse` utility
hides panels).

### fb-doc (`scripts/fb-doc.js` + `fb-doc-fonts.css`, namespace `FBDoc`)

The PDF view and everything about one-record documents. Reference:
[fb-doc.md](fb-doc.md).

| Piece | Use it for |
|---|---|
| `Report.view` | The App / PDF toggle and the PDF view: from a report spec (`doc`) or the document's own sheets (`pages`) |
| `Record` | A record document's record: picker, previous / next, start order, launch lock, document-output guard; `Record.paper` for the Page_setup setting |
| `Options` | The stock report's option parameters with its saved presets and company defaults |
| `env`, `fmt`, `code128` | The company's formats, Java-style number / date formats, barcodes |

### Domain scripts

| Script | Use it for |
|---|---|
| `fb-mfg` | Manufacturing: finishing work orders, scrap, staging (load after fb-lib) |
| `fb-pricing` | A product's price for a customer after pricing rules (a port of the server's GetPrices) |
| `fb-model`, `fb-report`, `fb-builder` | The App Builder: [app-builder-models.md](app-builder-models.md) |

## Patterns to copy, and patterns not to

**Copy:** the REPORT chrome (header → Filters panel → Settings / Help drawers →
`.rpt-app` → toasts), filters that apply as they change (one short debounce),
the five-part company defaults (Settings › Admin: "Use these filters for
everyone" / "Stop using them"), `runQueryAsync` with a load token so an old
result can't paint over a newer one, chunked painting of long tables, the
debug console, Excel through `FBLib.Export.xlsx`.

**Don't copy** (found in older pages): `FBLib.Table` for a new report, CSV
export, Tailwind or moment.js from a CDN, `propFallback` system properties for
switches (`BI_SHOW_DEBUG`…), `localStorage`, `type="number"` inputs in grids,
`window.print()` on the report page, a page-local copy of a shared function.

## Making it print

- **List report:** `FBDoc.Report.view({ app, toggleBefore, page, doc })`. The
  report spec reuses the App view's own row HTML; classes `rpt-grp` /
  `rpt-sub` / `rpt-minor` drive groups, "(continued)" headings and keeps.
  The stock report's paper is `page`; users pick theirs in the paper bar.
- **Record document:** the same, with `FBDoc.Record` for the record. A
  tabular document passes `doc`; a form-like one lays out its own sheets
  (`pages`).
- **Anything else:** a Print button that copies what's on screen into a new
  window and prints that (`FBDoc.printWindow`, or the plain pattern in
  `printPlain()` of the list template).
- Check it: `tools/report-harness/run.js <page> --pdf` reports the pages;
  open it in Chrome at `http://127.0.0.1:8733/`.

## Launch from a module (optional)

With report_btn, a page can be opened for a record from a module's Apps menu
(`window.FB_LAUNCH`, [launch-context.md](launch-context.md)). A record
document gets this for free from `FBDoc.Record`. A list report may read
`FBDoc.launch.get()` to start filtered to the launched record; it must work
the same without it.

## Ship it

1. `node tools/report-harness/check.js <page>` (tags, directives, tokens,
   key length, syntax).
2. Run it on recorded data (`tools/report-harness`), then in the Fishbowl
   client.
3. The first edit asks where the report deploys (Fishbowl, SharePoint,
   both, neither: `tools/deploy/targets.js`); after that every edit
   redeploys through the after-edit hook. Shared scripts deploy first:
   fb-styles, fb-lib, fb-doc + fb-doc-fonts, then the reports.
4. A new Fishbowl record has no access rows: only admins see it until
   someone grants access in the client (or `fbdeploy.js --access`, when asked).
