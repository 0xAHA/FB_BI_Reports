# Traceability Report - Implementation Plan

## Design Decision: Single Chronological Table

After analyzing the codebase and the QA traceability use case, I recommend **a single unified chronological table** rather than splitting into separate tables for finished goods, raw goods, sales orders, purchase orders, etc.

### Why a single table?

1. **QA traceability follows the lifecycle** - When tracing a quality issue, you need the complete story: raw material received (PO) → consumed in manufacturing (WO) → finished good built (WO) → shipped to customer (SO). Splitting this into separate tables forces the user to cross-reference between sections.

2. **Date ordering tells the story** - A chronological view lets QA follow the timeline naturally: "This batch of raw material arrived on Jan 5, was consumed into WO-1234 on Jan 8, the finished good was built on Jan 10, and shipped on SO-5678 on Jan 12."

3. **Movement type badges provide visual grouping** - Color-coded badges (Receive = green, Ship = blue, Build = purple, Consume = orange, Adjust = yellow, Scrap = red) let users visually scan for specific types without needing separate tables.

4. **Per-column filters already handle narrowing** - The existing filter-row pattern from Dashboard_Combined lets users type "Ship" in the movement type column to see only shipments, or type a WO number in the order column to see only that work order's activity. This effectively gives "separate table" behavior on demand.

5. **Simpler to search** - The top-level search box searches across ALL columns, so typing a part number or tracking detail immediately shows every movement involving that item regardless of type.

### What it would look like with separate tables (rejected approach)

Separate tables would mean: a "Purchases" section, a "Manufacturing" section, a "Sales/Shipments" section, an "Adjustments" section. The user would need to visually jump between sections to trace a part. For a report whose primary purpose is *tracing a single part/batch through the system*, this creates friction rather than reducing it.

---

## Report Layout

### Header
- Title: **"Traceability Report"**
- Subtitle: "Part & batch movement history for QA traceability"
- Last updated timestamp
- Action buttons: Export CSV, Refresh

### Search Section (prominent, above filters)
A large search input field that acts as the primary entry point. The user types a part number, description keyword, work order number, or tracking detail (serial/lot/batch number). This runs a SQL query with `LIKE '%search%'` across multiple fields.

- **Search input**: Full-width text field with search icon, placeholder: "Search part number, description, work order, tracking info..."
- **Search button**: "Search" (triggers query)

### Filter Section (below search)
Using the same filter card pattern from Core_Template:
- **Date Range**: Same dropdown as other reports (This Quarter, Last Quarter, This FY, Last FY, Custom)
- **Movement Type**: Dropdown - All / Receive / Ship / Transfer / Build / Consume / Adjust+ / Adjust- / Scrap / Cycle Count
- **Location Group**: Dropdown (auto-populated from user's assigned location groups)
- **Order Type**: Dropdown - All / Sales Order / Purchase Order / Work Order / Transfer Order

### KPI Summary Cards (in header area)
After a search is executed, show summary metrics:
- **Total Movements** - Count of rows returned
- **Unique Parts** - Count of distinct part numbers in results
- **Net Qty Change** - Sum of all +/- quantities (net in/out)
- **Date Range** - Earliest to latest date in results

### Results Table
Single table using `.tile-table` styling from Dashboard_Combined, with filter-row inputs below each column header.

| Column | Data Key | Notes |
|--------|----------|-------|
| Date | `dateCreated` | InventoryLog.DateCreated, formatted with MOMENT_DATE_FORMAT |
| Movement | `movementType` | Color-coded badge (Receive, Ship, Build, Consume, Transfer, Adjust+, Adjust-, Scrap, Cycle Count) |
| Part # | `partNum` | Clickable order-link to open Part module in Fishbowl |
| Description | `partDesc` | Part.Description |
| Qty | `qty` | Signed quantity (+/-), formatted to 2 decimal places |
| UOM | `uom` | Unit of Measure abbreviation |
| Order | `orderInfo` | Order type prefix + number (e.g., "SO 50123", "WO 1234", "PO 789"), clickable to open in Fishbowl |
| Customer/Vendor | `entityName` | Customer name (for SO/Ship) or Vendor name (for PO/Receive) |
| Location | `locationGroup` | LocationGroup.Name |
| *Dynamic tracking columns* | *varies* | See "Dynamic Tracking Columns" section below |

Each column header is sortable (click to toggle asc/desc). Each column has a filter-row input below for per-column text filtering.

### Dynamic Tracking Columns

Different Fishbowl installations have different tracking types configured (Serial Number, Batch/Lot Number, Expiration Date, custom tracking fields, etc.). Rather than hardcoding a single "Tracking" column, the report will:

1. **On page load**, run a discovery query to find all distinct tracking types configured in the system:
   ```sql
   SELECT DISTINCT pt.Id, pt.Name, pt.Abbr, pt.SortOrder FROM PartTracking pt ORDER BY pt.SortOrder, pt.Name
   ```
2. **Dynamically create one column per tracking type** found, using `PartTracking.Abbr` as the column header (compact). The full `Name` is set as the column's `title` attribute for tooltip on hover.
3. **Populate each column** with the corresponding `TrackingInfo.Info` value for that movement's tag, matched by `PartTracking.Id`.
4. **Each dynamic column gets its own filter-row input**, so users can filter specifically by serial number, batch number, etc.

This means:
- A system with Serial + Batch tracking gets columns: `... | SN | Batch` (abbreviations)
- A system with only Lot tracking gets: `... | Lot`
- A system with no tracking configured gets no extra columns (clean, no empty columns)

The SQL for the main query uses conditional aggregation to pivot tracking types into columns:
```sql
-- For each discovered tracking type (by Id), add:
MAX(CASE WHEN pt.Id = 1 THEN ti.Info END) AS tracking_1,   -- e.g. header: "SN"
MAX(CASE WHEN pt.Id = 2 THEN ti.Info END) AS tracking_2,   -- e.g. header: "Batch"
-- etc. (built dynamically in JavaScript based on discovery query results)
```

The search input also searches across all dynamic tracking columns, so searching for a serial number or batch number will find matching movements regardless of tracking type.

### Movement Type Badge Colors
| Type | Badge Color | Background | Text |
|------|------------|------------|------|
| Receive | Green | `#d4edda` | `#155724` |
| Ship | Blue | `#cce5ff` | `#004085` |
| Build | Purple | `#e8daef` | `#4a235a` |
| Consume | Orange | `#fff3cd` | `#856404` |
| Transfer | Teal | `#d1ecf1` | `#0c5460` |
| Adjust+ | Light Green | `#d4edda` | `#155724` |
| Adjust- | Light Red | `#f8d7da` | `#721c24` |
| Scrap | Red | `#f8d7da` | `#721c24` |
| Cycle Count | Gray | `#e2e8f0` | `#475569` |

---

## SQL Query Design

### Primary Query (InventoryLog-based)
The core data source is the `InventoryLog` table, which captures every inventory movement. We JOIN to related tables to get order numbers, part details, and tracking info.

```sql
SELECT
    il.DateCreated AS dateCreated,
    il.Qty AS qty,
    ilt.Name AS movementTypeName,
    il.InventoryLogTypeId AS movementTypeId,
    p.Num AS partNum,
    p.Description AS partDesc,
    u.Code AS uom,
    lg.Name AS locationGroup,
    -- Order info: determine which order this movement relates to
    CASE
        WHEN il.TableId = 19 THEN 'SO'    -- SoItem table
        WHEN il.TableId = 22 THEN 'PO'    -- PoItem table
        WHEN il.TableId = 34 THEN 'WO'    -- WoItem table
        WHEN il.TableId = 46 THEN 'TO'    -- XoItem table
        ELSE ''
    END AS orderType,
    -- Resolve order numbers via RecordId → parent order
    COALESCE(so_num.Num, po_num.Num, wo_num.Num, xo_num.Num, '') AS orderNum,
    -- Customer or Vendor name
    COALESCE(cust.Name, vend.Name, '') AS entityName,
    -- Dynamic tracking columns (built in JS based on discovery query)
    -- e.g.: MAX(CASE WHEN pt.Name = 'Serial Number' THEN ti.Info END) AS tracking_serial_number,
    -- e.g.: MAX(CASE WHEN pt.Name = 'Batch Number' THEN ti.Info END) AS tracking_batch_number,
    {DYNAMIC_TRACKING_COLUMNS}
FROM InventoryLog il
INNER JOIN Part p ON il.PartId = p.Id
LEFT JOIN InventoryLogType ilt ON il.InventoryLogTypeId = ilt.Id
LEFT JOIN Uom u ON p.UomId = u.Id
LEFT JOIN LocationGroup lg ON il.LocationGroupId = lg.Id
-- Join to resolve order numbers
LEFT JOIN SoItem soi ON il.TableId = 19 AND il.RecordId = soi.Id
LEFT JOIN So so_num ON soi.SoId = so_num.Id
LEFT JOIN Customer cust ON so_num.CustomerId = cust.Id
LEFT JOIN PoItem poi ON il.TableId = 22 AND il.RecordId = poi.Id
LEFT JOIN Po po_num ON poi.PoId = po_num.Id
LEFT JOIN Vendor vend ON po_num.VendorId = vend.Id
LEFT JOIN WoItem woi ON il.TableId = 34 AND il.RecordId = woi.Id
LEFT JOIN Wo wo_num ON woi.WoId = wo_num.Id
LEFT JOIN XoItem xoi ON il.TableId = 46 AND il.RecordId = xoi.Id
LEFT JOIN Xo xo_num ON xoi.XoId = xo_num.Id
-- Tracking info via Tag → TrackingInfo → PartTracking
LEFT JOIN Tag tag ON il.PartId = tag.PartId AND il.LocationId = tag.LocationId
LEFT JOIN TrackingInfo ti ON ti.TagId = tag.Id
LEFT JOIN PartTracking pt ON ti.PartTrackingId = pt.Id
-- User location group filter
INNER JOIN UserToLG ON il.LocationGroupId = UserToLG.LocationGroupId AND UserToLG.UserId = ?
WHERE
    p.TypeId = 10  -- Inventory parts only
    AND il.DateCreated BETWEEN ? AND ?
    AND (
        p.Num LIKE '%search%'
        OR p.Description LIKE '%search%'
        OR COALESCE(so_num.Num, po_num.Num, wo_num.Num, xo_num.Num, '') LIKE '%search%'
        OR COALESCE(ti.Info, '') LIKE '%search%'
    )
GROUP BY il.Id
ORDER BY il.DateCreated DESC
```

### Discovery Query (run once on page load)
```sql
SELECT DISTINCT pt.Id, pt.Name, pt.Abbr, pt.SortOrder
FROM PartTracking pt
ORDER BY pt.SortOrder, pt.Name
```
This returns the tracking types configured in the system (e.g., Id=1 Name="Serial Number" Abbr="SN"). The JavaScript then uses these to:
1. Build the dynamic `CASE WHEN pt.Id = X` columns in the main query
2. Generate `<th title="Serial Number">SN</th>` headers (Abbr as display, Name as tooltip) and filter-row inputs

**Notes on TableId values**: The exact TableId values for SoItem, PoItem, WoItem, XoItem need to be verified against the Fishbowl schema. The InventoryLog.TableId and RecordId columns link back to the source record that triggered the movement. We may need to query `SELECT Id, TableName FROM TableList` to discover the correct mappings, or use the known Fishbowl convention.

---

## Associated Orders & Recall Contact List

After a search is performed, a **"View Associated Orders"** button appears in the header area (next to Export CSV). Clicking it opens a modal with two tabs:

### Tab 1: Associated Orders
Grouped lists of all orders linked to the search results, with clickable order numbers:

**Sales Orders**
| SO # | Date | Customer | Status | Customer PO |
|------|------|----------|--------|-------------|

**Purchase Orders**
| PO # | Date | Vendor | Status | Customer SO |
|------|------|--------|--------|-------------|

**Work Orders**
| WO # | Date Scheduled | MO # | Status | BOM |
|------|----------------|-------|--------|-----|

**Transfer Orders**
| TO # | Date | From Location | To Location | Status |
|------|------|---------------|-------------|--------|

These are derived from the distinct order numbers already present in the main results table (no additional query needed - just de-duplicate the orderNum values from the loaded data and group by type).

### Tab 2: Recall Contact List
For QA recall scenarios - a table of all customers who received the searched part/batch, with contact details for outreach:

| Customer | Contact Name | Email | Phone | SO # | Ship Date | Qty Shipped |
|----------|-------------|-------|-------|------|-----------|-------------|

This requires a separate query that joins through SO → Customer → Contact to pull contact details:
```sql
SELECT DISTINCT
    c.Name AS customerName,
    con.FirstName, con.LastName,
    COALESCE(conemail.Datum, '') AS email,
    COALESCE(conphone.Datum, '') AS phone,
    so.Num AS soNum,
    s.DateCreated AS shipDate,
    si.QtyShipped AS qtyShipped
FROM Ship s
INNER JOIN ShipItem si ON si.ShipId = s.Id
INNER JOIN So so ON s.SoId = so.Id
INNER JOIN Customer c ON so.CustomerId = c.Id
LEFT JOIN Contact con ON c.AccountId = con.AccountId
LEFT JOIN ContactDetail conemail ON con.Id = conemail.ContactId AND conemail.TypeId = (email type)
LEFT JOIN ContactDetail conphone ON con.Id = conphone.ContactId AND conphone.TypeId = (phone type)
WHERE si.PartId IN (... part IDs from search results ...)
    AND s.DateCreated BETWEEN ? AND ?
ORDER BY c.Name, s.DateCreated DESC
```

Both tabs have their own **"Export CSV"** button so users can export the associated orders list or the recall contact list independently for distribution to the QA team or for customer outreach.

---

## Technical Implementation

### File Location
`/home/user/FB_BI_Reports/Dashboards/Traceability_Report.htm`

### Architecture
- **Single self-contained .htm file** (following the pattern of other individual page reports)
- Uses Core_Template structure (header, filters, content area, debug console)
- Uses `.tile-table` CSS from Dashboard_Combined for the results table
- Uses `runQuery()` API for SQL execution
- Uses `getUser()` for location group filtering
- Uses `openModule()` for clickable order links
- Uses `moment.js` for date formatting

### Key Behaviors
1. **On page load**: Run discovery query for tracking types, then show empty state with search prompt ("Enter a search term to view traceability data")
2. **On search**: Execute query, populate KPI cards and table (with dynamic tracking columns)
3. **Per-column filters**: Client-side filtering on already-loaded data (same as Dashboard_Combined)
4. **Sorting**: Click column headers to sort (same pattern)
5. **CSV Export**: Export current filtered/sorted view to CSV
6. **Clickable links**: Part numbers open Part module, order numbers open respective module (SO/PO/WO/TO)
7. **Associated Orders modal**: Button appears after search; Tab 1 shows grouped order lists, Tab 2 shows recall contact list with customer email/phone; both tabs have independent CSV export
8. **Debug console**: Collapsible panel showing SQL queries executed

### Dependencies
- Moment.js (date formatting)
- Google Fonts Inter (typography)
- Fishbowl API: `runQuery()`, `getUser()`, `getProperty()`, `openModule()`
