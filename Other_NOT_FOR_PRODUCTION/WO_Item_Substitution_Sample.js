/*
================================================================================
  Fishbowl — Substitute a component part on an OPEN Work Order (legacy API)
  SAMPLE / REFERENCE CODE — adapt before using in production.
  --------------------------------------------------------------------------------
  Swaps one component line on an OPEN work order for another part: ADD the
  replacement, then REMOVE the original.

  Neither the REST API nor the DOCUMENTED legacy request catalogue exposes a
  "remove work-order item" or "edit work-order item". This sample therefore:
    • ADD    → AddWorkOrderItemRq            (DOCUMENTED: "adds an item to an open WO")
    • REMOVE → GetWorkOrderRq + SaveWorkOrderRq   (UNDOCUMENTED but functional:
               re-save the whole WO with the line dropped from the WOItems array)

  Verified empirically on a Fishbowl 26.x demo server (SaveWorkOrderRq honoured
  the array-level removal: statusCode 1000 and the woitem row was gone). Because
  the removal path is undocumented, RE-VERIFY on your Fishbowl version before you
  rely on it.

  TRANSPORT
  ---------
  Both requests ride the legacy API (raw TCP socket, port 28192, [int32-BE
  length][payload] framing). Two ways to call it:
    • Inside a Fishbowl BI report: the synchronous runApiRequest() bridge — the
      default adapter below. Pass/receive the UN-enveloped { XxxRq:{…} } form.
    • Standalone app: speak the socket framing yourself and send the same request
      shapes; a REST /api/login bearer token works as the legacy Ticket.Key.
      Supply your own opts.callLegacy in that case.

  ════════════════ GOTCHAS (read before shipping) ════════════════
   1. SaveWorkOrderRq is a READ-MODIFY-WRITE of the WHOLE WO. Always GET the WO
      immediately before saving and send the entire record back — a stale or
      partial payload resets every field you omitted.
   2. AddWorkOrderItemRq REQUIRES a non-empty Description, or it returns
      statusCode 1012 ("You must have a description for the Work Order item.").
   3. Only OPEN work orders can be edited (StatusID 10 = Entered, 30 = Started).
      A Fulfilled WO (40) is locked — bail out.
   4. **Do NOT orphan picks / WIP.** Before removing a WOItem, check whether it
      already has pick lines or staged WIP tags:
        • pickitem.statusid IN (30,40)  → committed / finished pick → stock is
          staged or consumed against this line; removing it orphans the pickitem
          and can strand tags. VOID / finish the pick first.
        • tag.woitemid                  → parts already staged into WIP for this
          line; un-stage (return) them first.
        • pickitem.statusid IN (5,6,10,11,20) → open/uncommitted pick lines;
          usually clear with the woitem but VERIFY on your build.
   5. ORDER MATTERS: ADD first, then RE-GET, then REMOVE. SaveWorkOrderRq replaces
      the whole item list, so the array you save on the remove step must already
      contain the just-added line — otherwise you drop the new part too.
   6. NOT ATOMIC. Add and Remove are two separate calls. If the Remove fails
      after the Add succeeded, the WO is left with BOTH lines — reconcile/retry.
   7. WO-LEVEL ONLY. This changes the work order, NOT the parent Manufacture
      Order's saved configuration/BOM. Re-issuing or regenerating the WO from the
      MO would revert to the original BOM.
   8. TypeId is the WOItem type: 20 = Raw Good (a consumed component), 10 =
      Finished Good (the output). Substituting a raw material uses 20.
   9. UOMCode must be a UOM valid for the part; Cost feeds the WIP valuation.
      Prefer an explicit UOM code over relying on a server default.
  10. runApiRequest BLOCKS the UI thread (synchronous). Fine for a button; don't
      loop it over hundreds of WOs without a progress/yield strategy.
================================================================================
*/

(function (global) {
  'use strict';

  // ── Transport adapter (default = Fishbowl BI report bridge) ──────────
  // Sends the un-enveloped { reqName: payload } and parses the { reqName+'Rs' }
  // response. Replace with your own socket client when running outside a report.
  function defaultCallLegacy(reqName, payload) {
    if (typeof runApiRequest !== 'function') {
      throw new Error('runApiRequest unavailable — supply opts.callLegacy for your environment');
    }
    var body = {}; body[reqName] = payload;
    return JSON.parse(runApiRequest(reqName, JSON.stringify(body)));
  }

  // ── Read-only SQL adapter (default = Fishbowl BI runQuery) ───────────
  // Used ONLY for the safety preflight + post-verify. Returns rows[] or null.
  function defaultRunSql(sql) {
    if (typeof runQuery !== 'function') return null;
    try { return JSON.parse(runQuery(sql)); } catch (e) { return null; }
  }

  function asArray(x) { return Array.isArray(x) ? x : (x ? [x] : []); }
  function itemId(wi) { return wi.ID != null ? wi.ID : (wi.WOItemID != null ? wi.WOItemID : null); }

  /**
   * Substitute a component line on an OPEN work order (ADD replacement + REMOVE original).
   *
   * @param {string} woNum                    e.g. "397:002"
   * @param {object} opts
   * @param {number|string} opts.removeWoItemId  WOItem.ID to remove (from GetWorkOrderRq)
   * @param {object} opts.add                 { partNum, description, quantity, uomCode, cost, typeId }
   *                                          description REQUIRED (GOTCHA 2); typeId default 20 (GOTCHA 8).
   * @param {function} [opts.callLegacy]      (reqName, payloadObj) => parsedResponse
   * @param {function} [opts.runSql]          (sql) => rows[]   (safety preflight + verify; omit to skip)
   * @param {boolean}  [opts.force]           bypass the pick/WIP safety GATE — NOT recommended (GOTCHA 4)
   * @returns {object} { ok, addStatus, removeStatus, blockers:[], steps:[] }
   */
  function substituteWorkOrderItem(woNum, opts) {
    opts = opts || {};
    var callLegacy = opts.callLegacy || defaultCallLegacy;
    var runSql     = opts.runSql     || defaultRunSql;
    var add        = opts.add || {};
    var out = { ok: false, addStatus: null, removeStatus: null, blockers: [], steps: [] };

    // ── 0) Validate inputs ──────────────────────────────────────────────
    if (!woNum)                 out.blockers.push('woNum is required');
    if (opts.removeWoItemId == null) out.blockers.push('opts.removeWoItemId is required');
    if (!add.partNum)           out.blockers.push('opts.add.partNum is required');
    if (!add.description)       out.blockers.push('opts.add.description is required (empty → AddWorkOrderItemRq status 1012)'); // GOTCHA 2
    if (add.quantity == null || isNaN(parseFloat(add.quantity))) out.blockers.push('opts.add.quantity is required');
    if (out.blockers.length) return out;

    // ── 1) GET the WO fresh — confirm it exists and is OPEN ──────────────
    var g = (callLegacy('GetWorkOrderRq', { WorkOrderNumber: woNum }) || {}).GetWorkOrderRs || {};
    if (g.statusCode !== 1000 || !g.WO) {
      out.blockers.push('GetWorkOrderRq failed: ' + g.statusCode + ' ' + (g.statusMessage || ''));
      return out;
    }
    // GOTCHA 3: editing only works on Entered (10) / Started (30).
    if (Number(g.WO.StatusID) !== 10 && Number(g.WO.StatusID) !== 30) {
      out.blockers.push('WO ' + woNum + ' is not open (StatusID=' + g.WO.StatusID + '). Only Entered/Started WOs can be edited.');
      return out;
    }

    // ── 2) SAFETY PREFLIGHT — never orphan a pick or stranded WIP (GOTCHA 4) ──
    if (!opts.force && runSql) {
      var id = parseInt(opts.removeWoItemId, 10);
      var chk = runSql(
        "SELECT " +
        "  (SELECT COUNT(*) FROM pickitem WHERE woitemid=" + id + " AND statusid IN (30,40)) AS committed_picks, " +
        "  (SELECT COUNT(*) FROM pickitem WHERE woitemid=" + id + " AND statusid IN (5,6,10,11,20)) AS open_picks, " +
        "  (SELECT COALESCE(SUM(qty),0) FROM tag WHERE woitemid=" + id + ") AS wip_tag_qty"
      );
      var c = (chk && chk[0]) || {};
      if (parseInt(c.committed_picks, 10) > 0)
        out.blockers.push('WOItem ' + id + ' has ' + c.committed_picks + ' committed/finished pick line(s) — removing it would orphan them. Void/finish the pick first (or pass force:true).');
      if (parseFloat(c.wip_tag_qty) > 0)
        out.blockers.push('WOItem ' + id + ' has ' + c.wip_tag_qty + ' unit(s) staged in WIP (tags) — un-stage/return them before removing (or pass force:true).');
      if (parseInt(c.open_picks, 10) > 0)
        out.steps.push('WARNING: ' + c.open_picks + ' open pick line(s) reference WOItem ' + id + ' — verify the pick after substitution.');
      if (out.blockers.length) return out;
    } else if (!runSql && !opts.force) {
      out.steps.push('WARNING: no runSql available — pick/WIP safety checks were SKIPPED. Verify manually before trusting the result.');
    }

    // ── 3) ADD the replacement line (documented request) ────────────────
    var addRs = (callLegacy('AddWorkOrderItemRq', {
      OrderNum:    woNum,
      TypeId:      add.typeId != null ? add.typeId : 20,   // GOTCHA 8
      Description: add.description,                         // GOTCHA 2 (required)
      PartNum:     add.partNum,
      Quantity:    add.quantity,
      UOMCode:     add.uomCode || '',                      // GOTCHA 9
      Cost:        add.cost != null ? add.cost : 0
    }) || {}).AddWorkOrderItemRs || {};
    out.addStatus = addRs.statusCode;
    if (addRs.statusCode !== 1000) {
      // Nothing has been removed yet → safe to abort with the WO unchanged.
      out.blockers.push('AddWorkOrderItemRq failed: ' + addRs.statusCode + ' ' + (addRs.statusMessage || ''));
      return out;
    }
    out.steps.push('Added ' + add.partNum + ' (type ' + (add.typeId != null ? add.typeId : 20) + ', qty ' + add.quantity + ')');

    // ── 4) RE-GET (now includes the new line), then REMOVE the original ──
    // GOTCHA 5: must re-GET AFTER the add, or the save below drops the new line.
    var g2 = (callLegacy('GetWorkOrderRq', { WorkOrderNumber: woNum }) || {}).GetWorkOrderRs || {};
    if (g2.statusCode !== 1000 || !g2.WO) {
      // GOTCHA 6: not atomic — the add already succeeded.
      out.blockers.push('Re-GetWorkOrderRq failed: ' + g2.statusCode + ' — replacement was ADDED but the original was NOT removed. Reconcile manually.');
      return out;
    }
    var wo2   = g2.WO;
    var items = asArray(wo2.WOItems && wo2.WOItems.WOItem);
    var kept  = items.filter(function (wi) { return String(itemId(wi)) !== String(opts.removeWoItemId); });
    if (kept.length === items.length) {
      out.blockers.push('WOItem ' + opts.removeWoItemId + ' not found on the fresh GET — replacement was ADDED but the original was NOT removed. Reconcile manually.');
      return out;
    }
    // GOTCHA 1: send the WHOLE WO back; we only touch the item list.
    wo2.WOItems = { WOItem: kept };
    var saveRs = (callLegacy('SaveWorkOrderRq', { WO: wo2 }) || {}).SaveWorkOrderRs || {};
    out.removeStatus = saveRs.statusCode;
    if (saveRs.statusCode !== 1000) {
      out.blockers.push('SaveWorkOrderRq (remove) failed: ' + saveRs.statusCode + ' ' + (saveRs.statusMessage || '') +
                        ' — replacement was ADDED but the original was NOT removed. Reconcile manually.');
      return out;
    }
    out.steps.push('Removed WOItem ' + opts.removeWoItemId + ' via SaveWorkOrderRq');

    // ── 5) POST-VERIFY — confirm the end state + no orphans (recommended) ──
    if (runSql) {
      var vid = parseInt(opts.removeWoItemId, 10);
      var v = runSql(
        "SELECT " +
        "  (SELECT COUNT(*) FROM woitem   WHERE id=" + vid + ")       AS row_left, " +
        "  (SELECT COUNT(*) FROM tag      WHERE woitemid=" + vid + ") AS tag_orphans, " +
        "  (SELECT COUNT(*) FROM pickitem WHERE woitemid=" + vid + ") AS pick_orphans"
      );
      var vr = (v && v[0]) || {};
      if (parseInt(vr.row_left, 10)     > 0) out.steps.push('WARNING: woitem ' + vid + ' still exists after the save.');
      if (parseInt(vr.tag_orphans, 10)  > 0) out.steps.push('WARNING: ' + vr.tag_orphans + ' orphaned tag(s) still reference woitem ' + vid + '.');
      if (parseInt(vr.pick_orphans, 10) > 0) out.steps.push('WARNING: ' + vr.pick_orphans + ' orphaned pickitem(s) still reference woitem ' + vid + '.');
    }

    out.ok = true;
    return out;
  }

  global.substituteWorkOrderItem = substituteWorkOrderItem;
  if (typeof module !== 'undefined' && module.exports) module.exports = { substituteWorkOrderItem: substituteWorkOrderItem };
})(typeof window !== 'undefined' ? window : this);

/* ── USAGE (inside a Fishbowl BI report) ─────────────────────────────────
   // Find the WOItem.ID to remove from GetWorkOrderRq (or your grid):
   //   GetWorkOrderRq → GetWorkOrderRs.WO.WOItems.WOItem[].ID
   var res = substituteWorkOrderItem('397:002', {
     removeWoItemId: 2226,                    // the line to drop (e.g. BRACKET-200)
     add: {
       partNum:     'BRACKET-200-V2',         // the replacement part
       description: 'Bracket 200 (rev 2)',    // REQUIRED — empty => status 1012
       quantity:    3,
       uomCode:     'ea',
       cost:        4.50,
       typeId:      20                        // 20 = Raw Good (component)
     }
     // callLegacy / runSql default to the BI-report globals (runApiRequest / runQuery).
     // Pass force:true ONLY after you have handled the pick/WIP checks yourself.
   });
   if (!res.ok) console.error('Substitution blocked:', res.blockers);
   else         console.log('Substitution OK:', res.steps);

   // ── USAGE (standalone app, own socket client) ──────────────────────────
   // substituteWorkOrderItem('397:002', {
   //   removeWoItemId: 2226,
   //   add: { partNum:'X', description:'X', quantity:1, uomCode:'ea', cost:0, typeId:20 },
   //   callLegacy: function (reqName, payload) {
   //     // send { [reqName]: payload } over the 28192 socket (int32-BE length framing),
   //     // authenticate with a REST bearer token as Ticket.Key, and return the parsed
   //     // { [reqName+'Rs']: {...} } response object.
   //     return mySocketClient.send(reqName, payload);
   //   },
   //   runSql: function (sql) { return myDb.query(sql); }   // or omit to skip safety checks
   // });
   ─────────────────────────────────────────────────────────────────────── */
