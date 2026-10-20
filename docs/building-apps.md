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
| One piece (a control, a style, a helper) | [`Template/Component_Gallery.htm`](../Template/Component_Gallery.htm) | the gallery, below |

Each template is a working report on real data. Copy it, run it, then search
for `TEMPLATE:` and replace each marked part. Its header comment lists the steps.

**The list template** (`List_Report_Template.htm`, an inventory aging list)
shows the REPORT chrome with a Filters panel that applies as it changes (a
quick date range + From / To, multi-selects, a text box, Reset filters,
Remember my filters); saved views (`FBLib.FilterViews` in custom mode: My and
Company views, `editors: true`, `companyFirst`, `adoptDefault()` before the
first query); company defaults (Settings › Admin); a KPI strip (§28), age
pills in cells (§27), part links (`openModule`) and a row-detail modal (§12,
with §8 stat badges); the part's custom fields as hidden-until-shown columns
(`FBLib.CfCatalog`, the values fetched with `CfCols.sqlSelectFor(fields,
'part')` only once a custom-field column or a detail needs them); loading,
empty and error states (Retry, Reset, the §35 `.banner`) and the load token;
RowCap + Load all, the Pivot view, App / PDF views, Print, Excel, toasts and
the debug console.

**The Columns drop-down**: `FBLib.RptCols.attach({ …, columnMenu: { mount,
rename: true, labelsKey, onChange } })`. `arrange()` then returns only the
shown columns, in the user's order, each relabelled with the company heading
(`label`; `defaultLabel` is the page's own). Build the App table, the PDF spec
and the Excel sheet from that one `cols()` and a rename shows everywhere.
Column flags: `locked`, `vis: false`, `menu: false`. Hidden columns are saved
per user with the widths, order and sort; headings are company settings (they
need `masterStorage: 'userProperties'`; admins and, with `company.editors`,
Edit Settings users rename). Document output ignores the user's hide / move
and keeps the headings.

**The record template** (`Record_Document_Template.htm`, a transfer order)
runs on `FBDoc.Record` (picker, previous / next, launch lock, output guard) and
`FBDoc.Options` (the stock presets, company defaults; a Page layout option
drives `PDF.setOrientation` / `setPaper`): a card with status pills, stat
badges, a Code 128 barcode and the record's custom fields, the items table
with the Columns drop-down (the printed item table follows it; document
output prints the stock columns with the company's names). It uses the report
spec (`doc`); form-like documents with their own sheets (`pages`) are
SOReport and PackingList.

**The form template** (`Form_Tool_Template.htm`, a quick cycle count: pick an
untracked part, type a count per location, post each location as a cycle
count through the legacy `ImportRq` `ImportCycleCountData` and
`runApiRequest`) shows, each marked `TEMPLATE:`:

- Chrome: the REPORT header (`hdr-btn`, `hdr-divider`), Settings / Help
  drawers, the debug console, §24 view tabs splitting a long form (with
  counters), the fb-lib feature check, and the bail-out without `runQuery`
  (no `runApiRequest`: it still counts and prints; Post says why it can't).
- Settings: `FBLib.Settings` with `company: { keys: ['choices'], editors:
  true }`: "Remember my choices", and the admin "Use these for everyone" /
  "Stop using them".
- Record picker: `FBDoc.picker` (typeahead, ▾ browse, filter chips; without
  fb-doc an exact number + Enter). `FBLib.Picker` is the dashboards' column
  picker, not a record picker. `FB_LAUNCH` from a part starts on that part.
- Form controls: §6 inputs, required fields (`.req`), error and warning
  states (`.is-invalid` / `.is-warn` with `.field-msg` / `.cell-msg`), a
  validation summary whose items jump to the field; §9 config groups, §10
  info box, §7 alerts, §8 stat badges, §27 pills, `data-tip` tooltips
  (`FBLib.Common.tooltips`), `MultiSelect` with `group` + `sub`.
- Line grid: add / remove lines, text inputs with `inputmode` (never number
  inputs), per-cell validation, a sticky totals footer, Enter / arrow / Esc;
  typing repaints only its own row.
- Write path: the access right (Post disabled with the reason), a re-read
  before writing, `FBLib.Common.confirmModal` listing every change and the
  requests, requests and answers in the debug console, `sendLegacy()` reading
  `ErrorRs` / `statusCode` into Fishbowl's own message, per-line progress
  with Stop (`.ds-btn-danger`) and a stale-run token, the read-back verify
  (Posted / Check / Failed), toasts (`FBLib.Common.toast`).
- States: loading overlay + spinner, empty states, a query error in a
  `.banner.banner-act` with Try again, the load token.
- Print: a count sheet before posting, or the record of what was posted,
  through `FBDoc.printPages` (laid out on pages off-screen and printed in one
  call); a plain print window without fb-doc.

It was tested in the harness with the bridge stubbed (success, `ErrorRs`, a
non-1000 `statusCode`, a verify mismatch, Stop); the real `ImportRq` still
needs a client test.

### The component gallery

[`Template/Component_Gallery.htm`](../Template/Component_Gallery.htm) is a
reference page, not a template to copy whole: every shared style (fb-styles
§1–37) and widget (fb-lib, fb-doc, fb-label) on one page, working, grouped as
tokens and type · buttons and header · forms · feedback · status · navigation
and chrome · tables · saved views · data and output · formats. Each section
has the live example, a "use it for / don't" line, a mark (**Current**,
**Dashboards only**, **Legacy**) and a Copy button. The code box is the real
thing: the example's markup plus the source of the function that runs it, so
what you copy is what you see working. The page itself runs on the REPORT
chrome (header, a Filters panel driving the sample tables, Settings / Help
drawers, company default filters, toasts, debug console). Highlights:
`FBLib.RptCols` + `RowCap` on a grouped `.rpt-table`, `FBLib.Pivot`,
`FBLib.ColumnMenu` with admin rename, `FBLib.FilterViews` in custom mode,
`FBLib.Common.toast` / `confirmModal` / `tooltips` / `fdrop`, the §6
validation states, `FBDoc.Report.view`, `FBDoc.picker`, `FBDoc.printPages`,
Code 128 / QR / Data Matrix, `FBLib.Export.xlsx`, the `q()` + load-token
query pattern and the formatters with live output. It has built-in sample
data (two optional live lookups fall back quietly). Use the header selector to
hide what isn't for new reports. Open it in the BI viewer (it is not deployed:
`name: null`) or in the harness: `node tools/report-harness/build.js
Template/Component_Gallery.htm <empty fixture>`.

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
| `Common` | `formatMoney`, `formatQty`, `formatDate`, `escSQL`, `escHtml`; the debug console (`mountDebugDrawer`, `debugLog`: it writes HTML, so escape what you log); drawers and the Filters panel (`registerDrawer`, `toggleDrawer`, `registerPanel`, `togglePanel`: a press outside the open panel closes it after the pressed element's click has run); `MultiSelect.create` |
| `Common.toast` | `toast(html, type, ms)`: the §14 toast (types `info`, `success`, `warn`, `error`; `ms` 0 = until dismissed); it makes its own `#toasts` container. `html` is HTML: escape text |
| `Common.confirmModal` | `confirmModal({ title, html \| text, okText, cancelText, danger, note, wide })` → `Promise<boolean>`: the one confirm before a write (list the change and the request in `html`). OK = `true`; Cancel, ×, Esc, the backdrop = `false`. `danger` = a red OK and the focus on Cancel. It opens above drawers and the debug console |
| `Common.tooltips` | `tooltips(root?)`, once at start-up: every `[data-tip]` (`data-tip-title`, `data-tip-meta`) gets the §13 tooltip, placed below (or above) and escaped |
| `Common.fdrop` | `fdrop(el, { onChange })`: drives one dashboard filter-strip drop-down (§26): checkbox items = multi, `data-v` items = single, `.fd-val` shows the value |
| `Common.isOutput` | `true` in document output (`FB_LAUNCH.output 'pdf'`). There `toast` only logs, `confirmModal` resolves `false` at once and `tooltips` binds nothing, so nothing waits for a click |
| `Settings` | Per-user settings and the company defaults. `init({ masterStorage: 'userProperties', company: { keys: ['filters'], editors: true }, userKey: FB_REPORT.key + '.user.v1', masterKey: FB_REPORT.key + '.master.v1', defaults })`, then `resolve`, `setUserKey` + `saveUser`, `publishCompany`, `clearCompany`, `isAdmin` |
| `SharedData` | An org-wide payload every user reads and admins write (e.g. the paper size for every report) |
| `FilterViews` | Saved views (mine and the company's) behind one header button |
| `RowCap` | A big result: `RowCap.sql(sql)` adds a LIMIT, `RowCap.apply` / `notice` show "Load all" |
| `RptCols` | Column resize, heading-click sort and drag-reorder on a `.rpt-table` the page renders itself; `totalsCells` for group / total rows; the `columnMenu` option adds the Columns drop-down (above) |
| `ColumnMenu` | The Columns drop-down itself (show / hide, drag to reorder, Reset, admin rename for everyone); `RptCols` and `Table` build one from their `columnMenu` option |
| `Pivot` | A pivot (cross-tab) view of the page's rows, with drill-down, Excel and a PDF spec |
| `Export` | `xlsx({ filename, sheets })`: a native Excel workbook, no CDN (quantities as General, totals need a spacer row) |
| `CfCatalog`, `CfCols` | Custom-field columns: `CfCatalog.load()` finds a table's fields; `CfCols.sqlSelectFor(fields, alias)` writes their SELECT list (each as `cf_<id>`), `CfCols.formatValue` prints a value by its type |
| `Columns`, `Picker`, `Table` | The dashboard tiles' column registry and table. **Not for new reports**: use the REPORT chrome and `RptCols` |

### fb-styles (`scripts/fb-styles.css`)

The brand tokens and every shared component. A report uses **§35 REPORT
chrome** (`body.rpt-page`: the 56px header, the push-down `.rpt-filters`
panel, `.rpt-app` / `.rpt-scroll`), **§29 `.rpt-table`**, **§36** table tools /
row cap / pivot host, §4 header buttons, §11 drawers (`.ds-btn`,
`.ds-btn-primary`, `.ds-btn-danger`, `.ds-btn-admin`), §12 modals, §13
tooltips, §14 toasts, §6 validation states (`.is-invalid`, `.is-warn`,
`.field-msg`, `.cell-msg`, `.req`), §27 status pills (`.spill`), §31 row
links, §32 multi-select, §33 the availability dot (`.status-circle`), §35 the
error `.banner` and the drawer content grid (`.fb-grid` / `.fb-group` /
`.fb-group-title`). §22–28 and §30 are the dashboards' chrome. The floating
layers stack: debug console, drawers + scrim, modals, toasts, tooltips,
popovers (multi-select, picker, Columns menu); §12 lists the values. Add page
CSS for the report's own bits only. Don't override the drawer scrim's
z-index; avoid Tailwind (its `collapse` utility hides panels). The gallery
shows every section working.

### fb-doc (`scripts/fb-doc.js` + `fb-doc-fonts.css`, namespace `FBDoc`)

The PDF view and everything about one-record documents. Reference:
[fb-doc.md](fb-doc.md).

| Piece | Use it for |
|---|---|
| `Report.view` | The App / PDF toggle and the PDF view: from a report spec (`doc`) or the document's own sheets (`pages`) |
| `Record` | A record document's record: picker, previous / next, start order, launch lock, document-output guard; `Record.paper` for the Page_setup setting |
| `Options` | The stock report's option parameters with its saved presets and company defaults |
| `env`, `fmt`, `code128` | The company's formats (`env.logo` is a data: URL ready for an `<img>` or a CSS `url()`), Java-style number / date formats, barcodes |
| `picker` | A typeahead record picker with a browse list and filter chips (its list follows the input when the page scrolls) |
| `printPages`, `printWindow` | Print HTML on pages: `printPages` lays out `paginate`'s options off-screen and prints them in one call; `printWindow` prints sheets already on the page |

### Domain scripts

| Script | Use it for |
|---|---|
| `fb-label` | Label sheets: sheet setup pills + editor, fields that fit the label, test sheet, print (load after fb-doc; `iReport_Ports/Labels/PartBarcodes.htm` is the example) |
| `fb-mfg` | Manufacturing: finishing work orders, scrap, staging (load after fb-lib) |
| `fb-pricing` | A product's price for a customer after pricing rules (a port of the server's GetPrices) |
| `fb-model`, `fb-report`, `fb-builder` | The App Builder: [app-builder-models.md](app-builder-models.md) |

## Patterns to copy, and patterns not to

**Copy:** the REPORT chrome (header → Filters panel → Settings / Help drawers →
`.rpt-app`, with `FBLib.Common.toast` for results), filters that apply as they
change (one short debounce), the five-part company defaults (Settings › Admin:
"Use these filters for everyone" / "Stop using them"), `runQueryAsync` with a
load token so an old result can't paint over a newer one, chunked painting of
long tables, the debug console, Excel through `FBLib.Export.xlsx`, the write
confirm through `FBLib.Common.confirmModal`.

**Don't copy** (found in older pages): `FBLib.Table` for a new report, CSV
export, Tailwind or moment.js from a CDN, `propFallback` system properties for
switches (`BI_SHOW_DEBUG`…), `localStorage`, `type="number"` inputs in grids,
`window.print()` on the report page, a page-local copy of a shared function:
most ports still carry their own `showToast`, confirm modal, tooltip
positioning, validation CSS or `.fb-grid` / `.banner` lines; a new page calls
`FBLib.Common.toast` / `confirmModal` / `tooltips` and uses fb-styles' classes.

## Making it print

- **List report:** `FBDoc.Report.view({ app, toggleBefore, page, doc })`. The
  report spec reuses the App view's own row HTML; classes `rpt-grp` /
  `rpt-sub` / `rpt-minor` drive groups, "(continued)" headings and keeps.
  The stock report's paper is `page`; users pick theirs in the paper bar.
- **Record document:** the same, with `FBDoc.Record` for the record. A
  tabular document passes `doc`; a form-like one lays out its own sheets
  (`pages`).
- **Anything else:** a Print button. A printout that isn't on the screen (a
  count sheet, a receipt) goes through `FBDoc.printPages` (`paginate`'s
  options, laid out on pages off-screen and printed in one call; the form
  template's `printRecord()`); sheets already on the page through
  `FBDoc.printWindow`; without fb-doc, a small page of its own in a new
  window (the plain pattern in `printPlain()` of the list template). Open the
  window during the click, before any `await`.
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
