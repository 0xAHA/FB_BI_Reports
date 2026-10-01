# Other — not for production

Working tools, prototypes, probes and sample data. Nothing here is
published to the BI Reports folder or stamped by `tools/stamp`.

## Helper tools (used, but not published reports)

| File | What it is |
|---|---|
| `Cycle_Count.htm` | Cycle-count cards with discrepancy review, posting through `ImportCycleCountData` |
| `Document_Order_Parser.htm` | Drop a customer PDF, image or spreadsheet: OCR, parse, match, then import as an order |
| `Import_Builder.htm` | Map an external file onto a Fishbowl import (`/api/import/…`) |
| `Inventory_Adjustment_Helper.htm` | Inventory adjustments in bulk |
| `Inventory_Adjustment_Helper_Tracked.htm` | The same for tracked parts (lot / serial / date) |
| `Part_Cost_Updater.htm` | Part cost against the last purchase cost |
| `PPP_Pricing_Validator.htm` | Validates a Part, Product & Vendor Pricing import CSV before it is imported |
| `Solidworks_BOM_Converter.htm` | Converts a SolidWorks BOM export into a Fishbowl BOM import; `sample_bom*.csv` are its test inputs |

## API tools and references

| File | What it is |
|---|---|
| `Fishbowl_Advanced_API_Tool.htm` | REST / legacy API explorer; the documented request shapes several reports follow |
| `Fishbowl_API_App_Guide.htm` | Guide to building an app on the Fishbowl API |
| `Cloudflare/` | Portal package (worker, pages, docs) for hosting a report outside Fishbowl; see its README |

## Design

| File | What it is |
|---|---|
| `FB_Brand_Mockup.htm` | Shared component mockup: the reference for `scripts/fb-styles.css` and the report template |

## Prototypes (`prototypes/`)

Early tools kept for reference.

| File | What it is |
|---|---|
| `Assembly_Disassembly_Helper.htm` | Disassembly in two steps: cycle-counts the assembly out, adds the component stock |
| `BackOrderDashboard.htm` | Back-order dashboard |
| `Inventory_Availability_by_Location_Group.htm` | Availability by location group; superseded by the published `- Inventory - Inventory Availability` |

## Tests and probes (`tests/`)

| File | What it checks |
|---|---|
| `BI Settings Scope Test.htm` | Which storage APIs are per user, per report, or shared |
| `WO_Labour_Used_Save_Probe.htm` | `SaveWorkOrderRq` probes: labour / non-inventory `qtyUsed`, scrap, and swapping a WO item |
| `WO_Item_Substitution_Sample.js` | Swapping an item on an open WO (`AddWorkOrderItemRq` and friends), with the gotchas found |

## Data

| Folder | What it is |
|---|---|
| `demo_data/` | Generator and CSVs that seed a demo database (parts, BOMs, reorder points, stock, orders) |
| `sample_docs/` | Customer-style POs, invoices and price lists for testing the Document Order Parser |
| `Data Imports/` | Customer data, **gitignored**; never commit it |
