---
name: extend-app-builder-model
description: Add fields, measures, formulas, joins or a new subject area to the App Builder's catalog (scripts/fb-model.js), keeping ids stable, figures matching Fishbowl's own reports, and the catalog tests and live validation green. Use when asked to extend the App Builder / Report Builder model or catalog, add a field or subject to it, or explain how to.
---

# Extend the App Builder catalog

Read `docs/app-builder-models.md` first (the parts, the spec, the catalog's shape, the gaps).

## Before writing anything
- Decide what the user wants to report and **which existing Fishbowl report or dashboard the figure must agree with**. The catalog's measures copy validated SQL; find that SQL (e.g. `Dashboards/Sales_Dashboard_v1.2.htm`, `Custom/SalesOrder/SalesOrderSummary.htm`, an iReport port) and reuse it.
- New field on an existing subject, or a new subject (a new **grain**: one row per what)? A new subject needs a parity check.
- Never rename or reuse a field id; retire one with `deprecated: { since, replacedBy, note }`.

## Steps
1. Read `scripts/fb-model.js` top to bottom (header rules, shared SQL constants, joins in order, subjects, fields, the `only` assignment at the end).
2. Schema: `schema/schema-index.md` and the domain file; confirm columns against a real database.
3. Joins: add new ones after the joins they `need` (order = emission order). `card: 'many'` for a join that can multiply rows (then the dimension needs `fanout` handling).
4. Fields: id `<folder>.<name>`; `type`; dimension `sql` + `uses` (every alias it touches) + `key`/`lookup` for pick-lists + `link` for record links; measure `agg` + `row` + `uses` (+ `gate: 'cost' | 'margin'` for cost / margin); ratios as formulas (`calc`). Amounts in home currency; lowercase tables; `bit(1)` as `+0`; no Fishbowl views.
5. A new subject: `from`, `has`, `where`, `lg`, `dates`, `requireDate`, `defaultDate`; its measures `only` that subject (new id prefix + the `OWN` map).
6. A new folder name: add it to `FOLDERS` in `scripts/fb-builder.js`.
7. Bump `catalog.version`, add a `changes` entry (date, what changed).
8. Tests:
   ```
   node --test "tools/report-builder/test/*.test.js"
   node tools/report-builder/validate-catalog.js
   ```
   Add a compile test for anything new in the compiler's path (fan-out, push-down, gates), and a parity check (P-series) in `validate-catalog.js` for a new subject or a new measure family. Every probe passes, nothing over 2 s, parity within a cent.
9. Build a report with the new fields (`node tools/report-builder/gen-page.js <definition.json>`) and check its totals against the source report.
10. Deploy order: fb-model, fb-report, then fb-builder. Ask the user before the first deploy of a new file (`tools/deploy/targets.js`).

## Company-only additions
A formula, a relabel or hiding a field for one company needs no code: the admin saves JSON in a Script record named `fb-model-local` (`formulas` with ids `x.*`, `labels`, `hidden`). Note that the builder screen doesn't read it yet (a known gap); running reports do.

Report back: what was added (ids, SQL source it agrees with), the test and validation output, and any query timing.
