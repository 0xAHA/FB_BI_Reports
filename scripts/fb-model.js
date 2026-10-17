/*
 * fb-model: the Report Builder's field catalog.
 *
 * What a non-technical user can put in a report: subject areas (one grain
 * each), the friendly fields of each, and measures built from SQL that
 * matches Fishbowl's own figures. fb-report compiles a report's spec against
 * this catalog every time the report runs, so a fix here reaches every report.
 *
 * Rules for this file:
 * - Field ids are permanent: never rename or reuse one. Labels can change.
 *   Retire a field with `deprecated: { since, replacedBy, note }`.
 * - SQL is trusted here (it is ours); users never write SQL.
 * - Table names lowercase; `+0` on bit(1) columns; no Fishbowl views.
 * - Every amount is in the home currency.
 * - Bump `version` and add a `changes` entry when a definition changes.
 *
 * Shape, per entry:
 *   joins[alias]   { sql, needs: [aliases], card: 'one'|'many' }
 *   subjects[id]   { label, desc, from, has: [aliases], where: [sql], lg: sql,
 *                    dates: [field ids], requireDate, defaultDate,
 *                    pushdown: { fieldId: [{ col, mark }] } }
 *   fields[id]     dimension: { label, folder, type, sql, uses, key?, lookup?,
 *                    values?, link?, fanout?, listSql?, filterIn? }
 *                  measure:   { label, folder, type, agg, row, uses, gate? }
 *                  calc:      { label, folder, type, calc: '<FBReport.Expr>', gate? }
 *   gates[name]    { label, right }   (a Fishbowl access right string)
 */
(function (global) {
    'use strict';

    const BUILD = '2026.10.14-513c223';   // @fb-build

    // ------------------------------------------------------------ shared SQL
    // Posted revenue, as Fishbowl's Margins report: the line's price less the
    // discount % line that follows it (Sales_Dashboard_v1.2 REV_EXPR).
    const POSTED_REV = 'COALESCE(((psi.totalPrice/psi.qty)-((psi.totalPrice/psi.qty)*psd.adjustPercent)), psi.totalPrice/psi.qty) * psi.qty';

    // The posting of the discount % line that applies to a line: the next line
    // when it is a discount, else the first discount after a subtotal below it.
    const DISCOUNT_JOIN = 'LEFT JOIN postsoitem psd ON psd.soItemId = COALESCE('
        + '(SELECT k.id FROM soitem k WHERE k.soLineItem = soi.soLineItem+1 AND k.typeId = 30 AND soi.typeId != 30 AND k.soId = soi.soId ORDER BY k.soLineItem ASC LIMIT 1),'
        + '(SELECT k.id FROM soitem k WHERE k.soLineItem > soi.soLineItem AND EXISTS (SELECT 1 FROM soitem j WHERE j.typeId = 40 AND j.soId = k.soId AND j.soLineItem >= k.soLineItem-1) AND k.typeId = 30 AND soi.typeId != 30 AND k.soId = soi.soId ORDER BY k.soLineItem ASC LIMIT 1)'
        + ') AND psd.postSOId = pso.id';

    // An order line's value: ordered, fulfilled so far, and what is left
    // (SalesOrderSummary's oprice / fprice / rprice).
    const LINE_VALUE = '(soi.unitPrice * soi.qtyToFulfill + soi.adjustAmount)';
    const LINE_FULFILLED_VALUE = '(ROUND(((soi.qtyFulfilled * soi.unitPrice) + IF(soi.qtyToFulfill = 0, 0, soi.adjustAmount / soi.qtyToFulfill) * soi.qtyFulfilled) * 10, 1) / 10)';
    // A line still has demand while it is open (statuses below 50 Fulfilled).
    const LINE_OPEN = '(soi.statusId < 50)';

    // A line's cost: what posting recorded (else what its shipments consumed)
    // for the fulfilled quantity, plus an estimate at average cost for what is
    // still open. The quantity is converted from the line's unit to the part's.
    const LINE_POSTED_COST = '(SELECT SUM(p.postedTotalCost) FROM postsoitem p WHERE p.soItemId = soi.id)';
    const LINE_SHIPPED_COST = '(SELECT SUM(x.totalCost) FROM shipitem x JOIN ship y ON y.id = x.shipId WHERE x.soItemId = soi.id AND y.statusId = 30)';
    const TO_PART_QTY = '(CASE WHEN soi.uomId = part.uomId THEN 1 WHEN uconv.id IS NOT NULL THEN uconv.multiply / uconv.factor END)';
    const LINE_OPEN_QTY = '(CASE WHEN ' + LINE_OPEN + ' THEN GREATEST(soi.qtyToFulfill - soi.qtyFulfilled, 0) ELSE 0 END)';
    const LINE_ESTIMATE = '(' + LINE_OPEN_QTY + ' * ' + TO_PART_QTY + ' * pcost.avgCost)';
    const LINE_ACTUAL = 'COALESCE(' + LINE_POSTED_COST + ', ' + LINE_SHIPPED_COST + ')';
    const LINE_COST = '(COALESCE(' + LINE_ACTUAL + ', 0) + COALESCE(' + LINE_ESTIMATE + ', 0))';
    const LINE_COST_SOURCE = "(CASE WHEN part.id IS NULL THEN 'No cost (not a part)'"
        + ' WHEN ' + LINE_ACTUAL + " IS NOT NULL AND " + LINE_OPEN_QTY + " > 0 THEN 'Posted + estimate'"
        + ' WHEN ' + LINE_ACTUAL + " IS NOT NULL THEN 'Posted'"
        + ' WHEN ' + LINE_OPEN_QTY + " > 0 AND " + LINE_ESTIMATE + " IS NOT NULL THEN 'Estimated'"
        + " ELSE 'No cost' END)";
    // The order lines that make up an order's value (no subtotals, tax lines or notes).
    const ORDER_LINE_TYPES = 'soi.typeId NOT IN (40,70,90)';

    // An invoice is a shipment (there is no invoice table). Two legs: lines that
    // shipped, and fulfilled lines that never ship (services), dated by the
    // order's first shipment in the range. /*@d1*/ and /*@d2*/ take the date filter.
    const INVOICED_FROM = '(SELECT shi.soItemId AS soItemId, shi.qtyShipped AS qty, sh.dateShipped AS dateInvoiced,'
        + ' sh.locationGroupId AS lgId, shi.totalCost AS cost, sh.num AS shipNum'
        + ' FROM shipitem shi JOIN ship sh ON sh.id = shi.shipId'
        + ' WHERE sh.statusId = 30 AND shi.soItemId IS NOT NULL AND COALESCE(shi.qtyShipped, 0) > 0/*@d1*/'
        + ' UNION ALL'
        + ' SELECT s2.id, s2.qtyFulfilled, shx.dateInvoiced, o2.locationGroupId,'
        + ' (SELECT SUM(p.postedTotalCost) FROM postsoitem p WHERE p.soItemId = s2.id), CAST(NULL AS CHAR)'
        + ' FROM soitem s2 JOIN so o2 ON o2.id = s2.soId'
        + ' JOIN (SELECT soId, MIN(dateShipped) AS dateInvoiced FROM ship WHERE statusId = 30/*@d2*/ GROUP BY soId) shx ON shx.soId = o2.id'
        + ' WHERE s2.productId IS NOT NULL AND s2.showItemFlag = 1 AND COALESCE(s2.qtyFulfilled, 0) > 0'
        + ' AND NOT EXISTS (SELECT 1 FROM shipitem s3 WHERE s3.soItemId = s2.id AND COALESCE(s3.qtyShipped, 0) > 0)'
        + ') inv JOIN soitem soi ON soi.id = inv.soItemId JOIN so ON so.id = soi.soId';

    const CG_NONE = 'No Group';

    const catalog = {
        id: 'fb.core',
        version: 1,
        changes: [
            { version: 1, date: '2026-10-14', note: 'First catalog: Sales (posted, order lines, invoiced, orders).' }
        ],

        gates: {
            cost: { label: 'cost', right: 'Sales Order-Cost' },
            margin: { label: 'margin', right: 'Sales Order-Margin' }
        },

        // ---------------------------------------------------------- joins
        // In dependency order: the compiler emits the ones a report needs in this order.
        joins: {
            cust:  { sql: 'LEFT JOIN customer cust ON cust.id = so.customerId', needs: ['so'] },
            sost:  { sql: 'LEFT JOIN sostatus sost ON sost.id = so.statusId', needs: ['so'] },
            olg:   { sql: 'LEFT JOIN locationgroup olg ON olg.id = so.locationGroupId', needs: ['so'] },
            osp:   { sql: 'LEFT JOIN sysuser osp ON osp.id = so.salesmanId', needs: ['so'] },
            ocls:  { sql: 'LEFT JOIN qbclass ocls ON ocls.id = so.qbClassId', needs: ['so'] },
            ocar:  { sql: 'LEFT JOIN carrier ocar ON ocar.id = so.carrierId', needs: ['so'] },
            oterm: { sql: 'LEFT JOIN paymentterms oterm ON oterm.id = so.paymentTermsId', needs: ['so'] },
            ostate: { sql: 'LEFT JOIN stateconst ostate ON ostate.id = so.shipToStateId', needs: ['so'] },
            octry: { sql: 'LEFT JOIN countryconst octry ON octry.id = so.shipToCountryId', needs: ['so'] },
            csp:   { sql: 'LEFT JOIN sysuser csp ON csp.id = cust.defaultSalesmanId', needs: ['cust'] },
            cgrp:  { sql: 'LEFT JOIN accountgrouprelation cagr ON cagr.accountId = cust.accountId LEFT JOIN accountgroup cgrp ON cgrp.id = cagr.groupId',
                     needs: ['cust'], card: 'many' },
            sity:  { sql: 'LEFT JOIN soitemtype sity ON sity.id = soi.typeId', needs: ['soi'] },
            sist:  { sql: 'LEFT JOIN soitemstatus sist ON sist.id = soi.statusId', needs: ['soi'] },
            suom:  { sql: 'LEFT JOIN uom suom ON suom.id = soi.uomId', needs: ['soi'] },
            prod:  { sql: 'LEFT JOIN product prod ON prod.id = soi.productId', needs: ['soi'] },
            part:  { sql: 'LEFT JOIN part part ON part.id = prod.partId', needs: ['prod'] },
            pcost: { sql: 'LEFT JOIN partcost pcost ON pcost.partId = part.id', needs: ['part'] },
            uconv: { sql: 'LEFT JOIN uomconversion uconv ON uconv.fromUomId = soi.uomId AND uconv.toUomId = part.uomId', needs: ['soi', 'part'] },
            // The product's first category (as the Sales dashboard picks it).
            ptree: { sql: 'LEFT JOIN (SELECT t.productId, t.productTreeId FROM producttotree t JOIN (SELECT productId, MIN(id) AS id FROM producttotree GROUP BY productId) f ON f.id = t.id) ptt ON ptt.productId = soi.productId'
                        + ' LEFT JOIN producttree ptree ON ptree.id = ptt.productTreeId', needs: ['soi'] },
            psd:   { sql: DISCOUNT_JOIN, needs: ['soi', 'pso'] }
        },

        // ---------------------------------------------------------- subject areas
        subjects: {
            'sales.posted': {
                label: 'Sales (posted)',
                desc: 'Revenue, cost and margin as Fishbowl posts them when a sales order line is fulfilled. Matches Fishbowl\'s Margins report.',
                from: 'postsoitem psi JOIN postso pso ON pso.id = psi.postSOId JOIN soitem soi ON soi.id = psi.soItemId JOIN so ON so.id = soi.soId',
                has: ['psi', 'pso', 'soi', 'so'],
                // Discount % lines are folded into the line they discount; subtotals, shipping, tax and notes are not sales.
                where: ['soi.typeId NOT IN (30,40,60,70,90)'],
                lg: 'so.locationGroupId',
                dates: ['posted.date', 'order.dateIssued', 'order.dateCreated'],
                requireDate: true,
                defaultDate: { field: 'posted.date', preset: 'current_fy' }
            },
            'sales.orderLines': {
                label: 'Sales order lines',
                desc: 'Every line of every sales order: ordered, fulfilled and remaining, with cost and margin (estimated for what is still open).',
                from: 'soitem soi JOIN so ON so.id = soi.soId',
                has: ['soi', 'so'],
                where: [ORDER_LINE_TYPES],
                lg: 'so.locationGroupId',
                dates: ['line.dateScheduled', 'order.dateIssued', 'order.dateCreated', 'order.dateCompleted'],
                requireDate: false,
                defaultDate: { field: 'order.dateIssued', preset: 'current_fy' }
            },
            'sales.invoiced': {
                label: 'Sales (invoiced)',
                desc: 'What was invoiced, that is shipped: each shipped line at its order price, plus fulfilled lines that never ship (services).',
                from: INVOICED_FROM,
                has: ['inv', 'soi', 'so'],
                where: [],
                lg: 'inv.lgId',
                dates: ['invoice.date', 'order.dateIssued'],
                requireDate: true,
                defaultDate: { field: 'invoice.date', preset: 'current_fy' },
                pushdown: { 'invoice.date': [{ col: 'sh.dateShipped', mark: '/*@d1*/' }, { col: 'dateShipped', mark: '/*@d2*/' }] }
            },
            'sales.orders': {
                label: 'Sales orders',
                desc: 'One row per sales order: its totals, status, customer, salesperson and dates.',
                from: 'so',
                has: ['so'],
                where: [],
                lg: 'so.locationGroupId',
                dates: ['order.dateIssued', 'order.dateCreated', 'order.dateFirstShip', 'order.dateCompleted'],
                requireDate: false,
                defaultDate: { field: 'order.dateIssued', preset: 'current_fy' }
            }
        },

        // ---------------------------------------------------------- fields
        fields: {
            // -- Order (every Sales subject)
            'order.num': { label: 'Order #', folder: 'Order', type: 'text', sql: 'so.num', uses: ['so'],
                link: { module: 'Sales Order' }, desc: 'The sales order number.' },
            'order.status': { label: 'Order status', folder: 'Order', type: 'text', sql: 'sost.name', uses: ['sost'],
                key: 'so.statusId', lookup: 'SELECT id AS v, name AS l FROM sostatus ORDER BY id' },
            'order.dateIssued': { label: 'Order issued', folder: 'Order', type: 'date', sql: 'so.dateIssued', uses: ['so'] },
            'order.dateCreated': { label: 'Order created', folder: 'Order', type: 'date', sql: 'so.dateCreated', uses: ['so'] },
            'order.dateFirstShip': { label: 'Order scheduled', folder: 'Order', type: 'date', sql: 'so.dateFirstShip', uses: ['so'],
                desc: 'The order\'s scheduled fulfilment date (its first ship date).' },
            'order.dateCompleted': { label: 'Order completed', folder: 'Order', type: 'date', sql: 'so.dateCompleted', uses: ['so'] },
            'order.customerPO': { label: 'Customer PO', folder: 'Order', type: 'text', sql: 'so.customerPO', uses: ['so'] },
            'order.salesperson': { label: 'Order salesperson', folder: 'Order', type: 'text',
                sql: "COALESCE(NULLIF(TRIM(CONCAT(COALESCE(osp.firstName, ''), ' ', COALESCE(osp.lastName, ''))), ''), NULLIF(so.salesman, ''), 'No salesperson')",
                uses: ['osp'], desc: 'The salesperson on the order.' },
            'order.locationGroup': { label: 'Location group', folder: 'Order', type: 'text', sql: 'olg.name', uses: ['olg'] },
            'order.class': { label: 'Class', folder: 'Order', type: 'text', sql: "COALESCE(ocls.name, 'No class')", uses: ['ocls'] },
            'order.carrier': { label: 'Carrier', folder: 'Order', type: 'text', sql: 'ocar.name', uses: ['ocar'] },
            'order.paymentTerms': { label: 'Payment terms', folder: 'Order', type: 'text', sql: 'oterm.name', uses: ['oterm'] },
            'order.shipToName': { label: 'Ship to', folder: 'Order', type: 'text', sql: 'so.shipToName', uses: ['so'] },
            'order.shipToCity': { label: 'Ship-to city', folder: 'Order', type: 'text', sql: 'so.shipToCity', uses: ['so'] },
            'order.shipToState': { label: 'Ship-to state', folder: 'Order', type: 'text', sql: 'ostate.name', uses: ['ostate'] },
            'order.shipToCountry': { label: 'Ship-to country', folder: 'Order', type: 'text', sql: 'octry.name', uses: ['octry'] },

            // -- Customer
            'customer.name': { label: 'Customer', folder: 'Customer', type: 'text', sql: 'cust.name', uses: ['cust'],
                link: { module: 'Customer' } },
            'customer.number': { label: 'Customer number', folder: 'Customer', type: 'text', sql: 'cust.number', uses: ['cust'] },
            'customer.salesperson': { label: 'Customer\'s salesperson', folder: 'Customer', type: 'text',
                sql: "COALESCE(NULLIF(TRIM(CONCAT(COALESCE(csp.firstName, ''), ' ', COALESCE(csp.lastName, ''))), ''), 'No salesperson')",
                uses: ['csp'], desc: 'The customer\'s default salesperson (the one the Sales dashboard reports by).' },
            // A customer can be in several groups: grouping by it counts the customer in each.
            'customer.group': { label: 'Customer group', folder: 'Customer', type: 'text', sql: "COALESCE(cgrp.name, '" + CG_NONE + "')", uses: ['cgrp'],
                fanout: true,
                listSql: "COALESCE((SELECT GROUP_CONCAT(DISTINCT g.name ORDER BY g.name SEPARATOR ', ') FROM accountgrouprelation r JOIN accountgroup g ON g.id = r.groupId WHERE r.accountId = cust.accountId), '" + CG_NONE + "')",
                listUses: ['cust'],
                filterIn: { uses: ['cust'], none: CG_NONE,
                    sql: 'EXISTS (SELECT 1 FROM accountgrouprelation r JOIN accountgroup g ON g.id = r.groupId WHERE r.accountId = cust.accountId AND g.name IN (:list))',
                    noneSql: 'NOT EXISTS (SELECT 1 FROM accountgrouprelation r WHERE r.accountId = cust.accountId)' },
                lookup: "SELECT name AS v, name AS l FROM accountgroup ORDER BY name",
                desc: 'A customer in several groups is counted under each one; totals count it once.' },

            // -- Line (subjects that have order lines)
            'line.num': { label: 'Line #', folder: 'Line', type: 'int', sql: 'soi.soLineItem', uses: ['soi'] },
            'line.type': { label: 'Line type', folder: 'Line', type: 'text', sql: 'sity.name', uses: ['sity'],
                key: 'soi.typeId', lookup: 'SELECT id AS v, name AS l FROM soitemtype ORDER BY id' },
            'line.status': { label: 'Line status', folder: 'Line', type: 'text', sql: 'sist.name', uses: ['sist'],
                key: 'soi.statusId', lookup: 'SELECT id AS v, name AS l FROM soitemstatus ORDER BY id' },
            'line.description': { label: 'Line description', folder: 'Line', type: 'text', sql: 'soi.description', uses: ['soi'] },
            'line.uom': { label: 'Unit', folder: 'Line', type: 'text', sql: 'suom.code', uses: ['suom'] },
            'line.dateScheduled': { label: 'Line scheduled', folder: 'Line', type: 'date',
                sql: 'COALESCE(soi.dateScheduledFulfillment, so.dateFirstShip)', uses: ['soi', 'so'],
                desc: 'The line\'s own scheduled date, else the order\'s.' },
            'line.dateLastFulfilled': { label: 'Line last fulfilled', folder: 'Line', type: 'date', sql: 'soi.dateLastFulfillment', uses: ['soi'] },
            'line.unitPrice': { label: 'Unit price', folder: 'Line', type: 'money', sql: 'soi.unitPrice', uses: ['soi'] },

            // -- Product
            'product.num': { label: 'Product', folder: 'Product', type: 'text', sql: 'COALESCE(prod.num, soi.productNum)', uses: ['prod'] },
            'product.description': { label: 'Product description', folder: 'Product', type: 'text', sql: 'COALESCE(prod.description, soi.description)', uses: ['prod'] },
            'product.category': { label: 'Product category', folder: 'Product', type: 'text', sql: "COALESCE(ptree.name, 'No category')", uses: ['ptree'] },
            'part.num': { label: 'Part', folder: 'Product', type: 'text', sql: 'part.num', uses: ['part'], link: { module: 'Part' } },
            'part.description': { label: 'Part description', folder: 'Product', type: 'text', sql: 'part.description', uses: ['part'] },

            // -- Posted sales
            'posted.date': { label: 'Posted', folder: 'Dates', type: 'date', sql: 'pso.dateCreated', uses: ['pso'],
                desc: 'When the line was posted (fulfilled).' },
            'posted.revenue': { label: 'Revenue', folder: 'Measures', type: 'money', agg: 'sum', row: POSTED_REV, uses: ['psi', 'psd'],
                desc: 'Posted line revenue less any discount % line that applies to it, as Fishbowl\'s Margins report. Credits are negative.' },
            'posted.cogs': { label: 'Cost of goods', folder: 'Measures', type: 'money', agg: 'sum', row: 'psi.postedTotalCost', uses: ['psi'], gate: 'cost',
                desc: 'The cost Fishbowl posted for the line.' },
            'posted.margin': { label: 'Margin', folder: 'Measures', type: 'money', calc: '[posted.revenue] - [posted.cogs]', gate: 'margin' },
            'posted.marginPct': { label: 'Margin %', folder: 'Measures', type: 'percent',
                calc: 'IF([posted.revenue] > 0, ([posted.revenue] - [posted.cogs]) / [posted.revenue], 0)', gate: 'margin',
                desc: 'Margin as a share of revenue, worked out again for every total (never an average of line margins). 0 when revenue is 0 or less.' },
            'posted.qty': { label: 'Qty (order units)', folder: 'Measures', type: 'qty', agg: 'sum', row: 'psi.qty', uses: ['psi'],
                desc: 'Quantity in each line\'s own unit: only add up lines that share a unit.' },
            'posted.lines': { label: 'Lines', folder: 'Measures', type: 'int', agg: 'count', row: 'psi.id', uses: ['psi'] },
            'posted.orders': { label: 'Orders', folder: 'Measures', type: 'int', agg: 'distinct', row: 'so.id', uses: ['so'] },
            'posted.customers': { label: 'Customers', folder: 'Measures', type: 'int', agg: 'distinct', row: 'so.customerId', uses: ['so'] },

            // -- Order lines
            'lines.qtyOrdered': { label: 'Qty ordered', folder: 'Measures', type: 'qty', agg: 'sum', row: 'soi.qtyToFulfill', uses: ['soi'],
                desc: 'The line\'s quantity to fulfil, in its own unit.' },
            'lines.qtyFulfilled': { label: 'Qty fulfilled', folder: 'Measures', type: 'qty', agg: 'sum', row: 'soi.qtyFulfilled', uses: ['soi'] },
            'lines.qtyRemaining': { label: 'Qty remaining', folder: 'Measures', type: 'qty', agg: 'sum', row: LINE_OPEN_QTY, uses: ['soi'],
                desc: 'What is still to fulfil on open lines (0 once a line is fulfilled, closed short, voided or cancelled).' },
            'lines.value': { label: 'Ordered value', folder: 'Measures', type: 'money', agg: 'sum', row: LINE_VALUE, uses: ['soi'],
                desc: 'Unit price × quantity, plus the line\'s adjustment.' },
            'lines.valueFulfilled': { label: 'Fulfilled value', folder: 'Measures', type: 'money', agg: 'sum', row: LINE_FULFILLED_VALUE, uses: ['soi'] },
            'lines.valueRemaining': { label: 'Remaining value', folder: 'Measures', type: 'money', agg: 'sum',
                row: '(CASE WHEN ' + LINE_OPEN + ' THEN ' + LINE_VALUE + ' - ' + LINE_FULFILLED_VALUE + ' ELSE 0 END)', uses: ['soi'],
                desc: 'The value still to fulfil on open lines.' },
            'lines.cost': { label: 'Cost (estimate)', folder: 'Measures', type: 'money', agg: 'sum', row: LINE_COST,
                uses: ['soi', 'part', 'pcost', 'uconv'], gate: 'cost',
                desc: 'Posted cost for what is fulfilled, plus quantity still open × the part\'s average cost. See Cost source.' },
            'lines.costSource': { label: 'Cost source', folder: 'Line', type: 'text', sql: LINE_COST_SOURCE,
                uses: ['soi', 'part', 'pcost', 'uconv'], gate: 'cost',
                desc: 'Posted, Posted + estimate, Estimated, or No cost.' },
            'lines.margin': { label: 'Margin (estimate)', folder: 'Measures', type: 'money', calc: '[lines.value] - [lines.cost]', gate: 'margin' },
            'lines.marginPct': { label: 'Margin % (estimate)', folder: 'Measures', type: 'percent',
                calc: 'IF([lines.value] > 0, ([lines.value] - [lines.cost]) / [lines.value], 0)', gate: 'margin' },
            'lines.count': { label: 'Lines', folder: 'Measures', type: 'int', agg: 'count', row: 'soi.id', uses: ['soi'] },
            'lines.orders': { label: 'Orders', folder: 'Measures', type: 'int', agg: 'distinct', row: 'so.id', uses: ['so'] },

            // -- Invoiced
            'invoice.date': { label: 'Invoiced', folder: 'Dates', type: 'date', sql: 'inv.dateInvoiced', uses: ['inv'],
                desc: 'The ship date (an invoice is a shipment).' },
            'invoice.num': { label: 'Invoice #', folder: 'Order', type: 'text', sql: 'so.num', uses: ['so', 'inv'],
                link: { module: 'Sales Order' }, desc: 'The sales order number, which Fishbowl uses as the invoice number.' },
            'invoice.shipNum': { label: 'Shipment #', folder: 'Order', type: 'text', sql: 'inv.shipNum', uses: ['inv'] },
            'invoice.amount': { label: 'Invoiced (ex tax)', folder: 'Measures', type: 'money', agg: 'sum', row: '(inv.qty * soi.unitPrice)', uses: ['inv', 'soi'],
                desc: 'Quantity shipped × the line\'s unit price.' },
            'invoice.amountIncTax': { label: 'Invoiced (inc tax)', folder: 'Measures', type: 'money', agg: 'sum',
                row: '(inv.qty * soi.unitPrice * (1 + COALESCE(soi.taxRate, 0)))', uses: ['inv', 'soi'] },
            'invoice.tax': { label: 'Tax', folder: 'Measures', type: 'money', calc: '[invoice.amountIncTax] - [invoice.amount]' },
            'invoice.qty': { label: 'Qty invoiced', folder: 'Measures', type: 'qty', agg: 'sum', row: 'inv.qty', uses: ['inv'] },
            'invoice.cost': { label: 'Shipped cost', folder: 'Measures', type: 'money', agg: 'sum', row: 'inv.cost', uses: ['inv'], gate: 'cost',
                desc: 'The cost the shipment consumed (posted cost for lines that never ship).' },
            'invoice.margin': { label: 'Margin', folder: 'Measures', type: 'money', calc: '[invoice.amount] - [invoice.cost]', gate: 'margin' },
            'invoice.marginPct': { label: 'Margin %', folder: 'Measures', type: 'percent',
                calc: 'IF([invoice.amount] > 0, ([invoice.amount] - [invoice.cost]) / [invoice.amount], 0)', gate: 'margin' },
            'invoice.invoices': { label: 'Invoices', folder: 'Measures', type: 'int', agg: 'distinct', row: 'so.id', uses: ['so'] },
            'invoice.lines': { label: 'Lines', folder: 'Measures', type: 'int', agg: 'count', row: 'inv.soItemId', uses: ['inv'] },

            // -- Orders (header)
            'orders.total': { label: 'Order total', folder: 'Measures', type: 'money', agg: 'sum', row: 'so.totalPrice', uses: ['so'],
                desc: 'The order\'s total including tax.' },
            'orders.subtotal': { label: 'Subtotal', folder: 'Measures', type: 'money', agg: 'sum', row: 'so.subTotal', uses: ['so'] },
            'orders.tax': { label: 'Tax', folder: 'Measures', type: 'money', agg: 'sum', row: 'so.totalTax', uses: ['so'] },
            'orders.count': { label: 'Orders', folder: 'Measures', type: 'int', agg: 'count', row: 'so.id', uses: ['so'], only: ['sales.orders'] },
            'orders.avgValue': { label: 'Average order', folder: 'Measures', type: 'money', calc: 'DIVIDE([orders.subtotal], [orders.count], 0)' },
            'orders.cost': { label: 'Cost (estimate)', folder: 'Measures', type: 'money', agg: 'sum',
                row: '(SELECT SUM(' + LINE_COST + ') FROM soitem soi LEFT JOIN product prod ON prod.id = soi.productId LEFT JOIN part part ON part.id = prod.partId'
                    + ' LEFT JOIN partcost pcost ON pcost.partId = part.id LEFT JOIN uomconversion uconv ON uconv.fromUomId = soi.uomId AND uconv.toUomId = part.uomId'
                    + ' WHERE soi.soId = so.id AND ' + ORDER_LINE_TYPES + ')',
                uses: ['so'], gate: 'cost', only: ['sales.orders'],
                desc: 'The order lines\' cost: posted where fulfilled, average cost for what is open.' },
            'orders.margin': { label: 'Margin (estimate)', folder: 'Measures', type: 'money', calc: '[orders.subtotal] - [orders.cost]', gate: 'margin' },
            'orders.marginPct': { label: 'Margin % (estimate)', folder: 'Measures', type: 'percent',
                calc: 'IF([orders.subtotal] > 0, ([orders.subtotal] - [orders.cost]) / [orders.subtotal], 0)', gate: 'margin' }
        }
    };

    // Header amounts belong to the whole order: only the Sales orders subject may total them.
    ['orders.total', 'orders.subtotal', 'orders.tax'].forEach(id => { catalog.fields[id].only = ['sales.orders']; });
    // Each subject's own figures belong to it alone: an order line posted or shipped in parts
    // appears more than once in the other subjects, which would count it twice, and the
    // same label ("Orders", "Lines") would otherwise appear twice in one field list.
    const OWN = { 'posted.': 'sales.posted', 'lines.': 'sales.orderLines', 'invoice.': 'sales.invoiced', 'orders.': 'sales.orders' };
    Object.keys(catalog.fields).forEach(id => {
        const f = catalog.fields[id];
        const prefix = Object.keys(OWN).find(p => id.indexOf(p) === 0);
        if (prefix && (f.agg || f.calc)) f.only = [OWN[prefix]];
    });

    const FBModel = {
        BUILD: BUILD,
        /** The shipped catalog (read-only). */
        catalog: catalog,
        /** The catalog with an admin extension merged in (fb-model-local); shipped SQL always wins. */
        merge: function (local) {
            if (!local || typeof local !== 'object') {
                return catalog;
            }
            const out = Object.assign({}, catalog, { fields: Object.assign({}, catalog.fields) });
            (local.formulas || []).forEach(f => {
                if (f && typeof f.id === 'string' && /^x\.[a-z0-9_]+$/i.test(f.id) && !out.fields[f.id] && typeof f.calc === 'string') {
                    out.fields[f.id] = { label: String(f.label || f.id), folder: String(f.folder || 'Company formulas'),
                        type: String(f.type || 'number'), calc: f.calc, desc: f.desc ? String(f.desc) : '', local: true };
                }
            });
            Object.keys(local.labels || {}).forEach(id => {
                if (out.fields[id]) {
                    out.fields[id] = Object.assign({}, out.fields[id], { label: String(local.labels[id]) });
                }
            });
            (local.hidden || []).forEach(id => {
                if (out.fields[id]) {
                    out.fields[id] = Object.assign({}, out.fields[id], { hidden: true });
                }
            });
            return out;
        }
    };

    global.FBModel = FBModel;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FBModel;
    }
})(typeof window !== 'undefined' ? window : globalThis);
