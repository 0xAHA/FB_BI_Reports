# Part 2 Plan: Label Query Templates & SQL Generator

## Overview
Add a **Label Template System** to the Fishbowl Label Designer that provides pre-built label templates with auto-generated SQL queries. When a user selects a template, the designer:
1. Pre-populates the canvas with a sensible default layout
2. Auto-adds the correct `$F{...}` field tokens for that label type
3. Generates the correct SQL `<queryString>` in the JRXML export
4. Includes a parameter dropdown for runtime filtering (e.g. PO number, location group)

---

## Standard Label Templates

### Template 1: Part / Product Label
**Use case:** General inventory labels for shelves, bins, products
**Fields:**
- `part_number` (part.num)
- `part_description` (part.description)
- `part_upc` (part.upc — for barcode)
- `uom` (uom.code)
- `unit_cost` (partcost.avgCost)
- `location_name` (location.name)
- `location_group` (locationgroup.name)
- `qty_on_hand` (SUM(tag.qty))

**Default layout:** Part number in large bold, barcode (UPC Code128), description below, qty + location at bottom

**SQL:** Simple part + tag + location + partcost join

---

### Template 2: Part Label with Tracking (Serial/Lot)
**Use case:** Labels for serialized or lot-tracked parts
**Fields:** All of Template 1, plus:
- `tracking_type` (parttracking.trackingtypeid → 'Lot'/'Serial'/'Lot & Serial')
- `serial_number` (serialnum.serialnumber)
- `batch_qty` (tag.qty per lot)
- `tag_date` (tag.datetimecreated)

**Default layout:** Part number + serial/lot barcode, tracking type indicator, qty

**SQL:** Part + tag + parttracking + serialnum joins
**Note:** One label per serial number (serial) or per tag (lot)

---

### Template 3: Multi-Tracking Label
**Use case:** Parts with multiple tracking values (e.g. lot + serial + expiration)
**Fields:** All of Template 2, plus:
- `tracking_value_1` through `tracking_value_4` (for multiple tracking dimensions)
- `expiration_date` (tracking expiration if applicable)

**Default layout:** Part number, multiple tracking fields stacked, barcode

**SQL:** Part + parttracking with multi-row tracking join

---

### Template 4: Receiving Label
**Use case:** Print labels for items just received on a PO
**Parameters:** PO Number or Receipt ID (user selects at print time)
**Fields:**
- `po_number` (po.num)
- `part_number` (part.num)
- `part_description` (part.description)
- `received_qty` (receiptitem.qty)
- `uom` (uom.code)
- `date_received` (GREATEST(ri.dateReceived, ri.dateReconciled))
- `vendor_name` (vendor.name)
- `unit_cost` (ri.landedtotalcost / ri.qty)
- `location_group` (locationgroup.name)

**Default layout:** PO number header, part number + barcode, qty received, vendor, date

**SQL:** receiptitem → receipt → poitem → part → po → vendor
**Filter:** `WHERE po.num = $P{po_number}` or `WHERE r.id = $P{receipt_id}`
**Note:** One label per receiptitem line (or qty-based: print N labels for qty N)

---

### Template 5: Shipping Label
**Use case:** Labels for outbound shipments
**Parameters:** Ship Number or SO Number
**Fields:**
- `ship_number` (ship.num)
- `sales_order` (so.num)
- `customer_name` (customer.name)
- `ship_to_address` (ship.shiptoname)
- `part_number` (part.num)
- `part_description` (part.description)
- `qty_shipped` (shipitem.qtyshipped — NOT .qty!)
- `uom` (uom.code)
- `carrier` (carrier.name)
- `service` (carrierservice.name)
- `customer_po` (so.customerpo)

**Default layout:** Ship-to address block at top, SO/ship number, part + qty, carrier info

**SQL:** ship → shipitem → soitem → so → part → customer → carrier
**Filter:** `WHERE ship.num = $P{ship_number}` or `WHERE so.num = $P{so_number}`

---

### Template 6: Pick Ticket Label
**Use case:** Labels for warehouse picks
**Parameters:** Pick Number
**Fields:**
- `pick_number` (pick.num)
- `scheduled_date` (pick.datescheduled)
- `priority` (priority.name)
- `part_number` (part.num)
- `part_description` (part.description)
- `qty_to_pick` (pickitem.qty)
- `available_qty` (qtyonhand - qtycommitted - qtynotavailabletopick)
- `order_type` (CASE ordertypeid: 10=PO, 20=SO, 30=WO, 40=TO)
- `order_number` (COALESCE(so.num, po.num, wo.num, xo.num))
- `entity_name` (customer or vendor name)
- `location_group` (locationgroup.name)

**Default layout:** Pick # header, part number + barcode, qty to pick vs available, order info

**SQL:** pick → pickitem → part + order type joins
**Filter:** `WHERE pick.num = $P{pick_number}`

---

### Template 7: Work Order Finished Goods Label
**Use case:** Labels for completed manufactured items
**Parameters:** WO Number
**Fields:**
- `work_order_number` (wo.num)
- `scheduled_date` (wo.datescheduled)
- `finished_part_number` (part.num — from woitem)
- `finished_part_description` (part.description)
- `qty_to_produce` (woitem.qty)
- `uom` (uom.code)
- `bom_number` (bom.num)
- `manufacturing_order` (mo.num)
- `work_order_status` (wostatus.name)
- `location_group` (locationgroup.name)

**Default layout:** WO number header, finished part + barcode, BOM reference, qty

**SQL:** wo → woitem → part + moitem → mo → bom
**Filter:** `WHERE wo.num = $P{wo_number}`

---

### Template 8: Inventory Location / Bin Label
**Use case:** Labels for physical bin/shelf locations showing stock
**Parameters:** Location Group
**Fields:**
- `location_name` (location.name)
- `location_group` (locationgroup.name)
- `part_number` (part.num)
- `part_description` (part.description)
- `qty_at_location` (tag.qty)
- `uom` (uom.code)
- `unit_cost` (partcost.avgCost)
- `total_value` (tag.qty * partcost.avgCost)
- `reorder_point` (partreorder.reorderpoint)
- `stock_status` (LOW STOCK / OK)

**Default layout:** Location name large at top, part details, qty with stock status indicator

**SQL:** tag → location → part → partcost → partreorder
**Filter:** `WHERE lg.id = $P{location_group_id}`

---

## Implementation Plan

### Phase 1: Template Data Model
- Define template configurations as JSON objects containing:
  - Template name, description, default label size
  - Field definitions (name, sql_expression, display_label, sample_data)
  - Default element layout (positions, sizes, fonts)
  - SQL query string with `$P{parameter}` placeholders
  - Parameter definitions (name, type, prompt text)
  - Table join chain documentation

### Phase 2: Template Selector UI
- Add "Templates" button to toolbar (or make it a section in the left panel)
- Modal/panel showing template cards with:
  - Template name and icon
  - Brief description
  - Preview thumbnail
- Clicking a template:
  - Prompts to confirm (will replace current design)
  - Sets label size to template default
  - Clears canvas and adds pre-positioned elements
  - Registers template fields in the field palette
  - Stores the SQL query with the design

### Phase 3: JRXML Query Integration
- Extend JRXML export to include `<queryString>` element:
  ```xml
  <queryString>
      <![CDATA[SELECT ... FROM ... WHERE ...]]>
  </queryString>
  ```
- Add `<parameter>` elements for runtime filters:
  ```xml
  <parameter name="po_number" class="java.lang.String">
      <parameterDescription><![CDATA[Enter PO Number]]></parameterDescription>
  </parameter>
  ```
- Ensure field names in `<field>` declarations match SQL column aliases

### Phase 4: Template Customization
- After loading a template, users can still:
  - Move/resize/delete any element
  - Add additional elements (static text, extra barcodes, etc.)
  - Modify the SQL query (simple text editor for advanced users)
  - Add/remove parameters
- Template serves as a starting point, not a locked design

### Phase 5: Print Quantity Logic
- For receiving/shipping labels, users may want to print qty-based:
  - "Print 1 label per line item" vs "Print N labels where N = received qty"
- Add a "Copies per record" option in template settings
- This maps to JasperReports' `isCountOnPage` or subreport logic

---

## SQL Gotchas to Encode in Templates

1. **ShipItem.QtyShipped** — always use `qtyshipped`, never `qty`
2. **SoItem.UnitPrice** — for sale price calculations
3. **part.typeid = 10** — always filter to inventory parts
4. **receiptitem.statusid >= 20** — reconciled/received items only
5. **pick.statusid < 40** — active picks only
6. **LEFT JOINs** — needed for partcost, partreorder, vendor (may not exist)
7. **COALESCE** — for nullable qty fields (qtyonhand, etc.)
8. **GREATEST(dateReceived, dateReconciled)** — for actual receipt date
9. **POST table** — for historical cost attribution (not current avgCost)
10. **locationgroupid** — always scope queries to user's location group

---

## File References

- Schema documentation: `Label_Designer/fishbowl_schema_reference.txt`
- SQL query templates: `Label_Designer/label_query_templates.sql`
- Label Designer app: `Label_Designer/Fishbowl_Label_Designer.htm`
