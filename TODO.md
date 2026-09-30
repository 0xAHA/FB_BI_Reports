# TODO

Open items only. Completed work lives in the git history.

## Waiting on others

### #4922 — Fishbowl's built-in print / download buttons
- [ ] The client's own print and download buttons are separate from the
      buttons a report draws, and a report can't hook into or style them.
      This needs a change in the Fishbowl application layer, so it is out of
      scope for the reports.

## Dashboards

### v1.2 dashboards ignore the user's location groups
- [ ] On Sales, Inventory and Purchasing v1.2, the Location Group filter
      lists every active location group, and no tile limits itself to the
      groups assigned to the user (`getLocationGroupList()`). The order tiles
      and Dashboard - Company do apply them. See the Known gaps section of
      `Dashboards/dashboards.md`.

### Sales v1.2 margin axis
- [ ] Monthly Revenue & Margin draws margin on a fixed 0–65% axis (`yMarg`), so a
      negative or very high margin runs off the chart. Size the axis from
      the data, or clamp and label the value.

## Needs testing in the Fishbowl client
These have been checked against demodb only:
- [ ] Sales v1.2:
  - weighted margins and the Fishbowl line set (19bd33f);
  - credit-line display (0e0945c);
  - the Customer filter (b6250a3).
- [ ] Production Scheduling v1.2 Timeline tooltip at several app zoom
      levels (4a2a23d).
- [ ] Saved views (FBLib.FilterViews) on the individual dashboard tiles.
