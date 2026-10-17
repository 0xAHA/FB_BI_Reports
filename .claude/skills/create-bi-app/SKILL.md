---
name: create-bi-app
description: Create a new Fishbowl BI report or app in this repo (a list report, a one-record document, or a tool that writes data) from the right template, with the shared libraries, a printable view, the identity head and the deploy steps. Use when asked to build, start or scaffold a new BI report, app, tool or document.
---

# Create a BI app or report

The full guide is `docs/building-apps.md`; read it once. The steps:

## 1. Settle the basics with the user (ask, don't guess)
- The record name: a plain name, no "- Folder -" prefix.
- The folder (`fb-folder`): one of Fishbowl's report-tree folders (`Sales Order`, `Inventory`, `Part`…), else `Dashboards`, `Custom` or `Other`.
- Whether a module's Apps menu should list it (`fb-launch`). Normally only paperwork documents (a module's own printed document) do; everything else has none.
- One sentence describing it.

## 2. Pick the template
| It is | Copy |
|---|---|
| Rows with groups and totals | `Template/List_Report_Template.htm` |
| A document for one record | `Template/Record_Document_Template.htm` |
| A screen that changes data | `Template/Form_Tool_Template.htm` |
| A port of a stock iReport | use the `port-ireport-report` skill |

Copy it to `<Folder>/<Report_Name>.htm` (spaces as underscores). Every template is a working report: build and run it once in the harness before changing it (step 5).

## 3. Replace every `TEMPLATE:` marker
Search the file for `TEMPLATE:` and work through them in order. The header comment lists them. Always:
- The head: `fb-folder`, the description, `FB_REPORT.key` (unique, ≤ 31 characters), `FB_REPORT.name` (the record name), `<title>`, `h1`. Leave `build` as it is (the stamp hook writes it). No `fb-origin` tag (a new report is custom). An `fb-launch` tag only when step 1 said so, right after `<meta charset>`.
- Keep the shared parts: the directives (each exactly once, never in comments or strings), `FBLib.Settings.init` keyed off `FB_REPORT.key`, the company defaults (Settings › Admin), the debug console, Remember, the PDF view and Print.
- SQL: read `schema/schema-index.md` and the domain schema file first. SELECT only, lower-case tables, keys come back lower-case, `bit(1)` as `col+0`, never a bare `NULL` column, user text through `sqlStr`, ids through `ints`, `runQueryAsync` with a load token.
- A record document: keep `FBDoc.Record` (`makeRecord`), set its code / noun / table / search / chips, and the record report setting and Page_setup blocks at the top of `<body>` (each token exactly once).
- A tool that writes: keep the write pattern in the template's header (access right, re-read, one confirm, payload logged, status checked, data read back). No dry-run or admin-enable switches.

## 4. Printability
Every app prints. List and record templates already have the PDF view (`FBDoc.Report.view`): give `docSpec()` (or `pages`) your rows and the stock paper. A tool without a PDF view prints its screen through a print window, never `window.print()` on the page.

## 5. Test
```
node tools/report-harness/serve.js        # leave running
node tools/report-harness/fixture.js <file> <fx.js> [steps.js]    # records its queries from the local Fishbowl
node tools/report-harness/build.js <file> <fx.js>
node tools/report-harness/run.js <out>/<Name>.html --pdf --shot shot.png
node tools/report-harness/check.js <file>
```
Look at the screenshot. No page errors; totals checked against the fixture rows; filters, Excel, Print, the PDF view in both orientations. A record document: `steps/record-nav.js` (picker, previous / next). Say plainly what still needs the Fishbowl client (it always does).

## 6. Deploy
The first edit makes the after-edit hook ask where the file deploys: **ask the user** with AskUserQuestion (Fishbowl / SharePoint / both / neither), then `node tools/deploy/targets.js <answer> "<file>"`. Never `--force` without a yes; never `--access` unless asked. Shared scripts deploy first (fb-styles, fb-lib, fb-doc + fb-doc-fonts).

## 7. Finish
Tell the user what was built, what was tested and how, and what needs a client test. Don't commit unless asked.
