-- Fishbowl Advanced Schema: Views
-- 49 views — defined in com.fbi.dbversioning.views
--
-- Performance: MySQL uses two algorithms for views:
--   MERGE     — outer WHERE is merged into the view SQL; base-table indexes are used. Safe to filter.
--   TEMPTABLE — view is fully materialized into a temp table first; outer WHERE applies after.
-- TEMPTABLE is forced by GROUP BY, UNION, DISTINCT, or aggregate functions (SUM, COUNT...).
-- Views marked TEMPTABLE should not be queried with a WHERE clause. Reproduce the relevant
-- sub-query inline with your filter baked in so the database can use indexes on the base tables.
--
-- The application does not query these views at runtime. They exist for custom reports only.
-- Columns are uppercase in the view definitions; runQuery() returns them lowercase.

-- ============================================================
-- QUANTITY VIEWS
-- All TEMPTABLE. Do not filter on these views — reproduce inline.
--
-- Inline pattern example (QTYONHAND for a specific part):
--   SELECT l.locationgroupid, COALESCE(SUM(t.qty), 0) AS qty
--   FROM tag t
--   INNER JOIN location l ON l.id = t.locationid
--   WHERE t.typeid IN (30, 40) AND t.partid = ?
--   GROUP BY l.locationgroupid
--
-- Inline pattern example (QTYINVENTORY for a specific part — pick only the columns you need):
--   SELECT
--     l.locationgroupid,
--     COALESCE(SUM(t.qty), 0) AS qtyonhand,
--     COALESCE(SUM(t.qtycommitted), 0) AS qtycommitted
--   FROM tag t
--   INNER JOIN location l ON l.id = t.locationid
--   WHERE t.typeid IN (30, 40) AND t.partid = ?
--   GROUP BY l.locationgroupid
-- ============================================================

-- QTYONHAND — TEMPTABLE
-- On-hand quantity summed by part and location group.
-- Source: tag (typeId IN 30,40) + location
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYONHAND
AS
SELECT tag.partid AS PARTID,
    location.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(qty), 0) AS QTY
FROM Tag
INNER JOIN Location ON Location.ID = Tag.locationID
WHERE Tag.typeID IN (30, 40)
GROUP BY Location.locationGroupID, tag.partid;

-- QTYCOMMITTED — TEMPTABLE
-- Committed quantity by part and location group (from tag.qtyCommitted).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYCOMMITTED
AS
SELECT tag.partid AS PARTID,
    location.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(tag.qtycommitted), 0) AS QTY
FROM tag
INNER JOIN location ON (tag.locationid = location.id)
GROUP BY tag.partid, location.locationgroupid;

-- QTYNOTAVAILABLE — TEMPTABLE
-- Qty in locations where countedAsAvailable = 0 (e.g. receiving bins).
-- Excludes shipping locations (location.typeId = 100).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYNOTAVAILABLE
AS
SELECT tag.partid AS PARTID,
    location.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(qty - qtyCommitted), 0) AS QTY
FROM Tag
INNER JOIN Location ON Location.ID = Tag.locationID
WHERE Tag.typeID IN (30, 40)
    AND Location.countedAsAvailable = 0
    AND Location.typeID <> 100
GROUP BY location.locationgroupid, tag.partid;

-- QTYNOTAVAILABLETOPICK — TEMPTABLE
-- Qty in locations where pickable = 0.
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYNOTAVAILABLETOPICK
AS
SELECT tag.partid AS PARTID,
    location.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(qty - qtyCommitted), 0) AS QTY
FROM Tag
INNER JOIN Location ON Location.ID = Tag.locationID
WHERE Tag.typeID IN (30, 40)
    AND Location.pickable = 0
    AND Location.typeID <> 100
GROUP BY location.locationgroupid, tag.partid;

-- QTYDROPSHIP — TEMPTABLE
-- Drop-ship qty from open SO items (soitem.typeId = 12).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYDROPSHIP
AS
SELECT part.id AS PARTID,
    so.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN SOItem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (SOItem.qtyToFulfill - SOItem.qtyFulfilled) * uomconversion.MULTIPLY / uomconversion.FACTOR
            ELSE SOItem.qtyToFulfill - SOItem.qtyFulfilled
            END), 0) AS QTY
FROM SOItem
INNER JOIN Product ON Product.ID = SOItem.productID
INNER JOIN Part ON Part.ID = Product.partID
INNER JOIN SO ON SO.ID = SOItem.SOID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = soitem.uomid)
WHERE SO.statusID IN (20, 25)
    AND SOItem.statusID IN (10, 14, 20, 30, 40)
    AND SOItem.typeID = 12
GROUP BY part.id, so.locationgroupid;

-- QTYALLOCATEDSO — TEMPTABLE
-- Qty allocated by open SO items (typeId IN 10,12; statusId IN 10,14,20,30,40; SO statusId IN 20,25).
-- UOM-converted to the part's base UOM.
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYALLOCATEDSO
AS
SELECT part.id AS PARTID,
    so.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN SOItem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (SOItem.qtyToFulfill - SOItem.qtyFulfilled) * uomconversion.MULTIPLY / uomconversion.FACTOR
            ELSE SOItem.qtyToFulfill - SOItem.qtyFulfilled
            END), 0) AS QTY
FROM Part
INNER JOIN Product ON Part.ID = Product.partID
INNER JOIN SOItem ON Product.ID = SOItem.productID
INNER JOIN SO ON SO.ID = SOItem.SOID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = soitem.uomid)
WHERE SO.statusID IN (20, 25)
    AND SOItem.statusID IN (10, 14, 20, 30, 40)
    AND SOItem.typeID IN (10, 12)
    AND Part.typeId = 10
GROUP BY part.id, so.locationgroupid;

-- QTYALLOCATEDPO — TEMPTABLE
-- Qty allocated by open PO items (po.statusId BETWEEN 20 AND 55; item statusId IN 10,20,30,40,45).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYALLOCATEDPO
AS
SELECT part.id AS PARTID,
    po.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN poitem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (poitem.qtyToFulfill - poitem.qtyFulfilled) * uomconversion.MULTIPLY / uomconversion.FACTOR
            ELSE poitem.qtyToFulfill - poitem.qtyFulfilled
            END), 0) AS QTY
FROM Part
INNER JOIN POItem ON part.ID = POItem.partid
INNER JOIN PO ON po.ID = POItem.POID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = poitem.uomid)
WHERE PO.statusID BETWEEN 20 AND 55
    AND POItem.statusID IN (10, 20, 30, 40, 45)
    AND POItem.typeID IN (20, 30)
    AND Part.typeId = 10
GROUP BY part.id, po.locationgroupid;

-- QTYALLOCATEDMO — TEMPTABLE
-- Qty allocated by open WO raw-material items (typeId IN 20,30; wo.statusId < 40).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYALLOCATEDMO
AS
SELECT part.id AS PARTID,
    WO.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN WOItem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (WOItem.QTYTARGET * uomconversion.MULTIPLY / uomconversion.FACTOR)
            ELSE (WOItem.QTYTARGET)
            END), 0) AS QTY
FROM Part
INNER JOIN WOItem ON Part.ID = WOItem.PARTID
INNER JOIN WO ON WO.ID = WOItem.WOID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = WOItem.UOMID)
WHERE WO.statusID < 40
    AND WOItem.TYPEID IN (20, 30)
    AND Part.typeId = 10
GROUP BY part.id, WO.LOCATIONGROUPID;

-- QTYALLOCATEDTORECEIVE — TEMPTABLE
-- Qty on XO allocated to receive into the destination location group (shipToLGId).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYALLOCATEDTORECEIVE
AS
SELECT part.id AS PARTID,
    xo.SHIPTOLGID AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN xoitem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (xoitem.qtyToFulfill - xoitem.qtyFulfilled) * uomconversion.MULTIPLY / uomconversion.FACTOR
            ELSE xoitem.qtyToFulfill - xoitem.qtyFulfilled
            END), 0) AS QTY
FROM Part
INNER JOIN xoItem ON part.ID = xoItem.partid
INNER JOIN xo ON xo.ID = xoItem.xoID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = xoitem.uomid)
WHERE xo.statusID IN (20, 30, 40, 50, 60)
    AND xoItem.statusID IN (10, 20, 30, 40, 50)
    AND xoItem.typeID = 20
    AND Part.typeId = 10
GROUP BY part.id, xo.SHIPTOLGID;

-- QTYALLOCATEDTOSEND — TEMPTABLE
-- Qty on XO allocated to send from the source location group (fromLGId).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYALLOCATEDTOSEND
AS
SELECT part.id AS PARTID,
    xo.fromLGID AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN xoitem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (xoitem.qtyToFulfill - xoitem.qtyFulfilled) * uomconversion.MULTIPLY / uomconversion.FACTOR
            ELSE xoitem.qtyToFulfill - xoitem.qtyFulfilled
            END), 0) AS QTY
FROM Part
INNER JOIN xoitem ON part.ID = xoitem.partid
INNER JOIN xo ON xo.ID = xoitem.xoid
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = xoitem.uomid)
WHERE xo.statusID IN (20, 30, 40, 50, 60)
    AND xoitem.statusID IN (10, 20, 30, 40, 50)
    AND xoitem.typeID = 10
    AND Part.typeId = 10
GROUP BY part.id, xo.fromLGID;

-- QTYALLOCATED — TEMPTABLE (unions 5 sub-views, each TEMPTABLE)
-- Total allocated qty across SO, PO, MO/WO, and both XO directions.
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYALLOCATED
AS
SELECT totalQty.partid AS PARTID,
    totalQty.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(totalQty.qty), 0) AS QTY
FROM (
    SELECT 'SO' AS t, QTYALLOCATEDSO.* FROM QTYALLOCATEDSO
    UNION
    SELECT 'PO' AS t, QTYALLOCATEDPO.* FROM QTYALLOCATEDPO
    UNION
    SELECT 'TOSend' AS t, QTYALLOCATEDTOSEND.* FROM QTYALLOCATEDTOSEND
    UNION
    SELECT 'TOReceive' AS t, QTYALLOCATEDTORECEIVE.* FROM QTYALLOCATEDTORECEIVE
    UNION
    SELECT 'MO' AS t, QtyAllocatedMO.* FROM QtyAllocatedMO
) totalQty
GROUP BY totalQty.partid, totalQty.locationgroupid;

-- QTYONORDERPO — TEMPTABLE
-- Qty on order from PO receipts (receiptitem.statusId IN 10,20; receipt.orderTypeId=10).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYONORDERPO
AS
SELECT Part.id AS PARTID,
    Receipt.locationGroupId AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN ReceiptItem.uomId <> Part.uomId AND UomConversion.id > 0
                THEN ReceiptItem.qty * UomConversion.multiply / UomConversion.factor
            ELSE ReceiptItem.qty
            END), 0) AS QTY
FROM Receipt
INNER JOIN ReceiptItem ON Receipt.id = ReceiptItem.receiptId
INNER JOIN Part ON Part.id = ReceiptItem.partId
LEFT OUTER JOIN UomConversion ON (UomConversion.toUomId = Part.uomId AND UomConversion.fromUomId = ReceiptItem.uomId)
WHERE Receipt.orderTypeId = 10
    AND ReceiptItem.statusId IN (10, 20)
GROUP BY Part.id, Receipt.locationGroupId;

-- QTYONORDERSO — TEMPTABLE
-- Qty on order from open SO items (typeId=20; statusId IN 10,14,30; SO statusId IN 20,25).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYONORDERSO
AS
SELECT part.id AS PARTID,
    so.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN SOItem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (SOItem.qtyToFulfill - SOItem.qtyFulfilled) * uomconversion.MULTIPLY / uomconversion.FACTOR
            ELSE SOItem.qtyToFulfill - SOItem.qtyFulfilled
            END), 0) AS QTY
FROM Part
INNER JOIN Product ON Part.ID = Product.partID
INNER JOIN SOItem ON Product.ID = SOItem.productID
INNER JOIN SO ON SO.ID = SOItem.SOID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = soitem.uomid)
WHERE SO.statusID IN (20, 25)
    AND SOItem.statusID IN (10, 14, 30)
    AND SOItem.typeID IN (20)
GROUP BY part.id, so.locationgroupid;

-- QTYONORDERMO — TEMPTABLE
-- Qty on order from open WO finished-good items (typeId IN 10,31; wo.statusId < 40).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYONORDERMO
AS
SELECT part.id AS PARTID,
    WO.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN WOItem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (WOItem.QTYTARGET * uomconversion.MULTIPLY / uomconversion.FACTOR)
            ELSE (WOItem.QTYTARGET)
            END), 0) AS QTY
FROM Part
INNER JOIN WOItem ON Part.ID = WOItem.PARTID
INNER JOIN WO ON WO.ID = WOItem.WOID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = WOItem.UOMID)
WHERE WO.statusID < 40
    AND WOItem.TYPEID IN (10, 31)
GROUP BY part.id, WO.LOCATIONGROUPID;

-- QTYONORDERTORECEIVE — TEMPTABLE
-- XO qty on order for the receiving location group (fromLGId side).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYONORDERTORECEIVE
AS
SELECT part.id AS PARTID,
    xo.FROMLGID AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN xoitem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (xoitem.qtyToFulfill - xoitem.qtyFulfilled) * uomconversion.MULTIPLY / uomconversion.FACTOR
            ELSE xoitem.qtyToFulfill - xoitem.qtyFulfilled
            END), 0) AS QTY
FROM Part
INNER JOIN xoItem ON part.ID = xoItem.partid
INNER JOIN xo ON xo.ID = xoItem.xoID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = xoitem.uomid)
WHERE xo.statusID IN (20, 30, 40, 50, 60)
    AND xoItem.statusID IN (10, 20, 30, 40, 50)
    AND xoItem.typeID = 20
GROUP BY part.id, xo.FROMLGID;

-- QTYONORDERTOSEND — TEMPTABLE
-- XO qty on order for the sending location group (shipToLGId side).
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYONORDERTOSEND
AS
SELECT part.id AS PARTID,
    xo.SHIPTOLGID AS LOCATIONGROUPID,
    COALESCE(SUM(CASE
            WHEN xoitem.UOMID <> part.uomid AND uomconversion.ID > 0
                THEN (xoitem.qtyToFulfill - xoitem.qtyFulfilled) * uomconversion.MULTIPLY / uomconversion.FACTOR
            ELSE xoitem.qtyToFulfill - xoitem.qtyFulfilled
            END), 0) AS QTY
FROM Part
INNER JOIN xoItem ON part.ID = xoItem.partid
INNER JOIN xo ON xo.ID = xoItem.xoID
LEFT OUTER JOIN uomconversion ON (uomconversion.TOUOMID = part.uomid AND uomconversion.FROMUOMID = xoitem.uomid)
WHERE xo.statusID IN (20, 30, 40, 50, 60)
    AND xoItem.statusID IN (10, 20, 30, 40, 50)
    AND xoItem.typeID = 10
GROUP BY part.id, xo.SHIPTOLGID;

-- QTYONORDER — TEMPTABLE (unions 5 sub-views, each TEMPTABLE)
-- Total on-order qty across PO, SO, MO/WO, and both XO directions.
-- Columns: PARTID, LOCATIONGROUPID, QTY
CREATE OR REPLACE VIEW QTYONORDER
AS
SELECT totalQty.partid AS PARTID,
    totalQty.locationgroupid AS LOCATIONGROUPID,
    COALESCE(SUM(totalQty.qty), 0) AS QTY
FROM (
    SELECT 'SO' AS t, QTYONORDERSO.* FROM QTYONORDERSO
    UNION
    SELECT 'PO' AS t, QTYONORDERPO.* FROM QTYONORDERPO
    UNION
    SELECT 'TOSend' AS t, QTYONORDERTOSEND.* FROM QTYONORDERTOSEND
    UNION
    SELECT 'TOReceive' AS t, QTYONORDERTORECEIVE.* FROM QTYONORDERTORECEIVE
    UNION
    SELECT 'MO' AS t, QtyOnOrderMO.* FROM QtyOnOrderMO
) totalQty
GROUP BY totalQty.partid, totalQty.locationgroupid;

-- QTYINVENTORY — TEMPTABLE (unions 15 sub-views; most expensive view in the schema)
-- Comprehensive inventory pivot: one row per part+locationgroup with all quantity types as columns.
-- Columns: PARTID, LOCATIONGROUPID, QTYONHAND, QTYALLOCATEDPO, QTYALLOCATEDSO,
--          QTYALLOCATEDMO, QTYALLOCATEDTO (XO both directions combined), QTYNOTAVAILABLE,
--          QTYNOTAVAILABLETOPICK, QTYDROPSHIP, QTYONORDERPO, QTYONORDERSO,
--          QTYONORDERTO (XO both directions combined), QTYONORDERMO
CREATE OR REPLACE VIEW QTYINVENTORY
AS
SELECT totalQty.partid AS PARTID,
    totalQty.locationgroupid AS LOCATIONGROUPID,
    SUM(CASE WHEN totalqty.t = 'QTYONHAND'            THEN totalqty.qty ELSE 0 END) AS QTYONHAND,
    SUM(CASE WHEN totalqty.t = 'QTYALLOCATEDPO'       THEN totalqty.qty ELSE 0 END) AS QTYALLOCATEDPO,
    SUM(CASE WHEN totalqty.t = 'QTYALLOCATEDSO'       THEN totalqty.qty ELSE 0 END) AS QTYALLOCATEDSO,
    SUM(CASE WHEN totalqty.t = 'QTYALLOCATEDMO'       THEN totalqty.qty ELSE 0 END) AS QTYALLOCATEDMO,
    (SUM(CASE WHEN totalqty.t = 'QTYALLOCATEDTORECEIVE' THEN totalqty.qty ELSE 0 END)
   + SUM(CASE WHEN totalqty.t = 'QTYALLOCATEDTOSEND'   THEN totalqty.qty ELSE 0 END)) AS QTYALLOCATEDTO,
    SUM(CASE WHEN totalqty.t = 'QTYNOTAVAILABLE'      THEN totalqty.qty ELSE 0 END) AS QTYNOTAVAILABLE,
    SUM(CASE WHEN totalqty.t = 'QTYNOTAVAILABLETOPICK' THEN totalqty.qty ELSE 0 END) AS QTYNOTAVAILABLETOPICK,
    SUM(CASE WHEN totalqty.t = 'QTYDROPSHIP'          THEN totalqty.qty ELSE 0 END) AS QTYDROPSHIP,
    SUM(CASE WHEN totalqty.t = 'QTYONORDERPO'         THEN totalqty.qty ELSE 0 END) AS QTYONORDERPO,
    SUM(CASE WHEN totalqty.t = 'QTYONORDERSO'         THEN totalqty.qty ELSE 0 END) AS QTYONORDERSO,
    (SUM(CASE WHEN totalqty.t = 'QTYONORDERTORECEIVE' THEN totalqty.qty ELSE 0 END)
   + SUM(CASE WHEN totalqty.t = 'QTYONORDERTOSEND'    THEN totalqty.qty ELSE 0 END)) AS QTYONORDERTO,
    SUM(CASE WHEN totalqty.t = 'QTYONORDERMO'         THEN totalqty.qty ELSE 0 END) AS QTYONORDERMO
FROM (
    SELECT 'QTYONHAND' AS t,            QTYONHAND.*            FROM QTYONHAND
    UNION SELECT 'QTYALLOCATED' AS t,   QTYALLOCATED.*         FROM QTYALLOCATED
    UNION SELECT 'QTYALLOCATEDPO' AS t, QTYALLOCATEDPO.*       FROM QTYALLOCATEDPO
    UNION SELECT 'QTYALLOCATEDSO' AS t, QTYALLOCATEDSO.*       FROM QTYALLOCATEDSO
    UNION SELECT 'QTYALLOCATEDTORECEIVE' AS t, QTYALLOCATEDTORECEIVE.* FROM QTYALLOCATEDTORECEIVE
    UNION SELECT 'QTYALLOCATEDTOSEND' AS t,    QTYALLOCATEDTOSEND.*    FROM QTYALLOCATEDTOSEND
    UNION SELECT 'QTYALLOCATEDMO' AS t, QTYALLOCATEDMO.*       FROM QTYALLOCATEDMO
    UNION SELECT 'QTYNOTAVAILABLE' AS t, QTYNOTAVAILABLE.*     FROM QTYNOTAVAILABLE
    UNION SELECT 'QTYNOTAVAILABLETOPICK' AS t, QTYNOTAVAILABLETOPICK.* FROM QTYNOTAVAILABLETOPICK
    UNION SELECT 'QTYDROPSHIP' AS t,    QTYDROPSHIP.*          FROM QTYDROPSHIP
    UNION SELECT 'QTYONORDERPO' AS t,   QTYONORDERPO.*         FROM QTYONORDERPO
    UNION SELECT 'QTYONORDERSO' AS t,   QTYONORDERSO.*         FROM QTYONORDERSO
    UNION SELECT 'QTYONORDERTORECEIVE' AS t, QTYONORDERTORECEIVE.* FROM QTYONORDERTORECEIVE
    UNION SELECT 'QTYONORDERTOSEND' AS t,    QTYONORDERTOSEND.*    FROM QTYONORDERTOSEND
    UNION SELECT 'QTYONORDERMO' AS t,   QTYONORDERMO.*         FROM QTYONORDERMO
) totalQty
GROUP BY totalqty.partid, totalqty.locationgroupid;

-- QTYINVENTORYTOTALS — TEMPTABLE (wraps QTYINVENTORY; same cost)
-- Simplified rollup from QTYINVENTORY: collapses allocated and on-order breakdowns to two totals.
-- Columns: PARTID, LOCATIONGROUPID, QTYONHAND, QTYALLOCATED, QTYNOTAVAILABLE,
--          QTYNOTAVAILABLETOPICK, QTYDROPSHIP, QTYONORDER
CREATE OR REPLACE VIEW QTYINVENTORYTOTALS
AS
SELECT QTYINVENTORY.PARTID          AS PARTID,
    QTYINVENTORY.LOCATIONGROUPID    AS LOCATIONGROUPID,
    QTYINVENTORY.QTYONHAND          AS QTYONHAND,
    QTYINVENTORY.QTYALLOCATEDPO + QTYINVENTORY.QTYALLOCATEDSO
        + QTYINVENTORY.QTYALLOCATEDTO + QTYINVENTORY.QTYALLOCATEDMO AS QTYALLOCATED,
    QTYINVENTORY.QTYNOTAVAILABLE    AS QTYNOTAVAILABLE,
    QTYINVENTORY.QTYNOTAVAILABLETOPICK AS QTYNOTAVAILABLETOPICK,
    QTYINVENTORY.QTYDROPSHIP        AS QTYDROPSHIP,
    QTYINVENTORY.QTYONORDERPO + QTYINVENTORY.QTYONORDERSO
        + QTYINVENTORY.QTYONORDERTO + QTYINVENTORY.QTYONORDERMO AS QTYONORDER
FROM QTYINVENTORY;

-- QOHVIEW — TEMPTABLE
-- On-hand with serial number detail — one row per tag+serial combination.
-- Use when you need a per-serial inventory breakdown; prefer QTYONHAND for totals.
-- Columns: LOCATIONGROUPID, LOCATIONID, PARTID, TAGNUM, SERIALNUM, QTY
CREATE OR REPLACE VIEW QOHVIEW
AS
SELECT Location.locationGroupID AS LOCATIONGROUPID,
    Tag.locationID AS LOCATIONID,
    Tag.partID AS PARTID,
    Tag.num AS TAGNUM,
    TagSerialView.serialNum AS SERIALNUM,
    (1 - Tag.qty) * (count(tagserialview.serialnum) - 1) + 1 AS QTY
FROM Location, Tag
LEFT JOIN TagSerialView ON TagSerialView.tagID = Tag.ID
WHERE Location.ID = locationID
GROUP BY Location.locationGroupID, Tag.locationID, Tag.partID, Tag.num, TagSerialView.serialNum, tag.qty;

-- ============================================================
-- PART TRACKING VIEWS
-- ============================================================

-- TRACKTEXT — MERGE
-- Text tracking values joined with their part tracking definition.
-- Columns: TAGID, ABBR, INFO
CREATE OR REPLACE VIEW TRACKTEXT
AS
SELECT TrackingText.tagID AS TAGID,
    PartTracking.abbr AS ABBR,
    TrackingText.info AS INFO
FROM TrackingText
JOIN PartTracking ON (PartTracking.id = TrackingText.partTrackingID);

-- TRACKDATE — MERGE
-- Date tracking values joined with their part tracking definition.
-- Columns: TAGID, ABBR, INFO
CREATE OR REPLACE VIEW TRACKDATE
AS
SELECT TrackingDate.tagID AS TAGID,
    PartTracking.abbr AS ABBR,
    TrackingDate.info AS INFO
FROM TrackingDate
JOIN PartTracking ON (PartTracking.id = TrackingDate.partTrackingID);

-- TRACKDECIMAL — MERGE
-- Decimal tracking values joined with their part tracking definition.
-- Columns: TAGID, ABBR, INFO
CREATE OR REPLACE VIEW TRACKDECIMAL
AS
SELECT TrackingDecimal.tagID AS TAGID,
    PartTracking.abbr AS ABBR,
    TrackingDecimal.info AS INFO
FROM TrackingDecimal
JOIN PartTracking ON (PartTracking.id = TrackingDecimal.partTrackingID);

-- TRACKINTEGER — MERGE
-- Integer tracking values joined with their part tracking definition.
-- Columns: TAGID, ABBR, INFO
CREATE OR REPLACE VIEW TRACKINTEGER
AS
SELECT TrackingInteger.tagID AS TAGID,
    PartTracking.abbr AS ABBR,
    TrackingInteger.info AS INFO
FROM TrackingInteger
JOIN PartTracking ON (PartTracking.id = TrackingInteger.partTrackingID);

-- TAGSERIALVIEW — MERGE
-- Serial number records per tag, joined with part tracking metadata.
-- Columns: PARTTRACKINGID, SERIALID, NAME, ABBR, DESCRIPTION, SORTORDER,
--          TYPEID, TAGID, SERIALNUMID, SERIALNUM, COMMITTEDFLAG, ACTIVEFLAG
CREATE OR REPLACE VIEW TAGSERIALVIEW
AS
SELECT SerialNum.partTrackingID AS PARTTRACKINGID,
    Serial.id AS SERIALID,
    PartTracking.NAME AS NAME,
    PartTracking.abbr AS ABBR,
    PartTracking.description AS DESCRIPTION,
    PartTracking.sortOrder AS SORTORDER,
    PartTracking.typeID AS TYPEID,
    Serial.tagID AS TAGID,
    SerialNum.ID AS SERIALNUMID,
    SerialNum.serialNum AS SERIALNUM,
    Serial.committedFlag AS COMMITTEDFLAG,
    PartTracking.activeFlag AS ACTIVEFLAG
FROM Serial
INNER JOIN SerialNum ON SerialNum.serialID = Serial.id
INNER JOIN PartTracking ON PartTracking.id = SerialNum.partTrackingID;

-- TAGTRACKINGVIEW — TEMPTABLE
-- All tracking types (text, date, decimal, integer, serial) per tag.
-- INFO and INFOFORMATTED are dispatched by parttracking.typeId:
--   10=text, 20/30=date, 40=serial (no INFO — serial data is in TAGSERIALVIEW),
--   50=currency decimal ($X.XX), 60=decimal (5dp), 70=integer, 80=boolean (True/False)
-- Columns: PARTTRACKINGID, NAME, ABBR, DESCRIPTION, SORTORDER, TYPEID,
--          TAGID, PARTID, INFO, INFOFORMATTED, ACTIVEFLAG
CREATE OR REPLACE VIEW TAGTRACKINGVIEW
AS
SELECT PartTracking.id AS PARTTRACKINGID,
    PartTracking.NAME AS NAME,
    PartTracking.abbr AS ABBR,
    PartTracking.description AS DESCRIPTION,
    PartTracking.sortOrder AS SORTORDER,
    PartTracking.typeID AS TYPEID,
    Tag.id AS TAGID,
    tag.partId AS PARTID,
    (CASE
        WHEN PartTracking.typeID = 10             THEN TrackingText.info
        WHEN PartTracking.typeID IN (20, 30)      THEN TrackingDate.info
        WHEN PartTracking.typeID IN (50, 60)      THEN TrackingDecimal.info
        WHEN PartTracking.typeID IN (70, 80)      THEN TrackingInteger.info
        ELSE 0 END) AS INFO,
    (CASE
        WHEN PartTracking.typeID = 10             THEN TrackingText.info
        WHEN PartTracking.typeID IN (20, 30)      THEN CAST(TrackingDate.info AS DATE)
        WHEN PartTracking.typeID = 50             THEN CONCAT('$', round(TrackingDecimal.info, 2))
        WHEN PartTracking.typeID = 60             THEN round(TrackingDecimal.info, 5)
        WHEN PartTracking.typeID = 70             THEN TrackingInteger.info
        WHEN PartTracking.typeID = 80             THEN (CASE WHEN TrackingInteger.info = 0 THEN 'False' ELSE 'True' END)
        ELSE 0 END) AS INFOFORMATTED,
    PartTracking.activeFlag AS ACTIVEFLAG
FROM tag
LEFT OUTER JOIN trackingtext    ON tag.id = trackingtext.tagid
LEFT OUTER JOIN trackinginteger ON tag.id = trackinginteger.tagid
LEFT OUTER JOIN trackingdecimal ON tag.id = trackingdecimal.tagid
LEFT OUTER JOIN trackingdate    ON tag.id = trackingdate.tagid
LEFT OUTER JOIN (
    SELECT serial.tagId AS tagId, serialnum.parttrackingid AS parttrackingid
    FROM serial
    INNER JOIN serialNum ON serial.id = serialnum.serialid
    GROUP BY 1, 2
) AS serialnum ON tag.id = serialnum.tagId
LEFT OUTER JOIN parttracking ON trackingtext.parttrackingid    = parttracking.id
    OR trackinginteger.parttrackingid = parttracking.id
    OR trackingdecimal.parttrackingid = parttracking.id
    OR trackingdate.parttrackingid    = parttracking.id
    OR serialnum.parttrackingid       = parttracking.id
WHERE parttracking.id IS NOT NULL
GROUP BY 1, 7;

-- TAGTRACKINGNOSERIALVIEW — TEMPTABLE
-- Same as TAGTRACKINGVIEW but excludes serial tracking (no serial subquery join).
-- Columns: same as TAGTRACKINGVIEW
CREATE OR REPLACE VIEW TAGTRACKINGNOSERIALVIEW
AS
SELECT PartTracking.id AS PARTTRACKINGID,
    PartTracking.NAME AS NAME,
    PartTracking.abbr AS ABBR,
    PartTracking.description AS DESCRIPTION,
    PartTracking.sortOrder AS SORTORDER,
    PartTracking.typeID AS TYPEID,
    Tag.id AS TAGID,
    tag.partId AS PARTID,
    (CASE
        WHEN PartTracking.typeID = 10             THEN TrackingText.info
        WHEN PartTracking.typeID IN (20, 30)      THEN TrackingDate.info
        WHEN PartTracking.typeID IN (50, 60)      THEN TrackingDecimal.info
        WHEN PartTracking.typeID IN (70, 80)      THEN TrackingInteger.info
        ELSE 0 END) AS INFO,
    (CASE
        WHEN PartTracking.typeID = 10             THEN TrackingText.info
        WHEN PartTracking.typeID IN (20, 30)      THEN CAST(TrackingDate.info AS DATE)
        WHEN PartTracking.typeID = 50             THEN CONCAT('$', round(TrackingDecimal.info, 2))
        WHEN PartTracking.typeID = 60             THEN round(TrackingDecimal.info, 5)
        WHEN PartTracking.typeID = 70             THEN TrackingInteger.info
        WHEN PartTracking.typeID = 80             THEN (CASE WHEN TrackingInteger.info = 0 THEN 'False' ELSE 'True' END)
        ELSE 0 END) AS INFOFORMATTED,
    PartTracking.activeFlag AS ACTIVEFLAG
FROM tag
LEFT OUTER JOIN trackingtext    ON tag.id = trackingtext.tagid
LEFT OUTER JOIN trackinginteger ON tag.id = trackinginteger.tagid
LEFT OUTER JOIN trackingdecimal ON tag.id = trackingdecimal.tagid
LEFT OUTER JOIN trackingdate    ON tag.id = trackingdate.tagid
LEFT OUTER JOIN parttracking ON trackingtext.parttrackingid    = parttracking.id
    OR trackinginteger.parttrackingid = parttracking.id
    OR trackingdecimal.parttrackingid = parttracking.id
    OR trackingdate.parttrackingid    = parttracking.id
WHERE parttracking.id IS NOT NULL
GROUP BY 1, 7;

-- PARTTRACKINGVIEW — TEMPTABLE
-- Part tracking definitions with their current tag values, dispatched by typeId.
-- Columns: PARTTRACKINGID, NAME, ABBR, DESCRIPTION, SORTORDER, TYPEID,
--          TAGID, INFO, INFOFORMATTED, ACTIVEFLAG
CREATE OR REPLACE VIEW PARTTRACKINGVIEW
AS
SELECT PartTracking.id AS PARTTRACKINGID,
    PartTracking.NAME AS NAME,
    PartTracking.abbr AS ABBR,
    PartTracking.description AS DESCRIPTION,
    PartTracking.sortOrder AS SORTORDER,
    PartTracking.typeID AS TYPEID,
    (CASE
        WHEN PartTracking.typeID = 10             THEN TrackingText.tagID
        WHEN PartTracking.typeID IN (20, 30)      THEN TrackingDate.tagID
        WHEN PartTracking.typeID = 40             THEN SerialType.tagID
        WHEN PartTracking.typeID IN (50, 60)      THEN TrackingDecimal.tagID
        WHEN PartTracking.typeID IN (70, 80)      THEN TrackingInteger.tagID
        ELSE 0 END) AS TAGID,
    (CASE
        WHEN PartTracking.typeID = 10             THEN TrackingText.info
        WHEN PartTracking.typeID IN (20, 30)      THEN TrackingDate.info
        WHEN PartTracking.typeID IN (50, 60)      THEN TrackingDecimal.info
        WHEN PartTracking.typeID IN (70, 80)      THEN TrackingInteger.info
        ELSE 0 END) AS INFO,
    (CASE
        WHEN PartTracking.typeID = 10             THEN TrackingText.info
        WHEN PartTracking.typeID IN (20, 30)      THEN CAST(TrackingDate.info AS DATE)
        WHEN PartTracking.typeID = 50             THEN CONCAT('$', round(TrackingDecimal.info, 2))
        WHEN PartTracking.typeID = 60             THEN round(TrackingDecimal.info, 5)
        WHEN PartTracking.typeID = 70             THEN TrackingInteger.info
        WHEN PartTracking.typeID = 80             THEN (CASE WHEN TrackingInteger.info = 0 THEN 'False' ELSE 'True' END)
        ELSE 0 END) AS INFOFORMATTED,
    PartTracking.activeFlag AS ACTIVEFLAG
FROM PartTracking
LEFT OUTER JOIN TrackingText    ON TrackingText.partTrackingID    = PartTracking.id
LEFT OUTER JOIN TrackingDecimal ON TrackingDecimal.partTrackingID = PartTracking.id
LEFT OUTER JOIN TrackingInteger ON TrackingInteger.partTrackingID = PartTracking.id
LEFT OUTER JOIN TrackingDate    ON TrackingDate.partTrackingID    = PartTracking.id
LEFT OUTER JOIN (
    SELECT DISTINCT SerialNum.partTrackingID, Serial.tagID
    FROM SerialNum
    INNER JOIN Serial ON SerialNum.serialID = Serial.id
) AS SerialType ON SerialType.partTrackingID = PartTracking.id;

-- INVLOGTRACKINGSUMMARY — TEMPTABLE
-- Tracking values grouped per inventory log entry as a single concatenated string.
-- Useful when joining inventorylog and you want tracking info in one column.
-- Source: tiinventorylog + parttracking + tiinventorylogsn
-- Columns: INVLOGID, TRACKVALUE (e.g. "Lot: A123, Exp: 2025-01-01")
CREATE OR REPLACE VIEW INVLOGTRACKINGSUMMARY
AS
SELECT parTrackInfo.invLogID AS INVLOGID,
    GROUP_CONCAT(parTrackInfo.trackValue, ', ') AS TRACKVALUE
FROM (
    SELECT tiinventorylog.INVENTORYLOGID AS invLogID,
        CONCAT(PARTTRACKING.ABBR, ': ', GROUP_CONCAT((
            CASE
                WHEN PARTTRACKING.TYPEID = 20 THEN tiinventorylog.INFO
                WHEN PARTTRACKING.TYPEID = 30 THEN tiinventorylog.INFODATE
                WHEN PARTTRACKING.TYPEID = 40 THEN tiinventorylogsn.SERIALNUM
                WHEN PARTTRACKING.TYPEID = 50 THEN tiinventorylog.INFODOUBLE
                WHEN PARTTRACKING.TYPEID = 60 THEN tiinventorylog.INFODOUBLE
                WHEN PARTTRACKING.TYPEID = 70 THEN tiinventorylog.INFOINTEGER
                WHEN PARTTRACKING.TYPEID = 80 THEN tiinventorylog.INFOINTEGER
                ELSE tiinventorylog.INFO
                END
        ))) AS trackValue
    FROM tiinventorylog
    INNER JOIN PARTTRACKING ON (tiinventorylog.PARTTRACKINGID = PARTTRACKING.ID)
    LEFT OUTER JOIN tiinventorylogsn ON (tiinventorylog.ID = tiinventorylogsn.TIINVENTORYLOGID)
    GROUP BY tiinventorylog.INVENTORYLOGID, PARTTRACKING.ABBR, PARTTRACKING.SORTORDER
    ORDER BY PARTTRACKING.SORTORDER
) AS parTrackInfo
GROUP BY parTrackInfo.invLogID;

-- ============================================================
-- ADDRESS VIEWS
-- MERGE: single-table CASE expressions, no aggregation — safe to filter with WHERE.
-- These split newline-delimited address fields (\n delimiter) into up to 3 lines.
-- ============================================================

-- ADDRESSMULTILINEVIEW — MERGE
-- Splits address.address into 3 lines, preserving all other address fields.
-- Columns: ID, ACCOUNTID, TYPEID, NAME, ADDRESS1, ADDRESS2, ADDRESS3,
--          CITY, STATEID, ZIP, COUNTRYID, DEFAULTFLAG, RESIDENTIALFLAG
CREATE OR REPLACE VIEW ADDRESSMULTILINEVIEW
AS
SELECT Address.id AS ID,
    Address.accountID AS ACCOUNTID,
    Address.typeID AS TYPEID,
    Address.NAME AS NAME,
    CASE WHEN LOCATE('\n', address.address) > 0
        THEN SUBSTRING(address.address FROM 1 FOR (LOCATE('\n', address.address) - 1))
        ELSE address.address END AS ADDRESS1,
    CASE WHEN LOCATE('\n', address.address) > 0 AND LOCATE('\n', address.address, LOCATE('\n', address.address) + 1) = 0
        THEN SUBSTRING(address.address FROM (LOCATE('\n', address.address) + 1))
        WHEN LOCATE('\n', address.address) > 0 AND LOCATE('\n', address.address, LOCATE('\n', address.address) + 1) > 0
        THEN SUBSTRING(address.address FROM (LOCATE('\n', address.address) + 1) FOR (LOCATE('\n', address.address, LOCATE('\n', address.address) + 1) - (LOCATE('\n', address.address) + 1)))
        ELSE '' END AS ADDRESS2,
    CASE WHEN LOCATE('\n', address.address, LOCATE('\n', address.address) + 1) > 0
        THEN SUBSTRING(address.address FROM LOCATE('\n', address.address, LOCATE('\n', address.address) + 1) + 1)
        ELSE '' END AS ADDRESS3,
    Address.city AS CITY,
    Address.stateID AS STATEID,
    Address.zip AS ZIP,
    Address.countryID AS COUNTRYID,
    Address.defaultFlag AS DEFAULTFLAG,
    Address.residentialFlag AS RESIDENTIALFLAG
FROM Address;

-- ADDRESSMULTILINESOVIEW — MERGE
-- Splits so.shipToAddress into 3 lines.
-- Columns: SOID, SHIPTOADDRESS1, SHIPTOADDRESS2, SHIPTOADDRESS3
CREATE OR REPLACE VIEW ADDRESSMULTILINESOVIEW
AS
SELECT SO.id AS SOID,
    CASE WHEN LOCATE('\n', SO.shipToAddress) > 0
        THEN SUBSTRING(SO.shipToAddress FROM 1 FOR (LOCATE('\n', SO.shipToAddress) - 1))
        ELSE SO.shipToAddress END AS SHIPTOADDRESS1,
    CASE WHEN LOCATE('\n', SO.shipToAddress) > 0 AND LOCATE('\n', SO.shipToAddress, LOCATE('\n', SO.shipToAddress) + 1) = 0
        THEN SUBSTRING(SO.shipToAddress FROM (LOCATE('\n', SO.shipToAddress) + 1))
        WHEN LOCATE('\n', SO.shipToAddress) > 0 AND LOCATE('\n', SO.shipToAddress, LOCATE('\n', SO.shipToAddress) + 1) > 0
        THEN SUBSTRING(SO.shipToAddress FROM (LOCATE('\n', SO.shipToAddress) + 1) FOR (LOCATE('\n', SO.shipToAddress, LOCATE('\n', SO.shipToAddress) + 1) - (LOCATE('\n', SO.shipToAddress) + 1)))
        ELSE '' END AS SHIPTOADDRESS2,
    CASE WHEN LOCATE('\n', SO.shipToAddress, LOCATE('\n', SO.shipToAddress) + 1) > 0
        THEN SUBSTRING(SO.shipToAddress FROM LOCATE('\n', SO.shipToAddress, LOCATE('\n', SO.shipToAddress) + 1) + 1)
        ELSE '' END AS SHIPTOADDRESS3
FROM SO;

-- ADDRESSMULTILINEPOVIEW — MERGE
-- Splits po.remitAddress and po.shipToAddress each into 3 lines.
-- Columns: POID, REMITADDRESS1-3, SHIPTOADDRESS1-3
CREATE OR REPLACE VIEW ADDRESSMULTILINEPOVIEW
AS
SELECT PO.id AS POID,
    CASE WHEN LOCATE('\n', PO.remitAddress) > 0
        THEN SUBSTRING(PO.remitAddress FROM 1 FOR (LOCATE('\n', PO.remitAddress) - 1))
        ELSE PO.remitAddress END AS REMITADDRESS1,
    CASE WHEN LOCATE('\n', PO.remitAddress) > 0 AND LOCATE('\n', PO.remitAddress, LOCATE('\n', PO.remitAddress) + 1) = 0
        THEN SUBSTRING(PO.remitAddress FROM (LOCATE('\n', PO.remitAddress) + 1))
        WHEN LOCATE('\n', PO.remitAddress) > 0 AND LOCATE('\n', PO.remitAddress, LOCATE('\n', PO.remitAddress) + 1) > 0
        THEN SUBSTRING(PO.remitAddress FROM (LOCATE('\n', PO.remitAddress) + 1) FOR (LOCATE('\n', PO.remitAddress, LOCATE('\n', PO.remitAddress) + 1) - (LOCATE('\n', PO.remitAddress) + 1)))
        ELSE '' END AS REMITADDRESS2,
    CASE WHEN LOCATE('\n', PO.remitAddress, LOCATE('\n', PO.remitAddress) + 1) > 0
        THEN SUBSTRING(PO.remitAddress FROM LOCATE('\n', PO.remitAddress, LOCATE('\n', PO.remitAddress) + 1) + 1)
        ELSE '' END AS REMITADDRESS3,
    CASE WHEN LOCATE('\n', PO.shipToAddress) > 0
        THEN SUBSTRING(PO.shipToAddress FROM 1 FOR (LOCATE('\n', PO.shipToAddress) - 1))
        ELSE PO.shipToAddress END AS SHIPTOADDRESS1,
    CASE WHEN LOCATE('\n', PO.shipToAddress) > 0 AND LOCATE('\n', PO.shipToAddress, LOCATE('\n', PO.shipToAddress) + 1) = 0
        THEN SUBSTRING(PO.shipToAddress FROM (LOCATE('\n', PO.shipToAddress) + 1))
        WHEN LOCATE('\n', PO.shipToAddress) > 0 AND LOCATE('\n', PO.shipToAddress, LOCATE('\n', PO.shipToAddress) + 1) > 0
        THEN SUBSTRING(PO.shipToAddress FROM (LOCATE('\n', PO.shipToAddress) + 1) FOR (LOCATE('\n', PO.shipToAddress, LOCATE('\n', PO.shipToAddress) + 1) - (LOCATE('\n', PO.shipToAddress) + 1)))
        ELSE '' END AS SHIPTOADDRESS2,
    CASE WHEN LOCATE('\n', PO.shipToAddress, LOCATE('\n', PO.shipToAddress) + 1) > 0
        THEN SUBSTRING(PO.shipToAddress FROM LOCATE('\n', PO.shipToAddress, LOCATE('\n', PO.shipToAddress) + 1) + 1)
        ELSE '' END AS SHIPTOADDRESS3
FROM PO;

-- ADDRESSMULTILINEXOVIEW — MERGE
-- Splits xo.shipToAddress and xo.fromAddress each into 3 lines.
-- Columns: XOID, SHIPTOADDRESS1-3, FROMADDRESS1-3
CREATE OR REPLACE VIEW ADDRESSMULTILINEXOVIEW
AS
SELECT XO.id AS XOID,
    CASE WHEN LOCATE('\n', XO.shipToAddress) > 0
        THEN SUBSTRING(XO.shipToAddress FROM 1 FOR (LOCATE('\n', XO.shipToAddress) - 1))
        ELSE XO.shipToAddress END AS SHIPTOADDRESS1,
    CASE WHEN LOCATE('\n', XO.shipToAddress) > 0 AND LOCATE('\n', XO.shipToAddress, LOCATE('\n', XO.shipToAddress) + 1) = 0
        THEN SUBSTRING(XO.shipToAddress FROM (LOCATE('\n', XO.shipToAddress) + 1))
        WHEN LOCATE('\n', XO.shipToAddress) > 0 AND LOCATE('\n', XO.shipToAddress, LOCATE('\n', XO.shipToAddress) + 1) > 0
        THEN SUBSTRING(XO.shipToAddress FROM (LOCATE('\n', XO.shipToAddress) + 1) FOR (LOCATE('\n', XO.shipToAddress, LOCATE('\n', XO.shipToAddress) + 1) - (LOCATE('\n', XO.shipToAddress) + 1)))
        ELSE '' END AS SHIPTOADDRESS2,
    CASE WHEN LOCATE('\n', XO.shipToAddress, LOCATE('\n', XO.shipToAddress) + 1) > 0
        THEN SUBSTRING(XO.shipToAddress FROM LOCATE('\n', XO.shipToAddress, LOCATE('\n', XO.shipToAddress) + 1) + 1)
        ELSE '' END AS SHIPTOADDRESS3,
    CASE WHEN LOCATE('\n', XO.fromAddress) > 0
        THEN SUBSTRING(XO.fromAddress FROM 1 FOR (LOCATE('\n', XO.fromAddress) - 1))
        ELSE XO.fromAddress END AS FROMADDRESS1,
    CASE WHEN LOCATE('\n', XO.fromAddress) > 0 AND LOCATE('\n', XO.fromAddress, LOCATE('\n', XO.fromAddress) + 1) = 0
        THEN SUBSTRING(XO.fromAddress FROM (LOCATE('\n', XO.fromAddress) + 1))
        WHEN LOCATE('\n', XO.fromAddress) > 0 AND LOCATE('\n', XO.fromAddress, LOCATE('\n', XO.fromAddress) + 1) > 0
        THEN SUBSTRING(XO.fromAddress FROM (LOCATE('\n', XO.fromAddress) + 1) FOR (LOCATE('\n', XO.fromAddress, LOCATE('\n', XO.fromAddress) + 1) - (LOCATE('\n', XO.fromAddress) + 1)))
        ELSE '' END AS FROMADDRESS2,
    CASE WHEN LOCATE('\n', XO.fromAddress, LOCATE('\n', XO.fromAddress) + 1) > 0
        THEN SUBSTRING(XO.fromAddress FROM LOCATE('\n', XO.fromAddress, LOCATE('\n', XO.fromAddress) + 1) + 1)
        ELSE '' END AS FROMADDRESS3
FROM XO;

-- ============================================================
-- CONTACT VIEWS
-- MERGE: simple joins, no aggregation — safe to filter with WHERE.
-- ============================================================

-- CUSTOMERCONTACTVIEW — MERGE
-- Customer name and primary billing contact (address.typeId=50, defaultFlag=1;
-- contact.typeId=50, defaultFlag=1).
-- Columns: CUSTID, CUSTNAME, CONTACTNAME, CONTACTNUM
CREATE OR REPLACE VIEW CUSTOMERCONTACTVIEW
AS
SELECT Customer.id AS CUSTID,
    Customer.NAME AS CUSTNAME,
    COALESCE(Contact.contactName, 'Unknown') AS CONTACTNAME,
    COALESCE(Contact.datus, '') AS CONTACTNUM
FROM Customer
INNER JOIN address ON (address.accountid = customer.accountid AND address.defaultflag = 1 AND address.typeid = 50)
LEFT OUTER JOIN contact ON (address.id = contact.addressID AND contact.TypeID = 50 AND contact.DefaultFlag = 1);

-- VENDORCONTACTVIEW — MERGE
-- Vendor name and primary contact (address.defaultFlag=1; contact.typeId=50, defaultFlag=1).
-- Columns: VENDORID, VENDORNAME, CONTACTNAME, CONTACTNUM
CREATE OR REPLACE VIEW VENDORCONTACTVIEW
AS
SELECT Vendor.id AS VENDORID,
    Vendor.NAME AS VENDORNAME,
    COALESCE(Contact.contactName, 'Unknown') AS CONTACTNAME,
    COALESCE(Contact.datus, '') AS CONTACTNUM
FROM vendor
INNER JOIN address ON (address.accountid = vendor.accountid AND address.defaultflag = 1)
LEFT OUTER JOIN contact ON (address.id = contact.addressID AND contact.TypeID = 50 AND contact.DefaultFlag = 1);

-- ============================================================
-- SHIPPING VIEWS
-- ============================================================

-- SHIPCARTONSOVIEW — MERGE
-- Ship cartons for SO shipments (orderTypeId=20).
-- Columns: SHIPCARTONID, SOID
CREATE OR REPLACE VIEW SHIPCARTONSOVIEW
AS
SELECT ShipCarton.id AS SHIPCARTONID,
    ShipCarton.orderID AS SOID
FROM ShipCarton
WHERE ShipCarton.orderTypeID = 20;

-- SHIPCARTONPOVIEW — MERGE
-- Ship cartons for PO shipments (orderTypeId=10).
-- Columns: SHIPCARTONID, POID
CREATE OR REPLACE VIEW SHIPCARTONPOVIEW
AS
SELECT ShipCarton.id AS SHIPCARTONID,
    ShipCarton.orderID AS POID
FROM ShipCarton
WHERE ShipCarton.orderTypeID = 10;

-- SHIPCARTONXOVIEW — MERGE
-- Ship cartons for XO (transfer order) shipments (orderTypeId=40).
-- Columns: SHIPCARTONID, XOID
CREATE OR REPLACE VIEW SHIPCARTONXOVIEW
AS
SELECT ShipCarton.id AS SHIPCARTONID,
    ShipCarton.orderID AS XOID
FROM ShipCarton
WHERE ShipCarton.orderTypeID = 40;

-- SHIPNUMVIEW — MERGE
-- Comprehensive ship detail joined with SO, customer, address, carton, and carrier service.
-- Filters: ship.statusId IN (10=Entered, 20=Packed).
-- Columns: SHIPNUMBER, SHIPID, SONUM, SOID, CUSTOMERNAME, SHIPTONAME,
--          SHIPTOADDRESS1, SHIPTOADDRESS2, SHIPTOADDRESS3, SHIPTOCITY, SHIPTOZIP,
--          STATECODE, COUNTRYABBR, RESIDENTIALFLAG, EMAIL, PHONE, CUSTOMERPO,
--          CARRIERSERVICE, CARTONID, LENGTH, WIDTH, HEIGHT, CARTONWEIGHT
CREATE OR REPLACE VIEW SHIPNUMVIEW
AS
SELECT ship.num AS shipNumber,
    ship.id AS shipid,
    so.num AS sonum,
    so.id AS soid,
    customer.name AS customerName,
    so.shiptoname AS shiptoname,
    addressmultilinesoview.shiptoaddress1 AS shiptoaddress1,
    addressmultilinesoview.shiptoaddress2 AS shiptoaddress2,
    addressmultilinesoview.shiptoaddress3 AS shiptoaddress3,
    so.shiptocity AS shiptocity,
    so.shiptozip AS shiptozip,
    stateconst.code AS statecode,
    countryconst.abbreviation AS countryabbr,
    so.shipToResidential AS ResidentialFlag,
    so.email AS email,
    so.phone AS phone,
    so.customerpo AS customerpo,
    carrierservice.code AS carrierservice,
    shipcarton.id AS cartonID,
    shipcarton.len AS length,
    shipcarton.width AS width,
    shipcarton.height AS height,
    shipcarton.freightweight AS cartonweight
FROM so
LEFT JOIN addressmultilinesoview ON addressmultilinesoview.soid = so.id
LEFT JOIN stateconst ON so.shiptostateid = stateconst.id
LEFT JOIN ship ON so.id = ship.soid AND ship.ordertypeid = 20
LEFT JOIN customer ON so.customerid = customer.id
LEFT JOIN countryconst ON so.shiptocountryid = countryconst.id
LEFT JOIN shipcarton ON ship.id = shipcarton.shipid
LEFT JOIN carrierservice ON ship.carrierserviceid = carrierservice.id
WHERE ship.statusid IN (10, 20);

-- SHIPPINGEMAILVIEW — MERGE
-- SO ID and customer email address.
-- Columns: SOID, CUSTOMERID, EMAILADDRESS
CREATE OR REPLACE VIEW SHIPPINGEMAILVIEW
AS
SELECT so.id AS SOID, customer.id AS CUSTOMERID, so.email AS EMAILADDRESS
FROM so
JOIN customer ON so.customerid = customer.id
JOIN account ON customer.accountid = account.id;

-- FEDEXVIEW — MERGE
-- FedEx shipments in Packed status (ship.statusId=20), one row per carton.
-- Filters: carrier.name LIKE '%Fed%' AND ship.statusId = 20.
-- Columns: ID, ORDERNUM, PONUM, COMPANYNAME, CONTACTNAME, SHIPTOADDRESS,
--          SHIPTOCITY, SHIPTOSTATE, SHIPTOZIP, SHIPTOCOUNTRY, SERVICETYPE,
--          WEIGHT, CARTONID, CARTONCOUNT, PHONE, EMAIL
CREATE OR REPLACE VIEW FEDEXVIEW
AS
SELECT ship.id AS ID,
    so.num AS ORDERNUM,
    so.customerpo AS PONUM,
    so.shiptoname AS COMPANYNAME,
    so.customercontact AS CONTACTNAME,
    so.shiptoaddress AS SHIPTOADDRESS,
    so.shiptocity AS SHIPTOCITY,
    stateConst.code AS SHIPTOSTATE,
    so.shiptozip AS SHIPTOZIP,
    countryConst.abbreviation AS SHIPTOCOUNTRY,
    carrier.NAME AS SERVICETYPE,
    shipcarton.freightweight AS WEIGHT,
    shipcarton.id AS CARTONID,
    ship.cartonCount AS CARTONCOUNT,
    COALESCE(so.phone, '') AS PHONE,
    COALESCE(so.email, '') AS EMAIL
FROM ship
INNER JOIN carrier ON carrier.id = ship.carrierid
INNER JOIN so ON (so.id = ship.soId)
INNER JOIN countryconst ON so.shiptocountryid = countryconst.id
INNER JOIN stateconst ON so.shiptostateid = stateconst.id
INNER JOIN shipcarton ON shipcarton.shipid = ship.id
INNER JOIN customer ON so.customerid = customer.id
INNER JOIN address ON (address.accountid = customer.accountid AND address.defaultflag = 1 AND address.typeid = 50)
WHERE carrier.NAME LIKE '%Fed%'
    AND ship.statusid = 20;

-- UPSVIEW — MERGE
-- UPS shipments in Packed status (ship.statusId=20).
-- Filters: carrier.name LIKE 'UPS%' AND ship.statusId = 20.
-- Columns: ID, ORDERNUM, ORDERID, CARRIERID, CARRIERSERVICEID
CREATE OR REPLACE VIEW UPSVIEW
AS
SELECT ship.id AS ID,
    so.num AS ORDERNUM,
    ship.soId AS ORDERID,
    ship.carrierid AS CARRIERID,
    ship.carrierServiceId AS CARRIERSERVICEID
FROM ship
INNER JOIN carrier ON carrier.id = ship.carrierid
INNER JOIN so ON (so.id = ship.soId)
WHERE carrier.NAME LIKE 'UPS%'
    AND ship.statusid = 20;

-- ONTRACVIEW — MERGE
-- OnTrac shipments not yet shipped (ship.statusId < 30; carrier.name = 'ontrac').
-- Uses CustomFieldByName() to read ship-level custom fields.
-- Columns: ORDERNUMBER, NAME, ADDRESSLINE1, ADDRESSLINE2, ADDRESSLINE3, CITY,
--          STATE, ZIP, INSTRUCTIONS, REFERENCE, REFERENCE2, INTERNALREFERENCE,
--          CODAMOUNT, HANDLINGFEE, PHONE, CONTACT, DECLAREDVALUE, BILLTOACCOUNT,
--          SHIPMENTEMAIL, DELIVERYEMAIL, SHIPSTATUS,
--          SATURDAYDELIVERY (0/1), CODTYPE (0=none,1=non-secured,2=secured),
--          WEIGHT (lbs only, else empty), SIGNATUREREQUIRED (0/1),
--          SERVICE (S=Sunrise,G=Gold,C=CalTrac,H=Palletized Freight)
CREATE OR REPLACE VIEW ONTRACVIEW
AS
SELECT Ship.num AS OrderNumber,
    So.shipToName AS Name,
    Address.shipToAddress1 AS AddressLine1,
    Address.shipToAddress2 AS AddressLine2,
    Address.shipToAddress3 AS AddressLine3,
    So.shipToCity AS City,
    StateConst.code AS State,
    So.shipToZip AS Zip,
    Ship.note AS Instructions,
    CustomFieldByName(Ship.customFields, 'Reference') AS Reference,
    CustomFieldByName(Ship.customFields, 'Reference 2') AS Reference2,
    ShipCarton.id AS InternalReference,
    CustomFieldByName(Ship.customFields, 'C.O.D. Amount') AS CODAmount,
    CustomFieldByName(Ship.customFields, 'Handling Fee') AS HandlingFee,
    CustomFieldByName(Ship.customFields, 'Phone') AS Phone,
    Ship.contact AS Contact,
    ShipCarton.insuredValue AS DeclaredValue,
    CustomFieldByName(Ship.customFields, 'Bill To Account') AS BillToAccount,
    CustomFieldByName(Ship.customFields, 'Shipment Email') AS ShipmentEmail,
    CustomFieldByName(Ship.customFields, 'Delivery Email') AS DeliveryEmail,
    ShipStatus.name AS ShipStatus,
    (CASE CustomFieldByName(Ship.customFields, 'Saturday Delivery')
        WHEN 'true' THEN '1' ELSE '0' END) AS SaturdayDelivery,
    (CASE LOWER(CustomFieldByName(Ship.customFields, 'C.O.D. Type'))
        WHEN 'none' THEN '0' WHEN 'non-secured' THEN '1' WHEN 'secured' THEN '2'
        ELSE '0' END) AS CODType,
    (CASE LOWER(ShipCarton.weightUom)
        WHEN 'lbs' THEN ShipCarton.freightWeight ELSE '' END) AS Weight,
    (CASE CustomFieldByName(Ship.customFields, 'Signature Required')
        WHEN 'true' THEN '1' ELSE '0' END) AS SignatureRequired,
    (CASE LOWER(CustomFieldByName(Ship.customFields, 'Service'))
        WHEN 'sunrise' THEN 'S' WHEN 'gold' THEN 'G'
        WHEN 'caltrac' THEN 'C' WHEN 'palletized freight' THEN 'H'
        ELSE '' END) AS Service
FROM ShipCarton
INNER JOIN Ship ON ShipCarton.shipId = Ship.id
INNER JOIN ShipStatus ON Ship.statusId = ShipStatus.id
INNER JOIN So ON Ship.soId = So.id AND Ship.orderTypeId = 20
INNER JOIN Carrier ON So.carrierId = Carrier.id
INNER JOIN StateConst ON StateConst.id = So.shipToStateId
INNER JOIN AddressMultilineSoView AS Address ON So.id = Address.soId
WHERE LOWER(Carrier.name) = 'ontrac'
    AND Ship.statusId < 30;

-- ============================================================
-- ORDER / OTHER VIEWS
-- ============================================================

-- NEXTORDERVIEW — TEMPTABLE (UNION of 3 branches)
-- Cross-order fulfillment schedule: PO, SO, and WO items with qty remaining to fulfill.
-- TYPEID: 10=PO, 20=SO, 30=WO. VIEWID is type-prefixed item id ("10:id", "20:id", "30:id").
-- Columns: NUM, ID, VIEWID, DATESCHEDULEDFULFILLMENT, QTYTOFULFILL, QTYFULFILLED,
--          ORDERITEMUOMID, NOTE, PARTUOMID, TYPEID, PARTID, LOCATIONGROUPID,
--          ORDERSTATUSID, ITEMSTATUSID
CREATE OR REPLACE VIEW NEXTORDERVIEW
AS
SELECT PO.num AS NUM, PO.id AS ID, CONCAT('10:', POItem.id) AS VIEWID,
    POItem.dateScheduledFulfillment AS DATESCHEDULEDFULFILLMENT,
    SUM(POItem.qtyToFulfill) AS QTYTOFULFILL, SUM(POItem.qtyFulfilled) AS QTYFULFILLED,
    POItem.UOMID AS ORDERITEMUOMID, POItem.note AS NOTE, Part.uomID AS PARTUOMID,
    10 AS TYPEID, POItem.partID AS PARTID, po.locationGroupId AS LOCATIONGROUPID,
    po.statusId AS ORDERSTATUSID, poitem.statusId AS ITEMSTATUSID
FROM POItem
JOIN po ON po.id = POItem.POID
JOIN Part ON Part.id = POItem.partID
WHERE POItem.qtyToFulfill - POItem.qtyFulfilled > 0
GROUP BY PO.num, PO.id, VIEWID, POItem.dateScheduledFulfillment, POItem.UOMID, POItem.note, Part.uomID, TypeId, POItem.partID, po.locationGroupId, po.statusId, poitem.statusId
UNION
SELECT WO.num AS Num, WO.id AS ID, CONCAT('30:', WOItem.id) AS VIEWID,
    WO.dateScheduled AS scheduledFulfillment,
    SUM(WOItem.qtyTarget) AS qtyToFulfill, SUM(WOItem.qtyUsed) AS qtyFulfilled,
    WOItem.uomID AS OrderItemUOMID, WO.note AS Note, Part.uomID AS PartUOMID,
    30 AS TypeId, WOItem.partID AS partId, wo.locationGroupId AS locationGroupId,
    wo.statusId AS orderStatusId, 0 AS itemStatusId
FROM WOItem
JOIN WO ON WO.id = WOItem.woId
JOIN Part ON Part.id = WOItem.partID
WHERE WOItem.qtyTarget - WOItem.qtyUsed > 0 AND WOItem.typeId IN (10, 31)
GROUP BY WO.num, WO.id, VIEWID, WO.dateScheduled, WOItem.uomID, WO.note, Part.uomID, TypeId, WOItem.partID, WO.locationGroupId, WO.statusId, itemStatusId
UNION
SELECT SO.num AS Num, SO.id AS ID, CONCAT('20:', SOItem.id) AS VIEWID,
    SOItem.dateScheduledFulfillment AS scheduledFulfillment,
    SUM(SOItem.qtyToFulfill) AS qtyToFulfill, SUM(SOItem.qtyFulfilled) AS qtyFulfilled,
    SOItem.UOMID AS OrderItemUOMID, SOItem.note AS Note, Part.uomID AS PartUOMID,
    20 AS TypeId, part.ID AS partId, so.locationGroupId AS locationGroupId,
    so.statusId AS orderStatusId, soitem.statusId AS itemStatusId
FROM SOItem
JOIN so ON so.id = SOItem.SOID
JOIN product ON soitem.productid = product.id
JOIN Part ON Part.id = product.partID
WHERE SOItem.qtyToFulfill - SOItem.qtyFulfilled > 0 AND SOItem.typeId = 20
GROUP BY SO.num, SO.id, VIEWID, SOItem.dateScheduledFulfillment, SOItem.UOMID, SOItem.note, Part.uomID, TypeId, part.ID, so.locationGroupId, so.statusId, soitem.statusId;

-- CUSTOMFIELDVIEW — TEMPTABLE (UNION across all entity types)
-- Custom field values for every entity that supports custom fields, with type-aware formatting.
-- cfTypeID: 1=text, 2=date (SUBSTRING to 11 chars), 3=currency (CONCAT '$' + ROUND(info,2)).
-- Entities: bom, company, customer, mo, part, po, product, rma, so, vendor, wo, xo.
-- Columns: cfId, cfName, cfDescription, cfSortOrder, cfTableID, cfTypeID,
--          cfRequired, recordID, info, infoFormatted
-- Note: full SQL is in CustomFieldView.java — one UNION branch per entity type.
-- Filter by cfTableID to limit results to a single entity type.

-- PAYMENTVIEW — TEMPTABLE (DISTINCT)
-- POS transactions with SO, customer, payment method, and post status.
-- Source: posTransaction + so + customer + paymentMethod + post (orderTypeId=20) + postStatus
-- Columns: POSTRANSACTIONID, AMOUNT, CUSTOMERNAME, DATETIME, SONUM,
--          POSTEDSTATUS, METHODNAME, POSTTYPEID, CUSTOMERID, POSTSTATUSID, PAYMENTMETHODID
CREATE OR REPLACE VIEW PaymentView
AS
SELECT DISTINCT
    posTransaction.id AS posTransactionId,
    posTransaction.amount AS amount,
    customer.name AS customerName,
    posTransaction.dateTime AS dateTime,
    so.num AS soNum,
    postStatus.name AS postedStatus,
    paymentMethod.name AS methodName,
    post.typeId AS postTypeId,
    customer.id AS customerId,
    postStatus.id AS postStatusId,
    paymentMethod.id AS paymentMethodId
FROM posTransaction
INNER JOIN so ON posTransaction.soId = so.id
INNER JOIN customer ON so.customerId = customer.id
INNER JOIN paymentMethod ON posTransaction.paymentMethodId = paymentMethod.id
INNER JOIN post ON posTransaction.id = post.refId AND post.orderTypeId = 20
INNER JOIN postStatus ON post.statusId = postStatus.id;

-- TOTALPAIDVIEW — TEMPTABLE
-- Total amount paid per SO from posTransaction.
-- Columns: amount, soId
CREATE OR REPLACE VIEW totalPaidView
AS
SELECT SUM(amount) AS amount, soId
FROM postransaction
GROUP BY soId;

-- WOMOVIEW — MERGE
-- Links work orders to their manufacture order items.
-- Columns: MOID, WOID
CREATE OR REPLACE VIEW WOMOVIEW
AS
SELECT MOITEM.MOID AS MOID,
    WO.ID AS WOID
FROM WO
INNER JOIN MOITEM ON (WO.MOITEMID = MOITEM.ID);
