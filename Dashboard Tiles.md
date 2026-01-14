# Dashboard Tiles - Fishbowl BI Reports

## Overview

This collection of BI reports provides real-time visibility into Fishbowl operations through interactive HTML dashboards. Each report runs in JxBrowser and queries the Fishbowl database directly to display current status of orders, work orders, and inventory movements.

## Available Reports

### Order Management
- **Open Sales Orders** - Active customer orders awaiting fulfillment
- **Open Purchase Orders** - Active vendor orders awaiting receipt
- **Open Work Orders** - Manufacturing orders in progress
- **Open RMA Orders** - Return merchandise authorizations with issue tracking
- **Open Transfer Orders** - Inter-location inventory transfers

### Inventory Operations
- **Items To Be Picked** - Pick tickets requiring action with availability status
- **Items To Be Received** - Receipts scheduled for incoming inventory
- **Items To Be Shipped** - Shipments ready for processing

## Common Functionality

### Schedule Status Indicators

All reports display schedule status using color-coded clock icons:

- **🔴 Red** - Past due (scheduled date has passed)
- **🟠 Orange** - Due today (scheduled for current date)
- **🔵 Blue** - Due this week (scheduled within current calendar week)
- **No indicator** - Future date beyond current week

### Availability Status Indicators

Reports with inventory items (Picks, RMAs) show availability:

- **🟢 Green Circle** - All items fully available
- **🟠 Orange Circle** - Partial availability (mixed stock levels)
- **🔴 Red Circle** - No items available
- **🔒 Padlock** - All items committed
- **⚪ Gray Circle** - No pending items

Hover over indicators to see detailed counts of full/partial/none items.

### Column Management

#### Sorting
- Click any column header to sort ascending
- Click again to sort descending
- Sort icon (⇅) indicates sortable columns
- Current sort column is visually highlighted

#### Filtering
- Type in filter boxes below column headers to filter data
- Filters are case-insensitive and search for partial matches
- Multiple filters work together (AND logic)
- Filter count displays when active: "Showing X of Y records"
- Click **Clear Filters** button to reset all filters

#### Reordering
- Drag column headers to reorder columns
- Column order is saved to browser localStorage
- Persists between sessions

#### Responsive Widths
- Tables use dynamic column sizing to prevent horizontal scrollbars
- Core columns (numbers, dates, status) have fixed widths
- Text columns (customer/vendor names) truncate with ellipsis (...)
- Hover over truncated text to see full value in tooltip

### Interactive Elements

#### Clickable Records
- Order/pick numbers are clickable links (blue, underlined on hover)
- Clicking opens the record in Fishbowl's native module
- Order references (SO-XXX, PO-XXX, etc.) also open their source orders

#### Refresh
- Click **Refresh** button to reload data from database
- All filters and column order are preserved during refresh

### Debug Mode

Enable debug console by setting Fishbowl custom field:
```
BI_SHOW_DEBUG = true
```

Debug console shows:
- SQL query execution
- Record counts and parsing
- Availability calculations
- Error messages

## Report-Specific Features

### Open Sales Orders
- Shows customer name and order status
- Schedule indicator for fulfillment dates
- Click-through to customer orders

### Open Purchase Orders
- Shows vendor name and order status
- Schedule indicator for expected receipt dates
- Click-through to vendor orders

### Open Work Orders
- Displays MO #, WO #, and BOM # for manufacturing tracking
- Shows scheduled start dates
- Status badges for work order progress

### Open RMA Orders
- **Issue Column** displays reason for return:
  - **DOA** - Dead on arrival (Issue ID = 2)
  - **Warranty** - Warranty claim (Issue ID = 3)
  - **-** - No issue specified (NULL)
- Groups items by product within each RMA
- Customer information and RMA type displayed

### Items To Be Picked
- Availability status for each pick ticket
- Links to source orders (SO/PO/WO/TO)
- Priority and scheduled date sorting
- Order info shows customer/vendor/location

### Items To Be Received
- Receipt type (PO/TO/RMA/WO)
- Vendor name for purchase receipts
- Schedule status for expected dates

### Items To Be Shipped
- Shipment details including carrier and service
- Ship-to information
- Order references with prefixes (SO-XXX, etc.)

### Open Transfer Orders
- From/To location groups
- Transfer type and status
- Scheduled and issued dates

## Usage Tips

### Optimizing for Lower Resolution Screens
Reports are designed to fit within available window space without horizontal scrolling. Column headings use abbreviated formats (e.g., "RMA #" instead of "RMA Number") to maximize space efficiency.

### Finding Overdue Items
1. Sort by schedule indicator column to group past due items at top
2. Look for red clock icons
3. Filter by status to focus on specific order states

### Tracking Availability
1. On pick reports, look for red/orange availability circles
2. Hover for detailed breakdown of full/partial/none items
3. Padlock icons indicate all items are committed but may not be picked yet

### Multi-Location Filtering
Reports automatically filter to show only records for location groups assigned to the current user (via UserToLG table).

### Custom Date Formats
Reports respect Fishbowl's DateFormatShort setting from custom fields. Default is dd/MM/yyyy if not specified.

## Technical Details

### Data Source
- Reports query Fishbowl database directly using `runQuery()` function
- Real-time data (no caching)
- User permissions enforced via UserToLG relationships

### Browser Compatibility
- Designed for JxBrowser within Fishbowl
- Uses modern CSS (flexbox, grid) and JavaScript (ES6)
- Requires browser localStorage for column order persistence

### Performance
- Complex SQL queries with joins and subqueries
- Availability calculations for picks computed per-item
- Schedule status calculated client-side in JavaScript

### Customization
Custom Fishbowl fields referenced:
- `DateFormatShort` - Date display format
- `BI_SHOW_DEBUG` - Enable debug console

## Support

For issues or enhancement requests, contact your Fishbowl administrator or BI report developer.

---

**Last Updated**: 2026-01-14
**Version**: 1.0
**Reports**: 8 dashboards covering orders, manufacturing, and inventory operations
