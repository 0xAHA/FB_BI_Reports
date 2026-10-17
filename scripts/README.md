# Shared assets

Every report includes these by **record name** through Fishbowl's Script /
Style directives (each exactly once in a page; Fishbowl replaces every
occurrence of a directive's text, so never write one in a comment or string).
A page always gets the version saved in Fishbowl: deploy an asset before the
reports that need its changes.

| File | Fishbowl record | Namespace | What it is | Guide |
|---|---|---|---|---|
| `fb-styles.css` | Style `fb-styles` | `--fb-*` tokens | Brand tokens and every shared component (§1–36: REPORT chrome §35, `.rpt-table` §29, table tools §36, drawers, toasts, pills…) | [building-apps.md](../docs/building-apps.md) |
| `fb-lib.js` | Script `fb-lib` | `FBLib` | The shared runtime: Common (formats, debug console, drawers, panels, MultiSelect), Settings (per user + company defaults), SharedData, FilterViews, RowCap, RptCols, Pivot, Export (.xlsx), custom-field columns | [building-apps.md](../docs/building-apps.md) |
| `fb-doc.js` | Script `fb-doc` | `FBDoc` | Printable documents: the App / PDF views (Report.view), record documents (Record), options (Options), formats (env), paper, document output, barcodes | [fb-doc.md](../docs/fb-doc.md) |
| `fb-doc-fonts.css` | Style `fb-doc-fonts` | | Open Sans (the standard reports' font) as data: URLs, for the PDF view | [fb-doc.md](../docs/fb-doc.md) |
| `fb-mfg.js` | Script `fb-mfg` | `FBMfg` | Manufacturing engines (finish a work order, scrap, staging), generated from `Custom/Manufacturing/Production_Scheduling_v1.2.htm` | |
| `fb-pricing.js` | Script `fb-pricing` | `FBPricing` | A product's price for a customer after Fishbowl's pricing rules (a port of the server's GetPrices) | |
| `fb-model.js` | Script `fb-model` | `FBModel` | The App Builder's catalog | [app-builder-models.md](../docs/app-builder-models.md) |
| `fb-report.js` | Script `fb-report` | `FBReport` | The App Builder's runtime (compiles a report's spec to SQL at run time) | [app-builder-models.md](../docs/app-builder-models.md) |
| `fb-builder.js` | Script `fb-builder` | `FBBuilder` | The App Builder's screen | [app-builder-models.md](../docs/app-builder-models.md) |

## Deploy order

1. fb-styles
2. fb-lib
3. fb-doc and fb-doc-fonts
4. fb-mfg, fb-pricing (only the reports that use them)
5. fb-model, fb-report, then fb-builder (the App Builder and its reports)
6. the reports

Each file carries its own build stamp (`FBLib.BUILD`, `FBDoc.BUILD`,
`--fb-styles-build`…; `tools/stamp`), so a page's debug console shows which
version it got. Deploying and publishing: [tools/deploy/README.md](../tools/deploy/README.md).
SharePoint publishing (`publish.js`) knows fb-lib, fb-mfg, fb-doc, fb-styles
and fb-doc-fonts; the App Builder scripts and fb-pricing are deployed to
Fishbowl only.

## Changing a shared asset

- It changes every report that includes it. Prove it: run the affected
  reports before and after (`tools/report-harness/ab.js`; fb-doc also has
  `tools/doc-tests/`, fb-lib `tools/fb-lib-tests/`, the App Builder
  `tools/report-builder/`).
- Never put a page-specific workaround in a shared file, and never copy a
  shared function into a page.
- fb-doc.js and fb-lib.js are inlined into pages: no setting-token or
  directive literal, no `fb-launch` meta tag anywhere in them (the unit tests
  lint for it).
