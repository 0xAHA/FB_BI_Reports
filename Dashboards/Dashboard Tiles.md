# Dashboard Tiles

## Overview

These are eight single-tile BI reports, one per order or inventory queue.
Each is sized to sit on a Fishbowl dashboard as its own gadget. Every tile
queries the Fishbowl database directly and has these features:

- sortable, filterable columns;
- click-through to the Fishbowl record;
- a settings gear with a location-group filter, column visibility and
  custom-field columns;
- named saved views.

The same eight tiles are available together in one grid as
[Dashboard - Company](Dashboard%20Combined%20-%20Import%20Instructions.md).

Source files: `Dashboards/Individual Pages/*.htm`.

## Installation

### 1. Import the shared library first

Every tile loads **fb-lib** (the shared BI script library) by name. Import it
before the tiles, and re-import it whenever it is updated:

| File | Where | Record |
|---|---|---|
| `fb-lib-Script.json` | BI Reports ▸ `Standard` | Script `fb-lib` |

Without fb-lib the tiles don't load. With an fb-lib older than the tiles, the
saved-views button doesn't appear.

### 2. Import the tiles

All eight are in BI Reports ▸ `Company Dashboad and Tiles`:

| Tile | File | Source |
|---|---|---|
| Open Sales Orders | `- Open Sales Orders-Page.json` | `Open_Sales_Orders.htm` |
| Open Purchase Orders | `- Open Purchase Orders-Page.json` | `Open_Purchase_Orders.htm` |
| Open Work Orders | `- Open Work Orders-Page.json` | `Open_Work_Orders.htm` |
| Open RMA Orders | `- Open RMA Orders-Page.json` | `Open_RMA_Orders.htm` |
| Open Transfer Orders | `- Open Transfer Orders-Page.json` | `Open_Transfer_Orders.htm` |
| Items to be Picked | `Dashboard - Tiles - Items to be Picked-Page.json` | `Items_To_Be_Picked.htm` |
| Items to be Received | `Dashboard - Tiles - Items to be Received-Page.json` | `Items_To_Be_Received.htm` |
| Items to be Shipped | `Dashboard - Tiles - Items to be Shipped-Page.json` | `Items_To_Be_Shipped.htm` |

1. In Fishbowl, open **BI Editor** and click **Import**.
2. Select the `.json` files you want (you can select several at once).
3. Tick **Publish** and choose the access rights for each user group.
4. Click **OK**.

The record name inside each file keys the import:

- A file whose name matches an existing record updates that record.
- A file with a new name creates a new record.

Users' saved settings and views survive a re-import.

### 3. Enable them as dashboard gadgets

For each tile:

1. Open it in the BI Report window.
2. On the **Details** tab, tick **Dashboard Gadget** and click **Save**.
3. Add it to a Fishbowl dashboard.

No system properties are required.

## The tiles

| Tile | Shows | Click-through |
|---|---|---|
| Open Sales Orders | Active SOs: status, dates, customer, customer PO; salesperson optional | Sales Order |
| Open Purchase Orders | Active POs: status, dates, vendor, customer SO; buyer optional | Purchase Order |
| Open Work Orders | Active WOs with MO #, BOM #, qty, start and scheduled dates | Work Order |
| Open RMA Orders | Open RMAs by type and issue (DOA / Warranty / `-`), product, qty, customer, dates | RMA |
| Open Transfer Orders | Active TOs with type, dates, from and to location groups | Transfer Order |
| Items to be Picked | Open picks with availability, priority and order info | Picking; Order # opens the source order |
| Items to be Received | Receipts expected against POs, SOs (returns) and TOs, with vendor | Receiving (by source order) |
| Items to be Shipped | Shipments with ship-to, carrier and service | Shipping; Order # opens the source order |

Every tile can also show a **Location Group** column.

### Indicators

The **schedule** clock shows how the scheduled date compares with today:

| Clock | Meaning |
|---|---|
| Red | Past due |
| Orange | Due today |
| Blue | Due this week |
| None | Later |

The **availability** circle (Items to be Picked) summarises the pick's items:

| Indicator | Meaning |
|---|---|
| Green | All items available |
| Orange | Partly available |
| Red | Nothing available |
| Padlock | All items committed |
| Grey | No pending items |

Hover over it for the full / partial / none counts.

## Using a tile

- **Sort:** click a column header; click again to reverse.
- **Filter:** type in the boxes under the headers. Matching is partial and
  case-insensitive, and the filters combine. The header shows "Showing X
  of Y". **Clear Filters** resets them.
- **Reorder columns:** drag a column header. This lasts until the tile is
  reloaded. To keep an order, set it in Settings ▸ Column Visibility.
- **Refresh:** reloads the data and keeps the filters and sort.
- **Open a record:** click an order, pick or shipment number.

### Saved views

The saved-views button in the header saves the current filters, header
toggles and sort as a named view. It opens a list in two groups:

- **My views** are your own; other users don't see them.
- **Company views** are published by an admin and visible to everyone. You
  can save a copy to change one, but only an admin can change or delete the
  original.

Star a view to open it by default. An admin can also set a company view as
everyone's default; a user's own star overrides it. The popover also lists
every filter currently narrowing the table, including filters on hidden
columns.

### Settings

Click the **gear icon** to open the tile's settings. Changes apply when you
click **Save (just me)**.

| Setting | What it does |
|---|---|
| Location Groups | Show only these location groups. Empty = every location group you can access |
| Hide Estimates / Hide Bid Requests | Open Sales Orders / Open Purchase Orders only |
| Remember table filters between sessions | Reopen the tile with the filters you left it with; otherwise your starred view opens |
| Show debug console | Show the SQL/event log at the bottom of the page |
| Column Visibility | Show or hide standard columns, add custom-field columns, set column order. Order numbers and indicators can't be hidden |

**Reset to defaults** clears your own saved settings.

**Admin controls.** An admin is the user named `admin` or any user with the
`Admin` access right. Admins also get:

- **Publish as default for everyone** makes their settings the default for
  users who haven't saved their own.
- **Lock user editing** makes everyone use the published default.

## Location-group access

A tile only shows records in location groups assigned to the user (Setup ▸
User ▸ Location Groups). The Location Groups setting narrows this further. A
user with no location groups assigned sees no data.

## Legacy system properties

These **Setup ▸ Property** values are still read as fallbacks when no user or
admin setting exists:

| Property | Effect |
|---|---|
| `BI_SO_SHOW_ESTIMATE` | `false` hides estimates on Open Sales Orders |
| `BI_PO_SHOW_BID_REQUEST` | `false` hides bid requests on Open Purchase Orders |
| `BI_SHOW_DEBUG` | `true` shows the debug console |

Dates use Fishbowl's `DateFormatShort` format.

## Troubleshooting

| Symptom | Check |
|---|---|
| Blank tile or script error | fb-lib is imported and up to date |
| No saved-views button | fb-lib predates saved views; import it again from `Standard` |
| No rows | The user has location groups assigned, and the Location Groups setting isn't excluding them |
| Settings don't stick | The admin has locked user editing (the panel says "Locked by admin") |

Turn on **Show debug console** to see the SQL, record counts and errors.
