# Fishbowl BI Dashboards

This document describes the customisable drag-and-drop dashboard framework currently implemented in the **Sales Dashboard**. As the same framework is rolled out to the Inventory and Purchasing dashboards, those sections will be appended below.

Intended audience: the development team, as source material for the customer-facing wiki documentation. End-user-friendly phrasing has been used where practical.

---

## Sales Dashboard

- File: `Dashboards/Sales_Dashboard_DragDrop.htm`
- Original fixed-layout version (kept for reference): `Dashboards/Sales_Dashboard.htm`

### Overview

The drag-and-drop Sales Dashboard lets each user customise their own view of the same underlying data. Users can:

- Rearrange tiles
- Resize tiles
- Add tiles from a picker
- Remove tiles
- Rearrange / add / remove KPI summary badges in the header
- Change filters and the date range

All changes are saved per user, so different users see their own personalised dashboard.

Administrators can additionally publish a "master layout" that becomes the default for all users, and can lock down user customisation entirely (read-only mode for non-admins).

---

### Header

The top bar contains:

- **Dashboard title** with the active date range displayed underneath (e.g. *"1 Jul 2025 – 30 Jun 2026"*)
- **KPI badges** — small coloured pill cards summarising headline metrics
- **Filters** button (opens the filter panel)
- **Date range** selector with custom-range support
- **Refresh** button (re-runs all queries without changing layout)
- **Lock** toggle (padlock icon) — switches between locked and edit modes
- **Edit controls** (visible only when unlocked): Reset, Save Layout, Add Widget
- **Admin controls** (visible only to the admin user, when unlocked): Users editing toggle, Publish

#### KPI badges

A horizontal strip of small pill cards summarising the headline figures. Each badge shows an icon, value, and label, with a colour that matches the metric.

| Badge | Shows |
|---|---|
| Revenue | Total invoiced revenue |
| COGS | Cost of goods sold |
| Gross Profit | Revenue − COGS |
| Margin | Average gross margin % (colour: green ≥ 30%, amber ≥ 15%, red below) |
| Orders | Number of distinct sales orders |
| Avg Order | Average revenue per order |
| **Rev vs Prior** *(new)* | Revenue with inline ▲/▼ % change vs the prior period of equal length |

When the dashboard is **unlocked**, each badge gets a small ✕ remove button and a `+` button appears at the end of the strip to add any badge that isn't currently shown. Badges can be reordered by dragging them within the strip; the order persists with the rest of the user's saved layout.

---

### Tile grid

The main area is a 12-column responsive grid. Each tile supports:

- **Drag**: click and hold the tile header (anywhere except the action buttons) to move it.
- **Resize**: drag any edge or corner when unlocked.
- **Remove**: click the ✕ at the right of the tile header.
- **Info tooltip**: hover the ⓘ icon in the tile header to see a description of what the tile shows.

Minimum tile sizes:
- All tiles: minimum **height of 2** grid rows.
- KPI tiles: minimum **width of 2** grid columns.
- Other tiles: minimum width of 1 column (rarely useful).

#### Narrow tile fallback

If a tile is sized to exactly 1 column wide (KPI tiles cannot reach this size due to their minimum-width constraint), the tile header is hidden and a short text label (e.g. *"GP $"*, *"Revenue"*) appears below the value to keep the tile readable in tight spaces.

#### Adding tiles

When the dashboard is unlocked, click **Add Widget** to open the picker modal. Tiles are organised by tab: **All / KPIs / Charts / Tables**. Each card shows the tile's icon, title, description, default size, and category badge. Click "**+ Add to Dashboard**" on a card to drop it into the first available grid slot at its default size.

For the *Monthly Revenue & Margin* tile, the picker also lets you choose Bar or Line for the chart's initial render mode.

---

### Date range and filters

The **date range** selector at the top of the header offers these presets:

- Today / This Week / This Month / Last Month
- Last 30 / 60 / 90 / 180 / 365 days
- This Quarter / Last Quarter
- **Current Financial Year** (default) / Last Financial Year
- Current Calendar Year / Last Calendar Year
- **Custom Range** — reveals two date inputs for an explicit start and end

The financial year boundary is read from the system property `BI_FY_START_MONTH` (default `7` = July).

The **Filters** button (top-right) opens a panel below the header with four optional filters:

| Filter | Notes |
|---|---|
| Customer Group | All account groups, sorted alphabetically |
| Product Category | All product trees, sorted alphabetically |
| Sales Person | All sales people who have orders in the system |
| Margin Level | Good (≥ 30%) / Medium (15–30%) / Low (< 15%) |

Every visible tile re-queries when the date range or any filter changes.

The active date range is shown under the dashboard title as a reminder.

---

### Save / Reset / Refresh

- **Refresh** (circular arrow icon) — re-runs all tile queries. Useful after data changes in Fishbowl. Doesn't change the layout. Available whether locked or unlocked.
- **Save Layout** — persists the current layout, filter state, lock state, and badge configuration to the logged-in user's account. Only available when unlocked.
- **Reset** — restores the default layout. The reset is local until you click Save Layout (so you can revert by refreshing the page without saving). Only available when unlocked.

---

### Lock / unlock

Click the padlock icon to toggle between **locked** and **edit** modes. The lock state auto-saves whenever you toggle it.

- **Locked** (padlock closed, grey): drag handles, resize handles, ✕ remove buttons, edit controls, and the badge `+` button are all hidden. Tiles cannot be moved or removed. Hover effects on tile headers are disabled.
- **Unlocked** (padlock open, blue): all edit affordances are visible. The dashboard is fully editable.

The dashboard always opens in the state it was last saved in.

---

### Admin features

The dashboard treats a single user as the administrator. Admin identity is determined by either:

- `sysuser.id` matching the system property `BI_ADMIN_USER_ID` (default: `1`), **or**
- Username matching the system property `BI_ADMIN_USER` (case-insensitive; default: empty/disabled)

When the admin user is logged in **and** the dashboard is unlocked, two extra controls appear in the edit bar:

#### Publish master layout

The **Publish** button captures the admin's current layout, badge configuration, and filter state, and stores them as the dashboard-wide default. This master layout:

- Becomes the layout shown to non-admin users **only** when user editing is disabled (see below).
- Does **not** override a user's own saved layout while user editing is enabled.
- Is shared across all users — stored at the report level, not per user.

#### Users editing toggle

A coloured pill button toggles between two states:

- **Users: Can Edit** (green) — default. Each user has their own customisable, independent layout. The master layout serves only as the initial starting point for users who have never saved their own.
- **Users: Read Only** (red) — non-admin users see the master layout exactly as published. Their lock toggle is hidden, the dashboard is permanently locked for them, and their own saved layouts are ignored. Filter state from the master is also applied.

The admin's own dashboard is unaffected either way; admins always retain full edit capability regardless of this setting.

---

### Persistence model

| What's saved | Storage API | Key | Scope | Trigger |
|---|---|---|---|---|
| User layout, filters, badges, lock state | `saveSettings` / `loadSettings` | `cdx.bi.sales-dashboard-grid` | Per Fishbowl user | Save Layout button, lock toggle |
| Master layout, master filters, master badges, user-editing flag | `saveReportData` / `loadReportData` | (single blob per report) | Per report — shared by all users | Publish button, Users: Can Edit / Read Only toggle |

Both stores are read on every page load. The decision logic at load:

1. If the user is an admin **or** user editing is allowed → load the user's own saved layout (falling back to the master layout, then to the built-in default if neither exists).
2. Else (non-admin and user editing disabled) → load the master layout, ignore the user's own saves, force locked.

The saved-payload shape (`{ v: 2, layout, locked, filterState, badgeConfig }`) is versioned for forward compatibility.

---

### Available tiles

The dashboard ships with the following tiles. Tiles marked **★ new** were added in this update.

#### KPI tiles (single-value summary cards)

| Tile | Description |
|---|---|
| Total Revenue | Total invoiced revenue for the period |
| Cost of Goods *(★ new as a tile — was previously badge-only)* | Total cost of goods sold |
| Gross Profit | Revenue − COGS |
| Avg Gross Margin | Average gross margin percentage |
| Order Count | Number of sales orders |
| Avg Order Value | Average revenue per order |
| **Revenue vs Prior** *(★ new)* | Total revenue with inline ▲/▼ % change vs the equivalent-length prior period (e.g. "Last 30 Days" compares against days −60 to −30) |

#### Chart tiles

| Tile | Description |
|---|---|
| Monthly Revenue & Margin | Revenue trend with gross margin % overlay; toggle bar/line via the icon in the tile header |
| Top Customers by Revenue | Top 10 customers ranked by revenue; bars colour-coded by margin tier; click a bar to drill into that customer's orders |
| Top Products by Qty | Top 10 products ranked by units sold |
| Sales by Category | Donut split of revenue by product category |
| Customer Groups | Donut split of revenue by customer account group |
| Top Salespeople | Revenue per salesperson; colour-coded by margin |
| Low Margin Customers | Customers with average margin < 15%; sorted worst first |
| Orders per Salesperson | Order count and revenue per salesperson |
| **Top Products by Revenue** *(★ new)* | Top 10 products ranked by revenue (companion to "Top Products by Qty") |
| **Top Customers by Margin** *(★ new)* | Top 10 customers ranked by gross margin % (minimum $1k revenue); surfaces the most *profitable* customers, which can differ sharply from the highest-revenue ones |
| **New vs Repeat Customers** *(★ new)* | Donut splitting period revenue between first-time and returning customers. A core retention KPI. |
| **Margin Mix** *(★ new)* | Donut splitting period revenue into three margin tiers: Good (≥ 30%) green, Medium (15–30%) amber, Low (< 15%) red. At-a-glance health check on margin quality. |

#### Table tiles

| Tile | Description |
|---|---|
| Monthly Revenue Table | Sortable table of monthly revenue, COGS, and margin. Month column sorts chronologically. |
| Customer Revenue Table | Top customers with Orders, Revenue, Gross Profit, and Margin %, sortable. |
| High Value Orders | Individual orders exceeding $10,000 in revenue |
| **Negative Margin Orders** *(★ new)* | Individual orders sold at a loss (margin < 0%), sorted worst-first. Operational worklist. |

---

### System properties

The following Fishbowl system properties affect dashboard behaviour:

| Property | Default | Purpose |
|---|---|---|
| `BI_FY_START_MONTH` | `7` | First month of the financial year (1–12). Drives the "Current Financial Year" / "Last Financial Year" date presets. |
| `BI_ADMIN_USER_ID` | `1` | Numeric `sysuser.id` of the admin user. Set to the ID of the user who should have admin (publish/lock) rights. |
| `BI_ADMIN_USER` | (empty) | Alternative: admin user identified by username (case-insensitive). Either property can trigger admin mode — useful if the admin's `userName` is set but their ID isn't `1`. |
| `BI_SHOW_DEBUG` | `false` | When `true`, shows a collapsible debug console fixed at the bottom of the dashboard with query / event logging. Mainly for development and customer-support diagnostics. |

---

### Notes for the development team

- Single-file report; no external assets beyond CDN-hosted libraries (GridStack 10.3.1, D3 v7, Tailwind, Moment.js 2.29.4, Inter font from Google Fonts).
- All tile rendering is asynchronous with per-tile loading spinners. Slow tiles don't block fast ones.
- Queries are cached per filter state via a small in-memory cache (`qget` / `qclear`). Filter changes invalidate the cache and re-render every tile in place.
- Adding a new tile requires one entry in `WIDGET_REGISTRY` (title, description, icon, default size, render function) and one entry in the `Q` object (the SQL data fetch). Existing render helpers (`renderKPI`, `renderHorizBar`, `renderDonut`, `renderTimeSeries`, `renderSortableTable`) cover most needs.
- Margin at any aggregate level should be computed as `(SUM(revenue) − SUM(cogs)) / SUM(revenue)`. Avoid `AVG(per_row_margin)` — when individual lines have near-zero revenue (e.g. kit discount lines), per-row margin explodes and the average becomes meaningless.
- Run inside the Fishbowl Advanced client BI Script Editor for development. The dashboard auto-detects whether `runQueryAsync` is available and uses it (non-blocking); falls back to `runQuery` otherwise.

---

## Inventory Dashboard

*Drag-and-drop conversion pending. The same framework documented above will apply once the Inventory Dashboard is ported. Documentation will be added here at that point.*

---

## Purchasing Dashboard

*Drag-and-drop conversion pending. The same framework documented above will apply once the Purchasing Dashboard is ported. Documentation will be added here at that point.*
