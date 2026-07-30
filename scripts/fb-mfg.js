/*
 fb-mfg.js  —  Shared Fishbowl BI MANUFACTURING logic (namespace: FBMfg).
 Deployed as a saved Fishbowl Script named "fb-mfg" and inlined by a report via
 its own Script directive, AFTER fb-lib (this module reads FBLib.Common helpers).

 Pure, DOM-free logic lifted VERBATIM from the mature (bug-fixed) copy in
 Manufacturing/Production_Scheduling_v1.2.htm — the canonical source. Do not
 hand-edit here; regenerate from that report so the two never drift.

   FBMfg.Finisher  — WO finish engine: stock query, FIFO/serial allocation,
                     SavePick / SaveWorkOrder builders, prepareFinish/previewFinish.
                     Serial multi-tag dedup + 3-arg buildCompleteWorkOrder +
                     preStoreLabourUsed (non-inventory qtyUsed round-trip) + finish-short.
   FBMfg.Scrap     — ImportScrapData engine: header, location resolve, FIFO/manual
                     serial+lot allocation, buildScrapPlan / postScrapImport.
   FBMfg.Staging   — moitem-tree dependency helpers: DEP_QUERY, sortWOsByDependencies,
                     orderRowsByChain (all parameterised on a deps[] array).
   FBMfg.setLogger(fn) / setDiag(fn) — optional (type,msg)/(msg) log hooks (default off).

 Runtime globals used (present when inlined in a Fishbowl report): runRestApiAsync,
 runApiRequest, runQuery, runQueryAsync, moment, window. FBLib must load first.
*/
(function (global) {
  'use strict';
  var C = (global.FBLib && global.FBLib.Common) || {};
  var _log = null;   // (type, msg) => void
  var _diag = null;  // (msg) => void
  function setLogger(fn) { _log = (typeof fn === 'function') ? fn : null; }
  function setDiag(fn) { _diag = (typeof fn === 'function') ? fn : null; }
  function dbg(m, t) { try { if (_log) _log(t || 'info', '[FBMfg] ' + m); } catch (_) {} }
  function fmtQty(v) {
    try { return C.formatQty(v); }
    catch (e) { var n = parseFloat(v); return isNaN(n) ? '' : String(n); }
  }

  // ===== HELPERS + FG PARSERS + SCRAP ENGINE (from Production_Scheduling_v1.2) =====
    // ── Query helper (mirrors source qp; prefers runQueryAsync) ──
    function norm(r) {
        if (r == null) return [];
        if (typeof r === 'string') { try { var p = JSON.parse(r); return Array.isArray(p) ? p : []; } catch (_) { return []; } }
        return Array.isArray(r) ? r : [];
    }
    function qp(sql) {
        if (typeof runQueryAsync === 'function') {
            return runQueryAsync(sql).then(norm).catch(function (e) {
                dbg('qp fallback sync: ' + e.message, 'warn');
                return norm(runQuery(sql));
            });
        }
        return Promise.resolve(norm(runQuery(sql)));
    }

    // ── FG serial parsers (verbatim) ────────────────────────────
    function generateFgSerials(seed, count) {
        var s = String(seed || '');
        var m = s.match(/^(.*?)(\d+)$/);
        var prefix, startNum, pad;
        if (m) { prefix = m[1]; startNum = parseInt(m[2], 10); pad = m[2].length; }
        else { prefix = s + (s ? '-' : ''); startNum = 1; pad = Math.max(3, String(count).length); }
        var out = [];
        for (var i = 0; i < count; i++) { out.push(prefix + String(startNum + i).padStart(pad, '0')); }
        return out;
    }
    function parseFgSerials(text) {
        return String(text || '').split(/[\r\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    function effectiveUsedQty(line) {
        if (!line) return 0;
        var v = line.usedInput;
        if (v == null || v === '') return Number(line.target) || 0;
        var n = parseFloat(v);
        return Number.isFinite(n) ? n : (Number(line.target) || 0);
    }
    // Scrapped is opt-in — blank falls back to 0 (nothing to scrap).
    function effectiveScrapQty(line) {
        if (!line) return 0;
        var v = line.scrappedInput;
        if (v == null || v === '') return 0;
        var n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
    }

    // ============================================================
    // SCRAP ENGINE — ported from Work_Order_WIP.htm
    // ------------------------------------------------------------
    // When a raw-material line carries a non-zero Scrapped qty, Finish
    // routes it through Fishbowl's Import API (ImportScrapData) via the
    // synchronous runApiRequest bridge — resolve a location, allocate
    // tags/serials FIFO, build a CSV, POST. The import is interleaved
    // between the SavePickRq commit and the SaveWorkOrderRq so any
    // failure surfaces before the WO is marked Fulfilled.
    // Manual per-tag/serial scrap selection (WO_WIP's scrap modal) is
    // NOT ported — allocation is always FIFO-auto.
    // ============================================================
    var _scrapImp = null;   // cached ImportScrapData header; reset per finish
    function csvEsc(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    function scrapParseCsvLine(line) {
        var out = [], cur = '', inq = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (inq) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += ch; }
            else { if (ch === '"') inq = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
        }
        out.push(cur);
        return out.map(function (s) { return s.trim(); });
    }
    function extractImportHeader(r) {
        var h = r && r.ImportHeaderRs && r.ImportHeaderRs.Header;
        if (h == null) return null;
        if (h && typeof h === 'object' && !Array.isArray(h)) h = h.Row;
        if (typeof h === 'string') return scrapParseCsvLine(h);
        if (Array.isArray(h)) {
            if (h.length === 1 && typeof h[0] === 'string' && h[0].indexOf(',') >= 0) return scrapParseCsvLine(h[0]);
            return h.map(function (x) { return String(x).replace(/^"|"$/g, '').trim(); });
        }
        return null;
    }
    function ensureScrapImportHeader() {
        if (_scrapImp) return _scrapImp;
        if (typeof runApiRequest !== 'function') throw new Error('Import API (runApiRequest) is not available — cannot scrap without it.');
        var resp = runApiRequest('ImportHeaderRq', JSON.stringify({ ImportHeaderRq: { Type: 'ImportScrapData' } }));
        var r = typeof resp === 'string' ? JSON.parse(resp) : resp;
        var header = extractImportHeader(r);
        if (!Array.isArray(header) || !header.length) throw new Error('Could not parse ImportScrapData header: ' + JSON.stringify(r));
        function normHdr(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
        function find(patterns) {
            for (var k = 0; k < patterns.length; k++) {
                var i = header.findIndex(function (h) { return patterns[k].test(normHdr(h)); });
                if (i >= 0) return i;
            }
            return -1;
        }
        var partIdx = find([/^partnumber$/, /^partnum$/, /partnumber/]);
        var locIdx  = find([/^location$/, /^locationname$/]);
        var qtyIdx  = find([/^qty$/, /^quantity$/]);
        var noteIdx = find([/^note$/]);
        var dateIdx = find([/^date$/]);
        if (partIdx < 0) throw new Error('No PartNumber column in ImportScrapData header: ' + header.join(', '));
        if (locIdx  < 0) throw new Error('No Location column in ImportScrapData header: ' + header.join(', '));
        if (qtyIdx  < 0) throw new Error('No Qty column in ImportScrapData header: ' + header.join(', '));
        var trackingCols = [];
        header.forEach(function (h, i) { if (/^tracking/.test(normHdr(h))) trackingCols.push({ i: i, name: h, norm: normHdr(h) }); });
        _scrapImp = { header: header, partIdx: partIdx, locIdx: locIdx, qtyIdx: qtyIdx, noteIdx: noteIdx, dateIdx: dateIdx, trackingCols: trackingCols };
        dbg('ImportScrapData header (' + header.length + ' cols, ' + trackingCols.length + ' tracking): ' + header.join(', '));
        return _scrapImp;
    }
    function fillScrapTrackingCols(vals, imp, fields) {
        if (!imp.trackingCols.length || !Array.isArray(fields)) return;
        function normHdr(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
        fields.forEach(function (f) {
            var wantA = normHdr(f.abbr), wantN = normHdr(f.name);
            var col = imp.trackingCols.find(function (c) { return (wantN && c.norm.indexOf(wantN) !== -1) || (wantA && c.norm.indexOf(wantA) !== -1); });
            if (col && f.info != null && f.info !== '') {
                var val = String(f.info);
                if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(val)) { try { val = C.formatDate(val); } catch (_) { val = val.slice(0, 10); } }
                vals[col.i] = val;
            }
        });
    }
    // Resolve a scrap location for one line: prefer the part's default location
    // in the WO's LG (if it has enough stock), else the oldest tag location with
    // enough. Returns { locId, lgName, locName, availQty, source } or null.
    async function resolveScrapLocation(line, lgId, scrapQty) {
        var partId = line.partId || null;
        if (line.defaultLocId && line.defaultLocName && line.defaultLocAvail >= scrapQty) {
            return { locId: line.defaultLocId, lgName: line.defaultLgName, locName: line.defaultLocName, availQty: line.defaultLocAvail, source: 'default' };
        }
        if (!partId) return null;
        var lgClause = lgId ? "AND l.locationgroupid = " + parseInt(lgId, 10) + " " : '';
        var sql =
            "SELECT * FROM (" +
            "  SELECT l.id AS locid, l.name AS loc_name, lg.name AS lg_name, " +
            "         SUM(GREATEST(t.qty - COALESCE(t.qtycommitted, 0), 0)) AS avail, MIN(t.datecreated) AS oldest " +
            "  FROM tag t JOIN location l ON l.id = t.locationid JOIN locationgroup lg ON lg.id = l.locationgroupid " +
            "  WHERE t.partid = " + parseInt(partId, 10) + " AND t.typeid IN (30, 40) " +
            "    AND l.countedasavailable = 1 AND l.pickable = 1 " + lgClause +
            "  GROUP BY l.id, l.name, lg.name HAVING avail >= " + Number(scrapQty).toFixed(6) + " " +
            "  ORDER BY oldest, l.id LIMIT 1" +
            ") AS wrapped";
        try {
            var rows = await qp(sql);
            if (rows.length) return { locId: parseInt(rows[0].locid, 10) || 0, lgName: rows[0].lg_name || '', locName: rows[0].loc_name || '', availQty: parseFloat(rows[0].avail) || 0, source: 'fallback' };
        } catch (e) { dbg('resolveScrapLocation query failed: ' + (e && e.message || e), 'warn'); }
        return null;
    }
    function allocateScrapTags(partId, locId, qtyNeeded, isSerialTracked) {
        return isSerialTracked ? allocateScrapSerials(partId, locId, qtyNeeded) : allocateScrapLots(partId, locId, qtyNeeded);
    }
    async function allocateScrapLots(partId, locId, qtyNeeded) {
        var sql =
            "SELECT * FROM (" +
            "  SELECT t.id AS tag_id, t.num AS tag_num, GREATEST(t.qty - COALESCE(t.qtycommitted, 0), 0) AS avail, t.datecreated AS date_created, " +
            "         ttv.parttrackingid AS ptid, ttv.name AS tname, ttv.abbr AS tabbr, ttv.info AS tinfo, ttv.infoformatted AS tfmt, ttv.sortorder AS tsort " +
            "  FROM tag t LEFT JOIN tagtrackingview ttv ON ttv.tagid = t.id AND ttv.typeid <> 40 " +
            "  WHERE t.partid = " + parseInt(partId, 10) + " AND t.locationid = " + parseInt(locId, 10) + " " +
            "    AND t.typeid IN (30, 40) AND (t.qty - COALESCE(t.qtycommitted, 0)) > 0 " +
            "  ORDER BY t.datecreated, t.id, ttv.sortorder" +
            ") AS wrapped";
        var rows;
        try { rows = await qp(sql); } catch (e) { dbg('allocateScrapLots failed: ' + (e && e.message || e), 'warn'); return { allocations: [], covered: false }; }
        var byTag = {}, order = [];
        rows.forEach(function (r) {
            var id = parseInt(r.tag_id, 10); if (!id) return;
            if (!byTag[id]) { byTag[id] = { tagId: id, tagNum: r.tag_num == null ? '' : String(r.tag_num), avail: parseFloat(r.avail) || 0, fields: [] }; order.push(id); }
            if (r.ptid != null && r.tabbr != null) {
                var val = r.tfmt != null ? r.tfmt : (r.tinfo != null ? r.tinfo : '');
                if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}[ T]/.test(val)) val = val.slice(0, 10);
                byTag[id].fields.push({ name: r.tname || '', abbr: r.tabbr || '', info: val });
            }
        });
        var remaining = Number(qtyNeeded) || 0, allocations = [];
        for (var i = 0; i < order.length && remaining > 1e-9; i++) {
            var tag = byTag[order[i]];
            if (tag.avail <= 1e-9) continue;
            var take = Math.min(tag.avail, remaining);
            allocations.push({ kind: 'lot', tagId: tag.tagId, tagNum: tag.tagNum, qty: take, fields: tag.fields });
            remaining -= take;
        }
        return { allocations: allocations, covered: remaining <= 1e-6 };
    }
    async function allocateScrapSerials(partId, locId, qtyNeeded) {
        var lotSql =
            "SELECT * FROM (" +
            "  SELECT t.id AS tag_id, t.datecreated AS date_created, ttv.parttrackingid AS ptid, ttv.name AS tname, ttv.abbr AS tabbr, ttv.info AS tinfo, ttv.infoformatted AS tfmt, ttv.sortorder AS tsort " +
            "  FROM tag t LEFT JOIN tagtrackingview ttv ON ttv.tagid = t.id AND ttv.typeid <> 40 " +
            "  WHERE t.partid = " + parseInt(partId, 10) + " AND t.locationid = " + parseInt(locId, 10) + " " +
            "    AND t.typeid IN (30, 40) AND (t.qty - COALESCE(t.qtycommitted, 0)) > 0 " +
            "  ORDER BY t.datecreated, t.id, ttv.sortorder" +
            ") AS wrapped_lots";
        var serSql =
            "SELECT * FROM (" +
            "  SELECT t.id AS tag_id, t.datecreated AS date_created, s.id AS sid, tsv.parttrackingid AS ptid, tsv.name AS sname, tsv.abbr AS sabbr, tsv.serialnum AS sn, tsv.sortorder AS ssort " +
            "  FROM tag t JOIN serial s ON s.tagid = t.id AND s.committedFlag = 0 JOIN tagserialview tsv ON tsv.serialid = s.id " +
            "  WHERE t.partid = " + parseInt(partId, 10) + " AND t.locationid = " + parseInt(locId, 10) + " AND t.typeid IN (30, 40) " +
            "  ORDER BY t.datecreated, t.id, s.id, tsv.sortorder" +
            ") AS wrapped_serials";
        var lotRows, serRows;
        try { lotRows = await qp(lotSql); serRows = await qp(serSql); }
        catch (e) { dbg('allocateScrapSerials failed: ' + (e && e.message || e), 'warn'); return { allocations: [], covered: false }; }
        var tagLot = {};
        lotRows.forEach(function (r) {
            var id = parseInt(r.tag_id, 10); if (!id) return;
            if (!tagLot[id]) tagLot[id] = { tagId: id, fields: [] };
            if (r.ptid != null && r.tabbr != null) {
                var val = r.tfmt != null ? r.tfmt : (r.tinfo != null ? r.tinfo : '');
                if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}[ T]/.test(val)) val = val.slice(0, 10);
                tagLot[id].fields.push({ name: r.tname || '', abbr: r.tabbr || '', info: val, ptid: parseInt(r.ptid, 10) });
            }
        });
        var units = {}, unitOrder = [], serialFieldMap = {};
        serRows.forEach(function (r) {
            var sid = parseInt(r.sid, 10); if (!sid) return;
            if (!units[sid]) { units[sid] = { sid: sid, tagId: parseInt(r.tag_id, 10) || 0, vals: {} }; unitOrder.push(sid); }
            var ptid = parseInt(r.ptid, 10) || 0;
            if (ptid) {
                units[sid].vals[ptid] = r.sn == null ? '' : String(r.sn);
                if (!serialFieldMap[ptid]) serialFieldMap[ptid] = { ptid: ptid, name: r.sname || '', abbr: r.sabbr || '', sort: r.ssort || 0 };
            }
        });
        var serialFields = Object.keys(serialFieldMap).map(function (k) { return serialFieldMap[k]; }).sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
        var need = Math.max(0, Math.floor(Number(qtyNeeded) || 0));
        if (need === 0) return { allocations: [], covered: true };
        var taken = unitOrder.slice(0, need).map(function (sid) { return units[sid]; });
        if (taken.length < need) return { allocations: [], covered: false };
        function lotSig(unit) { var lot = tagLot[unit.tagId]; if (!lot) return '__none__'; return lot.fields.map(function (f) { return f.ptid + '=' + (f.info || ''); }).join('|'); }
        var groupsBySig = {}, sigOrder = [];
        taken.forEach(function (u) {
            var sig = lotSig(u);
            if (!groupsBySig[sig]) { var lot = tagLot[u.tagId]; groupsBySig[sig] = { kind: 'serial-group', qty: 0, fields: (lot && lot.fields) ? lot.fields.slice() : [], serialFields: serialFields.slice(), serials: [] }; sigOrder.push(sig); }
            groupsBySig[sig].serials.push({ sid: u.sid, vals: serialFields.map(function (f) { return { ptid: f.ptid, name: f.name, abbr: f.abbr, value: u.vals[f.ptid] || '' }; }) });
            groupsBySig[sig].qty++;
        });
        return { allocations: sigOrder.map(function (s) { return groupsBySig[s]; }), covered: true };
    }

    // ── Manual scrap selection (Serials + Lots) ─────────────────────────────
    // A raw line that carries ANY tracking requires the operator to choose which
    // serials / lot-tags are scrapped (Finish blocks until they do — see
    // buildScrapPlan). These pools list every candidate at the resolved scrap
    // location, and the row-builders emit the SAME shapes the FIFO allocators do
    // (kind:'serial-group' / kind:'lot') so postScrapImport is unchanged. Selection
    // is scoped to the one location resolveScrapLocation picks (default loc, else the
    // oldest tag location with enough) — matching the FIFO engine's one-location model.
    function scrapNeedsSelection(line) { return !line.isLabour && !!(line.isSerialTracked || line.hasTracking); }

    // All uncommitted serial units at a location, each with its serial value(s) +
    // the tag's lot fields (for grouping) — the candidate pool for the serial picker.
    async function scrapSerialPool(partId, locId) {
        var lotSql =
            "SELECT * FROM (SELECT t.id AS tag_id, ttv.parttrackingid AS ptid, ttv.name AS tname, ttv.abbr AS tabbr, ttv.info AS tinfo, ttv.infoformatted AS tfmt, ttv.sortorder AS tsort" +
            "  FROM tag t LEFT JOIN tagtrackingview ttv ON ttv.tagid = t.id AND ttv.typeid <> 40" +
            "  WHERE t.partid = " + parseInt(partId, 10) + " AND t.locationid = " + parseInt(locId, 10) +
            "    AND t.typeid IN (30,40) AND (t.qty - COALESCE(t.qtycommitted,0)) > 0" +
            "  ORDER BY t.datecreated, t.id, ttv.sortorder) AS wl";
        var serSql =
            "SELECT * FROM (SELECT t.id AS tag_id, t.num AS tag_num, t.datecreated AS dc, s.id AS sid, tsv.parttrackingid AS ptid, tsv.name AS sname, tsv.abbr AS sabbr, tsv.serialnum AS sn, tsv.sortorder AS ssort" +
            "  FROM tag t JOIN serial s ON s.tagid = t.id AND s.committedFlag = 0 JOIN tagserialview tsv ON tsv.serialid = s.id" +
            "  WHERE t.partid = " + parseInt(partId, 10) + " AND t.locationid = " + parseInt(locId, 10) + " AND t.typeid IN (30,40)" +
            "  ORDER BY t.datecreated, t.id, s.id, tsv.sortorder) AS ws";
        var lotRows = [], serRows = [];
        lotRows = await qp(lotSql); serRows = await qp(serSql);
        var tagLot = {};
        lotRows.forEach(function (r) {
            var id = parseInt(r.tag_id, 10); if (!id) return;
            if (!tagLot[id]) tagLot[id] = [];
            if (r.ptid != null && r.tabbr != null) {
                var val = r.tfmt != null ? r.tfmt : (r.tinfo != null ? r.tinfo : '');
                if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}[ T]/.test(val)) val = val.slice(0, 10);
                tagLot[id].push({ name: r.tname || '', abbr: r.tabbr || '', info: val, ptid: parseInt(r.ptid, 10) });
            }
        });
        var units = {}, order = [], fieldMap = {};
        serRows.forEach(function (r) {
            var sid = parseInt(r.sid, 10); if (!sid) return;
            if (!units[sid]) { units[sid] = { sid: sid, tagId: parseInt(r.tag_id, 10) || 0, tagNum: r.tag_num == null ? '' : String(r.tag_num), valsByPtid: {} }; order.push(sid); }
            var ptid = parseInt(r.ptid, 10) || 0;
            if (ptid) { units[sid].valsByPtid[ptid] = r.sn == null ? '' : String(r.sn); if (!fieldMap[ptid]) fieldMap[ptid] = { ptid: ptid, name: r.sname || '', abbr: r.sabbr || '', sort: r.ssort || 0 }; }
        });
        var serialFields = Object.keys(fieldMap).map(function (k) { return fieldMap[k]; }).sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
        var list = order.map(function (sid) {
            var u = units[sid]; var lot = tagLot[u.tagId] || [];
            u.lotFields = lot;
            u.label = serialFields.map(function (f) { return u.valsByPtid[f.ptid] || ''; }).filter(Boolean).join(' / ') || ('#' + sid);
            u.lotLabel = lot.map(function (f) { return (f.abbr || f.name) + ':' + f.info; }).filter(Boolean).join(', ');
            return u;
        });
        return { serialFields: serialFields, units: list };
    }
    // All tags with available qty at a location — the candidate pool for the lot picker.
    async function scrapLotPool(partId, locId) {
        var sql =
            "SELECT * FROM (SELECT t.id AS tag_id, t.num AS tag_num, GREATEST(t.qty - COALESCE(t.qtycommitted,0),0) AS avail, t.datecreated AS dc," +
            "  ttv.parttrackingid AS ptid, ttv.name AS tname, ttv.abbr AS tabbr, ttv.info AS tinfo, ttv.infoformatted AS tfmt, ttv.sortorder AS tsort" +
            "  FROM tag t LEFT JOIN tagtrackingview ttv ON ttv.tagid = t.id AND ttv.typeid <> 40" +
            "  WHERE t.partid = " + parseInt(partId, 10) + " AND t.locationid = " + parseInt(locId, 10) +
            "    AND t.typeid IN (30,40) AND (t.qty - COALESCE(t.qtycommitted,0)) > 0" +
            "  ORDER BY t.datecreated, t.id, ttv.sortorder) AS wl";
        var rows = await qp(sql);
        var byTag = {}, order = [];
        rows.forEach(function (r) {
            var id = parseInt(r.tag_id, 10); if (!id) return;
            if (!byTag[id]) { byTag[id] = { tagId: id, tagNum: r.tag_num == null ? '' : String(r.tag_num), avail: parseFloat(r.avail) || 0, fields: [] }; order.push(id); }
            if (r.ptid != null && r.tabbr != null) {
                var val = r.tfmt != null ? r.tfmt : (r.tinfo != null ? r.tinfo : '');
                if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}[ T]/.test(val)) val = val.slice(0, 10);
                byTag[id].fields.push({ name: r.tname || '', abbr: r.tabbr || '', info: val });
            }
        });
        return order.map(function (id) { var t = byTag[id]; t.lotLabel = t.fields.map(function (f) { return (f.abbr || f.name) + ':' + f.info; }).filter(Boolean).join(', ') || ('Tag ' + t.tagNum); return t; });
    }
    // Group picked serial units by lot signature → kind:'serial-group' scrap rows.
    function buildScrapSerialRows(partNum, location, pickedUnits, serialFields) {
        var bySig = {}, order = [];
        pickedUnits.forEach(function (u) {
            var sig = (u.lotFields || []).map(function (f) { return f.ptid + '=' + (f.info || ''); }).join('|') || '__none__';
            if (!bySig[sig]) { bySig[sig] = { partNum: partNum, location: location, kind: 'serial-group', qty: 0,
                fields: (u.lotFields || []).map(function (f) { return { name: f.name, abbr: f.abbr, info: f.info }; }),
                serialFields: serialFields.map(function (f) { return { ptid: f.ptid, name: f.name, abbr: f.abbr }; }), serials: [] }; order.push(sig); }
            bySig[sig].serials.push({ sid: u.sid, vals: serialFields.map(function (f) { return { ptid: f.ptid, name: f.name, abbr: f.abbr, value: u.valsByPtid[f.ptid] || '' }; }) });
            bySig[sig].qty++;
        });
        return order.map(function (s) { return bySig[s]; });
    }
    // Picked lot tags + per-tag qty → kind:'lot' scrap rows.
    function buildScrapLotRows(partNum, location, pickedTags) {
        return pickedTags.map(function (t) { return { partNum: partNum, location: location, kind: 'lot', tagId: t.tagId, tagNum: t.tagNum, qty: t.qty, fields: t.fields || [] }; });
    }

    // Build the scrap plan: per line with a scrap qty — TRACKED lines use the
    // operator's manual serial/lot selection (required); non-tracked lines resolve a
    // location + FIFO-allocate. Returns { rows, blockers }.
    async function buildScrapPlan(fs, wo) {
        var out = { rows: [], blockers: [] };
        if (!fs || !fs.lines) return out;
        var lgId = wo && wo.moLgId ? parseInt(wo.moLgId, 10) : 0;
        var note = wo && wo.num ? 'WO ' + wo.num : '';
        for (var i = 0; i < fs.lines.length; i++) {
            var line = fs.lines[i];
            if (line.isLabour) continue;
            var qty = parseFloat(line.scrappedInput) || 0;
            if (qty <= 0) continue;
            if (line.isSerialTracked && Math.abs(qty - Math.floor(qty)) > 1e-9) {
                out.blockers.push(line.partNum + ': serial-tracked scrap qty must be a whole number (got ' + fmtQty(qty) + ')');
                continue;
            }
            // Tracked lines: require the operator's manual serial/lot selection.
            if (scrapNeedsSelection(line)) {
                var sel = fs.scrapSel && fs.scrapSel[i];
                if (!sel || !sel.rows || !sel.rows.length) {
                    out.blockers.push(line.partNum + ': choose which ' + (line.isSerialTracked ? 'serials' : 'lots') + ' to scrap (' + fmtQty(qty) + ' required) — use the Choose button on the Scrap column');
                    continue;
                }
                if (Math.abs((sel.qty || 0) - qty) > 1e-6) {
                    out.blockers.push(line.partNum + ': scrap selection is ' + fmtQty(sel.qty || 0) + ' but the scrap qty is ' + fmtQty(qty) + ' — reselect');
                    continue;
                }
                sel.rows.forEach(function (r) { out.rows.push(Object.assign({ note: note }, r)); });
                continue;
            }
            var loc = await resolveScrapLocation(line, lgId, qty);
            if (!loc || !loc.lgName || !loc.locName) {
                out.blockers.push(line.partNum + ': no location in ' + (wo && wo.moLgName ? wo.moLgName : 'this LG') + ' has ' + fmtQty(qty) + ' available to scrap');
                continue;
            }
            var alloc = await allocateScrapTags(line.partId, loc.locId, qty, !!line.isSerialTracked);
            if (!alloc.allocations.length || !alloc.covered) {
                var got = alloc.allocations.reduce(function (s, a) { return s + (a.qty || 0); }, 0);
                out.blockers.push(line.partNum + ': stock moved during resolve — ' + (got > 0 ? 'only ' + fmtQty(got) + ' still available at ' + loc.lgName + '-' + loc.locName : 'no stock remaining at ' + loc.lgName + '-' + loc.locName));
                continue;
            }
            alloc.allocations.forEach(function (a) {
                out.rows.push({ partNum: line.partNum, location: loc.lgName + '-' + loc.locName, qty: a.qty, note: note, kind: a.kind, fields: a.fields, serialFields: a.serialFields, serials: a.serials, tagId: a.tagId, tagNum: a.tagNum });
            });
        }
        return out;
    }
    // POST the scrap batch via ImportRq. Sync (runApiRequest); throws on non-1000.
    function postScrapImport(scrapRows) {
        if (!scrapRows || !scrapRows.length) return { ok: true, count: 0 };
        var imp = ensureScrapImportHeader();
        var today = (function () {
            var d = new Date();
            var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            try { return C.formatDate(iso); } catch (_) { return iso; }
        })();
        var lines = [ imp.header.map(csvEsc).join(',') ];
        scrapRows.forEach(function (r) {
            var item = imp.header.map(function () { return ''; });
            item[imp.partIdx] = r.partNum;
            item[imp.locIdx]  = r.location;
            item[imp.qtyIdx]  = r.qty;
            if (imp.noteIdx >= 0) item[imp.noteIdx] = r.note;
            if (imp.dateIdx >= 0) item[imp.dateIdx] = today;
            if (r.fields && r.fields.length) fillScrapTrackingCols(item, imp, r.fields);
            lines.push(item.map(csvEsc).join(','));
            if (r.kind === 'serial-group' && Array.isArray(r.serials) && r.serials.length) {
                var sF = Array.isArray(r.serialFields) ? r.serialFields : [];
                if (sF.length > 1) {
                    var head = imp.header.map(function () { return ''; });
                    sF.forEach(function (f, i) { head[i] = f.name || f.abbr || ''; });
                    lines.push(head.map(csvEsc).join(','));
                }
                r.serials.forEach(function (u) {
                    var srow = imp.header.map(function () { return ''; });
                    (u.vals || []).forEach(function (v, i) { srow[i] = v.value == null ? '' : String(v.value); });
                    lines.push(srow.map(csvEsc).join(','));
                });
            }
        });
        var payload = { ImportRq: { Type: 'ImportScrapData', Rows: { Row: lines } } };
        window._lastScrapCsv = lines.slice();
        dbg('Scrap CSV (' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + '): ' + lines.join(' | '));
        var resp = runApiRequest('ImportRq', JSON.stringify(payload));
        var r = !resp ? null : (typeof resp === 'string' ? JSON.parse(resp) : resp);
        var code = r && r.ImportRs ? Number(r.ImportRs.statusCode) : NaN;
        if (code === 1000) return { ok: true, count: scrapRows.length };
        var msg = (r && r.ImportRs && r.ImportRs.statusMessage) || (r && r.ErrorRs && r.ErrorRs.statusMessage) || ('Scrap import failed (status ' + code + '): ' + JSON.stringify(r));
        var csvDump = lines.map(function (l, i) { return '[' + i + '] ' + l; }).join('\n');
        throw new Error(msg + '\n\nCSV posted (' + lines.length + ' lines):\n' + csvDump);
    }

  // Scrap-engine surface (report wires resetHeader() before each finish).
  var Scrap = {
    resetHeader: function () { _scrapImp = null; },
    ensureScrapImportHeader: ensureScrapImportHeader,
    postScrapImport: postScrapImport,
    buildScrapPlan: buildScrapPlan,
    resolveScrapLocation: resolveScrapLocation,
    allocateScrapTags: allocateScrapTags,
    scrapNeedsSelection: scrapNeedsSelection,
    scrapSerialPool: scrapSerialPool,
    scrapLotPool: scrapLotPool,
    buildScrapSerialRows: buildScrapSerialRows,
    buildScrapLotRows: buildScrapLotRows
  };

  // ===== FINISH ENGINE (from Production_Scheduling_v1.2) =====
      var Finisher = (function () {
        var ACTIONABLE_STATUSES  = new Set([5, 6, 10, 11, 20]);
        var COMMITTED_STATUSES   = new Set([30, 40]);
        var STOCK_DECIMALS       = 6;
        var EPSILON              = 1e-9;
        var FRACTION_SCALE       = 1000000;
        var INVENTORY_PART_TYPE  = 10;
        var TRACKING_TYPE_DATE   = new Set([20, 30]);
        var TRACKING_TYPE_SERIAL = 40;

        var CFG = {
            mode: 'fifo', autoTracking: true, batchRule: 'wo', batchPrefix: '',
            useByRule: 'blank', shelfDays: 0, noGroupTracked: false
        };

        function ensureArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
        function deepClone(v) { return (typeof structuredClone === 'function') ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
        function toNumber(v, f) { var n = Number(v); return Number.isFinite(n) ? n : f; }
        function roundStock(v) { return Number(Math.max(0, toNumber(v, 0)).toFixed(STOCK_DECIMALS)); }
        function sqlString(v) {
            try { return "'" + C.escSQL(v) + "'"; }
            catch (_) { return "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'"; }
        }
        function toQuantityString(v) {
            var n = Number(v);
            if (!Number.isFinite(n)) return '0';
            if (Number.isInteger(n)) return String(n);
            return String(Number(n.toFixed(6)));
        }
        function pad2(n) { return String(n).padStart(2, '0'); }
        function nowFishbowl() {
            var d = new Date();
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' +
                   pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
        }
        function todayCompact() { var d = new Date(); return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
        function isoDatePlusDays(days) {
            var d = new Date(); d.setDate(d.getDate() + toNumber(days, 0));
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        }
        function errorMessage(e) {
            if (e == null) return 'Unknown error';
            if (typeof e === 'string') return e;
            if (e.message) return String(e.message);
            try { return JSON.stringify(e); } catch (x) { return String(e); }
        }
        function lc(row) { var out = {}; Object.keys(row || {}).forEach(function (k) { out[k.toLowerCase()] = row[k]; }); return out; }
        function tryParseJsonArray(v) {
            if (Array.isArray(v)) return v;
            if (v == null) return [];
            if (typeof v === 'object') return [v];
            var t = String(v).trim();
            if (!t || t.toLowerCase() === 'null') return [];
            try { var p = JSON.parse(t); return Array.isArray(p) ? p : []; } catch (e) { return []; }
        }

        function responseNodeName(name) { return String(name).replace(/Rq$/, 'Rs'); }
        function legacyMsgs(json) {
            return (json && json.FbiJson && json.FbiJson.FbiMsgsRs) ? json.FbiJson.FbiMsgsRs
                 : (json && json.FbiMsgsRs) ? json.FbiMsgsRs : json;
        }
        function summarizeLegacyError(json, rsName) {
            var msgs = legacyMsgs(json);
            var rs = msgs && msgs[rsName] ? msgs[rsName] : null;
            var err = msgs && msgs.ErrorRs ? msgs.ErrorRs : null;
            return {
                envelopeStatus: msgs && msgs.statusCode != null ? msgs.statusCode : null,
                responseStatus: rs && rs.statusCode != null ? rs.statusCode : null,
                responseMessage: (rs && (rs.statusMessage || rs.message)) ||
                                 (err && err.Message) ||
                                 (msgs && (msgs.statusMessage || msgs.message)) ||
                                 (json && json.message) || null,
            };
        }
        function assertLegacyResponse(json, name) {
            var rsName = responseNodeName(name);
            var msgs = legacyMsgs(json);
            var rs = msgs && msgs[rsName] ? msgs[rsName] : (json && json[rsName] ? json[rsName] : null);
            var envelope = msgs && msgs.statusCode != null ? Number(msgs.statusCode) : 1000;
            var response = rs && rs.statusCode != null ? Number(rs.statusCode) : 1000;
            if (envelope !== 1000 || !rs || response !== 1000) {
                throw new Error(rsName + ' failed: ' + JSON.stringify(summarizeLegacyError(json, rsName)));
            }
            return rs;
        }
        async function legacyRequest(name, payload) {
            if (typeof runRestApiAsync !== 'function') {
                throw new Error('runRestApiAsync is unavailable. Open this report inside Fishbowl with REST enabled.');
            }
            var body = {}; body[name] = payload;
            dbg('Finisher ' + name + ' -> ' + JSON.stringify(payload).slice(0, 400), 'info');
            var json = await runRestApiAsync({
                method: 'POST', path: '/api/legacy/external/' + name,
                body: JSON.stringify(body), contentType: 'application/json', timeout: 90000,
            });
            return assertLegacyResponse(json, name);
        }
        function isTargetTagQuantityError(e) {
            var m = errorMessage(e);
            return m.indexOf('"responseStatus":5102') >= 0 || m.indexOf('Not enough Quantity in Target Tag') >= 0;
        }

        // ── Tracking helpers ────────────────────────────────────
        function normalizePartTracking(part) { return ensureArray(part && part.PartTrackingList && part.PartTrackingList.PartTracking); }
        function isSerialPartTracking(pt) {
            if (toNumber(pt && pt.TrackingTypeID, -1) === TRACKING_TYPE_SERIAL) return true;
            return String((pt && pt.Name) || '').trim().toLowerCase().indexOf('serial') >= 0;
        }
        function isDatePartTracking(pt) { return TRACKING_TYPE_DATE.has(toNumber(pt && pt.TrackingTypeID, -1)); }
        function normalizeFishbowlDateTime(value) {
            var raw = String(value == null ? '' : value).trim();
            var m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
            if (m) return m[1] + 'T' + m[2];
            m = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
            if (m) return m[1] + 'T00:00:00';
            m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (m) return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]) + 'T00:00:00';
            return raw;
        }

        var STOCK_SQL_TEMPLATE = "\nSELECT * FROM\n(\nWITH tag_qty AS (\n  SELECT lg.id AS locationgroup_id, l.id AS location_id, l.name AS location_name, l.description AS location_description,\n    l.typeid AS location_type_id, l.sortorder AS location_sort_order, l.pickable AS location_pickable, l.receivable AS location_receivable,\n    l.countedAsAvailable AS location_counted_as_available, p.id AS part_id, p.typeid AS part_type_id, p.uomid AS partuom_id, p.trackingflag, t.trackingEncoding,\n    MIN(t.id) AS tag_id, MIN(t.num) AS tag_num, MIN(t.datecreated) AS tag_datecreated, SUM(t.qty - t.qtycommitted) AS qty_pickable\n  FROM tag t JOIN part p ON p.id = t.partid JOIN location l ON l.id = t.locationid JOIN locationgroup lg ON lg.id = l.locationgroupid\n  WHERE l.pickable = 1 AND l.countedAsAvailable = 1\n    AND lg.id = (SELECT locationgroupid FROM pick WHERE num = $picknum LIMIT 1)\n    AND p.id IN (SELECT DISTINCT pi.partid FROM pick p JOIN pickitem pi ON pi.pickid = p.id AND p.num = $picknum)\n  GROUP BY t.trackingEncoding, t.partID, t.locationID, lg.id, l.id, l.name, l.description, l.typeid, l.sortorder, l.pickable, l.receivable, l.countedAsAvailable, p.id, p.typeid, p.uomid, p.trackingflag\n  HAVING SUM(t.qty - t.qtycommitted) > 0\n),\npickable_stock AS (\n  SELECT tq.*, CASE WHEN tq.trackingflag = 0 THEN NULL ELSE JSON_ARRAYAGG(JSON_OBJECT('PartTrackingID', ttv.parttrackingid, 'Name', ttv.name, 'Abbr', ttv.abbr, 'TrackingTypeID', ttv.typeid, 'TrackingValue', ttv.infoformatted)) END AS tracking_json\n  FROM tag_qty tq LEFT JOIN tagtrackingview ttv ON ttv.tagid = tq.tag_id AND ttv.typeid <> 40\n  GROUP BY tq.locationgroup_id, tq.location_id, tq.location_name, tq.location_description, tq.location_type_id, tq.location_sort_order, tq.location_pickable, tq.location_receivable, tq.location_counted_as_available, tq.part_id, tq.part_type_id, tq.partuom_id, tq.trackingflag, tq.trackingEncoding, tq.tag_id, tq.tag_num, tq.tag_datecreated, tq.qty_pickable\n),\nserial_pool AS (\n  SELECT p.id AS part_id, l.id AS location_id, s.id AS serial_id, t.id AS serial_tag_id, sn.serialNum, sn.partTrackingId, pt.name AS tracking_name, pt.typeid AS tracking_type_id,\n    ROW_NUMBER() OVER (PARTITION BY p.id, l.id ORDER BY s.id) AS rn\n  FROM tag t JOIN part p ON p.id = t.partid JOIN location l ON l.id = t.locationid JOIN locationgroup lg ON lg.id = l.locationgroupid JOIN serial s ON s.tagid = t.id AND s.committedFlag = 0 JOIN serialnum sn ON sn.serialid = s.id LEFT JOIN parttracking pt ON pt.id = sn.parttrackingid\n  WHERE l.pickable = 1 AND l.countedAsAvailable = 1 AND lg.id = (SELECT locationgroupid FROM pick WHERE num = $picknum LIMIT 1) AND p.id IN (SELECT DISTINCT pi.partid FROM pick p2 JOIN pickitem pi ON pi.pickid = p2.id AND p2.num = $picknum)\n)\nSELECT pick.id AS pick_id, pick.num AS pick_num, pick.locationgroupid AS pick_locationgroup_id, pickitem.id AS pickitem_id, pickitem.statusid AS pickitem_status_id, pickitem.soitemid, pickitem.slotnum AS slotnumber, pickitem.uomid AS pickitem_uom_id,\n  part.num AS partnum, part.description, part.trackingflag, part.typeid AS part_type_id, pickitem.qty AS pickitem_qty,\n  ps.tag_id, ps.tag_num, ps.tag_datecreated, ps.location_id, ps.location_name, ps.location_description, ps.location_type_id, ps.location_sort_order, ps.location_pickable, ps.location_receivable, ps.location_counted_as_available,\n  ps.partuom_id AS stock_uom_id, COALESCE(uc.multiply / uc.factor, 1) AS uom_conversion, COALESCE(uc.multiply, 1) AS uom_conversion_multiply, COALESCE(uc.factor, 1) AS uom_conversion_factor,\n  ps.qty_pickable AS qty_available_stock_uom, ps.qty_pickable * COALESCE(uc.multiply / uc.factor, 1) AS qty_available_pick_uom, ps.tracking_json,\n  (SELECT JSON_ARRAYAGG(JSON_OBJECT('SerialID', sp.serial_id, 'TagID', sp.serial_tag_id, 'SerialNum', sp.serialNum, 'PartTrackingID', sp.partTrackingId, 'TrackingName', sp.tracking_name, 'TrackingTypeID', sp.tracking_type_id)) FROM serial_pool sp WHERE sp.part_id = pickitem.partid AND sp.location_id = ps.location_id AND sp.rn <= 1000) AS serial_json,\n  (SELECT l2.id FROM location l2 WHERE l2.locationgroupid = pick.locationgroupid AND l2.typeid = 20 LIMIT 1) AS dest_location_id,\n  (SELECT t2.id FROM tag t2 JOIN location l2 ON l2.id = t2.locationid WHERE l2.locationgroupid = pick.locationgroupid AND l2.typeid = 20 AND t2.typeid = 10 ORDER BY t2.id LIMIT 1) AS dest_tag_id\nFROM pick JOIN pickitem ON pickitem.pickid = pick.id JOIN part ON part.id = pickitem.partid\nLEFT JOIN pickable_stock ps ON ps.part_id = pickitem.partid\nLEFT JOIN uomconversion uc ON uc.toUomId = pickitem.uomid AND uc.fromuomid = ps.partuom_id\nWHERE pick.num = $picknum\nORDER BY pickitem.id, ps.tag_datecreated\n) AS wrapped_for_fishbowl_api";
        function buildStockQuery(pickNum) { return STOCK_SQL_TEMPLATE.split('$picknum').join(sqlString(pickNum)); }
        function normalizeStockRow(row) {
            var next = lc(row);
            ['locationgroup_id','location_id','location_type_id','location_sort_order','location_pickable','location_receivable','location_counted_as_available','part_id','part_type_id','partuom_id','trackingflag','tag_id','tag_num','pick_id','pick_locationgroup_id','pickitem_id','pickitem_status_id','soitemid','slotnumber','pickitem_uom_id','pickitem_qty','stock_uom_id','uom_conversion','uom_conversion_multiply','uom_conversion_factor','qty_available_stock_uom','qty_available_pick_uom','dest_location_id','dest_tag_id'].forEach(function (k) {
                if (next[k] != null && next[k] !== '') { var n = Number(next[k]); if (Number.isFinite(n)) next[k] = n; }
            });
            next.tracking_json = tryParseJsonArray(next.tracking_json).map(function (it) {
                if (!it || it.PartTrackingID == null) return null;
                var v = it.TrackingValue == null ? '' : String(it.TrackingValue).trim();
                if (!v) return null;
                var c = Object.assign({}, it);
                c.TrackingValue = isDatePartTracking(it) ? normalizeFishbowlDateTime(v) : v;
                return c;
            }).filter(Boolean);
            next.serial_json = tryParseJsonArray(next.serial_json);
            return next;
        }

        function normalizePickItems(pick) { return ensureArray(pick && pick.PickItems && pick.PickItems.PickItem); }
        function isActionablePickItem(item) { return ACTIONABLE_STATUSES.has(toNumber(item && item.Status, -1)); }
        function isCommittedPickItemStatus(s) { return COMMITTED_STATUSES.has(toNumber(s, -1)); }
        function isNegativePickItemId(item) { return toNumber(item && item.PickItemID, 0) < 0; }
        function isPickFinished(pick) { return toNumber(pick && pick.StatusID, -1) === 40; }
        function isPartSerialized(part) {
            if (part && part.SerializedFlag === true) return true;
            if (String(part && part.SerializedFlag).toLowerCase() === 'true') return true;
            return normalizePartTracking(part).some(isSerialPartTracking);
        }

        function gcd(a, b) { var l = Math.abs(a), r = Math.abs(b); while (r !== 0) { var n = l % r; l = r; r = n; } return l || 1; }
        function deriveFraction(value) {
            var n = toNumber(value, NaN);
            if (!Number.isFinite(n) || n <= 0) return { multiply: 1, factor: 1 };
            var scaled = Math.round(n * FRACTION_SCALE);
            if (scaled <= 0) return { multiply: 1, factor: 1 };
            var d = gcd(scaled, FRACTION_SCALE);
            return { multiply: scaled / d, factor: FRACTION_SCALE / d };
        }
        function posInt(v, f) { var n = toNumber(v, NaN); return (Number.isInteger(n) && n > 0) ? n : f; }
        function getConversionParts(row) {
            var m = posInt(row && row.uom_conversion_multiply, null), f = posInt(row && row.uom_conversion_factor, null);
            if (m != null && f != null) return { multiply: m, factor: f };
            return deriveFraction(row && row.uom_conversion != null ? row.uom_conversion : 1);
        }
        function stockFromPickUnits(units, c) { var u = Math.max(0, Math.floor(toNumber(units, 0))); return u < 1 ? 0 : roundStock((u * c.factor) / c.multiply); }
        function stockFromPickQty(q, c) { var s = Math.max(0, toNumber(q, 0)); return s <= 0 ? 0 : roundStock((s * c.factor) / c.multiply); }
        function wholePickFromStock(stockQty, c) { var s = roundStock(stockQty); return Math.max(0, Math.floor((s * c.multiply) / c.factor + EPSILON)); }
        function dateKey(v) { if (v == null || v === '') return Number.MAX_SAFE_INTEGER; var t = new Date(v).getTime(); return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER; }
        function poolKey(c) { var part = c && (c.part_id != null ? c.part_id : c.partnum); return String(part == null ? '?' : part) + '|' + String(c && c.tag_id); }
        function buildPool(rows) {
            var pool = new Map();
            rows.forEach(function (r) {
                if (r.tag_id == null) return;
                var k = poolKey(r), q = roundStock(r.qty_available_stock_uom);
                pool.set(k, Math.max(pool.has(k) ? roundStock(pool.get(k)) : 0, q));
            });
            return pool;
        }
        function commitToPool(allocs, pool) {
            (allocs || []).forEach(function (a) {
                var k = poolKey(a); var cur = roundStock(pool.get(k));
                pool.set(k, roundStock(cur - toNumber(a.qty_to_commit_stock_uom, 0)));
            });
        }
        function stripPrivate(c) { var r = {}; Object.keys(c || {}).forEach(function (k) { if (!k.startsWith('_')) r[k] = c[k]; }); return r; }
        function compareCandidates(a, b, mode) {
            if (a._dateKey !== b._dateKey) return mode === 'lifo' ? b._dateKey - a._dateKey : a._dateKey - b._dateKey;
            var at = toNumber(a.tag_id, 0), bt = toNumber(b.tag_id, 0);
            return mode === 'lifo' ? bt - at : at - bt;
        }
        function baseResult(item, row) {
            return {
                pick_id: toNumber(row && row.pick_id, 0),
                pick_locationgroup_id: toNumber(row && row.pick_locationgroup_id, 0),
                pickitem_id: toNumber(item && item.PickItemID, 0),
                pickitem_status_id: toNumber(item && item.Status, -1),
                partnum: String((item && item.Part && item.Part.Num) || (row && row.partnum) || ''),
                allocations: [],
            };
        }
        function failureResult(item, lineRows, reason) {
            var row = lineRows[0] || {}, conv = getConversionParts(row);
            var reqPick = Math.max(0, toNumber(item && item.Quantity, toNumber(row.pickitem_qty, 0)));
            var r = baseResult(item, row);
            r.requiredPickUom = reqPick; r.allocatedPickUom = 0; r.shortfallPickUom = reqPick;
            r.requiredStockUom = stockFromPickQty(reqPick, conv); r.allocatedStockUom = 0;
            r.fullyFulfilled = false; r.shortfallStockUom = r.requiredStockUom; r.failureReason = reason;
            return r;
        }
        function autoFulfillResult(item, lineRows) {
            var row = lineRows[0] || {};
            var reqPick = Math.max(0, toNumber(item && item.Quantity, toNumber(row.pickitem_qty, 0)));
            var r = baseResult(item, row);
            r.requiredPickUom = reqPick; r.allocatedPickUom = reqPick; r.shortfallPickUom = 0;
            r.requiredStockUom = reqPick; r.allocatedStockUom = reqPick;
            r.fullyFulfilled = true; r.shortfallStockUom = 0; r.failureReason = null; r.autoFulfill = true;
            return r;
        }
        function allocateRegular(item, lineRows, pool, mode) {
            if (!lineRows.length) return failureResult(item, lineRows, 'NO_STOCK_THIS_LOCATION');
            var row = lineRows[0], conv = getConversionParts(row);
            var reqPick = Math.max(0, toNumber(item.Quantity, row.pickitem_qty || 0));
            var reqStock = stockFromPickQty(reqPick, conv);
            if (reqPick <= EPSILON) return failureResult(item, lineRows, 'SUB_MINIMUM');
            var dedup = new Map();
            lineRows.forEach(function (rw) {
                if (rw.tag_id == null) return;
                var k = poolKey(rw);
                var availStock = roundStock(Math.min(roundStock(pool.get(k)), roundStock(rw.qty_available_stock_uom)));
                if (availStock <= EPSILON) return;
                if (!dedup.has(k) || availStock > dedup.get(k)._availStock + EPSILON) {
                    dedup.set(k, Object.assign({}, rw, { _poolKey: k, _availStock: availStock, _dateKey: dateKey(rw.tag_datecreated) }));
                }
            });
            var candidates = Array.from(dedup.values()).sort(function (a, b) { return compareCandidates(a, b, mode); });
            var allocations = [], remaining = reqPick, allocPick = 0, allocStock = 0;
            candidates.forEach(function (c) {
                if (remaining <= EPSILON) return;
                var availPick = roundStock(c._availStock * conv.multiply / conv.factor);
                var takePick = roundStock(Math.min(remaining, availPick));
                if (takePick <= EPSILON) return;
                var takeStock = stockFromPickQty(takePick, conv);
                if (takeStock > c._availStock + EPSILON) takeStock = c._availStock;
                remaining = roundStock(remaining - takePick);
                allocPick = roundStock(allocPick + takePick);
                allocStock = roundStock(allocStock + takeStock);
                allocations.push(Object.assign({}, stripPrivate(c), { qty_to_commit_stock_uom: takeStock, qty_to_commit_pick_uom: takePick }));
            });
            commitToPool(allocations, pool);
            var r = baseResult(item, row);
            r.requiredPickUom = reqPick; r.allocatedPickUom = allocPick; r.shortfallPickUom = Math.max(roundStock(reqPick - allocPick), 0);
            r.requiredStockUom = reqStock; r.allocatedStockUom = allocStock; r.allocations = allocations;
            r.fullyFulfilled = allocPick >= reqPick - EPSILON; r.shortfallStockUom = roundStock(reqStock - allocStock);
            r.failureReason = r.fullyFulfilled ? null : (allocations.length ? 'INSUFFICIENT_STOCK' : 'NO_STOCK_THIS_LOCATION');
            return r;
        }
        function serialKey(pickItemId, row, serial) {
            return [pickItemId,
                serial && serial.SerialID != null ? serial.SerialID : '',
                serial && serial.TagID != null ? serial.TagID : (row && row.tag_id != null ? row.tag_id : ''),
                serial && serial.SerialNum != null ? serial.SerialNum : ''].join('::');
        }
        function allocateSerialized(item, lineRows, pool, mode, selectedSerialKeys) {
            if (!lineRows.length) return failureResult(item, lineRows, 'NO_STOCK_THIS_LOCATION');
            var reqPick = Math.max(0, toNumber(item.Quantity, lineRows[0].pickitem_qty || 0));
            var targetWhole = Math.max(0, Math.floor(reqPick + EPSILON));
            var buckets = new Map();
            // DEVIATION from the verbatim WO_WIP engine (bug fix): the stock query
            // aggregates serial_json per part+LOCATION, so when a part has more than
            // one tag in the same location every stock row carries the identical
            // serial list. The original loop matched a selected serial once per
            // duplicate row → allocPick was inflated (e.g. 1 picked serial counted
            // twice) → a false "Too many serials selected" blocker. Dedupe each
            // selected serial by its key so it's counted once, and attribute it to
            // its OWN tag's stock row (rowByTag) so the committed SavePick decrements
            // the correct source tag.
            var consumed = new Set(), rowByTag = new Map();
            lineRows.forEach(function (row) { var tk = String(row.tag_id); if (!rowByTag.has(tk)) rowByTag.set(tk, row); });
            lineRows.forEach(function (row) {
                ensureArray(row.serial_json).forEach(function (serial) {
                    var k = serialKey(item.PickItemID, row, serial);
                    if (!selectedSerialKeys.has(k) || consumed.has(k)) return;
                    consumed.add(k);
                    var tgtRow = rowByTag.get(String(serial.TagID)) || row;
                    var bk = poolKey(tgtRow) + '|' + tgtRow.location_id;
                    if (!buckets.has(bk)) buckets.set(bk, { row: tgtRow, serials: [] });
                    buckets.get(bk).serials.push(serial);
                });
            });
            var allocations = [], allocPick = 0, allocStock = 0;
            buckets.forEach(function (b) {
                var conv = getConversionParts(b.row), qty = b.serials.length;
                if (qty < 1) return;
                var st = stockFromPickUnits(qty, conv);
                allocations.push(Object.assign({}, b.row, { serial_json: b.serials, qty_to_commit_stock_uom: st, qty_to_commit_pick_uom: qty }));
                allocPick += qty; allocStock = roundStock(allocStock + st);
            });
            commitToPool(allocations, pool);
            var row = lineRows[0], conv = getConversionParts(row), reqStock = stockFromPickQty(reqPick, conv);
            var reason = null;
            if (allocPick > targetWhole) reason = 'TOO_MANY_SERIALS';
            else if (allocPick === 0) reason = 'SELECT_SERIALS';
            else if (allocPick < reqPick) reason = 'PARTIAL_SERIAL_SELECTION';
            var r = baseResult(item, row);
            r.requiredPickUom = reqPick; r.allocatedPickUom = allocPick; r.shortfallPickUom = Math.max(reqPick - allocPick, 0);
            r.requiredStockUom = reqStock; r.allocatedStockUom = allocStock; r.allocations = allocations;
            r.fullyFulfilled = allocPick >= reqPick && allocPick <= targetWhole; r.shortfallStockUom = roundStock(reqStock - allocStock);
            r.failureReason = reason; r.serialized = true;
            return r;
        }
        function classifyPartType(item, lineRows) {
            var t = lineRows.length ? toNumber(lineRows[0].part_type_id, INVENTORY_PART_TYPE) : INVENTORY_PART_TYPE;
            return t;
        }
        function buildLineResults(pick, stockRows, mode, selectedSerialKeys) {
            if (!pick) return [];
            var rowsByItem = new Map();
            stockRows.forEach(function (r) { if (!rowsByItem.has(r.pickitem_id)) rowsByItem.set(r.pickitem_id, []); rowsByItem.get(r.pickitem_id).push(r); });
            var pool = buildPool(stockRows.filter(function (r) { return ACTIONABLE_STATUSES.has(toNumber(r.pickitem_status_id, -1)); }));
            var items = normalizePickItems(pick).filter(isActionablePickItem).sort(function (a, b) {
                var d = toNumber(a.Status, 999) - toNumber(b.Status, 999);
                return d !== 0 ? d : toNumber(a.PickItemID, 0) - toNumber(b.PickItemID, 0);
            });
            return items.map(function (item) {
                var rows = rowsByItem.get(toNumber(item.PickItemID, 0)) || [];
                var partType = classifyPartType(item, rows);
                if (partType !== INVENTORY_PART_TYPE) return autoFulfillResult(item, rows);
                return isPartSerialized(item.Part) ? allocateSerialized(item, rows, pool, mode, selectedSerialKeys || new Set())
                                                   : allocateRegular(item, rows, pool, mode);
            });
        }
        function collectBlockers(lineResults) {
            var msgs = [];
            lineResults.forEach(function (l) {
                if (l.fullyFulfilled) return;
                if (l.failureReason === 'SELECT_SERIALS') msgs.push(l.partnum + ': serials must be selected');
                else if (l.failureReason === 'PARTIAL_SERIAL_SELECTION') msgs.push(l.partnum + ': not enough serials selected');
                else if (l.failureReason === 'TOO_MANY_SERIALS') msgs.push(l.partnum + ': too many serials selected');
                else msgs.push(l.partnum + ': short ' + fmtQty(l.shortfallPickUom) + ' (only ' + fmtQty(l.allocatedPickUom) + ' of ' + fmtQty(l.requiredPickUom) + ')');
            });
            return msgs;
        }
        // A line's failure that is PURELY a raw-goods shortage — overridable when the
        // admin has allowed finishing short. Serial/tracking failures (SELECT_SERIALS,
        // PARTIAL_SERIAL_SELECTION, TOO_MANY_SERIALS) and SUB_MINIMUM are NEVER
        // overridable and always hard-block.
        function isShortageReason(reason) {
            return reason === 'INSUFFICIENT_STOCK' || reason === 'NO_STOCK_THIS_LOCATION';
        }

        function findPartTracking(part, ti) {
            var pts = normalizePartTracking(part);
            return pts.find(function (pt) { return Number(pt.PartTrackingID) === Number(ti && ti.PartTrackingID); }) ||
                   pts.find(function (pt) { return pt.Name === (ti && ti.Name); }) ||
                   pts.find(function (pt) { return pt.Abbr === (ti && ti.Abbr); }) || null;
        }
        function buildTrackingBlock(part, trackingJson) {
            if (!Array.isArray(trackingJson) || !trackingJson.length) return '';
            var items = trackingJson.map(function (te) {
                var pt = findPartTracking(part, te);
                var raw = te && te.TrackingValue == null ? '' : String(te.TrackingValue).trim();
                var val = isDatePartTracking(pt || te) ? normalizeFishbowlDateTime(raw) : raw;
                if (!pt || !val) return null;
                return { PartTracking: pt, TrackingValue: val };
            }).filter(Boolean);
            return items.length ? { TrackingItem: items } : '';
        }
        function findSerialPartTracking(part, entries) {
            for (var i = 0; i < entries.length; i++) {
                var c = findPartTracking(part, { PartTrackingID: entries[i].PartTrackingID, Name: entries[i].TrackingName });
                if (c) return c;
            }
            return normalizePartTracking(part).find(isSerialPartTracking) || null;
        }
        function normalizeSerialEntries(serialJson) {
            return tryParseJsonArray(serialJson).map(function (r) {
                return { SerialNum: String((r && (r.SerialNum || r.Number)) || '').trim(),
                         TagID: r && r.TagID, PartTrackingID: r && r.PartTrackingID, TrackingName: r && r.TrackingName };
            }).filter(function (r) { return r.SerialNum; });
        }
        function serialBoxFor(partTracking, serialNum) {
            return { Committed: false, SerialID: -1,
                     SerialNumList: { SerialNum: [{ Number: serialNum, PartTracking: deepClone(partTracking), SerialID: -1, SerialNumID: -1 }] },
                     TagID: -1 };
        }
        function buildSerialTrackingItem(part, allocation) {
            var entries = normalizeSerialEntries(allocation && allocation.serial_json);
            if (!entries.length) return null;
            var pt = findSerialPartTracking(part, entries);
            if (!pt) return null;
            var required = Math.max(0, Math.floor(toNumber(allocation && allocation.qty_to_commit_pick_uom, 0)));
            if (required < 1) return null;
            var tagId = toNumber(allocation && allocation.tag_id, NaN);
            var prioritized = entries;
            if (Number.isFinite(tagId)) {
                prioritized = entries.filter(function (e) { return toNumber(e.TagID, NaN) === tagId; })
                    .concat(entries.filter(function (e) { return toNumber(e.TagID, NaN) !== tagId; }));
            }
            var selected = [], seen = new Set();
            for (var i = 0; i < prioritized.length && selected.length < required; i++) {
                if (seen.has(prioritized[i].SerialNum)) continue;
                seen.add(prioritized[i].SerialNum); selected.push(prioritized[i]);
            }
            if (!selected.length) return null;
            return { PartTracking: deepClone(pt),
                     SerialBoxList: { SerialBox: selected.map(function (s) { return serialBoxFor(pt, s.SerialNum); }) },
                     TrackingValue: '' };
        }
        function buildTrackingForAllocation(part, allocation) {
            var base = buildTrackingBlock(part, allocation && allocation.tracking_json);
            var baseItems = Array.isArray(base && base.TrackingItem) ? base.TrackingItem.slice() : [];
            var serialItem = buildSerialTrackingItem(part, allocation);
            if (!serialItem) return baseItems.length ? { TrackingItem: baseItems } : '';
            var sid = toNumber(serialItem.PartTracking && serialItem.PartTracking.PartTrackingID, NaN);
            var nonSerial = baseItems.filter(function (it) {
                var pt = it && it.PartTracking, pid = toNumber(pt && pt.PartTrackingID, NaN);
                if (Number.isFinite(sid) && pid === sid) return false;
                return !isSerialPartTracking(pt);
            });
            return { TrackingItem: nonSerial.concat([serialItem]) };
        }
        function sanitizeTrackingBlock(part, tracking) {
            var items = ensureArray(tracking && tracking.TrackingItem);
            if (!items.length) return '';
            var out = items.map(function (ti) {
                if (!ti) return null;
                var it = deepClone(ti);
                var pt = it.PartTracking || findPartTracking(part, it);
                if (it.SerialBoxList || isSerialPartTracking(pt)) return it;
                var raw = it.TrackingValue == null ? '' : String(it.TrackingValue).trim();
                var val = isDatePartTracking(pt) ? normalizeFishbowlDateTime(raw) : raw;
                if (!val) return null;
                it.TrackingValue = val; return it;
            }).filter(Boolean);
            return out.length ? { TrackingItem: out } : '';
        }
        function sanitizePreservedPickItem(item) { var n = deepClone(item); n.Tracking = sanitizeTrackingBlock(n.Part, n.Tracking); return n; }
        function buildLocationForAllocation(base, a, lgId) {
            var l = deepClone(base || {});
            l.LocationID = a.location_id; l.Name = a.location_name || l.Name || ''; l.Description = a.location_description || l.Description || '';
            l.TypeID = a.location_type_id || l.TypeID || 10; l.SortOrder = a.location_sort_order || l.SortOrder || 0;
            l.Pickable = a.location_pickable == null ? (l.Pickable == null ? true : l.Pickable) : a.location_pickable;
            l.Receivable = a.location_receivable == null ? (l.Receivable == null ? true : l.Receivable) : a.location_receivable;
            l.CountedAsAvailable = a.location_counted_as_available == null ? (l.CountedAsAvailable == null ? true : l.CountedAsAvailable) : a.location_counted_as_available;
            l.LocationGroupID = lgId || l.LocationGroupID || 0;
            return l;
        }
        function buildSourceTag(base, part, location, a) {
            var t = deepClone(base || {});
            t.AccountID = t.AccountID == null ? -1 : t.AccountID;
            t.TagID = a.tag_id; t.Num = a.tag_num != null ? String(a.tag_num) : String(a.tag_id == null ? '' : a.tag_id);
            t.PartNum = (part && part.Num) || t.PartNum || '';
            if (part && part.PartID != null) t.PartID = part.PartID;
            t.Quantity = toQuantityString(a.qty_to_commit_pick_uom); t.QuantityCommitted = toQuantityString(a.qty_to_commit_pick_uom);
            t.TypeID = 30; t.Location = deepClone(location || {});
            return t;
        }
        function residualItem(orig, committed) {
            var origQty = Number(orig.Quantity || 0), remaining = origQty - committed;
            if (!Number.isFinite(remaining) || remaining <= 0) return null;
            var item = deepClone(orig);
            item.PickItemID = 0; item.Status = 5; item.Quantity = toQuantityString(remaining);
            item.SourceTagID = 0; item.Tracking = '';
            delete item.Location;
            item.Tag = { AccountID: -1, QuantityCommitted: '0',
                Location: { Active: true, CountedAsAvailable: true, Description: '', LocationGroupID: 0, LocationGroupName: '',
                            LocationID: 0, Name: '', ParentID: 0, Pickable: true, Receivable: true, SortOrder: 0,
                            TagID: -1, TagNumber: -1, TypeID: 0 },
                PartNum: '', Quantity: '0', TypeID: 30 };
            return item;
        }
        function splitPickItem(orig, pick, line, statusId, destMode) {
            var items = [], allocs = line.allocations || [], committed = 0;
            for (var i = 0; i < allocs.length; i++) {
                var a = allocs[i], item = deepClone(orig);
                var origId = toNumber(orig && orig.PickItemID, 0);
                item.PickItemID = i === 0 ? (origId > 0 ? origId : 0) : 0;
                item.Status = statusId; item.Quantity = toQuantityString(a.qty_to_commit_pick_uom);
                committed += Number(a.qty_to_commit_pick_uom || 0);
                item.Location = buildLocationForAllocation(orig.Location, a, pick.LocationGroupID);
                item.Tracking = buildTrackingForAllocation(orig.Part, a);
                item.Tag = buildSourceTag(item.Tag, item.Part, item.Location, a);
                if (item.DestinationTag && item.DestinationTag.Tag) {
                    item.DestinationTag.Tag.Num = destMode === 'new' ? '-1' : String(orig.DestinationTag.Tag.Num == null ? '' : orig.DestinationTag.Tag.Num);
                    if (a.dest_location_id != null) { item.DestinationTag.Tag.Location = item.DestinationTag.Tag.Location || {}; item.DestinationTag.Tag.Location.LocationID = a.dest_location_id; }
                    if (a.dest_tag_id != null) item.DestinationTag.Tag.TagID = a.dest_tag_id;
                }
                items.push(item);
            }
            if (statusId !== 40) { var res = residualItem(orig, committed); if (res) items.push(res); }
            return items;
        }
        function buildStartSavePick(pick) {
            var n = deepClone(pick);
            normalizePickItems(n).forEach(function (it) { it.Status = 20; it.Tracking = sanitizeTrackingBlock(it.Part, it.Tracking); });
            n.StatusID = 20;
            return { Pick: n };
        }
        function buildCommitSavePick(pick, lineResults, options) {
            var n = deepClone(pick), pickItems = normalizePickItems(n), lineMap = new Map();
            lineResults.forEach(function (l) { lineMap.set(Number(l.pickitem_id), l); });
            var includeUnallocated = options.statusId !== 40, out = [];
            for (var i = 0; i < pickItems.length; i++) {
                var item = pickItems[i], line = lineMap.get(Number(item.PickItemID));
                if (line && line.autoFulfill) {
                    var auto = sanitizePreservedPickItem(item); auto.Status = options.statusId; out.push(auto); continue;
                }
                if (!line || !line.allocations || !line.allocations.length) {
                    var preserve = isCommittedPickItemStatus(item && item.Status);
                    if (includeUnallocated || preserve) {
                        if (isNegativePickItemId(item)) continue;
                        var preserved = sanitizePreservedPickItem(item);
                        if (options.statusId === 40 && toNumber(preserved.Status, -1) === 30) {
                            preserved.Status = 40;
                        }
                        out.push(preserved);
                    }
                    continue;
                }
                Array.prototype.push.apply(out, splitPickItem(item, n, line, options.statusId, options.destinationTagNumMode));
            }
            n.PickItems = { PickItem: out };
            if (options.statusId === 40) n.StatusID = 40;
            return { Pick: n };
        }
        async function savePickWithRetry(pick, lineResults, payload) {
            try { await legacyRequest('SavePickRq', payload); return; }
            catch (e) {
                if (!isTargetTagQuantityError(e)) throw e;
                var retry = buildCommitSavePick(pick, lineResults, { statusId: 40, destinationTagNumMode: 'current' });
                await legacyRequest('SavePickRq', retry);
            }
        }

        function findFinishedGoodItem(wo) {
            var items = ensureArray(wo && wo.WOItems && wo.WOItems.WOItem);
            return items.find(function (wi) { return toNumber(wi.TypeID, -1) === 10; }) || null;
        }
        function planFgTracking(fgPart) {
            var plan = { batch: '', useby: '', serials: [], required: [], hasSerial: false, hasDate: false, hasBatch: false };
            var defs = normalizePartTracking(fgPart);
            defs.forEach(function (def) {
                if (isSerialPartTracking(def)) { plan.hasSerial = true; plan.required.push({ kind: 'serial', def: def }); }
                else if (isDatePartTracking(def)) { plan.hasDate = true; plan.required.push({ kind: 'date', def: def }); }
                else { plan.hasBatch = true; plan.required.push({ kind: 'text', def: def }); }
            });
            return plan;
        }
        function buildFgTrackingBlock(fgPart, fgDefs) {
            var partDefs = normalizePartTracking(fgPart);
            if (!Array.isArray(fgDefs) || !fgDefs.length) return '';
            var items = [];
            fgDefs.forEach(function (d) {
                var pt = partDefs.find(function (p) { return Number(p.PartTrackingID) === Number(d.partTrackingId); });
                if (!pt) return;
                if (d.isSerial) {
                    var arr = Array.isArray(d.value) ? d.value : [];
                    if (!arr.length) return;
                    items.push({
                        PartTracking: deepClone(pt),
                        SerialBoxList: { SerialBox: arr.map(function (s) { return serialBoxFor(pt, s); }) },
                        TrackingValue: '',
                    });
                } else if (d.isDate) {
                    if (!d.value) return;
                    items.push({ PartTracking: deepClone(pt), TrackingValue: normalizeFishbowlDateTime(String(d.value)) });
                } else {
                    if (d.value == null || String(d.value) === '') return;
                    items.push({ PartTracking: deepClone(pt), TrackingValue: String(d.value) });
                }
            });
            return items.length ? { TrackingItem: items } : '';
        }
        function computeBatch(woRow) {
            switch (CFG.batchRule) {
                case 'mo':       return woRow.mo_num || woRow.wo_num;
                case 'date':     return todayCompact();
                case 'prefixwo': return (CFG.batchPrefix || '') + woRow.wo_num;
                case 'blank':    return '';
                default:         return woRow.wo_num;
            }
        }
        function computeUseBy() {
            if (CFG.useByRule === 'days') return isoDatePlusDays(CFG.shelfDays);
            return '';
        }
        // usedByWoItem: [{ woItemId, partId, partNum, qty }] — the consumed (Used) qty
        // for the NON-inventory raw lines (labour/service/overhead/internal-use/non-
        // inventory). Those parts aren't consumed through a pick, so Fishbowl won't
        // populate their QtyUsed on finish — every such line's consumed qty (target by
        // default, or the operator's value) is set directly on the woitem here.
        //
        // MATCHING: the legacy GetWorkOrderRs WOItem shape is not guaranteed (the id
        // field name in particular varies), so each override is indexed by woitem id,
        // part id AND part number, and each WOItem is matched against all three in turn
        // — whichever the payload actually carries wins. The FG line proves SaveWorkOrder
        // honours a QtyUsed we send (it's matched purely by TypeID===10, no id needed),
        // so a labour line finishing at 0 means the id match failed — hence the fall-
        // through to part number, plus a diagnostic that dumps the real WOItem keys when
        // nothing matches (visible with the debug console open). Inventory lines are NOT
        // in this list — their Used comes from the pick (applyUsedOverrides).
        function buildCompleteWorkOrder(wo, fgDefs, usedByWoItem) {
            var n = deepClone(wo), now = nowFishbowl();
            n.DateScheduled = n.DateScheduled || now;
            n.DateScheduledToStart = n.DateScheduledToStart || now;
            n.StatusID = 40;
            var usedById = {}, usedByPart = {}, usedByPartNum = {};
            (usedByWoItem || []).forEach(function (o) {
                if (o == null || o.qty == null) return;
                if (o.woItemId != null) usedById[String(o.woItemId)] = o.qty;
                if (o.partId != null)   usedByPart[String(o.partId)] = o.qty;
                if (o.partNum)          usedByPartNum[String(o.partNum).toLowerCase()] = o.qty;
            });
            var haveOverrides = Object.keys(usedById).length || Object.keys(usedByPart).length || Object.keys(usedByPartNum).length;
            var diag = haveOverrides && (_diag);
            var items = ensureArray(n.WOItems && n.WOItems.WOItem);
            items.forEach(function (wi) {
                if (toNumber(wi.TypeID, -1) === 10) {
                    var qty = wi.QtyTarget != null ? wi.QtyTarget : (wi.QtyToFulfill != null ? wi.QtyToFulfill : wi.QtyUsed);
                    wi.QtyUsed = toQuantityString(qty);
                    var tracking = buildFgTrackingBlock(wi.Part, fgDefs || []);
                    if (tracking) wi.Tracking = tracking;
                } else {
                    // Raw-material line: apply the non-inventory consumed qty (Used) sent
                    // for this line. Match on woitem id → part id → part number, trying
                    // every field-name variant, so an unknown WOItem shape still resolves.
                    var idA  = toNumber(wi.WOItemID, 0) || toNumber(wi.WoItemID, 0) || toNumber(wi.WoItemId, 0) || toNumber(wi.Id, 0) || toNumber(wi.ID, 0);
                    var pid  = toNumber(wi.PartID, 0) || (wi.Part ? toNumber(wi.Part.PartID, 0) : 0);
                    var pnum = (wi.PartNum != null ? String(wi.PartNum) : (wi.Part && wi.Part.Num != null ? String(wi.Part.Num) : '')).toLowerCase();
                    var ov   = (idA && usedById[String(idA)] != null) ? usedById[String(idA)]
                             : (pid && usedByPart[String(pid)] != null) ? usedByPart[String(pid)]
                             : (pnum && usedByPartNum[pnum] != null) ? usedByPartNum[pnum] : null;
                    if (ov != null) {
                        var ovStr = toQuantityString(ov);
                        // On the finish (status→40) save, Fishbowl RECOMPUTES a non-inventory
                        // (labour/service/overhead) line's consumed qtyUsed to ITS TARGET
                        // (QtyToFulfill) — overwriting a committed value AND ignoring the
                        // QtyUsed / OriginalQtyToFulfill we send. DB-PROVEN via WO 1002 debug
                        // trace: pre-store persisted qtyUsed=3 (READ-BACK confirmed) and the
                        // fulfilling save sent QtyUsed=3 + OriginalQtyToFulfill=3, yet the DB
                        // landed at target 1 = QtyToFulfill.
                        // So the ONLY way to make it consume the override is to set the TARGET
                        // itself: write QtyToFulfill = the override so the recompute lands there.
                        // This DOES change the line's planned target to the override value
                        // (used == target on the finished line) — the accepted trade-off (the
                        // finish can't hold used ≠ target for a labour line via this API).
                        // Only lines the operator actually overrode reach here (a blank Used
                        // resolves to the existing target, so ovStr == target and this is inert).
                        wi.QtyToFulfill = ovStr;
                        if (wi.OriginalQtyToFulfill != null) wi.OriginalQtyToFulfill = ovStr;
                        wi.QtyUsed = ovStr;
                        if (diag) _diag('Finish: set WOItem "' + (pnum || idA || pid) + '" QtyToFulfill=' + ovStr + ' + QtyUsed=' + ovStr + ' (typeid ' + toNumber(wi.TypeID, -1) + '; target set to override so the finish recompute lands on it)');
                    } else if (diag) {
                        _diag('Finish: WOItem typeid ' + toNumber(wi.TypeID, -1) + ' id=' + idA + ' pid=' + pid + ' num="' + pnum + '" — no Used override matched; keys=' + JSON.stringify(Object.keys(wi)));
                    }
                }
            });
            n.WOItems = { WOItem: items };
            return { WO: n };
        }

        // Stamp non-inventory (labour/service/overhead/…) consumed quantities onto the
        // woitem WHILE THE WO IS STILL OPEN, via a status-preserving SaveWorkOrderRq.
        // This is HALF of the override: on finish Fishbowl recomputes a labour line's
        // consumed qty from its OriginalQtyToFulfill, so the override only sticks when
        // BOTH this open pre-store (QtyUsed) AND the OriginalQtyToFulfill write on the
        // fulfilling save (buildCompleteWorkOrder) are done — DB-proven WO 220 (both →
        // qtyUsed=2 kept) vs WO 225 (pre-store but no OriginalQtyToFulfill → recomputed
        // back to target). Matched by woitem id → part id → part number: two labour
        // lines can share the same part, so the id match is what distinguishes them.
        // Leaves StatusID, QtyToFulfill/QtyTarget and the FG line(s) untouched. Throws
        // on a failed save so the finish aborts before anything irreversible (no pick
        // committed yet). NOTE: forcing a labour line to exactly 0 (full under-consume)
        // is unconfirmed — a stored 0 may read as "unset"; only non-zero overrides are proven.
        async function preStoreLabourUsed(woRow, woItemUsed) {
            var getRs = await legacyRequest('GetWorkOrderRq', { WorkOrderNumber: woRow.wo_num });
            var wo = getRs.WO || getRs.Wo || getRs.WorkOrder;
            if (!wo) throw new Error('GetWorkOrderRs did not include a WO (pre-store labour used).');
            if (toNumber(wo.StatusID, 0) === 40) return;   // already fulfilled — can't pre-store
            var usedById = {}, usedByPart = {}, usedByPartNum = {};
            (woItemUsed || []).forEach(function (o) {
                if (o == null || o.qty == null) return;
                if (o.woItemId != null) usedById[String(o.woItemId)] = o.qty;
                if (o.partId != null)   usedByPart[String(o.partId)] = o.qty;
                if (o.partNum)          usedByPartNum[String(o.partNum).toLowerCase()] = o.qty;
            });
            var items = ensureArray(wo.WOItems && wo.WOItems.WOItem);
            var touched = 0;
            items.forEach(function (wi) {
                if (toNumber(wi.TypeID, -1) === 10) return;   // finished good — not here
                var idA  = toNumber(wi.WOItemID, 0) || toNumber(wi.WoItemID, 0) || toNumber(wi.WoItemId, 0) || toNumber(wi.Id, 0) || toNumber(wi.ID, 0);
                var pid  = toNumber(wi.PartID, 0) || (wi.Part ? toNumber(wi.Part.PartID, 0) : 0);
                var pnum = (wi.PartNum != null ? String(wi.PartNum) : (wi.Part && wi.Part.Num != null ? String(wi.Part.Num) : '')).toLowerCase();
                var ov   = (idA && usedById[String(idA)] != null) ? usedById[String(idA)]
                         : (pid && usedByPart[String(pid)] != null) ? usedByPart[String(pid)]
                         : (pnum && usedByPartNum[pnum] != null) ? usedByPartNum[pnum] : null;
                if (ov != null) {
                    var ovs = toQuantityString(ov);
                    // Set the TARGET (QtyToFulfill) — this is the value the finish's
                    // status→40 recompute reads to derive qtyUsed. Committing it HERE, in
                    // this earlier open save (before the pick + fulfilling save), is what
                    // makes the recompute land on the override (DB-proven WO 1004: setting
                    // it only on the fulfilling save was too late — used stayed at the old
                    // target). QtyUsed is set too (harmless; the finish overwrites it from
                    // the target). This DOES move the line's planned target to the override
                    // — the accepted trade-off; a labour finish can't hold used ≠ target.
                    wi.QtyToFulfill = ovs;
                    if (wi.OriginalQtyToFulfill != null) wi.OriginalQtyToFulfill = ovs;
                    wi.QtyUsed = ovs;
                    touched++;
                }
            });
            if (!touched) return;
            wo.WOItems = { WOItem: items };
            if (_diag) {
                _diag('Finish pre-store labour ' + woRow.wo_num + ' (sending target/used, WO status ' + toNumber(wo.StatusID, -1) + '): ' + items
                    .filter(function (wi) { return toNumber(wi.TypeID, -1) !== 10; })
                    .map(function (wi) {
                        var _pn = (wi.PartNum != null ? wi.PartNum : (wi.Part && wi.Part.Num) || '?');
                        return _pn + '=' + wi.QtyToFulfill + '/' + wi.QtyUsed;
                    }).join(', '));
            }
            await legacyRequest('SaveWorkOrderRq', { WO: wo });
            // Read the WO straight back so the debug console SHOWS whether the labour
            // qtyUsed actually persisted (the crux — a save on a still-Entered WO can
            // silently drop it). If the read-back doesn't match what we sent, the
            // pre-store isn't sticking and the ordering/status needs another look.
            if (_diag) {
                try {
                    var chkRs = await legacyRequest('GetWorkOrderRq', { WorkOrderNumber: woRow.wo_num });
                    var chk = chkRs.WO || chkRs.Wo || chkRs.WorkOrder;
                    var chkItems = ensureArray(chk && chk.WOItems && chk.WOItems.WOItem);
                    _diag('Finish pre-store READ-BACK ' + woRow.wo_num + ' (persisted target/used, WO status ' + toNumber(chk && chk.StatusID, -1) + '): ' + chkItems
                        .filter(function (wi) { return toNumber(wi.TypeID, -1) !== 10; })
                        .map(function (wi) {
                            var _pn = (wi.PartNum != null ? wi.PartNum : (wi.Part && wi.Part.Num) || '?');
                            return _pn + '=' + wi.QtyToFulfill + '/' + wi.QtyUsed;
                        }).join(', '));
                } catch (_) {}
            }
        }

        function fgExistingLocationId(fgItem) {
            var loc = fgItem && (fgItem.Location || fgItem.DestinationLocation);
            return loc ? toNumber(loc.LocationID, 0) : 0;
        }
        async function resolveFgLocationId(woRow, fgItem) {
            var existing = fgExistingLocationId(fgItem);
            if (existing > 0) return existing;
            var lg = toNumber(woRow.locationgroupid, 0);
            if (!lg || !woRow.fg_part) return 0;
            var sql = 'SELECT * FROM (SELECT dl.locationId AS default_loc FROM defaultlocation dl JOIN part p ON p.id=dl.partId' +
                      ' WHERE p.num=' + sqlString(woRow.fg_part) + ' AND dl.locationGroupId=' + lg + ' LIMIT 1) AS wrapped_for_fishbowl_api';
            try {
                var r = (await qp(sql)).map(lc)[0] || {};
                return toNumber(r.default_loc, 0) || 0;
            } catch (e) { dbg('resolveFgLocationId failed: ' + errorMessage(e), 'warn'); return 0; }
        }
        function noFgLocationMessage(woRow) {
            return 'Finished good ' + (woRow.fg_part || 'this part') +
                   ' has no default location in ' + (woRow.location_group || 'this location group') +
                   ' — set a default location for the part in Fishbowl (Part → Locations) before finishing.';
        }

        async function applyUsedOverrides(pick, overrides) {
            if (!Array.isArray(overrides) || !overrides.length) return;
            var pickItems = normalizePickItems(pick);
            if (!pickItems.length) return;
            var pickitemIds = pickItems
                .map(function (it) { return toNumber(it.PickItemID, 0); })
                .filter(function (id) { return id > 0; });
            if (!pickitemIds.length) return;
            var rows = await qp(
                "SELECT id AS pickitem_id, woItemId AS wo_item_id " +
                "FROM pickitem WHERE id IN (" + pickitemIds.join(',') + ")"
            );
            var woByPickitem = {};
            rows.forEach(function (r) { woByPickitem[r.pickitem_id] = r.wo_item_id; });
            var overrideByWoItem = {};
            overrides.forEach(function (o) { if (o.woItemId) overrideByWoItem[o.woItemId] = o; });
            var blockers = [];
            pickItems.forEach(function (item) {
                var pid = toNumber(item.PickItemID, 0);
                var woId = woByPickitem[pid];
                if (!woId) return;
                var ov = overrideByWoItem[woId];
                if (!ov) return;
                var oldQty = parseFloat(item.Quantity) || 0;
                if (Math.abs(oldQty - ov.qty) < 1e-6) return;
                if (isCommittedPickItemStatus(item.Status)) {
                    blockers.push(ov.partNum + ': cannot change consumed qty — pick item already committed at ' + oldQty);
                    return;
                }
                dbg('Override pickitem #' + pid + ' (' + ov.partNum + ') qty ' + oldQty + ' -> ' + ov.qty, 'info');
                item.Quantity = toQuantityString(ov.qty);
            });
            if (blockers.length) throw new Error(blockers.join('; '));
        }

        // opts: { mode, selectedSerialKeys, fgDefs, usedOverrides, woItemUsed, post, onStep }
        //   usedOverrides — pick-based Used overrides (inventory lines)
        //   woItemUsed    — WO-save Used overrides (non-inventory lines) → buildCompleteWorkOrder
        async function prepareFinish(woRow, opts) {
            opts = opts || {};
            var mode = opts.mode || CFG.mode;
            var selectedSerialKeys = opts.selectedSerialKeys || new Set();
            var out = { ok: false, posted: false, woNum: woRow.wo_num, steps: [], payloads: {},
                        error: null, lineResults: [], blockers: [], pick: null, stockRows: [] };
            function step(label) { out.steps.push(label); if (typeof opts.onStep === 'function') { try { opts.onStep(label); } catch (_) {} } }
            try {
                var getPickRs = await legacyRequest('GetPickRq', { WoNum: woRow.wo_num });
                var pick = getPickRs.Pick;
                if (!pick) throw new Error('GetPickRs did not include a Pick for ' + woRow.wo_num + '.');
                out.pick = pick;
                step('Loaded pick ' + (pick.Num || woRow.pick_num || ''));
                await applyUsedOverrides(pick, opts.usedOverrides);
                var pickNum = pick.Num || woRow.pick_num;
                var stockRows = (await qp(buildStockQuery(pickNum))).map(normalizeStockRow);
                out.stockRows = stockRows;
                var lineResults = buildLineResults(pick, stockRows, mode, selectedSerialKeys);
                out.lineResults = lineResults;
                var allBlockers = collectBlockers(lineResults);
                // Split shortage lines (overridable when opts.allowShort) from HARD
                // blockers (serial/tracking issues that must be fixed regardless).
                var shortResults = lineResults.filter(function (l) { return !l.fullyFulfilled && isShortageReason(l.failureReason); });
                var hardResults  = lineResults.filter(function (l) { return !l.fullyFulfilled && !isShortageReason(l.failureReason); });
                out.shortLines = shortResults.map(function (l) {
                    return { partNum: l.partnum, required: l.requiredPickUom, allocated: l.allocatedPickUom, shortfall: l.shortfallPickUom };
                });
                var allowShort = !!opts.allowShort;
                // Blocked when there's ANY hard blocker, or a shortage the policy won't
                // let us override. Otherwise fall through — either fully fulfilled, or
                // short-but-overridden (commit whatever stock IS available; the empty /
                // partial lines are handled by buildCommitSavePick).
                if (hardResults.length || (shortResults.length && !allowShort)) {
                    out.blockers = allBlockers;
                    out.error = allBlockers[0];
                    return out;
                }
                out.blockers = [];
                out.short = shortResults.length > 0;   // finishing short — caller confirms via a danger modal
                var fgLocId = await resolveFgLocationId(woRow, null);
                if (!fgLocId) { out.error = noFgLocationMessage(woRow); out.blockers = [out.error]; return out; }
                var savePick = buildCommitSavePick(pick, lineResults, { statusId: 40, destinationTagNumMode: 'new' });
                out.payloads.savePick = savePick;
                var pickStatusId = toNumber(pick.StatusID, -1);
                out.payloads.startPick = (pickStatusId >= 0 && pickStatusId < 20) ? buildStartSavePick(pick) : null;
                out.ok = true;
                if (!opts.post) return out;   // preview only
                // Non-inventory (labour/service/overhead) consumed-qty overrides. On the
                // finish (status→40) save Fishbowl RECOMPUTES a labour line's qtyUsed from
                // its TARGET as that target stood BEFORE the fulfilling save — so the new
                // TARGET (QtyToFulfill) must be committed to the DB in a SEPARATE, EARLIER
                // save, before the pick + fulfilling save. DB-PROVEN WO 1004: setting
                // QtyToFulfill=5 ON the fulfilling save moved qtyTarget to 5 but qtyUsed
                // still landed at 1 (the recompute read the pre-save target of 1). So the
                // target write must PRECEDE the finish. preStoreLabourUsed now sets the
                // target; running it here — before the pick commit, while the WO is still
                // open — means a failure aborts nothing (the pick isn't committed yet).
                // NON-FATAL: on failure the finish still completes (labour lands at its
                // original target).
                if (Array.isArray(opts.woItemUsed) && opts.woItemUsed.length) {
                    try {
                        await preStoreLabourUsed(woRow, opts.woItemUsed);
                        step('Labour target set');
                    } catch (labErr) {
                        if (_diag) _diag('Finish pre-store labour FAILED (non-fatal, finish continues): ' + errorMessage(labErr));
                        dbg('preStoreLabourUsed failed (non-fatal): ' + errorMessage(labErr), 'warn');
                        step('Labour target set — skipped');
                    }
                }
                if (isPickFinished(pick)) {
                    step('Pick already finished — skipped');
                } else {
                    if (out.payloads.startPick) { await legacyRequest('SavePickRq', out.payloads.startPick); step('Pick started'); }
                    await savePickWithRetry(pick, lineResults, savePick);
                    step('Pick finished');
                }
                // Scrap interleave — between the pick commit and the WO save so a
                // scrap failure surfaces before the WO is marked Fulfilled. The
                // pick is already committed at this point (irreversible via API),
                // so a scrap failure leaves the WO recoverable but not atomic.
                if (Array.isArray(opts.scrapRows) && opts.scrapRows.length && typeof opts.scrapImporter === 'function') {
                    var scrapResult = opts.scrapImporter(opts.scrapRows);
                    step('Scrapped ' + (scrapResult && scrapResult.count ? scrapResult.count : opts.scrapRows.length) +
                         ' line' + (opts.scrapRows.length === 1 ? '' : 's'));
                }
                var getWoRs = await legacyRequest('GetWorkOrderRq', { WorkOrderNumber: woRow.wo_num });
                var wo = getWoRs.WO || getWoRs.Wo || getWoRs.WorkOrder;
                if (!wo) throw new Error('GetWorkOrderRs did not include a WO.');
                var fgDefs = opts.fgDefs || [];
                var saveWo = buildCompleteWorkOrder(wo, fgDefs, opts.woItemUsed);
                out.payloads.saveWo = saveWo;
                // Diagnostic (debug console only): the exact QtyUsed we're sending per
                // WOItem, so a labour line still finishing at 0 can be seen in the payload.
                if (_diag && Array.isArray(opts.woItemUsed) && opts.woItemUsed.length) {
                    try {
                        var _wis = ensureArray(saveWo.WO && saveWo.WO.WOItems && saveWo.WO.WOItems.WOItem);
                        _diag('Finish SaveWorkOrder ' + woRow.wo_num + ' WOItem Used/Target/OrigTarget: ' + _wis.map(function (x) {
                            var _pn = (x.PartNum != null ? x.PartNum : (x.Part && x.Part.Num) || '?');
                            var _tgt = (x.QtyToFulfill != null ? x.QtyToFulfill : (x.QtyTarget != null ? x.QtyTarget : '?'));
                            var _ot = (x.OriginalQtyToFulfill != null ? x.OriginalQtyToFulfill : '?');
                            return _pn + '(t' + toNumber(x.TypeID, -1) + ')=' + x.QtyUsed + '/' + _tgt + '/' + _ot;
                        }).join(', '));
                    } catch (_) {}
                }
                await legacyRequest('SaveWorkOrderRq', saveWo);
                step('Work order completed');
                out.posted = true;
                return out;
            } catch (e) {
                out.ok = false; out.error = errorMessage(e);
                dbg('prepareFinish ' + woRow.wo_num + ' failed: ' + out.error, 'error');
                return out;
            }
        }

        // Extract per-pickitem serial lines from a preview result.
        function serialLinesFrom(result) {
            if (!result || !result.pick) return [];
            var pick = result.pick;
            var stockRows = result.stockRows || [];
            var pickItems = normalizePickItems(pick);
            var rowsByItem = new Map();
            stockRows.forEach(function (r) {
                if (!rowsByItem.has(r.pickitem_id)) rowsByItem.set(r.pickitem_id, []);
                rowsByItem.get(r.pickitem_id).push(r);
            });
            var out = [];
            pickItems.forEach(function (item) {
                if (!isPartSerialized(item.Part)) return;
                var status = toNumber(item.Status, -1);
                var pickitemId = toNumber(item.PickItemID, 0);
                var partNum = (item.Part && item.Part.Num) || '';
                var partDesc = (item.Part && item.Part.Description) || '';
                var required = Math.max(0, Math.floor(toNumber(item.Quantity, 0)));
                var committed = isCommittedPickItemStatus(status);
                var candidates = [];
                var seen = new Set();
                if (committed) {
                    var trackingItems = ensureArray(item.Tracking && item.Tracking.TrackingItem);
                    trackingItems.forEach(function (ti) {
                        var pt = ti.PartTracking;
                        if (!isSerialPartTracking(pt)) return;
                        var boxes = ensureArray(ti.SerialBoxList && ti.SerialBoxList.SerialBox);
                        boxes.forEach(function (sb) {
                            var nums = ensureArray(sb.SerialNumList && sb.SerialNumList.SerialNum);
                            nums.forEach(function (sn) {
                                var num = String((sn && sn.Number) || '').trim();
                                if (!num || seen.has(num)) return;
                                seen.add(num);
                                candidates.push({
                                    key: pickitemId + '::committed::' + toNumber(sb.SerialID, 0) + '::' + toNumber(sb.TagID, 0) + '::' + num,
                                    serialNum: num, tagId: toNumber(sb.TagID, 0), tagNum: '',
                                    serialId: toNumber(sb.SerialID, 0), partTrackingId: toNumber(pt && pt.PartTrackingID, 0),
                                    trackingName: (pt && pt.Name) || '', trackingTypeId: TRACKING_TYPE_SERIAL, tagDateCreated: null,
                                });
                            });
                        });
                    });
                } else {
                    var rows = rowsByItem.get(pickitemId) || [];
                    rows.forEach(function (row) {
                        ensureArray(row.serial_json).forEach(function (s) {
                            var num = String((s && s.SerialNum) || '').trim();
                            if (!num || seen.has(num)) return;
                            seen.add(num);
                            candidates.push({
                                key: serialKey(pickitemId, row, s),
                                serialNum: num, tagId: toNumber(s.TagID != null ? s.TagID : row.tag_id, 0),
                                tagNum: row.tag_num != null ? String(row.tag_num) : '',
                                serialId: toNumber(s.SerialID, 0), partTrackingId: toNumber(s.PartTrackingID, 0),
                                trackingName: (s.TrackingName) || '', trackingTypeId: toNumber(s.TrackingTypeID, TRACKING_TYPE_SERIAL),
                                tagDateCreated: row.tag_datecreated || null,
                            });
                        });
                    });
                }
                out.push({
                    pickitemId: pickitemId, partNum: partNum, partDesc: partDesc,
                    required: required, committed: committed, readOnly: committed,
                    status: status, candidates: candidates,
                });
            });
            return out;
        }

        return {
            CFG: CFG,
            prepareFinish: prepareFinish,
            previewFinish: function (woRow, opts) { return prepareFinish(woRow, Object.assign({}, opts || {}, { post: false })); },
            serialLinesFrom: serialLinesFrom,
            generateFgSerials: generateFgSerials,
        };
    })();

  // ===== STAGING / DEPENDENCY HELPERS (from Production_Scheduling_v1.2) =====
    var DEP_QUERY = `
        SELECT DISTINCT
            consumer_wo.id AS wo_id,
            consumer_wo.num AS wo_num,
            producer_wo.id AS staging_wo_id,
            producer_wo.num AS staging_wo_num,
            COALESCE(producer_wo.datescheduled, producer_mi.datescheduled) AS staging_wo_finish,
            COALESCE(consumer_wo.datescheduledtostart, consumer_mi.datescheduledtostart) AS wo_start,
            comp_part.num AS part_num
        FROM moitem AS producer_mi
        INNER JOIN moitem AS comp_line ON comp_line.id = producer_mi.parentid AND comp_line.typeid = 20
        INNER JOIN moitem AS consumer_mi ON consumer_mi.id = comp_line.parentid AND consumer_mi.typeid = 50
        INNER JOIN mo ON mo.id = producer_mi.moid
        INNER JOIN wo AS producer_wo ON producer_wo.moitemid = producer_mi.id
        INNER JOIN wo AS consumer_wo ON consumer_wo.moitemid = consumer_mi.id
        LEFT JOIN part AS comp_part ON comp_part.id = comp_line.partid
        WHERE producer_mi.typeid = 50
            AND producer_wo.num IS NOT NULL
            AND consumer_wo.num IS NOT NULL
            AND producer_wo.statusid IN (10, 30, 40)
            AND consumer_wo.statusid IN (10, 30, 40)
            AND producer_wo.id != consumer_wo.id
            AND mo.statusid < 60
    `;
function sortWOsByDependencies(wos, deps) {
    // Build dependency graph from staging relationships
    // If WO A produces a part used in WO B, then A should come before B

    const woMap = new Map(wos.map(wo => [wo.wo_id, wo]));
    const dependencies = new Map(); // wo_id -> array of wo_ids it depends on
    const dependents = new Map(); // wo_id -> array of wo_ids that depend on it

    // Initialize maps
    wos.forEach(wo => {
        dependencies.set(wo.wo_id, []);
        dependents.set(wo.wo_id, []);
    });

    // Build dependency graph from staging relationships
    (deps || []).forEach(dep => {
        // dep.staging_wo_id produces a part that dep.wo_id consumes
        // So dep.wo_id depends on dep.staging_wo_id
        if (woMap.has(dep.wo_id) && woMap.has(dep.staging_wo_id)) {
            dependencies.get(dep.wo_id).push(dep.staging_wo_id);
            dependents.get(dep.staging_wo_id).push(dep.wo_id);
        }
    });

    // Topological sort using Kahn's algorithm
    const sorted = [];
    const inDegree = new Map();

    wos.forEach(wo => {
        inDegree.set(wo.wo_id, dependencies.get(wo.wo_id).length);
    });

    // Start with WOs that have no dependencies
    const queue = wos.filter(wo => inDegree.get(wo.wo_id) === 0);

    while (queue.length > 0) {
        // Sort queue by WO number to maintain stable sort for WOs at same level
        queue.sort((a, b) => a.wo_num.localeCompare(b.wo_num));

        const wo = queue.shift();
        sorted.push(wo);

        // Reduce in-degree for dependent WOs
        const deps = dependents.get(wo.wo_id) || [];
        deps.forEach(depWoId => {
            inDegree.set(depWoId, inDegree.get(depWoId) - 1);
            if (inDegree.get(depWoId) === 0) {
                queue.push(woMap.get(depWoId));
            }
        });
    }

    // If there are cycles or orphaned WOs, append them sorted by WO number
    const remaining = wos.filter(wo => !sorted.includes(wo));
    if (remaining.length > 0) {
        remaining.sort((a, b) => a.wo_num.localeCompare(b.wo_num));
        sorted.push(...remaining);
    }

    return sorted;
}

// ============================================
// TIMELINE — CHAIN-MAJOR ROW ORDER (MO grouping)
// ----
// Within an MO group, order the WO rows so each dependency CHAIN is contiguous
// instead of interleaving parallel chains stage-by-stage (the effect of the old
// start-date sort). An MO with two configurations of the same finished good
// (e.g. MO 1010: two PROD-1000 builds, each a nested ABC.rev2 → FBL → SUB → PROD
// chain) then reads as two clean staircases with non-crossing dependency arrows.
//   1. Split the group's WOs into connected components of the staging-dependency
//      graph (restricted to this group) — each component is one build chain.
//   2. Order WITHIN a component by sortWOsByDependencies (producer → consumer,
//      ties by WO#).
//   3. Order the components by earliest start date, then lowest WO#.
//   4. Concatenate.
// Zero new queries (reuses deps). A single-chain MO returns the
// same order it would have anyway; used only for viewMode==='mo' (dependency
// arrows only draw there). If two configs ever share a WO they merge into one
// chain, which is the correct reading.
function psOrderMoRowsByChain(items, deps) {
    if (!items || items.length <= 1) return (items || []).slice();
    const ids = new Set(items.map(w => String(w.wo_id)));
    const byId = new Map(items.map(w => [String(w.wo_id), w]));
    // Undirected adjacency from staging deps, restricted to this group's WOs.
    const adj = new Map();
    items.forEach(w => adj.set(String(w.wo_id), []));
    (deps || []).forEach(d => {
        const a = String(d.wo_id), b = String(d.staging_wo_id);
        if (ids.has(a) && ids.has(b) && a !== b) { adj.get(a).push(b); adj.get(b).push(a); }
    });
    // Connected components (each = one build chain), in first-seen order.
    const seen = new Set(), comps = [];
    items.forEach(w => {
        const id = String(w.wo_id);
        if (seen.has(id)) return;
        const comp = [], stack = [id]; seen.add(id);
        while (stack.length) {
            const cur = stack.pop(); comp.push(byId.get(cur));
            (adj.get(cur) || []).forEach(n => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
        }
        comps.push(comp);
    });
    // Order the chains by earliest start date, then lowest WO#.
    const startVal = w => { const m = moment(w.date_scheduled_start).valueOf(); return isNaN(m) ? Infinity : m; };
    const minWoNum = c => c.map(w => String(w.wo_num)).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))[0] || '';
    comps.sort((x, y) => {
        const xs = Math.min.apply(null, x.map(startVal)), ys = Math.min.apply(null, y.map(startVal));
        if (xs !== ys) return xs - ys;
        return minWoNum(x).localeCompare(minWoNum(y), undefined, { numeric: true });
    });
    // Within each chain: dependency order (producer → consumer). Concatenate.
    return comps.reduce((acc, c) => acc.concat(sortWOsByDependencies(c, deps)), []);
}

  var Staging = {
    DEP_QUERY: DEP_QUERY,
    sortWOsByDependencies: sortWOsByDependencies,
    orderRowsByChain: psOrderMoRowsByChain
  };

  global.FBMfg = {
    Finisher: Finisher,
    Scrap: Scrap,
    Staging: Staging,
    setLogger: setLogger,
    setDiag: setDiag,
    generateFgSerials: generateFgSerials,
    parseFgSerials: parseFgSerials,
    effectiveUsedQty: effectiveUsedQty,
    effectiveScrapQty: effectiveScrapQty
  };
})(typeof window !== 'undefined' ? window : this);
