# WX demo data — additive seed for demodb

Layers a self‑contained **`WX-` widget family** on top of the existing demodb so
`Production_Scheduling_v1.2` (and the Auto‑PO / availability reports) have a
meaningful, medium‑scale dataset: **~113 new parts, 60 multi‑level BOMs**, reorder
points, starting inventory, open sales orders and open purchase orders — engineered
with real shortages, contested stock, staged producer→consumer chains, overdue
supply and capacity load.

Everything is **additive and namespaced `WX-`** — it references existing UOMs, tax
codes, vendors, customers and location groups, and never touches the 201 parts /
44 BOMs already in demodb. To remove it later, delete the `WX-%` parts/BOMs/orders.

All files are produced by **`generate.js`** (`node generate.js`). If any import
header is wrong for your server version, tell me the column the wizard expects and
I fix it in one place and re‑emit — the entity data is preserved in `_reference.json`.

---

## Import order (dependency chain — do NOT reorder)

Each layer references the previous one, so import top‑to‑bottom. All go through the
Fishbowl client **Data → Import** wizard (or File → Import), choosing the matching
import type.

| # | File | Fishbowl import type | Confidence |
|---|------|----------------------|------------|
| 1 | `01_parts_products_vendorpricing.csv` | **Part, Product, and Vendor Pricing** | ✅ Confirmed |
| 2 | `02_boms.csv` | **Bill of Materials** | ⚠ Verify header |
| 3 | `03_reorder_points.csv` | **Reorder Point** | ⚠ Verify header |
| 4 | `04_starting_inventory.csv` | **Add Inventory** (`ImportAddInventory`) | ✅ Confirmed |
| 5 | `05_sales_orders.csv` | **Sales Order** | ✅ Confirmed |
| 6 | `06_purchase_orders.csv` | **Purchase Order** | ⚠ Verify header |
| 7 | *Manufacture Orders → Work Orders* | *(see "The WO step" below)* | ⛔ Needs a decision |

**Prerequisites** (all verified present in demodb): the 8 vendors, 10 customers,
UOM codes (`ea/hr/m/kg/mm/L/ft`), tax‑rate names (`NCG` purchase = id 4, `GST`
sales = id 2), and 3 location groups the files reference all exist. SO/PO rows
carry the real customer/vendor addresses pulled from demodb. Stock lands in
**QLD Stock (`R1A2`), Sydney (`Bike Storage`), Melbourne (`Stock Room`)** — the
inventory `Location` column is written **`LocationGroup-Location`**
(e.g. `QLD Stock-R1A2`) so it is unambiguous across LGs.

### ✅ Confirmed formats
Column sets taken verbatim from the repo's own tools:
- **PPVP** ← `Import_Builder.htm` schema registry (exact keys, incl. `PartTypeID`
  10=Inventory / 21=Labor, `PartTaxCode`, product `Price`, vendor `Cost`/`DefaultVendor`).
- **Add Inventory** ← `Inventory_Adjustment_Helper.htm` (`ImportAddInventory`).
- **Sales Order** ← `QuickOrder_v1.2.htm` — the two‑header layout (an `SO` column
  header row, then an `Item` column header row, then `SO`/`Item` data rows).

### ⚠ Best‑effort formats — validate first
The BOM, Reorder and PO import headers are **not** encoded anywhere in the repo, so
these use the documented Fishbowl shapes and are my best guess. Before importing,
open each import type in the wizard and check the expected columns against the CSV
header row. If they differ, paste me the wizard's column list and I'll re‑emit.
- **BOM** (`02_boms.csv`): one row per BOM line — the finished‑good line (`Type` =
  `Finished Good`) carries the description + `Estimated Duration (min)`; component
  and labour lines follow (`Type` = `Raw Good`). Estimated duration is what drives
  the report's **Est. Labor** and the capacity heatmap.
- **PO** (`06_purchase_orders.csv`): two‑header layout like the SO — a `PO` header
  row (full RemitTo **vendor** address + ShipTo **company** address + `TaxRateName`
  = `NCG`), then `Item` rows each carrying the purchase tax‑rate name in `TaxCode`.
  The repo normally creates POs via **REST** (`/api/purchase-orders`), so this CSV
  header is the least‑certain — if the import balks, I can instead give you a small
  REST seeder (same path the report's Create‑PO drawer uses).

---

## ⛔ The WO step (what actually fills the scheduling report)

Work orders are **not importable directly** — they're generated when a **Manufacture
Order is issued** off a BOM. To reach ~200 WOs from the 60 `WX-` BOMs we need to
create ~60–70 MOs (multi‑level, so each spawns 2–3 WOs across the FG→SA chain).
There is no confirmed MO CSV import, so pick one:

1. **REST MO seeder (recommended).** I generate a tiny run‑once tool (a BI report,
   same `runRestApiAsync('/api/manufacture-orders')` path `psSubmitMo` already uses)
   that looks up the `WX-` BOMs and posts ~65 MOs spread across the 3 LGs and the
   next 8 weeks, issued so their WOs generate. Reliable and reproducible. **Do this
   after step 2 (BOMs) imports clean** so the BOM ids exist.
2. **Client bulk‑create.** Create MOs from the `WX-FG-*` BOMs manually — accurate
   but tedious at this volume.

Tell me which and I'll produce the seeder (option 1) as the last piece.

---

## What to look for in Production Scheduling once loaded

The data is engineered so the report's signals aren't a happy path:
- **Material Shortages / Procurement → To Purchase:** ~17 raw components seeded at
  **0 on‑hand** (the `WX-RM-30xx` where index %3==0). Their default vendors + costs
  are set, so "To Purchase" groups by vendor and Create‑PO pre‑fills.
- **Stock contested:** ~7 raws seeded at qty 3 (enough for one WO) but consumed by
  several → the amber "In stock · earlier WO" signal.
- **Staged chains (Timeline, By MO):** every `WX-FG` BOM consumes a `WX-SA`
  sub‑assembly that is itself a BOM → producer→consumer WO chains + dependency arrows.
- **Overdue supply:** one PO batch has an ETA in the past → "Supply overdue".
- **On order (bid):** one PO batch is Bid Request (status 10) → the "On order" chip,
  not counted as confirmed supply.
- **Capacity / User Load:** every BOM carries `Estimated Duration` + a labour line
  (`WX-LAB-FAB/ASSY/TEST`, typeid 21, Hour UOM) → the heatmap and Est. Labor populate.
- **Reorder demand tags:** reorder points on the raws → the Min/Max demand driver.

---

## Regenerating / fixing

Edit `generate.js` and re‑run `node generate.js`. The knobs at the top:
- `TODAY` — anchor date (currently `2026-08-24`); all SO/PO dates are relative to it.
- `DATE_FMT` — **must match your install's DateFormatShort** (defaults to AU
  `dd/MM/yyyy`). If imports reject dates, change this one constant.
- `VENDORS` / `CUSTOMERS` / `LGS` / tax codes — all must exist in the DB.
- `N_FG` / `N_SA` / `N_RM` — scale knobs (bump these to go from medium → large later).

`_reference.json` dumps the full generated entity set (counts, BOM structures) so a
header fix never means re‑deriving the data.

## Cleanup
Everything is `WX-` prefixed. To remove: delete the `WX-%` sales orders, purchase
orders, manufacture/work orders, then the `WX-%` BOMs, then the `WX-%` parts (parts
last — they're referenced by the rest).
