# Other — not for production

Working tools, prototypes, probes and sample data. Nothing here is
published to the BI Reports folder or stamped by `tools/stamp`.

## Helper tools (used, but not published reports)

| File | What it is |
|---|---|
| `Cycle_Count.htm` | Cycle-count cards with discrepancy review, posting through `ImportCycleCountData` |
| `Document_Order_Parser.htm` | Drop a customer PDF, image or spreadsheet: OCR, parse, match, then import as an order |
| `Import_Builder.htm` | Map an external file onto a Fishbowl import (`/api/import/…`) |
| `Part_Cost_Updater.htm` | Part cost against the last purchase cost |
| `PPP_Pricing_Validator.htm` | Validates a Part, Product & Vendor Pricing import CSV before it is imported |
| `Solidworks_BOM_Converter.htm` | Converts a SolidWorks BOM export into a Fishbowl BOM import; `sample_bom*.csv` are its test inputs |

## API tools and references

| File | What it is |
|---|---|
| `Fishbowl_Advanced_API_Tool.htm` | REST / legacy API explorer; the documented request shapes several reports follow |
| `Fishbowl_API_App_Guide.htm` | Guide to building an app on the Fishbowl API |
| `Cloudflare/` | Portal package (worker, pages, docs) for hosting a report outside Fishbowl; see its README |
| `PowerBIAgent/` | Windows service (Python) that pushes Fishbowl data to Power BI; see its `SETUP.md` |

## Design

| File | What it is |
|---|---|
| `FB_Brand_Mockup.htm` | Shared component mockup: the reference for `scripts/fb-styles.css` and the report template |

## Paperwork proof of concept (archived)

The HTML replacements for the stock Jasper paperwork started here and became
iReport ports on 2026-10-15: `iReport_Ports/SalesOrder/` (Sales Order Report,
Sales Invoice), `Ship/` (Packing Slip, Shipping Invoice), `PurchaseOrder/POReport.htm`,
`Picking/PickTicket.htm` and `WorkOrder/WOTraveler.htm`, on the shared
`scripts/fb-doc.js`. The POC itself is in `archived/Other_NOT_FOR_PRODUCTION/Paperwork_POC/`;
its launch spec is now [docs/launch-context.md](../docs/launch-context.md) and its
jrxml specs are in `iReport_Ports/specs/`.

## report_btn plugin (`report_btn/`)

Fishbowl client plugin (Java, proof of concept): adds an **Apps** section to every
module's Reports menu listing the BI reports whose fb-launch tag names that module or
its menu group (e.g. PURCHASING), and opens one in its own window on the module's open
record (`window.FB_LAUNCH`). First user: the Sales Order paperwork. Format in
`docs/launch-context.md`; build, install and client test in its README.

## Prototypes (`prototypes/`)

Early tools kept for reference.

| File | What it is |
|---|---|
| `Assembly_Disassembly_Helper.htm` | Disassembly in two steps: cycle-counts the assembly out, adds the component stock |
| `BackOrderDashboard.htm` | Back-order dashboard |

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
