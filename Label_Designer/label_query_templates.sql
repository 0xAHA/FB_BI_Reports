-- ============================================================================
-- LABEL PRINTING SQL QUERY TEMPLATES
-- ============================================================================
-- Ready-to-use SQL queries extracted from Fishbowl BI Reports
-- For label printing module - customize variables in ${} brackets
-- Generated: 2026-02-22

-- ============================================================================
-- LABEL TYPE 1: RECEIVING LABEL - ITEMS AWAITING PUT-AWAY
-- ============================================================================
-- Shows items received but not yet placed in inventory

SELECT
    ri.id as receipt_line_id,
    po.num as po_number,
    p.num as part_number,
    p.description,
    ri.qty as received_qty,
    COALESCE(uom.code, 'EA') as uom,
    COALESCE(GREATEST(ri.dateReceived, ri.dateReconciled), ri.dateReceived, ri.dateReconciled) as date_received,
    ri.landedtotalcost as total_cost,
    ri.landedtotalcost / NULLIF(ri.qty, 0) as unit_cost,
    v.name as vendor_name,
    r.locationgroupid,
    lg.name as location_group
FROM receiptitem ri
JOIN receipt r ON ri.receiptid = r.id
JOIN poitem ON ri.poitemid = poitem.id
JOIN part p ON poitem.partid = p.id
JOIN po ON poitem.poid = po.id
LEFT JOIN vendor v ON po.vendorid = v.id
LEFT JOIN uom ON p.uomid = uom.id
LEFT JOIN locationgroup lg ON r.locationgroupid = lg.id
WHERE ri.statusid >= 20  -- Reconciled, Received, Fulfilled
    AND p.typeid = 10    -- Inventory parts only
    AND p.activeflag = 1
    AND r.locationgroupid = ${locationGroupId}
ORDER BY po.num, p.num;

-- ============================================================================
-- LABEL TYPE 2: SHIPPING LABEL - SHIPMENT DETAILS
-- ============================================================================
-- Shows items to be shipped with carton/package info

SELECT
    ship.id as ship_id,
    ship.num as ship_number,
    so.num as sales_order_number,
    p.num as part_number,
    p.description,
    si.qty as qty_per_item,
    si.qtyshipped as qty_shipped,  -- IMPORTANT: Use qtyshipped, not qty
    COALESCE(uom.code, 'EA') as uom,
    so.customerpo,
    c.name as customer_name,
    ship.shiptoname as ship_to_address,
    cr.name as carrier,
    cs.name as service,
    so.datefirstship as scheduled_ship_date,
    ship.datecreated as created_date,
    ss.name as status
FROM ship
JOIN soitem si ON ship.soid = so.id
JOIN so ON si.soid = so.id
JOIN part p ON si.productid = p.id
LEFT JOIN customer c ON so.customerid = c.id
LEFT JOIN uom ON p.uomid = uom.id
LEFT JOIN carrier cr ON ship.carrierid = cr.id
LEFT JOIN carrierservice cs ON ship.carrierserviceid = cs.id
LEFT JOIN shipstatus ss ON ship.statusid = ss.id
WHERE ss.name IN ('Entered', 'Packed')
    AND p.typeid = 10
    AND ship.locationgroupid = ${locationGroupId}
ORDER BY ship.num, si.id;

-- ============================================================================
-- LABEL TYPE 3: PICK TICKET / WAREHOUSE LABEL
-- ============================================================================
-- Shows what to pick from which location

SELECT
    pick.id as pick_id,
    pick.num as pick_number,
    pick.datescheduled as scheduled_date,
    pr.name as priority,
    pi.id as pick_item_id,
    p.num as part_number,
    p.description,
    pi.qty as qty_to_pick,
    COALESCE(uom.code, 'EA') as uom,
    -- Availability calculation
    COALESCE((SELECT qty FROM qtyonhand WHERE partid = pi.partid AND locationgroupid = pick.locationgroupid), 0) as qty_on_hand,
    COALESCE((SELECT qty FROM qtycommitted WHERE partid = pi.partid AND locationgroupid = pick.locationgroupid), 0) as qty_committed,
    COALESCE((SELECT qty FROM qtynotavailabletopick WHERE partid = pi.partid AND locationgroupid = pick.locationgroupid), 0) as qty_unavailable,
    COALESCE((SELECT qty FROM qtyonhand WHERE partid = pi.partid AND locationgroupid = pick.locationgroupid), 0)
    - COALESCE((SELECT qty FROM qtycommitted WHERE partid = pi.partid AND locationgroupid = pick.locationgroupid), 0)
    - COALESCE((SELECT qty FROM qtynotavailabletopick WHERE partid = pi.partid AND locationgroupid = pick.locationgroupid), 0) as available_qty,
    -- Order info
    CASE pi.ordertypeid
        WHEN 10 THEN 'PO'
        WHEN 20 THEN 'SO'
        WHEN 30 THEN 'WO'
        WHEN 40 THEN 'TO'
        ELSE 'UNKNOWN'
    END as order_type,
    COALESCE(so.num, po.num, wo.num, xo.num) as order_number,
    COALESCE(c.name, v.name) as order_entity_name,
    lg.name as location_group,
    ps.name as pick_status,
    pis.name as item_status
FROM pick
JOIN pickitem pi ON pi.pickid = pick.id
JOIN part p ON pi.partid = p.id
LEFT JOIN uom ON p.uomid = uom.id
LEFT JOIN soitem si ON pi.soitemid = si.id
LEFT JOIN so ON si.soid = so.id
LEFT JOIN customer c ON so.customerid = c.id
LEFT JOIN poitem pmi ON pi.poitemid = pmi.id
LEFT JOIN po ON pmi.poid = po.id
LEFT JOIN vendor v ON po.vendorid = v.id
LEFT JOIN woitem wi ON pi.woitemid = wi.id
LEFT JOIN wo ON wi.woid = wo.id
LEFT JOIN xoitem xi ON pi.xoitemid = xi.id
LEFT JOIN xo ON xi.xoid = xo.id
LEFT JOIN locationgroup lg ON pick.locationgroupid = lg.id
LEFT JOIN priority pr ON pick.priority = pr.id
LEFT JOIN pickstatus ps ON pick.statusid = ps.id
LEFT JOIN pickitemstatus pis ON pi.statusid = pis.id
WHERE pick.statusid < 40    -- Active picks
    AND pi.statusid < 40    -- Active items
    AND p.typeid = 10
    AND pick.locationgroupid = ${locationGroupId}
ORDER BY pick.datescheduled, pick.num, p.num;

-- ============================================================================
-- LABEL TYPE 4: INVENTORY LOCATION/BIN LABEL
-- ============================================================================
-- Shows what's at each bin location

SELECT
    t.id as tag_id,
    p.num as part_number,
    p.description,
    t.qty as qty_at_location,
    COALESCE(uom.code, 'EA') as uom,
    l.id as location_id,
    l.name as location_name,
    lg.name as location_group,
    COALESCE(pc.avgcost, 0) as unit_cost,
    t.qty * COALESCE(pc.avgcost, 0) as total_value,
    pr.reorderpoint,
    pr.reorderqty,
    CASE 
        WHEN t.qty < pr.reorderpoint THEN 'LOW STOCK'
        ELSE 'OK'
    END as stock_status
FROM tag t
JOIN location l ON t.locationid = l.id
JOIN locationgroup lg ON l.locationgroupid = lg.id
JOIN part p ON t.partid = p.id
LEFT JOIN uom ON p.uomid = uom.id
LEFT JOIN partcost pc ON p.id = pc.partid
LEFT JOIN partreorder pr ON p.id = pr.partid AND pr.locationgroupid = lg.id
WHERE t.qty > 0
    AND p.typeid = 10
    AND p.activeflag = 1
    AND lg.id = ${locationGroupId}
ORDER BY l.name, p.num;

-- ============================================================================
-- LABEL TYPE 5: WORK ORDER / MANUFACTURING LABEL
-- ============================================================================
-- Shows what to manufacture

SELECT
    wo.id as wo_id,
    wo.num as work_order_number,
    wo.datescheduled as scheduled_date,
    p.num as finished_part_number,
    p.description as finished_part_description,
    wi.qty as qty_to_produce,
    COALESCE(uom.code, 'EA') as uom,
    mo.num as manufacturing_order_number,
    bom.num as bom_number,
    mi.qtytofulfill as bom_qty_to_fulfill,
    ws.name as work_order_status,
    lg.name as location_group
FROM wo
LEFT JOIN woitem wi ON wo.id = wi.woid
LEFT JOIN part p ON wi.partid = p.id
LEFT JOIN uom ON p.uomid = uom.id
LEFT JOIN moitem mi ON wo.moitemid = mi.id
LEFT JOIN mo ON mi.moid = mo.id
LEFT JOIN bom ON mi.bomid = bom.id
LEFT JOIN wostatus ws ON wo.statusid = ws.id
LEFT JOIN locationgroup lg ON wo.locationgroupid = lg.id
WHERE wo.statusid IN (10, 30)  -- Entered or Started
    AND p.typeid = 10
    AND wo.locationgroupid = ${locationGroupId}
ORDER BY wo.datescheduled, wo.num;

-- ============================================================================
-- LABEL TYPE 6: BELOW REORDER POINT / PROCUREMENT ALERT
-- ============================================================================
-- Shows items that need replenishment

SELECT
    p.id as part_id,
    p.num as part_number,
    p.description,
    COALESCE(qoh.qty, 0) as qty_on_hand,
    pr.reorderpoint,
    pr.reorderqty as suggested_reorder_qty,
    (pr.reorderpoint - COALESCE(qoh.qty, 0)) as qty_short,
    pr.reorderpoint as reorder_point,
    v.id as default_vendor_id,
    v.name as default_vendor,
    vp.vendorpartnum as vendor_part_number,
    lg.name as location_group,
    COALESCE(pc.avgcost, 0) as unit_cost,
    (pr.reorderpoint - COALESCE(qoh.qty, 0)) * COALESCE(pc.avgcost, 0) as reorder_value
FROM part p
INNER JOIN partreorder pr ON p.id = pr.partid
INNER JOIN locationgroup lg ON pr.locationgroupid = lg.id
LEFT JOIN qtyonhand qoh ON p.id = qoh.partid AND qoh.locationgroupid = lg.id
LEFT JOIN partcost pc ON p.id = pc.partid
LEFT JOIN vendor v ON pr.defaultvendorid = v.id
LEFT JOIN vendorparts vp ON p.id = vp.partid AND v.id = vp.vendorid
WHERE p.activeflag = 1
    AND p.typeid = 10
    AND pr.reorderpoint IS NOT NULL
    AND pr.reorderpoint > 0
    AND COALESCE(qoh.qty, 0) < pr.reorderpoint
    AND lg.id = ${locationGroupId}
ORDER BY (pr.reorderpoint - COALESCE(qoh.qty, 0)) DESC;

-- ============================================================================
-- LABEL TYPE 7: INVENTORY TAG / LOT TRACKING LABEL
-- ============================================================================
-- For serialized/lot-tracked items (if applicable)

SELECT
    p.id as part_id,
    p.num as part_number,
    p.description,
    pt.trackingtypeid,
    CASE pt.trackingtypeid
        WHEN 1 THEN 'Lot'
        WHEN 2 THEN 'Serial'
        WHEN 3 THEN 'Lot & Serial'
        ELSE 'None'
    END as tracking_type,
    sn.serialnumber,
    t.id as tag_id,
    t.qty as batch_qty,
    t.locationid,
    l.name as location_name,
    lg.name as location_group,
    t.datetimecreated as tag_date
FROM tag t
JOIN part p ON t.partid = p.id
LEFT JOIN parttracking pt ON p.id = pt.partid
LEFT JOIN serialnum sn ON t.partid = sn.partid
LEFT JOIN location l ON t.locationid = l.id
LEFT JOIN locationgroup lg ON l.locationgroupid = lg.id
WHERE t.qty > 0
    AND p.typeid = 10
    AND lg.id = ${locationGroupId}
    AND pt.trackingtypeid IS NOT NULL  -- Only tracked items
ORDER BY p.num, sn.serialnumber;

-- ============================================================================
-- LABEL TYPE 8: CARTON/BOX LABEL - MULTI-ITEM SHIPMENT
-- ============================================================================
-- Groups shipment items by carton (if carton tracking exists)

SELECT
    ship.num as ship_number,
    so.num as sales_order,
    c.name as customer_name,
    ship.shiptoname as destination,
    COUNT(DISTINCT si.id) as item_count,
    SUM(si.qty) as total_qty,
    GROUP_CONCAT(DISTINCT CONCAT(p.num, ' x', si.qty) ORDER BY p.num SEPARATOR ', ') as items,
    cr.name as carrier,
    cs.name as service,
    so.datefirstship as scheduled_date,
    ss.name as status
FROM ship
JOIN soitem si ON ship.soid = so.id
JOIN so ON si.soid = so.id
JOIN part p ON si.productid = p.id
LEFT JOIN customer c ON so.customerid = c.id
LEFT JOIN carrier cr ON ship.carrierid = cr.id
LEFT JOIN carrierservice cs ON ship.carrierserviceid = cs.id
LEFT JOIN shipstatus ss ON ship.statusid = ss.id
WHERE ss.name IN ('Entered', 'Packed')
    AND p.typeid = 10
    AND ship.locationgroupid = ${locationGroupId}
GROUP BY ship.id
ORDER BY ship.num;

-- ============================================================================
-- HELPER: GET LOCATION GROUPS (for dropdown filters)
-- ============================================================================

SELECT id, name
FROM locationgroup
WHERE activeflag = 1
ORDER BY name;

-- ============================================================================
-- HELPER: GET VENDORS (for vendor filtering)
-- ============================================================================

SELECT DISTINCT v.id, v.name
FROM vendor v
INNER JOIN vendorparts vp ON v.id = vp.vendorid AND vp.defaultflag = 1
WHERE v.activeflag = 1
ORDER BY v.name;

-- ============================================================================
-- HELPER: GET CUSTOMERS (for customer filtering)
-- ============================================================================

SELECT DISTINCT c.id, c.name
FROM customer c
INNER JOIN so ON c.id = so.customerid
WHERE c.activeflag = 1
ORDER BY c.name;

-- ============================================================================
-- END OF LABEL QUERY TEMPLATES
-- ============================================================================
