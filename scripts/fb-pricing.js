/*
 fb-pricing.js  —  Fishbowl's own pricing-rule engine, in JavaScript (namespace: FBPricing).

 WHAT IT IS. A line-for-line port of Custom/Babor/GetPrices.sql, which reproduces
 how Fishbowl prices a product for a customer: two tiers of pricing rules, the
 priority ladder (customer > customer group > fixed > other), a HIGHEST/LOWEST
 choice per tier held in system properties, cost bases converted into the
 product's UOM and home currency, rounding rules, and the optional price floor.
 Each function below is named after the CTE it mirrors, so the two read side by
 side. GetPrices.sql is the SPECIFICATION: change the logic there first, then
 carry it here, then run tools/pricing/verify-fb-pricing.js, which prices every
 customer x product both ways and fails on any difference.

 WHY NOT RUN THE SQL. It is ~27 KB. /api/data-query is GET-only and answers
 414 URI Too Long for it (tested on 26.9), which rules out every page that
 reaches the database over REST — the report host, QuickOrder's portal,
 standalone and mobile modes. The port needs ~10 small ordinary SELECTs instead,
 works through any runQuery, and prices in microseconds once loaded.

 VERIFIED against GET /api/products/:id/best-price through the SQL: 744 of 744
 prices on demodb (2026-09-25). Rounding rules, the price floor and
 multi-currency were NOT exercised there (demodb has none), so the first site
 that uses them is where they get confirmed.

 HOW IT IS DEPLOYED. As a saved Fishbowl Script named "fb-pricing", inlined by a
 report via its own Script directive IN ITS OWN <script> TAG — a server without
 the Script then loses only that block, so consumers treat a missing
 window.FBPricing as "use your fallback". Reports that also run outside
 Fishbowl (QuickOrder) carry an inlined copy instead, kept in step by
 tools/pricing/sync-inline.js. No dependencies.

 SURFACE
   FBPricing.loadBook({ customerId, query?, refresh?, log? })  -> Promise<PriceBook|null>
       query(sql) -> Promise<rows>; defaults to runQueryAsync, then runQuery.
       Customer-independent data (products, trees, costs, UOM conversions) is
       cached for the page's lifetime; refresh: true reloads it.
       Resolves null when there is no customer; REJECTS when a query fails —
       the caller decides what its fallback is.
   book.priceAt(productId, qty, date?)   -> price | null
       { unitPrice, listPrice, productPrice, tier2RuleId, tier3RuleId, ruleId,
         floorApplied }. ruleId is the rule that set the price: the Tier 3
         winner, else the Tier 2 winner, else null (no rule won, and unitPrice
         is the product price or the floor). null means the product is unknown
         or the case is one Fishbowl's engine must settle (requiresNativePricing
         in the SQL): price that line the old way.
   book.nextBreak(productId, qty, date?) -> { atQty, unitPrice } | null
   book.policy   { tier2, tier3: 'HIGHEST'|'LOWEST', allowBelowFloor, floorBaseAmountTypeId }
   book.customerId, book.status ('OK' | 'CUSTOMER_NOT_FOUND'), book.size, book.loadMs
   FBPricing.clearCache(), FBPricing.today() -> 'YYYY-MM-DD' (local)

 Prices are HOME currency, per PRODUCT UOM, at full precision: 0.475 stays 0.475.
 Fishbowl does not round a unit price to cents, and neither should a caller.
*/
(function (global) {
  'use strict';

  // ── numbers, the way MySQL DECIMAL does them ─────────────────────────────
  // Scaling goes through the decimal string ("1.005e2"), not x * 100, so a
  // value like 1.005 rounds as the decimal it is rather than as 100.49999…
  function shift(x, n) {
    var parts = String(x).split('e');
    return Number(parts[0] + 'e' + ((parts[1] ? +parts[1] : 0) + n));
  }
  // ROUND(x, d): half away from zero. NULL in, NULL out.
  function rnd(x, d) {
    if (x == null || !isFinite(x)) return null;
    var s = x < 0 ? -1 : 1;
    return s * shift(Math.round(shift(Math.abs(x), d)), -d);
  }
  // TRUNCATE(x * 100000, 0)
  function trunc5(x) { return x == null ? null : Math.trunc(shift(rnd(x, 9), 5)); }
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return isNaN(n) ? null : n; }
  function int(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }
  function bit(v) { return v === true || v === 1 || v === '1' || (v && v[0] === 1); }
  function coalesce() { for (var i = 0; i < arguments.length; i++) if (arguments[i] != null) return arguments[i]; return null; }
  function sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function addDay(ymd) {
    var p = ymd.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  // ── transport ────────────────────────────────────────────────────────────
  function asRows(r) {
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) { return []; } }
    if (r && !Array.isArray(r) && typeof r === 'object') r = r.rows || r.data || r.results || [];
    return (Array.isArray(r) ? r : []).map(function (row) {
      var o = {};
      for (var k in row) o[k.toLowerCase()] = row[k];
      return o;
    });
  }
  function defaultQuery(sql) {
    if (typeof runQueryAsync === 'function') return runQueryAsync(sql);
    if (typeof runQuery === 'function') {
      return new Promise(function (resolve, reject) {
        try { resolve(runQuery(sql, 'true')); } catch (e) { reject(e); }
      });
    }
    return Promise.reject(new Error('FBPricing: no runQuery / runQueryAsync in this page'));
  }

  // ── customer-independent data, cached per page ───────────────────────────
  var Q = {
    settings: "SELECT sysKey AS k, sysValue AS v FROM sysproperties WHERE owner = '' AND sysKey IN " +
              "('TierTwoPricingIsHigh','TierThreePricingIsHigh','AllowPricesToBeLower','AllowPricesToBeLowerType')",
    rules: 'SELECT id, isActive+0 AS isactive, isAutoApply+0 AS isautoapply, isTier2+0 AS istier2, ' +
           'customerInclTypeId AS cit, customerInclId AS cid, productInclTypeId AS pit, productInclId AS pid, ' +
           'qtyApplies+0 AS qa, qtyMin AS qmin, qtyMax AS qmax, ' +
           "dateApplies+0 AS da, DATE_FORMAT(dateBegin, '%Y-%m-%d') AS dbegin, TIME_TO_SEC(TIME(dateBegin)) AS dbsecs, " +
           "DATE_FORMAT(dateEnd, '%Y-%m-%d') AS dend, " +
           'paApplies+0 AS pa, paTypeId AS patype, paBaseAmountTypeId AS pabase, paPercent AS papct, paAmount AS paamt, ' +
           'rndApplies+0 AS ra, rndTypeId AS rtype, rndToAmount AS rinc, rndIsMinus+0 AS rminus, rndPMAmount AS rpm ' +
           'FROM pricingrule WHERE isActive = 1',
    products: 'SELECT p.id, p.num, p.price, p.uomId AS uomid, p.partId AS partid, ' +
              'COALESCE(pt.uomId, 0) AS partuomid, COALESCE(pt.stdCost, 0) AS stdcost, u.integral+0 AS integral ' +
              'FROM product p LEFT JOIN part pt ON pt.id = p.partId LEFT JOIN uom u ON u.id = p.uomId WHERE p.id > 0',
    memberships: 'SELECT productId AS productid, productTreeId AS treeid FROM producttotree',
    trees: 'SELECT id, parentId AS parentid FROM producttree',
    partcost: 'SELECT id, partId AS partid, avgCost AS avgcost FROM partcost',
    vendorparts: 'SELECT vp.id, vp.partId AS partid, vp.uomId AS uomid, vp.lastCost AS lastcost, vp.defaultFlag+0 AS defaultflag, ' +
                 "DATE_FORMAT(vp.lastDate, '%Y-%m-%d %H:%i:%s') AS lastdate, v.currencyRate AS vrate, cur.rate AS crate " +
                 'FROM vendorparts vp LEFT JOIN vendor v ON v.id = vp.vendorId LEFT JOIN currency cur ON cur.id = v.currencyId',
    uomconv: 'SELECT id, fromUomId AS fromid, toUomId AS toid, factor, multiply FROM uomconversion',
    // manufactured_ranked, ranked server-side: only the winner per part (plus
    // the size of its date tie) comes back, not every finished-good line ever.
    manufactured: 'SELECT partid, uomid, cost, qtyused, cnt FROM (' +
                  'SELECT wi.partId AS partid, wi.uomId AS uomid, wi.cost, wi.qtyUsed AS qtyused, ' +
                  'ROW_NUMBER() OVER (PARTITION BY wi.partId ORDER BY w.dateFinished DESC, wi.id) AS rn, ' +
                  'COUNT(*) OVER (PARTITION BY wi.partId, w.dateFinished) AS cnt ' +
                  'FROM woitem wi JOIN wo w ON w.id = wi.woId WHERE wi.typeId = 10) x WHERE rn = 1'
  };

  var _shared = null;   // Promise of the customer-independent data

  function loadShared(query) {
    function q(sql) { return Promise.resolve(query(sql)).then(asRows); }
    return Promise.all([q(Q.settings), q(Q.rules), q(Q.products), q(Q.memberships), q(Q.trees)]).then(function (r) {
      var sh = { settings: settingsOf(r[0]), rules: r[1].map(ruleOf), q: q, loaded: {} };
      sh.products = new Map();
      r[2].forEach(function (p) {
        var id = int(p.id);
        sh.products.set(id, {
          id: id, num: p.num, price: num(p.price), uomId: int(p.uomid), partId: int(p.partid),
          partUomId: int(p.partuomid) || 0, stdCost: num(p.stdcost) || 0, integral: bit(p.integral)
        });
      });
      sh.nodes = productNodes(r[3], r[4]);
      return sh;
    });
  }

  // settings CTE
  function settingsOf(rows) {
    var m = {};
    rows.forEach(function (r) { m[r.k] = r.v; });
    function flag(k, dflt) { return m[k] == null ? dflt : String(m[k]).toLowerCase() === 'true'; }
    var fb = m.AllowPricesToBeLowerType == null ? 1 : (parseInt(m.AllowPricesToBeLowerType, 10) || 0);
    return { tier2High: flag('TierTwoPricingIsHigh', true), tier3High: flag('TierThreePricingIsHigh', false),
             allowBelow: flag('AllowPricesToBeLower', true), floorBasis: fb };
  }

  // customer_rules CTE, less the customer filter (applied per book)
  function ruleOf(r) {
    var dated = int(r.da) === 1 && r.dbegin != null && r.dend != null;
    var qa = int(r.qa) === 1;
    var cit = int(r.cit), patype = int(r.patype), pa = int(r.pa);
    var rpm = num(r.rpm) || 0;
    return {
      id: int(r.id), autoApply: int(r.isautoapply) === 1, tier2: int(r.istier2) === 1,
      cit: cit, cid: int(r.cid), pit: int(r.pit), pid: int(r.pid),
      priority: cit === 2 ? 1 : cit === 3 ? 2 : (pa === 1 && patype === 6) ? 3 : 4,
      firstDate: dated ? ((num(r.dbsecs) || 0) >= 0.001 ? addDay(r.dbegin) : r.dbegin) : null,
      endExcl: dated ? addDay(r.dend) : null,
      minQty: qa ? rnd(num(r.qmin) || 0, 5) : 0,
      maxQty: qa ? (rnd(num(r.qmax) || 0, 5) || null) : null,
      pa: pa, basis: int(r.pabase), adj: patype,
      pct: num(r.papct) || 0, amt: num(r.paamt) || 0,
      ra: int(r.ra), rtype: int(r.rtype), rinc: num(r.rinc) || 0,
      roff: int(r.rminus) === 1 ? -rpm : rpm
    };
  }

  // tree_ancestry + product_nodes: every node a product sits in, and all their ancestors
  function productNodes(memberships, trees) {
    var parent = new Map();
    trees.forEach(function (t) { parent.set(int(t.id), int(t.parentid)); });
    var out = new Map();
    memberships.forEach(function (m) {
      var pid = int(m.productid), node = int(m.treeid);
      if (!parent.has(node)) return;                      // JOIN producttree drops dangling rows
      var set = out.get(pid) || new Set();
      while (node != null && parent.has(node) && !set.has(node)) { set.add(node); node = parent.get(node); }
      out.set(pid, set);
    });
    return out;
  }

  // Cost data is loaded only when a rule (or the floor) can actually read it.
  function ensureCosts(sh, bases) {
    var jobs = [];
    function need(key, sql, build) {
      if (sh.loaded[key]) return;
      sh.loaded[key] = true;
      jobs.push(sh.q(sql).then(build).catch(function (e) { sh.loaded[key] = false; throw e; }));
    }
    var costBase = bases[1] || bases[2] || bases[3] || bases[6] || bases[8];
    if (bases[1]) need('partcost', Q.partcost, function (rows) { sh.partcost = rankFirst(rows, 'partid'); });
    if (bases[2] || bases[3]) need('vendorparts', Q.vendorparts, function (rows) { sh.vendor = rankVendors(rows); });
    if (costBase) need('uomconv', Q.uomconv, function (rows) {
      sh.conv = rankFirst(rows, function (r) { return int(r.fromid) + '>' + int(r.toid); });
    });
    if (bases[8]) need('manufactured', Q.manufactured, function (rows) {
      sh.mfg = new Map(rows.map(function (r) { return [int(r.partid), r]; }));
    });
    return Promise.all(jobs);
  }

  // ROW_NUMBER() OVER (PARTITION BY key ORDER BY id) = 1, with COUNT(*) as source_count
  function rankFirst(rows, key) {
    var keyOf = typeof key === 'function' ? key : function (r) { return int(r[key]); };
    var m = new Map();
    rows.forEach(function (r) {
      var k = keyOf(r), e = m.get(k);
      if (!e) m.set(k, { row: r, count: 1 });
      else { e.count++; if (int(r.id) < int(e.row.id)) e.row = r; }
    });
    return m;
  }

  // vendor_ranked: the default vendor row and the newest row per part
  function rankVendors(rows) {
    var by = new Map();
    rows.forEach(function (r) { var k = int(r.partid); (by.get(k) || by.set(k, []).get(k)).push(r); });
    var out = new Map();
    by.forEach(function (list, part) {
      var defaults = list.filter(function (r) { return int(r.defaultflag) === 1; });
      var dv = defaults.slice().sort(function (a, b) { return int(a.id) - int(b.id); })[0] || null;
      // ORDER BY lastDate DESC, id — MySQL sorts NULL lowest, so last in DESC
      var lv = list.slice().sort(function (a, b) {
        var x = a.lastdate, y = b.lastdate;
        if (x !== y) { if (x == null) return 1; if (y == null) return -1; return x < y ? 1 : -1; }
        return int(a.id) - int(b.id);
      })[0];
      out.set(part, {
        dv: dv, defaultCount: defaults.length,
        lv: lv, lastDateCount: list.filter(function (r) { return r.lastdate === lv.lastdate; }).length
      });
    });
    return out;
  }

  // ── bases (cost_raw → cost_conversion → bases), per product ──────────────
  function convOf(sh, from, to) { var e = sh.conv && sh.conv.get(from + '>' + to); return e || null; }
  function convert(value, e) {
    if (value == null || !e) return null;
    var f = num(e.row.factor), m = num(e.row.multiply);
    if (!m) return null;
    return rnd(rnd(value * f, 9) / m, 9);
  }
  function vendorHome(v) {
    if (!v) return 0;
    var rate = rnd(num(v.vrate) || 0, 5) === 0 ? coalesce(num(v.crate), 1) : num(v.vrate);
    return rnd((num(v.lastcost) || 0) * rate, 9);
  }

  function basesOf(book, p) {
    var sh = book.sh, cached = book._bases.get(p.id);
    if (cached) return cached;
    var pc = sh.partcost && sh.partcost.get(p.partId);
    var vr = sh.vendor && sh.vendor.get(p.partId);
    var mf = sh.mfg && sh.mfg.get(p.partId);
    var cp = book.custParts.get(p.id);

    var partAvg = pc ? (num(pc.row.avgcost) || 0) : 0;
    var dvRow = vr && vr.dv, lvRow = vr && vr.lv;
    var dvUom = dvRow ? (int(dvRow.uomid) || 0) : 0, lvUom = lvRow ? (int(lvRow.uomid) || 0) : 0;
    var mfUom = mf ? coalesce(int(mf.uomid), p.partUomId) : p.partUomId;
    var dvHome = vendorHome(dvRow), lvHome = vendorHome(lvRow);
    var mfCost = mf ? coalesce(num(mf.qtyused) ? rnd(num(mf.cost) / num(mf.qtyused), 9) : null, 0) : 0;

    var pp = convOf(sh, p.partUomId, p.uomId), dvc = convOf(sh, dvUom, p.partUomId), lvc = convOf(sh, lvUom, p.partUomId);
    var mp = convOf(sh, mfUom, p.uomId), mt = convOf(sh, mfUom, p.partUomId);
    var same = p.partUomId === p.uomId;

    var std = same ? p.stdCost : pp ? convert(p.stdCost, pp) : null;
    var avg = same ? partAvg : pp ? convert(partAvg, pp) : null;
    var dvPart = dvUom === p.partUomId ? dvHome : dvc ? convert(dvHome, dvc) : null;
    var lvPart = lvUom === p.partUomId ? lvHome : lvc ? convert(lvHome, lvc) : null;
    var mfDirect = mfUom === p.uomId ? mfCost : mp ? convert(mfCost, mp) : null;
    var mfPart = mfUom === p.partUomId ? mfCost : mt ? convert(mfCost, mt) : null;
    function toProduct(v) { return same ? v : pp ? convert(v, pp) : null; }

    var b = {
      productPrice: p.price,
      standardCost: std,
      averageCost: avg,
      defaultVendorCost: coalesce(toProduct(dvPart), dvHome),
      lastCost: coalesce(toProduct(lvPart), lvHome),
      lastManufacturedCost: coalesce(mfDirect, toProduct(mfPart)),
      customerLastPrice: cp ? (num(cp.row.lastprice) || 0) : 0,
      avgAmb: !!(pc && pc.count > 1),
      dvAmb: !!(vr && vr.defaultCount > 1),
      lvAmb: !!(vr && vr.lastDateCount > 1),
      custAmb: !!(cp && cp.count > 1),
      mfAmb: !!(mf && int(mf.cnt) > 1),
      uomAmb: [pp, dvc, lvc, mp, mt].some(function (e) { return e && e.count > 1; })
    };
    book._bases.set(p.id, b);
    return b;
  }

  // ── one rule's price (t2_basis/t3_basis → *_adjusted → *_rounding → *_rule_prices)
  function baseAmount(r, b, input) {
    var v = null;
    if (r.pa === 0) v = b.productPrice;
    else switch (r.basis) {
      case 1: v = b.averageCost; break;
      case 2: v = b.defaultVendorCost; break;
      case 3: v = b.lastCost; break;
      case 4: v = input; break;                         // Tier 2 passes product price, Tier 3 the list price
      case 5: v = b.productPrice; break;
      case 6: v = b.standardCost; break;
      case 7: v = rnd(b.customerLastPrice, 5) === 0 ? input : b.customerLastPrice; break;
      case 8: v = b.lastManufacturedCost; break;
    }
    return coalesce(v, b.productPrice, 0);
  }

  function sourceAmbiguous(r, b) {
    var basisAmb = false;
    switch (r.basis) {
      case 1: basisAmb = b.avgAmb || b.uomAmb; break;
      case 2: basisAmb = b.dvAmb || b.uomAmb; break;
      case 3: basisAmb = b.lvAmb || b.uomAmb; break;
      case 6: basisAmb = b.uomAmb; break;
      case 7: basisAmb = b.custAmb; break;
      case 8: basisAmb = b.mfAmb || b.uomAmb; break;
    }
    var basisOut = r.basis != null && (r.basis < 1 || r.basis > 8);
    return (r.pa === 1 && r.adj != null && r.adj !== 6 && (basisAmb || basisOut))
        || (r.pa === 1 && r.adj != null && (r.adj < 1 || r.adj > 6))
        || (r.ra === 1 && r.rtype != null && (r.rtype < 0 || r.rtype > 3))
        || (r.ra === 1 && r.rtype != null && r.rtype !== 0 && trunc5(r.rinc) <= 0);
  }

  function rulePrice(r, base) {
    var adjusted;
    if (r.pa === 0) adjusted = base;
    else switch (r.adj) {
      case 1: adjusted = base * (1 - r.pct); break;
      case 2: adjusted = base * (1 + r.pct); break;
      case 3: adjusted = rnd(1 - r.pct, 5) === 0 ? base : base / (1 - r.pct); break;
      case 4: adjusted = base * r.pct; break;
      case 5: adjusted = base + r.amt; break;
      case 6: adjusted = r.amt; break;
      default: adjusted = base;
    }
    adjusted = rnd(adjusted, 9);
    if (r.ra !== 1) return adjusted;

    var inc = trunc5(r.rinc), a = Math.abs(trunc5(adjusted));
    var down = inc ? sign(adjusted) * Math.floor(a / inc) * inc / 100000 : null;
    var nearest = inc ? sign(adjusted) * Math.floor((a + trunc5(rnd(r.rinc / 2, 9))) / inc) * inc / 100000 : null;
    var v;
    switch (r.rtype) {
      case 1: v = nearest; break;
      case 2: v = down == null ? null : down + (rnd(adjusted, 5) !== rnd(down, 5) ? r.rinc : 0); break;
      case 3: v = down; break;
      default: v = adjusted;
    }
    return v == null ? null : rnd(v + r.roff, 9);
  }

  // *_candidates → *_ranked → *_winners. `input` is the price entering the tier
  // (product price for Tier 2, the Tier 2 winner for Tier 3); `inputAmb` is
  // whether that input itself needs Fishbowl to settle it.
  function compete(rules, b, input, inputAmb, high) {
    var cands = rules.map(function (r) {
      return { rule: r.id, priority: r.priority, amb: inputAmb || sourceAmbiguous(r, b), price: rulePrice(r, baseAmount(r, b, input)) };
    });
    cands.push({ rule: null, priority: 4, amb: inputAmb, price: input });

    function key(c) { var k = rnd(c.price, 5); return k == null ? -Infinity : (high ? -k : k); }
    cands.sort(function (x, y) {
      if (x.priority !== y.priority) return x.priority - y.priority;
      var kx = key(x), ky = key(y);
      if (kx !== ky) return kx - ky;
      if ((x.rule != null) !== (y.rule != null)) return x.rule == null ? -1 : 1;
      return (x.rule == null ? -Infinity : x.rule) - (y.rule == null ? -Infinity : y.rule);
    });
    var w = cands[0];
    var peers = cands.filter(function (c) { return c.priority === w.priority; });
    var twins = peers.filter(function (c) { return rnd(c.price, 5) === rnd(w.price, 5); }).map(function (c) { return c.price; });
    var tieSplit = twins.length && Math.min.apply(null, twins) !== Math.max.apply(null, twins);
    return {
      rule: w.rule, price: w.price,
      native: peers.some(function (c) { return c.amb; }) || (tieSplit && w.rule != null)
    };
  }

  // ── the book ─────────────────────────────────────────────────────────────
  function PriceBook(sh, customer, rules, custParts, loadMs) {
    this.sh = sh;
    this.customerId = customer ? customer.id : null;
    this.status = customer ? 'OK' : 'CUSTOMER_NOT_FOUND';
    var s = sh.settings;
    this.policy = { tier2: s.tier2High ? 'HIGHEST' : 'LOWEST', tier3: s.tier3High ? 'HIGHEST' : 'LOWEST',
                    allowBelowFloor: s.allowBelow, floorBaseAmountTypeId: s.floorBasis };
    this.rules = rules;
    this.custParts = custParts;
    this.size = customer ? sh.products.size : 0;
    this.loadMs = loadMs;
    this._bases = new Map();
    this._matched = new Map();
  }

  // matched_rules: this customer's rules that reach this product
  PriceBook.prototype.matched = function (p) {
    var m = this._matched.get(p.id);
    if (m) return m;
    var nodes = this.sh.nodes.get(p.id);
    m = this.rules.filter(function (r) {
      return r.pit === 1 || (r.pit === 2 && r.pid === p.id) || (r.pit === 3 && !!nodes && nodes.has(r.pid));
    });
    this._matched.set(p.id, m);
    return m;
  };

  function eligible(r, q, d) {
    return r.autoApply && q >= r.minQty && (r.maxQty == null || q <= r.maxQty)
        && (r.firstDate == null || d >= r.firstDate) && (r.endExcl == null || d < r.endExcl);
  }
  function qtyKey(qty) { var q = num(qty); return rnd(Math.abs(q && q > 0 ? q : 1), 5); }

  // resolved: both tiers, then the floor
  PriceBook.prototype.resolve = function (productId, qty, date) {
    if (this.status !== 'OK') return null;
    var p = this.sh.products.get(int(productId));
    if (!p) return null;
    var q = qtyKey(qty), d = date || today(), s = this.sh.settings;
    var rules = this.matched(p).filter(function (r) { return eligible(r, q, d); });
    var b = basesOf(this, p);

    var t2 = compete(rules.filter(function (r) { return r.tier2; }), b, b.productPrice, false, s.tier2High);
    var t3 = compete(rules.filter(function (r) { return !r.tier2; }), b, t2.price, t2.native, s.tier3High);

    var floor = null, floorAmb = true;
    switch (s.floorBasis) {
      case 1: floor = b.averageCost; floorAmb = b.avgAmb || b.uomAmb; break;
      case 2: floor = b.defaultVendorCost; floorAmb = b.dvAmb || b.uomAmb; break;
      case 3: floor = b.lastCost; floorAmb = b.lvAmb || b.uomAmb; break;
      case 4: floor = t2.price; floorAmb = t2.native; break;
      case 5: floor = b.productPrice; floorAmb = false; break;
      case 6: floor = b.standardCost; floorAmb = b.uomAmb; break;
      case 7: floor = b.customerLastPrice; floorAmb = b.custAmb; break;
      case 8: floor = b.lastManufacturedCost; floorAmb = b.mfAmb || b.uomAmb; break;
    }
    var native = t3.native || (!s.allowBelow && floorAmb);
    var floorApplied = !s.allowBelow && floor != null && t3.price != null && rnd(t3.price, 5) < rnd(floor, 5);
    return {
      native: native,
      unitPrice: floorApplied ? floor : t3.price,
      listPrice: t2.price,
      productPrice: p.price,
      tier2RuleId: t2.rule,
      tier3RuleId: t3.rule,
      floorApplied: floorApplied
    };
  };

  PriceBook.prototype.priceAt = function (productId, qty, date) {
    var r = this.resolve(productId, qty, date);
    if (!r || r.native || r.unitPrice == null) return null;
    return {
      unitPrice: r.unitPrice, listPrice: r.listPrice, productPrice: r.productPrice,
      tier2RuleId: r.tier2RuleId, tier3RuleId: r.tier3RuleId,
      ruleId: r.tier3RuleId != null ? r.tier3RuleId : r.tier2RuleId,
      floorApplied: r.floorApplied
    };
  };

  // qty_edges: the quantities at which a rule starts or stops applying
  PriceBook.prototype.nextBreak = function (productId, qty, date) {
    var p = this.sh.products.get(int(productId));
    var cur = this.priceAt(productId, qty, date);
    if (!p || !cur) return null;
    var q = qtyKey(qty), d = date || today(), edges = [];
    this.matched(p).forEach(function (r) {
      if (!r.autoApply || (r.firstDate != null && d < r.firstDate) || (r.endExcl != null && d >= r.endExcl)) return;
      if (r.minQty > 0.00001) edges.push(r.minQty);
      if (r.maxQty != null && r.maxQty >= 0.00001) edges.push(rnd(r.maxQty + 0.00001, 5));
    });
    edges = edges.filter(function (e) { return e > q; }).sort(function (a, b) { return a - b; });
    for (var i = 0; i < edges.length; i++) {
      var at = this.priceAt(productId, edges[i], date);
      if (!at) return null;                               // can't promise past this point
      if (rnd(at.unitPrice, 5) < rnd(cur.unitPrice, 5)) {
        // An edge can sit at a rule's max + 0.00001; on a whole-unit UOM the
        // quantity anyone can order is the next whole number.
        return { atQty: p.integral ? Math.ceil(edges[i] - 0.000001) : edges[i], unitPrice: at.unitPrice };
      }
    }
    return null;
  };

  function loadBook(opts) {
    opts = opts || {};
    var cid = int(opts.customerId);
    if (cid == null || cid <= 0) return Promise.resolve(null);
    var query = typeof opts.query === 'function' ? opts.query : defaultQuery;
    var log = typeof opts.log === 'function' ? opts.log : function () {};
    var started = Date.now();
    if (opts.refresh || !_shared) {
      _shared = loadShared(query);
      _shared.catch(function () { _shared = null; });
    }
    return _shared.then(function (sh) {
      var q = function (sql) { return Promise.resolve(query(sql)).then(asRows); };
      return q('SELECT id, accountId AS accountid FROM customer WHERE id = ' + cid + ' AND id > 0').then(function (crows) {
        var c = crows[0];
        if (!c) return new PriceBook(sh, null, [], new Map(), Date.now() - started);
        var customer = { id: cid, accountId: int(c.accountid) };
        return Promise.all([
          customer.accountId == null ? [] :
            q('SELECT groupId AS groupid FROM accountgrouprelation WHERE accountId = ' + customer.accountId),
          q('SELECT id, productId AS productid, lastPrice AS lastprice FROM customerparts WHERE customerId = ' + cid)
        ]).then(function (r) {
          var groups = new Set(r[0].map(function (g) { return int(g.groupid); }));
          var rules = sh.rules.filter(function (x) {
            return x.cit === 1 || (x.cit === 2 && x.cid === cid) || (x.cit === 3 && groups.has(x.cid));
          });
          // Which cost bases can this customer's automatic rules (or the floor) read?
          var bases = {};
          rules.forEach(function (x) { if (x.autoApply && x.pa === 1 && x.adj >= 1 && x.adj <= 5) bases[x.basis] = true; });
          if (!sh.settings.allowBelow) bases[sh.settings.floorBasis] = true;
          return ensureCosts(sh, bases).then(function () {
            var book = new PriceBook(sh, customer, rules, rankFirst(r[1], 'productid'), Date.now() - started);
            log('price book for customer ' + cid + ': ' + rules.length + ' rules in scope, ' + book.size +
                ' products, ' + book.loadMs + ' ms', 'info');
            return book;
          });
        });
      });
    });
  }

  global.FBPricing = {
    // Build stamp, maintained by tools/stamp/stamp.js - never edit by hand.
    BUILD: '2026.09.25-f4b1b41',   // @fb-build
    loadBook: loadBook,
    clearCache: function () { _shared = null; },
    today: today
  };
})(typeof window !== 'undefined' ? window : this);
