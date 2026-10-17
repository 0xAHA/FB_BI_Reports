---
name: port-ireport-report
description: Port a standard Fishbowl iReport (JasperReports .jrxml) to a faithful BI report in iReport_Ports/, with the App / PDF views, table tools, the differences register and tests. Use when asked to port, replicate, rebuild or convert a stock Fishbowl report or jrxml into a BI report.
---

# Port a stock iReport

The full process is `docs/porting-ireport.md`; read it first. Faithful means the same tables, parameters (as filters), columns, grouping and totals as the stock report. Only the presentation changes, and every deviation is registered.

## Checklist

1. **Find the original.** `C:\Program Files\Fishbowl\server\reports\<Folder>\<Name>.jrxml` (read-only) and every subreport it references. Its display name is `report.name`; its saved options are `reportparameter` rows for `../reports/<Folder>/<Name>.jasper`. Check `iReport_Ports/README.md` that it isn't ported already. Same-name variants (`…Export`, `…Landscape`) become one port.
2. **Read the jrxml**: the query, `$P` / `$P!` parameters and their defaults, groups, variables (totals and their reset), `printWhenExpression` options, subreports, Java helpers, the paper and the title band. Write down the rules before writing code.
3. **Copy the template**: `Template/List_Report_Template.htm` for a list, `Template/Record_Document_Template.htm` for one record. Save as `iReport_Ports/<Folder>/<jrxml name>.htm`.
4. **Identity**: `fb-folder` = the original's folder; `fb-origin` `system`; the description; `FB_REPORT.name` = the stock display name; a unique key (`cdx.bi.ip<Short>`). `fb-launch` ONLY for the paperwork documents (Sales Order Report / Sales Invoice SO, Purchase Order Report PO, Pick Ticket PICK, Packing Slip / Shipping Invoice SHIP, Work Order Traveler WO, Manufacture Order Traveler MO).
5. **SQL**: rewrite the query for BI (SELECT first, no CTE, lower-case keys, no bare NULL, `bit(1)` as `col+0`, scoped tag scans; TEMPTABLE `qty*` views timed and inlined when slow). Run it against a real database as the page builds it; note timings.
6. **App view**: filters for every parameter; groups carrying their totals; one totals footer; links; Excel; company defaults (all five parts). Decide and note: RowCap (or why not), RptCols sort / reorder exceptions, a Pivot view, other views.
7. **PDF view**: `docSpec()` from the App view's print-mode rows; the stock paper, title band placement, font size; sections / flow for subreports and cards; `PDF_CSS` black on white.
8. **Record document**: `FBDoc.Record` (picker, launch lock, output guard), the record report setting + Page_setup blocks, the jrxml's options with the stock presets.
9. **Test** with `tools/report-harness` (fixture → build → run --pdf → check; `ab.js --launch` for a record document). Totals by hand against the fixture rows. Look at every screenshot.
10. **Register** every difference in the header comment and in `iReport_Ports/DIFFERENCES.md` (`| Report | Area | Stock report does | Port does | Type | Evidence | How to verify | Reviewed |`; types fix / addition / omission / layout / performance / data).
11. **README row** in `iReport_Ports/README.md` (port, original, notes).
12. **Deploy**: ask the user for the target on the first edit (`tools/deploy/targets.js`); ports deploy to Fishbowl. Never `--force` / `--access` without a yes.

Report back: the rules reproduced, the differences, the test evidence (queries and timings, totals checked, PDF pages / overflow), and what still needs a client test.
