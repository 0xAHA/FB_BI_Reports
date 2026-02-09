# Project Context

## Overview
This repository contains custom Fishbowl BI Reports dashboards - HTML-based business intelligence reports that run inside the Fishbowl Inventory application. The dashboards provide real-time analytics for Sales, Purchasing, Inventory, and Manufacturing operations.

## Repository Structure

```
FB_BI_Reports/
├── Dashboards/
│   ├── Sales_Dashboard.htm          # Main sales analytics dashboard
│   ├── Purchasing_Dashboard.htm     # Main purchasing analytics dashboard
│   ├── Inventory_Dashboard.htm      # Main inventory analytics dashboard
│   ├── Dashboard_Combined.htm       # Combined tile view dashboard
│   └── Individual Pages/            # Standalone order-type views
│       ├── Open_Sales_Orders.htm
│       ├── Open_Purchase_Orders.htm
│       ├── Items_To_Be_Picked.htm
│       ├── Items_To_Be_Shipped.htm
│       ├── Items_To_Be_Received.htm
│       └── ...
├── Inventory/
│   └── Inv_Reorder_Watchlist.htm    # Inventory reorder monitoring
├── Manufacturing/
│   └── WO_Capacity_Planning_Gantt_v3.htm
├── scripts/                         # Shared JavaScript modules
│   ├── dashboard-common.js          # Common utilities
│   ├── dashboard-so.js              # Sales orders
│   ├── dashboard-po.js              # Purchase orders
│   ├── dashboard-ship.js            # Shipping
│   └── ...
├── Template/
│   └── Core_Dashboard_Template.htm  # Base template for new dashboards
├── Themes/                          # CSS themes
├── Other_NOT_FOR_PRODUCTION/        # Test/development tools
├── TODO.md                          # Task tracking
└── LICENSES.md                      # License information
```

## Technology Stack
- **Frontend**: HTML, CSS, JavaScript (vanilla + jQuery + Bootstrap 4)
- **Charts**: Chart.js
- **Date handling**: Moment.js
- **Data**: SQL queries executed via Fishbowl's fbReport.runReport() API
- **Database**: MySQL (Fishbowl database schema)

## Current Branch
**Branch**: `claude/review-sales-dashboard-sql-fp7FP`

This branch includes recent work on:
1. Inventory Dashboard redesign with improved KPI tiles
2. Fulfillment Pipeline metrics (moved from Sales to Inventory Dashboard)
3. Short Pick and Items Ready tile enhancements
4. Stock Loss tile font size adjustments
5. Date format standardization using MOMENT_DATE_FORMAT
6. Drilldown quantity formatting to 2 decimal places

### Recent Commits (16 commits ahead of main)
- Reduce Stock Loss dollar value font size
- Stack Fulfillment Pipeline metrics vertically with smaller font
- Redesign Inventory Dashboard layout with improved KPI tiles
- Use consistent MOMENT_DATE_FORMAT for all drilldown dates
- Add detailed counts to Short Pick and Items Ready tiles
- Fix Short Parts value calculation using SoItem.UnitPrice
- Fix Fulfillment Pipeline to use correct ShipItem.QtyShipped column
- Move Fulfillment Pipeline metrics from Sales to Inventory Dashboard
- Improve Adjustments/Scrap drilldowns and add vendor filter
- Update queries to use POST table for historical cost

## Key Technical Patterns

### Running SQL Queries
```javascript
// Use fbReport.runReport() to execute SQL
var query = "SELECT * FROM so WHERE statusId = 20";
fbReport.runReport(query, function(results) {
    // Process results array
});
```

### Currency Formatting
```javascript
// Global formatCurrency() function using REPORT_DECIMAL_PRICE property
formatCurrency(value)  // Returns formatted currency string
```

### Date Handling
```javascript
// Uses MOMENT_DATE_FORMAT for consistent date display
moment(date).format(MOMENT_DATE_FORMAT)
```

### Important Fishbowl Tables
- `so` / `soitem` - Sales Orders
- `po` / `poitem` - Purchase Orders
- `ship` / `shipitem` - Shipments
- `receipt` / `receiptitem` - Receipts
- `part` / `partcost` - Parts and costs
- `inventorylog` - Inventory movements
- `post` - Financial postings (for cost attribution)
- `partreorder` - Reorder points by location group

### InventoryLogType IDs
- 10: Receive
- 20: Ship
- 30: Transfer
- 40/50: Production (Build/Consume)
- 64: Adjust Increase
- 65: Adjust Decrease
- 67: Scrap (adj:scp)
- 68: Cycle Count (adj:cyc)

## Pending Tasks (from TODO.md)

### High Priority
- [ ] Add Customer filter dropdown to Sales Dashboard
- [ ] Add Vendor filter dropdown to Purchasing Dashboard
- [ ] Review credit note display - reduce red styling
- [ ] Review and test all Inventory Dashboard queries with real data

### Lower Priority
- [ ] Full locale support for non-US number formatting (1.234,56 style)
- [ ] Investigate Fishbowl built-in print/download button integration (#4922)

## Development Notes

### Testing
- Dashboards run inside Fishbowl application - no standalone test environment
- Use Debug Console (collapsible panel in dashboards) for SQL query debugging
- All major dashboards have auto-scrolling debug consoles

### Code Style
- Currency: Use `formatCurrency()` for all monetary values
- Dates: Use `MOMENT_DATE_FORMAT` constant for display
- Part types: Filter to `typeid=10` for Inventory parts only
- Costs: Use `partcost.avgCost` for current valuation (not `part.stdCost`)
- Historical costs: Use `POST.AMOUNT` for point-in-time cost attribution

### Common Issues
- LEFT OUTER JOIN needed when including parts without reorder points
- ShipItem.QtyShipped (not qty) for shipped quantities
- SoItem.UnitPrice for sales value calculations
- POST.REFITEMID: 2=Scrap, 3=Cycle Count for filtering

## Session Continuation

To continue development:
1. Review TODO.md for current task list
2. Check `git log --oneline -5` for recent changes
3. Main dashboards are in `/Dashboards/` folder
4. SQL queries are embedded in the .htm files (not separate .sql files)

---
*Last updated: 2026-02-06*
