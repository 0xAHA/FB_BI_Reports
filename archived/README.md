# Archived

Superseded versions, kept so they are easy to open: for side-by-side
comparison, and for checking whether a reported bug still happens in the
current version. Nothing here is stamped or published (`tools/stamp` and
`tools/deploy` skip this folder). Older Production Scheduling / Gantt
versions live in `Custom/Manufacturing/Archived/`.

| File | Superseded by |
|---|---|
| `Dashboards/Sales_Dashboard.htm` | `Dashboards/Sales_Dashboard_v1.2.htm` (original fixed layout) |
| `Dashboards/Sales_Dashboard_DragDrop.htm` | `Dashboards/Sales_Dashboard_v1.2.htm` (the drag-and-drop version v1.2 was re-platformed from) |
| `Dashboards/Sales_Dashboard_Grid_POC.htm` | `Dashboards/Sales_Dashboard_v1.2.htm` (GridStack proof of concept) |
| `Dashboards/Inventory_Dashboard.htm` | `Dashboards/Inventory_Dashboard_v1.2.htm` |
| `Dashboards/Purchasing_Dashboard.htm` | `Dashboards/Purchasing_Dashboard_v1.2.htm` |
| `Dashboards/Mobile_Dashboard.htm` | — (experiment for Fishbowl Advanced Mobile, 2026-03; recovered from a deleted branch) |
| `Template/Dev_Testing_Tool.htm` | — (dev testing tool, 2026-02; recovered from a deleted branch) |
| `Manufacturing/WO Finisher/` | `Custom/Manufacturing/WO_Finisher.htm` (prototype, 2026-06). The `.md` files are that project's old Claude notes; their useful parts are now in `CLAUDE.md` and `schema/schema-index.md` |
| `_ps.js` | `Custom/Manufacturing/Production_Scheduling_v1.2.htm` (an extracted copy of its script) |
| `bi-script-javascript-api-guide.md` | `CLAUDE.md` (an earlier copy of the API guide) |
| `SalesOrder/QuickOrder.htm` | `Custom/SalesOrder/QuickOrder_v1.2.htm` (v1.0, retired 2026-10-01 when v1.2 took over the `- Sales - QuickOrder V2` record and the portal. This is v1.0 as last maintained; tag `quickorder-v1.0` marks where v1.2 forked) |
| `File_Storage_Test_shelved.htm` | — (shelved experiment) |
| `iReport_Ports/Accounting/AdjustmentReport.htm`, `ExportSummary.htm`, `COGSByAccountSummary.htm`, `iReport_Ports/Inventory/ConsumptionReport.htm` | The same paths under `iReport_Ports/` (first versions, 2026-10-09, with filter drawers and KPI tiles; replaced the same day by the report-chrome layout) |
| `iReport_Ports/Inventory/Inventory_Availability_by_Location_Group.htm` | `iReport_Ports/Inventory/InventoryAvailabilityByLG.htm` (the prototype from `Other_NOT_FOR_PRODUCTION/prototypes/`, moved and rebuilt as a faithful port 2026-10-10. It sorted on two customer-specific part custom fields, Medicine and Inv Assets) |
| `Other_NOT_FOR_PRODUCTION/Paperwork_POC/PickTicket.htm` (+ its `dist/` build and `tests/PickTicket.test.js`) | `iReport_Ports/Picking/PickTicket.htm` (2026-10-14: the merged Pick Ticket, which also covers Pick Report and its SO-custom-field variant, took over the local Fishbowl `Pick Ticket` record #131. The proof of concept ran on the POC engine's `FBDoc.app`; its rules were carried over) |
| `Other_NOT_FOR_PRODUCTION/Paperwork_POC/POReport.htm` (+ `tests/POReport.test.js`) | `iReport_Ports/PurchaseOrder/POReport.htm` (2026-10-15: the iReport port of the stock PO Report took over the local Fishbowl `Purchase Order Report` record #130) |
| `Other_NOT_FOR_PRODUCTION/Paperwork_POC/WOTraveler.htm` (+ its `dist/` build and `tests/WOTraveler.test.js`) | `iReport_Ports/WorkOrder/WOTraveler.htm` (2026-10-15: the iReport port of the stock Work Order Traveler took over the local Fishbowl `Work Order Traveler` record #134, with the user's yes. It keeps every POC feature: picker, launch lock, the stock's saved options, tracking, barcode, and "save for everyone" as company defaults. `specs/WOTraveler.md` stays in the POC folder as reference) |
| `Other_NOT_FOR_PRODUCTION/Inventory_Adjustment_Helper.htm` | `Custom/Inventory/Inventory_Adjustment_Helper.htm` (2026-10-15, the user's choice: the tracked version, formerly `Other_NOT_FOR_PRODUCTION/Inventory_Adjustment_Helper_Tracked.htm`, became the only Inventory Adjustment Helper. It handles untracked parts as before and checks / allocates tracking for tracked ones. It took over the local Fishbowl `Inventory Adjustments` record #50) |
| `Other_NOT_FOR_PRODUCTION/Paperwork_POC/SOReport.htm`, `PackingList.htm`, `ShippingInvoice.htm`, `Print_Probe.htm`, the POC engine `fb-doc.js` / `fb-doc-fonts.css`, `build.js` (+ its VARIANTS: SOInvoiceReport), `dist/`, `tests/` and `tools/build_fonts.py` | `iReport_Ports/SalesOrder/SOReport.htm`, `SOInvoiceReport.htm`, `iReport_Ports/Ship/PackingList.htm`, `ShippingInvoice.htm` on the shared `scripts/fb-doc.js` (2026-10-15, the user's choice of one set of reports, includes instead of an inlined engine: `FBDoc.app` / `FBDoc.launch` moved into the shared engine; the documents kept their records #128 / #129 / #132 / #133 and keys; print output identical to the POC build; tests now in `tools/paperwork-tests/`. `Print_Probe.htm` was a print test page, not ported) |
| `Other_NOT_FOR_PRODUCTION/Paperwork_POC/README.md` | `iReport_Ports/README.md` (2026-10-16: the last POC files left the folder. The README, which describes the POC as built, is archived here; `LAUNCH_CONTEXT.md` moved to `docs/launch-context.md` and `specs/` to `iReport_Ports/specs/`) |
| `Template/Core_Dashboard_Template.htm` | `Template/List_Report_Template.htm`, `Record_Document_Template.htm`, `Form_Tool_Template.htm` (2026-10-16: the starting points for new reports, on the current conventions: REPORT chrome, company defaults, the PDF view, FBDoc.Record, Excel. The old template predated them. Its Fishbowl record "BI Template" and the SharePoint copy in `Standard` were left in place) |
| `Themes/` | `scripts/fb-styles.css` (2026-10-17: the legacy theme CSS; no current app includes it) |
| `mockups/` | — (2026-10-17: design mockups. `report-launcher.html` is the App Library's design, `Other_NOT_FOR_PRODUCTION/Report_Launcher/`; `quickorder-mobile-v2.html` a QuickOrder mobile layout study) |
