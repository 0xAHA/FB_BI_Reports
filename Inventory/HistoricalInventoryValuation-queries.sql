-- ============================================================================
--  BEFORE ANYTHING ELSE: check the as-of date in these queries matches the
--  date on screen in the report. Every query here has the date INLINE, not as
--  a parameter. A 2026-03-31 query compared against a report showing
--  2026-07-31 produced a 500k "discrepancy" that was chased through part
--  type, active flags, location groups and join duplication before the date
--  turned out to be the whole of it. B-CENSUS row 9 then matched the report
--  to the cent.
--
--  Historical Inventory Valuation — extracted test queries
--  Source: Inventory/HistoricalInventoryValuation.htm (loadParts / buildSnapshotSQL)
--  Extracted 2026-09-22 by rebuilding the report's own SQL string with concrete
--  parameters, then running each against demodb. Row counts below are that run.
--
--  PARAMETERS the report substitutes:
--    <LG_IDS>   locationgroup ids, comma separated (the Location multi-select;
--               empty selection = every group the user can see, INACTIVE included)
--    <AS_OF>    YYYY-MM-DD. This picks the on-hand source, see below.
--    activeflag / zero / search clauses come from the three filter controls.
--
--  THE ONE THING TO KNOW: the on-hand subquery is not fixed. as-of >= today uses
--  live `tag` (so the total reconciles with the standard Inventory Valuation
--  Summary); a PAST date uses the last `inventorylog` snapshot on/before it,
--  because tag has no date dimension. Query A and query B are the same report.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- A. LIVE on-hand (as-of = today)
--   asOf=2026-09-22  lgIds=5,1,8,3,7,2,6,4  activeOnly=true  showZero=false  search=(none)
--   on-hand source: tag (live)
--   demodb: 92 row(s), 50ms
-- ────────────────────────────────────────────────────────────────────────────
SELECT part.id,
       part.num,
       part.description,
       uom.code AS uomcode,
       v.name AS vendor,
       COALESCE(oh.onhand, 0) AS onhand,
       pc.avgcost AS curavg,
       part.stdcost AS curstd,
       cst.avgcost AS pchavg,
       cst.stdcost AS pchstd,
       cst.costday AS costday
FROM part
LEFT JOIN uom ON part.uomid = uom.id
LEFT JOIN partcost pc ON pc.partid = part.id
LEFT JOIN vendorparts vp ON vp.partid = part.id AND vp.defaultflag = 1
LEFT JOIN vendor v ON v.id = vp.vendorid
LEFT JOIN (
  SELECT tag.partid, SUM(tag.qty) AS onhand
  FROM tag
  JOIN location l ON l.id = tag.locationid
  WHERE l.locationgroupid IN (5,1,8,3,7,2,6,4)
  GROUP BY tag.partid
) oh ON oh.partid = part.id
LEFT JOIN (
  SELECT pch.partid, pch.avgcost, pch.stdcost, DATE(pch.datecaptured) AS costday
  FROM partcosthistory pch
  JOIN (
    SELECT partid, MAX(id) AS costid
    FROM partcosthistory
    WHERE datecaptured <= '2026-09-22 23:59:59.999999'
    GROUP BY partid
  ) mc ON mc.costid = pch.id
) cst ON cst.partid = part.id
WHERE part.typeid = 10
  AND part.activeflag = 1
  AND part.num LIKE '%'
  AND COALESCE(oh.onhand, 0) <> 0
ORDER BY part.num
LIMIT 5001;

-- ────────────────────────────────────────────────────────────────────────────
-- B. HISTORICAL on-hand (past date)
--   asOf=2026-07-31  lgIds=5,1,8,3,7,2,6,4  activeOnly=true  showZero=false  search=(none)
--   on-hand source: inventorylog (last snapshot <= as-of)
--   demodb: 92 row(s), 53ms
-- ────────────────────────────────────────────────────────────────────────────
SELECT part.id,
       part.num,
       part.description,
       uom.code AS uomcode,
       v.name AS vendor,
       COALESCE(oh.onhand, 0) AS onhand,
       pc.avgcost AS curavg,
       part.stdcost AS curstd,
       cst.avgcost AS pchavg,
       cst.stdcost AS pchstd,
       cst.costday AS costday
FROM part
LEFT JOIN uom ON part.uomid = uom.id
LEFT JOIN partcost pc ON pc.partid = part.id
LEFT JOIN vendorparts vp ON vp.partid = part.id AND vp.defaultflag = 1
LEFT JOIN vendor v ON v.id = vp.vendorid
LEFT JOIN (
  SELECT il.partid, SUM(il.qtyonhand) AS onhand
  FROM inventorylog il
  JOIN (
    SELECT partid, locationgroupid, MAX(id) AS logid
    FROM inventorylog
    WHERE eventdate <= '2026-07-31 23:59:59.999999'
      AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      AND locationgroupid IN (5,1,8,3,7,2,6,4)
    GROUP BY partid, locationgroupid
  ) mx ON mx.logid = il.id
  GROUP BY il.partid
) oh ON oh.partid = part.id
LEFT JOIN (
  SELECT pch.partid, pch.avgcost, pch.stdcost, DATE(pch.datecaptured) AS costday
  FROM partcosthistory pch
  JOIN (
    SELECT partid, MAX(id) AS costid
    FROM partcosthistory
    WHERE datecaptured <= '2026-07-31 23:59:59.999999'
    GROUP BY partid
  ) mc ON mc.costid = pch.id
) cst ON cst.partid = part.id
WHERE part.typeid = 10
  AND part.activeflag = 1
  AND part.num LIKE '%'
  AND COALESCE(oh.onhand, 0) <> 0
ORDER BY part.num
LIMIT 5001;

-- ────────────────────────────────────────────────────────────────────────────
-- C. HISTORICAL, one LG, search term
--   asOf=2026-07-31  lgIds=5  activeOnly=true  showZero=false  search=B
--   on-hand source: inventorylog (last snapshot <= as-of)
--   demodb: 19 row(s), 35ms
-- ────────────────────────────────────────────────────────────────────────────
SELECT part.id,
       part.num,
       part.description,
       uom.code AS uomcode,
       v.name AS vendor,
       COALESCE(oh.onhand, 0) AS onhand,
       pc.avgcost AS curavg,
       part.stdcost AS curstd,
       cst.avgcost AS pchavg,
       cst.stdcost AS pchstd,
       cst.costday AS costday
FROM part
LEFT JOIN uom ON part.uomid = uom.id
LEFT JOIN partcost pc ON pc.partid = part.id
LEFT JOIN vendorparts vp ON vp.partid = part.id AND vp.defaultflag = 1
LEFT JOIN vendor v ON v.id = vp.vendorid
LEFT JOIN (
  SELECT il.partid, SUM(il.qtyonhand) AS onhand
  FROM inventorylog il
  JOIN (
    SELECT partid, locationgroupid, MAX(id) AS logid
    FROM inventorylog
    WHERE eventdate <= '2026-07-31 23:59:59.999999'
      AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      AND locationgroupid IN (5)
    GROUP BY partid, locationgroupid
  ) mx ON mx.logid = il.id
  GROUP BY il.partid
) oh ON oh.partid = part.id
LEFT JOIN (
  SELECT pch.partid, pch.avgcost, pch.stdcost, DATE(pch.datecaptured) AS costday
  FROM partcosthistory pch
  JOIN (
    SELECT partid, MAX(id) AS costid
    FROM partcosthistory
    WHERE datecaptured <= '2026-07-31 23:59:59.999999'
    GROUP BY partid
  ) mc ON mc.costid = pch.id
) cst ON cst.partid = part.id
WHERE part.typeid = 10
  AND part.activeflag = 1
  AND (part.num LIKE '%B%' OR part.description LIKE '%B%')
  AND COALESCE(oh.onhand, 0) <> 0
ORDER BY part.num
LIMIT 5001;

-- ────────────────────────────────────────────────────────────────────────────
-- D. Drill-down cost history — one part, lookback window ending at the as-of date
--   partid=3  window 2025-07-31 .. 2026-07-31 (12 months)
--   partcosthistory is COMPANY-WIDE — no location group. The parent row's
--   on-hand respects the LG filter; this cost history cannot.
--   demodb: 0 snapshot(s)
-- ────────────────────────────────────────────────────────────────────────────
SELECT DATE(datecaptured) AS day, quantity AS qty, avgcost, stdcost, totalcost
FROM partcosthistory
WHERE partid = 3
  AND datecaptured >= '2025-07-31 00:00:00'
  AND datecaptured <= '2026-07-31 23:59:59.999999'
ORDER BY datecaptured;

-- ────────────────────────────────────────────────────────────────────────────
-- E. Location groups, exactly as the report lists them (inactive INCLUDED, and
--    gated by getLocationGroupList() when the client supplies one).
-- ────────────────────────────────────────────────────────────────────────────
SELECT id, name, (activeFlag + 0) AS act
FROM locationgroup
ORDER BY act DESC, name;

-- ────────────────────────────────────────────────────────────────────────────
-- B-TOTAL. The total for query B.
--   Same row source as B; only the projection differs. The value columns
--   reproduce recomputeValues() in the report, which is where the arithmetic
--   actually lives — the SQL never returns a value, only qty and the two cost
--   candidates, and the JS multiplies.
--
--   WHICH TOTAL IS THE REPORT SHOWING? The Cost control picks:
--     "As of date"   (default) -> value_avg_asof   / value_std_asof
--     "Today's cost"           -> value_avg_today  / value_std_today
--   For a PAST as-of date those differ. For today they are identical, because
--   the report deliberately uses live cost for today so the total still
--   reconciles with the standard Inventory Valuation Summary.
--
--   COALESCE(pchavg, curavg) is not cosmetic: a part with no partcosthistory
--   row on/before the date falls back to CURRENT cost, silently. On demodb at
--   2026-07-31 that is 17 of 92 parts, worth 57862.29 — so the
--   "as-of" total is part historical, part current. Read it accordingly.
--
--   No LIMIT here. Query B caps at 5001 rows (ROW_CAP + 1) and the report
--   totals only what it loaded, so on a data set past the cap this total and
--   the report's KPI will disagree. demodb returns 92 rows, well under.
--
--   demodb: parts=92  qty=162657.750083331  avg(as-of)=799480.28  avg(today)=7424870.49  (57ms)
-- ────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS parts,
       SUM(r.onhand) AS total_qty,
       SUM(r.onhand * COALESCE(r.pchavg, r.curavg)) AS value_avg_asof,
       SUM(r.onhand * COALESCE(r.pchstd, r.curstd)) AS value_std_asof,
       SUM(r.onhand * r.curavg) AS value_avg_today,
       SUM(r.onhand * r.curstd) AS value_std_today,
       SUM(CASE WHEN r.pchavg IS NULL THEN 1 ELSE 0 END) AS parts_no_snapshot,
       SUM(CASE WHEN r.pchavg IS NULL THEN r.onhand * r.curavg ELSE 0 END) AS value_from_fallback
FROM (
  SELECT part.id,
         part.num,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (5,1,8,3,7,2,6,4)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE part.typeid = 10
    AND part.activeflag = 1
    AND part.num LIKE '%'
    AND COALESCE(oh.onhand, 0) <> 0
) r;

-- ────────────────────────────────────────────────────────────────────────────
-- B-TOTAL-BY-PART. The same numbers per part, biggest first — for finding
--   which part is moving a total, and which rows took the current-cost
--   fallback (used_fallback = 1).
-- ────────────────────────────────────────────────────────────────────────────
SELECT r.num,
       r.onhand,
       COALESCE(r.pchavg, r.curavg) AS avgcost_asof,
       r.curavg AS avgcost_today,
       r.onhand * COALESCE(r.pchavg, r.curavg) AS value_avg_asof,
       r.onhand * r.curavg AS value_avg_today,
       (r.pchavg IS NULL) AS used_fallback
FROM (
  SELECT part.id,
         part.num,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (5,1,8,3,7,2,6,4)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE part.typeid = 10
    AND part.activeflag = 1
    AND part.num LIKE '%'
    AND COALESCE(oh.onhand, 0) <> 0
) r
ORDER BY ABS(r.onhand * COALESCE(r.pchavg, r.curavg)) DESC
LIMIT 10;

-- ────────────────────────────────────────────────────────────────────────────
-- B-RECONCILE. "The SQL total and the report KPI disagree" — which filter?
--
--   Returns the SAME total under each filter variant. Whichever row equals the
--   number on screen tells you which filter the extracted SQL has wrong. The
--   .sql file above is hardcoded to variant 1 (active parts, all LGs) because
--   those are the report's DEFAULTS — untick "Active only" in the report and
--   the SQL no longer matches it.
--
--   The LG list is read from `locationgroup` here rather than pasted in, since
--   a stale hardcoded list is itself a way for the two to drift. Note the
--   report includes INACTIVE location groups by default (they can still hold
--   valued stock), so variant 1 or 2 is normally the report, not 3 or 4.
--
--   Still disagreeing after this? The candidates, in order:
--     - THE AS-OF DATE. Confirm it matches the report before reading anything
--       below; it is inline in every query here and is the likeliest cause.
--     - ROW_CAP. Query B stops at 5001 rows and the KPI totals only what
--       loaded. Compare `parts` here against the report's own row count.
--     - getLocationGroupList(). The report is limited to the location groups
--       the LOGGED-IN user can see; run as that user, or compare the Location
--       control against the list this query uses.
--     - The Cost control. "As of date" -> value_avg_asof, "Today's cost" ->
--       value_avg_today. For a past date those are different numbers.
--     - The as-of date being TODAY. Then on-hand comes from live `tag`, not
--       inventorylog, and cost from live partcost — a different query (A).
-- ────────────────────────────────────────────────────────────────────────────
SELECT 1 AS variant,
       'active parts only,
       ALL LGs (what the .sql file has)' AS description,
       COUNT(*) AS parts,
       SUM(r.onhand * COALESCE(r.pchavg, r.curavg)) AS value_avg_asof,
       SUM(r.onhand * COALESCE(r.pchstd, r.curstd)) AS value_std_asof,
       SUM(r.onhand * r.curavg) AS value_avg_today
FROM (
  SELECT part.id,
         part.num,
         part.activeflag,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (
        SELECT id
        FROM locationgroup
      )
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE 1 = 1
    AND part.typeid = 10
    AND part.activeflag = 1
    AND COALESCE(oh.onhand, 0) <> 0
) r
UNION ALL
SELECT 2 AS variant,
       'ALL parts incl. inactive,
       ALL LGs' AS description,
       COUNT(*) AS parts,
       SUM(r.onhand * COALESCE(r.pchavg, r.curavg)) AS value_avg_asof,
       SUM(r.onhand * COALESCE(r.pchstd, r.curstd)) AS value_std_asof,
       SUM(r.onhand * r.curavg) AS value_avg_today
FROM (
  SELECT part.id,
         part.num,
         part.activeflag,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (
        SELECT id
        FROM locationgroup
      )
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE 1 = 1
    AND part.typeid = 10
    AND COALESCE(oh.onhand, 0) <> 0
) r
UNION ALL
SELECT 3 AS variant,
       'active parts only,
       ACTIVE LGs only' AS description,
       COUNT(*) AS parts,
       SUM(r.onhand * COALESCE(r.pchavg, r.curavg)) AS value_avg_asof,
       SUM(r.onhand * COALESCE(r.pchstd, r.curstd)) AS value_std_asof,
       SUM(r.onhand * r.curavg) AS value_avg_today
FROM (
  SELECT part.id,
         part.num,
         part.activeflag,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (
        SELECT id
        FROM locationgroup
        WHERE activeFlag = 1
      )
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE 1 = 1
    AND part.typeid = 10
    AND part.activeflag = 1
    AND COALESCE(oh.onhand, 0) <> 0
) r
UNION ALL
SELECT 4 AS variant,
       'ALL parts,
       ACTIVE LGs only' AS description,
       COUNT(*) AS parts,
       SUM(r.onhand * COALESCE(r.pchavg, r.curavg)) AS value_avg_asof,
       SUM(r.onhand * COALESCE(r.pchstd, r.curstd)) AS value_std_asof,
       SUM(r.onhand * r.curavg) AS value_avg_today
FROM (
  SELECT part.id,
         part.num,
         part.activeflag,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (
        SELECT id
        FROM locationgroup
        WHERE activeFlag = 1
      )
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE 1 = 1
    AND part.typeid = 10
    AND COALESCE(oh.onhand, 0) <> 0
) r
UNION ALL
SELECT 5 AS variant,
       'ALL parts,
       ALL LGs,
       ANY part type (not just 10)' AS description,
       COUNT(*) AS parts,
       SUM(r.onhand * COALESCE(r.pchavg, r.curavg)) AS value_avg_asof,
       SUM(r.onhand * COALESCE(r.pchstd, r.curstd)) AS value_std_asof,
       SUM(r.onhand * r.curavg) AS value_avg_today
FROM (
  SELECT part.id,
         part.num,
         part.activeflag,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (
        SELECT id
        FROM locationgroup
      )
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE 1 = 1
    AND COALESCE(oh.onhand, 0) <> 0
) r
ORDER BY variant;

-- ────────────────────────────────────────────────────────────────────────────
-- B-RECONCILE-INACTIVE. The parts that appear only once "Active only" is off,
--   with the value each contributes — this is the difference between variant 1
--   and variant 2, itemised.
-- ────────────────────────────────────────────────────────────────────────────
SELECT r.num,
       r.onhand,
       COALESCE(r.pchavg, r.curavg) AS avgcost_asof,
       r.onhand * COALESCE(r.pchavg, r.curavg) AS value_avg_asof
FROM (
  SELECT part.id,
         part.num,
         part.activeflag,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (
        SELECT id
        FROM locationgroup
      )
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE 1 = 1
    AND part.typeid = 10
    AND COALESCE(oh.onhand, 0) <> 0
) r
WHERE r.activeflag <> 1
ORDER BY ABS(r.onhand * COALESCE(r.pchavg, r.curavg)) DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- B-BY-PART-TYPE. What the report is valuing, split by part type.
--
--   Splits the valuation by part type. Useful to confirm that only Inventory
--   parts are being valued — but note that on a normal database EVERY part
--   carrying stock is typeid 10, so this returning a single Inventory row is
--   the expected result, not a finding.
--
--   parttype on this schema: 10 Inventory · 20 Service · 21 Labor
--   22 Overhead · 30 Non-Inventory · 40 Internal Use · 50 Capital Equipment
--   60 Shipping · 70 Tax · 80 Misc.
--
--   ONLY typeid 10 is a stocked asset. The report source filters to it, and so
--   does the standard Inventory Valuation Summary. Anything returned under
--   another type would be value the report is right to exclude.
--
--   Read the WHOLE result, not the top row: a NULL typeid forms its own group
--   that sorts below Inventory and is easy to miss.
--
--   No location-group filter here deliberately — it is asking "what is in the
--   valuation", not "what is in these groups". Add one to narrow it.
-- ────────────────────────────────────────────────────────────────────────────
SELECT COALESCE(r.parttype,
       CONCAT('typeid ', r.typeid)) AS part_type,
       r.typeid,
       COUNT(*) AS parts,
       SUM(CASE WHEN r.activeflag = 1 THEN 1 ELSE 0 END) AS active_parts,
       SUM(r.onhand) AS total_qty,
       SUM(r.onhand * COALESCE(r.pchavg, r.curavg)) AS value_avg_asof,
       CASE WHEN r.typeid = 10 THEN 'counted by the report source' ELSE 'NOT a stocked asset - should be excluded' END AS verdict
FROM (
  SELECT part.id,
         part.num,
         part.typeid,
         pt.name AS parttype,
         (part.activeflag + 0) AS activeflag,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN parttype pt ON pt.id = part.typeid
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) r
GROUP BY r.typeid, r.parttype
ORDER BY value_avg_asof DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- B-INACTIVE-ITEMISED. The inactive INVENTORY parts with stock — the separate,
--   legitimate difference the "Active only" checkbox controls.
--
--   Carries rows_total and value_total as window columns on every row, so a
--   partial copy-paste cannot be mistaken for the whole list. Uses
--   NOT (activeflag <=> 1) rather than activeflag <> 1: <> drops NULLs, and a
--   silently missing row is exactly what you are hunting here.
-- ────────────────────────────────────────────────────────────────────────────
SELECT r.num,
       r.parttype,
       r.onhand,
       COALESCE(r.pchavg, r.curavg) AS avgcost_asof,
       r.onhand * COALESCE(r.pchavg, r.curavg) AS value_avg_asof,
       COUNT(*) OVER () AS rows_total,
       SUM(r.onhand * COALESCE(r.pchavg, r.curavg)) OVER () AS value_total
FROM (
  SELECT part.id,
         part.num,
         part.typeid,
         pt.name AS parttype,
         (part.activeflag + 0) AS activeflag,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         part.stdcost AS curstd,
         cst.avgcost AS pchavg,
         cst.stdcost AS pchstd
  FROM part
  LEFT JOIN parttype pt ON pt.id = part.typeid
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) r
WHERE NOT (r.activeflag <=> 1)
  AND r.typeid = 10
ORDER BY ABS(r.onhand * COALESCE(r.pchavg, r.curavg)) DESC;

-- ════════════════════════════════════════════════════════════════════════════
-- B-TRUTH. Run THIS one first when the report and the SQL disagree.
--
--   Every other query in this file rebuilt the row source by hand and dropped
--   the report's LEFT JOINs to uom / vendorparts / vendor, on the assumption
--   that a LEFT JOIN cannot change the row count. That assumption is WRONG when
--   the joined table has more than one matching row:
--
--       LEFT JOIN vendorparts vp ON vp.partid = part.id AND vp.defaultflag = 1
--
--   A part with two vendor records both flagged default returns TWICE, and the
--   report sums its value twice — the KPI is a plain reduce() over the rows the
--   query returned, with no de-duplication. This runs the report's SQL exactly
--   as loadParts() builds it and reports rows vs distinct parts, so the
--   inflation is visible rather than inferred.
--
--   READ IT LIKE THIS:
--     duplicate_rows = 0  -> the joins are innocent; the gap is a filter, so go
--                            back to B-RECONCILE.
--     duplicate_rows > 0  -> the report is over-counting by that much, and
--                            value_avg_asof here should match the report KPI
--                            while B-TRUTH-DEDUPED shows the correct total.
--
--   Set the date, and the active/type clauses, to match what the report has on
--   screen — they are inline below, not parameters.
-- ════════════════════════════════════════════════════════════════════════════
SELECT COUNT(*) AS rows_returned,
       COUNT(DISTINCT part.id) AS distinct_parts,
       COUNT(*) - COUNT(DISTINCT part.id) AS duplicate_rows,
       SUM(COALESCE(oh.onhand, 0)) AS qty_summed,
       SUM(COALESCE(oh.onhand, 0) * COALESCE(cst.avgcost, pc.avgcost)) AS value_avg_asof
FROM part
LEFT JOIN uom ON part.uomid = uom.id
LEFT JOIN partcost pc ON pc.partid = part.id
LEFT JOIN vendorparts vp ON vp.partid = part.id AND vp.defaultflag = 1
LEFT JOIN vendor v ON v.id = vp.vendorid
LEFT JOIN (
  SELECT il.partid, SUM(il.qtyonhand) AS onhand
  FROM inventorylog il
  JOIN (
    SELECT partid, locationgroupid, MAX(id) AS logid
    FROM inventorylog
    WHERE eventdate <= '2026-07-31 23:59:59.999999'
      AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      AND locationgroupid IN (
      SELECT id
      FROM locationgroup
    )
    GROUP BY partid, locationgroupid
  ) mx ON mx.logid = il.id
  GROUP BY il.partid
) oh ON oh.partid = part.id
LEFT JOIN (
  SELECT pch.partid, pch.avgcost, pch.stdcost, DATE(pch.datecaptured) AS costday
  FROM partcosthistory pch
  JOIN (
    SELECT partid, MAX(id) AS costid
    FROM partcosthistory
    WHERE datecaptured <= '2026-07-31 23:59:59.999999'
    GROUP BY partid
  ) mc ON mc.costid = pch.id
) cst ON cst.partid = part.id
WHERE part.typeid = 10
  AND part.activeflag = 1
  AND part.num LIKE '%'
  AND COALESCE(oh.onhand, 0) <> 0;

-- ────────────────────────────────────────────────────────────────────────────
-- B-TRUTH-DEDUPED. The same rows counted once each — the correct total.
--   The difference between this and B-TRUTH is the over-count.
-- ────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS distinct_parts,
       SUM(d.onhand) AS qty_summed,
       SUM(d.onhand * COALESCE(d.pchavg, d.curavg)) AS value_avg_asof
FROM (
  SELECT DISTINCT part.id,
         COALESCE(oh.onhand, 0) AS onhand,
         pc.avgcost AS curavg,
         cst.avgcost AS pchavg
  FROM part
  LEFT JOIN uom ON part.uomid = uom.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN vendorparts vp ON vp.partid = part.id AND vp.defaultflag = 1
  LEFT JOIN vendor v ON v.id = vp.vendorid
  LEFT JOIN (
    SELECT il.partid, SUM(il.qtyonhand) AS onhand
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
        AND locationgroupid IN (
        SELECT id
        FROM locationgroup
      )
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost, pch.stdcost, DATE(pch.datecaptured) AS costday
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE part.typeid = 10
    AND part.activeflag = 1
    AND part.num LIKE '%'
    AND COALESCE(oh.onhand, 0) <> 0
) d;

-- ────────────────────────────────────────────────────────────────────────────
-- B-TRUTH-DUPES. Which parts are duplicated and what each adds in error.
--   rows_for_this_part is how many times the report counted it.
--   Fix at source: either make vendorparts hold one default per part, or
--   change the report to a scalar subquery for the vendor name.
-- ────────────────────────────────────────────────────────────────────────────
SELECT part.num,
       COUNT(*) AS rows_for_this_part,
       COALESCE(oh.onhand, 0) AS onhand,
       COALESCE(cst.avgcost, pc.avgcost) AS avgcost_asof,
       COALESCE(oh.onhand, 0) * COALESCE(cst.avgcost, pc.avgcost) AS value_counted_once,
       (COUNT(*) - 1) * COALESCE(oh.onhand, 0) * COALESCE(cst.avgcost, pc.avgcost) AS value_overcounted
FROM part
LEFT JOIN uom ON part.uomid = uom.id
LEFT JOIN partcost pc ON pc.partid = part.id
LEFT JOIN vendorparts vp ON vp.partid = part.id AND vp.defaultflag = 1
LEFT JOIN vendor v ON v.id = vp.vendorid
LEFT JOIN (
  SELECT il.partid, SUM(il.qtyonhand) AS onhand
  FROM inventorylog il
  JOIN (
    SELECT partid, locationgroupid, MAX(id) AS logid
    FROM inventorylog
    WHERE eventdate <= '2026-07-31 23:59:59.999999'
      AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      AND locationgroupid IN (
      SELECT id
      FROM locationgroup
    )
    GROUP BY partid, locationgroupid
  ) mx ON mx.logid = il.id
  GROUP BY il.partid
) oh ON oh.partid = part.id
LEFT JOIN (
  SELECT pch.partid, pch.avgcost, pch.stdcost, DATE(pch.datecaptured) AS costday
  FROM partcosthistory pch
  JOIN (
    SELECT partid, MAX(id) AS costid
    FROM partcosthistory
    WHERE datecaptured <= '2026-07-31 23:59:59.999999'
    GROUP BY partid
  ) mc ON mc.costid = pch.id
) cst ON cst.partid = part.id
WHERE part.typeid = 10
  AND part.activeflag = 1
  AND part.num LIKE '%'
  AND COALESCE(oh.onhand, 0) <> 0
GROUP BY part.id, part.num, oh.onhand, cst.avgcost, pc.avgcost
HAVING COUNT(*) > 1
ORDER BY value_overcounted DESC;

-- ════════════════════════════════════════════════════════════════════════════
-- B-CENSUS. Run this ONE query and send the whole result.
--
--   Every row is a CASE over the SAME row source, so unlike the earlier
--   queries in this file these numbers cannot contradict each other, and no
--   cross-query assumption is involved. Row 1 is the universe; rows 2-8 split
--   it; rows 9-10 are what the report should be showing.
--
--   HOW TO READ IT against the number on screen:
--     row 9 matches  -> the report is correct and the earlier extracted SQL
--                       was wrong; nothing to fix in the report.
--     row 10 matches -> "Active only" is off in the report, that is all.
--     row 2 matches  -> the location-group filter is the gap (row 8 says how
--                       many parts have an inventorylog locationgroupid with no
--                       matching locationgroup row — deleted groups, which the
--                       report silently drops and this row counts).
--     row 1 matches  -> no filter is being applied at all.
--     none match     -> send rows 1-11 and the screen figure; the arithmetic
--                       between rows will say which dimension is unaccounted.
--
--   Rows 3 and 4 exist because a NULL typeid is excluded by "typeid = 10" yet
--   is NOT reported as a non-Inventory type by a GROUP BY — it forms its own
--   NULL group that is easy to miss when reading only the top row.
--
--   Row 11 counts parts with no cost from either source. They pass every
--   filter and add 0.00, so they move the part COUNT without moving the total.
--
--   Set the date to match the report. No location-group list to paste: the
--   query resolves it against locationgroup itself and reports the mismatch.
-- ════════════════════════════════════════════════════════════════════════════
SELECT 1 AS n,
       'ALL parts with stock (no filter at all)' AS measure,
       SUM(CASE WHEN 1 = 1 THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN 1 = 1 THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN 1 = 1 THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 2 AS n,
       'typeid = 10 (Inventory)' AS measure,
       SUM(CASE WHEN b.typeid = 10 THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.typeid = 10 THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.typeid = 10 THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 3 AS n,
       'typeid IS NULL' AS measure,
       SUM(CASE WHEN b.typeid IS NULL THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.typeid IS NULL THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.typeid IS NULL THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 4 AS n,
       'typeid present but NOT 10' AS measure,
       SUM(CASE WHEN b.typeid IS NOT NULL AND b.typeid <> 10 THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.typeid IS NOT NULL AND b.typeid <> 10 THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.typeid IS NOT NULL AND b.typeid <> 10 THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 5 AS n,
       'active only (activeflag = 1)' AS measure,
       SUM(CASE WHEN b.activeflag = 1 THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.activeflag = 1 THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.activeflag = 1 THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 6 AS n,
       'inactive only' AS measure,
       SUM(CASE WHEN NOT (b.activeflag <=> 1) THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN NOT (b.activeflag <=> 1) THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN NOT (b.activeflag <=> 1) THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 7 AS n,
       'every LG row resolves in locationgroup' AS measure,
       SUM(CASE WHEN b.in_known_lg = 1 THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.in_known_lg = 1 THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.in_known_lg = 1 THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 8 AS n,
       'has an inventorylog LG NOT in locationgroup' AS measure,
       SUM(CASE WHEN b.in_known_lg = 0 THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.in_known_lg = 0 THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.in_known_lg = 0 THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 9 AS n,
       'REPORT DEFAULTS: type 10 + active + known LG' AS measure,
       SUM(CASE WHEN b.typeid = 10 AND b.activeflag = 1 AND b.in_known_lg = 1 THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.typeid = 10 AND b.activeflag = 1 AND b.in_known_lg = 1 THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.typeid = 10 AND b.activeflag = 1 AND b.in_known_lg = 1 THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 10 AS n,
       'REPORT,
       Active-only OFF: type 10 + known LG' AS measure,
       SUM(CASE WHEN b.typeid = 10 AND b.in_known_lg = 1 THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.typeid = 10 AND b.in_known_lg = 1 THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.typeid = 10 AND b.in_known_lg = 1 THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
UNION ALL
SELECT 11 AS n,
       'no cost at all (contributes 0 to any total)' AS measure,
       SUM(CASE WHEN b.cost_asof IS NULL THEN 1 ELSE 0 END) AS parts,
       SUM(CASE WHEN b.cost_asof IS NULL THEN b.onhand ELSE 0 END) AS qty,
       SUM(CASE WHEN b.cost_asof IS NULL THEN b.onhand * b.cost_asof ELSE 0 END) AS value_avg_asof
FROM (
  SELECT part.id,
         part.typeid,
         (part.activeflag + 0) AS activeflag,
         oh.onhand,
         oh.in_known_lg,
         COALESCE(cst.avgcost, pc.avgcost) AS cost_asof
  FROM part
  JOIN (
    SELECT il.partid,
           SUM(il.qtyonhand) AS onhand,
           MIN(CASE WHEN lg.id IS NULL THEN 0 ELSE 1 END) AS in_known_lg
    FROM inventorylog il
    JOIN (
      SELECT partid, locationgroupid, MAX(id) AS logid
      FROM inventorylog
      WHERE eventdate <= '2026-07-31 23:59:59.999999'
        AND typeid IN (1,10,15,20,30,40,50,60,64,65,67,68,72)
      GROUP BY partid, locationgroupid
    ) mx ON mx.logid = il.id
    LEFT JOIN locationgroup lg ON lg.id = il.locationgroupid
    GROUP BY il.partid
  ) oh ON oh.partid = part.id
  LEFT JOIN partcost pc ON pc.partid = part.id
  LEFT JOIN (
    SELECT pch.partid, pch.avgcost
    FROM partcosthistory pch
    JOIN (
      SELECT partid, MAX(id) AS costid
      FROM partcosthistory
      WHERE datecaptured <= '2026-07-31 23:59:59.999999'
      GROUP BY partid
    ) mc ON mc.costid = pch.id
  ) cst ON cst.partid = part.id
  WHERE COALESCE(oh.onhand, 0) <> 0
) b
ORDER BY n;
