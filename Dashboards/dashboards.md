# Fishbowl BI Dashboards (v1.2)

This document covers the three customisable analytics dashboards: **Sales**,
**Inventory** and **Purchasing**. All three run on one shared framework. Each
user can arrange their own tiles and KPI badges, and an admin can publish a
default layout for everyone and lock it.

It is written for the development team, as the source for customer-facing
wiki pages.

| Dashboard | File | Record name | Storage key |
|---|---|---|---|
| Sales | `Sales_Dashboard_v1.2.htm` | `- Dashboard - Sales v1.2` | `cdx.bi.salesdash` |
| Inventory | `Inventory_Dashboard_v1.2.htm` | `- Dashboards - Inventory v1.2` | `cdx.bi.invdash` |
| Purchasing | `Purchasing_Dashboard_v1.2.htm` | `- Dashboard - Purchasing v1.2` | `cdx.bi.purchdash` |

`Sales_Dashboard.htm`, `Inventory_Dashboard.htm` and `Purchasing_Dashboard.htm`
are the older fixed-layout versions. `Sales_Dashboard_DragDrop.htm` and
`Sales_Dashboard_Grid_POC.htm` are prototypes of the Sales v1.2 dashboard.

---

## Installation

The dashboards load two shared assets by record name. Import them first, in
this order, from BI Reports ▸ `Standard`:

1. `fb-styles-Style.json`, the Style `fb-styles`
2. `fb-lib-Script.json`, the Script `fb-lib`

Then import the dashboard's `-Page.json` and tick **Dashboard Gadget** on its
Details tab. If fb-lib is missing, the page shows "fb-lib not loaded".

**Internet access is required.** GridStack 10.3.1, D3 v7, Tailwind,
moment.js 2.29.4 and the Inter / Space Mono fonts all load from CDNs. On a
network without internet access the dashboards don't render.

No system properties are required (see [System properties](#system-properties)).

---

## Shared framework

### Header

- **Title and date line.** The dashboard name, with the active date range
  underneath.
- **KPI badges.** A strip of small summary pills.
  - When unlocked, drag to reorder, ✕ to remove, and **+** to add a badge.
- **Zoom.** − / % / +, from 50% to 130% in 5% steps.
  - Clicking the % fits the dashboard to a 1920px width.
  - The zoom level is saved per user.
- **Refresh (↻).** Re-runs every tile's query without changing the layout.
- **Padlock.** Switches between locked (view) and edit mode.
- **Edit controls** (unlocked only): **Reset**, **Save Layout**, **Add Widget**.
- **Admin controls** (unlocked, admin only): the **Users: Can Edit / Users:
  Read Only** toggle and **Publish**.
- **Help (?)** opens the Instructions drawer. Its text is specific to each
  dashboard.
- **Gear** opens the Settings drawer:
  - **Show debug console**;
  - **Reset my saved layout & filters**;
  - on Sales only, **Product categories ▸ Category level**.

### Filter strip

- **Date range presets:**
  - Today, This Week, This Month, Last Month;
  - Last 30 / 60 / 90 Days, Last 6 Months, Last Year;
  - This / Last Quarter;
  - Current / Last Financial Year;
  - Current / Last Calendar Year;
  - Custom Range.
- **Dimension filters:** one multi-select per dimension (see each dashboard
  below). Each has its own Clear, and an overall **Clear** chip resets them
  all.
- **Re-querying:** every tile re-queries when the date range or a filter
  changes.

### Tile grid

The dashboard is a 12-column GridStack grid. When unlocked:

- drag a tile by its header;
- resize it from any edge;
- remove it with ✕.

Every tile header has:

- an ⓘ that shows the tile's description;
- an **Export this tile to CSV** button (all tiles except KPIs).

**Add Widget** opens a picker with **All / KPIs / Charts / Tables** tabs. Each
card shows the tile's title, description and default size.

### Drill-downs

Clicking a chart bar, a donut segment or a name opens a drill-down window.

- The window has a search box and sortable columns, and **Export CSV**.
- On Sales and Purchasing, each row expands to show its order lines.
- Order and part numbers open the Fishbowl record.

### Lock, publish and read-only mode

- **Locked** hides every edit affordance. The dashboard opens in whichever
  state the user last saved.
- **Save Layout** saves the user's own layout, filters, badges and lock state.
- **Reset** restores the default layout. Nothing is saved until **Save
  Layout** is clicked.
- **Publish** (admin) saves the admin's layout, filters and badges as the
  **master** layout.
  - Users who have never saved a layout get the master.
  - Users who have saved one keep theirs.
- **Users: Read Only** (admin) makes every non-admin user see the master
  layout.
  - It is shown read-only and the padlock is hidden.
  - Their own saved layouts are ignored, and a save shows "Locked by admin".
- **Users: Can Edit** switches back.

An admin is the Fishbowl user named `admin` or any user with the `Admin`
access right (`FBLib.Settings.isAdmin()`).

### Persistence

The dashboards use `FBLib.Settings` with `masterStorage: 'userProperties'`.

| What | Key | Written by |
|---|---|---|
| User layout, filters, badges, lock, zoom, debug (Sales: category level) | `<key>.user.v1` | Save Layout, the lock toggle, zoom, the Settings drawer |
| Master layout, filters, badges, read-only flag | `<key>.master.v1` | Publish, the Users toggle (admin only) |

The master is written to the admin's own `userproperties` row and read by
everyone. It doesn't depend on the report having a saved report-data record.

**Sales migration.** Sales v1.2 copies an older per-user layout from
`cdx.bi.sales-dashboard-grid` once, and leaves the old key in place. It
rescales old layouts to the 40px row height.

---

## Sales Dashboard

**Filters:**

- Customer Group
- Product Category
- Sales Person
- Margin: Good (> 30%), Medium (15–30%), Low (< 15%)

**Default date range:** Current Financial Year.

**Category level (Settings)** sets how deep in the Product Tree the categories
roll up. It is saved per user and can be published. **Refresh** also reloads
the Product Tree.

| Type | Tiles |
|---|---|
| KPI | Total Revenue, Order Count, Avg Order Value, Avg Gross Margin, Gross Profit, Cost of Goods, Revenue vs Prior |
| Chart | Monthly Revenue & Margin (bar/line), Top Customers by Revenue, Top Customers by Margin, Top Products by Qty, Top Products by Revenue, Sales by Category, Customer Groups, Top Salespeople, Orders per Salesperson, Low Margin Customers, High Value Orders, New vs Repeat Customers, Margin Mix |
| Table | Monthly Revenue Table, Customer Revenue Table, Negative Margin Orders |

Notes on specific tiles:

- **Revenue vs Prior** compares with the previous period of the same length.
- **Top Customers by Margin** only includes customers with at least $1k of
  revenue.
- **High Value Orders** lists orders over $10k.

**Drill-downs:** Customer, Month, Category, Customer Group, Salesperson,
Product, and New/Repeat.

Margin at any aggregate level is `(SUM(revenue) − SUM(cogs)) / SUM(revenue)`,
never an average of per-line margins.

---

## Inventory Dashboard

**Filters:**

- Location Group
- Vendor (the part's default vendor)

**Default date range:** Last 90 Days.

Each tile description starts with **Snapshot** (current state; ignores the
date range) or **Dated** (uses the date range).

| Type | Tiles |
|---|---|
| KPI | Total Inventory Value, Active SKUs, Units On Hand, Below Reorder Point, Unavailable Value, Stock Loss, Short Pick Parts, Inventory Revenue |
| Chart | Stock Value by Location Group (bar/donut), Top Parts by Value, Stock Value by ABC Code, Stock Movements (Value), Stock Movement Trend (bar/line, # / $), Slow-Moving Inventory |
| Table | Stock by Location Group, Inventory Availability (By LG / Company), Below Reorder Point, Unavailable Stock, Short Parts in Picking, Fulfillment Pipeline, Cycle Count Adjustments, Scrap, Received Lines, Shipped Lines, Stock-Out Risk (Days of Cover), Expiring Lots (90 Days), Suggested Reorders, Negative Inventory |

**Drill-downs:** Location Group, ABC code (with an "All parts" view), and
Movement. Bars on Top Parts by Value and Slow-Moving Inventory open the
part.

---

## Purchasing Dashboard

**Filters:**

- Vendor
- Category
- ABC Code (A / B / C / N)
- Location Group

**Default date range:** Last 90 Days.

| Type | Tiles |
|---|---|
| KPI | Total Spend, Inventory Spend, Other Spend, POs Received, Avg PO Value, Avg Lead Time |
| Chart | Monthly PO Spend, PO Status Overview, Top Vendors by Spend, Top Vendors by PO Count, Vendor On-Time Performance, Top Products by Qty, Purchases by Category, Open PO Value by Week Due, Lead Time Trend |
| Table | Expected Receipts (7 Days), Overdue POs, Recently Received, High Value POs, Pending Approval |

Notes on specific tiles:

- **Avg Lead Time** is green at 7 days or less and amber up to 14.
- **Vendor On-Time Performance** is an approximation and needs at least 3
  lines per vendor.
- **Pending Approval** lists POs in status 15.

**Drill-downs:** Vendor, Category, PO Status, and Week.

---

## System properties

All optional.

| Property | Default | Purpose |
|---|---|---|
| `BI_FY_START_MONTH` | `7` | First month of the financial year (1–12), used by the financial-year presets |
| `BI_SHOW_DEBUG` | `false` | `true` turns on debug logging |
| `BI_ADMIN_USER_ID` / `BI_ADMIN_USER` | `1` / empty | Sales only, legacy. Admin tools now need the `Admin` access right. A matching user without it gets a toast saying so |

Currency comes from `currencyLocale()`, falling back to `$` / en-US.

---

## Known gaps

- **Location groups aren't restricted per user.** The Location Group filter
  lists every active location group, and no tile applies the user's assigned
  groups (`getLocationGroupList()`). The order tiles and Dashboard - Company
  do apply them.
- **No saved views or .xlsx export.** Export is CSV per tile and per
  drill-down.

---

## Notes for the development team

- **Adding a tile.** A tile needs:
  - an entry in `WIDGET_REGISTRY` (title, description, category, default size,
    render function);
  - its query.

  The shared render helpers cover KPIs, horizontal bars, donuts, time series
  and sortable tables.
- **Loading.** Every tile renders asynchronously with its own spinner, so a
  slow tile doesn't block the rest.
- **Queries.** They go through `runQueryAsync` when it's available.
- **Styling.** It comes from fb-styles (the Workspace chrome). Deploy
  fb-styles, then fb-lib, then the dashboards.
