# TODO List

## Completed Tasks

### Price Formatting - Use System Property
- [x] Use Fishbowl system property `REPORT_DECIMAL_PRICE` (format: `$ #,##0.00`) for price formatting
- [x] Apply to Sales_Dashboard.htm - global `formatCurrency()` function using PRICE_FORMAT, CURRENCY_SYMBOL, DECIMAL_PLACES
- [x] Apply to Purchasing_Dashboard.htm - same implementation
- [ ] Apply to other dashboards: Inventory, Combined (if applicable)

### Terminology Update
- [x] Change all references from 'Salesman' to 'Sales Person' in Sales Dashboard
- [x] Update column headings in drilldown tables
- [x] Update filter labels
- [x] Update tooltips and any other UI text
- Note: Purchasing Dashboard doesn't use 'Salesman' terminology

---

## Pending Tasks

### Sales Credit Note Display Review
- [ ] Review credit note (negative qty line item) display - currently too much red after recent changes
- [x] Change styling: keep red text for negatives but remove bold font weight (completed)
- [ ] Consider following standard Fishbowl sales order info: Qty, negative price, negative total (no margin shown)
- [ ] Test with various credit/return scenarios

**Notes:**
- Current implementation shows margin for credits which may be misleading
- Fishbowl standard doesn't show margin on credit lines

---

### Add Missing Filters
- [ ] Add Customer filter dropdown to Sales Dashboard
- [ ] Add Vendor filter dropdown to Purchasing Dashboard (if not already present)

---

### Currency Localization (Partially Addressed)
- [x] Created global `formatCurrency()` function using REPORT_DECIMAL_PRICE property
- [x] Currency symbol mapped from home currency code in database (CURRENCY_SYMBOLS lookup)
- [x] Decimal places extracted from price format pattern
- [x] Applied to Sales Dashboard
- [ ] Apply currency symbol mapping to Purchasing Dashboard (copy CURRENCY_SYMBOLS and getHomeCurrencySymbol)
- [ ] Apply currency symbol mapping to Combined Dashboard
- [ ] Apply currency symbol mapping to individual tile reports
- [ ] Still using 'en-US' locale for number formatting (thousands separator, decimal point)
- [ ] May need additional property for full locale support if non-US formatting needed (1.234,56 format)

**Affected files still needing updates:**
- Purchasing_Dashboard.htm (currency symbol mapping)
- Dashboard_Combined.htm
- Individual tile reports (*.htm)

**Notes:**
- Currency symbol now determined by querying home currency code from `currency` table and mapping via CURRENCY_SYMBOLS
- Supports 30+ currencies (AUD, USD, EUR, GBP, JPY, etc.)
- Falls back to REPORT_DECIMAL_PRICE parsing if DB query fails
- Full locale support would require additional property for number formatting style

---

### Inventory Dashboard - Initial Implementation

#### Completed:
- [x] Updated date range selector to match Sales/Purchasing dashboards (dropdown with presets: 30/60/90/180/365 days, This/Last Quarter, Current/Last FY, Current/Last CY, Custom Range)
- [x] Removed Part Type filter (now fixed to typeid=10 for Inventory parts)
- [x] Removed Tracking Method filter
- [x] Added Product Category filter (using producttree)
- [x] Implemented new inventory availability query (based on Fishbowl Inventory Availability by Location Group report)
- [x] Updated Top Parts by Value to show availability data (On Hand, Available, Committed, On Order)
- [x] Applied currency symbol mapping and formatCurrency function
- [x] Updated date handling functions (getQuarterDates, getFYDates, getCalendarYearDates, getDateCondition)
- [x] Added updateDateRangeDisplay for header date range display
- [x] Added clearAllFilters button

#### Pending:
- [ ] Integrate part activity report query for Stock Movement chart (currently placeholder)
- [ ] Review and test all queries with real data
- [ ] Add drill-down functionality to charts
