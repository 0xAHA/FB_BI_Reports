# Dashboard Combined - Fishbowl BI Report

## Overview

The **Dashboard Combined** is an all-in-one BI report that displays up to 8 interactive tiles in a configurable grid layout. This single dashboard consolidates all individual order and inventory reports into one unified view, allowing you to monitor your entire Fishbowl operation from a single screen.

Each tile functions as a mini-dashboard showing real-time data from the Fishbowl database with full sorting, filtering, and interactive capabilities. The layout, tile selection, and display options are fully configurable through Fishbowl custom properties.

### Key Features
- **Single Dashboard View** - All 8 report types in one place
- **Configurable Layout** - Choose 1, 2, 3, or 4 column grid layouts
- **Tile Selection** - Display only the tiles you need
- **Consistent Functionality** - All tiles support sorting, filtering, and click-through to records
- **Responsive Design** - Tiles adjust height automatically based on content
- **Real-Time Data** - Direct database queries for current status

## Installation

### Prerequisites

Before installing the combined dashboard, create the following properties in **Setup > Property**. These properties control both the dashboard behavior and individual tile visibility.

#### Required Properties

| Property Name | Default Value | Purpose |
|---------------|---------------|---------|
| `FBDASH_LAYOUT` | `2-SO-PO-WO-RMA-TO-PICK-RCV-SHIP` | Dashboard layout configuration (see Configuration section) |
| `FBDASH_ROWS` | `5` | Number of data rows to display per tile |
| `FBDASH_REFRESH_INTERVAL` | `300` | Auto-refresh interval in seconds (0 = disabled) |
| `BI_SHOW_DEBUG` | `false` | Enable/disable debug console for troubleshooting |
| `BI_SO_SHOW_ESTIMATE` | `false` | Show/hide estimate-related sales order data |
| `BI_PO_SHOW_BID_REQUEST` | `false` | Show/hide bid request purchase orders |
| `DateFormatShort` | `dd/MM/yyyy` | Date display format used throughout dashboard |

**IMPORTANT**: The `FBDASH_LAYOUT` property is critical for dashboard functionality. See the Configuration section below for detailed layout syntax.

### Installation Steps

1. **Create Properties**
   - Open Fishbowl and navigate to **Setup > Property**
   - Click **New** to create each property from the Required Properties table above
   - Set the values according to your preferences
   - Save each property

2. **Save Report File**
   - Save the `Dashboard_Combined-Page.json` file to a local folder on your computer

3. **Import Report**
   - Open Fishbowl and navigate to **BI Editor**
   - Click the **Import** button
   - Select the `Dashboard_Combined-Page.json` file
   - Ensure the **Publish** checkbox is ticked
   - Select appropriate access rights for your user groups (View, Edit Settings)
   - Click **OK** to complete the import

4. **Enable Dashboard Gadget**
   - Open the imported "Dashboard Combined" report in the BI Report window
   - Go to the **Details** tab
   - Check the **Dashboard Gadget** option
   - Click **Save**

5. **Access Dashboard**
   - The combined dashboard will now be available as a Dashboard Gadget in the BI Report list
   - Add it to your Fishbowl dashboard for quick access
   - The dashboard will load with your configured layout from the `FBDASH_LAYOUT` property

## Configuration

The combined dashboard is configured entirely through Fishbowl custom properties in **Setup > Property**. This allows you to change the layout and behavior without modifying the report file.

### Layout Configuration (FBDASH_LAYOUT)

The `FBDASH_LAYOUT` property controls which tiles are displayed and how they are arranged. The format is:

```
{columns}-{tile1}-{tile2}-{tile3}-...
```

#### Layout Examples

**Default Layout** (2 columns, all 8 tiles):
```
2-SO-PO-WO-RMA-TO-PICK-RCV-SHIP
```

**Single Column** (vertical stack):
```
1-SO-PO-WO
```

**Three Columns** (wider layout):
```
3-SO-PO-WO-RMA-TO-PICK
```

**Four Columns** (maximum width):
```
4-SO-PO-WO-RMA-TO-PICK-RCV-SHIP
```

**Custom Selection** (only specific tiles):
```
2-SO-PO-PICK-SHIP
```

#### Available Tile Codes

| Tile Code | Report Name | Description |
|-----------|-------------|-------------|
| `SO` | Sales Orders | Active customer orders awaiting fulfillment |
| `PO` | Purchase Orders | Active vendor orders awaiting receipt |
| `WO` | Work Orders | Manufacturing orders in progress |
| `RMA` | RMA Orders | Return merchandise authorizations with issue tracking |
| `TO` | Transfer Orders | Inter-location inventory transfers |
| `PICK` | Items To Be Picked | Pick tickets requiring action with availability status |
| `RCV` | Items To Be Received | Receipts scheduled for incoming inventory |
| `SHIP` | Items To Be Shipped | Shipments ready for processing |

#### Layout Rules

- **Column count** must be 1, 2, 3, or 4
- **Tile codes** are case-sensitive (use uppercase: SO, PO, WO, RMA, TO, PICK, RCV, SHIP)
- **Separator** is the dash character `-`
- **Order matters** - tiles are displayed left-to-right, top-to-bottom in the order specified
- **Duplicate tiles** - you can include the same tile multiple times (e.g., `2-SO-SO` for two Sales Order tiles)
- **Minimum tiles** - at least one tile code must be specified

### Display Configuration

#### FBDASH_ROWS
Controls the number of data rows displayed in each tile before scrolling is required.

- **Type**: Integer
- **Default**: `5`
- **Valid Range**: 1-50
- **Example**: `10` shows 10 rows per tile

**Note**: Tile height is calculated automatically based on:
- Column header height: 41px
- Filter row height: 37px
- Data row height: 36px per row
- Total height = 41 + 37 + (36 × FBDASH_ROWS)

#### FBDASH_REFRESH_INTERVAL
Automatic refresh interval for all tiles.

- **Type**: Integer (seconds)
- **Default**: `300` (5 minutes)
- **Valid Range**: 0-3600
- **Special Value**: `0` disables auto-refresh

**Example**: `60` refreshes all tiles every minute

### Data Filtering Configuration

#### BI_SO_SHOW_ESTIMATE
Controls visibility of estimate-related sales orders in the SO tile.

- **Type**: Boolean
- **Default**: `false`
- **Values**: `true` = show estimates, `false` = hide estimates

#### BI_PO_SHOW_BID_REQUEST
Controls visibility of bid request purchase orders in the PO tile.

- **Type**: Boolean
- **Default**: `false`
- **Values**: `true` = show bid requests, `false` = hide bid requests

### Debug Configuration

#### BI_SHOW_DEBUG
Enables the debug console showing SQL queries, record counts, and errors.

- **Type**: Boolean
- **Default**: `false`
- **Values**: `true` = show debug console, `false` = hide debug console

## Dashboard Tiles

Each tile in the combined dashboard displays a specific type of order or inventory operation. All tiles share common functionality while providing specialized views of their data.

### Sales Orders (SO)
- **Purpose**: Monitor active customer orders awaiting fulfillment
- **Key Columns**: Order #, Status, Customer Name, Customer PO, Scheduled Ship Date
- **Schedule Indicator**: Shows first ship date status
- **Click-Through**: Order numbers open Sales Order module

### Purchase Orders (PO)
- **Purpose**: Track vendor orders awaiting receipt
- **Key Columns**: Order #, Status, Vendor Name, Customer SO, Scheduled Date
- **Schedule Indicator**: Shows expected receipt date status
- **Click-Through**: Order numbers open Purchase Order module

### Work Orders (WO)
- **Purpose**: Monitor manufacturing orders in progress
- **Key Columns**: MO #, WO #, BOM #, Status, Scheduled Start Date
- **Status Badges**:
  - Issued (yellow)
  - Started (blue)
  - Closed (green)
- **Click-Through**: MO numbers open Work Order module

### RMA Orders (RMA)
- **Purpose**: Track return merchandise authorizations
- **Key Columns**: RMA #, Status, Type, Issue, Product, Qty, Customer Name
- **Issue Types**:
  - **DOA** - Dead on arrival
  - **Warranty** - Warranty claim
  - **-** - No issue specified
- **Grouping**: Items grouped by RMA ID + Type + Issue
- **Product Display**: Shows "Multiple" when RMA contains multiple products
- **Click-Through**: RMA numbers open RMA module

### Transfer Orders (TO)
- **Purpose**: Monitor inter-location inventory transfers
- **Key Columns**: Order #, Status, Type, Scheduled Date, From Location, To Location
- **Schedule Indicator**: Shows scheduled transfer date status
- **Click-Through**: Order numbers open Transfer Order module

### Items To Be Picked (PICK)
- **Purpose**: View pick tickets requiring action with availability status
- **Key Columns**: Status, Pick #, Order #, Scheduled Date, Priority, Order Info
- **Availability Indicators**:
  - **Green Circle** - All items fully available
  - **Yellow Circle** - Partial availability
  - **Red Circle** - No items available
  - **Padlock** - All items committed
  - **Gray Circle** - No pending items
- **Order Info**: Shows customer/vendor/location based on order type
- **Click-Through**: Pick numbers open Pick module (may not work due to Fishbowl limitation)

### Items To Be Received (RCV)
- **Purpose**: Track receipts scheduled for incoming inventory
- **Key Columns**: Order #, Status, Type, Scheduled Date, Vendor Name
- **Order Types**: PO, TO, RMA, WO
- **Schedule Indicator**: Shows expected receipt date status
- **Click-Through**: Order numbers open respective module based on type

### Items To Be Shipped (SHIP)
- **Purpose**: Monitor shipments ready for processing
- **Key Columns**: Shipment #, Status, Type, Order #, Scheduled Date, Ship To, Carrier, Service
- **Order Types**: SO, TO
- **Schedule Indicator**: Shows scheduled ship date status
- **Click-Through**: Shipment numbers open Shipment module (may not work due to Fishbowl limitation)

## Common Functionality

All tiles in the combined dashboard share consistent functionality for data interaction and management.

### Schedule Status Indicators

All tiles display schedule status using color-coded clock icons in the first column:

- 🔴 **Red Clock** - Past due (scheduled date has passed)
- 🟠 **Orange Clock** - Due today (scheduled for current date)
- 🔵 **Blue Clock** - Due this week (scheduled within current calendar week)
- **No indicator** - Future date beyond current week

Schedule indicators help quickly identify overdue or urgent items across all tiles.

### Column Management

#### Sorting
- Click any column header with a sort icon (⇅) to sort ascending
- Click again to sort descending
- Current sort column is visually highlighted
- Each tile maintains its own independent sort state

#### Filtering
- Type in filter boxes below column headers to filter data
- Filters are case-insensitive and search for partial matches
- Multiple filters work together (AND logic)
- Filter count displays when active: "Showing X of Y records"
- Click **Clear Filters** button in tile header to reset all filters for that tile
- Each tile maintains its own independent filters

#### Responsive Widths
- Tables use dynamic column sizing to prevent horizontal scrollbars
- Core columns (numbers, dates, status) have fixed widths
- Text columns (customer/vendor names) truncate with ellipsis (...)
- Hover over truncated text to see full value in tooltip

### Interactive Elements

#### Clickable Records
- Order/pick/shipment numbers are clickable links (blue, underlined on hover)
- Clicking opens the record in Fishbowl's native module
- Order references (SO-XXX, PO-XXX, etc.) also open their source orders
- **Known Limitation**: Pick and Receive links may not work due to Fishbowl bug

#### Tile Refresh
- Click **Refresh** icon (🔄) in tile header to reload data for that specific tile
- All filters and sort state are preserved during refresh
- Auto-refresh updates all tiles automatically based on `FBDASH_REFRESH_INTERVAL` setting

#### Status Badges
Tiles display color-coded status badges for quick visual identification:

**Sales/Purchase Orders**:
- Issued (yellow)
- In Progress (blue)
- Closed (green)

**Work Orders**:
- Issued (yellow)
- Started (blue)
- Closed (green)

**RMA Orders**:
- Open (yellow)
- Fulfilled (green)
- Expired (gray)

**Transfer Orders**:
- Issued (yellow)
- In Transit (blue)
- Closed (green)

### Tile Layout Behavior

- **Responsive Grid**: Tiles arrange in the specified number of columns
- **Equal Width**: All tiles in a row have equal width
- **Variable Height**: Tile height adjusts based on configured row count
- **Vertical Alignment**: Status columns are aligned as 2nd column across most tiles for easy visual scanning
- **Overflow Handling**: Tiles show scrollbar when content exceeds configured row count

## Usage Tips

### Initial Setup

1. **Start with Default Layout**: Use `2-SO-PO-WO-RMA-TO-PICK-RCV-SHIP` to see all tiles
2. **Adjust Row Count**: Set `FBDASH_ROWS` based on your screen resolution (5-10 recommended)
3. **Enable Auto-Refresh**: Set `FBDASH_REFRESH_INTERVAL` to 300 (5 minutes) for regular updates
4. **Customize Layout**: Remove unused tiles from `FBDASH_LAYOUT` to focus on relevant data

### Optimizing for Different Screen Sizes

**Large Monitors (1920×1080 or higher)**:
- Use 3-4 column layout
- Set FBDASH_ROWS to 8-10
- Display all 8 tiles: `3-SO-PO-WO-RMA-TO-PICK-RCV-SHIP`

**Standard Monitors (1366×768 to 1920×1080)**:
- Use 2-3 column layout (default)
- Set FBDASH_ROWS to 5-7
- Display priority tiles: `2-SO-PO-WO-PICK-SHIP`

**Smaller Screens (below 1366×768)**:
- Use 1-2 column layout
- Set FBDASH_ROWS to 5
- Display essential tiles only: `1-SO-PO-PICK`

### Finding Overdue Items

1. Look for red clock icons in the first column of any tile
2. Sort by the schedule indicator column to group past due items at the top
3. Use filters to narrow down to specific customers, vendors, or order types

### Monitoring Availability

1. Focus on the PICK tile for inventory availability
2. Red/orange circles indicate potential fulfillment issues
3. Hover over availability indicators for detailed stock breakdown
4. Padlock icons show committed inventory that may not be picked yet

### Multi-Location Filtering

- Dashboard automatically filters to show only records for location groups assigned to the current user
- This applies to all tiles automatically via UserToLG table relationships
- Users without location group assignments may see no data

### Workflow Integration

**Order Processing Workflow**:
1. Monitor SO tile for new orders
2. Check PICK tile for availability issues
3. Watch SHIP tile for ready shipments
4. Track PO/RCV tiles for incoming inventory

**Manufacturing Workflow**:
1. Monitor WO tile for active manufacturing orders
2. Check PICK tile for material availability
3. Track TO tile for inter-location material transfers
4. Watch RCV tile for incoming components

## Known Limitations

### Embedded Module Architecture

- **All modules are embedded** in a single HTML file for JxBrowser compatibility
- External script loading is not supported in Fishbowl's JxBrowser environment
- This results in a larger file size but ensures reliable loading

### Column Order Persistence

- Column reordering via drag-and-drop is not supported in the combined dashboard
- Column order is fixed based on best practices for visual consistency
- Status columns are standardized as the 2nd column across most tiles for easy scanning

### Clickable Links Limitation

- **Pick and Receive links may not work** - This is a known Fishbowl limitation/bug
- The following clickable links work correctly:
  - Sales Order numbers → Opens Sales Order module
  - Purchase Order numbers → Opens Purchase Order module
  - Work Order numbers → Opens Work Order module
  - Transfer Order numbers → Opens Transfer Order module
  - RMA numbers → Opens RMA module
  - Shipment numbers → Opens Shipment module (functionality may vary)

### Property Changes Require Refresh

- Changes to `FBDASH_*` properties in Setup > Property require a manual refresh
- Click the refresh button or reopen the dashboard to apply new configuration
- Auto-refresh interval does not detect property changes

### Browser Storage Not Available

- Fishbowl's JxBrowser implementation does not support localStorage
- Filter states and sort preferences are not saved between sessions
- Each time the dashboard is opened, filters reset to default state

### Performance Considerations

- Loading all 8 tiles simultaneously may take 3-5 seconds on first load
- Complex queries (RMA grouping, availability calculations) may slow tile rendering
- Consider displaying fewer tiles if performance is a concern
- Auto-refresh with short intervals (< 60 seconds) may impact database performance

## Technical Details

### Data Source

- Reports query Fishbowl database directly using `runQuery()` function
- Real-time data with no caching
- Each tile executes its own SQL query independently
- User permissions enforced via UserToLG relationships

### Module Architecture

- **IIFE Pattern**: Each tile is an Immediately Invoked Function Expression with private state
- **Window Registration**: Modules exposed as `window.ReportSO`, `window.ReportPO`, etc.
- **Standardized API**: All modules expose `init()`, `refresh()`, `applyFilters()`, `clearFilters()`, `sortTable()`
- **Tile Orchestration**: Main dashboard code initializes and manages all tiles via TILE_MAP configuration

### Browser Compatibility

- Designed exclusively for JxBrowser within Fishbowl
- Uses modern CSS (grid layout, flexbox) and JavaScript (ES6)
- localStorage not available (Fishbowl limitation)
- External script loading not supported (all modules embedded)

### Tile Height Calculation

Tile height is calculated using measured component heights:

```javascript
const columnHeaderHeight = 41;  // 12px padding-top + 15px line + 12px padding-bottom + 2px border
const filterRowHeight = 37;     // 8px padding-top + 21px input + 8px padding-bottom
const rowHeight = 36;           // 8px padding-top + 15px line + 8px padding-bottom + 1px border
const totalHeight = columnHeaderHeight + filterRowHeight + (rowHeight × FBDASH_ROWS);
```

This ensures exactly the configured number of rows are visible without partial rows showing.

### Custom Properties Reference

All Fishbowl custom properties used by the combined dashboard:

| Property | Type | Default | Module | Description |
|----------|------|---------|--------|-------------|
| `FBDASH_LAYOUT` | String | `2-SO-PO-WO-RMA-TO-PICK-RCV-SHIP` | Main | Dashboard layout configuration |
| `FBDASH_ROWS` | Integer | `5` | Main | Number of rows per tile |
| `FBDASH_REFRESH_INTERVAL` | Integer | `300` | Main | Auto-refresh interval (seconds) |
| `DateFormatShort` | String | `dd/MM/yyyy` | All | Date display format |
| `BI_SHOW_DEBUG` | Boolean | `false` | All | Enable debug console |
| `BI_SO_SHOW_ESTIMATE` | Boolean | `false` | SO | Show/hide estimates |
| `BI_PO_SHOW_BID_REQUEST` | Boolean | `false` | PO | Show/hide bid requests |

## Troubleshooting

### Dashboard Not Loading

**Symptom**: Dashboard shows blank screen or loading message
**Causes**:
- Missing `FBDASH_LAYOUT` property
- Invalid layout syntax in `FBDASH_LAYOUT`
- JxBrowser compatibility issue

**Solutions**:
1. Verify `FBDASH_LAYOUT` exists in Setup > Property
2. Check layout syntax: `{columns}-{tile1}-{tile2}...`
3. Try default layout: `2-SO-PO-WO-RMA-TO-PICK-RCV-SHIP`
4. Enable debug mode: set `BI_SHOW_DEBUG = true`

### Tiles Show "Error Loading" Message

**Symptom**: Individual tiles show error message instead of data
**Causes**:
- Missing location group assignment for user
- SQL query error
- Missing tile code in `FBDASH_LAYOUT`

**Solutions**:
1. Verify user is assigned to location groups in Fishbowl
2. Enable debug mode to see SQL query errors
3. Check tile codes are uppercase (SO, PO, WO, RMA, TO, PICK, RCV, SHIP)

### Auto-Refresh Not Working

**Symptom**: Dashboard does not refresh automatically
**Causes**:
- `FBDASH_REFRESH_INTERVAL` set to 0
- Invalid interval value
- Browser timeout restriction

**Solutions**:
1. Set `FBDASH_REFRESH_INTERVAL` to non-zero value (e.g., 300)
2. Use reasonable interval (60-600 seconds recommended)
3. Manually refresh using tile refresh buttons

### Data Not Updating After Property Changes

**Symptom**: Layout or row count doesn't change after modifying properties
**Causes**:
- Dashboard caches property values on load
- Properties read only during initialization

**Solutions**:
1. Close and reopen the BI report window
2. Click the main refresh button
3. Verify property values are saved in Setup > Property

### Slow Performance

**Symptom**: Dashboard takes long time to load or refresh
**Causes**:
- Too many tiles displayed (all 8)
- Large data volumes in database
- Complex queries (RMA grouping, availability calculations)
- Short auto-refresh interval

**Solutions**:
1. Reduce number of tiles in `FBDASH_LAYOUT`
2. Increase `FBDASH_ROWS` to reduce number of tiles visible
3. Increase `FBDASH_REFRESH_INTERVAL` to reduce query frequency
4. Use filters to reduce data volume

## Migration from Individual Reports

If you're currently using the individual dashboard reports (Open Sales Orders, Open Purchase Orders, etc.), you can migrate to the combined dashboard while maintaining the same functionality.

### Advantages of Combined Dashboard

- **Single View**: Monitor all order types from one screen
- **Consistent Interface**: All tiles share the same look and functionality
- **Easier Maintenance**: Update one report file instead of eight
- **Flexible Layout**: Customize which tiles are displayed and how they're arranged
- **Better Performance**: Shared code and single page load

### Migration Steps

1. **Install Combined Dashboard**: Follow the Installation section above
2. **Configure Layout**: Set `FBDASH_LAYOUT` to display desired tiles
3. **Test Functionality**: Verify all tiles load correctly and show expected data
4. **Train Users**: Familiarize users with the new combined interface
5. **Decommission Individual Reports**: Remove individual dashboard gadgets once combined dashboard is adopted

### Comparison Table

| Feature | Individual Reports | Combined Dashboard |
|---------|-------------------|-------------------|
| Number of BI reports | 8 separate | 1 consolidated |
| Layout flexibility | Fixed (1 report per gadget) | Configurable (1-4 columns) |
| Maintenance effort | High (update 8 files) | Low (update 1 file) |
| Screen real estate | Requires multiple gadgets | Single gadget with all tiles |
| Configuration | Limited | Extensive (FBDASH_* properties) |
| Functionality | Identical | Identical |

## Support

For issues, questions, or enhancement requests:

1. **Enable Debug Mode**: Set `BI_SHOW_DEBUG = true` to see detailed error messages
2. **Check Property Configuration**: Verify all `FBDASH_*` properties are created correctly
3. **Review Troubleshooting Section**: Common issues and solutions listed above
4. **Contact Administrator**: Reach out to your Fishbowl administrator or BI report developer

---

**Report Name**: Dashboard Combined
**File Name**: Dashboard_Combined-Page.json
**Last Updated**: 2026-01-15
**Version**: 1.0
**Tiles**: 8 configurable tiles covering all order types and inventory operations
**Configuration**: 7 custom properties for complete customization
