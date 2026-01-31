# TODO List

## Pending Tasks

### Sales Credit Note Display Review
- [ ] Review credit note (negative qty line item) display - currently too much red after recent changes
- [ ] Consider following standard Fishbowl sales order info: Qty, negative price, negative total (no margin shown)
- [ ] Change styling: keep red text for negatives but remove bold font weight
- [ ] Test with various credit/return scenarios

**Notes:**
- Current implementation shows margin for credits which may be misleading
- Fishbowl standard doesn't show margin on credit lines

---

### Add Missing Filters
- [ ] Add Customer filter dropdown to Sales Dashboard
- [ ] Add Vendor filter dropdown to Purchasing Dashboard (if not already present)

---

### Price Formatting - Use System Property
- [ ] Use Fishbowl system property `REPORT_DECIMAL_PRICE` (format: `$ #,##0.00`) for price formatting
- [ ] Apply to all dashboards: Sales, Purchasing, Inventory, Combined
- [ ] This may resolve/simplify the currency localization task below

---

### Terminology Update
- [ ] Change all references from 'Salesman' to 'Sales Person'
- [ ] Update column headings in drilldown tables
- [ ] Update filter labels
- [ ] Update tooltips and any other UI text

**Affected files:**
- Sales_Dashboard.htm (filter, queries, column headings)
- Any other files referencing 'Salesman'

---

### Currency Localization
- [ ] Investigate if Fishbowl has existing currency/locale properties we can use
- [ ] If not, add `BI_CURRENCY_SYMBOL` and `BI_CURRENCY_LOCALE` properties
- [ ] Create global `formatCurrency()` function in both dashboards
- [ ] Replace all hardcoded `$` and `en-US` formatting (~50+ locations in Sales Dashboard, ~30+ in Purchasing Dashboard)
- [ ] Apply same fix to other dashboards (Inventory_Dashboard.htm, etc.)

**Affected files:**
- Sales_Dashboard.htm
- Purchasing_Dashboard.htm
- Inventory_Dashboard.htm
- Dashboard_Combined.htm

**Notes:**
- Currently hardcoded to `$` symbol and `en-US` locale
- Need to support different currencies (USD, EUR, GBP, AUD, etc.)
- Need to support different number formats (1,234.56 vs 1.234,56)
- May be addressed by `REPORT_DECIMAL_PRICE` property above
