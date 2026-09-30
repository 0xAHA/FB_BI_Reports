# Dashboard - Company (Combined Dashboard)

## Overview

**Dashboard - Company** shows up to eight order and inventory tiles in one
configurable grid. It is the combined version of the individual
[Dashboard Tiles](Dashboard%20Tiles.md): each tile has the same columns,
sorting, filters and click-through as its standalone report.

- **Tiles:** Sales Orders, Purchase Orders, Work Orders, RMAs, Transfer Orders,
  Items To Be Picked, Items To Be Received, Items To Be Shipped
- **Layout:** 1–4 columns; choose which tiles show and in what order
- **Settings gear:** every option is set in the report and saved per user; an
  admin can publish defaults for everyone and lock them
- **Location-group filter:** narrow every tile to chosen location groups
- **Custom-field columns:** add Fishbowl custom fields as columns on any tile
- **Live data:** every tile queries the Fishbowl database directly

Source file: `Dashboards/Dashboard_Combined.htm`.

## Installation

### 1. Import the shared library first

The dashboard loads **fb-lib** (the shared BI script library) by name. Import
it before the dashboard, and re-import it whenever it is updated:

| File | Where | Record |
|---|---|---|
| `fb-lib-Script.json` | BI Reports ▸ `Standard` | Script `fb-lib` |

Without fb-lib the dashboard doesn't load. With an older fb-lib than the
dashboard expects, some features may be missing.

### 2. Import the dashboard

| File | Where | Record |
|---|---|---|
| `Dashboard - Company-Page.json` | BI Reports ▸ `Company Dashboad and Tiles` | Page `Dashboard - Company` |

1. In Fishbowl, open **BI Editor** and click **Import**.
2. Select `Dashboard - Company-Page.json`.
3. Tick **Publish** and choose the access rights for each user group.
4. Click **OK**.

Importing over an existing `Dashboard - Company` record updates it. Users'
saved settings are kept, because they are stored against the user, not the
report.

### 3. Enable it as a dashboard gadget

1. Open **Dashboard - Company** in the BI Report window.
2. On the **Details** tab, tick **Dashboard Gadget** and click **Save**.
3. Add it to a Fishbowl dashboard.

No system properties are required. The dashboard works with its built-in
defaults, and everything can be changed in its settings panel.

## Settings panel

Click the **gear icon** (top right) to open the settings panel. Changes apply
when you click **Save (just me)**.

| Setting | What it does | Default |
|---|---|---|
| Columns | Number of grid columns (1–4) | 2 |
| Location Groups | Show only these location groups. Empty = every location group you can access | All |
| Tile order & visibility | Drag to reorder tiles; untick to hide one | All 8, in the order above |
| Rows per tile | Rows visible before a tile scrolls (1–50) | 5 |
| Auto-refresh | Seconds between automatic refreshes of all tiles; 0 = off | 0 (off) |
| Hide Estimates | Hide estimate sales orders on the SO tile | Off |
| Hide Bid Requests | Hide bid-request purchase orders on the PO tile | Off |
| Remember table filters between sessions | Keep each tile's filter row when the dashboard is reopened | Off |
| Show debug console | Show the SQL/event log at the bottom of the page | Off |
| Column Visibility | Per tile: show or hide standard columns, add custom-field columns, and set column order | See below |

**Reset to defaults** clears your own saved settings.

### Column visibility

Each tile has a section listing its standard columns and every custom field
for that record type. Required columns (the order number and the
schedule/availability indicators) can't be hidden. These columns are hidden by
default and can be ticked on: **Salesperson** (SO), **Buyer** (PO) and
**Location Group** (TO).

### Admin controls

Admins see an **Admin** section in the panel. An admin is the user named
`admin` or any user with the `Admin` access right.

- **Publish as default for everyone.** Saves the admin's current settings as
  the company default. Users who haven't saved their own settings get it;
  users who have keep theirs.
- **Lock user editing.** Every user gets the published default and their own
  changes are ignored. They see a "Locked by admin" notice in the panel.
  Click again to unlock.

### Where settings come from

Each setting resolves in this order:

1. the user's own saved settings;
2. the admin's published default (or first, if the admin has locked editing);
3. a Fishbowl system property, if one is set (legacy; see below);
4. the built-in default.

Settings are stored in Fishbowl's user properties, so they follow the user to
any machine.

## Legacy system properties

Earlier versions were configured only through **Setup ▸ Property**. Those
properties still work as fallbacks when no user or admin setting exists.
Existing installs keep working without changes:

| Property | Maps to | Example |
|---|---|---|
| `BI_DASHBOARD_LAYOUT` | Columns + tile order | `2-SO-PO-WO-RMA-TO-PICK-RCV-SHIP` |
| `BI_DASHBOARD_ROWS` | Rows per tile | `5` |
| `BI_DASHBOARD_REFRESH` | Auto-refresh seconds | `300` |
| `BI_SO_SHOW_ESTIMATE` | `false` = hide estimates | `true` |
| `BI_PO_SHOW_BID_REQUEST` | `false` = hide bid requests | `true` |
| `BI_SHOW_DEBUG` | `true` = show debug console | `false` |

`BI_DASHBOARD_LAYOUT` is `{columns}-{tile}-{tile}-…`. The tile codes are
`SO`, `PO`, `WO`, `RMA`, `TO`, `PICK`, `RCV` and `SHIP`, and the column count
is limited to 1–4.

Dates are shown in Fishbowl's `DateFormatShort` format.

## Tiles

Every tile starts with a **schedule indicator**:

- red clock: past due
- orange clock: due today
- blue clock: due this week

| Code | Tile | Default columns | Click-through |
|---|---|---|---|
| `SO` | Sales Orders | Status, Number, Date Scheduled, Date Issued, Customer, Customer PO, Location Group | Sales Order |
| `PO` | Purchase Orders | Status, Number, Date Scheduled, Date Issued, Vendor, Customer SO, Location Group | Purchase Order |
| `WO` | Work Orders | Status, MO #, WO #, BOM #, Qty, Start Date, Scheduled Date, Location Group | Work Order |
| `RMA` | RMA Orders | Status, Type, Issue, RMA #, Product, Qty, Customer, Date Created, Date Expires, Location Group | RMA |
| `TO` | Transfer Orders | Status, Type, Number, Date Scheduled, Date Issued, From, To | Transfer Order |
| `PICK` | Items To Be Picked | Availability, Status, Number, Order #, Scheduled Date, Priority, Order Info, Location Group | Picking |
| `RCV` | Items To Be Received | Status, Type, Order #, Scheduled Date, Vendor, Location Group | Receiving (by source order) |
| `SHIP` | Items To Be Shipped | Status, Type, Number, Order #, Scheduled Date, Ship To, Carrier, Service, Location Group | Shipping; Order # opens the source order |

**PICK availability** shows one indicator per pick:

- green: all items available
- yellow: partly available
- red: nothing available
- padlock: all items committed
- grey: no pending items

Hover over the indicator for the item counts.

**RMA issue** shows DOA, Warranty, or `-` when no issue is set. An RMA with more
than one product shows "Multiple".

## Using the tiles

- **Sort:** click a column header; click again to reverse.
- **Filter:** type in the boxes under the headers. Matching is partial and
  case-insensitive, and the filters combine. The tile header shows "Showing X
  of Y". **Clear Filters** resets that tile.
- **Refresh:** the refresh icon reloads one tile and keeps its sort and
  filters.
- **Open a record:** click an order, pick or shipment number.
- **Location groups:** a tile only shows records in location groups assigned
  to the user (Setup ▸ User ▸ Location Groups). The Location Groups setting
  narrows this further. A user with no location groups assigned sees no
  data.

## Troubleshooting

| Symptom | Check |
|---|---|
| Blank dashboard or script error on load | fb-lib is imported and up to date; import it again from `Standard` |
| A tile shows no rows | The user has location groups assigned; the Location Groups setting isn't excluding them |
| Settings don't stick | The admin has locked user editing (the panel shows "Locked by admin") |
| Everyone sees the old layout after an admin change | The admin clicked **Publish as default for everyone**; users with their own saved settings keep theirs until they **Reset to defaults** |
| Slow to load | Hide unused tiles, lower Rows per tile, or raise Auto-refresh |

Turn on **Show debug console** to see each tile's SQL, record counts and
errors.

## Compared with the individual tiles

The eight tiles are also published as separate reports, one gadget each. See
[Dashboard Tiles](Dashboard%20Tiles.md). The two versions differ as follows:

| | Dashboard - Company | Individual tiles |
|---|---|---|
| Gadgets | 1 | 8 |
| Layout | 1–4 columns, choose tiles and order | One tile per gadget |
| Saved views | Remember-filters option | Named saved views (My + Company) |
| Settings | One panel for all tiles | One panel per tile |
