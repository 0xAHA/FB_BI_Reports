# Porting a stock iReport to a BI report

How the 90-odd ports in [`iReport_Ports/`](../iReport_Ports/README.md) were
built, so the next one is built the same way. A port is a **faithful** BI
version of a standard Fishbowl Jasper report: same tables, same parameters
(as filters), same columns, grouping and totals. Only the presentation
becomes interactive, and it prints like the original. Every deliberate
difference is written down.

Read first: [building-apps.md](building-apps.md) (the libraries, the rules),
[fb-doc.md](fb-doc.md) (the PDF view), CLAUDE.md (the BI runtime API),
[schema/schema-index.md](../schema/schema-index.md). The Claude Code skill
`port-ireport-report` follows this page step by step;
`add-printable-view` covers giving an existing (non-port) report a PDF view.

## 1. Know what you are porting

The originals are on the Fishbowl server, read-only:
`C:\Program Files\Fishbowl\server\reports\<Folder>\<Name>.jrxml` (and the
subreports it references, often in `Common/` or `Batch/`). Its display name
and saved options are in the database (`report.name`, `reportparameter`).

Reading a jrxml:

| jrxml | Becomes |
|---|---|
| `<queryString>` | the main query. Copy it, then rewrite for BI: start with SELECT, no top-level WITH / CTE, lower-case tables |
| `$P{x}` (bound) / `$P!{x}` (pasted SQL text) | a filter. The parameter's default and description give the control (date range, location groups, part number with `%`…). `Count` / `Skip` are iReport paging: drop them |
| `<group>` | a group row (`tr.rpt-grp`), a sub-group (`tr.rpt-sub`), its header / footer bands |
| `<variable calculation="Sum" resetType="Group">` | the group's totals, carried on its group row; `resetType="Report"` → the totals footer |
| `printWhenExpression` on a band or field | an option (checkbox / select) with the jrxml's default |
| subreport (`.jasper`) | its own query, folded into the page (a section, minor rows, or a column) |
| `ReportHelperModule`, `$P{module}`, a data source class | server code: reproduce it in SQL / JS. When you must know exactly what it does, read the class from the server's jars (summarise what you learn; never paste decompiled code into the repo) |
| `pageWidth` × `pageHeight` | the PDF view's stock paper: 612×792 Letter portrait, 792×612 Letter landscape, 595×842 A4 |
| title band vs page header | `titleEveryPage`: company and title in `<pageHeader>` print on every page |
| the detail band's font size | `fontPt` (usually 10) |

Same-name variants (`XReport` and `XReportExport`, `…Landscape`, `…Colorized`)
become **one** port that covers them all: take the Export version's features
(its extra columns), lay the PDF view out like the main one, and make the
variants' differences options.

## 2. Start from the right template

| The stock report prints | Start from |
|---|---|
| A list of rows (most reports) | [`Template/List_Report_Template.htm`](../Template/List_Report_Template.htm) (`iReport_Ports/Inventory/AgingReport.htm`) |
| One record (an order, a pick, a traveler) | [`Template/Record_Document_Template.htm`](../Template/Record_Document_Template.htm) (`TransferOrder/TOReport.htm`); form-like paperwork: `SalesOrder/SOReport.htm` |

Save it as `iReport_Ports/<Folder>/<jrxml name>.htm`, in the original's
folder. Other ports worth reading for a particular shape:
`Inventory/InventoryValuationSummary.htm` (group totals, grand total),
`Customer/CustomerStatement.htm` (three levels), `Accounting/ExportSummary.htm`
(sections from subreports), `Customer/CustomerAddressList.htm` (label cards as
flow blocks), `PurchaseOrder/AutoPO.htm` (data from a client bridge,
`getAutoPo`), `WorkOrder/WOTraveler.htm` (a record document with every option).

## 3. Identity

```html
<meta charset="UTF-8">
<meta name="fb-launch" content="PO">     <!-- ONLY for a paperwork document; see below -->
<meta name="fb-folder" content="Purchase Order">
<meta name="fb-origin" content="system">
<meta name="description" content="One sentence (shown on the App Library tile).">
<script>window.FB_REPORT = { key: 'cdx.bi.ipPOReport', name: 'Purchase Order Report', build: 'UNSTAMPED' };</script>
```

- `name` is the stock report's display name (`report.name`), plain.
- `fb-folder` is the original's folder name as Fishbowl's report tree shows it.
- `fb-origin` `system`: ports ship with Fishbowl.
- **Module association.** Only the paperwork documents a module prints as its
  own document carry `fb-launch`: Sales Order Report and Sales Invoice (SO),
  Purchase Order Report (PO), Pick Ticket (PICK), Packing Slip and Shipping
  Invoice (SHIP), Work Order Traveler (WO), Manufacture Order Traveler (MO).
  Every other port has none.
- Each tag at most once, in `<head>` only. The header comment starts
  `FILE: <Name> (iReport port)` / `PATH: iReport_Ports/<Folder>/<file>`, then
  the original's rules, the layout, and every deliberate difference.

## 4. SQL: grounded on a real database

- Write the page's query from the jrxml's, then check every column against
  the live schema (`schema/*.sql`, and the database itself: the schema files
  can lag).
- Runtime rules: result keys are lower-case; never select a bare `NULL`
  (the driver fails with "unknown error": use `''` or a cast); `bit(1)` columns
  as `col+0`; user text through `sqlStr`, ids through `ints`; location-group
  pickers list only `getLocationGroupList()`.
- The `qty*` views are TEMPTABLE views: MySQL materialises all of them first.
  Keep the original's joins for fidelity, time them, and inline a view's own
  sub-query with the filter pushed in when it's slow (prove identical rows and
  sums; record it as a *performance* difference).
- Run the final query exactly as the page builds it (copy it from the
  harness's captured SQL) against a real database and note its timing.
- Domain notes that bit earlier ports: [schema-index.md](../schema/schema-index.md)
  and the repo memory (UOM conversions never 1:1 or chained; `woitem` has no
  `qtyToFulfill`; finished WOs have no remaining demand; `partreorder` can have
  a NULL location group; `inventorylog` type 40 duplicates a movement; receipt
  dates are on `receiptitem`; `poitem.typeId` 10/11 are incoming…).

## 5. The App view

The REPORT chrome from the template: filters in the push-down panel that apply
as they change; group rows that collapse and carry their totals; one sticky
totals footer; links into Fishbowl (`openModule`); Excel; the debug console;
Remember my filters; the company defaults (Settings › Admin, five parts: the
`company` option in `Settings.init`, the admin paragraph, the confirm text,
"Stop using them", `clearCompany`).

Table tools, decided per report:

- **Large results.** `FBLib.RowCap` on the main query (10,000 rows, Load all).
  When a plain cut would corrupt a figure (a running balance, payments per
  order), cut at a natural boundary (whole groups / parts / orders), or leave
  it uncapped and say why with the row counts.
- **Columns.** `FBLib.RptCols`: resize, sort, reorder. Lines sort within their
  group. No sort where order carries meaning (running totals, a blank count
  column, stacked tracking values).
- **Views.** Assess an alternative view and a pivot (`FBLib.Pivot`) for every
  report: build the pivot when the rows have two or more useful dimensions and
  a measure; list other views as recommendations unless cheap and clearly useful.

## 6. The PDF view: like the stock report on paper

`FBDoc.Report.view({ app, toggleBefore, page, doc, title })`, with
`docSpec()` built from the rows the App view already renders:

- `head` / `rows` / `foot` in print mode (collapsed groups print as their row,
  switched-off columns stay off); `foot` only if the original prints totals.
- `subtitle`: the filters, as the original's parameter line.
- Row classes and attributes drive the bands: `rpt-grp` / `rpt-sub` /
  `data-pdf-level` (headings, "(continued)"), `rpt-minor` (keeps with its
  line), `data-pdf-break` (new page), `data-pdf-min` (a blank write-in
  column's width). Several subreports → `sections`; label sheets → `flow`.
- `PDF_CSS` scoped to `.fbdoc-rpt-tbl` / `.fbdoc-rpt-flow`: black text, no
  screen colours, the original's indents.
- A record document: the same with `FBDoc.Record`; a form-like document lays
  out its own sheets (`pages`), as the paperwork documents do.

The PDF view must lay out with no overflow (`[data-fbdoc-overflow]` = 0) and
no clipped cells, in portrait and landscape and on A4 and Letter; Print's
window must hold as many sheets as the view.

## 7. Record documents

One record per run (the jrxml's `soNum` / `woNum`… prompt). `FBDoc.Record`
gives the picker (typeahead, status chips, previous / next, Refresh), the
start order (a launch, the record report setting adopted once, the user's
last, the newest), the launch lock and the document-output guard. Add, at the
top of `<body>`, the record setting (Fishbowl's own picker, when one exists:
SO, PO, MO, WO, TO, PICK, SHIP, RECEIPT…; none for RMA) and the Page_setup
setting, each in a `<script type="text/plain">` block, each token exactly once:

```html
<script type="text/plain" id="set-po">…the PO setting token…</script>
<script type="text/plain" id="set-print">…the PRINT setting token, default the stock paper…</script>
```

Options: the jrxml's option parameters with `FBDoc.Options` (or the page's
own controls), starting from the stock report's saved options
(`FBDoc.presets('../reports/<Folder>/<Name>.jasper')`).

## 8. Test

With [`tools/report-harness`](../tools/report-harness/README.md):

1. `fixture.js` records the page's queries from the local Fishbowl server;
   add synthetic rows for cases the data lacks (serials, foreign currency,
   a 40-page document).
2. `build.js` + `run.js --pdf`: no page errors; every total checked by hand
   against the fixture rows; filters, collapse, sort / resize / reorder, Pivot,
   Excel, Print; the PDF view in both orientations.
3. Record documents: `ab.js --launch CODE:id` and `steps/record-nav.js`
   (launch lock, output ready / wrong-module error, picker).
4. `check.js` on the file.
5. Then in the Fishbowl client (nothing replaces it: the toolbar's Save →
   PDF, Email, the real settings storage).

## 9. Write down every difference

Every deviation from the stock report, however small, goes in two places: the
port's header comment and [`iReport_Ports/DIFFERENCES.md`](../iReport_Ports/DIFFERENCES.md),
one row each:

`| Report | Area | Stock report does | Port does | Type | Evidence | How to verify | Reviewed |`

Type: **fix** (the stock report is wrong; say why), **addition**, **omission**
(say why), **layout**, **performance** (same result, faster), **data** (a
different source, same intent). Evidence: the numbers that show it ("stock
84.08, port 53.53 on Test Kit"). How to verify: what a reviewer opens or runs.
Reviewed: initials and date, after a client check.

## 10. Ship

Add the port's row to `iReport_Ports/README.md` (its folder table: port,
original, notes). Deploy as any report (building-apps.md, "Ship it"): ports
deploy to Fishbowl; the first edit asks for the target.

## Done means

Faithful to the original (same rows and totals on the same data, checked
live), every difference registered, App and PDF views tested, the header
comment complete, `check.js` clean, the README row written, deployed, and a
client test noted (or listed as outstanding).
