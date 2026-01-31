# TODO List

## Pending Tasks

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
