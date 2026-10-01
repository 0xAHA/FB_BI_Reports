---
name: Fishbowl WO/pick schema
description: Work order / pick / tracking data model grounded against the example DB for the WO finisher
type: reference
---

Grounded against MySQL DB `example` (via mysql-mcp; MySQL 8.4, full CTE/window/JSON). Note the default mysql-mcp connection is `lscseeds_v3` which has 0 WOs — query `example.*` (fully qualified) for live WO data. ~50 Fishbowl schemas exist on the server; each tenant is its own DB.

**Work order lifecycle / status:** WO issued → pick started → pick finished → WO complete. `wo.statusId`: 10 = open/issued (53 in example), 40 = finished (30k). Treat open as `statusId < 40`; finish drives to 40.

**Core model:**
- `wo.num` = `MO:seq` e.g. `20270:001`. `wo.moItemId`→`moitem`; `moitem.moId`→`mo.num`, `moitem.bomId`→`bom.num`. `wo.calCategoryId`→`calcategory.name` (calendar category; UNUSED in example but supported). `wo.locationGroupId`. `wo.customFields` = JSON keyed by customfield id `{name,type,value}` (only active WO field in example is id 44 "QC", written by the sibling WO QC tool; open WOs are empty `{}`).
- **Finished good** = `woitem WHERE woId=wo.id AND typeId=10` → part (1 per WO). **Raw goods** = `woitem.typeId=20`. (typeId 30/31 rare.) FG/raw qty in `woitem.qtyTarget/qtyUsed/uomId`.
- **Pick** for a WO: num = `W`+wo.num (e.g. `W20270:001`); link via `woitem.id = pickitem.woItemId → pick`. `pick.statusId` 10=entered, 20+=started, 40=finished. GetPickRq accepts `{WoNum: wo.num}`.
- **part.typeId:** 10=Inventory (only type needing a stock pick), 20=Service, 21=Labor (e.g. YLAB-MAKE), 30=Non-Inventory (e.g. WATER), 60=Internal. Non-inventory/labor parts appear as pickitems with 0 stock — EXCLUDE from pickability and auto-fulfill them at finish (no source tag).
- **Tracking:** `part.trackingFlag` (bit) + `parttotracking`→`parttracking.typeId`: 10=text/lot (Batch Number), 20=?, 30=date (Use By), 40=serial. example has NO serials (only Batch+UseBy). Lot/date auto-carry via FIFO from source-tag `tagtrackingview`; serial needs explicit selection (wizard). 705/1067 parts tracked; all example FGs are batch+useby tracked.

**Pickability (fast, ~8ms):** per WO, inventory raw goods only, need (woitem qty converted to part stock uom via `uomconversion` fromUomId=part.uomId,toUomId=woitem.uomId, ×factor/multiply) vs available `SUM(tag.qty-tag.qtyCommitted)` over `location.pickable=1 AND countedAsAvailable=1` in the WO's locationGroup; SCOPE the tag scan to the WOs' part ids. 7 location groups. 29/53 open WOs fully pickable.

See [[project_wo_finisher]] for how the tool uses this, and [[feedback_fishbowl_runtime]] for the host-fn / SQL constraints.
