# TODO

Open items only. Completed work lives in the git history.

## Needs testing in the Fishbowl client
These have been checked against demodb only:
- [ ] Sales v1.2:
  - weighted margins and the Fishbowl line set (19bd33f);
  - credit-line display (0e0945c);
  - the Customer filter (b6250a3);
  - Revenue & Margin Trend axes and weekly buckets (57016fd), Compare
    (b3cebfd), Profit Bridge and Growth vs Margin tiles.
- [ ] Inventory v1.2 Stock Movement Trend: $ valued at the cost each
  movement carried (cost layers on FIFO/LIFO, ADV-5870), and yld (type 40)
  moves left out. Check both the # and $ views. Publish to SharePoint too
  if it belongs there (it has gone to Fishbowl only).

## Fishbowl ADV 2026.10 release follow-ups
Once the build is available:
- [ ] ADV-5581 (REST Fulfill Work Order) reworked the shared WO cost-split
  code (`distributeCost`, `WOModule.getWoItemCosts`) that the legacy
  `SaveWorkOrderRq` finish uses. Regression-test Production Scheduling
  v1.2's finish: full, short (`allowShort`), multi-FG under even and
  weighted distribution (compare `woitem.cost` with a pre-upgrade
  baseline), labour Used override, tracked finished good.
- [ ] ADV-5581: confirm MR !1288 (partial-build auto-consumption,
  `splitWorkOrder`) made the build; it was awaiting QA re-test FBA-5107.
- [ ] ADV-6029 (per-user report settings): report_btn reads saved
  settings through `BiReportFpo.getParams()` and falls back to the
  declared values. Switch it to read the user's own row.
- [ ] Review the new REST endpoints against the build's /apidocs: WO
  fulfill (5581), receiving search and get (5828, 5831), start and unhold
  pick item (5823, 5825), SO `mcUnitPrice`/`mcTotalPrice` (5890), TO
  `readOnly`/`actions` (5861).
