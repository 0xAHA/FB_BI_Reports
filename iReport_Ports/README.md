# iReport ports

BI versions of Fishbowl's standard iReport (JasperReports) reports. Each port
sits in the same folder as its original under
`C:\Program Files\Fishbowl\server\reports\`, reads the same tables, applies the
same filters and totals, and keeps the same columns. What changes is the
presentation, which uses the REPORT chrome (fb-styles §35, as in PO Summary):
a push-down filter panel that applies as it changes, collapsible group rows
carrying the group totals, a sticky totals footer, links into Fishbowl, Excel
export, and a print layout close to the original. The first versions, with
filter drawers and KPI tiles, are in `archived/iReport_Ports/`.

Each file's header comment lists its rules and every place it deliberately
differs from the original. None of them is published yet (`FB_REPORT.name` is
`null`). They need the current fb-lib (`FBLib.Common.togglePanel`) and
fb-styles (§35), and for the PDF view the `fb-doc` Script
(`scripts/fb-doc.js`) and the `fb-doc-fonts` Style
(`scripts/fb-doc-fonts.css`). Deploy fb-styles, then fb-lib, then fb-doc and
fb-doc-fonts, then the reports. Customer Price List also needs the
`fb-pricing` Script (`scripts/fb-pricing.js`) saved on the server; without it
the page shows each product's own price, marked LIST, under a banner.

## App and PDF views

Each port has an **App / PDF** icon toggle in its header. The exception is
the published `InventoryAvailability.htm`, which is not a faithful port.

- **App** is the interactive report.
- **PDF** lays the same data out as pages, like the standard Jasper report:
  - the original's paper and orientation by default;
  - its title band, either on the first page or on every page, as the
    original does;
  - the column headings repeated on every page;
  - a group carried over a page break, marked "(continued)";
  - the totals;
  - the printed date and "Page X of Y" at the foot of each page.

The bar above the pages changes the paper size (Letter, Legal, A4, A3, A5,
Tabloid, Executive) and the orientation, and **Standard paper** goes back to
the original's. Each user's view and paper are remembered per report, in the
report's own settings (user key `docView`).

**Print** prints those pages in either view. In PDF view the BI Report
module's own Print, Save → PDF and Email print the pages too. Without fb-doc
on the server, a report shows no toggle and prints its plain printout.

The layout is done by `FBDoc.Report` in `scripts/fb-doc.js`. The report hands
it the same rows it prints, so collapsed groups and hidden columns carry
over. Column widths come from the content:

1. Each column's natural and narrowest widths are measured. Numbers never
   wrap.
2. Spare width goes to the text columns.
3. When the page is too narrow, the widest text columns wrap first, so part
   numbers and names stay on one line.
4. If that is still too wide, the font steps down from the original's size,
   as far as 6.5pt.

Reports with other layouts use the engine's extensions (see the REPORT
section of `fb-doc.js`):

| Report | Extension used |
|---|---|
| Export Summary | One section per subreport (SO, PO, WO) |
| Consumption | Detail and Summary sections |
| Customer Address List | The label sheet, laid out as rows of three cards |
| Cycle Count List | A fixed-width blank Count column, and a page break per location group or location |
| WO Forecast | A new page for each WO |
| Item History | Three heading levels, and no page footer, as in the original |

Desk-tested 2026-10-10 in Chrome, on every port, with fixtures large enough
to run over several pages:

- no overflowing sheet;
- no clipped cell;
- the print window shows as many pages as the screen;
- a real PDF's page count and paper match.

The PDF view has **not yet been tried in the Fishbowl client**, including
what its toolbar's Save → PDF and Email produce from it.

The engine was promoted from the Paperwork proof of concept
(`Other_NOT_FOR_PRODUCTION/Paperwork_POC`, which still has its own copy).

### Accounting

| Port | Original | Notes |
|---|---|---|
| [Accounting/AdjustmentReport.htm](Accounting/AdjustmentReport.htm) | `Accounting/AdjustmentReport.jrxml` | Inventory adjustment postings (`post` typeId 50): Add Initial, Scrap, Cycle Count, Cost Change. List view (the original) or By type |
| [Accounting/ExportSummary.htm](Accounting/ExportSummary.htm) | `Accounting/ExportSummary.jrxml` + `subSOExport`, `subPOExport`, `subWOExport` | One view per subreport; collapsed orders = Show Details off; Print prints all three like the original |
| [Accounting/COGSByAccountSummary.htm](Accounting/COGSByAccountSummary.htm) | `Accounting/COGSByAccountSummary.jrxml` | Posted COGS per SO line, by the part's COGS account; collapsed accounts = Show Part Details off |

### Inventory

Two of these predate the porting process and moved here on 2026-10-10.
**InventoryAvailability.htm** is the published `- Inventory - Inventory
Availability` report: an extended BI version of the original, with a drill-down
and a projected-availability timeline, in its own chrome. Publishing finds it
by record name, so the move doesn't affect it. Its standalone launcher (`.bat`)
moved with it, but no longer works: the report runs only inside Fishbowl.
**InventoryAvailabilityByLG.htm** replaces a prototype from
`Other_NOT_FOR_PRODUCTION/prototypes/`, which is kept in `archived/`.

| Port | Original | Notes |
|---|---|---|
| [Inventory/AgingReport.htm](Inventory/AgingReport.htm) | `Inventory/AgingReport.jrxml` | Tag sets with their Created date and age in days (the original has no aging buckets and no totals); grouped by location group or part |
| [Inventory/AssetValuationByAccount.htm](Inventory/AssetValuationByAccount.htm) | `Inventory/AssetValuationByAccount.jrxml` | LIFO/FIFO, Std and Average value per part, by asset account. Fixes: run for today, the original used last night's cost snapshot ($1.97M against $1.49M on the live data); past dates now use that night's snapshot, not each part's last capture (which kept sold-out stock) |
| [Inventory/ConsumptionReport.htm](Inventory/ConsumptionReport.htm) | `Inventory/ConsumptionReport.jrxml` | Scraps (`inventorylog` typeId 67), grouped, with the per-part summary as a second view. The original's User column toggle (wired to the Location Group option) is fixed |
| [Inventory/CostingLayerValuation.htm](Inventory/CostingLayerValuation.htm) | `Inventory/CostingLayerValuation.jrxml` | Cost layers per part with Show historical data (org qty / cost). The default account is now matched by one rule for display, filter and order |
| [Inventory/CycleCountList.htm](Inventory/CycleCountList.htm) | `Inventory/CycleCountList.jrxml` + `subSerialList` | The count sheet: Print is Letter portrait with a blank Count column, optional page per location group or location, blind-count mode |
| [Inventory/ForecastReport.htm](Inventory/ForecastReport.htm) | `Inventory/ForecastReport.jrxml` | Running stock per part from On Hand through every open order line. Fixes: one On Hand per part (the original's start depended on which order type came first); over-received PO lines count 0 |
| [Inventory/historicalPartCost.htm](Inventory/historicalPartCost.htm) | `Inventory/historicalPartCost.jrxml` | Part costs from the nightly `partcosthistory` capture of the chosen day. Fixes: Show parts with zero quantity and Show parts created after date did nothing |
| [Inventory/InventoryAvailability.htm](Inventory/InventoryAvailability.htm) | `Inventory/InventoryAvailability.jrxml` | Published report, moved here (see above). Not a faithful port |
| [Inventory/InventoryAvailabilityByLG.htm](Inventory/InventoryAvailabilityByLG.htm) | `Inventory/InventoryAvailabilityByLG.jrxml` | On hand, allocated, not available, drop ship, available, on order, committed and short per part per location group, from the original's six qty views (fast enough to keep) |
| [Inventory/InventoryValuationSummary.htm](Inventory/InventoryValuationSummary.htm) | `Inventory/InventoryValuationSummary.jrxml` | Tag qty × today's average or standard cost, by location group or part; grand total identical to the original on the live data |
| [Inventory/InventoryVariance.htm](Inventory/InventoryVariance.htm) | `Inventory/InventoryVariance.jrxml` | A movement history per part with Beginning and Ending Qty (not a count-vs-expected report). With several location groups, Beginning/Ending add each group's figure (the original read one row across all of them) |
| [Inventory/ItemHistory.htm](Inventory/ItemHistory.htm) | `Inventory/ItemHistory.jrxml` | Per part and location group: start/end qty, purchase, sales and adjustment history. Fixes: the original repeated each part k×k times with k location groups; date edges made consistent |
| [Inventory/LotHistory.htm](Inventory/LotHistory.htm) | `Inventory/LotHistory.jrxml` + `subLotHistory` | Every event of a lot, then the history of the finished-good lots it was made into. Needs a lot or part number before it searches (the original's lot test takes ~10 s on the live data) |
| [Inventory/OnHand.htm](Inventory/OnHand.htm) | `Inventory/OnHand.jrxml` + `subSerialList` | Tags per part, location and tracking, with serial numbers and three custom-field columns |
| [Inventory/OnHandByDate.htm](Inventory/OnHandByDate.htm) | `Inventory/OnHandByDate.jrxml` | On hand per location group at the end of a chosen day, valued at today's cost. Fix: totals now follow the zero-quantity option (with "only zero" the original's Report Total was all stock) |
| [Inventory/OnHandByExpirationDate.htm](Inventory/OnHandByExpirationDate.htm) | `Inventory/OnHandByExpirationDate.jrxml` | Lots by expiration date with Valid / Expiring / Expired status |
| [Inventory/OnHandByProductTree.htm](Inventory/OnHandByProductTree.htm) | `Inventory/OnHandByProductTree.jrxml` | On hand per product under its product-tree category; a picked category includes its sub-categories, as in Fishbowl |
| [Inventory/ReorderReport.htm](Inventory/ReorderReport.htm) | `Inventory/ReorderReport.jrxml` | Parts at or below their reorder point with the quantity needed; company-wide or by location group, per the `locationGroupReordering` property |
| [Inventory/ReverseLotHistory.htm](Inventory/ReverseLotHistory.htm) | `Inventory/ReverseLotHistory.jrxml` | A lot's events newest first, with each work order's raw goods underneath |
| [Inventory/TurnoverReport.htm](Inventory/TurnoverReport.htm) | `Inventory/TurnoverReport.jrxml` | Units sold, average on hand, TO rate and days per part per location group, with the original's group and company totals |
| [Inventory/WOForecastReport.htm](Inventory/WOForecastReport.htm) | `Inventory/WOForecastReport.jrxml` + `subForecastReport` | For each open WO, the running stock of every part on it. Same on-hand fix as the Forecast Report (the original's running total jumped between order types) |

### Customer

| Port | Original | Notes |
|---|---|---|
| [Customer/CustomerAddressList.htm](Customer/CustomerAddressList.htm) | `Customer/CustomerAddressList.jrxml` + `subCustAdsList` | Address cards (the original's label sheet) or a table, optionally under customer-group headings. Contacts come from the customer's account, as in the original, not from the address. With groups off an address is listed once (the original repeated it per group) |
| [Customer/CustomerDetailList.htm](Customer/CustomerDetailList.htm) | `Customer/CustomerDetailList.jrxml` + job subreport | Customers → addresses → contacts, with jobs nested under their parent as "Parent:Job". Each job is listed once (the original printed a job's jobs a second time, and jobs of a filtered-out parent with no parent) |
| [Customer/CustomerPriceList.htm](Customer/CustomerPriceList.htm) | `Customer/CustomerPriceList.jrxml` (`JRCustomerPriceListDataSource`) | Price = the customer's price at qty 1 after pricing rules, Org. Price = the list price, both from FBPricing (the data source asks PricingManager for `getPrice` / `getListPrice`). Grouped by product tree or flat |
| [Customer/CustomerStatement.htm](Customer/CustomerStatement.htm) | `Customer/CustomerStatement.jrxml` | Customer → order → payment, with Date Due from the original's net-days CASE. Runs on databases without `paymentterms.daysAfterEom`, where the original fails |
| [Customer/DormantCustomers.htm](Customer/DormantCustomers.htm) | `Customer/DormantCustomers.jrxml` | Customers whose last SO falls between the dormant period and the last-order limit. The original could show a voided SO as the last one (fixed). It also fails under `ONLY_FULL_GROUP_BY`, which Fishbowl's own connection switches off; the port runs either way |

## Table tools, large results and views

Every port also has the shared fb-lib tools (2026-10-12):

- **Column tools (`FBLib.RptCols`).** Drag a heading's edge to resize it;
  double-click the edge to reset the widths. Click a heading to sort:
  ascending, descending, then the report's own order. Rows sort within their
  group. Drag a heading onto another to move the column. Each user's layout is
  remembered, and **Settings → Reset column layout** undoes it.
  - Group and total rows stay aligned whatever the column order.
  - Columns whose order carries meaning don't sort: running totals, blank
    Count columns, stacked tracking values. The report sorts its groups
    instead where that makes sense, for example the Forecasts sort parts, not
    their lines.
- **Large results (`FBLib.RowCap`).** Queries run async and tables paint in
  chunks as you scroll. The main query fetches at most 10,000 rows. A notice
  says when more matched and offers **Load all**. Any filter change brings the
  cap back.
  - Where a plain cut would corrupt a figure, the cap falls on a boundary
    instead: whole groups, parts, orders, customers or locations. COGS by
    Account still totals every line.
  - Lot and Reverse Lot History keep their search-first, 20,000-event guard.
    It now has Load all.
- **Views (`FBLib.Pivot`).** Where a pivot suits the data, a **Table / Pivot**
  selector (or a Pivot option in the report's existing view selector) shows a
  pivot:
  - any measure by any one or two fields, against any other field;
  - totals and drill-down;
  - PDF, Print and Excel follow the view on screen.

Each report was assessed for alternative views and a pivot:

| Report | Large-result handling | Pivot | Other views |
|---|---|---|---|
| Adjustment Report | 10,000 adjustments | Type × Date Created | List / By type (existing) |
| Export Summary | Whole orders, per section | Section × Status | Recommended: a "waiting for export" list |
| COGS by Account | Lines capped; account totals always complete | Account × Date Fulfilled | Recommended: by customer |
| Customer Address List | 10,000 rows | Address count by State × Type | Cards / Table (existing) |
| Customer Detail List | First 2,500 whole customers | None (a directory with no figures) | Recommended: a flat contacts list |
| Customer Price List | 10,000 lines | Product count by price basis (which rule priced it) | Recommended: compare two customers |
| Customer Statement | Whole customers | Customer × days overdue (an aged-balance view) | Recommended: payments by type and month |
| Dormant Customers | 10,000 customers, in the chosen sort | Sales Rep × Last Ordered | Recommended: by customer group |
| Consumption | 10,000 scraps | Part × month | Detail / Summary (existing) |
| Aging | Whole groups | Part × age band | Recommended: aged value |
| Turnover | Whole groups | Part × Location Group (TO rate) | **Ranking** (per location group or company-wide) and **Monthly trend** (up to 24 months) |
| Inventory Variance | Whole parts | Part × event type | **Unexplained** column (+ "only parts with an unexplained difference") |
| Asset Valuation by Account | 10,000 parts | None (one dimension) | Recommended: a cost-variance view, and two dates compared |
| Costing Layer Valuation | 10,000 layers | Value by month created × account | Recommended: parts sorted by their total |
| Historical Part Cost | 10,000 parts | Total cost by vendor | Recommended: ABC class, and two dates compared |
| Cycle Count List | Whole locations | None (a count sheet) | Recommended: a count-entry view |
| Reorder | 10,000 parts, never cut mid-part | Parts by vendor | **By vendor** (done: one PO per vendor) |
| Availability by LG | 10,000 rows | Available by Part × Location Group | **Short lines only** option |
| Forecast | Whole parts | Location Group + Part × month | **Only parts that run short** option |
| WO Forecast | Whole WOs | None (lines repeat per WO) | Recommended: a by-part grouping |
| Item History | All four queries, complete parts only | Part × history | **Reconciliation** view (+ "only parts with a gap") |
| Lot History / Reverse | 20,000 guard + Load all | Part + Lot × type / level | **Multi-level trace** (1–10 levels, default 5) both ways; **Recall contacts** view (Lot History) |
| On Hand | 10,000 lines | Part × Location Group | **Group by** Location group / Part / Location |
| On Hand by Date | 10,000 lines (zero-quantity filter moved into the SQL) | Part × Location Group | **Compare with** a second date → **Comparison** view |
| On Hand by Expiration | 10,000 lots | Part × expiry month | Recommended: soonest-first list |
| On Hand by Product Tree | 10,000 lines | Category + Product × Location Group | Recommended: top-level category roll-up |
| Inventory Valuation Summary | 10,000 lines | Location Group × Account (value) | — |

## Why Adjustment and Consumption stay separate

They overlap on scrap only. Every scrap is one `inventorylog` row (typeId 67)
and one `post` row (typeId 50, refItemId 2), linked 1:1 through
`inventorylog.recordId` / tableId -1407594912. That held for all 11,957 scraps
on the live database checked on 2026-10-09, and the amounts agreed to the cent
on all but 29 rows (rounding: $2,938,056.05 against $2,938,064.64 in total).

Beyond that they diverge in purpose and in almost every rule:

| | Adjustment Report | Consumption Report |
|---|---|---|
| Question | What adjustments went, or are waiting to go, to accounting? | What was scrapped, where, by whom, for which job? |
| Source | `post` (accounting postings) | `inventorylog` (stock movements) |
| Rows | Add Initial, Scrap, Cycle Count, Cost Change. Add Initial and Cost Change have no inventory log row, so no location or user | Scrap only |
| Amount | `post.amount` | `inventorylog.cost` × qty |
| Sign | Scrap negative | Scrap positive ("consumed") |
| Date | The adjustment's date (`post.dateCreated` = the back/post date) | Date Recorded or Back/Post Date, user's choice (they differ on 662 back-dated scraps) |
| Filters | Type, part, posted / not posted | Location groups (restricted to the user's own), location, user, customer/job, part, active/inactive |
| Layout | Flat list, one total | Grouped with subtotals, plus a per-part summary, with switchable columns |

A merged report would need a mode switch that changed the source, the sign,
the date, the filters and the layout at once: two reports behind one button.
So they stay separate, and each one's Help names the other. The Consumption
report's totals match the Adjustment report's Scrap rows when it filters on
**Back/Post Date** with inactive parts and all location groups included.

## Testing status

Desk-tested 2026-10-09 (Accounting, Customer) and 2026-10-10 (Inventory):
every query ran against the live Fishbowl database
through the iReport MCP SQL validator, and each page was rendered in Chrome
with fb-lib and fb-styles expanded and `runQuery` answered from real rows.
Totals were checked by hand, and Excel export and Print were exercised.
**Not yet run inside the Fishbowl client.**

Gaps in the test data, for the Customer ports:

- The live database has no customer jobs, so Detail List's job tree and
  Address List's "Parent:" names ran on made-up rows only. Whether
  `openModule('Customer', 'Parent:Job')` opens a job is unconfirmed.
- It has no payments, so Statement's payment rows and paid totals ran on
  made-up rows only.
- Price List was checked against hand-worked prices for three customers.
  Only fixed-price and percent rules were exercised: no active rule there
  uses rounding, a price floor, a cost basis, quantity breaks or another
  currency.

Gaps in the test data, for the Inventory ports:

- No serial numbers exist, so On Hand's and Cycle Count List's serial rows
  ran on made-up rows only.
- Every reorder point is company-wide, so Reorder's by-location-group mode
  ran on made-up levels only. No part has an asset account, so the
  by-account groupings ran on made-up accounts.
- No open WO has any quantity used yet, so WO Forecast's partly consumed case
  is untested.

Things learnt on the live database that the ports rely on:

- Fishbowl's own JDBC sessions set `sql_mode` without `ONLY_FULL_GROUP_BY`
  (`DbConfig` in `lib/util-26.9.1.jar`), though the server's global mode has
  it. Originals that use `tagtrackingview` (On Hand, Cycle Count, Aging,
  Expiration, Product Tree) only fail on a connection that keeps the global
  mode. The ports avoid the view, so they run either way.
- `inventorylog` type 40 rows are location moves here (transfer receipts,
  picks), not only WO yields; some change a location group's on-hand. The
  ports keep each original's type 40 handling.
- `partcosthistory` is a nightly snapshot of parts with stock (no zero-qty
  rows), so "latest capture per part" brings back parts that sold out.
- A date parameter described as "end" covers the whole chosen day. The ports
  write it as `< next day 00:00`, since event dates keep fractions of a
  second.
