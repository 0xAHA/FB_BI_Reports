# fb-doc — the printable-document engine

`scripts/fb-doc.js` (namespace `FBDoc`) turns a BI report into paper: fixed-size
sheets laid out the way JasperReports lays them out, which print and save as PDF
from the report's own **Print** button or the BI Report module's toolbar
(Print / Save → PDF / Email). It is the shared Script record **fb-doc**; its
font is the Style record **fb-doc-fonts** (`scripts/fb-doc-fonts.css`, Open
Sans as data: URLs, the standard reports' font).

A report includes it after fb-lib and fb-styles, each directive once:

```html
<script>{% Script fb-lib %}</script>
<script>{% Script fb-doc %}</script>
<style>{% Style fb-styles %}</style>
<style>{% Style fb-doc-fonts %}</style>
```

Deploy order: fb-styles, fb-lib, fb-doc + fb-doc-fonts, then the reports.
Without fb-doc a list report still runs App-only; a record document can't
choose its record (FBDoc.Record), so it shows the "shared script check
failed" banner.

> fb-doc.js is inlined into every page that includes it, and Fishbowl replaces
> report-setting tokens and Script/Style directives by **global text
> replacement**. The file must never contain either literal (a dollar sign + an
> upper-case code + `{`, or a brace-percent pair), nor an `fb-launch` meta tag.
> `tools/doc-tests/unit.test.js` lints for it.

## Which part to use

| You are building | Use |
|---|---|
| A list report (rows, groups, totals) with a printable view | `FBDoc.Report.view({ doc })` with a report spec (below) |
| A one-record document (an order, a pick, a traveler) | `FBDoc.Record` for the record, `FBDoc.Report.view` for the views; `doc` (a report spec) when the document is tabular, `pages` (your own sheet layout) when it is a form-like document |
| The stock report's options (jrxml parameters) on screen | `FBDoc.Options` (+ `FBDoc.presets`) |
| The company's report formats (decimals, dates, edition, logo) | `FBDoc.env` |
| A barcode | `FBDoc.code128.svg(text, { module: 1, quiet: 0 })` |
| Print a page you laid out yourself | `FBDoc.printWindow({ mount })` |

`Template/List_Report_Template.htm` and `Template/Record_Document_Template.htm`
are working starting points; `iReport_Ports/Inventory/AgingReport.htm` (list)
and `iReport_Ports/WorkOrder/WOTraveler.htm` (record, report spec) and
`iReport_Ports/SalesOrder/SOReport.htm` (record, own sheets) are full examples.

## App / PDF views — `FBDoc.Report.view(opts)`

Adds the **App / PDF** icon toggle to the report header and, after the App
view element, the PDF view: a paper bar (size, orientation, standard / company
paper, admin buttons) above the sheets.

```js
PDF = FBDoc.Report.view({
  app: document.getElementById('appView'),          // hidden in PDF view
  toggleBefore: document.getElementById('exportBtn'), // header button the toggle goes before
  page: { size: 'Letter', orientation: 'landscape' }, // the stock report's paper (or FBDoc.Record.paper(...))
  doc: () => docSpec(),                              // a report spec from the current state, or null
  // or, for a document that lays out its own sheets:
  // pages: (geom, page) => S.model ? buildDoc(S.model, geom) : null,
  title: () => 'Aging Report'                        // the print window's title
});
// after every render of the App view:
PDF.refresh();
// header Print button:
PDF.print();
```

Returns `{ mode(), setMode(m), refresh(), print(), paper(), settled() }`.
`refresh()` is cheap: it re-lays the sheets only while the PDF view shows.
`settled()` resolves once the PDF view has laid out what is on show (tests).

**Paper, first match wins** (the same in every report):
1. the user's own choice in the paper bar (remembered per user, key `docView`);
2. the company's paper for this report (`FBLib.Settings` master key `docPaper`,
   set by an admin or the report's Edit Settings users: *Use for everyone*);
3. the standard paper: the stock report's `page`, in the size set for every
   report (*Use A4 for all reports*, a SharedData payload `cdx.bi.paper.v1`,
   else by edition: Letter for US / CA, A4 elsewhere) unless the report's
   Page_setup setting was chosen on purpose (`page.chosen`).

Document output (below) never uses the user's paper.

### Report spec (`doc`)

```js
{
  company, title, subtitle: 'line' | ['line', …], titleEveryPage: false,
  head: '<tr><th>…</th></tr>', rows: ['<tr>…</tr>', …], foot: '<tr>…</tr>',   // one table
  sections: [{ heading?, newPage?, head, rows, foot } | { heading?, newPage?, flow: [html, …] }],  // or several
  empty: 'No data matches these filters.',
  css: '.fbdoc-rpt-tbl td.x { … }',     // scope it to .fbdoc-rpt-tbl / .fbdoc-rpt-flow
  fontPt: 10,                          // the jrxml's detail font size
  pageFooter: false                    // a stock report without the date / "Page X of Y" footer
}
```

Rows are the App view's own row HTML. Their classes drive the bands:

| Row | Meaning on paper |
|---|---|
| `tr.rpt-grp` | group heading: keeps with its first line, repeated "(continued)" at the top of a sheet that starts inside the group |
| `tr.rpt-sub` | sub-group heading, the same within its group |
| `data-pdf-level="n"` | a deeper heading level (part → section → category) |
| `tr.rpt-minor` | a minor row (tracking, notes): the first of a run keeps with the line above |
| `data-pdf-break` | starts a new sheet |
| `th[data-pdf-min="<pt>"]` | the column is never narrower (a blank write-in column) |

Columns are measured and fitted to the page: numbers never wrap, text columns
share the spare width or wrap; when even that is too wide the font steps down
a point at a time to 6.5pt, then every column scales. Flow blocks (address
labels, cards) are placed whole.

### Own sheets (`pages`) — `FBDoc.paginate` documents

For a form-like document (a sales order, a packing slip), `pages(geom, page)`
returns an FBDoc document; `geom` is the page geometry (`CWpt` = content width
in pt, `W`, `H`…). The document:

```js
{
  id: 'so-10042',
  pageHeader: html | ctx => html,       // every sheet (ctx.first: the first sheet)
  pageFooter: ctx => html,              // every sheet but the last
  lastPageFooter: ctx => html,          // the last sheet, pinned to the bottom
  tables: { items: { className, colgroup: FBDoc.Columns.colgroup(widths), thead: '<thead>…</thead>' } },
  blocks: [
    { html },                                         // a flow block
    { table: 'items', html: '<tr>…</tr>', stripe: true },   // a table row (zebra per sheet)
    { kwn: true }, { kwp: true }, { brk: true },      // keep with next / previous, break before
    { groupHeader: 'kit7', repeatHtml: '<tr>… (continued)</tr>' }, { grp: ['kit7'] },
    { split: true, html: '<div data-fbdoc-split>long text</div>' }   // may split across sheets by line
  ]
}
```

`ctx.pageNo` / `ctx.pageCount` are placeholders filled after layout ("Page X of
Y"). `FBDoc.Columns.fit(cols, geom.CWpt)` sizes table columns from the shared
catalogue (`FBDoc.Columns.CATALOG`). `FBDoc.last` holds the last layout's
geometry and warnings.

## One record — `FBDoc.Record(cfg)`

The record a record document prints: picker, previous / next, Refresh, the
start order, the launch lock and the document-output guard. The page keeps its
own queries and loader.

```js
REC = FBDoc.Record({
  code: 'WO', noun: 'work order', table: 'wo',
  els: { input: 'woInput', browse: 'woBrowse', prev: 'woPrev', next: 'woNext', refresh: 'refreshBtn', locked: 'woLocked' },
  setting: 'set-wo',                      // the record report setting's text/plain block
  keys: { last: 'lastWo', seen: 'seenSetting', pick: 'pickFilter' },   // FBLib.Settings user keys
  remember: () => !!resolve('remember'),
  filters: async saved => [{ key: 'status', label: 'Status', multi: true, options, value: saved.status || [] }],
  where: f => [/* SQL terms on the table, from the chips (previous / next) */],
  search: async (term, f) => rows.map(r => ({ value: r.id, label: r.num, sub, meta: [status, date] })),
  newest: async () => id,                 // optional; default the highest id
  load: ref => loadWo(ref)                // ref { id } or { num }; resolves true when loaded
});
S.launched = REC.launched;               // { id, num, from, module } or null
// in the loader: REC.loaded(id, label) on success; REC.failed(message) after a failed load's re-render
if (await REC.start() === 'none') showNoRecords();
```

- **Start order:** a launch for this document's module (the record is then
  fixed: everything marked `rec-browse` is hidden, the lock note says which
  module it came from, it is never remembered); else the record setting
  (adopted once per user); else the user's last; else the newest.
- **Document output** (`FB_LAUNCH.output === 'pdf'`): only for a launched
  record. No launch, another module's record, or a record that won't load
  reports `window.FB_DOC = { state: 'error', message }`; otherwise
  `FBDoc.Report.view` reports `ready` once the sheets are laid out.
- `FBDoc.Record.paper('set-print', { size: 'Letter', orientation: 'portrait' })`
  reads the Page_setup report setting for `Report.view`'s `page`
  (`{ size, orientation, chosen }`).

## The stock report's options — `FBDoc.Options(cfg)`

Each option is a jrxml parameter by its own name, so the stock report's saved
options (`reportparameter` rows) map straight onto it. Starting point: jrxml
default → the stock report's saved value → company defaults → the user's last
choices.

```js
OPT = FBDoc.Options({
  groups: [{ where: 'filters', title: 'Header', items: [['ShowBarcode', 'Barcode'], ['cbShowDate', 'Date shown', null, ['issued', 'created']]] },
           { where: 'settings', title: 'Columns', items: [['colPart#', 'Part #']] }],
  filterGrid: 'filterGrid', settingsGrid: 'setGrid', settingsBefore: 'adminGroup', note: 'optNote',
  stock: 'Work Order Traveler', remember: () => true,
  deps: get => [['ShowCategoryColor', get('ShowCategory')]],
  onChange: values => reloadOrRender()
});
OPT.init(jrxmlDefaults(ENV), await FBDoc.presets('../reports/WorkOrder/WOTraveler.jasper'));
OPT.get('ShowBarcode'); OPT.label('ReportTitle', 'Work Order Traveler');
// Admin group buttons: OPT.publish() / OPT.unpublish(); Reset options: OPT.reset()
```

Item kinds: none = checkbox; `[[value, label], …]` or `['a', 'b']` = select;
`'text'` = text box. The page's `FBLib.Settings.init` must declare
`company: { keys: ['filters'], editors: true }`.

## Smaller pieces

| API | What it does |
|---|---|
| `FBDoc.env(extraSysKeys)` | The company's formats: `edition`, `isAU` / `isUS` / `isCaOrIntl`, `multiCurrency`, `price` / `cost` / `total` / `qty` / `date` patterns, `barcodeDI`, `useCode`, `logo`, `sys` |
| `FBDoc.fmt.number(pattern, v, { symbol, rounding })`, `.date(pattern, v)`, `.currencySymbol(code, useCode)`, `.printedAt()` | Java DecimalFormat / SimpleDateFormat ports, as the jrxml prints |
| `FBDoc.q(sql, params)` | SELECT with `?` bound inline (escaped); throws on Fishbowl's error row |
| `FBDoc.sys(keys)`, `FBDoc.presets(path)`, `FBDoc.companyLogo()` | system properties, a stock report's saved options, the company image |
| `FBDoc.param(v, fallback)`, `.fromEl(id)`, `.bool`, `.int` | a report setting's value (the token's default when unsubstituted) |
| `FBDoc.launch.get()` | the normalised `window.FB_LAUNCH` (see [launch-context.md](launch-context.md)) |
| `FBDoc.output.requested() / loading() / ready(info) / fail(msg)` | document output state for a host |
| `FBDoc.picker(opts)` | the typeahead record picker FBDoc.Record uses |
| `FBDoc.page.resolve(raw)`, `FBDoc.page.geometry(spec)` | paper from a Page_setup value, and its geometry |
| `FBDoc.paper.all()` / `.setAll(size)` | the paper size for every report |
| `FBDoc.printWindow({ mount, title, win })` | print laid-out sheets through a new window (`window.print()` on the report page is unreliable in Fishbowl's browser) |
| `FBDoc.layout(model)` | the pure page-break algorithm (Node-testable) |

## Tests

`tools/doc-tests/`: `unit.test.js` (the pure parts and the lint, no browser),
the record documents' render tests against a live database (`SOReport`,
`PackingList`, `ShippingInvoice`, `Output`), and `variant-check.js` (the Sales
Invoice copy). `tools/report-harness/` runs any report on recorded data.

## History

Promoted from the Paperwork proof of concept (archived in
`archived/Other_NOT_FOR_PRODUCTION/Paperwork_POC/`). Its screen shell
`FBDoc.app` ran the four paperwork documents as paper-only pages until
2026-10-16, when they moved to the REPORT chrome with App and PDF views and
`FBDoc.Record` / `FBDoc.Options` / `FBDoc.env` replaced it.
