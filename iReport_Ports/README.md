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
differs from the original. **[DIFFERENCES.md](DIFFERENCES.md)** collects
every one of those deviations in one register (fix, addition, omission,
layout, performance or data), with its evidence, how to verify it, and a
Reviewed column for sign-off in the Fishbowl client. Each carries the stock report's display name as
`FB_REPORT.name` and its folder (the folder of its original), and deploys to
the local Fishbowl server; none is on SharePoint yet.

**Module association.** Only the paperwork documents carry an `fb-launch`
tag, which lists them in that module's Apps menu (with report_btn): Sales
Order Report and Sales Invoice (SO), Purchase Order Report (PO), Pick Ticket
(PICK), Packing Slip and Shipping Invoice (SHIP), Work Order Traveler (WO) and
Manufacture Order Traveler (MO). Every other port has none (decided
2026-10-16) and is opened from BI Reports or the App Library. Ports that
understand a launch (`window.FB_LAUNCH`) keep that code, so it works if a
module is added later. They need the current fb-lib (`FBLib.Common.togglePanel`) and
fb-styles (§35), and for the PDF view the `fb-doc` Script
(`scripts/fb-doc.js`) and the `fb-doc-fonts` Style
(`scripts/fb-doc-fonts.css`). Deploy fb-styles, then fb-lib, then fb-doc and
fb-doc-fonts, then the reports. Customer Price List also needs the
`fb-pricing` Script (`scripts/fb-pricing.js`) saved on the server; without it
the page shows each product's own price, marked LIST, under a banner.

## App and PDF views

Each port has an **App / PDF** icon toggle in its header. So do the older BI
reports that moved into the tree without being faithful ports:
`AvailableToBuild.htm` (2026-10-13), `PartActivity.htm` and
`InventoryAvailability.htm` (2026-10-14), and the first BI versions of
stock reports, the summaries: `PurchaseOrderSummary.htm`,
`receivingsummary.htm` and `SalesOrderSummary.htm` (moved from
`Custom/SalesOrder/` on 2026-10-20). Their PDF view lays the data they
already show out like the stock report.

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

## Company defaults: paper and filters (2026-10-15)

So business paperwork comes out the same for everyone:
- **Paper for all reports.** One paper **size** for every report, while each report
  keeps its own orientation (portrait, or landscape where the original is).
  - **Until an admin sets one,** the size follows the Fishbowl edition (`QBVersion`):
    Letter for US and Canada, A4 for every other edition.
  - **Setting it:** admin only, with **Use A4 for all reports** (or whichever size is on
    show) in any report's PDF-view paper bar. The Paperwork POC documents have the
    button in their Settings drawer.
  - It is the SharedData key `cdx.bi.paper.v1` = `{ size }`, read by `FBDoc.paper.all()`
    in `scripts/fb-doc.js`.
  - **It is the bottom layer.** A user's own choice, a report's company paper and a
    POC document's Page_setup (when changed from its A4 default) all win over it.
- **Company paper.**
  - **Who sets it:** admin, or a user whose group has **Edit Settings** on the
    report. In the PDF view's paper bar they press **Use for everyone**; **Stop using
    company paper** clears it.
  - **Who gets it:** every user who hasn't picked a paper of their own, and the
    documents a module prints or emails through Print (App) / Email (rich), which
    always use it.
  - **Users can still choose their own paper.** The bar then offers **Company paper**
    to go back to it.
  - It is the report's FBLib.Settings master key `docPaper`, handled by
    `FBDoc.Report.view`.
- **Company filters.**
  - **Who sets them:** the same people, with **Use these filters for everyone** in
    the Settings drawer.
  - **What it does:** every open starts from them. Anyone can still change the
    filters while the report is open, but nothing they change carries over.
  - **Stop using them** clears them, and users go back to their own last choices.
- **How a port opts in:** `FBLib.Settings.init({ masterStorage: 'userProperties',
  company: { keys: ['filters', 'opts'], editors: true }, … })`.
  - `keys` are the settings whose company value wins.
  - `editors` trusts the report's Edit Settings users, read from `bireportaccess`, so
    nobody else's settings row is believed.
- **Saved-views ports** (Part Activity, the two Summaries) pass
  `editors: true, companyFirst: true` to `FBLib.FilterViews.attach`, so the company
  default view opens even for users who starred their own.
- **The test:** `tools/fb-lib-tests/company-settings.test.js`.

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
| MO Traveler | The MO header boxes ride in the table heading so they repeat on every MO page; each WO is one unsplittable block; each WO traveler starts a new page. Code 128 barcode from `FBDoc.code128` |
| MO Projected Cost | Header boxes, barcode and note on the first page; WO and item-type rows carried over a break |
| Production Demand | A WO's raw goods carried over a break with their headings; the two short summaries side by side as one table |
| Available To Build | Four heading levels (location group, BOM, item type), a full-width note row per BOM, and staged sub-assemblies' lines nested under them |
| Pick Ticket | Every-page title band with the logo, page 1 header block, barcode and Orders list, kit headings carried over a break |
| Part Allocated / Committed | The four order-type lists side by side under each part, as the stock subreports |
| Product Catalog V2 | Cover, a table of contents whose page numbers are read back from the laid-out pages, card pages four across per category, a two-column order sheet |
| Part Cost Over Time | One page per part with its cost chart as a flow block |

Desk-tested 2026-10-10 in Chrome, on every port, with fixtures large enough
to run over several pages:

- no overflowing sheet;
- no clipped cell;
- the print window shows as many pages as the screen;
- a real PDF's page count and paper match.

The PDF view has **not yet been tried in the Fishbowl client**, including
what its toolbar's Save → PDF and Email produce from it.

The engine was promoted from the Paperwork proof of concept (archived
2026-10-15 in `archived/Other_NOT_FOR_PRODUCTION/Paperwork_POC/`; its documents
are now ports and use this shared copy).

### Accounting

| Port | Original | Notes |
|---|---|---|
| [Accounting/AdjustmentReport.htm](Accounting/AdjustmentReport.htm) | `Accounting/AdjustmentReport.jrxml` | Inventory adjustment postings (`post` typeId 50): Add Initial, Scrap, Cycle Count, Cost Change. List view (the original) or By type |
| [Accounting/ExportSummary.htm](Accounting/ExportSummary.htm) | `Accounting/ExportSummary.jrxml` + `subSOExport`, `subPOExport`, `subWOExport` | One view per subreport; collapsed orders = Show Details off; Print prints all three like the original |
| [Accounting/COGSByAccountSummary.htm](Accounting/COGSByAccountSummary.htm) | `Accounting/COGSByAccountSummary.jrxml` | Posted COGS per SO line, by the part's COGS account; collapsed accounts = Show Part Details off |
| [Accounting/DefaultAccountMapping.htm](Accounting/DefaultAccountMapping.htm) | `Accounting/DefaultAccountMapping.jrxml` | Fishbowl's default accounts (`sysproperties` "Acct ID …") and the account each posts to; Fishbowl's camel-case labels reproduced in JS. Options: Account contains, Show defaults with no account, Show account number and type. No RowCap (one row per default, 24 live), no Pivot (no measure), no links (no chart-of-accounts module) |

### Inventory

Two of these predate the porting process and moved here on 2026-10-10.
**InventoryAvailability.htm** is the published Inventory Availability
report: an extended BI version of the original, with a drill-down
and a projected-availability timeline, in its own chrome. Publishing finds it
by record name, so the move doesn't affect it. Its standalone launcher (`.bat`)
moved with it, but no longer works: the report runs only inside Fishbowl.
**InventoryAvailabilityByLG.htm** replaces a prototype from
`Other_NOT_FOR_PRODUCTION/prototypes/`, which is kept in `archived/`.

| Port | Original | Notes |
|---|---|---|
| [Inventory/AgingReport.htm](Inventory/AgingReport.htm) | `Inventory/AgingReport.jrxml` | Tag sets with their Created date and age in days (the original has no aging buckets and no totals); grouped by location group or part |
| [Inventory/AssetValuationByAccount.htm](Inventory/AssetValuationByAccount.htm) | `Inventory/AssetValuationByAccount.jrxml` | LIFO/FIFO, Std and Average value per part, by asset account. Fixes: a run for today read the cost history instead of today's costs; a past date now uses that night's snapshot, not each part's last capture, which kept sold-out stock ($1,962,993 against $1,517,119 Average Cost, 2026-05-20 live) |
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

### Manufacture Order

Ported 2026-10-13, all filed in the Manufacture Order folder. The two record
documents (Traveler, Projected Cost) have an MO picker with typeahead;
launched for an MO (the Traveler is listed in the MO module's Apps menu) they
load that MO and lock it (no picker, no prev / next), as the paperwork reports
do.

**AvailableToBuild.htm** predates the porting process and moved here from
`Manufacturing/` on 2026-10-13: an extended rebuild of the original (UOM
conversion the stock report lacks, staged BOMs, On Order, Ready By, build
cost), in its own chrome. It is not a faithful port. Its PDF view (added
2026-10-13) lays the pages out like the stock report:
- each location group, then each BOM with its Available to Build and a note
  line carrying the App table's other figures;
- the BOM's lines under their item type, with Qty per BOM in the BOM's unit,
  the builds each component supports (the limiting one bold) and Available
  for Sale in the part's unit;
- staged sub-assemblies' lines nested underneath.

There is no System Demand column, since the report doesn't compute reorder
demand. Settings › PDF view can leave the components out.

| Port | Original | Notes |
|---|---|---|
| [ManufactureOrder/AvailableToBuild.htm](ManufactureOrder/AvailableToBuild.htm) | `ManufactureOrder/AvailableToBuild.jrxml` + `subAvailableToBuild` | Moved here (see above). Not a faithful port |
| [ManufactureOrder/MOProjectedCost.htm](ManufactureOrder/MOProjectedCost.htm) | `ManufactureOrder/MOProjectedCost.jrxml` + `Common/subOrderProjectedCost`, `Common/subEnteredOrderProjectedCost`, `subTravelerSODetails` | One MO's cost by work order: open WOs at the costing method (the `Acct Costing Method` sysproperty: Average, Standard, FIFO, else LIFO, with the original's formulas), fulfilled WOs at actual cost. Fixes: the MO total on a Partial MO is the sum of the WO totals shown (the original priced it all by the MO's status); a UOM with no direct conversion uses the inverse row, else the line is flagged "not costed" (the original assumed 1:1); Location prints "Group - Location" (the original's `\|\|` printed 0) |
| [ManufactureOrder/MOStage.htm](ManufactureOrder/MOStage.htm) | `ManufactureOrder/MOStage.jrxml` | Each MO's build stages with their WOs, stage level, quantity and WO status. Picking (30) and Working (40) are not offered as MO statuses: no MO status has those ids |
| [ManufactureOrder/MOTraveler.htm](ManufactureOrder/MOTraveler.htm) | `ManufactureOrder/MOTraveler.jrxml` + `Batch/ByOrder/WOTravelerByOrder` | The MO traveler with its WO blocks, finished goods and tracking write-ins (recorded values once fulfilled), and optionally every WO's own traveler, each on a new page. Fix: the MO is fetched exactly (the original matched `mo.num LIKE`, so its default `%` printed an arbitrary MO) |
| [ManufactureOrder/ProductionDemand.htm](ManufactureOrder/ProductionDemand.htm) | `ManufactureOrder/ProductionDemand.jrxml` | Open WOs whose finished good is short on hand, by location group and need type, with raw goods and the Raw / Finished Goods Short summaries. Fix: raw-goods quantities converted to the part's UOM (the original listed 12 raw parts short that aren't on the live data). Query 3.6 s → 0.1 s with the same rows |
| [ManufactureOrder/ProductionReport.htm](ManufactureOrder/ProductionReport.htm) | `ManufactureOrder/ProductionReport.jrxml` | Parts built by fulfilled WOs in a date range, per part with its total. Fix: a line with no UOM conversion stays out of the part total and is flagged (the original assumed 1:1; one part on the live data) |

### Part

Ported 2026-10-13/14. **PartActivity.htm** predates the porting process and
moved here from `Part/` on 2026-10-13 (same Fishbowl record, "Part
Activity"). The stock folder has two reports with that name, Part Activity
Report and Part Activity Export; per the user's rule ("where report names are
the same, opt for the Export version and do not duplicate both") this one
report stands for both, and its PDF view follows **Part Activity Export**:
the Export's columns (mapped onto the report's Columns switches), its Group by
and Order by, on Letter landscape (the Export's page is spreadsheet-width).
`subSOPart.jrxml` is used by no stock report and is not ported.

| Port | Original | Notes |
|---|---|---|
| [Part/ABCReport.htm](Part/ABCReport.htm) | `Part/ABCReport.jrxml` | Active parts ranked by sales and / or WO usage in a date range; projected A / B / C at the original's fixed 80 % / 95 % running totals. Matches the original live (448/448 parts, same codes); 0.6 s against 7.8 s |
| [Part/PartAccounts.htm](Part/PartAccounts.htm) | `Part/PartAccounts.jrxml` | Parts and their default accounts. Additions: part type / active / account filters (the original has none), Group by account |
| [Part/PartActivity.htm](Part/PartActivity.htm) | `Part/PartActivityReport.jrxml`, `PartActivityExport.jrxml` | Moved here (see above). Not a faithful port; PDF view in the Export's layout |
| [Part/PartAllocated.htm](Part/PartAllocated.htm) | `Part/PartAllocated.jrxml` + `subSO/WO/PO/TOAllocated` | Open order quantities per part by order type. Lists every part (the original one); exact part match; the PO total is a real sum (the original printed the last PO's qty). 489/489 orders identical live |
| [Part/PartAverageCost.htm](Part/PartAverageCost.htm) | `Part/PartAverageCost.jrxml` | Average cost and costed qty per active part, plus an Avg vs Std view |
| [Part/PartCommittedReport.htm](Part/PartCommittedReport.htm) | `Part/PartCommittedReport.jrxml` + `subSO/WO/PO/TOCommitted` | Committed stock per part by order, with tracking. Each stock source summed per line before joining (the original double-counts a line with several picks); totals add each order once. 82/82 orders identical live; per-part totals equal Fishbowl's committed figure |
| [Part/PartCostOverTime.htm](Part/PartCostOverTime.htm) | `Part/PartCostOverTime.jrxml` | Std / first / last / low / high / average cost per part, with a cost-layer chart per part (the original drew every matching part on every chart). Rewritten as per-part sub-queries: the original's plan is estimated at 4.8 billion rows |
| [Part/PartList.htm](Part/PartList.htm) | `Part/PartList.jrxml` | Parts with optional description, on hand and cost at the chosen method. Matches live (448 / 1,066 parts) |
| [Part/ReorderPoints.htm](Part/ReorderPoints.htm) | `Part/ReorderPoints.jrxml` | Reorder point / order-up-to per part, company wide or by location group; levels the `locationGroupReordering` mode doesn't use are marked "not in use". A part with no level shows a blank group (the original labelled it "Company Wide") |

### Product

Ported 2026-10-14. `Custom/Product/KitAvailability.htm` (outside this tree) rebuilds
a Custom report, not the stock Kit Report. **Product Catalog** and **Product
Catalog V2** are one port on V2 with every V1 option folded in (the
same-name rule): V2's catalog, contents and order sheet, plus V1's list layout,
its three barcode switches and SKU / UPC text, and "every part type".

| Port | Original | Notes |
|---|---|---|
| [Product/KitReport.htm](Product/KitReport.htm) | `Product/KitReport.jrxml` | Kits with their lines and choices (default starred), cost per line and per kit at the chosen method. Fix: the kit total is the sum of the printed lines (the original re-added a line's product cost for every non-default choice: Test Kit 84.08 → 53.53); choices costed through their own part's UOM |
| [Product/ProductCatalogV2.htm](Product/ProductCatalogV2.htm) | `Product/ProductCatalogV2.jrxml` + `Other/subProductCatalog*`, `subOrderSheet`; `ProductCatalog.jrxml` | Catalog cards / table / order sheet. Pictures are the product thumbnails (`image` table, as the originals' `getImageData`); the ireport DB has none (option: use the part's picture). UPC prints as real UPC-A / EAN-13; contents page numbers come from the laid-out pages. Identical to V2's query live (89 rows) |
| [Product/ProductPriceList.htm](Product/ProductPriceList.htm) | `Product/ProductPriceList.jrxml` | Products at their own price (no pricing rules), by product tree category. A picked category brings its sub-categories, as Fishbowl's dialog. Fix: blank UPC / SKU products are no longer dropped by the default search |

### Picking

Ported 2026-10-13/14. **PickTicket.htm** merges the stock Pick Ticket, Pick
Report and Pick Report (special characters, SO custom fields) into one Pick
Ticket, keeping every feature of each. The stock ticket lists only Started
(and optionally Committed) items, so an Entered pick printed an empty ticket
(54 of the 73 Entered picks on the live data). **Show items** has three modes:
- *All items* (the default, the user's choice 2026-10-14): exactly the stock
  Pick Report's items (333/333 picks identical locally), so a finished pick
  still lists its lines;
- *Still to pick*: every item not Finished, with a Status column;
- *Ready to pick*: exactly the stock Pick Ticket's items (333/333).

Items not yet allocated (Entered, Short, Hold) show **suggested locations**:
where the part has available stock in the pick's location group (on hand,
less what is committed, less what Started items already hold there), the
default location first, up to three, in italics. With none available the
Location stays empty. They are suggestions; Fishbowl
assigns the real location when the pick is started. The SO and SO-item custom
fields of the Pick Report variant are options. It replaced the Paperwork POC's
Pick Ticket (archived) in the local Fishbowl `Pick Ticket` record.

| Port | Original | Notes |
|---|---|---|
| [Picking/PickEfficiency.htm](Picking/PickEfficiency.htm) | `Picking/PickEfficiency.jrxml` | Whole minutes from start to finish per finished pick, per user with count and average. Fixes: one group per user (the original's restarted at every change of user: 182 blocks for 17 users in a month); a finished pick with no start time no longer stops the report |
| [Picking/PickTicket.htm](Picking/PickTicket.htm) | `Picking/PickTicket.jrxml`, `PickReport.jrxml`, `PickReportSpecialCharactersWithSOCustomFieldTab.jrxml` + `subPickingOrders` | See above |

### Purchase Order

**POReport.htm** replaced (2026-10-15) the Paperwork POC's
Purchase Order Report (archived) in the local Fishbowl `Purchase Order Report`
record #130. **PurchaseOrderSummary.htm** predates the porting process (an
extended BI report, not a faithful port) and moved into the tree; it stands for both Purchase Order Summary and Purchase Order Summary Export, with the Export's layout one press away (Columns › Export layout).

| Port | Original | Notes |
|---|---|---|
| [PurchaseOrder/POReport.htm](PurchaseOrder/POReport.htm) | `PurchaseOrder/POReport.jrxml` + `Common/subMemo` | One PO as the vendor document. Fixes: vendor-currency figures from the stored `mc*` costs, a home-currency PO uses rate 1, blank address lines left out, a PO without lines still prints |
| [PurchaseOrder/AutoPO.htm](PurchaseOrder/AutoPO.htm) | `PurchaseOrder/AutoPO.jrxml` (`JRAutoPOHelper`) | Rows from Fishbowl's own Auto PO engine through `getAutoPo()`, as the stock's helper; dates sent as `"YYYY-MM-DD HH:MM:SS"`; the "only default vendor parts" option filtered in the page |
| [PurchaseOrder/AdvancedPurchasingBySoReport.htm](PurchaseOrder/AdvancedPurchasingBySoReport.htm) | `PurchaseOrder/AdvancedPurchasingBySoReport.jrxml` | What each SO still needs against stock at its location group, and when to order. Fixes: Qty Needed is what is left, converted to the part's UOM; closed lines and credit returns need nothing |
| [PurchaseOrder/AdvancedPurchasingByWoReport.htm](PurchaseOrder/AdvancedPurchasingByWoReport.htm) | `PurchaseOrder/AdvancedPurchasingByWoReport.jrxml` | The same per work order. Fixes as the SO version (finished WOs / MOs and repair outputs need nothing) |
| [PurchaseOrder/PurchaseOrderSummary.htm](PurchaseOrder/PurchaseOrderSummary.htm) | `PurchaseOrder/PurchaseOrderSummary.jrxml`, `PurchaseOrderSummaryExport.jrxml` (extended) | PO line activity in flat, by-PO, by-vendor, by-part and pivot views; stands for both stock reports (same-name rule). Columns › Export layout lays it out as the Export (its 27 columns in its order, Flat, PO # ascending), off by default |
| [PurchaseOrder/POBarcode.htm](PurchaseOrder/POBarcode.htm) | `PurchaseOrder/POBarcode.jrxml` | POs of one status (Bid Request / Issued / Partial) with the PO number and every line's part number as Code 128 barcodes ("P" + number when Barcodes have DI), to receive against. Rows identical to the stock query live (18 / 24 / 44 lines for statuses 10 / 20 / 40); ordered by PO then line so a PO never prints twice; limited to the user's location groups |

### Receiving

**receivingsummary.htm** predates the porting process (an
extended BI report) and moved into the tree.

| Port | Original | Notes |
|---|---|---|
| [Receiving/ReceivingList.htm](Receiving/ReceivingList.htm) | `Receiving/ReceivingList.jrxml` | One receipt's list of parts to receive (record document with a receipt picker). Fixes: one line per receipt line (the stock repeated a line per extra vendor part number / default location) |
| [Receiving/ReceivingHistory.htm](Receiving/ReceivingHistory.htm) | `Receiving/ReceivingHistory.jrxml` | Every receipt line in a date range. Fixes: customer (SO / RMA) lines group by the chosen field as vendor lines do; the end day counts in full |
| [Receiving/ReconcileReport.htm](Receiving/ReconcileReport.htm) | `Receiving/ReconcileReport.jrxml` | Reconciled PO receipt lines: Original vs Billed vs Landed cost, per PO. Fixes: grand totals equal the lines listed; the end day counts in full |
| [Receiving/receivingsummary.htm](Receiving/receivingsummary.htm) | `Receiving/ReceivingSummary` (extended) | Receipt lines across PO, SO and TO in flat, by-receipt and pivot views |

### RMA

| Port | Original | Notes |
|---|---|---|
| [RMA/RMAReport.htm](RMA/RMAReport.htm) | `RMA/RMAReport.jrxml` | One RMA's return ticket (record document with an RMA picker). Header lookups are LEFT joins, so a missing one leaves its field blank |
| [RMA/RMASummary.htm](RMA/RMASummary.htm) | `RMA/RMASummary.jrxml` | RMAs issued in a date range by location group, optionally with their items |

### Transfer Order

| Port | Original | Notes |
|---|---|---|
| [TransferOrder/TOReport.htm](TransferOrder/TOReport.htm) | `TransferOrder/TOReport.jrxml` | One transfer order's document (record document with a TO picker): from / to location groups, addresses, packing details, items. One `xoitem` carries both legs |
| [TransferOrder/TransferOrderSummary.htm](TransferOrder/TransferOrderSummary.htm) | `TransferOrder/TransferOrderSummary.jrxml` | Transfer orders in a date range with ordered, shipped and remaining quantities, by order or by part |

Each section's deviations are in [DIFFERENCES.md](DIFFERENCES.md).

### Sales Order and Ship (paperwork)

The business documents, moved here on 2026-10-15 from the Paperwork proof of
concept (archived). Since 2026-10-16 they use the REPORT chrome like every
other record document: an **App view** (the record on screen, its lines with
table tools, Excel) and a **PDF view** that is the printed document (fb-doc
lays out the proof of concept's own sheets, unchanged: `FBDoc.Report.view`
with `pages`). The record comes from `FBDoc.Record`, the stock report's options
(with its saved presets) from `FBDoc.Options`, the formats from `FBDoc.env`.
They are what report_btn's documents **Print (App)** / **Email (rich)** use as
each module's default document (`FB_LAUNCH.output` → `FB_DOC`); Fishbowl's own
Module Options (`module.reportId`) still take Jasper reports only. Opened from
the module's Apps menu, a document locks to the open record. Tests:
`tools/doc-tests/` (62, against a live database).

| Port | Original | Notes |
|---|---|---|
| [SalesOrder/SOReport.htm](SalesOrder/SOReport.htm) | `SalesOrder/SOReport.jrxml` (+ `SOReportSpecialCharacters`, same-name rule) | The sales order document (#128). The SpecialCharacters copy differs only by its font (SansSerif) and by being an older revision of SOReport; the browser prints non-Latin text with the standard font, so nothing extra is needed |
| [SalesOrder/SOInvoiceReport.htm](SalesOrder/SOInvoiceReport.htm) | `SalesOrder/SOInvoiceReport.jrxml` | SOReport with the Invoice flag on (#129). Must stay identical to SOReport.htm except five lines: `node tools/doc-tests/variant-check.js` |
| [Ship/PackingList.htm](Ship/PackingList.htm) | `Ship/PackingList.jrxml` (+ `PackingListLandscape`, `PackingListLandscapeColorized`, `PackingListColorizedV1` / `V2` / `V3`, same family) | Packing Slip for SO / PO / TO shipments (#132). Filters › Page picks the family member: Page layout Portrait / Landscape (landscape paper, the Landscape layouts' widths, price columns on) and Colours Standard / Colorized V1 (its own header and info block) / V2 (sage) / V3 (navy); Landscape + V1 = PackingListLandscapeColorized. Company defaults make one the standard. Not covered: the By Carton layouts |
| [SalesOrder/SalesOrderSummary.htm](SalesOrder/SalesOrderSummary.htm) | `SalesOrder/SalesOrderSummary.jrxml`, `SalesOrderSummaryExport.jrxml` (extended) | SO line activity in flat, by-SO, by-customer, by-product and pivot views; one of the first BI versions of a stock report (an extended report, not a faithful port), moved here from `Custom/SalesOrder/` on 2026-10-20 (record #65, name and key unchanged); stands for both stock reports (same-name rule). Columns › Export layout lays it out as the Export (its columns in its order with one UOM column, custom-field slots off, Flat, SO # ascending), off by default |
| [Ship/ShippingInvoice.htm](Ship/ShippingInvoice.htm) | `Ship/ShippingInvoice.jrxml` (+ `ShippingInvoiceSpecialCharacters`) | Invoice or pro-forma by ship status, AU / US / CA (#133). The SpecialCharacters copy differs only by its font (SansSerif) and small carton-subreport layout tweaks; non-Latin text prints with the standard font |

### Vendor

Ported 2026-10-15. Each report has its own port: Part Vendor List
and Vendor Part List are mirror images (part → vendors, vendor → parts) and
Vendor Address / Vendor Address List differ in layout and filters, so the
same-name rule doesn't merge them. Launched for a vendor, a report starts on
that vendor (locked in Vendor Part List, a starting filter elsewhere).

| Port | Original | Notes |
|---|---|---|
| [Vendor/PartVendorList.htm](Vendor/PartVendorList.htm) | `Vendor/PartVendorList.jrxml` | Every vendor of a part with vendor part #, last date and cost (`vendorparts.lastDate` / `lastCost`, as the stock). Fix: costs carry the vendor's currency (the stock printed the home symbol: 12 foreign-currency vendor parts live). Optional cost in home currency per part UOM. 536 = 536 rows live |
| [Vendor/VendorPartList.htm](Vendor/VendorPartList.htm) | `Vendor/VendorPartList.jrxml` | Every part a vendor sells, same rules and fixes as Part Vendor List; "%" lists every vendor where the stock printed "You Must Select A Vendor" |
| [Vendor/VendorAddress.htm](Vendor/VendorAddress.htm) | `Vendor/VendorAddress.jrxml` | Every vendor address with the stock's Sort by; optional vendor and address-type columns. Same 94 addresses as the stock live |
| [Vendor/VendorAddressList.htm](Vendor/VendorAddressList.htm) | `Vendor/VendorAddressList.jrxml` + `Customer/subCustAdsList` | Address cards (the label sheet) / table / pivot, as the Customer Address List port. Fixes: no "null" country, no stray ", " for an empty city (11 of 86 cards live). Cards fill across, not down (fb-doc flow blocks) |
| [Vendor/VendorBackOrderReport.htm](Vendor/VendorBackOrderReport.htm) | `Vendor/VendorBackOrderReport.jrxml` | Incoming PO lines past their scheduled date, by vendor / part / PO. 106 = 106 lines live. Fix: the part filter no longer pulls in misc. lines without a part. Optional "leave out lines received in full" and More columns (days late, value…) |
| [Vendor/VendorFulfillmentHistory.htm](Vendor/VendorFulfillmentHistory.htm) | `Vendor/VendorFulfillmentHistory.jrxml` | Per vendor and part: average lead time from PO issue, qty received, last cost, PO count. Fix: each receipt counts once (the stock repeated it per vendor-part record: Apex Coconuts FOOD187 396,320 → 99,080); parts without a vendor-part record are no longer dropped |
| [Vendor/VendorPerformanceReport.htm](Vendor/VendorPerformanceReport.htm) | `Vendor/VendorPerformanceReport.jrxml` | PO receipt lines with scheduled vs received dates and quantities. Fix: "late" is a later calendar day (the stock's 864,000 ms divisor marked 1,071 same-day receipts late). New Scorecard view (on-time % per vendor) |

### Other

The `Other` folder's reports. Calendar Report lists calendar events, work orders, sales orders and purchase orders in a date range. Tracking Detail finds every receipt, pick, shipment, work order, SO or RMA a lot, serial or other tracking value was recorded on. Tracking lists every tracking value per receipt, shipment, WO item, pick and RMA item. Reports (the report list) is not ported.

| Port | Original | Notes |
|---|---|---|
| [Other/CalEvent.htm](Other/CalEvent.htm) | `Other/CalEvent.jrxml` | Calendar events, WOs, SOs and POs in a date range, as the original's four-part UNION ALL with every parameter as a filter (Include*, ck* statuses, CalendarCategory, MO/SO/PO #, cbOrderBy, ShowTime, ShowCategoryColor, col*, ReportTitle). Additions: Calendar view (month grid, category colours, ‹ › months), Pivot, WO/SO/PO links, Excel. Same rows as the stock SQL live (Oct 2026: 23 WO / 5 SO / 6 PO; All dates: 114 / 241 / 114). Fix: a row without a category no longer hits the stock's calcat NPE |
| [Other/TrackingDetail.htm](Other/TrackingDetail.htm) | `Other/TrackingDetail.jrxml` + `Other/subTrackingCustom`, `subTrackingWorkOrderCost` | Every tracking record matching Tracking value, one row per record / serial with "… on PO: / Picked for SO: / Item on WO:" and the order link. The WO block (items, costs, tracking) sits under WO rows as in the stock layout. Same 2,172 rows as the stock rules live. Fixes: serials not printed n×n, number tracking types shown, WO header part / qty always filled, wo.partid. Options: WO details every / once / off, include WO picks (off) |
| [Other/Tracking.htm](Other/Tracking.htm) | `Other/Tracking.jrxml` | Every tracking value per receipt / shipment / WO item / pick / RMA item ("… received for PO:", "… consumed on WO:", "… added to RMA:") with the order link, as the original's five-branch UNION ALL and GROUP BY. Filters: TrackingValue (contains, or exact with SearchForExactValue), partNum / productNum LIKE, Include*, ShowItemDescriptionInHeader, ReportTitle. Count / Skip paging replaced by RowCap + Load all. Same 2,401 rows as the stock SQL live, and identical on 5 filter variants |

### Bill of Materials

The two stock BOM reports, each printing one bill of materials picked like an order (typeahead with Active / Inactive chips, previous / next, launch lock). Bill of Materials rebuilds the server's `JRBomReportHelper` in SQL + JS: staged sub-assemblies nested under their item, costs converted into each line's UOM, Available / Short over the user's location groups.

| Port | Original | Notes |
|---|---|---|
| [BillOfMaterials/BillOfMaterials.htm](BillOfMaterials/BillOfMaterials.htm) | `BillOfMaterials/BillOfMaterials.jrxml` | One BOM's Raw Good / Repair lines. Staged items carry their sub-BOM's build cost, with its lines indented under them. Option-group items appear only when they are the group's default. Costing method Average / Standard / FIFO / LIFO. Available = on hand − allocated − not available + drop ship in the user's location groups. Letter landscape. App view: tree that folds, part links, a "no conversion" flag, sort within each level. Costs match an independent SQL total on 5 BOMs and all four methods |
| [BillOfMaterials/BOMInstructions.htm](BillOfMaterials/BOMInstructions.htm) | `BillOfMaterials/BOMInstructions.jrxml` | One BOM's instruction steps (Order, Name, Description, Details, URL) under the company / title / "BOM Number -" header on every page; Letter portrait. Fix: fetched by id (the stock's default `%` matched nothing). No options, so no company defaults |

### Sales Order

The Sales Order folder's list reports (the paperwork is under Sales Order and Ship (paperwork) above). Ported 2026-10-20. Cost and margin columns need admin or the Sales Order-Cost / Sales Order-Margin rights, as the App Builder gates them.

| Port | Original | Notes |
|---|---|---|
| [SalesOrder/MarginsBySalesOrder.htm](SalesOrder/MarginsBySalesOrder.htm) | `SalesOrder/MarginsBySalesOrder.jrxml` | The jrxml's 3-part UNION (charges & credits / shipped at posted cost / unshipped at average cost) kept as written; every option; SO rows or SO + lines; SO and report totals with its Margin % rule; cost/margin columns gated on Sales Order-Cost / -Margin; Pivot (incl. Margin %), Excel (SOs + lines), RowCap by whole SO, PDF Letter landscape |
| [SalesOrder/SOtoPOMargin.htm](SalesOrder/SOtoPOMargin.htm) | `SalesOrder/SOtoPOMargin.jrxml` | SOs with POs whose Customer SO is the SO number (voids out): sale, each PO's cost, SO total and profit; status / salesperson / SO # / date / sort filters (sort labels honoured, SO kept whole); cost/profit gated on Sales Order-Cost / -Margin; App footer totals, Pivot per SO, Excel (SOs + POs), PDF Letter landscape |
| [SalesOrder/MarginsReport.htm](SalesOrder/MarginsReport.htm) | `SalesOrder/MarginsReport.jrxml` | Group by Product / Product Tree / Customer (the jrxml's 3 tables, ProductInfo + ProductTreeInfo datasets); product + group totals and Grand Totals with weighted margin %; the 8 column switches, include returns/shipping, date / customer / salesperson / LG / SO# / product# / product-tree filters, stock saved options as presets; cost & margin columns gated on Sales Order-Cost / -Margin; Pivot, Excel, PDF (Letter landscape) |
| [SalesOrder/PriceDiscrepancy.htm](SalesOrder/PriceDiscrepancy.htm) | `SalesOrder/PriceDiscrepancy.jrxml` | SO lines priced differently from the product's list price (SO price incl. per-unit adjustment, difference red when negative, $0 kit lines hidden); date / customers / salespeople / SO # filters; Pivot (line difference × qty); Letter landscape PDF; no cost, no gating |
| [SalesOrder/PricingRules.htm](SalesOrder/PricingRules.htm) | `SalesOrder/PricingRules.jrxml` | Every pricing rule in the stock report's sentences: a table in App, the stock two-across rule cards in PDF (Letter portrait); name / Show inactive filters; Pivot (rules by type × customer scope) |
| [SalesOrder/SalesByMonth.htm](SalesOrder/SalesByMonth.htm) | `SalesOrder/SalesByMonth.jrxml` | Cross-tab of posted sales by product × month (price over qty + product UOM), Part Totals column, Monthly Totals row; date range, product LIKE, 11 item-type checks (default Sale/Drop Ship/Kit). PDF Letter landscape 9pt, months beyond the sheet width continue on following sheets (Jasper column break). Pivot (item type × month default), RowCap by whole product |
| [SalesOrder/CompareSalesByMonth.htm](SalesOrder/CompareSalesByMonth.htm) | `SalesOrder/CompareSalesByMonth.jrxml` | Every product's posted qty / price in two periods (default Last vs This month), location groups, Show products with no sales. Optional Change columns, App-only price totals; Pivot product × period. PDF Letter portrait, no totals |
| [SalesOrder/MTDSales.htm](SalesOrder/MTDSales.htm) | `SalesOrder/MTDSales.jrxml` | Bar + line chart of posted sales per day 1–31 of a month, Total to Date, Title override. App adds a daily table with running total; PDF Letter portrait both charts on one page, no footer, optional daily-figures page. No Pivot/RowCap (one dimension, ≤31 rows) |
| [SalesOrder/SalesByCount.htm](SalesOrder/SalesByCount.htm) | `SalesOrder/SalesByCount.jrxml` | Shipped qty (soitem.qtyFulfilled by dateLastFulfillment, types 10/12/80, product UOM) per product, grouped by Location Group / Class / Sales Person / Customer Group (MAX relation id rule), sorted by number/description/qty; LG, class, sales person, customer-group filters. Collapsible groups, Pivot product × group (column totals off), RowCap by whole group. PDF Letter portrait, no totals |
| [SalesOrder/DiscountSummary.htm](SalesOrder/DiscountSummary.htm) | `SalesOrder/DiscountSummary.jrxml` | Fulfilled Discount % / Amount lines (soitem 30/31, status 50) by discount name, amount = −unitPrice; Show detail = groups collapsed; customer multi-select. Pivot (discount × month); RowCap at whole discounts + GROUP BY totals keep the Grand Total whole. Live Apr 2026: $372.78 = stock render |
| [SalesOrder/ReturnedSales.htm](SalesOrder/ReturnedSales.htm) | `SalesOrder/ReturnedSales.jrxml` | Credit Return lines (Inventory parts, qtyFulfilled > 0) on SOs completed in range; stock GROUP BY kept (incl. so.username, so look-alike rows stay; the tooltip names the creator); stock price formula kept. App-only total, no PDF total (as stock). Pivot; RowCap at whole products. Live Jun–Oct 2025: 15 rows identical to stock render |
| [SalesOrder/GrossSalesBySalespersonGraph.htm](SalesOrder/GrossSalesBySalespersonGraph.htm) | `SalesOrder/GrossSalesBySalespersonGraph.jrxml` | SUM(postsoitem.totalPrice) by so.salesman (must be a sysuser), top N; bar + pie as SVG after the table. No cap (≤ N rows), no pivot (one dimension). Live Apr 2026 = stock render |
| [SalesOrder/GrossSalesByProductGraph.htm](SalesOrder/GrossSalesByProductGraph.htm) | `SalesOrder/GrossSalesByProductGraph.jrxml` | qtyFulfilled × (unitPrice + adjust/qtyToFulfill) by product on soitem.dateLastFulfillment, top N, HAVING qty > 0, salesman must be a sysuser; Totals line; "By Dollars" / "By Quantity" chart pages (bar + pie). No cap, no pivot. Live Apr 2026 top 10 + Totals 45,028 / $1,068,282.06 = stock |
| [SalesOrder/GrossSalesByProductTree.htm](SalesOrder/GrossSalesByProductTree.htm) | `SalesOrder/GrossSalesByProductTree.jrxml` + `subGrossSalesByProductTree.jrxml` | Posted lines (both union halves, UOM conversion) summed in SQL per category / product; % of total / % of tree / average price; pie + bar per category; Product Tree Summary + pie. "Show each product once" = lowest producttree.id (matches stock); optional "Include products with no product tree". No cap (bounded by products), no pivot (summary is the roll-up). Live Apr 2026: all 12 category totals + Report Total = stock |
| [SalesOrder/SalesOrderTaxes.htm](SalesOrder/SalesOrderTaxes.htm) | `SalesOrder/SalesOrderTaxes.jrxml` | Tax worked out from lines: taxRate × totalPrice when taxable OR QBVersion = AU; so.totalTax ignored (as stock). Group by LG / customer / tax rate name; 6 date fields; 6 statuses; Include line item tax; Show SO line items; optional "Show saved order tax" flags stale totals. Pivot (tax rate × month); RowCap at whole SOs + GROUP BY totals. Live 1 Apr 2026 BP $1,085.73 = stock render |
| [SalesOrder/POSHourlyBreakdown.htm](SalesOrder/POSHourlyBreakdown.htm) | `SalesOrder/POSHourlyBreakdown.jrxml` | POS orders (so.typeId 20) completed per hour of the working day, day by day: Total # and % of Daily Sales (half-even %), the day's Total; weekday boxes (Mon-Fri default), Begin/End hour (7/19, clamped), LG / customer / salesperson / register filters; Average Sales Per Hour bar chart (SVG) under the table and on its own PDF page; hour grid filled on the page (no CREATELIST); Pivot Hour x Weekday, Excel (+ averages sheet), RowCap by whole day, PDF Letter portrait, title first page only, no page footer |
| [SalesOrder/ZReport.htm](SalesOrder/ZReport.htm) | `SalesOrder/ZReport.jrxml` | Payments taken on SOs (postransaction) by payment method: Date / Customer / SO / Salesperson / Amount, Subtotal per method, Grand Total; date range on the payment date, payment method, register (incl. "No Register"), LG / customer / salesperson / class filters with the stock NULL rules, Sort by (SO default / Date / Customer / Salesperson), Show group headers / totals / timestamp; page header with Register and Grand Total; Pivot method x day, Excel (payments + subtotals), RowCap with whole-method totals, PDF Letter portrait |
| [SalesOrder/TPSReport.htm](SalesOrder/TPSReport.htm) | `SalesOrder/TPSReport.jrxml` | Total Product Sales: posted sales per product (qty x (unit price + adjustment / GREATEST(1, qty))), greatest first; salesperson must be a user (stock sysuser join); date range (All = to date); Include cover sheet (logo, company, title, C O V E R S H E E T / C O N F I D E N T I A L, no header/footer on that page); App-only total, Excel, PDF Letter portrait, title every page |
| [SalesOrder/POSReceipt.htm](SalesOrder/POSReceipt.htm) | `SalesOrder/POSReceipt.jrxml`, `SalesOrder/Receipt3in.jrxml`, `SalesOrder/Receipt2in.jrxml` (+ `sub3inReceiptPayments` / `sub2inReceiptPayments`) | Record "POS Receipt": one sales order's point-of-sale receipt, FBDoc.Record (SO picker with an Orders chip: Point of Sale / With payments; launch lock; document output). Receipt › Format = Letter (POS Receipt) / 3 in roll (Receipt 3in) / 2 in roll (Receipt 2in), an option with saveable defaults (each user's own; company default by an admin / Edit Settings user; document output takes the company's). Letter: SO-style own sheets (FBDoc.Report.view), Customer box, Sales Rep line, US/AU/CA item column sets, POS payments table, Subtotal / Tax / Total / Paid / Balance Due (+ home-currency column), SO Notice. Rolls: fb-doc roll paper, one page at 216 / 144 pt as tall as the receipt (the jrxmls' isIgnorePagination), no print inset, @page size W H margin 0; payments PMT / method / amount + change; Subtotal / Tax / TOTAL / Paid / Balance or Change Given; Gift receipt; POS Notice. Options per format; the other format's groups hidden. Excel: lines + payments |

### Ship

The Ship folder's list reports and the bill of lading. Shipment History and Inventory Shipping Summary list shipments and shipped items in a period. Bill Of Lading prints one shipment's straight bill of lading. Packing Slip and Shipping Invoice are the module's paperwork, listed under Sales Order and Ship (paperwork).

| Port | Original | Notes |
|---|---|---|
| [Ship/ShipmentHistory.htm](Ship/ShipmentHistory.htm) | `Ship/ShipmentHistory.jrxml` | Shipped shipments (status 30) with order / ship-to / issued / shipped / days to fulfil / carrier. Filters: issued and shipped ranges (default Today), carrier, Include SO / PO / TO (SO on), sort (6 choices), ShowShipNumber, ReportTitle. Pivot (count / days by carrier, type, ship-to, month). Same 164 rows in the same order as the stock SQL live. Fix: Days to Fulfill counted in calendar days |
| [Ship/InventoryShippingSummary.htm](Ship/InventoryShippingSummary.htm) | `Ship/InventoryShippingSummary.jrxml` | One row per shipped item on SO shipments, with the 14 col* column options (stock defaults) and every filter (date range default This Month, customer, product LIKE, ship-to name / address / city / zip contains, carrier, StateCode, ckShowItemsWithNoState). Letter landscape. Pivot (qty / lines / shipments by product, customer, state, carrier, month). Identical rows, order and qty to the stock SQL live (205 lines / 2,244 qty; 236 / 2,390 with no-state items) |
| [Ship/billoflading.htm](Ship/billoflading.htm) | `Ship/billoflading.jrxml` | Record document (FBDoc.Record SHIP, no fb-launch): title band, ship from (getCompanyAddress) / ship to / carrier / SCAC / trailer / seal, third-party + PRO frame, special instructions / FOB / freight terms, Customer Order Information, Carrier Information (repeated per page), grand totals, last-page terms and signature footer, page rectangle. Every jrxml option via FBDoc.Options. Code 128 BOL and PRO barcodes |

### User

Ported 2026-10-20 as one report, at the user's request: **User Access Rights**
and **User Login Log** are the views of a single page.

| Port | Original | Notes |
|---|---|---|
| [User/UserAccessRights.htm](User/UserAccessRights.htm) | `User/UserAccessRights.jrxml`, `User/LoginLog.jrxml` | Users (groups, location groups, rights, last login, MFA; click a user for their rights by module and the group granting each), Groups (members, rights), Compare (users and groups side by side: group membership, then every right, differences only), Login log (date range with a calendar and quick ranges, users, sort by date or user). A group has a right when it has the row (as the stock reads it); "Show rights not granted" adds the ones other groups have |

### Labels

Ported 2026-10-20, the first label port. The stock reports are one jrxml per
sheet; a port is one report for every sheet, on the shared label engine
[`scripts/fb-label.js`](../scripts/fb-label.js) (FBLabel): the sheet is a
pill under the header (standard setups for Avery 5160 / 5163, L7160 / L7163
and 2 × 1, 4 × 2 and 6 × 4 in label printers, plus company setups an admin
adds and each user's own), Sheet setup edits paper, labels across / down,
margins and gaps, and the label's fields shrink to fit any size. Test sheet
prints numbered outlines. Company setups are shared by every label report.

| Port | Original | Notes |
|---|---|---|
| [Labels/PartBarcodes.htm](Labels/PartBarcodes.htm) | `Labels/PartBarcodesAvery.jrxml`, `2x4PartBarcodesAvery.jrxml`, `SinglePartBarcodesAvery.jrxml`, `PartBarcodesOneOff.jrxml`, `2x4PartBarcodesOneOff.jrxml`, `4x6PartBarcodesOneOff.jrxml` | Active parts matching a part number (% wildcard), ordered by number / description / date created, Skip, How many (90), or a chosen list with copies per part; Copies of each part. Fields: Code 128-B barcode of the number, part number, description (each: show, height share, size, bold, align, lines, order). Start at label, fill across / down, outlines. Same SQL as the stock (LIMIT / OFFSET); harness-run on the local server (90 parts) |
| [Labels/PackingSlip4x6.htm](Labels/PackingSlip4x6.htm) | `Labels/PackingSlip4x6.jrxml` (+ `SO` / `PO` / `TOPackingSlip4x6`, `cartonSO` / `PO` / `TOPackingSlip4x6`, `subSOItems4x6`, `subPOItems4x6`, `subTOItems4x6`, `subCarton4x6`, `subSOCartonItems4x6`, `subPOCartonItems4x6`, `subTOCartonItems4x6`) | One shipment on a 4 x 6 in label printer, on Part Barcodes' label screen: the label is an fb-label setup (pills shared by every label report; only one label per page, at least 3 x 4 in), one label at a time in the preview with zoom, Print at the label's size. The order type picks the SO / PO / TO layout; Layout Standard (items + carton list) or By Carton (items per carton, header on every page). Options: barcode, ship number as order #, SO order # (SO / customer PO), name line, country, tracking, kit headers, back-order lines. Shipment picker, launch lock, document output. Lines checked against the stock SQL on the local server (S10020: 5 / 8 / 6 shipped; T22); harness-run SO / PO / TO in both layouts |

### Work Order

Ported 2026-10-15. The three single-work-order documents (Traveler, Report,
Instructions) have a picker, and lock to the work order when launched for one
(the Traveler is listed in the Work Order module's Apps menu).
**WOTraveler.htm** replaced the Paperwork POC's Work Order Traveler (archived)
in the local Fishbowl `Work Order Traveler` record #134, keeping every POC
feature. `subWOTracking` and `subBOMInstructions` are not used by any stock
report; their SQL serves as reference.

| Port | Original | Notes |
|---|---|---|
| [WorkOrder/WOTraveler.htm](WorkOrder/WOTraveler.htm) | `WorkOrder/WOTraveler.jrxml` | The stock traveler on every page (header, barcode, notes, instructions, Finished / Raw Goods with write-ins, tracking prompts or values). Fixes: fetched by id (the stock matched `wo.num LIKE`); the BOM line no longer comes from an unordered row; no "null" title, no "Start - " for empty descriptions (60,774 of 60,776 steps live) |
| [WorkOrder/WOReport.htm](WorkOrder/WOReport.htm) | `WorkOrder/WOReport.jrxml` | One work order's document with Available per item; matches the stock render of 17115:001. Fixes: fetched by id; BOM / SO line from the first item that has one (1,181 of 1,195 blank-BOM WOs filled); columns fit the page (the stock ran 108pt off it with Instructions and Tracking on) |
| [WorkOrder/WOInstructions.htm](WorkOrder/WOInstructions.htm) | `WorkOrder/WOInstructions.jrxml` | The instruction steps to tick off. Fixes: fetched by id; no "Start - " for empty descriptions |
| [WorkOrder/WorkOrderCost.htm](WorkOrder/WorkOrderCost.htm) | `WorkOrder/WorkOrderCost.jrxml` + `Common/subOrderProjectedCost` | Work orders' costs line by line, by the costing method while open, actual once fulfilled (MO Projected Cost's rules). April 2026 live: 1,905 lines / 230 WOs, $1,102,739.64, 0 differences. Fixes as MO Projected Cost (UOM inverse fallback, "Group - Location") |
| [WorkOrder/ProductionYieldReport.htm](WorkOrder/ProductionYieldReport.htm) | `WorkOrder/ProductionYieldReport.jrxml` | Fulfilled WOs' yield against the quantity ordered; 231 = 231 rows for April live. Optional Group by part |
| [WorkOrder/WOSummary.htm](WorkOrder/WOSummary.htm) | `WorkOrder/WOSummary.jrxml` | Work orders by location group or calendar category. Fix: every column fits the page with Location Group on (the stock's table was 666pt on a 552pt page). Optional WO items and More columns |
| [WorkOrder/OutstandingWorkOrders.htm](WorkOrder/OutstandingWorkOrders.htm) | `WorkOrder/OutstandingWorkOrders.jrxml` | Open WOs due in a range with their SO and customer, days past due in the stock's wording (53 = 53 live). Fix: past due counts calendar days (the stock's year × 365 + day formula drifts across a leap year) |
| [WorkOrder/WOFlag.htm](WorkOrder/WOFlag.htm) | `WorkOrder/WOFlag.jrxml` + `WOFlagSub` | Open WOs with every item, raw goods short of on hand in red, open POs, and the Total Shortage Summary; identical to the stock live (417 lines, 9 summary parts). Fixes: need = target − used; WOs under a closed MO left out; exact assigned-user match |
| [WorkOrder/InvAllocatedToWorkOrders.htm](WorkOrder/InvAllocatedToWorkOrders.htm) | `WorkOrder/InvAllocatedToWorkOrders.jrxml` | Raw goods still allocated to open WOs, valued at Average / Standard / FIFO / LIFO; grand totals equal the stock render for May 2026 (330,302.88 / $333,511.76). Fixes: qty is what is still allocated (target − used; the stock prints the full plan, $94.7M with Fulfilled and all dates); a part's mixed UOMs total in its own UOM |
| [WorkOrder/WIPReport.htm](WorkOrder/WIPReport.htm) | `WorkOrder/WIPReport.jrxml` | Picked parts in manufacturing locations (`location.typeId` 80) for open WOs, with qty and value. Fixes: qty sums all the part's tags and WO Qty all its finished pick items (the stock showed one arbitrary row). The live and local data have no open WO with a finished pick, so it was checked with picks treated as finished: same 4 parts and $653,718.26 as the stock query |
| [WorkOrder/WOConsumption.htm](WorkOrder/WOConsumption.htm) | `WorkOrder/WOConsumption.jrxml` | Planned vs consumed per component of fulfilled WOs, with the Summary; April 2026 live: 1,688 lines and the summary identical to the stock. Fixes: UOM inverse fallback (FOOD104's kg lines were labelled Sachet); a total across mixed units shows "mixed" instead of adding kg + ea + hr |

## Record documents

The ports that print one record (an order, a pick, a receipt, a work order)
share one style: the REPORT chrome with an App view and a PDF view, and
fb-doc's **FBDoc.Record** for the record: a picker in the Filters panel
(typeahead, status chips, previous / next, Refresh), the start order (a launch
from a module, then the record report setting adopted once per user, then the
user's last, then the newest), the launch lock, and the document-output guard
report_btn relies on. Each has a Page_setup report setting and, where Fishbowl
has a picker for the record type, a record setting (no RMA picker exists). See
[DIFFERENCES.md](DIFFERENCES.md) › Record documents, and
[docs/fb-doc.md](../docs/fb-doc.md).

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
| MO Projected Cost | None (one MO; the largest live MO has 188 lines) | None (one document) | Recommended: a Components view, one row per part across the WOs |
| MO Stage | Whole MOs | Stage Qty by Stage Name × WO Status | Recommended: a stage board, cards per WO status |
| MO Traveler | None (one MO) | None (one document) | — |
| Production Demand | Whole location groups | Short by Part × week (also hours per machine) | Recommended: a raw-goods requirements pivot |
| Production Report | Whole parts | Part + UOM × month finished | — |
| ABC Report | 10,000 parts (codes stay exact) | Current × Projected code | **Changed only** filter, Cumulative % column |
| Part Accounts | 10,000 parts | Count by account | **Group by account** |
| Part Allocated | Whole parts | Part × order type | — |
| Part Average Cost | 10,000 parts | None (one row per part) | **Avg vs Std** view |
| Part Committed Report | Whole parts | Part × order type | — |
| Part Cost Over Time | Cost layers, whole parts | Part × month created | — |
| Part List | 10,000 parts | Count / value by part type × ABC | — |
| Reorder Points | Whole parts | Part × location group | **By location group** |
| Kit Report | Whole kits | Kit × line type (cost); where used | Recommended: "kits containing product X" |
| Product Catalog V2 | Whole categories | None (price only) | **Catalog / Table / Order sheet** |
| Product Price List | Whole categories | Price by category | Recommended: nested category tree |
| Pick Efficiency | Whole users | Minutes by user × week | Recommended: items per pick |
| Pick Ticket | None (one pick) | None (one document) | **Show items** modes; recommended: a wave sheet across picks |
| Part Vendor List / Vendor Part List | 10,000 rows, whole parts / vendors | Part × Vendor, lowest home cost per part UOM | Recommended: "Last PO" columns, stale-cost and single-source filters |
| Vendor Address | 10,000 addresses | Address count by any two of vendor, type, state, country… | — |
| Vendor Address List | 10,000 addresses | Count by letter, vendor, state… | **Cards / Table** |
| Vendor Backorder Report | Whole groups | Backordered value by vendor × weeks overdue | — |
| Vendor Fulfillment History | Whole vendors | Lead time by vendor × quarter | — |
| Vendor Performance Report | Whole vendors | On-time % by vendor × month | **Scorecard**; recommended: monthly on-time trend chart |
| WO Traveler / WO Report / WO Instructions | None (one WO) | None (one document) | — |
| Work Order Cost | 10,000 lines, whole WOs | Cost by finished part × month | Recommended: one row per WO (Excel has it) |
| Production Yield | Whole parts | Yield % by part × month | **Group by part** |
| Work Order Summary | Whole WOs | WO count by week scheduled × status | Recommended: calendar / Gantt, per-user workload |
| Outstanding Work Orders | Whole WOs | WOs by due band × location group | Recommended: kanban by due week |
| Work Order Flag | Whole WOs (summary uncapped) | Qty needed by item type + part × week | **Only work orders with a shortage** |
| Inventory Allocated To Work Orders | 10,000 lines, whole groups | Total cost by part × WO status | Recommended: allocated vs available per part |
| Work In Progress | 10,000 rows, whole parts | WIP value by part × location | **Show locations**; recommended: a by-work-order view |
| Work Order Consumption | 10,000 lines + 10,000 summary rows, whole groups | Difference by part × month | Summary (Include / Only) |

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

Desk-tested 2026-10-09 (Accounting, Customer), 2026-10-10 (Inventory) and
2026-10-13 (Manufacture Order) and 2026-10-14 (Part, Product, Picking):
every query ran against the live Fishbowl database
through the iReport MCP SQL validator, and each page was rendered in Chrome
with fb-lib and fb-styles expanded and `runQuery` answered from real rows.
Totals were checked by hand, and Excel export and Print were exercised.
The Purchase Order, Receiving, RMA, Transfer Order, Vendor and Work Order
ports were desk-tested the same way on 2026-10-14 / 15.

2026-10-16: every record document moved to fb-doc's shared FBDoc.Record
(picker, launch lock, document output guard) and the four paperwork documents
to the REPORT chrome with App and PDF views. Each was compared before and
after on the same data (`tools/report-harness/ab.js`; the paperwork against a
live database, `tools/doc-tests/`): same queries, same printed sheets, the
launch lock and output states as expected. The list ports were laid out again
on the new fb-doc: no change (28 ports compared).

**Not yet run inside the Fishbowl client**, except the Sales Order Report's
launch (report_btn 0.1.0) and the WO Traveler / Advanced Auto PO workspaces.

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

Gaps in the test data, for the Part, Product and Picking ports (2026-10-14):

- Neither database has committed WO / PO stock, assigned part accounts,
  per-location-group reorder points, kits or product pictures on the live
  side, Committed pick items, or saved stock report options; those paths ran
  on the local server or made-up rows.
- Product pictures come from the local server only (the ireport DB has
  product images for none).

Gaps in the test data, for the Manufacture Order ports:

- No MO is Entered, has a linked SO or customer, a category, assigned users,
  staged WOs or BOM instructions, so those parts of the Traveler and
  Projected Cost ran on made-up MOs only.
- Only stage level 1 exists, so MO Stage's multi-level stages are made up.
- No WO is linked to a customer, no BOM has a Machine value or a duration,
  and one location group has open WOs, so Production Demand's customer,
  machine and time paths are made up.

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
- Fishbowl's `sql_mode` makes `||` a logical OR, not concatenation, so an
  original's `a || ' - ' || b` prints 0. Use `CONCAT`.
- Jasper reports read sysproperties as Java system properties
  (`System.getProperty("Acct Costing Method")`): the server copies every
  `sysproperties` row into them at start-up. A port reads the table.
- A field selected twice under one name (MO Projected Cost's `STATUSID`)
  takes the first one in Jasper.
