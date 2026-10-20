# Dashboards — state of play (2026-10-16)

A brief for the development team taking on `Dashboards/`. It describes the
dashboards as they are, and lists observations and options. It is not a
mandate: the dashboards are their own family and do **not** have to follow the
REPORT chrome (fb-styles §35, `FBLib.RptCols`, PDF view) that the iReport
ports and the other apps use.

User-facing documentation lives beside the pages:
[dashboards.md](../Dashboards/dashboards.md) (the v1.2 trio),
[Company Dashboard - Import Instructions.md](../Dashboards/Company%20Dashboard%20-%20Import%20Instructions.md)
and [Dashboard Tiles.md](../Dashboards/Dashboard%20Tiles.md).

## Inventory

Two families, independent of each other and of everything else in the repo.

| Family | File | Record (local Fishbowl #) | Key | Apps menu (`fb-launch`) | Shared assets |
|---|---|---|---|---|---|
| v1.2 analytics | `Sales_Dashboard_v1.2.htm` | Sales Dashboard v1.2 (#158) | `cdx.bi.salesdash` | SALES | fb-lib, fb-styles |
| v1.2 analytics | `Inventory_Dashboard_v1.2.htm` | Inventory Dashboard v1.2 (#156) | `cdx.bi.invdash` | MATERIALS | fb-lib, fb-styles |
| v1.2 analytics | `Purchasing_Dashboard_v1.2.htm` | Purchasing Dashboard v1.2 (#157) | `cdx.bi.purchdash` | PURCHASING | fb-lib, fb-styles |
| Company | `Company_Dashboard.htm` | Company Dashboard v1.2 (#42) | `cdx.bi.dashboard.combined` | REPORTING | fb-lib |
| Company tile | `Individual Pages/Open_Sales_Orders.htm` | Open Sales Orders (#50) | `cdx.bi.openSalesOrders` | SALES | fb-lib |
| Company tile | `Individual Pages/Open_Purchase_Orders.htm` | Open Purchase Orders (#48) | `cdx.bi.openPurchaseOrders` | PURCHASING | fb-lib |
| Company tile | `Individual Pages/Open_Work_Orders.htm` | Open Work Orders (#52) | `cdx.bi.openWorkOrders` | MANUFACTURING | fb-lib |
| Company tile | `Individual Pages/Open_RMA_Orders.htm` | Open RMA Orders (#49) | `cdx.bi.openRmaOrders` | SALES | fb-lib |
| Company tile | `Individual Pages/Open_Transfer_Orders.htm` | Open Transfer Orders (#51) | `cdx.bi.openTransferOrders` | MATERIALS | fb-lib |
| Company tile | `Individual Pages/Items_To_Be_Picked.htm` | Items to be Picked (#44) | `cdx.bi.itemsToBePicked` | SALES | fb-lib |
| Company tile | `Individual Pages/Items_To_Be_Received.htm` | Items to be Received (#45) | `cdx.bi.itemsToBeReceived` | PURCHASING | fb-lib |
| Company tile | `Individual Pages/Items_To_Be_Shipped.htm` | Items to be Shipped (#46) | `cdx.bi.itemsToBeShipped` | SALES | fb-lib |

All twelve are system apps (`fb-origin` system, folder `Dashboards`), stamped,
and in sync with the local Fishbowl server. Record numbers are the local dev
server's `biscript` ids; a customer server has its own.

## What each family depends on

**v1.2 analytics trio.** GridStack 10.3.1 (layout), D3 v7 (charts), moment.js
2.29.4, the Tailwind play CDN, Inter / Space Mono from Google Fonts. From
fb-lib: `Settings` (per-user layout, admin-published default layout + lock),
`Common`, `SharedData`. From fb-styles: tokens and base components.
They need internet access; offline they do not render.

**Company Dashboard + tiles.** moment.js 2.29.4 and Inter. From fb-lib:
`Settings`, `Columns`, `CfCatalog` / `CfCols` (custom-field columns), `Picker`,
`Common`, `SharedData`; the tiles also use `FilterViews` (saved views). They
do not load fb-styles; their CSS is inline.

Neither family reads `FB_LAUNCH` or `FB_WORKSPACE`, so both run unchanged in
the plain BI Reports viewer, as a dashboard gadget, or inside report_btn.

## Observations

1. **Code is copied within each family.**
   - v1.2 trio: 56 functions are identical in all three pages and 34 more
     exist in all three with small drifts (the grid shell, KPI badges, the
     settings panel, the admin layout publish/lock, date helpers). A fix in
     one dashboard has to be repeated by hand in the other two.
   - Company family: each tile's query, columns and rendering exist twice,
     once in its tile page and once inside `Company_Dashboard.htm`
     (5,351 lines). The two copies are kept in step by hand.
2. **No print path.** None of the twelve pages prints (no print window, no PDF
   view). Every other production app is expected to print.
3. **Tailwind is loaded but barely used** by the v1.2 trio (play CDN, a runtime
   compiler in the page). It also defines utility names, such as `collapse`,
   that collide with page classes (see the memory note on Tailwind collisions).
4. **External dependencies.** All twelve load at least one CDN; the trio needs
   five. That rules them out for customers on restricted networks.
5. **Distribution differs by family.** The v1.2 trio ships inside Fishbowl only
   (never SharePoint). The Company Dashboard and its tiles are also published
   to the SharePoint "BI Reports" folder `Company Dashboad and Tiles` (the
   folder name's spelling is what's live; renaming the folder is the owner's
   call). Their deploy target is `both`, refreshed 2026-10-16.
6. **Old record names.** The records were renamed without their
   `- Dashboard - ` prefixes on 2026-10-12. A server that imported the old
   names has a second copy of each; the docs say to delete the old ones.

## Options for the dev team

These are ideas, not decisions:

- **Share code within a family.** Move the trio's common shell (grid,
  settings, layout publish/lock, KPI badges) into a shared script (for example
  `fb-dash.js`), and have `Company_Dashboard.htm` load each tile's renderer
  from one place instead of copying it.
- **Bundle the CDN libraries** (GridStack, D3, moment) as Script records, as
  fb-lib is, so the dashboards work offline; or replace moment with
  `Intl` / `FBLib.Common` date helpers.
- **Drop the Tailwind play CDN** after confirming which utilities, if any,
  the pages depend on.
- **Add a print path** if customers need one: a print window of the visible
  tiles (`FBDoc.printWindow`, see [fb-doc.md](fb-doc.md)) is the smallest step.

## Deploying

Same as any report (see `CLAUDE.md` › *Where an edit goes*): edits are stamped
and sent by the after-edit hook according to `tools/deploy/targets.local.json`
(`fishbowl` for the trio, `both` for the Company Dashboard and tiles). Shared
assets go first: fb-styles, then fb-lib, then the dashboards.

`Dashboards/Temp/` is gitignored and holds a local leftover
(`SalesDash_Workspace_Preview.htm`, July 2026); it is not part of the repo.
