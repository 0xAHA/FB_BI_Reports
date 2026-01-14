# Dashboard Tiles - Fishbowl BI Reports

## Overview

This collection of BI reports provides real-time visibility into Fishbowl operations through interactive HTML dashboards. Each report runs in JxBrowser and queries the Fishbowl database directly to display current status of orders, work orders, and inventory movements.

## Installation

### Prerequisites

Before installing the dashboard reports, create the following properties in **Setup > Property** and set their values to `false`:

| Property Name | Default Value | Purpose |
|---------------|---------------|---------|
| `BI_SHOW_DEBUG` | `false` | Enable/disable debug console for troubleshooting |
| `BI_SO_SHOW_ESTIMATE` | `false` | Show/hide estimate-related sales order data |
| `BI_PO_SHOW_BID_REQUEST` | `false` | Show/hide bid request purchase orders |

### Installation Steps

1. **Save Report Files**
   - Save all `.json` report files to a local folder on your computer

2. **Import Reports**
   - Open Fishbowl and navigate to **BI Editor**
   - Click the **Import** button
   - Select **ALL** `.json` files at once:
     - `Open Work Orders-Page.json`
     - `Open Transfer Orders-Page.json`
     - `Open Sales Orders-Page.json`
     - `Open RMA Orders-Page.json`
     - `Open Purchase Orders-Page.json`
     - `Items to be Shipped-Page.json`
     - `Items to be Received-Page.json`
     - `Items to be Picked-Page.json`

3. **Publish Reports**
   - Ensure the **Publish** checkbox is ticked
   - Select appropriate access rights for your user groups (View, Edit Settings)
   - Click **OK** to complete the import

4. **Enable Dashboard Gadgets**
   - Open each imported report in the BI Report window
   - Go to the **Details** tab
   - Check the **Dashboard Gadget** option
   - Click **Save**

5. **Access Reports**
   - All reports will now be available as Dashboard Gadgets in the BI Report list
   - Add them to your Fishbowl dashboard for quick access

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

- <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> **Red Clock** - Past due (scheduled date has passed)
- <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> **Orange Clock** - Due today (scheduled for current date)
- <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2d9cdb" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> **Blue Clock** - Due this week (scheduled within current calendar week)
- **No indicator** - Future date beyond current week

### Availability Status Indicators

Reports with inventory items (Picks, RMAs) show availability:

- <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#10b981" stroke="#059669" stroke-width="2"/></svg> **Green Circle** - All items fully available
- <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#fff3cd" stroke="#b8860b" stroke-width="2"/></svg> **Orange Circle** - Partial availability (mixed stock levels)
- <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#ef4444" stroke="#dc2626" stroke-width="2"/></svg> **Red Circle** - No items available
- <svg width="16" height="16" viewBox="0 0 16 16" fill="#f59e0b"><path fill-rule="evenodd" d="M5 6.5V4.5a3 3 0 1 1 6 0V6.5h1.5V4.5a4.5 4.5 0 0 0-9 0V6.5H5zM2.5 8A1.5 1.5 0 0 1 4 6.5h8A1.5 1.5 0 0 1 13.5 8v5.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V8zm10 0a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v5.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V8z"/></svg> **Padlock** - All items committed
- <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#9ca3af" stroke="#6b7280" stroke-width="2"/></svg> **Gray Circle** - No pending items

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
- **Note**: Column order cannot be saved in Fishbowl and will revert to default layout when the report is reloaded

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

## Known Limitations

### Column Order Persistence
- Column reordering via drag-and-drop is functional during a session
- However, column order cannot be saved in Fishbowl's JxBrowser environment (localStorage not supported)
- Columns will reset to their default order when the report is refreshed or reopened

### Clickable Links
- **Pick and Receive links do not work** - This is a Fishbowl limitation/bug
- The following clickable links work correctly:
  - Sales Order numbers → Opens Sales Order module
  - Purchase Order numbers → Opens Purchase Order module
  - Work Order numbers → Opens Work Order module
  - Transfer Order numbers → Opens Transfer Order module
  - RMA numbers → Opens RMA module

### Multi-Location Access
- Reports only display records for location groups assigned to the current user
- Users without location group assignments may see no data
- This is enforced via the UserToLG table relationship

## Technical Details

### Data Source
- Reports query Fishbowl database directly using `runQuery()` function
- Real-time data (no caching)
- User permissions enforced via UserToLG relationships

### Browser Compatibility
- Designed for JxBrowser within Fishbowl
- Uses modern CSS (flexbox, grid) and JavaScript (ES6)
- Note: Browser localStorage is not available in Fishbowl's JxBrowser implementation

### Performance
- Complex SQL queries with joins and subqueries
- Availability calculations for picks computed per-item
- Schedule status calculated client-side in JavaScript

### Customization

#### Custom Fishbowl Properties
Reports reference the following custom properties from **Setup > Property**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `DateFormatShort` | String | `dd/MM/yyyy` | Date display format used throughout reports |
| `BI_SHOW_DEBUG` | Boolean | `false` | Enable debug console showing SQL queries, counts, and errors |
| `BI_SO_SHOW_ESTIMATE` | Boolean | `false` | Show/hide estimate-related data in Sales Orders report |
| `BI_PO_SHOW_BID_REQUEST` | Boolean | `false` | Show/hide bid request orders in Purchase Orders report |

#### Report File Format
- Reports are distributed as `.json` files for import into Fishbowl BI Editor
- Each JSON file contains the HTML/CSS/JavaScript code for the dashboard
- Files are generated from source `.htm` files via an external conversion process

## Support

For issues or enhancement requests, contact your Fishbowl administrator or BI report developer.

---

**Last Updated**: 2026-01-14
**Version**: 1.0
**Reports**: 8 dashboards covering orders, manufacturing, and inventory operations
