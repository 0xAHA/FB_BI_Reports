# Report Builder: catalog and runtime tests

The Report Builder lets non-technical users build table reports from a curated
catalog. Its two shared scripts are:

- `scripts/fb-model.js`: the catalog. It defines the subject areas, the friendly
  fields, and measures such as Margin %, all built from validated SQL.
- `scripts/fb-report.js`: the runtime. It compiles a report's spec to SQL each
  time the report runs, then shapes the rows into groups and exact totals.

Both run in Node as well as in the client, so they are tested here. The builder
screen is `scripts/fb-builder.js`, and publishing is in the report_btn plugin
(`editor/BuilderPublisher`); see its README, version 0.6.0.

## Commands

```
node --test "tools/report-builder/test/*.test.js"      # unit tests, no database
node tools/report-builder/validate-catalog.js          # live checks, read-only
node tools/report-builder/validate-catalog.js --probe  # only: every field in every subject
node tools/report-builder/validate-catalog.js --parity # only: figures against the reports they copy
```

**Unit tests** cover:
- the formula language: parsing, types, SQL and evaluation;
- hostile input;
- date presets, including the financial year;
- compiling every kind of spec, for example rights, location groups, customer-group
  fan-out, the invoiced date push-down, and the plain-language errors.

**`validate-catalog.js`** talks to the local Fishbowl server through
`tools/deploy` (`fishbowl.local.json`). It sends SELECT statements only, and
refuses anything else.
- It compiles and runs every field in every subject that offers it, and flags
  queries over 2 s.
- It checks parity:
  - P1: posted revenue and cost by customer, and the grand-total margin %, match
    `Dashboards/Sales_Dashboard_v1.2.htm`. That dashboard's own `REV_EXPR` and
    `BASE_JOIN` are read from the page, so a change there is caught.
  - P2: order-line values match `SalesOrderSummary`.
  - P3: invoiced matches `Custom/Malmet/SOA_Report.htm`'s two legs.
  - P4: every total equals the sum beneath it. Distinct counts count once. A
    customer-group grouping keeps the true grand total.

Run both after any change to `fb-model.js` or `fb-report.js`.

## Making a report page (until the builder exists)

A report is a definition file:

```json
{ "name": "…", "key": "cdx.bi.…", "folder": "Custom", "launch": "SO",
  "description": "…", "spec": { "kind": "fb-report-spec", "v": 1 } }
```

- `key` is at most 31 characters.
- `launch` is optional.
- `spec` is the report definition itself; this skeleton shows only its first two keys.

Turn it into an app page with:

```
node tools/report-builder/gen-page.js Other_NOT_FOR_PRODUCTION/Report_Builder/examples/Margin_by_Customer.json
```

That writes the `.htm` next to the definition. The page holds:
- the identity block and tags (`fb-origin` custom, `fb-builder`);
- the shared includes;
- the spec as a JSON block.

The page holds no SQL. Deploy it like any app; the first time, set its target with
`targets.js`.

## The catalog's rules

- Field ids are permanent: never rename or reuse one. Retire a field with
  `deprecated: { since, replacedBy, note }`.
- After a definition change, bump `version` and add a `changes` entry.
- SQL in the catalog uses lowercase table names, `+0` on bit(1) columns, and no
  Fishbowl views.
- All amounts are in the home currency.
- Totals come from SQL (`GROUP BY … WITH ROLLUP`), never from adding up rows on
  screen. A formula measure such as Margin % is worked out again at every level.
