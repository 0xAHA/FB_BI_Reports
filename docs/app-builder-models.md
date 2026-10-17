# App Builder: the catalog and how to extend it

The App Builder (formerly Report Builder) lets a non-technical user build a
table report from a curated catalog of fields and publish it as a real custom
app. Users never write SQL; the catalog's SQL is ours, validated against the
reports it must agree with. This page explains the moving parts and how to add
to the catalog. The Claude Code skill `extend-app-builder-model` follows it.

## The parts

| File | Record | What it is |
|---|---|---|
| `scripts/fb-model.js` | Script `fb-model` | **The catalog** (`FBModel`): subject areas, joins, fields (dimensions, measures, formulas), access gates. Pure data plus a `merge()` for the company extension |
| `scripts/fb-report.js` | Script `fb-report` | **The runtime** (`FBReport`): compiles a report's spec against the catalog into SQL every time the report runs, shapes the rows into groups and exact totals, and renders the report (REPORT chrome, filters, RowCap, RptCols, Excel, the fb-doc PDF view). Pure parts (`Dates`, `Expr`, `Sql`, `Agg`) run in Node |
| `scripts/fb-builder.js` | Script `fb-builder` | **The builder screen**: the field tree, the Group by / Columns / Filters / Sort wells, the formula dialog, a live preview |
| `Other_NOT_FOR_PRODUCTION/Report_Builder/Report_Builder.htm` | App Builder (#163 on the dev server) | The builder's page |
| Script `fb-model-local` | (per company, made in Fishbowl) | **The company extension**: saved formulas, renamed labels, hidden fields (JSON) |
| `tools/report-builder/` | — | Unit tests, `validate-catalog.js` (live checks), `gen-page.js` (a report page from a definition) |
| report_btn `editor/BuilderPublisher` | (plugin) | Publishing a built report as an app |

**Standalone vs report_btn.** A built report is an ordinary BI page: it holds
the spec as JSON (`<script type="application/json" id="fb-report-spec">`), no
SQL, and includes fb-lib, fb-styles, fb-doc, fb-model and fb-report. It runs
in the plain BI Reports viewer. Only *publishing from the builder* needs
report_btn; without it, `gen-page.js` turns a definition into a page you
deploy like any report.

## How a report runs

1. `FBReport.boot()` reads the spec, loads the catalog (merged with
   `fb-model-local` when the company has one) and mounts the view.
2. `FBReport.Sql.compile(spec, catalog, ctx)` turns the spec into a plan:
   the subject's `from`, the joins the chosen fields `uses` (in the catalog's
   join order, closed over each join's `needs`), the subject's `where`, the
   location-group restriction (`getLocationGroupList()`), the filters, and
   one query per level with `GROUP BY … WITH ROLLUP` and `GROUPING()` flags.
   Fields gated by an access right the user lacks are refused in plain words.
3. `FBReport.Agg.shape(plan, rows)` builds the group tree. Totals come from
   SQL, never from adding rows on screen; formula measures (Margin %) are
   worked out again at every level from that level's figures.

This needs **MySQL 8** (ROLLUP with `GROUPING()`); Fishbowl's bundled MySQL is 8.x.

## The spec (what a built report stores)

```json
{ "kind": "fb-report-spec", "v": 1, "catalog": { "id": "fb.core", "version": 1 },
  "subject": "sales.posted", "title": "Margin by Customer",
  "params": [{ "id": "p.date", "label": "Posted", "field": "posted.date", "op": "between", "value": { "preset": "current_fy" }, "ask": true }],
  "steps": [
    { "id": "src", "type": "source", "subject": "sales.posted" },
    { "id": "flt", "type": "filter", "in": "src", "all": [{ "param": "p.date" }] },
    { "id": "grp", "type": "group", "in": "flt", "detail": false, "levels": [{ "field": "customer.name" }, { "field": "posted.date", "bucket": "month" }] },
    { "id": "tbl", "type": "table", "in": "grp", "columns": [{ "id": "revenue", "ref": "posted.revenue" }], "sort": [] } ],
  "page": { "size": "Letter", "orientation": "portrait" } }
```

Specs refer to fields by **id**. That is why ids are permanent.

## The catalog's shape

```js
joins[alias]   = { sql: 'LEFT JOIN customer cust ON cust.id = so.customerId', needs: ['so'], card: 'one' | 'many' }
subjects[id]   = { label, desc, from, has: [aliases the from provides], where: [sql], lg: 'so.locationGroupId',
                   dates: [field ids], requireDate, defaultDate: { field, preset }, pushdown?: { fieldId: [{ col, mark }] } }
fields[id]     = dimension { label, folder, type, sql, uses: [aliases], key?, lookup?, values?, link?, fanout?, listSql?, filterIn?, desc? }
               | measure   { label, folder, type, agg: 'sum'|'count'|'distinct'|'min'|'max'|'avg', row: sql, uses, gate?, only?: [subjects] }
               | formula   { label, folder, type, calc: '[a] - [b]', gate? }
gates[name]    = { label, right: 'Sales Order-Cost' }      // a Fishbowl access right (useraccess.moduleName)
```

- **types**: `text`, `int`, `number`, `qty`, `money`, `percent`, `date`, `bool`.
- **`uses`**: every join alias the SQL touches. The compiler adds only what a
  report needs; a missing alias is a broken query.
- **`key` + `lookup`**: filter by id with a pick-list (`SELECT id AS v, name AS l …`).
- **`link`**: `{ module: 'Sales Order' }` makes the value open the record.
- **`fanout`** (+ `listSql`, `filterIn`): a many-to-many dimension (customer
  groups): grouping by it counts a row under each value, the grand total
  counts it once; on detail rows it lists the values.
- **`only`**: a measure that belongs to one subject (its rows would double
  count elsewhere).
- **`gate`**: cost and margin fields need `Sales Order-Cost` / `Sales Order-Margin`.
- **`pushdown`**: a date filter pushed inside a derived `from` (`/*@d1*/` marks).

**Rules (in the file's header):** field ids are permanent (retire with
`deprecated: { since, replacedBy, note }`); SQL lowercase tables, `+0` on
`bit(1)`, no Fishbowl views; every amount in the home currency; bump
`version` and add a `changes` entry whenever a definition changes.

## Adding to the catalog

### A field on an existing subject

1. Find the column and its join in the schema (`schema/schema-index.md`) and
   in a report that already computes it (the figure must match Fishbowl's own).
2. Add any new join to `joins`, **after** the joins it `needs` (the order is
   the emission order).
3. Add the field: a stable id `<folder>.<name>`, label, folder, type, `sql`,
   `uses`. Measures: `agg` + `row`; ratios as formulas (`calc`), not as SQL.
4. If its folder is new, add it to `FOLDERS` in `scripts/fb-builder.js` (the
   field tree's order).
5. Bump `catalog.version`, add a `changes` entry.
6. Test (below).

### A new subject area

A subject is one **grain** (one row per posted line, per order line, per
order…). Choose the grain first; every measure on it must be additive at that
grain or be marked `only` / be a `distinct` count.

1. `subjects[id]`: `from` (the base tables and their aliases; list them in
   `has`), `where` (rows that aren't part of the subject), `lg` (the location
   group column), `dates` (the date fields a report can filter or bucket on),
   `requireDate` / `defaultDate` for big tables.
2. The dimensions shared with other subjects are reused when their `uses`
   aliases exist in the new subject's joins; add joins that start from its
   own aliases.
3. Its measures with `only: ['<subject>']` (the catalog assigns own-prefix
   measures automatically: `posted.` → `sales.posted`…; follow that pattern
   with a new prefix).
4. Add a parity check to `validate-catalog.js`: the subject's totals against
   the existing report or dashboard it must agree with.

### Company extension (no code)

An admin can add, per company, a Script record named **`fb-model-local`**
whose text is JSON:

```json
{ "formulas": [{ "id": "x.netMargin", "label": "Net margin", "folder": "Company formulas", "type": "money", "calc": "[posted.margin] - [posted.revenue] * 0.02" }],
  "labels": { "customer.name": "Account" },
  "hidden": ["order.carrier"] }
```

Formula ids must start `x.`; shipped SQL always wins. The **running report**
merges it (`FBReport.boot`); see the gaps below for the builder.

## Test

```
node --test "tools/report-builder/test/*.test.js"      # compiler, formulas, dates: no database
node tools/report-builder/validate-catalog.js          # every field in every subject + parity, live (read-only)
```

`validate-catalog.js` uses the deploy tool's local server config
(`tools/deploy/fishbowl.local.json`) and sends SELECTs only. It flags any
query over 2 s. Then build a report that uses the new fields
(`gen-page.js <definition.json>`), run it in the harness or the client, and
check its totals against the source report.

## Deploy

Deploy order: fb-styles, fb-lib, fb-doc + fb-doc-fonts, **fb-model,
fb-report**, fb-builder, then the builder page and built reports. A catalog
change reaches every built report the next time it runs (they compile at run
time); renamed or removed field ids break the reports that use them, which is
why ids never change.

## Known gaps (2026-10-16)

- **The builder screen ignores `fb-model-local`**: `fb-builder.js` uses
  `FBModel.catalog`, so company formulas, labels and hidden fields apply to
  running reports but don't show in the builder. Fix: load and `merge()` the
  extension in the builder as `FBReport.boot` does.
- **No charts yet**: the chart step and its library (`fb-echarts`, an
  inlined ECharts build with the SVG renderer, because canvas comes out
  blank in print-window clones) are planned, not built.
- **`tools/deploy/publish.js` doesn't know fb-model, fb-report, fb-builder or
  fb-pricing** (its `FIXED` list names only fb-lib, fb-mfg, fb-doc,
  fb-styles, fb-doc-fonts), so they can't be published to SharePoint until
  they are added there.
- **`FOLDERS` is hard-coded** in `scripts/fb-builder.js`: a new folder name
  must be added there.
- **v1 covers Sales only** (posted, order lines, invoiced, orders).
- Not client-tested beyond publishing (see the report_btn README).
