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
- [x] Currency symbol extracted from price format pattern
- [x] Decimal places extracted from price format pattern
- [ ] Still using 'en-US' locale for number formatting (thousands separator, decimal point)
- [ ] May need additional property for full locale support if non-US formatting needed (1.234,56 format)

**Affected files still needing updates:**
- Inventory_Dashboard.htm
- Dashboard_Combined.htm (if exists)

**Notes:**
- REPORT_DECIMAL_PRICE property now used for currency symbol and decimal places
- Full locale support would require additional property for number formatting style
