# Part 2 Plan: Label Template System (Revised)

## Key Design Changes

### 1. Start in Selector/Preview Mode (not Editor)
The app opens as a **report selector** — styled like a standard Fishbowl BI dashboard — where users:
- Browse available label templates (built-in + saved)
- Select a template and set parameters (PO#, Part#, etc.)
- Preview the label with live/sample data
- Print/Export directly
- Optionally click "Edit Design" to enter the WYSIWYG editor

### 2. Fishbowl BI Dashboard Styling
Match `Template/Core_Dashboard_Template.htm`:
- Same brand colors (`--color-primary: #2d9cdb`, sidebar `#06162d`)
- Same header bar, filter cards, rounded-2xl panels, Inter font
- Same loading overlay, custom scrollbars
- Debug console for SQL troubleshooting

### 3. Template Storage via `part.details`
Follow the `WO_Capacity_Planning_Gantt_v3.htm` pattern:
- Save templates as base64-encoded JSON in `part.details`
- Use dummy inactive parts with naming convention `_labelTpl_TemplateName`
- Load via `runQuery("SELECT details FROM part WHERE num = '...'"`
- Save via `ImportRq` API with `ImportPart` type
- Part settings: `Active=false`, `PartType="Internal Use"`, `ABCCode="N"`

---

## Application Flow

### View 1: Template Selector (Landing Page)

```
+----------------------------------------------------------------+
|  [Fishbowl icon] Label Designer            [+ New Blank] [gear] |
+----------------------------------------------------------------+
|                                                                  |
|  BUILT-IN TEMPLATES                                              |
|  +------------+ +------------+ +------------+ +------------+     |
|  | [icon]     | | [icon]     | | [icon]     | | [icon]     |     |
|  | Part Label | | Receiving  | | Shipping   | | Pick       |     |
|  | 4"x6"      | | 4"x3"      | | 4"x6"      | | 4"x3"      |     |
|  | Basic part | | PO receipt | | SO shipment| | Pick ticket|     |
|  | label with | | labels     | | labels     | | labels     |     |
|  | UPC barcode| |            | |            | |            |     |
|  +------------+ +------------+ +------------+ +------------+     |
|  +------------+ +------------+ +------------+ +------------+     |
|  | Tracking   | | Work Order | | Location   | | Custom     |     |
|  | Serial/Lot | | Finished   | | Bin Label  | | Blank      |     |
|  +------------+ +------------+ +------------+ +------------+     |
|                                                                  |
|  SAVED TEMPLATES (from Fishbowl)                                 |
|  +------------+ +------------+ +------------+                    |
|  | My Custom  | | Warehouse  | | [+ Save    |                    |
|  | Label v2   | | Bin Labels | |  Current]  |                    |
|  +------------+ +------------+ +------------+                    |
|                                                                  |
+----------------------------------------------------------------+
```

- Grid of template cards with icons, names, label sizes, descriptions
- Two sections: "Built-in Templates" and "Saved Templates" (loaded from DB)
- "New Blank" button opens editor with empty canvas
- Clicking a template opens the Parameter/Preview view

### View 2: Parameter & Preview (After Template Selection)

```
+----------------------------------------------------------------+
|  [< Back] Receiving Label                [Edit Design] [Print]  |
+----------------------------------------------------------------+
|  PARAMETERS                                                      |
|  +-----------------------------------------------------------+  |
|  | PO Number: [___________] [v]  Location Group: [All______] |  |
|  | [x] Show cost  [x] Show vendor  [ ] Show barcode          |  |
|  +-----------------------------------------------------------+  |
|                                                                  |
|  PREVIEW                                                         |
|  +-------------------+                                           |
|  |    +-----------+   |  Label: Receiving Label (4" x 3")       |
|  |    | PO-12345  |   |  Records: 12 items                      |
|  |    | PRT-10042 |   |  Template: Built-in                     |
|  |    | ||||||||| |   |                                          |
|  |    | Hex Bolt  |   |  [Print All] [Print Selected] [PDF]     |
|  |    | Qty: 50   |   |  [Export JRXML] [Save as Template]      |
|  |    +-----------+   |                                          |
|  +-------------------+                                           |
|                                                                  |
|  DATA (from query)                                               |
|  +-----------------------------------------------------------+  |
|  | # | Part Number | Description      | Qty | PO     | Vendor|  |
|  |---|-------------|------------------|-----|--------|-------|  |
|  | 1 | PRT-10042   | Hex Bolt M8x25   | 50  | PO-123 | Acme  |  |
|  | 2 | PRT-10043   | Washer M8        | 100 | PO-123 | Acme  |  |
|  +-----------------------------------------------------------+  |
+----------------------------------------------------------------+
```

- **Parameter bar** with template-specific filters (dropdowns populated from DB)
- **Live preview** of a single label rendered at actual size with real data
- **Data table** showing all records the query returns (optional expand)
- **Actions**: Print, PDF, JRXML Export, Save as Template
- **"Edit Design"** button → switches to the WYSIWYG editor (View 3)
- Show/hide field toggles let users optionally hide certain fields on the label
- When running inside Fishbowl (runQuery available): live data from DB
- When running standalone (no runQuery): sample data for demo

### View 3: WYSIWYG Editor (Existing Design Tool)

Same as current implementation but with additions:
- "Back to Selector" button in toolbar
- Template SQL query editor (expandable panel)
- Parameter definitions editor
- "Save to Fishbowl" button (writes to part.details via ImportRq)

---

## Template Data Model

Each template (built-in or saved) is a JSON object:

```json
{
  "version": 1,
  "meta": {
    "name": "Receiving Label",
    "description": "Print labels for items received on a purchase order",
    "icon": "receive",
    "category": "built-in",
    "labelSize": "4x3",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  },
  "label": {
    "name": "Receiving Label",
    "width": 288,
    "height": 216
  },
  "elements": [
    {
      "id": "elem_1", "type": "fieldToken", "fieldName": "po_number",
      "x": 10, "y": 10, "width": 268, "height": 24,
      "fontSize": 16, "fontBold": true, "fontFamily": "SansSerif",
      "textAlign": "left", "textColor": "#000000", "rotation": 0, "zIndex": 1
    },
    {
      "id": "elem_2", "type": "barcode", "barcodeType": "Code128",
      "dataSource": "field", "fieldName": "part_number",
      "x": 10, "y": 40, "width": 200, "height": 60,
      "showHumanReadable": true, "rotation": 0, "zIndex": 2
    }
  ],
  "fields": [
    { "name": "po_number",    "sqlExpr": "po.num",                 "javaClass": "java.lang.String", "label": "PO Number",     "sampleData": "PO-12345" },
    { "name": "part_number",  "sqlExpr": "p.num",                  "javaClass": "java.lang.String", "label": "Part Number",   "sampleData": "PRT-10042" },
    { "name": "description",  "sqlExpr": "p.description",          "javaClass": "java.lang.String", "label": "Description",   "sampleData": "Hex Bolt M8x25" },
    { "name": "received_qty", "sqlExpr": "ri.qty",                 "javaClass": "java.lang.Double", "label": "Received Qty",  "sampleData": "50" },
    { "name": "uom",          "sqlExpr": "COALESCE(uom.code,'EA')", "javaClass": "java.lang.String", "label": "UOM",           "sampleData": "ea" },
    { "name": "vendor_name",  "sqlExpr": "v.name",                 "javaClass": "java.lang.String", "label": "Vendor",        "sampleData": "Acme Supply Co" },
    { "name": "date_received","sqlExpr": "COALESCE(GREATEST(ri.dateReceived,ri.dateReconciled),ri.dateReceived)", "javaClass": "java.lang.String", "label": "Date Received", "sampleData": "2025-12-15" },
    { "name": "unit_cost",    "sqlExpr": "ri.landedtotalcost/NULLIF(ri.qty,0)", "javaClass": "java.lang.Double", "label": "Unit Cost", "sampleData": "$4.50" },
    { "name": "location_group","sqlExpr": "lg.name",               "javaClass": "java.lang.String", "label": "Location Group","sampleData": "Main Warehouse" }
  ],
  "query": {
    "sql": "SELECT po.num AS po_number, p.num AS part_number, p.description, ri.qty AS received_qty, COALESCE(uom.code,'EA') AS uom, v.name AS vendor_name, COALESCE(GREATEST(ri.dateReceived,ri.dateReconciled),ri.dateReceived) AS date_received, ri.landedtotalcost/NULLIF(ri.qty,0) AS unit_cost, lg.name AS location_group FROM receiptitem ri JOIN receipt r ON ri.receiptid=r.id JOIN poitem ON ri.poitemid=poitem.id JOIN part p ON poitem.partid=p.id JOIN po ON poitem.poid=po.id LEFT JOIN vendor v ON po.vendorid=v.id LEFT JOIN uom ON p.uomid=uom.id LEFT JOIN locationgroup lg ON r.locationgroupid=lg.id WHERE ri.statusid>=20 AND p.typeid=10 AND po.num LIKE $P{po_number} ORDER BY p.num",
    "notes": "One label per receiptitem line"
  },
  "parameters": [
    { "name": "po_number", "javaClass": "java.lang.String", "prompt": "PO Number", "default": "%", "inputType": "text" },
    { "name": "location_group_id", "javaClass": "java.lang.Integer", "prompt": "Location Group", "default": "", "inputType": "dropdown", "lookupQuery": "SELECT id, name FROM locationgroup WHERE activeflag=1 ORDER BY name" }
  ],
  "options": {
    "toggleableFields": ["unit_cost", "vendor_name", "date_received"],
    "copiesPerRecord": false
  }
}
```

---

## Storage: part.details Pattern

### Naming Convention
Each saved template stored as an inactive part:
- Part number: `_labelTpl_{TemplateName}` (e.g. `_labelTpl_ReceivingLabel`)
- Description: `Label Template: Receiving Label`
- Active: `false`
- Part Type: `Internal Use`
- Details: base64-encoded JSON template

### Save Flow (via ImportRq API)
```javascript
function saveTemplateToFishbowl(template) {
    const json = JSON.stringify(template);
    const base64 = btoa(json);
    const partNum = '_labelTpl_' + template.meta.name.replace(/[^a-zA-Z0-9]/g, '');

    const headers = queryImportHeaders();  // Get ImportPart CSV headers
    const fieldValues = {
        'PartNumber': `"${partNum}"`,
        'PartDescription': `"Label Template: ${template.meta.name}"`,
        'PartDetails': `"${base64}"`,
        'UOM': '"ea"',
        'PartType': '"Internal Use"',
        'Active': '"false"',
        'ABCCode': '"N"',
        // ... other required fields with defaults
    };

    // Build CSV and call ImportRq API
    runApiRequest('ImportRq', JSON.stringify({
        ImportRq: { Type: 'ImportPart', Rows: { Row: [headers, csvRow] } }
    }));
}
```

### Load Flow (via runQuery)
```javascript
function loadSavedTemplates() {
    const query = `
        SELECT num, description, details
        FROM part
        WHERE num LIKE '_labelTpl_%'
        AND typeid = 30  -- Internal Use
        ORDER BY num
    `;
    const results = JSON.parse(runQuery(query));
    return results.map(row => {
        const json = atob(row.details);
        return JSON.parse(json);
    });
}
```

---

## Built-in Templates (8 total)

| # | Template | Default Size | Primary Fields | Parameter |
|---|----------|-------------|----------------|-----------|
| 1 | Part / Product Label | 4"x6" | part_number, description, UPC barcode, qty, location | Location Group |
| 2 | Part + Serial/Lot Tracking | 4"x6" | part_number, serial/lot barcode, tracking type, qty | Location Group |
| 3 | Multi-Tracking Label | 4"x6" | part_number, multiple tracking values, expiration | Location Group |
| 4 | Receiving Label | 4"x3" | po_number, part_number, received_qty, vendor, date | PO Number |
| 5 | Shipping Label | 4"x6" | ship_number, SO, customer, ship-to, carrier, qty | Ship/SO Number |
| 6 | Pick Ticket Label | 4"x3" | pick_number, part_number, qty_to_pick, available, order | Pick Number |
| 7 | Work Order Label | 4"x3" | wo_number, finished_part, qty, BOM, MO | WO Number |
| 8 | Inventory Location Label | 4"x3" | location_name, part_number, qty, cost, reorder status | Location Group |

---

## Implementation Phases

### Phase 1: Restyle as Fishbowl BI Dashboard
- Replace current CSS with Core_Dashboard_Template styling
- Add CSS variables (`--color-primary`, etc.)
- Use Tailwind via CDN
- Add header bar, loading overlay, custom scrollbars
- Add debug console (collapsible)

### Phase 2: Template Selector View (Landing Page)
- Template card grid with built-in templates
- Each card: icon, name, description, label size, click to select
- "New Blank Label" card to go straight to editor
- Section for saved templates (loaded from DB or shown as empty)
- Fishbowl API detection: check if `runQuery` exists
  - If yes: load saved templates from part.details
  - If no: show "Connect to Fishbowl to access saved templates"

### Phase 3: Parameter & Preview View
- Parameter bar with template-specific inputs
- Dropdowns populated via `lookupQuery` (when in Fishbowl)
- Field toggle checkboxes (show/hide optional fields)
- Live label preview using the rendering engine from the editor
- Data table showing query results (when in Fishbowl)
- Print/PDF/JRXML export buttons
- "Edit Design" button to enter editor

### Phase 4: Editor View Updates
- Add "Back to Selector" button
- Add template SQL editor (collapsible textarea in properties panel)
- Add parameter definitions editor
- "Save to Fishbowl" button with ImportRq integration
- "Save Locally" button (JSON download, current behavior)

### Phase 5: JRXML Export Enhancements
- Include `<queryString>` in export
- Include `<parameter>` elements with prompts and defaults
- Field `class` attributes from template definitions (String, Double, etc.)
- Ensure SQL column aliases match `<field name="...">` declarations

### Phase 6: All 8 Built-in Templates
- Define complete JSON configs for each template
- Default element layouts (positions, sizes, fonts, barcodes)
- Correct SQL queries extracted from research
- Parameter definitions with lookup queries
- Sample data for standalone preview

---

## SQL Gotchas Encoded in Templates

1. `ShipItem.QtyShipped` — never `qty`
2. `SoItem.UnitPrice` — for sale price
3. `part.typeid = 10` — inventory parts only
4. `receiptitem.statusid >= 20` — reconciled/received
5. `pick.statusid < 40` — active picks
6. `LEFT JOIN` for partcost, partreorder, vendor
7. `COALESCE` for nullable qty fields
8. `GREATEST(dateReceived, dateReconciled)` for receipt date
9. `locationgroupid` scoping in all queries

---

## API Detection Pattern

```javascript
// Detect if running inside Fishbowl
const IN_FISHBOWL = typeof runQuery === 'function';

function safeRunQuery(sql) {
    if (!IN_FISHBOWL) return null;
    try { return JSON.parse(runQuery(sql)); }
    catch(e) { debugLog('Query error: ' + e.message, 'error'); return null; }
}
```

When not in Fishbowl: all features work with sample data, save/load uses JSON files only, "Save to Fishbowl" is disabled with tooltip explaining why.

---

## File References

- Core styling template: `Template/Core_Dashboard_Template.htm`
- Part.details storage example: `Manufacturing/WO_Capacity_Planning_Gantt_v3.htm` (lines 3395-3556)
- Schema documentation: `Label_Designer/fishbowl_schema_reference.txt`
- SQL query templates: `Label_Designer/label_query_templates.sql`
- Current Label Designer: `Label_Designer/Fishbowl_Label_Designer.htm`
