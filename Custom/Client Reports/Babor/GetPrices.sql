SELECT export_result.customer_pricing_json
FROM (
WITH RECURSIVE
params AS (
    SELECT CAST(123 AS SIGNED) AS customer_id,
           CAST(1 AS DECIMAL(28,9)) AS requested_quantity,
           CURRENT_DATE AS pricing_date,
           CAST(0 AS SIGNED) AS product_id_after,
           CAST(NULL AS SIGNED) AS product_id_through
),
customer_context AS (
    SELECT c.id, c.name, c.accountId, c.activeFlag, c.currencyId, c.currencyRate
    FROM customer c JOIN params x ON x.customer_id = c.id
    WHERE c.id > 0
),
settings AS (
    SELECT
      COALESCE(MAX(CASE WHEN sysKey='TierTwoPricingIsHigh'
                       THEN LOWER(sysValue)='true' END), 1) AS tier2_high,
      COALESCE(MAX(CASE WHEN sysKey='TierThreePricingIsHigh'
                       THEN LOWER(sysValue)='true' END), 0) AS tier3_high,
      COALESCE(MAX(CASE WHEN sysKey='AllowPricesToBeLower'
                       THEN LOWER(sysValue)='true' END), 1) AS allow_below,
      COALESCE(MAX(CASE WHEN sysKey='AllowPricesToBeLowerType'
                       THEN CAST(sysValue AS UNSIGNED) END), 1) AS floor_basis
    FROM sysproperties WHERE owner = ''
),
products AS (
    SELECT p.*, COALESCE(pt.uomId,0) AS part_uom_id,
           COALESCE(pt.stdCost,0) AS part_std_cost,
           u.code AS uom_code, u.integral+0 AS uom_integral
    FROM product p
    JOIN customer_context c ON TRUE
    JOIN params x ON p.id > x.product_id_after
      AND (x.product_id_through IS NULL OR p.id <= x.product_id_through)
    LEFT JOIN part pt ON pt.id=p.partId
    LEFT JOIN uom u ON u.id=p.uomId
    WHERE p.id > 0
),
/* Follow every membership upwards, including the node itself. */
tree_ancestry AS (
    SELECT ptt.productId, t.id AS node_id, t.parentId,
           CAST(CONCAT('/',t.id,'/') AS CHAR(12000)) AS visited
    FROM producttotree ptt JOIN products p ON p.id=ptt.productId
    JOIN producttree t ON t.id=ptt.productTreeId
    UNION ALL
    SELECT a.productId, t.id, t.parentId, CONCAT(a.visited,t.id,'/')
    FROM tree_ancestry a JOIN producttree t ON t.id=a.parentId
    WHERE LOCATE(CONCAT('/',t.id,'/'), a.visited)=0
),
product_nodes AS (SELECT DISTINCT productId, node_id FROM tree_ancestry),
customer_rules AS (
    SELECT r.*,
      CASE WHEN r.customerInclTypeId=2 THEN 1
           WHEN r.customerInclTypeId=3 THEN 2
           WHEN r.paApplies=1 AND r.paTypeId=6 THEN 3 ELSE 4 END AS priority,
      CASE WHEN r.dateApplies=1 AND r.dateBegin IS NOT NULL AND r.dateEnd IS NOT NULL
           THEN DATE(r.dateBegin) + INTERVAL (TIME_TO_SEC(TIME(r.dateBegin))>=0.001) DAY
           ELSE NULL END AS first_date,
      CASE WHEN r.dateApplies=1 AND r.dateBegin IS NOT NULL AND r.dateEnd IS NOT NULL
           THEN DATE(r.dateEnd) + INTERVAL 1 DAY ELSE NULL END AS end_date_exclusive,
      CASE WHEN r.qtyApplies=1 THEN ROUND(COALESCE(r.qtyMin,0),5) ELSE 0 END AS min_qty,
      CASE WHEN r.qtyApplies=1 THEN NULLIF(ROUND(COALESCE(r.qtyMax,0),5),0)
           ELSE NULL END AS max_qty
    FROM pricingrule r JOIN customer_context c ON TRUE
    WHERE r.isActive=1 AND (
      r.customerInclTypeId=1
      OR (r.customerInclTypeId=2 AND r.customerInclId=c.id)
      OR (r.customerInclTypeId=3 AND EXISTS (
        SELECT 1 FROM accountgrouprelation ag
        WHERE ag.accountId=c.accountId AND ag.groupId=r.customerInclId)))
),
matched_rules AS (
    SELECT DISTINCT p.id AS product_id, r.*
    FROM products p JOIN customer_rules r ON
      r.productInclTypeId=1
      OR (r.productInclTypeId=2 AND r.productInclId=p.id)
      OR (r.productInclTypeId=3 AND EXISTS (
        SELECT 1 FROM product_nodes n
        WHERE n.productId=p.id AND n.node_id=r.productInclId))
),
vendor_ranked AS (
    SELECT vp.*, v.currencyRate, cur.rate AS currency_default_rate,
      ROW_NUMBER() OVER (PARTITION BY vp.partId ORDER BY vp.defaultFlag DESC,vp.id) AS default_rn,
      ROW_NUMBER() OVER (PARTITION BY vp.partId ORDER BY vp.lastDate DESC,vp.id) AS last_rn,
      SUM(vp.defaultFlag+0) OVER (PARTITION BY vp.partId) AS default_count,
      COUNT(*) OVER (PARTITION BY vp.partId,vp.lastDate) AS last_date_count
    FROM vendorparts vp JOIN (SELECT DISTINCT partId FROM products) p ON p.partId=vp.partId
    LEFT JOIN vendor v ON v.id=vp.vendorId
    LEFT JOIN currency cur ON cur.id=v.currencyId
),
part_cost_ranked AS (
    SELECT pc.*, ROW_NUMBER() OVER (PARTITION BY pc.partId ORDER BY pc.id) AS rn,
           COUNT(*) OVER (PARTITION BY pc.partId) AS source_count
    FROM partcost pc JOIN (SELECT DISTINCT partId FROM products) p ON p.partId=pc.partId
),
customer_part_ranked AS (
    SELECT cp.*, ROW_NUMBER() OVER (PARTITION BY cp.productId ORDER BY cp.id) AS rn,
           COUNT(*) OVER (PARTITION BY cp.productId) AS source_count
    FROM customerparts cp JOIN customer_context c ON c.id=cp.customerId
),
manufactured_ranked AS (
    SELECT wi.*, w.dateFinished,
      ROW_NUMBER() OVER (PARTITION BY wi.partId ORDER BY w.dateFinished DESC,wi.id) AS rn,
      COUNT(*) OVER (PARTITION BY wi.partId,w.dateFinished) AS source_count
    FROM woitem wi JOIN wo w ON w.id=wi.woId
    JOIN (SELECT DISTINCT partId FROM products) p ON p.partId=wi.partId
    WHERE wi.typeId=10
),
uom_conversions AS (
    SELECT uc.*, ROW_NUMBER() OVER (PARTITION BY fromUomId,toUomId ORDER BY id) AS rn,
           COUNT(*) OVER (PARTITION BY fromUomId,toUomId) AS source_count
    FROM uomconversion uc
),
cost_raw AS (
    SELECT p.id AS product_id, p.price AS product_price, p.uomId AS product_uom_id,
      p.part_uom_id, p.part_std_cost, COALESCE(pc.avgCost,0) AS part_avg_cost,
      COALESCE(cp.lastPrice,0) AS customer_last_price,
      COALESCE(dv.uomId,0) AS default_vendor_uom_id,
      COALESCE(lv.uomId,0) AS last_vendor_uom_id,
      COALESCE(mf.uomId,p.part_uom_id) AS manufactured_uom_id,
      ROUND(COALESCE(dv.lastCost,0) *
        CASE WHEN ROUND(COALESCE(dv.currencyRate,0),5)=0
             THEN COALESCE(dv.currency_default_rate,1) ELSE dv.currencyRate END,9) AS default_vendor_home_cost,
      ROUND(COALESCE(lv.lastCost,0) *
        CASE WHEN ROUND(COALESCE(lv.currencyRate,0),5)=0
             THEN COALESCE(lv.currency_default_rate,1) ELSE lv.currencyRate END,9) AS last_vendor_home_cost,
      COALESCE(ROUND(mf.cost/NULLIF(mf.qtyUsed,0),9),0) AS manufactured_cost,
      COALESCE(pc.source_count,0)>1 AS avg_ambiguous,
      COALESCE(dv.default_count,0)>1 AS default_vendor_ambiguous,
      COALESCE(lv.last_date_count,0)>1 AS last_vendor_ambiguous,
      COALESCE(cp.source_count,0)>1 AS customer_last_ambiguous,
      COALESCE(mf.source_count,0)>1 AS manufactured_ambiguous
    FROM products p
    LEFT JOIN part_cost_ranked pc ON pc.partId=p.partId AND pc.rn=1
    LEFT JOIN vendor_ranked dv ON dv.partId=p.partId AND dv.default_rn=1 AND dv.defaultFlag=1
    LEFT JOIN vendor_ranked lv ON lv.partId=p.partId AND lv.last_rn=1
    LEFT JOIN customer_part_ranked cp ON cp.productId=p.id AND cp.rn=1
    LEFT JOIN manufactured_ranked mf ON mf.partId=p.partId AND mf.rn=1
),
cost_conversion AS (
    SELECT c.*, CASE WHEN c.part_uom_id = c.product_uom_id THEN c.part_std_cost
          WHEN pp.id IS NOT NULL THEN
            ROUND(ROUND((c.part_std_cost) * CAST(pp.factor AS DECIMAL(28,9)), 9)
                / NULLIF(CAST(pp.multiply AS DECIMAL(28,9)), 0), 9)
          ELSE NULL END AS standard_cost, CASE WHEN c.part_uom_id = c.product_uom_id THEN c.part_avg_cost
          WHEN pp.id IS NOT NULL THEN
            ROUND(ROUND((c.part_avg_cost) * CAST(pp.factor AS DECIMAL(28,9)), 9)
                / NULLIF(CAST(pp.multiply AS DECIMAL(28,9)), 0), 9)
          ELSE NULL END AS average_cost,
      CASE WHEN c.default_vendor_uom_id = c.part_uom_id THEN c.default_vendor_home_cost
          WHEN dv.id IS NOT NULL THEN
            ROUND(ROUND((c.default_vendor_home_cost) * CAST(dv.factor AS DECIMAL(28,9)), 9)
                / NULLIF(CAST(dv.multiply AS DECIMAL(28,9)), 0), 9)
          ELSE NULL END AS default_in_part_uom,
      CASE WHEN c.last_vendor_uom_id = c.part_uom_id THEN c.last_vendor_home_cost
          WHEN lv.id IS NOT NULL THEN
            ROUND(ROUND((c.last_vendor_home_cost) * CAST(lv.factor AS DECIMAL(28,9)), 9)
                / NULLIF(CAST(lv.multiply AS DECIMAL(28,9)), 0), 9)
          ELSE NULL END AS last_in_part_uom,
      CASE WHEN c.manufactured_uom_id = c.product_uom_id THEN c.manufactured_cost
          WHEN mp.id IS NOT NULL THEN
            ROUND(ROUND((c.manufactured_cost) * CAST(mp.factor AS DECIMAL(28,9)), 9)
                / NULLIF(CAST(mp.multiply AS DECIMAL(28,9)), 0), 9)
          ELSE NULL END AS manufactured_direct,
      CASE WHEN c.manufactured_uom_id = c.part_uom_id THEN c.manufactured_cost
          WHEN mt.id IS NOT NULL THEN
            ROUND(ROUND((c.manufactured_cost) * CAST(mt.factor AS DECIMAL(28,9)), 9)
                / NULLIF(CAST(mt.multiply AS DECIMAL(28,9)), 0), 9)
          ELSE NULL END AS manufactured_in_part_uom,
      pp.id AS pp_id, CAST(pp.factor AS DECIMAL(28,9)) AS pp_factor,
      CAST(pp.multiply AS DECIMAL(28,9)) AS pp_multiply,
      GREATEST(COALESCE(pp.source_count,0),COALESCE(dv.source_count,0),
        COALESCE(lv.source_count,0),COALESCE(mp.source_count,0),COALESCE(mt.source_count,0))>1 AS uom_ambiguous
    FROM cost_raw c
    LEFT JOIN uom_conversions pp ON pp.fromUomId=c.part_uom_id AND pp.toUomId=c.product_uom_id AND pp.rn=1
    LEFT JOIN uom_conversions dv ON dv.fromUomId=c.default_vendor_uom_id AND dv.toUomId=c.part_uom_id AND dv.rn=1
    LEFT JOIN uom_conversions lv ON lv.fromUomId=c.last_vendor_uom_id AND lv.toUomId=c.part_uom_id AND lv.rn=1
    LEFT JOIN uom_conversions mp ON mp.fromUomId=c.manufactured_uom_id AND mp.toUomId=c.product_uom_id AND mp.rn=1
    LEFT JOIN uom_conversions mt ON mt.fromUomId=c.manufactured_uom_id AND mt.toUomId=c.part_uom_id AND mt.rn=1
),
bases AS (
    SELECT DISTINCT c.*,
      COALESCE(CASE WHEN part_uom_id=product_uom_id THEN default_in_part_uom
                    WHEN pp_id IS NOT NULL THEN ROUND(ROUND(default_in_part_uom*pp_factor,9)/NULLIF(pp_multiply,0),9) END,
               default_vendor_home_cost) AS default_vendor_cost,
      COALESCE(CASE WHEN part_uom_id=product_uom_id THEN last_in_part_uom
                    WHEN pp_id IS NOT NULL THEN ROUND(ROUND(last_in_part_uom*pp_factor,9)/NULLIF(pp_multiply,0),9) END,
               last_vendor_home_cost) AS last_cost,
      COALESCE(manufactured_direct,
        CASE WHEN part_uom_id=product_uom_id THEN manufactured_in_part_uom
             WHEN pp_id IS NOT NULL THEN ROUND(ROUND(manufactured_in_part_uom*pp_factor,9)/NULLIF(pp_multiply,0),9) END) AS last_manufactured_cost
    FROM cost_conversion c
),
qty_edges AS (
    SELECT id AS product_id, CAST(0.00001 AS DECIMAL(28,5)) AS qty_from FROM products
    UNION SELECT product_id, min_qty FROM matched_rules WHERE isAutoApply=1 AND min_qty>0.00001
    UNION SELECT product_id, max_qty+0.00001 FROM matched_rules WHERE isAutoApply=1 AND max_qty>=0.00001
),
qty_bands AS (
    SELECT product_id, qty_from,
           LEAD(qty_from) OVER (PARTITION BY product_id ORDER BY qty_from) AS qty_to_exclusive
    FROM qty_edges
),
date_edges AS (
    SELECT id AS product_id, CAST('1000-01-01' AS DATE) AS date_from FROM products
    UNION SELECT product_id, first_date FROM matched_rules WHERE isAutoApply=1 AND first_date>'1000-01-01'
    UNION SELECT product_id, end_date_exclusive FROM matched_rules WHERE isAutoApply=1 AND end_date_exclusive>'1000-01-01'
),
date_bands AS (
    SELECT product_id, date_from,
           LEAD(date_from) OVER (PARTITION BY product_id ORDER BY date_from) AS date_to_exclusive
    FROM date_edges
),
cells AS (
    SELECT q.*, d.date_from, d.date_to_exclusive
    FROM qty_bands q JOIN date_bands d USING(product_id)
),
eligible AS (
    SELECT DISTINCT c.*, r.id AS rule_id, r.isTier2+0 AS tier2, r.priority,
      r.paApplies+0 AS pa_applies, r.paBaseAmountTypeId AS basis_id,
      r.paTypeId AS adjustment_id, COALESCE(r.paPercent,0) AS percent_value,
      COALESCE(r.paAmount,0) AS amount_value,
      r.rndApplies+0 AS rnd_applies, r.rndTypeId AS rnd_type,
      COALESCE(r.rndToAmount,0) AS rnd_increment,
      CASE WHEN r.rndIsMinus=1 THEN -COALESCE(r.rndPMAmount,0)
           ELSE COALESCE(r.rndPMAmount,0) END AS rnd_offset
    FROM cells c JOIN matched_rules r ON r.product_id=c.product_id AND r.isAutoApply=1
      AND c.qty_from>=r.min_qty AND (r.max_qty IS NULL OR c.qty_from<=r.max_qty)
      AND (r.first_date IS NULL OR c.date_from>=r.first_date)
      AND (r.end_date_exclusive IS NULL OR c.date_from<r.end_date_exclusive)
),
t2_basis AS (
    SELECT e.*, b.product_price AS input_price,
      COALESCE(CASE WHEN e.pa_applies=0 THEN b.product_price
        WHEN e.basis_id=1 THEN b.average_cost
        WHEN e.basis_id=2 THEN b.default_vendor_cost
        WHEN e.basis_id=3 THEN b.last_cost
        WHEN e.basis_id=4 THEN b.product_price
        WHEN e.basis_id=5 THEN b.product_price
        WHEN e.basis_id=6 THEN b.standard_cost
        WHEN e.basis_id=7 THEN CASE WHEN ROUND(b.customer_last_price,5)=0 THEN b.product_price ELSE b.customer_last_price END
        WHEN e.basis_id=8 THEN b.last_manufactured_cost END, b.product_price,0) AS base_amount,
      (0 OR (e.pa_applies=1 AND e.adjustment_id<>6 AND (
        CASE e.basis_id WHEN 1 THEN (b.avg_ambiguous OR b.uom_ambiguous)
          WHEN 2 THEN (b.default_vendor_ambiguous OR b.uom_ambiguous)
          WHEN 3 THEN (b.last_vendor_ambiguous OR b.uom_ambiguous)
          WHEN 6 THEN b.uom_ambiguous WHEN 7 THEN b.customer_last_ambiguous
          WHEN 8 THEN (b.manufactured_ambiguous OR b.uom_ambiguous) ELSE 0 END
        OR e.basis_id NOT BETWEEN 1 AND 8))
        OR (e.pa_applies=1 AND e.adjustment_id NOT BETWEEN 1 AND 6)
        OR (e.rnd_applies=1 AND e.rnd_type NOT BETWEEN 0 AND 3)
        OR (e.rnd_applies=1 AND e.rnd_type<>0 AND TRUNCATE(e.rnd_increment*100000,0)<=0)) AS source_ambiguous
    FROM eligible e JOIN bases b ON b.product_id=e.product_id
    
    WHERE e.tier2=1
),
t2_adjusted AS (
    SELECT b.*, CAST(ROUND(CASE WHEN pa_applies=0 THEN base_amount
      WHEN adjustment_id=1 THEN base_amount*(1-percent_value)
      WHEN adjustment_id=2 THEN base_amount*(1+percent_value)
      WHEN adjustment_id=3 THEN CASE WHEN ROUND(1-percent_value,5)=0 THEN base_amount
                                    ELSE base_amount/NULLIF(1-percent_value,0) END
      WHEN adjustment_id=4 THEN base_amount*percent_value
      WHEN adjustment_id=5 THEN base_amount+amount_value
      WHEN adjustment_id=6 THEN amount_value ELSE base_amount END,9) AS DECIMAL(28,9)) AS adjusted
    FROM t2_basis b
),
t2_rounding AS (
    SELECT a.*,
      SIGN(adjusted)*FLOOR(ABS(TRUNCATE(adjusted*100000,0))
        /NULLIF(TRUNCATE(rnd_increment*100000,0),0))*TRUNCATE(rnd_increment*100000,0)/100000 AS rounded_down,
      SIGN(adjusted)*FLOOR((ABS(TRUNCATE(adjusted*100000,0))
        +TRUNCATE(ROUND(rnd_increment/2,9)*100000,0))
        /NULLIF(TRUNCATE(rnd_increment*100000,0),0))*TRUNCATE(rnd_increment*100000,0)/100000 AS rounded_nearest
    FROM t2_adjusted a
),
t2_rule_prices AS (
    SELECT product_id, qty_from, qty_to_exclusive, date_from, date_to_exclusive,
      rule_id, priority, source_ambiguous,
      CAST(ROUND(CASE WHEN rnd_applies=0 THEN adjusted ELSE
        CASE rnd_type WHEN 1 THEN rounded_nearest
          WHEN 2 THEN rounded_down+IF(ROUND(adjusted,5)<>ROUND(rounded_down,5),rnd_increment,0)
          WHEN 3 THEN rounded_down ELSE adjusted END+rnd_offset END,9) AS DECIMAL(28,9)) AS unit_price
    FROM t2_rounding
),
t2_candidates AS (
    SELECT * FROM t2_rule_prices
    UNION ALL
    SELECT c.product_id,c.qty_from,c.qty_to_exclusive,c.date_from,c.date_to_exclusive,
      NULL,4,0,b.product_price
    FROM cells c JOIN bases b ON b.product_id=c.product_id
    
),
t2_ranked AS (
    SELECT a.*,
      MAX(source_ambiguous) OVER (PARTITION BY product_id,qty_from,date_from,priority) AS priority_ambiguous,
      MIN(unit_price) OVER (PARTITION BY product_id,qty_from,date_from,priority,ROUND(unit_price,5)) AS tie_min,
      MAX(unit_price) OVER (PARTITION BY product_id,qty_from,date_from,priority,ROUND(unit_price,5)) AS tie_max,
      ROW_NUMBER() OVER (PARTITION BY product_id,qty_from,date_from
        ORDER BY priority, CASE WHEN s.tier2_high=1 THEN -ROUND(unit_price,5) ELSE ROUND(unit_price,5) END,
                 rule_id IS NOT NULL,rule_id) AS rn
    FROM t2_candidates a CROSS JOIN settings s
),
t2_winners AS (
    SELECT DISTINCT a.*,
      (a.priority_ambiguous OR (a.tie_min<>a.tie_max AND a.rule_id IS NOT NULL)) AS needs_native
    FROM t2_ranked a WHERE a.rn=1
),
t3_basis AS (
    SELECT e.*, i.unit_price AS input_price,
      COALESCE(CASE WHEN e.pa_applies=0 THEN b.product_price
        WHEN e.basis_id=1 THEN b.average_cost
        WHEN e.basis_id=2 THEN b.default_vendor_cost
        WHEN e.basis_id=3 THEN b.last_cost
        WHEN e.basis_id=4 THEN i.unit_price
        WHEN e.basis_id=5 THEN b.product_price
        WHEN e.basis_id=6 THEN b.standard_cost
        WHEN e.basis_id=7 THEN CASE WHEN ROUND(b.customer_last_price,5)=0 THEN i.unit_price ELSE b.customer_last_price END
        WHEN e.basis_id=8 THEN b.last_manufactured_cost END, b.product_price,0) AS base_amount,
      (i.needs_native OR (e.pa_applies=1 AND e.adjustment_id<>6 AND (
        CASE e.basis_id WHEN 1 THEN (b.avg_ambiguous OR b.uom_ambiguous)
          WHEN 2 THEN (b.default_vendor_ambiguous OR b.uom_ambiguous)
          WHEN 3 THEN (b.last_vendor_ambiguous OR b.uom_ambiguous)
          WHEN 6 THEN b.uom_ambiguous WHEN 7 THEN b.customer_last_ambiguous
          WHEN 8 THEN (b.manufactured_ambiguous OR b.uom_ambiguous) ELSE 0 END
        OR e.basis_id NOT BETWEEN 1 AND 8))
        OR (e.pa_applies=1 AND e.adjustment_id NOT BETWEEN 1 AND 6)
        OR (e.rnd_applies=1 AND e.rnd_type NOT BETWEEN 0 AND 3)
        OR (e.rnd_applies=1 AND e.rnd_type<>0 AND TRUNCATE(e.rnd_increment*100000,0)<=0)) AS source_ambiguous
    FROM eligible e JOIN bases b ON b.product_id=e.product_id
    JOIN t2_winners i ON i.product_id=e.product_id AND i.qty_from=e.qty_from AND i.date_from=e.date_from
    WHERE e.tier2=0
),
t3_adjusted AS (
    SELECT b.*, CAST(ROUND(CASE WHEN pa_applies=0 THEN base_amount
      WHEN adjustment_id=1 THEN base_amount*(1-percent_value)
      WHEN adjustment_id=2 THEN base_amount*(1+percent_value)
      WHEN adjustment_id=3 THEN CASE WHEN ROUND(1-percent_value,5)=0 THEN base_amount
                                    ELSE base_amount/NULLIF(1-percent_value,0) END
      WHEN adjustment_id=4 THEN base_amount*percent_value
      WHEN adjustment_id=5 THEN base_amount+amount_value
      WHEN adjustment_id=6 THEN amount_value ELSE base_amount END,9) AS DECIMAL(28,9)) AS adjusted
    FROM t3_basis b
),
t3_rounding AS (
    SELECT a.*,
      SIGN(adjusted)*FLOOR(ABS(TRUNCATE(adjusted*100000,0))
        /NULLIF(TRUNCATE(rnd_increment*100000,0),0))*TRUNCATE(rnd_increment*100000,0)/100000 AS rounded_down,
      SIGN(adjusted)*FLOOR((ABS(TRUNCATE(adjusted*100000,0))
        +TRUNCATE(ROUND(rnd_increment/2,9)*100000,0))
        /NULLIF(TRUNCATE(rnd_increment*100000,0),0))*TRUNCATE(rnd_increment*100000,0)/100000 AS rounded_nearest
    FROM t3_adjusted a
),
t3_rule_prices AS (
    SELECT product_id, qty_from, qty_to_exclusive, date_from, date_to_exclusive,
      rule_id, priority, source_ambiguous,
      CAST(ROUND(CASE WHEN rnd_applies=0 THEN adjusted ELSE
        CASE rnd_type WHEN 1 THEN rounded_nearest
          WHEN 2 THEN rounded_down+IF(ROUND(adjusted,5)<>ROUND(rounded_down,5),rnd_increment,0)
          WHEN 3 THEN rounded_down ELSE adjusted END+rnd_offset END,9) AS DECIMAL(28,9)) AS unit_price
    FROM t3_rounding
),
t3_candidates AS (
    SELECT * FROM t3_rule_prices
    UNION ALL
    SELECT c.product_id,c.qty_from,c.qty_to_exclusive,c.date_from,c.date_to_exclusive,
      NULL,4,i.needs_native,i.unit_price
    FROM cells c JOIN bases b ON b.product_id=c.product_id
    JOIN t2_winners i ON i.product_id=c.product_id AND i.qty_from=c.qty_from AND i.date_from=c.date_from
),
t3_ranked AS (
    SELECT a.*,
      MAX(source_ambiguous) OVER (PARTITION BY product_id,qty_from,date_from,priority) AS priority_ambiguous,
      MIN(unit_price) OVER (PARTITION BY product_id,qty_from,date_from,priority,ROUND(unit_price,5)) AS tie_min,
      MAX(unit_price) OVER (PARTITION BY product_id,qty_from,date_from,priority,ROUND(unit_price,5)) AS tie_max,
      ROW_NUMBER() OVER (PARTITION BY product_id,qty_from,date_from
        ORDER BY priority, CASE WHEN s.tier3_high=1 THEN -ROUND(unit_price,5) ELSE ROUND(unit_price,5) END,
                 rule_id IS NOT NULL,rule_id) AS rn
    FROM t3_candidates a CROSS JOIN settings s
),
t3_winners AS (
    SELECT DISTINCT a.*,
      (a.priority_ambiguous OR (a.tie_min<>a.tie_max AND a.rule_id IS NOT NULL)) AS needs_native
    FROM t3_ranked a WHERE a.rn=1
),
floor_values AS (
    SELECT t.*, l.unit_price AS list_price, l.rule_id AS tier2_rule_id,
      s.allow_below,
      CASE s.floor_basis WHEN 1 THEN b.average_cost WHEN 2 THEN b.default_vendor_cost
        WHEN 3 THEN b.last_cost WHEN 4 THEN l.unit_price WHEN 5 THEN b.product_price
        WHEN 6 THEN b.standard_cost WHEN 7 THEN b.customer_last_price
        WHEN 8 THEN b.last_manufactured_cost END AS floor_price,
      CASE s.floor_basis WHEN 1 THEN (b.avg_ambiguous OR b.uom_ambiguous)
        WHEN 2 THEN (b.default_vendor_ambiguous OR b.uom_ambiguous)
        WHEN 3 THEN (b.last_vendor_ambiguous OR b.uom_ambiguous)
        WHEN 4 THEN l.needs_native WHEN 6 THEN b.uom_ambiguous
        WHEN 7 THEN b.customer_last_ambiguous
        WHEN 8 THEN (b.manufactured_ambiguous OR b.uom_ambiguous)
        WHEN 5 THEN 0 ELSE 1 END AS floor_ambiguous
    FROM t3_winners t
    JOIN t2_winners l ON l.product_id=t.product_id AND l.qty_from=t.qty_from AND l.date_from=t.date_from
    JOIN bases b ON b.product_id=t.product_id CROSS JOIN settings s
),
resolved AS (
    SELECT DISTINCT f.*,
      (needs_native OR (allow_below=0 AND floor_ambiguous)) AS requires_native,
      (allow_below=0 AND floor_price IS NOT NULL AND ROUND(unit_price,5)<ROUND(floor_price,5)) AS floor_applied,
      CASE WHEN allow_below=0 AND floor_price IS NOT NULL AND ROUND(unit_price,5)<ROUND(floor_price,5)
           THEN floor_price ELSE unit_price END AS final_price
    FROM floor_values f
),
schedule AS (
    SELECT product_id, JSON_ARRAYAGG(JSON_OBJECT(
      'quantityFrom',CAST(qty_from AS CHAR),
      'quantityToExclusive',CAST(qty_to_exclusive AS CHAR),
      'dateFrom',IF(date_from='1000-01-01',NULL,CAST(date_from AS CHAR)),
      'dateToExclusive',CAST(date_to_exclusive AS CHAR),
      'unitPrice',IF(requires_native,NULL,CAST(CAST(final_price AS DECIMAL(28,9)) AS CHAR)),
      'listPrice',IF(requires_native,NULL,CAST(CAST(list_price AS DECIMAL(28,9)) AS CHAR)),
      'tier2RuleId',tier2_rule_id,'tier3RuleId',rule_id,
      'floorApplied',JSON_EXTRACT(IF(COALESCE(floor_applied,0),'true','false'),'$'),
      'requiresNativePricing',JSON_EXTRACT(IF(requires_native,'true','false'),'$')
    )) AS price_schedule
    FROM resolved GROUP BY product_id
),
current_price AS (
    SELECT r.* FROM resolved r CROSS JOIN params x
    WHERE ROUND(ABS(x.requested_quantity),5)>=r.qty_from
      AND (r.qty_to_exclusive IS NULL OR ROUND(ABS(x.requested_quantity),5)<r.qty_to_exclusive)
      AND x.pricing_date>=r.date_from
      AND (r.date_to_exclusive IS NULL OR x.pricing_date<r.date_to_exclusive)
),
rule_json AS (
    SELECT r.product_id, JSON_ARRAYAGG(JSON_OBJECT(
      'id',r.id,'name',r.name,'description',r.description,
      'tier',IF(r.isTier2=1,2,3),'priority',r.priority,
      'autoApply',JSON_EXTRACT(IF(r.isAutoApply=1,'true','false'),'$'),
      'customerScope',CASE r.customerInclTypeId WHEN 1 THEN 'ALL' WHEN 2 THEN 'CUSTOMER' ELSE 'CUSTOMER_GROUP' END,
      'customerScopeId',r.customerInclId,
      'productScope',CASE r.productInclTypeId WHEN 1 THEN 'ALL' WHEN 2 THEN 'PRODUCT' ELSE 'PRODUCT_TREE' END,
      'productScopeId',r.productInclId,
      'quantity',JSON_OBJECT('applies',JSON_EXTRACT(IF(r.qtyApplies=1,'true','false'),'$'),
         'minimum',IF(r.qtyApplies=1,CAST(r.qtyMin AS CHAR),NULL),
         'maximumInclusive',IF(r.qtyApplies=1,CAST(NULLIF(r.qtyMax,0) AS CHAR),NULL),
         'comparisonScale',5),
      'dates',JSON_OBJECT('applies',JSON_EXTRACT(IF(r.dateApplies=1,'true','false'),'$'),
         'storedBegin',IF(r.dateApplies=1,CAST(r.dateBegin AS CHAR),NULL),
         'storedEnd',IF(r.dateApplies=1,CAST(r.dateEnd AS CHAR),NULL),
         'firstPricingDate',CAST(r.first_date AS CHAR),
         'pricingDateToExclusive',CAST(r.end_date_exclusive AS CHAR)),
      'adjustment',JSON_OBJECT('applies',JSON_EXTRACT(IF(r.paApplies=1,'true','false'),'$'),
         'typeId',r.paTypeId,'baseAmountTypeId',r.paBaseAmountTypeId,
         'percentFraction',CAST(r.paPercent AS CHAR),'amount',CAST(r.paAmount AS CHAR)),
      'rounding',JSON_OBJECT('applies',JSON_EXTRACT(IF(r.rndApplies=1,'true','false'),'$'),
         'typeId',r.rndTypeId,'increment',CAST(r.rndToAmount AS CHAR),
         'offset',CAST(IF(r.rndIsMinus=1,-r.rndPMAmount,r.rndPMAmount) AS CHAR)),
      'specialFields',JSON_OBJECT('applies',JSON_EXTRACT(IF(r.spcApplies=1,'true','false'),'$'),
         'buyX',r.spcBuyX,'getYFree',r.spcGetYFree,
         'affectsNativeUnitPrice',JSON_EXTRACT('false','$')),
      'eligibleAtRequestedContext',JSON_EXTRACT(IF(r.isAutoApply=1
        AND ROUND(ABS(x.requested_quantity),5)>=r.min_qty
        AND (r.max_qty IS NULL OR ROUND(ABS(x.requested_quantity),5)<=r.max_qty)
        AND (r.first_date IS NULL OR x.pricing_date>=r.first_date)
        AND (r.end_date_exclusive IS NULL OR x.pricing_date<r.end_date_exclusive),'true','false'),'$')
    )) AS pricing_rules,
      MAX(r.qtyApplies+0) AS has_qty_rules, MAX(r.dateApplies+0) AS has_date_rules
    FROM matched_rules r CROSS JOIN params x GROUP BY r.product_id
),
product_json AS (
    SELECT p.id, JSON_OBJECT(
      'productId',p.id,'productNumber',p.num,'description',p.description,
      'active',JSON_EXTRACT(IF(p.activeFlag=1,'true','false'),'$'),
      'kit',JSON_EXTRACT(IF(p.kitFlag=1,'true','false'),'$'),
      'uom',JSON_OBJECT('id',p.uomId,'code',p.uom_code,
        'integral',JSON_EXTRACT(IF(p.uom_integral=1,'true','false'),'$')),
      'productPrice',CAST(p.price AS CHAR),
      'bestPrice',IF(cp.requires_native,NULL,CAST(CAST(cp.final_price AS DECIMAL(28,9)) AS CHAR)),
      'listPrice',IF(cp.requires_native,NULL,CAST(CAST(cp.list_price AS DECIMAL(28,9)) AS CHAR)),
      'tier2RuleId',cp.tier2_rule_id,'tier3RuleId',cp.rule_id,
      'requiresNativePricing',JSON_EXTRACT(IF(COALESCE(cp.requires_native,1),'true','false'),'$'),
      'hasQuantityRules',JSON_EXTRACT(IF(COALESCE(r.has_qty_rules,0),'true','false'),'$'),
      'hasDateRules',JSON_EXTRACT(IF(COALESCE(r.has_date_rules,0),'true','false'),'$'),
      'priceSchedule',s.price_schedule,
      'pricingRules',COALESCE(r.pricing_rules,JSON_ARRAY())
    ) AS document
    FROM products p JOIN schedule s ON s.product_id=p.id
    LEFT JOIN current_price cp ON cp.product_id=p.id
    LEFT JOIN rule_json r ON r.product_id=p.id
),
result_status AS (
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customer_context) THEN 'CUSTOMER_NOT_FOUND'
      WHEN requested_quantity IS NULL OR ROUND(ABS(requested_quantity),5)=0 THEN 'INVALID_QUANTITY'
      WHEN pricing_date IS NULL OR pricing_date<'1000-01-01' THEN 'INVALID_PRICING_DATE'
      ELSE 'OK' END AS status FROM params
)
SELECT JSON_OBJECT(
  'schemaVersion','fishbowl-customer-pricing/1',
  'status',rs.status,'customerId',x.customer_id,
  'customerName',(SELECT name FROM customer_context),
  'generatedAt',CAST(CURRENT_TIMESTAMP AS CHAR),
  'pricingDate',CAST(x.pricing_date AS CHAR),
  'quantity',CAST(ABS(x.requested_quantity) AS CHAR),
  'quantityComparisonScale',5,
  'priceCurrency','HOME',
  'homeCurrencyCode',(SELECT code FROM currency WHERE homeCurrency=1 ORDER BY id LIMIT 1),
  'priceUom','PRODUCT_UOM',
  'selectionPolicy',JSON_OBJECT('tier2',IF(s.tier2_high,'HIGHEST','LOWEST'),
    'tier3',IF(s.tier3_high,'HIGHEST','LOWEST'),
    'allowBelowFloor',JSON_EXTRACT(IF(s.allow_below,'true','false'),'$'),
    'floorBaseAmountTypeId',s.floor_basis),
  'productCount',IF(rs.status='OK',(SELECT COUNT(*) FROM product_json),0),
  'products',IF(rs.status='OK',COALESCE((SELECT JSON_ARRAYAGG(document) FROM product_json),JSON_ARRAY()),JSON_ARRAY())
) AS customer_pricing_json
FROM params x CROSS JOIN settings s CROSS JOIN result_status rs
) AS export_result;
