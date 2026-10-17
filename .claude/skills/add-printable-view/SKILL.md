---
name: add-printable-view
description: Give an existing Fishbowl BI report an App / PDF view (fb-doc's FBDoc.Report.view) so it prints like a Jasper report, without changing its data or App view. Use when asked to make a BI report printable, add a PDF view or print layout, or make it print like the stock report.
---

# Add the App / PDF view to an existing report

Reference: `docs/fb-doc.md` (the view, the report spec, the row classes) and `docs/porting-ireport.md` §6. Working examples: `iReport_Ports/ManufactureOrder/AvailableToBuild.htm` and `iReport_Ports/Part/PartActivity.htm` (older reports given a PDF view), `iReport_Ports/Inventory/AgingReport.htm` (a port).

## Work on a copy
The report deploys on every Edit / Write (the after-edit hook). Copy it to the scratchpad, make and test every change there, and land it with one `cp` at the end; then run `node tools/stamp/stamp.js <file>` and deploy it (`node tools/deploy/fbdeploy.js "<file>"`, which only updates a record it wrote last; anything else needs the user's yes for `--force`).

## Steps
1. **Includes.** The `fb-doc` Script directive block right after fb-lib's, the `fb-doc-fonts` Style block right after fb-styles'. Each directive exactly once in the file, never in comments or strings.
2. **The App element.** Give the report's main content wrapper an id (wrap the scroll box and any pivot host in `<div class="rpt-app" id="appView">`).
3. **The view**, in init after the table is set up:
   ```js
   if (window.FBDoc && FBDoc.Report) PDF = FBDoc.Report.view({
     app: document.getElementById('appView'), toggleBefore: document.getElementById('exportBtn'),
     page: { size: 'Letter', orientation: 'landscape' },     // the stock report's paper
     doc: docSpec, title: () => 'Report title' });
   ```
4. **`docSpec()`**: `null` before the first load, else `{ company, title, subtitle, titleEveryPage, head, rows, foot, empty, css: PDF_CSS, fontPt }` built only from data the page already holds (no queries inside it). Rows are `<tr>` strings: `tr.rpt-grp` / `tr.rpt-sub` (headings; `data-pdf-level` for deeper), plain lines, `tr.rpt-minor`; `data-pdf-break` for a new page; long notes on their own `colspan` row. `foot` only when the stock report prints totals.
5. **`PDF_CSS`**: the report's own classes inside the pages, scoped `.fbdoc-rpt-tbl …`: black text, no screen colours, the printout's indents.
6. **Refresh**: every repaint ends with `if (PDF) PDF.refresh();`.
7. **Print**: `PDF.print()` when `PDF` exists, else the report's existing printout (rename it `printPlain`). Update the Print button's title.
8. **Docs**: a `VIEWS` paragraph in the header comment (what the PDF view reproduces and leaves out), one Help bullet on App / PDF and the paper bar.

The stock report decides the layout: read its jrxml bands (title band placement, column headings, groups, totals, font, paper). Where the BI report shows more, carry it on a note row or a column that can be switched off; where the stock report prints something the BI report doesn't compute, leave it out and say so.

## Test
`tools/report-harness`: build from the copy (`build.js <copy> <fixture>`), `run.js --pdf`. Check no `[data-fbdoc-overflow]`, no clipped cells, portrait / landscape / A4 / Letter, the Print window's sheet count equals the view's, the view and paper are remembered over a reload, and the App view is unchanged after switching back. Look at every screenshot.
