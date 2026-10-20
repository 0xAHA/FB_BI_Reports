/*
================================================================================
  FILE:   fb-lib (shared JS runtime)
  PATH:   scripts/fb-lib.js
  --------------------------------------------------------------------------------
  Canonical JavaScript runtime for every Fishbowl BI report. Deployed by
  saving the contents as a Fishbowl Script named "fb-lib" and injecting it
  into each report via Fishbowl's Script directive (whose literal
  placeholder syntax is intentionally NOT written in this header — see
  the HOW IT'S LOADED block below for the full doc, where the placeholder
  is referenced abstractly to avoid the duplicate-mention trap that
  breaks single-pass directive substitution when this file is inlined).
  Exposes the
  window.FBLib namespace: Common (date/money/qty formatters, debug logger,
  drawer + multi-select primitives), SharedData (admin-published org-wide
  payloads), Settings (layered user/master/property preference resolver),
  CfCatalog / CfCols (custom-field discovery + column rendering), Columns
  (per-tile column manifest), Picker (drag/drop column picker), Table
  (sort/filter/drag scaffolding), Export (.xlsx writer) and FilterViews
  (saved views).
================================================================================
*/

// ============================================================================
//  fb-lib.js — Shared runtime for Fishbowl BI reports
// ============================================================================
//
// HOW IT'S LOADED
// ---------------
// Reports include this whole file inside an inline <script> tag using
// the Fishbowl Script directive — `{` + `% Script fb-lib %}` (split here
// to avoid recursive expansion: Fishbowl substitutes the directive
// EVERYWHERE in the report HTML, including inside string literals and
// HTML comments, and would also recurse into this file's documentation
// if it appeared verbatim). The Fishbowl server replaces that
// placeholder with the saved script content at delivery time. When
// working locally outside Fishbowl, the placeholder is literally left
// in place and the script block fails to parse — which is expected; the
// report's own JS guards on `window.FBLib` being defined.
//
// PUBLIC API SURFACE
// ------------------
// Every public helper hangs off `window.FBLib`:
//
//   FBLib.BUILD          — this file's build stamp.
//   FBLib.Common         — date / money / qty formatting, debug logger,
//                          status indicators, debug drawer, drop-down
//                          drawer helpers, multi-select widget, and
//                          toast / confirmModal / tooltips / fdrop.
//   FBLib.SharedData     — one org-wide payload per key, written by an
//                          admin and read by everyone (userproperties,
//                          admin-owned rows only).
//   FBLib.Settings       — layered preference resolver (user → master →
//                          getProperty → defaults), with admin-publish +
//                          editing-lock support.
//   FBLib.CfCatalog      — Fishbowl custom-field discovery. Lazy-loaded
//                          on first call; one-shot query buckets every
//                          active CF by module table.
//   FBLib.CfCols         — Render + filter active CFs into a per-tile
//                          column set. Pairs with FBLib.Columns.
//   FBLib.Columns        — Per-tile column manifest + visibility/ordering
//                          helpers (settings-aware).
//   FBLib.Picker         — Drag-and-drop column picker UI used by
//                          report settings panels.
//   FBLib.Table          — Sort / per-column filter / drag-reorder /
//                          drag-resize scaffolding for a <table> in a
//                          scroll container. Plug in via FBLib.Table.init.
//   FBLib.ColumnMenu     — "Columns" drop-down: show / hide, drag to
//                          reorder, admin rename for everyone. FBLib.Table
//                          and FBLib.RptCols build one from their
//                          columnMenu option.
//   FBLib.Export         — Formatted .xlsx download (real dates/numbers,
//                          SUBTOTAL totals row); no CDN dependency.
//   FBLib.RowCap         — Cap a big result (first N rows + "Load all").
//   FBLib.RptCols        — Resize / heading-click sort / drag-reorder for a
//                          report-rendered .rpt-table (groups, totals…),
//                          with an optional Columns drop-down.
//   FBLib.Pivot          — Pivot (cross-tab) view of a report's flat rows,
//                          with drill-down, PDF and Excel output.
//   FBLib.FilterViews    — Saved views (per-user + admin-published company
//                          views) behind one compact header button. Works
//                          on filter-row tables out of the box, or on any
//                          report that supplies capture/restore.
//
// QUICK START — common building blocks
// ------------------------------------
//   // 1. Initialise settings BEFORE any code that calls resolve():
//   FBLib.Settings.init({
//       userKey:   'cdx.bi.myreport.user.v1',
//       masterKey: 'cdx.bi.myreport.master.v1',
//       defaults:  { dateRange: 'thisFY', showDebug: false }
//   });
//
//   // 2. Mount the debug drawer (idempotent — call as many times as you like):
//   FBLib.Common.mountDebugDrawer();
//   FBLib.Common.debugLog('Hello world', 'info');
//
//   // 3. Register your settings/help/filters drop-down drawers so they
//   //    share mutual-exclusion + ESC-to-close plumbing:
//   FBLib.Common.registerDrawer({ id: 'setOverlay',     triggerId: 'setBtn'     });
//   FBLib.Common.registerDrawer({ id: 'helpOverlay',    triggerId: 'helpBtn'    });
//   FBLib.Common.registerDrawer({ id: 'filtersOverlay', triggerId: 'filtersBtn' });
//   // Then in your header buttons: onclick="FBLib.Common.toggleDrawer('setOverlay')"
//
//   // 4. Wire up a sortable / filterable / draggable / resizable table:
//   var table = FBLib.Table.init({
//       tableEl:    document.getElementById('reportTable'),
//       columns:    _columns,     // [{ key, label, type?, money?, qty?, date?, link?, vis? }, ...]
//       getRows:    () => _dataset,
//       onRender:   () => updateKpis(),
//       settingsKey: 'columnOrder',   // optional — persists via FBLib.Settings
//   });
//   table.render();
//
//   // 5. Multi-select dropdown filter (re-query once per dropdown session
//   //    via onClose — onChange fires per checkbox, so don't query there):
//   FBLib.Common.MultiSelect.create({
//       containerId: 'statusMs',     // host <div> with the canonical markup
//       items:       [{ value: 20, label: 'Issued' }, { value: 25, label: 'In Progress' }],
//       placeholder: 'All statuses',
//       onChange:    selected => { /* sync report state only */ },
//       onClose:     selected => loadDashboard()
//   });
//
// HOW STYLES ARE INJECTED
// -----------------------
// Most helpers that ship their own DOM (debug drawer, multi-select,
// column picker, etc.) inject their CSS once via a `<style>` tag with a
// known id, so calling the mount/create function repeatedly is cheap.
// Report-level CSS (the drop-down `.fb-drawer` rules, the table classes
// the Table helper looks for) is documented inline above each module.
//
// AI ASSISTANT GUIDANCE
// ---------------------
// (If you are an AI assistant reading this file to generate or modify a
// Fishbowl BI report, follow these rules — they will save the user a
// great deal of corrective feedback.)
//
//  • Prefer FBLib over hand-rolled equivalents. If a report already
//    formats money with formatMoney() and you're adding a new feature,
//    use FBLib.Common.formatMoney too — don't introduce a parallel
//    helper. Same for date formatting, debug logging, drawer toggling.
//
//  • Drop-down drawers (`.fb-drawer` + `.fb-drawer-head` + `.fb-drawer-body`)
//    are the STANDARD container for settings, help, and filters. Do NOT
//    fall back to right-side slide-in panels — the codebase explicitly
//    retired them. See the "DROP-DOWN DRAWER" comment block in Common
//    below for the canonical markup + behaviour.
//
//  • Toasts, confirm dialogs, data-tip tooltips and filter-strip
//    drop-downs: FBLib.Common.toast / confirmModal / tooltips / fdrop.
//    Don't copy a page-local showToast or confirm modal into a new
//    report (Template/Component_Gallery.htm shows them all).
//
//  • Saved filter views are the one exception: use FBLib.FilterViews
//    (a compact header button + popover holding My views, Company views
//    and the admin publish / delete-for-all actions). Don't build a
//    report-local views picker or drawer.
//
//  • Lowercase result keys: every column returned by `runQuery` /
//    `runQueryAsync` is lowercased regardless of the SQL aliasing. Use
//    `row.totalprice`, not `row.totalPrice`.
//
//  • Transfer Order's table is `xo`, not `to` (`to` is a SQL reserved
//    word). FK convention is `fooId -> foo.id`. See schema/schema-index.md.
//
//  • Save preferences via FBLib.Settings, never directly via
//    `localStorage` or `sessionStorage` — those are wiped frequently in
//    JxBrowser and are per-browser, not per-Fishbowl-user.
//
//  • The Fishbowl client's embedded browser is JxBrowser 8 (modern
//    Chromium). Modern JS is fine; CDN scripts work when the user has
//    internet, but on-premise users often don't, so embed criticals or
//    avoid them.
//
//  • Touch this file ONLY when adding genuinely reusable helpers. Per-
//    report widgets belong in the report's own <script>. Once a pattern
//    has been copy-pasted into 2+ reports, that's a good signal it
//    should be lifted up here.
//
// ============================================================================
window.FBLib = (function () {
    'use strict';

    /**
     * Build stamp of this fb-lib (date-hash), maintained by tools/stamp/stamp.js; never edit it by hand.
     * Exposed as FBLib.BUILD so a report can tell which fb-lib the Fishbowl server actually served it.
     * @type {string}
     */
    const BUILD = '2026.10.20-3a86ced';   // @fb-build

    /**
     * Returns the host report's identity block (window.FB_REPORT, set at the top of every report's head).
     * Only key and build are returned; a missing block or field comes back as null.
     * @returns {{key: ?string, build: ?string}} key = the storage-key prefix, build = the report's build stamp.
     */
    function report() {
        const r = (typeof window !== 'undefined' && window.FB_REPORT) || {};
        return { key: r.key || null, build: r.build || null };
    }
    // userproperties.userKey is varchar(41): a longer key is truncated (or
    // rejected) by MySQL, so two keys can silently collide.
    const USERKEY_MAX = 41;

    // ====================================================================
    // FBLib.Common — date / money formatting, debug logger + drawer,
    //                drop-down drawer registry, multi-select widget,
    //                status indicators.
    // (replacement for the old dashboard-common.js)
    // ====================================================================
    /** Formatting, debug console, drop-down drawers, push-down panels, the multi-select widget and status indicators. */
    const Common = (function () {
        /** The DateFormatShort system property (Java SimpleDateFormat, e.g. "dd/MM/yyyy"), read once at load; default "MM/dd/yyyy". */
        const FB_DATE_FORMAT = (typeof getProperty === 'function')
            ? getProperty('DateFormatShort', 'MM/dd/yyyy')
            : 'MM/dd/yyyy';
        /** FB_DATE_FORMAT rewritten with moment.js tokens (yyyy to YYYY, yy to YY, dd to DD). */
        const MOMENT_DATE_FORMAT = FB_DATE_FORMAT
            .replace(/yyyy/g, 'YYYY')
            .replace(/yy/g, 'YY')
            .replace(/dd/g, 'DD');

        // DEBUG_MODE is dynamic — Settings.init() may change the resolution
        // after this module loads, so we expose it as a getter. The signal
        // is ONLY the user's persisted Settings — we no longer fall back
        // to the BI_SHOW_DEBUG system property. Rationale: the property
        // was set per-server (so every user of the server saw the same
        // value, regardless of their preference) AND it was a global
        // override the user couldn't change from the report UI. Reports
        // now expose a per-user "Show debug console" checkbox that writes
        // the `debug` (or legacy `showDebug`) key, which is the single
        // source of truth here.
        function _debugMode() {
            try {
                if (FBLib.Settings && FBLib.Settings._initialised) {
                    // Accept either 'debug' (the canonical key used by most
                    // reports) or 'showDebug' (legacy alias kept for reports
                    // — e.g. Import_Builder — that already shipped with the
                    // older key in their persisted user settings). Either
                    // truthy → debug mode is on.
                    let v = FBLib.Settings.resolve('debug');
                    if (v == null) v = FBLib.Settings.resolve('showDebug');
                    return !!v;
                }
            } catch (_) {}
            return false;
        }

        /**
         * Formats a date string in the company's short date format (FB_DATE_FORMAT).
         * Uses moment.js when the page loads it; otherwise reorders a "YYYY-MM-DD[ time]" string as MM/dd or dd/MM.
         * @param {string} dateStr - The date, e.g. "2026-10-13" or "2026-10-13 09:30:00".
         * @returns {string} The formatted date; '' when blank, or the input unchanged when it can't be split.
         */
        function formatDate(dateStr) {
            if (!dateStr) return '';
            // Prefer moment.js when available (handles every DateFormatShort
            // variant). Fall back to manual parsing for the dd/MM/yyyy and
            // MM/dd/yyyy cases.
            if (typeof moment === 'function') {
                return moment(dateStr).format(MOMENT_DATE_FORMAT);
            }
            const parts = String(dateStr).split(' ')[0].split('-');
            if (parts.length !== 3) return String(dateStr);
            const [year, month, day] = parts;
            return FB_DATE_FORMAT.toLowerCase().indexOf('mm/dd') === 0
                ? `${month}/${day}/${year}`
                : `${day}/${month}/${year}`;
        }

        let _currency = null;
        /**
         * Returns the home company's currency locale and symbol, resolved once and cached.
         * Falls back to en-US / "$" when currencyLocale() is unavailable (e.g. outside the Fishbowl client).
         * @returns {{locale: string, symbol: string}} e.g. { locale: 'en-US', symbol: '$' }.
         */
        function currency() {
            if (_currency) return _currency;
            try {
                _currency = (typeof currencyLocale === 'function')
                    ? currencyLocale() : { locale: 'en-US', symbol: '$' };
            } catch (_) {
                _currency = { locale: 'en-US', symbol: '$' };
            }
            if (!_currency || typeof _currency !== 'object') _currency = { locale: 'en-US', symbol: '$' };
            if (!_currency.locale) _currency.locale = 'en-US';
            if (!_currency.symbol) _currency.symbol = '$';
            return _currency;
        }

        /**
         * Formats an amount as home-currency money: symbol, locale grouping and always 2 decimals.
         * Negatives render as "-$1,234.50". Rounding is toLocaleString's, not Fishbowl's roundMoney().
         * @param {number|string} value - The amount; strings are parsed, null and '' become 0.
         * @returns {string} e.g. "$1,234.50"; '' when the value isn't numeric.
         */
        function formatMoney(value) {
            const num = parseFloat(value || 0);
            if (isNaN(num)) return '';
            const c = currency();
            const neg = num < 0, abs = Math.abs(num);
            return (neg ? '-' : '') + c.symbol +
                abs.toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        /**
         * Formats a quantity: whole numbers without decimals, others to at most 4 places with trailing zeros dropped.
         * No thousands separator is added.
         * @param {number|string} value - The quantity.
         * @returns {string} e.g. "2" or "1.5"; '' when the value isn't numeric.
         */
        function formatQty(value) {
            const v = parseFloat(value);
            if (isNaN(v)) return '';
            return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(4).replace(/\.?0+$/, '');
        }

        /**
         * Escapes single quotes for safe inlining into a SQL string literal (each ' becomes '').
         * @param {*} s - The value; null and undefined become ''.
         * @returns {string} The escaped text, without surrounding quotes.
         */
        function escSQL(s) {
            return String(s == null ? '' : s).replace(/'/g, "''");
        }

        /**
         * Classifies a scheduled date against today, for createScheduleIndicator().
         * @param {string} dateStr - A "YYYY-MM-DD[ time]" date.
         * @returns {string} 'red' past due, 'orange' today, 'blue' later this week (Sun-Sat); '' otherwise or when blank.
         */
        function getScheduleStatus(dateStr) {
            if (!dateStr) return '';
            const parts = String(dateStr).split(' ')[0].split('-');
            if (parts.length !== 3) return '';
            const schedDate = new Date(parts[0], parts[1] - 1, parts[2]);
            schedDate.setHours(0, 0, 0, 0);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            if (schedDate.getTime() === today.getTime()) return 'orange';
            if (schedDate < today) return 'red';
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            if (schedDate >= weekStart && schedDate <= weekEnd) return 'blue';
            return '';
        }

        /**
         * Builds the tooltip text for an availability status indicator.
         * @param {string} status - 'committed' | 'green' | 'red' | 'orange'; anything else reads "No pending items".
         * @param {number} fullItems - Items fully available.
         * @param {number} partialItems - Items partially available.
         * @param {number} noneItems - Items with nothing available.
         * @param {number} pendingItems - Items still pending.
         * @returns {string} e.g. "Partially available (3 full, 1 partial, 2 none of 6 pending)".
         */
        function getStatusTitle(status, fullItems, partialItems, noneItems, pendingItems) {
            if (status === 'committed') return `All items committed (${pendingItems} items)`;
            if (status === 'green')     return `All pending items available (${fullItems}/${pendingItems})`;
            if (status === 'red')       return `No pending items available (0/${pendingItems})`;
            if (status === 'orange')    return `Partially available (${fullItems} full, ${partialItems} partial, ${noneItems} none of ${pendingItems} pending)`;
            return 'No pending items (all finished)';
        }

        /**
         * Creates a centred table cell holding a clock icon coloured for a schedule status, with a tooltip.
         * A second (date) argument is accepted for compatibility and ignored.
         * @param {string} scheduleStatus - A getScheduleStatus() result; '' gives an empty cell.
         * @returns {HTMLTableCellElement} The cell, ready to append to a row.
         */
        function createScheduleIndicator(scheduleStatus /* dateStr unused, kept for API compat */) {
            const td = document.createElement('td');
            td.style.textAlign = 'center';
            if (!scheduleStatus) return td;
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'clock-icon');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'currentColor');
            svg.style.width = '20px';
            svg.style.height = '20px';
            const colors = { blue: '#2d9cdb', orange: '#F69133', red: '#C43046' };
            if (colors[scheduleStatus]) svg.style.color = colors[scheduleStatus];
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '1.8');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(path);
            td.appendChild(svg);
            const titles = { orange: 'Scheduled for today', red: 'Past due', blue: 'Scheduled this week' };
            if (titles[scheduleStatus]) td.title = titles[scheduleStatus];
            return td;
        }

        /**
         * Creates a table cell showing a row's availability: a padlock when committed, else a .status-circle in the status colour.
         * @param {object} row - Query row with availabilitystatus, fullitems, partialitems, noneitems and pendingitems.
         * @returns {HTMLTableCellElement} The cell, titled with getStatusTitle().
         */
        function createAvailabilityIndicator(row) {
            const td = document.createElement('td');
            const title = getStatusTitle(row.availabilitystatus, row.fullitems, row.partialitems, row.noneitems, row.pendingitems);
            if (row.availabilitystatus === 'committed') {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'status-icon-padlock');
                svg.setAttribute('viewBox', '0 0 16 16');
                svg.setAttribute('fill', 'currentColor');
                svg.style.color = '#F69133';
                svg.setAttribute('title', title);
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('fill-rule', 'evenodd');
                path.setAttribute('d', 'M5 6.5V4.5a3 3 0 1 1 6 0V6.5h1.5V4.5a4.5 4.5 0 0 0-9 0V6.5H5zM2.5 8A1.5 1.5 0 0 1 4 6.5h8A1.5 1.5 0 0 1 13.5 8v5.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V8zm10 0a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v5.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V8z');
                svg.appendChild(path);
                td.appendChild(svg);
            } else {
                const circle = document.createElement('div');
                circle.className = 'status-circle ' + (row.availabilitystatus || 'gray');
                circle.title = title;
                td.appendChild(circle);
            }
            return td;
        }

        /**
         * Appends a timestamped line to the #debugLog console, only while debug mode is on (see DEBUG_MODE).
         * The message is inserted as HTML (callers may log markup), so escape untrusted text with
         * FBLib.Common.escHtml(): SQL, record names, error messages. Does nothing without a #debugLog element.
         * @param {string} message - The text to log, as HTML.
         * @param {string} [type] - 'info' | 'success' | 'warning' | 'error' | 'query'; sets the colour.
         * @param {string} [tileId] - Shown as a [tileId] prefix.
         */
        function debugLog(message, type, tileId) {
            if (!_debugMode()) return;
            const logDiv = document.getElementById('debugLog');
            if (!logDiv) return;
            const placeholder = logDiv.querySelector('[style*="italic"]');
            if (placeholder) logDiv.innerHTML = '';
            const colors = { info: '#60a5fa', success: '#34d399', warning: '#fbbf24', error: '#f87171', query: '#a78bfa' };
            const ts = new Date().toLocaleTimeString();
            const tilePrefix = tileId ? `[${tileId}] ` : '';
            const entry = document.createElement('div');
            entry.style.marginBottom = '4px';
            entry.innerHTML =
                `<span style="color: #64748b;">[${ts}]</span> ` +
                `<span style="color: #94a3b8;">${tilePrefix}</span>` +
                `<span style="color: ${colors[type] || '#e2e8f0'};">${message}</span>`;
            logDiv.appendChild(entry);
            logDiv.scrollTop = logDiv.scrollHeight;
        }

        /** Clears the #debugLog console, leaving a "Log cleared..." placeholder. */
        function clearDebugLog() {
            const logDiv = document.getElementById('debugLog');
            if (logDiv) logDiv.innerHTML = '<div style="color: #64748b; font-style: italic;">Log cleared...</div>';
        }

        // ============================================================
        // DEBUG DRAWER — bottom-anchored, full-width, expandable
        // ------------------------------------------------------------
        // Modern replacement for the older inline "debug console" card
        // that some reports still embed in their page flow. The drawer
        // is fixed to the bottom of the viewport (out of the way), so
        // a long report's main content isn't pushed around by debug
        // output. It has three states:
        //
        //   - hidden    : container display:none (api.hide() — used when
        //                 the user's "debug mode" setting is off)
        //   - collapsed : visible bar only (the toggle header); content
        //                 hidden (api.collapse())
        //   - expanded  : header + scrollable log + diagnostics bar
        //                 (api.expand())
        //
        // Drag-to-resize on the thin top-edge handle lets the user
        // grow the log pane up to 70vh.
        //
        // Why not auto-mount?  Many reports never need debug; injecting
        // ~10kB of DOM + style on every page load is wasted bytes. We
        // require an explicit FBLib.Common.mountDebugDrawer() call from
        // the host so the cost is only paid where actually used. The
        // call is idempotent — repeat invocations return the same API.
        //
        // Element id `#debugLog` is preserved on purpose: the existing
        // Common.debugLog() / Common.clearDebugLog() find their target
        // by that id, so reports that already log via those functions
        // get drawer output for free as soon as mountDebugDrawer() runs.
        // ============================================================
        let _drawerMounted = false;
        let _drawerContainer = null;
        let _drawerApi = null;

        // CSS is injected once per page via a <style> tag with a known id.
        // Everything below `.fblib-debug-drawer` to keep this self-contained
        // (no clashes with host-page CSS). `#debugLog` is intentionally
        // scoped so a host page that defines its own #debugLog styles
        // gets overridden inside the drawer but not elsewhere.
        const _DRAWER_CSS =
            '.fblib-debug-drawer{position:fixed;bottom:0;left:0;right:0;z-index:9000;' +
                'font-family:\'Inter\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;' +
                'background:transparent;display:none}' +
            '.fblib-debug-drawer.is-visible{display:block}' +
            '.fblib-debug-drawer .fblib-debug-resize{height:5px;background:transparent;cursor:ns-resize;border-top:2px solid #E3E3E3}' +
            '.fblib-debug-drawer .fblib-debug-shell{background:#fff;box-shadow:0 -4px 24px rgba(16,16,16,.12)}' +
            '.fblib-debug-drawer .fblib-debug-toggle{width:100%;padding:8px 16px;display:flex;align-items:center;' +
                'justify-content:space-between;background:none;border:none;cursor:pointer;text-align:left;font-family:inherit}' +
            '.fblib-debug-drawer .fblib-debug-toggle:hover{background:#F7F7F7}' +
            '.fblib-debug-drawer .fblib-debug-titlegrp{display:flex;align-items:center;gap:8px}' +
            '.fblib-debug-drawer .fblib-debug-title{font-size:12px;font-weight:600;color:#506872}' +
            '.fblib-debug-drawer .fblib-debug-subtitle{font-size:11px;color:#8FA1A7;font-weight:400}' +
            '.fblib-debug-drawer .fblib-debug-chevron{transition:transform .2s ease;transform:rotate(180deg)}' +
            '.fblib-debug-drawer.is-open .fblib-debug-chevron{transform:rotate(0deg)}' +
            '.fblib-debug-drawer .fblib-debug-content{display:none;border-top:1px solid #E3E3E3;background:#fff}' +
            '.fblib-debug-drawer.is-open .fblib-debug-content{display:block}' +
            '.fblib-debug-drawer .fblib-debug-diag{background:#0E3646;padding:6px 14px;' +
                'display:flex;align-items:center;justify-content:space-between;color:#C6D0D4}' +
            '.fblib-debug-drawer .fblib-debug-diag-label{font-size:11px;font-family:ui-monospace,\'Courier New\',monospace;color:#8FA1A7}' +
            '.fblib-debug-drawer .fblib-debug-diag-actions{display:flex;align-items:center;gap:10px}' +
            '.fblib-debug-drawer .fblib-debug-action{font-size:11px;color:#8FA1A7;background:none;border:none;' +
                'cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:4px;font-family:inherit}' +
            '.fblib-debug-drawer .fblib-debug-action:hover{color:#fff}' +
            '.fblib-debug-drawer #debugLog{background:#0B3140;color:#e2e8f0;padding:10px 14px;' +
                'font-family:ui-monospace,\'Courier New\',monospace;font-size:11px;' +
                'height:200px;overflow-y:auto;line-height:1.5;white-space:pre-wrap}';

        function _injectDrawerCss() {
            if (document.getElementById('fbLibDebugDrawerStyle')) return;
            const style = document.createElement('style');
            style.id = 'fbLibDebugDrawerStyle';
            style.textContent = _DRAWER_CSS;
            document.head.appendChild(style);
        }

        // SVG kept inline so the drawer is self-contained — no external
        // sprite or icon-font dependency.
        const _DRAWER_HTML =
            '<div class="fblib-debug-resize" title="Drag to resize"></div>' +
            '<div class="fblib-debug-shell">' +
                '<button type="button" class="fblib-debug-toggle">' +
                    '<span class="fblib-debug-titlegrp">' +
                        '<svg width="14" height="14" fill="none" stroke="#506872" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">' +
                            '<path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>' +
                        '<span class="fblib-debug-title">Debug Console</span>' +
                        '<span class="fblib-debug-subtitle">Auto-scrolls to latest entry</span>' +
                    '</span>' +
                    '<svg class="fblib-debug-chevron" width="16" height="16" fill="none" stroke="#8FA1A7" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">' +
                        '<path d="M19 9l-7 7-7-7"/></svg>' +
                '</button>' +
                '<div class="fblib-debug-content">' +
                    '<div class="fblib-debug-diag">' +
                        '<span class="fblib-debug-diag-label">Fishbowl Connection Diagnostics</span>' +
                        '<span class="fblib-debug-diag-actions">' +
                            '<button type="button" class="fblib-debug-action" data-action="copy" title="Copy log to clipboard">' +
                                '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">' +
                                    '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
                                    '<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
                                'Copy</button>' +
                            '<button type="button" class="fblib-debug-action" data-action="clear" title="Clear log">Clear</button>' +
                        '</span>' +
                    '</div>' +
                    '<div id="debugLog">' +
                        '<span style="color:#475569;font-style:italic;">Waiting for application to initialize&hellip;</span>' +
                    '</div>' +
                '</div>' +
            '</div>';

        function _wireDrawerHandlers(container) {
            // Toggle expanded/collapsed on header click. We use a class
            // rather than toggling .style.display so the chevron's CSS
            // transition can drive off the same class.
            const toggle = container.querySelector('.fblib-debug-toggle');
            if (toggle) {
                toggle.addEventListener('click', function () {
                    container.classList.toggle('is-open');
                });
            }
            // Copy + clear: stopPropagation prevents the wrapping
            // header button from also receiving the click and toggling
            // the drawer closed.
            const copyBtn = container.querySelector('[data-action="copy"]');
            if (copyBtn) {
                copyBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const logDiv = document.getElementById('debugLog');
                    if (!logDiv) return;
                    const text = logDiv.innerText || logDiv.textContent || '';
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).catch(function () {});
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        document.body.appendChild(ta);
                        ta.select();
                        try { document.execCommand('copy'); } catch (_) {}
                        document.body.removeChild(ta);
                    }
                });
            }
            const clearBtn = container.querySelector('[data-action="clear"]');
            if (clearBtn) {
                clearBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    clearDebugLog();
                });
            }
            // Drag-to-resize. The handle is the thin strip along the
            // top edge of the drawer. We resize the inner #debugLog
            // element (not the whole drawer) so the diagnostics bar +
            // toggle header stay a fixed height.
            const handle = container.querySelector('.fblib-debug-resize');
            const logEl = container.querySelector('#debugLog');
            if (handle && logEl) {
                let resizing = false, startY = 0, startH = 0;
                handle.addEventListener('mousedown', function (e) {
                    resizing = true;
                    startY = e.clientY;
                    startH = logEl.offsetHeight;
                    document.body.style.userSelect = 'none';
                    e.preventDefault();
                });
                document.addEventListener('mousemove', function (e) {
                    if (!resizing) return;
                    const delta = startY - e.clientY;        // up-drag = positive delta
                    const minH = 80;
                    const maxH = Math.floor(window.innerHeight * 0.7);
                    logEl.style.height = Math.max(minH, Math.min(maxH, startH + delta)) + 'px';
                });
                document.addEventListener('mouseup', function () {
                    if (resizing) {
                        resizing = false;
                        document.body.style.userSelect = '';
                    }
                });
            }
        }

        function _buildDrawerApi(container) {
            return {
                show:      function () { container.classList.add('is-visible'); },
                hide:      function () { container.classList.remove('is-visible'); },
                toggle:    function () { container.classList.toggle('is-visible'); },
                expand:    function () { container.classList.add('is-open'); container.classList.add('is-visible'); },
                collapse:  function () { container.classList.remove('is-open'); },
                isOpen:    function () { return container.classList.contains('is-open'); },
                isVisible: function () { return container.classList.contains('is-visible'); },
                element:   container
            };
        }

        // ================================================================
        // DROP-DOWN DRAWER  —  the standard "settings / help / filters"
        // pattern used across all BI reports. Replaces the older
        // right-side slide-out panel-overlay style (which we no longer use
        // — it took the whole viewport hostage and felt heavy for what is
        // usually a quick toggle).
        //
        // SHAPE
        //   The drawer is a sibling of <header>: it lives in the document
        //   flow and pushes the rest of the page down when it opens. There
        //   is no backdrop; clicking outside does not close it (that's the
        //   filter-drawer convention from PurchaseOrderSummary, which we
        //   adopted as the standard because users like to adjust filters
        //   while looking at the table).
        //
        // CANONICAL CSS  (copy into the report's <style> block)
        //   .fb-drawer {
        //       background: #F7F7F7; border-bottom: 1px solid #E3E3E3;
        //       box-shadow: 0 6px 12px -8px rgba(16,16,16,0.14);
        //       display: none; flex-shrink: 0;
        //   }
        //   .fb-drawer.open { display: block; }
        //   .fb-drawer-head {
        //       display: flex; justify-content: space-between; align-items: center;
        //       padding: 10px 18px; border-bottom: 1px solid #E3E3E3;
        //       background: var(--menu-bg); color: #fff;   /* brand navy band */
        //   }
        //   .fb-drawer-head h2 { margin:0; font-size:14px; color:#fff; font-weight:700; }
        //   .fb-drawer-close { background: transparent; border: none; font-size: 22px;
        //       cursor: pointer; color: #fff; line-height: 1; padding: 0 6px; opacity: 0.9; }
        //   .fb-drawer-close:hover { opacity: 1; }
        //   .fb-drawer-body { padding: 14px 18px; max-height: 65vh; overflow-y: auto; }
        //   .fb-drawer-foot { padding: 10px 18px; border-top: 1px solid #E3E3E3;
        //       background: #fff; display: flex; gap: 8px; justify-content: space-between;
        //       align-items: center; flex-wrap: wrap; }
        //   .hdr-btn.active { background: #DEEAF4; border-color: #CBE5FB;
        //       color: var(--color-primary-dark); }
        //
        // CANONICAL MARKUP  (drawer must be a SIBLING of <header>, NOT a child of body root only)
        //   <header>
        //     ...
        //     <button id="setBtn" class="hdr-btn" onclick="FBLib.Common.toggleDrawer('setOverlay')">⚙</button>
        //   </header>
        //   <div id="setOverlay" class="fb-drawer">
        //     <div class="fb-drawer-head">
        //       <h2>Settings</h2>
        //       <button class="fb-drawer-close" onclick="FBLib.Common.closeDrawer('setOverlay')">&times;</button>
        //     </div>
        //     <div class="fb-drawer-body">…content…</div>
        //     <div class="fb-drawer-foot">…optional buttons…</div>
        //   </div>
        //
        // BEHAVIOR
        //   - One open at a time: opening a drawer closes every other open
        //     drawer (registered or not) and any open push-down panel
        //     (see PUSH-DOWN PANEL below), and opening a panel closes them too.
        //   - A press anywhere outside the open drawer or panel closes it:
        //     on the scrim, on the header, on another header button. Its own
        //     trigger button is left to toggle it, and modals, toasts and
        //     the debug console don't count as outside. A drawer closes on
        //     the press; a push-down panel once the press is over, after
        //     the pressed element's click has run (closing it at once slid
        //     the page up from under the pointer and the click was lost:
        //     a row link, a group row, a Retry button).
        //   - The trigger button gets `.active` while its drawer is open.
        //   - ESC closes whichever drawer or panel is open.
        //
        // API
        //   FBLib.Common.registerDrawer({
        //       id: 'setOverlay',          // the drawer element's id
        //       triggerId: 'setBtn',       // the header button that toggles it (optional)
        //       onBeforeOpen: () => {},    // hook — e.g. hydrate form values
        //       onAfterClose: () => {}     // hook — rarely needed
        //   });
        //   FBLib.Common.openDrawer(id) / closeDrawer(id) / toggleDrawer(id) / closeAllDrawers();
        // ================================================================
        const _drawers = {};
        /**
         * Registers a drop-down drawer (.fb-drawer) so it joins the shared rules: one open at a time, outside press and ESC close.
         * See the DROP-DOWN DRAWER block above for the canonical markup and CSS.
         * @param {object} cfg - Drawer config.
         * @param {string} cfg.id - The drawer element's id.
         * @param {string} [cfg.triggerId] - The header button that toggles it; it gets .active while the drawer is open.
         * @param {Function} [cfg.onBeforeOpen] - Called just before it opens (e.g. to hydrate form values).
         * @param {Function} [cfg.onAfterClose] - Called after it closes.
         * @returns {?{open: Function, close: Function, toggle: Function}} Helpers bound to this drawer, or null without cfg.id.
         */
        function registerDrawer(cfg) {
            if (!cfg || !cfg.id) return null;
            _drawers[cfg.id] = {
                id: cfg.id,
                triggerId: cfg.triggerId || null,
                onBeforeOpen: typeof cfg.onBeforeOpen === 'function' ? cfg.onBeforeOpen : null,
                onAfterClose: typeof cfg.onAfterClose === 'function' ? cfg.onAfterClose : null
            };
            return { open: function () { openDrawer(cfg.id); },
                     close: function () { closeDrawer(cfg.id); },
                     toggle: function () { toggleDrawer(cfg.id); } };
        }
        // Shared, lazily-created scrim that greys the page behind an open drawer.
        // Reused across every registered drawer; clicking it closes them all.
        function _fbDrawerScrim() {
            var s = document.getElementById('fbDrawerScrim');
            if (!s && document.body) {
                s = document.createElement('div');
                s.id = 'fbDrawerScrim';
                s.className = 'fb-drawer-scrim';
                s.addEventListener('click', function () { closeAllDrawers(); });
                document.body.appendChild(s);
            }
            return s;
        }
        // Sync --fb-drawer-top to the live header/topbar height so the fixed drawer
        // + scrim drop just below the header (which stays clear + clickable).
        // offsetHeight is layout px — matches the fixed `top` and stays correct
        // under a page's body-zoom. The header is the one holding the drawer's
        // trigger, else the first .topbar, else the first <header>; a candidate
        // counts only while it sits at the top of the page, so a page with both
        // chromes (a REPORT header and a .topbar further down) measures the
        // header its drawers drop from.
        function _fbSyncDrawerTop(id) {
            var cands = [];
            var trig = id ? _fbTriggerEl(id) : null;
            if (trig) cands.push(trig.closest('.topbar'), trig.closest('header'));
            cands = cands.concat(Array.prototype.slice.call(document.querySelectorAll('.topbar')),
                                 Array.prototype.slice.call(document.querySelectorAll('header')));
            var hdr = null;
            for (var i = 0; i < cands.length && !hdr; i++) {
                var c = cands[i];
                if (!c || !c.offsetHeight) continue;
                var t = c.getBoundingClientRect().top;
                if (t > -2 && t < 2) hdr = c;
            }
            if (!hdr) hdr = document.querySelector('.topbar') || document.querySelector('header');
            var top = hdr ? hdr.offsetHeight : 56;
            try { document.documentElement.style.setProperty('--fb-drawer-top', top + 'px'); } catch (_) {}
        }
        // The button that opens drawer `id`: its registered trigger, else an
        // onclick that names it.
        function _fbTriggerEl(id) {
            var cfg = _drawers[id];
            var b = cfg && cfg.triggerId ? document.getElementById(cfg.triggerId) : null;
            if (b) return b;
            var els = document.querySelectorAll('[onclick]');
            for (var i = 0; i < els.length; i++) {
                if (els[i].getAttribute('onclick').indexOf("'" + id + "'") !== -1 && els[i].offsetHeight) return els[i];
            }
            return null;
        }
        // Every open drawer in the page, registered or not.
        function _fbOpenDrawerEls() {
            return Array.prototype.slice.call(document.querySelectorAll('.fb-drawer.open'));
        }
        function _fbAnyDrawerOpen() { return _fbOpenDrawerEls().length > 0; }
        /**
         * Opens a drawer by id after closing every other drawer and push-down panel, and shows the page scrim.
         * Runs the drawer's onBeforeOpen hook and marks its trigger button .active.
         * @param {string} id - The drawer element's id (registered or not).
         */
        function openDrawer(id) {
            // Only one open at a time: close every other drawer and any panel.
            _fbOpenDrawerEls().forEach(function (d) { if (d.id !== id) closeDrawer(d.id); });
            closeAllPanels();
            const cfg = _drawers[id];
            try { if (cfg && cfg.onBeforeOpen) cfg.onBeforeOpen(); } catch (_) {}
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('open');
                // Overlay behaviour: position under the header + grey the page behind.
                _fbSyncDrawerTop(id);
                var scrim = _fbDrawerScrim();
                if (scrim) scrim.classList.add('open');
            }
            if (cfg && cfg.triggerId) {
                const btn = document.getElementById(cfg.triggerId);
                if (btn) btn.classList.add('active');
            }
        }
        /**
         * Closes a drawer by id, clears its trigger's .active, hides the scrim once none is open and runs onAfterClose.
         * @param {string} id - The drawer element's id.
         */
        function closeDrawer(id) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('open');
            const cfg = _drawers[id];
            if (cfg && cfg.triggerId) {
                const btn = document.getElementById(cfg.triggerId);
                if (btn) btn.classList.remove('active');
            }
            // Hide the shared scrim once the last drawer has closed.
            if (!_fbAnyDrawerOpen()) {
                var scrim = document.getElementById('fbDrawerScrim');
                if (scrim) scrim.classList.remove('open');
            }
            try { if (cfg && cfg.onAfterClose) cfg.onAfterClose(); } catch (_) {}
        }
        /**
         * Opens a drawer when it is closed, otherwise closes it; does nothing if the element doesn't exist.
         * @param {string} id - The drawer element's id.
         */
        function toggleDrawer(id) {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.classList.contains('open')) closeDrawer(id);
            else openDrawer(id);
        }
        /** Closes every open .fb-drawer on the page, registered or not. */
        function closeAllDrawers() {
            _fbOpenDrawerEls().forEach(function (d) { closeDrawer(d.id); });
        }
        // Global ESC handler — bind once. Idempotent guard via _escBound flag.
        if (typeof document !== 'undefined' && !window._fbLibDrawerEscBound) {
            window._fbLibDrawerEscBound = true;
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { closeAllDrawers(); closeAllPanels(); }
            });
        }
        // Is `target` the button that toggles drawer/panel `id`? Its own
        // trigger must be left to toggle it, or a press would close it and
        // the click re-open it. Matches the registered trigger, or any
        // onclick that names the id.
        function _fbIsTriggerFor(target, id, triggerId) {
            if (triggerId) {
                const b = document.getElementById(triggerId);
                if (b && b.contains(target)) return true;
            }
            const el = target.closest('[onclick]');
            return !!(el && id && el.getAttribute('onclick').indexOf("'" + id + "'") !== -1);
        }
        // Outside-press handler — bind once. Capture phase, so it runs before
        // the pressed element's own handlers (which may re-render or remove
        // it) and before another trigger opens its drawer.
        if (typeof document !== 'undefined' && !window._fbLibOutsideBound) {
            window._fbLibOutsideBound = true;
            document.addEventListener('pointerdown', function (e) {
                const t = e.target;
                if (!t || !t.closest || !document.documentElement.contains(t)) return;
                // UI that floats above everything isn't "outside"; nor is the
                // row-cap notice or a Columns button and its popover (closing
                // a panel would slide them from under the pointer and swallow
                // the click).
                if (t.closest('.modal-overlay, .toast-container, .fblib-debug-drawer, .app-tooltip, .rowcap-note, .fb-colmenu-btn, .fb-colmenu-pop')) return;
                _fbOpenDrawerEls().forEach(function (d) {
                    if (d.contains(t) || _fbIsTriggerFor(t, d.id, (_drawers[d.id] || {}).triggerId)) return;
                    closeDrawer(d.id);
                });
                // A push-down panel is in the page flow: closing it now would
                // move what was pressed, and its click would be lost. Close it
                // once the press is over, after the click has run, unless
                // something toggled it meanwhile (a button that opens it).
                const later = _fbOpenPanelIds().filter(function (pid) {
                    const p = document.getElementById(pid);
                    return !(p.contains(t) || _fbIsTriggerFor(t, pid, _panels[pid].triggerId));
                });
                if (later.length) _fbClosePanelsAfterPress(later);
            }, true);
        }
        function _fbClosePanelsAfterPress(ids) {
            const seq = ids.map(function (pid) { return (_panels[pid] || {}).seq || 0; });
            let done = false;
            function close() {
                if (done) return;
                done = true;
                window.removeEventListener('pointerup', onUp, true);
                window.removeEventListener('pointercancel', onUp, true);
                ids.forEach(function (pid, i) {
                    const p = document.getElementById(pid);
                    if (p && p.classList.contains('open') && ((_panels[pid] || {}).seq || 0) === seq[i]) togglePanel(pid, false);
                });
            }
            // The click follows pointerup in the same task: a 0 ms timer runs after it.
            function onUp() { setTimeout(close, 0); }
            window.addEventListener('pointerup', onUp, true);
            window.addEventListener('pointercancel', onUp, true);
        }

        // ================================================================
        // PUSH-DOWN PANEL  —  the report-chrome filter panel (fb-styles §35,
        // .rpt-filters). Unlike a drawer it sits in the page flow under the
        // header and pushes the table down; it caps its own height and
        // scrolls, and its multi-selects float above it (see FLOATING in
        // the multi-select block). The dashboard idiom uses drawers instead.
        //
        // CANONICAL MARKUP
        //   <button id="filtersBtn" class="hdr-btn" onclick="FBLib.Common.togglePanel('filtersPanel')">Filters</button>
        //   …
        //   <div id="filtersPanel" class="rpt-filters">
        //     <div class="rpt-fgrid">
        //       <div class="rpt-fgroup">
        //         <div class="rpt-fgroup-title">When</div>
        //         <div><div class="rpt-flabel">Date range</div><select>…</select></div>
        //       </div>
        //     </div>
        //   </div>
        //
        // API
        //   FBLib.Common.registerPanel({ id: 'filtersPanel', triggerId: 'filtersBtn', onToggle: open => {} });
        //   FBLib.Common.togglePanel(id[, open])   // returns the new state
        //   FBLib.Common.closeAllPanels()
        //   The trigger gets `.active` while the panel is open; closing it
        //   closes any open multi-select. A panel takes part in the drawers'
        //   one-open-at-a-time and outside-press rules (see DROP-DOWN DRAWER):
        //   a press outside closes it once the press is over, so the element
        //   pressed (a row link, a group row) still gets its click. Register
        //   it so the rules know its trigger.
        // ================================================================
        const _panels = {};
        /**
         * Registers a push-down filter panel (.rpt-filters) so it joins the drawers' one-open-at-a-time and outside-press rules.
         * See the PUSH-DOWN PANEL block above for the canonical markup.
         * @param {object} cfg - Panel config.
         * @param {string} cfg.id - The panel element's id.
         * @param {string} [cfg.triggerId] - The button that toggles it; it gets .active while the panel is open.
         * @param {Function} [cfg.onToggle] - Called with the new open state (boolean) after each toggle.
         * @returns {?{toggle: Function}} toggle(open?) bound to this panel, or null without cfg.id.
         */
        function registerPanel(cfg) {
            if (!cfg || !cfg.id) return null;
            _panels[cfg.id] = { triggerId: cfg.triggerId || null, onToggle: typeof cfg.onToggle === 'function' ? cfg.onToggle : null,
                                seq: (_panels[cfg.id] && _panels[cfg.id].seq) || 0 };
            return { toggle: function (open) { return togglePanel(cfg.id, open); } };
        }
        function _fbOpenPanelIds() {
            return Object.keys(_panels).filter(function (pid) {
                const e = document.getElementById(pid); return e && e.classList.contains('open');
            });
        }
        /**
         * Closes every open registered push-down panel.
         * @param {string} [exceptId] - A panel id to leave open.
         */
        function closeAllPanels(exceptId) {
            _fbOpenPanelIds().forEach(function (pid) { if (pid !== exceptId) togglePanel(pid, false); });
        }
        /**
         * Opens, closes or flips a push-down panel. Opening closes all drawers and other panels; closing closes open multi-selects.
         * @param {string} id - The panel element's id (registered without a trigger on first use if needed).
         * @param {boolean} [open] - true to open, false to close; omit to flip.
         * @returns {boolean} The new open state; false when the element doesn't exist.
         */
        function togglePanel(id, open) {
            const el = document.getElementById(id);
            if (!el) return false;
            if (!_panels[id]) _panels[id] = { triggerId: null, onToggle: null };
            _panels[id].seq = (_panels[id].seq || 0) + 1;
            const next = open === undefined ? !el.classList.contains('open') : !!open;
            // Only one open at a time: opening a panel closes drawers and other panels.
            if (next) { closeAllDrawers(); closeAllPanels(id); }
            el.classList.toggle('open', next);
            const cfg = _panels[id] || {};
            const btn = cfg.triggerId ? document.getElementById(cfg.triggerId) : null;
            if (btn) btn.classList.toggle('active', next);
            if (!next) { try { _msCloseAll(); } catch (_) {} }
            if (cfg.onToggle) { try { cfg.onToggle(next); } catch (_) {} }
            return next;
        }

        // ================================================================
        // MULTI-SELECT DROPDOWN  —  canonical "filter by a set of values"
        // widget shared across report filter drawers. Visually + behaviourally
        // a port of the .ms-* implementation in PurchaseOrderSummary.htm, but
        // lifted up so new reports can adopt it with two lines of JS instead
        // of 80 lines of copy-paste.
        //
        // CANONICAL MARKUP  (host page must provide this once per multi-select)
        //   <div class="ms-container" id="statusMs">
        //     <div class="ms-trigger" id="statusMs-trigger">
        //       <span class="ms-placeholder" id="statusMs-placeholder">Select…</span>
        //     </div>
        //     <div class="ms-dropdown hidden" id="statusMs-dropdown">
        //       <div class="ms-search"><input type="text" id="statusMs-search" placeholder="Search…"/></div>
        //       <div class="ms-actions">
        //         <span id="statusMs-all">Select All</span>
        //         <span id="statusMs-clear">Clear All</span>
        //       </div>
        //       <div class="ms-list" id="statusMs-list"></div>
        //     </div>
        //   </div>
        //
        // CANONICAL CSS  (drop into the page's <style> block; or use the inline
        // pattern from PurchaseOrderSummary.htm lines 19–44 verbatim.)
        //   .ms-container { position: relative; }
        //   .ms-trigger   { display:flex; align-items:center; flex-wrap:nowrap; gap:3px;
        //                   border:1px solid #e2e8f0; border-radius:6px; padding:3px 8px;
        //                   background:white; height:30px; overflow:hidden; cursor:pointer; font-size:12px; }
        //   .ms-trigger:hover { border-color:#9ca3af; }
        //   .ms-tag       { background:#dbeafe; color:#1d4ed8; padding:1px 5px; border-radius:3px;
        //                   font-size:11px; display:flex; align-items:center; gap:2px; white-space:nowrap; }
        //   .ms-tag-x     { cursor:pointer; font-weight:bold; }
        //   .ms-placeholder { color:#9ca3af; }
        //   .ms-dropdown  { position:absolute; z-index:500; top:calc(100% + 2px); left:0; right:0;
        //                   min-width:220px; background:white; border:1px solid #d1d5db;
        //                   border-radius:6px; box-shadow:0 6px 20px rgba(0,0,0,0.13);
        //                   display:flex; flex-direction:column; max-height:280px; }
        //   .ms-search input { width:100%; border:1px solid #d1d5db; border-radius:4px;
        //                      padding:4px 8px; font-size:12px; outline:none; }
        //   .ms-actions   { padding:3px 10px; border-bottom:1px solid #f3f4f6;
        //                   display:flex; gap:10px; font-size:11px; }
        //   .ms-actions span { color:#3b82f6; cursor:pointer; }
        //   .ms-list      { overflow-y:auto; flex:1; }
        //   .ms-item      { display:flex; align-items:center; gap:8px; padding:5px 10px;
        //                   cursor:pointer; font-size:12px; }
        //   .ms-item:hover { background:#eff6ff; }
        //   .ms-empty     { padding:12px; color:#9ca3af; font-size:12px; text-align:center; }
        //
        // API
        //   const ms = FBLib.Common.MultiSelect.create({
        //       containerId: 'statusMs',
        //       items: [{ value: 20, label: 'Issued' }, { value: 25, label: 'In Progress' }],
        //       selected: [20],         // optional initial selection
        //       placeholder: 'All statuses',
        //       maxTags: 3,              // how many tags to show before "+N more"
        //       onChange: selected => { /* every selection mutation */ },
        //       onOpen:   api => { /* optional — fires as the dropdown opens */ },
        //       onClose:  selected => { /* optional — fires once per real close */ },
        //       flipUp:   true           // optional — panel flips above the trigger
        //                                // when it would run past the viewport bottom
        //   });
        //
        //   FLOATING: a widget inside a box that scrolls or clips (a drawer
        //   body, a height-capped filter panel) floats its dropdown with
        //   position:fixed while open, so the box can't clip it and it isn't
        //   hidden behind the drawer's edge. It opens above the trigger when
        //   there is more room there, follows the trigger as the box scrolls,
        //   and closes once the trigger scrolls out of the box. Automatic: no
        //   option, and widgets outside such a box are unchanged.
        //   ms.getSelected();           // → array of values
        //   ms.setSelected([20, 25]);   // replace selection programmatically
        //   ms.setItems(newItems);      // swap the option list (e.g. cascading dropdowns)
        //   ms.open() / ms.close();
        //   FBLib.Common.MultiSelect.get(containerId);   // registry lookup
        //   FBLib.Common.MultiSelect.closeAll();         // close every instance
        //
        //   NOTE: there is no `searchable` option — search is enabled by
        //   simply including the `-search` input in the markup (omit the
        //   .ms-search block for a searchless dropdown).
        //
        // BEHAVIOUR
        //   • Only one multi-select is open at a time (clicking another closes the previous).
        //   • The dropdown closes on outside-click.
        //   • The search input filters the list case-insensitively on .label.
        //   • Selected values render as inline tags on the trigger; clicking a tag's × removes it.
        //   • onChange fires on every selection mutation including Select-All / Clear-All / tag-x.
        //     Do NOT run a query in onChange (it fires per checkbox) — use onClose for
        //     "query once per dropdown session" semantics.
        //   • setSelected / setItems do NOT fire onChange (hydration-safe).
        // ================================================================
        const _msRegistry = {};
        let _msActive = null;
        let _msOutsideBound = false;

        function _msEnsureOutsideClick() {
            if (_msOutsideBound) return;
            _msOutsideBound = true;
            document.addEventListener('click', function (e) {
                if (!_msActive) return;
                const cont = document.getElementById(_msActive);
                if (cont && !cont.contains(e.target)) {
                    _msRegistry[_msActive] && _msRegistry[_msActive].close();
                }
            });
        }

        /**
         * Creates a multi-select dropdown on host markup (see the MULTI-SELECT DROPDOWN block above) and registers it.
         * onChange fires on every toggle, so query from onClose. setSelected and setItems don't fire onChange.
         * @param {object} opts - Widget options.
         * @param {string} opts.containerId - The .ms-container id; children are id + '-trigger', '-dropdown', '-list', etc.
         * @param {Array<object|string|number>} [opts.items] - Options { value, label, tagLabel?, sub?, group? }, or bare values.
         * @param {Array} [opts.selected] - Values selected initially.
         * @param {string} [opts.placeholder] - Text shown when nothing is selected (default "Select...").
         * @param {number} [opts.maxTags=3] - Tags shown on the trigger before "+N more".
         * @param {Function} [opts.onChange] - Called with the selected values after every change.
         * @param {Function} [opts.onOpen] - Called with the widget API as the dropdown opens.
         * @param {Function} [opts.onClose] - Called with the selected values once per real close.
         * @param {boolean} [opts.flipUp=false] - Open above the trigger when it would run past the viewport bottom.
         * @returns {object} API: getSelected(), setSelected(vals), setItems(items), getItems(), open(), close(), toggle(), element.
         * @throws {Error} When the container or its trigger, dropdown or list child is missing.
         */
        function _msCreate(opts) {
            if (!opts || !opts.containerId) throw new Error('MultiSelect.create: containerId required');
            const containerId = opts.containerId;
            const container = document.getElementById(containerId);
            if (!container) throw new Error('MultiSelect.create: #' + containerId + ' not found');

            // The host may provide either the canonical id-suffix form
            // (`statusMs-trigger`) or the legacy positional form (the
            // PurchaseOrderSummary pattern uses `statusTrigger`). We accept
            // either by stripping a trailing "Ms" / "-ms" / "_ms" if present
            // (the summary reports use hyphenated container ids like
            // `cust-ms` with children `custTrigger`, `custList`, …).
            const idBase = containerId.replace(/[-_]?ms$/i, '');
            function q(suffix) {
                return document.getElementById(containerId + '-' + suffix)
                    || document.getElementById(idBase + suffix.charAt(0).toUpperCase() + suffix.slice(1));
            }
            const triggerEl = q('trigger');
            const dropdownEl = q('dropdown');
            const placeholderEl = q('placeholder');
            const listEl = q('list');
            const allEl = q('all');
            const clearEl = q('clear');
            const searchEl = q('search');
            if (!triggerEl || !dropdownEl || !listEl) {
                throw new Error('MultiSelect.create: required child elements missing under #' + containerId);
            }

            let items = (opts.items || []).map(_msNormItem);
            const selected = new Set((opts.selected || []).map(String));
            const placeholder = opts.placeholder || 'Select…';
            const maxTags = (opts.maxTags == null) ? 3 : opts.maxTags;
            const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
            const onOpen  = typeof opts.onOpen  === 'function' ? opts.onOpen  : null;
            const onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
            const flipUp = !!opts.flipUp;
            let lastFilter = '';

            // Standalone (not only an api method) — _emit() and close() call it
            // directly. It previously existed ONLY on the api object, so the
            // bare reference in _emit threw a swallowed ReferenceError and
            // onChange never received the selection (fixed 2026-07).
            function getSelected() {
                const out = [];
                selected.forEach(function (v) {
                    // Round-trip back to the original value type where possible.
                    const item = items.find(function (o) { return String(o.value) === v; });
                    out.push(item ? item.value : v);
                });
                return out;
            }
            function _emit() { try { onChange(getSelected()); } catch (_) {} }
            function _filteredItems() {
                if (!lastFilter) return items;
                const f = lastFilter.toLowerCase();
                return items.filter(function (o) {
                    return String(o.label).toLowerCase().indexOf(f) !== -1 ||
                        (o.sub && String(o.sub).toLowerCase().indexOf(f) !== -1);
                });
            }
            function _renderList() {
                const visible = _filteredItems();
                listEl.innerHTML = '';
                if (!visible.length) {
                    listEl.innerHTML = '<div class="ms-empty">No items</div>';
                    return;
                }
                let lastGroup;
                visible.forEach(function (o) {
                    if (o.group != null && o.group !== lastGroup) {
                        if (lastGroup !== undefined) {
                            const sep = document.createElement('div');
                            sep.className = 'ms-sep';
                            listEl.appendChild(sep);
                        }
                        const hdr = document.createElement('div');
                        hdr.className = 'ms-group-hdr';
                        hdr.textContent = o.group;
                        listEl.appendChild(hdr);
                        lastGroup = o.group;
                    }
                    const row = document.createElement('div');
                    row.className = 'ms-item';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = selected.has(String(o.value));
                    row.appendChild(cb);
                    // Optional description sub-line: bold main label + a muted, smaller
                    // second line (also searchable). Falls back to a plain single line.
                    if (o.sub) {
                        const txt = document.createElement('span');
                        txt.style.cssText = 'display:flex;flex-direction:column;line-height:1.25;min-width:0;';
                        const main = document.createElement('span'); main.textContent = o.label; main.style.fontWeight = '600';
                        const sub = document.createElement('span'); sub.textContent = o.sub;
                        sub.style.cssText = 'font-size:11px;color:#748A94;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                        txt.appendChild(main); txt.appendChild(sub);
                        row.appendChild(txt);
                    } else {
                        const sp = document.createElement('span');
                        sp.textContent = o.label;
                        row.appendChild(sp);
                    }
                    row.addEventListener('click', function (e) {
                        e.stopPropagation();
                        const key = String(o.value);
                        if (selected.has(key)) selected.delete(key);
                        else selected.add(key);
                        cb.checked = selected.has(key);
                        _renderTrigger();
                        _emit();
                    });
                    listEl.appendChild(row);
                });
            }
            function _renderTrigger() {
                triggerEl.querySelectorAll('.ms-tag').forEach(function (t) { t.remove(); });
                const arr = [];
                selected.forEach(function (v) { arr.push(v); });
                if (!arr.length) {
                    if (placeholderEl) {
                        placeholderEl.textContent = placeholder;
                        placeholderEl.style.display = '';
                    }
                    return;
                }
                if (placeholderEl) placeholderEl.style.display = 'none';
                arr.slice(0, maxTags).forEach(function (v) {
                    const item = items.find(function (o) { return String(o.value) === v; });
                    const tag = document.createElement('span'); tag.className = 'ms-tag';
                    const lbl = document.createElement('span'); lbl.textContent = item ? (item.tagLabel || item.label) : v;
                    const x = document.createElement('span'); x.className = 'ms-tag-x'; x.textContent = '×';
                    x.addEventListener('click', function (e) {
                        e.stopPropagation();
                        selected.delete(v);
                        _renderTrigger();
                        if (!dropdownEl.classList.contains('hidden')) _renderList();
                        _emit();
                    });
                    tag.appendChild(lbl); tag.appendChild(x);
                    if (placeholderEl) triggerEl.insertBefore(tag, placeholderEl);
                    else triggerEl.appendChild(tag);
                });
                if (arr.length > maxTags) {
                    const more = document.createElement('span');
                    more.className = 'ms-tag';
                    more.style.cssText = 'background:#E3E3E3;color:#415157;';
                    more.textContent = '+' + (arr.length - maxTags) + ' more';
                    if (placeholderEl) triggerEl.insertBefore(more, placeholderEl);
                    else triggerEl.appendChild(more);
                }
            }
            // ---- Floating (see FLOATING above) ----
            // The nearest ancestor that scrolls or clips, or null.
            function _clipBox() {
                for (let el = container.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
                    const cs = getComputedStyle(el);
                    if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + ' ' + cs.overflowY)) return el;
                }
                return null;
            }
            let _floatBox = null;
            const _FLOAT_PROPS = ['position', 'top', 'bottom', 'left', 'right', 'width', 'maxHeight', 'zIndex'];
            function _place() {
                if (!_floatBox) return;
                const t = triggerEl.getBoundingClientRect();
                const box = _floatBox.getBoundingClientRect();
                // The trigger has scrolled out of its box: nothing to point at.
                if (t.bottom < box.top || t.top > box.bottom) { close(); return; }
                // Under a CSS body zoom getBoundingClientRect is in rendered px
                // but fixed offsets are layout px: divide by the render scale.
                const s = (triggerEl.offsetWidth && t.width) ? t.width / triggerEl.offsetWidth : 1;
                const vw = window.innerWidth, vh = window.innerHeight, gap = 2, edge = 8;
                const below = vh - t.bottom - gap - edge, above = t.top - gap - edge;
                const up = below < 200 && above > below;
                const room = Math.max(120, Math.min(280 * s, up ? above : below));
                const width = Math.max(t.width, 220 * s);
                const left = Math.max(edge, Math.min(t.left, vw - width - edge));
                const st = dropdownEl.style;
                st.position = 'fixed'; st.right = 'auto'; st.zIndex = '10050';
                st.left = (left / s) + 'px'; st.width = (width / s) + 'px'; st.maxHeight = (room / s) + 'px';
                if (up) { st.top = 'auto'; st.bottom = ((vh - t.top + gap) / s) + 'px'; }
                else    { st.bottom = 'auto'; st.top = ((t.bottom + gap) / s) + 'px'; }
            }
            function _float() {
                _floatBox = _clipBox();
                if (!_floatBox) return;
                _place();
                window.addEventListener('scroll', _place, true);   // capture: any scrolling box
                window.addEventListener('resize', _place);
            }
            function _unfloat() {
                if (!_floatBox) return;
                _floatBox = null;
                window.removeEventListener('scroll', _place, true);
                window.removeEventListener('resize', _place);
                _FLOAT_PROPS.forEach(function (p) { dropdownEl.style[p] = ''; });
            }

            function open() {
                if (_msActive && _msActive !== containerId) {
                    const prev = _msRegistry[_msActive];
                    if (prev) prev.close();
                }
                if (onOpen) { try { onOpen(api); } catch (_) {} }
                _msActive = containerId;
                dropdownEl.classList.remove('hidden');
                lastFilter = '';
                if (searchEl) { searchEl.value = ''; setTimeout(function () { searchEl.focus(); }, 0); }
                _renderList();
                _float();
                // Opt-in flip-up: when the panel would run past the bottom of
                // the viewport, anchor it above the trigger instead. Inline
                // top/bottom are reset on close so the default returns. A
                // floating panel has already chosen its side.
                if (flipUp && !_floatBox) {
                    dropdownEl.style.top = '';
                    dropdownEl.style.bottom = '';
                    const rect = dropdownEl.getBoundingClientRect();
                    if (rect.bottom > window.innerHeight - 8) {
                        dropdownEl.style.top = 'auto';
                        dropdownEl.style.bottom = 'calc(100% + 2px)';
                    }
                }
            }
            function close() {
                const wasOpen = !dropdownEl.classList.contains('hidden');
                dropdownEl.classList.add('hidden');
                _unfloat();
                if (flipUp) { dropdownEl.style.top = ''; dropdownEl.style.bottom = ''; }
                if (_msActive === containerId) _msActive = null;
                // onClose fires only on a real open→closed transition, so a
                // host wiring "re-query on close" isn't spammed by redundant
                // close() calls (e.g. closeAll during another widget's open).
                if (wasOpen && onClose) { try { onClose(getSelected()); } catch (_) {} }
            }
            function toggle() {
                if (dropdownEl.classList.contains('hidden')) open();
                else close();
            }

            // Wire trigger + actions.
            triggerEl.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
            // "Select All" acts on the CURRENTLY VISIBLE items — i.e. it respects an
            // active search filter (type "12:" then Select All ⇒ only the matching
            // options are selected, not the whole list). With no search active,
            // _filteredItems() returns every item, so the default behaviour is unchanged.
            if (allEl) allEl.addEventListener('click', function () {
                _filteredItems().forEach(function (o) { selected.add(String(o.value)); });
                _renderList(); _renderTrigger(); _emit();
            });
            if (clearEl) clearEl.addEventListener('click', function () {
                selected.clear();
                _renderList(); _renderTrigger(); _emit();
            });
            if (searchEl) searchEl.addEventListener('input', function () {
                lastFilter = searchEl.value;
                _renderList();
            });
            _msEnsureOutsideClick();

            const api = {
                getSelected: getSelected,
                setSelected: function (vals) {
                    selected.clear();
                    (vals || []).forEach(function (v) { selected.add(String(v)); });
                    _renderTrigger();
                    if (!dropdownEl.classList.contains('hidden')) _renderList();
                },
                setItems: function (newItems) {
                    items = (newItems || []).map(_msNormItem);
                    _renderList(); _renderTrigger();
                },
                getItems: function () { return items.slice(); },
                open: open, close: close, toggle: toggle,
                element: container
            };
            _msRegistry[containerId] = api;

            // Initial paint.
            _renderTrigger();
            return api;
        }

        function _msNormItem(it) {
            if (it == null) return { value: '', label: '' };
            if (typeof it === 'string' || typeof it === 'number') {
                return { value: it, label: String(it) };
            }
            return {
                value: it.value != null ? it.value : it.val,
                label: it.label != null ? it.label : (it.lbl != null ? it.lbl : String(it.value != null ? it.value : it.val)),
                // Optional short label for the selected-tag chip (falls back to label).
                // Lets a caller keep the tag compact ("num") while the list shows more.
                tagLabel: it.tagLabel != null ? it.tagLabel : null,
                // Optional muted second line under the label (e.g. a part description);
                // also matched by the in-dropdown search.
                sub: it.sub != null ? it.sub : null,
                group: it.group || it.fieldName || null
            };
        }

        /**
         * Looks up a multi-select created with MultiSelect.create().
         * @param {string} containerId - Its container id.
         * @returns {?object} The widget API, or null.
         */
        function _msGet(containerId) { return _msRegistry[containerId] || null; }

        /**
         * Closes every registered multi-select (each one that was open fires its onClose).
         * Lets a host's other dropdown widgets (e.g. a legacy CF-value dropdown) enforce mutual exclusion with fb-lib's.
         */
        function _msCloseAll() {
            Object.keys(_msRegistry).forEach(function (id) {
                try { _msRegistry[id].close(); } catch (_) {}
            });
        }

        /** Multi-select dropdown widget: create(opts), get(containerId) and closeAll(). */
        const MultiSelect = { create: _msCreate, get: _msGet, closeAll: _msCloseAll };

        // ================================================================
        // TOASTS, CONFIRM MODAL, TOOLTIPS, FILTER-STRIP DROP-DOWNS
        // (2026-10-20) — the copies every report carried (showToast, a
        // confirm modal, data-tip positioning, the .fdrop open / close),
        // lifted here. Each writes fb-styles' own markup (§12 .modal-overlay,
        // §13 .app-tooltip, §14 .toast, §26 .fdrop), so a page swaps its copy
        // for the call and looks the same. Template/Component_Gallery.htm
        // shows each one working.
        //
        // DOCUMENT OUTPUT (FB_LAUNCH.output 'pdf': report_btn's Print (App) /
        // Email (rich)): nothing may wait for a click or cover the page, so
        // toast() only logs, confirmModal() resolves false at once (and
        // logs), and tooltips() binds nothing. FB_DOC still reaches ready or
        // error on its own.
        //
        // API
        //   FBLib.Common.toast(html, type?, ms?) -> the .toast element (null in output)
        //       type 'info' (default) | 'success' | 'warn' | 'error'; ms default
        //       3500, 0 = stays until dismissed. `html` is HTML: escape text.
        //       Uses #toasts (or any .toast-container); creates one if missing.
        //   FBLib.Common.confirmModal({ title, html?, text?, okText?, cancelText?,
        //       danger?, note?, wide? }) -> Promise<boolean>
        //       true on OK; false on Cancel, the ×, Esc or a press on the
        //       backdrop. danger: a red OK (.ds-btn-danger) and the focus
        //       starts on Cancel. cancelText: false = an OK-only notice. For a
        //       write, list the payload in `html`.
        //   FBLib.Common.tooltips(root?) -> { hide }
        //       hover any [data-tip] under root (default: the page) for the
        //       §13 tooltip: data-tip (text, newlines kept), data-tip-title,
        //       data-tip-meta. Below the element, above when it doesn't fit,
        //       kept on screen; text is escaped. Idempotent per root.
        //   FBLib.Common.fdrop(el, { onChange?, onOpen?, onClose?, allText? })
        //       -> { open, close, toggle, isOpen, value, setValue, element }
        //       drives one §26 .fdrop: its .fdrop-btn opens it (one open at a
        //       time; a click outside or Esc closes it). Items with a checkbox
        //       = multi (value() is an array; [data-clear] clears); items with
        //       data-v = single (a click picks and closes). An optional
        //       .fd-val in the button shows the choice (allText when none).
        //       onChange(value) fires on every change.
        //   FBLib.Common.escHtml(s)    escape text for any of these (and debugLog)
        //   FBLib.Common.isOutput()    true in document output
        // ================================================================
        /**
         * Escapes text for HTML (& < > " ').
         * @param {*} s - The value; null and undefined become ''.
         * @returns {string} The escaped text.
         */
        function escHtml(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
        }
        /**
         * Is the page running as document output (window.FB_LAUNCH.output === 'pdf')? Then nothing may wait for a click.
         * @returns {boolean} True in document output.
         */
        function isOutput() {
            try { const l = window.FB_LAUNCH; return !!(l && typeof l === 'object' && l.output === 'pdf'); } catch (_) { return false; }
        }

        /**
         * Shows a §14 toast (the markup every report's showToast wrote). Logs instead in document output.
         * @param {string} html - The message, as HTML: escape text with escHtml().
         * @param {string} [type='info'] - 'info' | 'success' | 'warn' | 'error'.
         * @param {number} [ms=3500] - How long it stays; 0 = until dismissed.
         * @returns {?HTMLElement} The toast element, or null when nothing was shown.
         */
        function toast(html, type, ms) {
            type = type === 'warning' ? 'warn' : (type || 'info');
            if (isOutput()) {
                debugLog('toast (' + escHtml(type) + '): ' + html, type === 'warn' ? 'warning' : type);
                return null;
            }
            if (typeof document === 'undefined' || !document.body) return null;
            let host = document.getElementById('toasts') || document.querySelector('.toast-container');
            if (!host) {
                host = document.createElement('div');
                host.id = 'toasts';
                host.className = 'toast-container';
                document.body.appendChild(host);
            }
            const el = document.createElement('div');
            el.className = 'toast ' + type;
            const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warn' ? '!' : 'ℹ';
            el.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-msg">' + html + '</span>' +
                '<button type="button" class="toast-x" aria-label="Dismiss">&times;</button>';
            el.querySelector('.toast-x').onclick = function () { el.remove(); };
            host.appendChild(el);
            const dur = ms == null ? 3500 : Number(ms);
            if (dur > 0) setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 300); }, dur);
            return el;
        }

        /**
         * Asks a yes / no question in a §12 modal. Resolves false at once (and logs) in document output.
         * @param {object} opts - { title, html?, text?, okText?, cancelText?, danger?, note?, wide? }.
         * @returns {Promise<boolean>} True on OK; false on Cancel, the ×, Esc or a press on the backdrop.
         */
        function confirmModal(opts) {
            opts = opts || {};
            if (isOutput()) {
                debugLog('confirmModal "' + escHtml(opts.title || '') + '" skipped: document output never waits for a click', 'warning');
                return Promise.resolve(false);
            }
            if (typeof document === 'undefined' || !document.body) return Promise.resolve(false);
            const ov = document.createElement('div');
            ov.className = 'modal-overlay fb-confirm open';
            ov.setAttribute('role', 'dialog');
            ov.setAttribute('aria-modal', 'true');
            ov.innerHTML =
                '<div class="modal-card' + (opts.wide ? ' wide' : '') + '">' +
                    '<div class="modal-head"><h3></h3>' +
                        '<button type="button" class="close-x" data-fb-cancel aria-label="Cancel">&times;</button></div>' +
                    '<div class="modal-body"></div>' +
                    '<div class="modal-foot"><div class="left-grp"><span class="fb-confirm-note"></span></div>' +
                        '<div class="right-grp"><button type="button" class="ds-btn" data-fb-cancel></button>' +
                        '<button type="button" class="ds-btn ' + (opts.danger ? 'ds-btn-danger' : 'ds-btn-primary') + '" data-fb-ok></button></div></div>' +
                '</div>';
            ov.querySelector('h3').textContent = opts.title || 'Are you sure?';
            const body = ov.querySelector('.modal-body');
            if (opts.html != null) body.innerHTML = opts.html;
            else if (opts.text != null) body.textContent = opts.text;
            else body.style.display = 'none';
            ov.querySelector('.fb-confirm-note').textContent = opts.note || '';
            const okBtn = ov.querySelector('[data-fb-ok]');
            const cancelBtn = ov.querySelector('.right-grp [data-fb-cancel]');
            okBtn.textContent = opts.okText || opts.ok || 'OK';
            if (opts.cancelText === false) cancelBtn.style.display = 'none';
            else cancelBtn.textContent = opts.cancelText || 'Cancel';
            const before = document.activeElement;
            document.body.appendChild(ov);
            setTimeout(function () {
                try { (opts.danger && opts.cancelText !== false ? cancelBtn : okBtn).focus(); } catch (_) {}
            }, 0);
            return new Promise(function (resolve) {
                let done = false;
                function finish(v) {
                    if (done) return;
                    done = true;
                    window.removeEventListener('keydown', onKey, true);
                    ov.remove();
                    try { if (before && before.focus && document.documentElement.contains(before)) before.focus(); } catch (_) {}
                    resolve(v);
                }
                // Esc answers this modal only: a drawer or panel under it stays open.
                function onKey(e) {
                    if (e.key !== 'Escape') return;
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    finish(false);
                }
                ov.addEventListener('click', function (e) {
                    if (e.target === ov || e.target.closest('[data-fb-cancel]')) finish(false);
                    else if (e.target.closest('[data-fb-ok]')) finish(true);
                });
                window.addEventListener('keydown', onKey, true);
            });
        }

        let _tipEl = null, _tipBound = false;
        function _tipBox() {
            if (_tipEl && document.documentElement.contains(_tipEl)) return _tipEl;
            _tipEl = document.createElement('div');
            _tipEl.className = 'app-tooltip';
            _tipEl.id = 'fbAppTooltip';
            _tipEl.setAttribute('role', 'tooltip');
            document.body.appendChild(_tipEl);
            return _tipEl;
        }
        function _tipHide() { if (_tipEl) _tipEl.classList.remove('show'); }
        function _tipShow(el) {
            const tip = _tipBox();
            const title = el.getAttribute('data-tip-title'), meta = el.getAttribute('data-tip-meta');
            tip.innerHTML = (title ? '<span class="tt-title">' + escHtml(title) + '</span>' : '') +
                '<span class="tt-desc">' + escHtml(el.getAttribute('data-tip')) + '</span>' +
                (meta ? '<span class="tt-meta">' + escHtml(meta) + '</span>' : '');
            const r = el.getBoundingClientRect();
            const w = tip.offsetWidth, h = tip.offsetHeight, gap = 6;
            const vw = window.innerWidth, vh = window.innerHeight;
            const left = Math.max(8, Math.min(r.left, vw - w - 8));
            let top = r.bottom + gap;
            if (top + h > vh - 8 && r.top - gap - h >= 8) top = r.top - gap - h;   // no room below: above
            tip.style.left = left + 'px';
            tip.style.top = Math.max(8, Math.min(top, vh - h - 8)) + 'px';
            tip.classList.add('show');
        }
        /**
         * Shows the §13 tooltip on hover over any [data-tip] under root (data-tip-title, data-tip-meta optional). Nothing in document output.
         * @param {HTMLElement|string} [root=document] - Where to listen (an element or its id). Idempotent per root.
         * @returns {{hide: Function}} hide() hides the tooltip.
         */
        function tooltips(root) {
            const api = { hide: _tipHide };
            if (isOutput() || typeof document === 'undefined') return api;
            if (typeof root === 'string') root = document.getElementById(root);
            root = root || document;
            if (root._fbTips) return api;
            root._fbTips = true;
            let cur = null;
            root.addEventListener('mouseover', function (e) {
                const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
                if (el === cur) return;
                cur = el;
                if (!el || !el.getAttribute('data-tip')) { _tipHide(); return; }
                _tipShow(el);
            });
            root.addEventListener('mouseout', function (e) {
                if (cur && !(e.relatedTarget && cur.contains(e.relatedTarget))) { cur = null; _tipHide(); }
            });
            if (!_tipBound) {
                _tipBound = true;
                window.addEventListener('scroll', _tipHide, true);
                window.addEventListener('blur', _tipHide);
                document.addEventListener('pointerdown', _tipHide, true);
            }
            return api;
        }

        const _fdrops = [];
        let _fdropBound = false;
        /**
         * Drives one §26 filter-strip drop-down (.fdrop > .fdrop-btn + .fdrop-panel). See the block above.
         * @param {HTMLElement|string} el - The .fdrop element or its id.
         * @param {object} [opts] - { onChange(value), onOpen(api), onClose(value), allText }.
         * @returns {?object} { open, close, toggle, isOpen, value, setValue, element }; null without the markup.
         */
        function fdrop(el, opts) {
            if (typeof el === 'string') el = document.getElementById(el);
            if (!el) return null;
            if (el._fbFdrop) return el._fbFdrop;
            opts = opts || {};
            const btn = el.querySelector('.fdrop-btn'), panel = el.querySelector('.fdrop-panel');
            if (!btn || !panel) return null;
            const valEl = btn.querySelector('.fd-val');
            const allText = opts.allText != null ? String(opts.allText) : (valEl ? valEl.textContent : '');
            const multi = !!panel.querySelector('.fdrop-item input[type=checkbox]');
            const items = function () { return Array.prototype.slice.call(panel.querySelectorAll('.fdrop-item')); };
            const boxOf = function (it) { return it.querySelector('input[type=checkbox]'); };
            const valueOf = function (it) { const cb = boxOf(it); return cb ? cb.value : it.getAttribute('data-v'); };
            const labelOf = function (it) { const n = it.querySelector('.fdrop-name'); return (n ? n.textContent : it.textContent).trim(); };
            function value() {
                if (multi) return items().filter(function (it) { const cb = boxOf(it); return cb && cb.checked; }).map(valueOf);
                const s = panel.querySelector('.fdrop-item.sel');
                return s ? valueOf(s) : null;
            }
            function sync() {
                if (multi) {
                    const on = [];
                    items().forEach(function (it) {
                        const cb = boxOf(it);
                        if (!cb) return;
                        it.classList.toggle('sel', cb.checked);
                        if (cb.checked) on.push(labelOf(it));
                    });
                    if (valEl) valEl.textContent = on.length ? on.join(', ') : allText;
                    btn.classList.toggle('on', on.length > 0);
                } else if (valEl) {
                    const s = panel.querySelector('.fdrop-item.sel');
                    valEl.textContent = s ? labelOf(s) : allText;
                }
            }
            function emit() {
                sync();
                if (opts.onChange) { try { opts.onChange(value()); } catch (e) { debugLog('fdrop onChange failed: ' + escHtml(e && e.message || e), 'error'); } }
            }
            function isOpen() { return el.classList.contains('open'); }
            function open() {
                if (isOpen()) return;
                _fdrops.forEach(function (d) { if (d !== api) d.close(); });
                el.classList.add('open');
                btn.classList.add('open');
                panel.style.display = 'block';
                if (opts.onOpen) { try { opts.onOpen(api); } catch (_) {} }
            }
            function close() {
                if (!isOpen()) return;
                el.classList.remove('open');
                btn.classList.remove('open');
                panel.style.display = '';
                if (opts.onClose) { try { opts.onClose(value()); } catch (_) {} }
            }
            function setValue(v) {
                const want = new Set((Array.isArray(v) ? v : v == null ? [] : [v]).map(String));
                items().forEach(function (it) {
                    const cb = boxOf(it);
                    if (cb) cb.checked = want.has(String(cb.value));
                    else it.classList.toggle('sel', want.has(String(it.getAttribute('data-v'))));
                });
                sync();
            }
            btn.addEventListener('click', function (e) { e.preventDefault(); if (isOpen()) close(); else open(); });
            panel.addEventListener('change', function (e) {
                if (e.target && e.target.matches && e.target.matches('.fdrop-item input[type=checkbox]')) emit();
            });
            panel.addEventListener('click', function (e) {
                if (e.target.closest('[data-clear]')) {
                    e.preventDefault();
                    items().forEach(function (it) { const cb = boxOf(it); if (cb) cb.checked = false; else it.classList.remove('sel'); });
                    emit();
                    return;
                }
                if (multi) return;
                const it = e.target.closest('.fdrop-item[data-v]');
                if (!it) return;
                items().forEach(function (x) { x.classList.toggle('sel', x === it); });
                emit();
                close();
            });
            const api = { open: open, close: close, toggle: function () { if (isOpen()) close(); else open(); },
                          isOpen: isOpen, value: value, setValue: setValue, element: el };
            el._fbFdrop = api;
            _fdrops.push(api);
            if (!_fdropBound) {
                _fdropBound = true;
                document.addEventListener('click', function (e) {
                    _fdrops.forEach(function (d) { if (d.isOpen() && !d.element.contains(e.target)) d.close(); });
                });
                document.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape') _fdrops.forEach(function (d) { d.close(); });
                });
            }
            sync();
            return api;
        }

        /**
         * Mounts the bottom-anchored debug console drawer that debugLog() writes to. Idempotent: later calls return the same API.
         * Before the body exists it defers to DOMContentLoaded and returns null. The drawer starts hidden; call show() or expand().
         * @returns {?object} API { show, hide, toggle, expand, collapse, isOpen, isVisible, element }, or null when deferred.
         */
        function mountDebugDrawer() {
            if (_drawerMounted) return _drawerApi;
            if (typeof document === 'undefined') return null;
            if (!document.body) {
                // body not yet present — defer until DOMContentLoaded
                document.addEventListener('DOMContentLoaded', mountDebugDrawer, { once: true });
                return null;
            }
            _injectDrawerCss();
            _drawerContainer = document.createElement('div');
            _drawerContainer.id = 'fbLibDebugDrawer';
            _drawerContainer.className = 'fblib-debug-drawer';
            _drawerContainer.innerHTML = _DRAWER_HTML;
            document.body.appendChild(_drawerContainer);
            _wireDrawerHandlers(_drawerContainer);
            _drawerApi = _buildDrawerApi(_drawerContainer);
            _drawerMounted = true;
            return _drawerApi;
        }

        return {
            FB_DATE_FORMAT: FB_DATE_FORMAT,
            MOMENT_DATE_FORMAT: MOMENT_DATE_FORMAT,
            /** True while the user's saved debug (or legacy showDebug) setting is on; read live, false before Settings.init(). */
            get DEBUG_MODE() { return _debugMode(); },
            formatDate: formatDate,
            currency: currency,
            formatMoney: formatMoney,
            formatQty: formatQty,
            escSQL: escSQL,
            getScheduleStatus: getScheduleStatus,
            getStatusTitle: getStatusTitle,
            createScheduleIndicator: createScheduleIndicator,
            createAvailabilityIndicator: createAvailabilityIndicator,
            debugLog: debugLog,
            clearDebugLog: clearDebugLog,
            mountDebugDrawer: mountDebugDrawer,
            registerDrawer: registerDrawer,
            openDrawer: openDrawer,
            closeDrawer: closeDrawer,
            toggleDrawer: toggleDrawer,
            closeAllDrawers: closeAllDrawers,
            registerPanel: registerPanel,
            togglePanel: togglePanel,
            closeAllPanels: closeAllPanels,
            MultiSelect: MultiSelect,
            escHtml: escHtml,
            isOutput: isOutput,
            toast: toast,
            confirmModal: confirmModal,
            tooltips: tooltips,
            fdrop: fdrop
        };
    })();

    // ====================================================================
    // FBLib.SharedData — an org-wide payload every user can READ and an
    // admin can WRITE, without touching loadReportData/saveReportData.
    //
    // THE PROBLEM IT REPLACES. saveReportData/loadReportData give a report one
    // shared slot, but they only work on a SAVED report: with no saved-report
    // context (BI Script Editor, which always previews with report id -1, or a
    // page opened with no report ID) the very first read raises the client's
    // native "Loading data is only available on reports" modal — whose dialog
    // title confusingly reads "Save Report Error". No try/catch suppresses it
    // and no typeof guard helps: the function exists, it just refuses. And on
    // an unsaved report the WRITE is a silent no-op, so an admin publishes,
    // sees no error, and the payload is gone on reload.
    //
    // HOW THIS WORKS INSTEAD. saveSettings() writes the CURRENT user's own
    // userproperties row under propertycategory 'Dashboard', and every user
    // can SELECT that table. So an admin writing a well-known key produces a
    // row the whole company can read back through runQuery(). Report-scoped
    // becomes key-scoped: give each report its own key.
    //
    //   FBLib.SharedData.read(key)                 -> raw string or null
    //   FBLib.SharedData.write(key, value)         -> true only if it PERSISTED
    //   FBLib.SharedData.readJson(key, fallback)   -> parsed, never throws
    //   FBLib.SharedData.writeJson(key, obj)       -> stamps + writes
    //   FBLib.SharedData.invalidate(key?)          -> drop the read cache
    //
    // Options on read/write:
    //   adminOnly  (default true)  Only rows owned by an account passing the
    //              admin test are trusted on read, and only an admin may write.
    //              Pass false for genuinely collaborative state (a shared
    //              stocktake session) where every user must be able to write.
    //   alsoTrust  extra publisher user name(s) to trust, for reports that
    //              designate an admin through their own property (BI_ADMIN_USER)
    //              rather than the built-in test. Read and write must be given
    //              the SAME list or a publish lands in an untrusted row.
    //   fresh      (read) bypass the per-load cache
    //   verify     (write, default true) read back and confirm it persisted
    //
    // WATCH-OUTS
    //  - The admin filter in the SQL is the server-side twin of isAdmin(). Widen
    //    one without the other and an account the query trusts but isAdmin()
    //    rejects can have a forged payload believed.
    //  - On a real database there is no 'Admin' row in useraccess (the closest
    //    is 'Server Administration-View'), so hasUserAccess('Admin') is always
    //    false and admin in practice means userName === 'admin'. The group
    //    clause is kept deliberately, to mirror isAdmin() exactly.
    //  - adminOnly:false means newest-write-wins across users and the stamp is
    //    generated client-side, so badly skewed clocks can invert the order.
    //    Callers that merge (read, union, write) tolerate this; blind
    //    last-write-wins callers should not use it.
    //  - A write REPLACES the whole value. Read-merge-write, never write a
    //    partial object.
    // ====================================================================
    /** Org-wide payloads that an admin writes and every user reads, stored in userproperties (no saveReportData needed). */
    const SharedData = (function () {
        const _cache = new Map();

        function _esc(v) { return String(v == null ? '' : v).replace(/'/g, "''"); }

        /**
         * Returns the logged-in Fishbowl user's userName.
         * @returns {string} The user name, or '' outside the client or on error.
         */
        function currentUserName() {
            try {
                if (typeof getUser !== 'function') return '';
                return (JSON.parse(getUser() || '{}') || {}).userName || '';
            } catch (_) { return ''; }
        }
        /**
         * Tells whether the current user may publish shared data: userName 'admin', a listed name, or hasUserAccess('Admin').
         * This is the client-side twin of the admin filter in read()'s SQL; keep the two in step.
         * @param {string|string[]} [alsoTrust] - Extra user names to trust (case-insensitive).
         * @returns {boolean} True for a trusted publisher.
         */
        function isAdmin(alsoTrust) {
            const me = String(currentUserName() || '').toLowerCase();
            if (me === 'admin') return true;
            const extra = [].concat(alsoTrust || []).filter(Boolean).map(function (x) { return String(x).toLowerCase(); });
            if (me && extra.indexOf(me) >= 0) return true;
            try { return (typeof hasUserAccess === 'function') && !!hasUserAccess('Admin'); } catch (_) { return false; }
        }

        function _cacheKey(key, adminOnly, extra) {
            return key + '|' + (adminOnly ? 'a' : '*') + '|' + extra.join(',');
        }

        /**
         * Reads the newest shared payload stored under a key in userproperties (category 'Dashboard').
         * The newest row wins by its _sharedAt or _masterPublishedAt stamp, else by row id. Results are cached per load.
         * @param {string} key - The shared key, e.g. FB_REPORT.key + '.shared.v1'.
         * @param {object} [opts] - Options.
         * @param {boolean} [opts.adminOnly=true] - Trust only rows owned by an admin (see isAdmin).
         * @param {string|string[]} [opts.alsoTrust] - Extra publisher user names to trust; pass the same list to write().
         * @param {boolean} [opts.fresh=false] - Bypass the cache.
         * @returns {?string} The raw stored string, or null when there is none or the read fails.
         */
        function read(key, opts) {
            opts = opts || {};
            if (!key) return null;
            const adminOnly = opts.adminOnly !== false;
            const extra = [].concat(opts.alsoTrust || []).filter(Boolean).map(function (x) { return String(x).toLowerCase(); });
            const ck = _cacheKey(key, adminOnly, extra);
            if (!opts.fresh && _cache.has(ck)) return _cache.get(ck);
            let out = null;
            if (typeof runQuery === 'function') {
                try {
                    let trust = '';
                    if (adminOnly) {
                        const names = ["'admin'"].concat(extra.map(function (x) { return "'" + _esc(x) + "'"; }));
                        trust =
                            "AND (LOWER(su.userName) IN (" + names.join(', ') + ") OR EXISTS (" +
                            "SELECT 1 FROM usergrouprel ugr " +
                            "INNER JOIN useraccess ua ON ua.groupId = ugr.groupId " +
                            "WHERE ugr.userId = su.id AND LOWER(ua.moduleName) = 'admin' " +
                            "AND (ua.viewFlag = 1 OR ua.modifyFlag = 1))) ";
                    }
                    const rows = JSON.parse(runQuery(
                        "SELECT up.id AS rowid, up.userValue AS shareddata " +
                        "FROM userproperties up " +
                        "INNER JOIN propertycategory pc ON pc.id = up.categoryId " +
                        "INNER JOIN sysuser su ON su.id = up.userId " +
                        "WHERE pc.name = 'Dashboard' " +
                        "AND up.userKey = '" + _esc(key) + "' " +
                        trust +
                        "ORDER BY up.id DESC"
                    ) || '[]');
                    let found = false, bestValue = '', bestStamp = '', bestId = -1;
                    (Array.isArray(rows) ? rows : []).forEach(function (row) {
                        // runQuery lower-cases every result key.
                        let value = row.shareddata;
                        if (value == null) value = row.uservalue;
                        value = (value == null) ? '' : String(value);
                        let stamp = '';
                        try { stamp = String((JSON.parse(value) || {})._sharedAt || (JSON.parse(value) || {})._masterPublishedAt || ''); } catch (_) {}
                        const rowId = parseInt(row.rowid, 10) || 0;
                        if (!found ||
                            (stamp && (!bestStamp || stamp > bestStamp)) ||
                            (!stamp && !bestStamp && rowId > bestId)) {
                            found = true; bestValue = value; bestStamp = stamp; bestId = rowId;
                        }
                    });
                    out = found && bestValue !== '' ? bestValue : null;
                } catch (e) {
                    try { console.warn('[FBLib.SharedData] read failed for ' + key + ':', e); } catch (_) {}
                    out = null;
                }
            } else {
                try { out = localStorage.getItem(key); } catch (_) { out = null; }
            }
            _cache.set(ck, out);
            return out;
        }

        /**
         * Reads a shared payload and parses it as JSON; never throws.
         * @param {string} key - The shared key.
         * @param {*} [fallback=null] - Returned when nothing is stored, the JSON is bad or it isn't an object.
         * @param {object} [opts] - Same options as read().
         * @returns {?object} The parsed object, or the fallback.
         */
        function readJson(key, fallback, opts) {
            const raw = read(key, opts);
            if (!raw) return (fallback === undefined ? null : fallback);
            try {
                const o = JSON.parse(raw);
                return (o && typeof o === 'object') ? o : (fallback === undefined ? null : fallback);
            } catch (_) { return (fallback === undefined ? null : fallback); }
        }

        /**
         * Drops cached read() results so the next read goes to the database.
         * @param {string} [key] - Only this key's entries; omit to clear the whole cache.
         */
        function invalidate(key) {
            if (!key) { _cache.clear(); return; }
            Array.from(_cache.keys()).forEach(function (ck) {
                if (ck.indexOf(key + '|') === 0) _cache.delete(ck);
            });
        }

        /**
         * Writes a shared payload under a key, as the current user's own userproperties row (via saveSettings).
         * Replaces the whole value, so read, merge, then write. True only when it verifiably round-tripped.
         * @param {string} key - The shared key.
         * @param {string} value - The value to store (coerced to a string; null becomes '').
         * @param {object} [opts] - Options.
         * @param {boolean} [opts.adminOnly=true] - Refuse unless isAdmin(); readers then trust admin rows only.
         * @param {string|string[]} [opts.alsoTrust] - Extra trusted user names; use the same list as read().
         * @param {boolean} [opts.verify=true] - Read back to confirm; false returns true as soon as it is saved.
         * @returns {boolean} False when refused, when saving throws, or when the read-back doesn't match.
         */
        function write(key, value, opts) {
            opts = opts || {};
            if (!key) return false;
            const adminOnly = opts.adminOnly !== false;
            const extra = [].concat(opts.alsoTrust || []).filter(Boolean);
            if (adminOnly && !isAdmin(extra)) return false;
            const str = String(value == null ? '' : value);
            try {
                if (typeof saveSettings === 'function') saveSettings(key, str);
                else localStorage.setItem(key, str);
            } catch (e) {
                try { console.warn('[FBLib.SharedData] write failed for ' + key + ':', e); } catch (_) {}
                return false;
            }
            invalidate(key);
            if (opts.verify === false) return true;
            const back = read(key, { adminOnly: adminOnly, alsoTrust: extra, fresh: true });
            return back === str;
        }

        /**
         * Stamps a copy of an object with _sharedAt and _sharedBy, so the newest publish is identifiable, then writes it as JSON.
         * @param {string} key - The shared key.
         * @param {object} obj - The whole payload (a write replaces the stored value).
         * @param {object} [opts] - Same options as write().
         * @returns {boolean} write()'s result.
         */
        function writeJson(key, obj, opts) {
            const payload = Object.assign({}, obj || {});
            payload._sharedAt = new Date().toISOString();
            payload._sharedBy = currentUserName();
            return write(key, JSON.stringify(payload), opts);
        }

        let _editSettingsCache = null;
        /**
         * The user names whose group has Edit Settings on this report: the native BI right to change a report's settings.
         * Pass them as alsoTrust to let those users publish (Settings config.company.editors, FilterViews opts.editors).
         * Read from bireportaccess, so a row written by anyone else is never believed. The report is the one a host
         * opened (FB_LAUNCH / FB_WORKSPACE reportId), else the bireport named FB_REPORT.name. Cached per load.
         * @returns {string[]} The user names; empty outside the client or for an unpublished report.
         */
        function editSettingsUsers() {
            if (_editSettingsCache) return _editSettingsCache.slice();
            let out = [];
            if (typeof runQuery === 'function') {
                let where = '';
                try {
                    const w = typeof window !== 'undefined' ? window : {};
                    const launched = (w.FB_LAUNCH && typeof w.FB_LAUNCH === 'object' && parseInt(w.FB_LAUNCH.reportId, 10)) ||
                        (w.FB_WORKSPACE && parseInt(w.FB_WORKSPACE.reportId, 10)) || 0;
                    const name = (w.FB_REPORT && w.FB_REPORT.name) || '';
                    if (launched > 0) where = 'a.biReportId = ' + launched;
                    else if (name) where = "a.biReportId IN (SELECT b.id FROM bireport b WHERE b.name = '" + _esc(name) + "')";
                } catch (_) { where = ''; }
                if (where) {
                    try {
                        const rows = JSON.parse(runQuery(
                            "SELECT DISTINCT su.userName AS username FROM bireportaccess a " +
                            "INNER JOIN usergrouprel r ON r.groupId = a.userGroupId " +
                            "INNER JOIN sysuser su ON su.id = r.userId " +
                            "WHERE a.accessLevel = 'Edit Settings' AND " + where
                        ) || '[]');
                        out = (Array.isArray(rows) ? rows : []).map(function (r) { return String(r.username || ''); }).filter(Boolean);
                    } catch (e) {
                        try { console.warn('[FBLib.SharedData] reading the Edit Settings users failed:', e); } catch (_) {}
                        out = [];
                    }
                }
            }
            _editSettingsCache = out;
            return out.slice();
        }

        return {
            read: read,
            readJson: readJson,
            write: write,
            writeJson: writeJson,
            invalidate: invalidate,
            isAdmin: isAdmin,
            currentUserName: currentUserName,
            editSettingsUsers: editSettingsUsers
        };
    })();

    // ====================================================================
    // FBLib.Settings — layered preference resolver
    //   1. per-user payload   (loadSettings / saveSettings)
    //   2. admin master       (masterStorage: reportData|userProperties|none)
    //   3. getProperty(name)  via propFallback map
    //   4. defaults literal
    // Mirrors the working DashboardSettingsCore in Dashboard_Combined.htm.
    // ====================================================================
    /** Layered preference resolver: the user's payload, then the admin master, then getProperty, then defaults. */
    const Settings = (function () {
        let _initialised = false;
        let _userKey = null;
        let _masterKey = null;          // localStorage fallback key only
        let _defaults = {};
        let _propFallback = {};
        let _defaultTileOrder = [];
        let _tileToTable = {};
        // Admin "master" layer — where the shared payload lives. Picked with
        // `masterStorage` on init():
        //
        //   'reportData'     (default) Fishbowl's loadReportData/saveReportData.
        //                    Report-scoped: one payload per SAVED report.
        //   'none'           No shared layer at all — resolve() falls straight through
        //                    to propFallback/defaults. For reports whose settings are
        //                    purely personal preferences.
        //   'userProperties' Shared payload published by an admin through their own
        //                    saveSettings() entry and read back by EVERY user with
        //                    runQuery() against userproperties. Works in preview.
        //
        // Why this exists: loadReportData/saveReportData only work on a SAVED report.
        // A page with no saved-report context (the BI Script Editor, which always
        // previews with report id -1, or a page opened with no report ID) makes the
        // client throw a native "Loading data is only available on reports" dialog on
        // the very first read. The try/catch below swallows the JS return but CANNOT
        // suppress that native modal, and neither can a typeof guard — the function
        // exists, it just refuses. So a report that must preview cleanly picks
        // 'none' (personal prefs) or 'userProperties' (shared admin defaults).
        //
        // Per-user loadSettings/saveSettings are unaffected by any of this — they are
        // account-scoped, not report-scoped, so they never trigger the dialog.
        //
        // Legacy alias: `useReportDataMaster: false` === `masterStorage: 'none'`.
        let _masterStorage = 'reportData';
        let _userName = '';

        let USER = {};
        let MASTER = {};
        let _isAdmin = false;
        // config.company (opt-in): keys whose company value wins over the user's
        // own, and the report's Edit Settings users trusted as publishers too.
        let _companyKeys = [];
        let _editors = [];

        function _readSettings(key) {
            if (typeof loadSettings === 'function') {
                try { return loadSettings(key); } catch (_) { return null; }
            }
            try { return localStorage.getItem(key); } catch (_) { return null; }
        }
        function _writeSettings(key, value) {
            if (typeof saveSettings === 'function') {
                try { saveSettings(key, value); return; } catch (_) {}
            }
            try { localStorage.setItem(key, value); } catch (_) {}
        }
        // The 'userProperties' layer is FBLib.SharedData — see its doc block above
        // for the mechanism, the admin-trust rule and the watch-outs.
        function _readMasterFromUserProperties() {
            return SharedData.read(_masterKey, { adminOnly: true, alsoTrust: _editors });
        }
        // publishMaster/setLock already gate on _isAdmin; SharedData.write gates
        // again, so a future call site cannot publish from a normal account.
        function _writeMasterToUserProperties(value) {
            let payload = {};
            try { payload = JSON.parse(String(value || '{}')) || {}; } catch (_) { payload = {}; }
            // Legacy stamp names, kept so payloads published by the earlier
            // report-local shims still sort correctly against new ones.
            payload._masterPublishedAt = new Date().toISOString();
            payload._masterPublisher = _userName || '';
            SharedData.write(_masterKey, JSON.stringify(payload), { adminOnly: true, alsoTrust: _editors, verify: false });
        }
        function _readMaster() {
            if (_masterStorage === 'none') return null;
            if (_masterStorage === 'userProperties') return _readMasterFromUserProperties();
            if (typeof loadReportData === 'function') {
                try { return loadReportData(); } catch (_) { return null; }
            }
            try { return localStorage.getItem(_masterKey); } catch (_) { return null; }
        }
        function _writeMaster(value) {
            if (_masterStorage === 'none') return;
            if (_masterStorage === 'userProperties') { _writeMasterToUserProperties(value); return; }
            if (typeof saveReportData === 'function') {
                try { saveReportData(value); return; } catch (_) {}
            }
            try { localStorage.setItem(_masterKey, value); } catch (_) {}
        }
        function _loadJson(raw) {
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (_) { return null; }
        }

        /**
         * Tells whether users may change their own settings (an admin locks them with setLock).
         * @returns {boolean} False only when the master payload sets _userEditingAllowed to false.
         */
        function _userEditingAllowed() {
            return MASTER._userEditingAllowed !== false;
        }

        /**
         * Initialises the settings layers; call it before anything that calls resolve().
         * Keys default from FB_REPORT.key + '.user.v1' / '.master.v1', with a warning past 41 characters.
         * @param {object} [config] - Settings config.
         * @param {string} [config.userKey] - Per-user loadSettings key.
         * @param {string} [config.masterKey] - Master key for userProperties storage (and the localStorage fallback).
         * @param {object} [config.defaults] - Fallback values by key.
         * @param {object} [config.propFallback] - key: { name, dflt, parse? }, read with getProperty when no layer has the key.
         * @param {string} [config.masterStorage='reportData'] - 'reportData' | 'userProperties' | 'none'.
         *   reportData raises a native dialog in the BI editor preview; useReportDataMaster:false is a legacy alias for 'none'.
         * @param {string[]} [config.defaultTileOrder] - Exposed as DEFAULT_TILE_ORDER.
         * @param {object} [config.tileToTable] - Tile key to custom-field tableRefName, used by CfCatalog (TILE_TO_TABLE).
         * @param {object} [config.company] - Company defaults (userProperties master only), e.g. { keys: ['filters'], editors: true }.
         *   keys: settings whose company value wins over the user's own, so every open starts from it (until it is cleared).
         *   editors: users with Edit Settings on this report may publish too (isAdmin() is true for them), and their rows are trusted.
         */
        function init(config) {
            config = config || {};
            // Keys default from the report's identity block, so a report copied
            // in Fishbowl only needs FB_REPORT.key changed to get its own store.
            const id = report();
            _userKey   = config.userKey   || (id.key ? id.key + '.user.v1'   : 'cdx.bi.report.user.v1');
            _masterKey = config.masterKey || (id.key ? id.key + '.master.v1' : 'cdx.bi.report.master.v1');
            [_userKey, _masterKey].forEach(function (k) {
                if (String(k).length > USERKEY_MAX) {
                    const msg = 'Settings key "' + k + '" is ' + String(k).length + ' characters; Fishbowl stores at most ' +
                        USERKEY_MAX + '. Shorten FB_REPORT.key or settings may not save.';
                    try { console.warn('[FBLib.Settings] ' + msg); } catch (_) {}
                    try { if (Common && Common.debugLog) Common.debugLog(msg, 'error'); } catch (_) {}
                }
            });
            try {
                console.info('[FBLib] report ' + (id.key || '(no key)') + ' build ' + (id.build || '?') +
                             ' · fb-lib build ' + BUILD);
            } catch (_) {}
            _defaults  = config.defaults  || {};
            _propFallback = config.propFallback || {};
            _defaultTileOrder = (config.defaultTileOrder || []).slice();
            _tileToTable = Object.assign({}, config.tileToTable || {});
            const company = config.company && typeof config.company === 'object' ? config.company : null;
            _companyKeys = company && Array.isArray(company.keys) ? company.keys.map(String) : [];
            // Shared-payload backing store. Defaults to report data, so every saved
            // report keeps its existing admin-master layer untouched. See the
            // _masterStorage doc block above for when to pick the other two.
            if (config.masterStorage) {
                _masterStorage = String(config.masterStorage);
            } else if (config.useReportDataMaster === false) {
                _masterStorage = 'none';        // legacy alias
            } else {
                _masterStorage = 'reportData';
            }

            // Resolved BEFORE the master read: 'userProperties' needs the user name
            // to stamp a publish, and the read itself is admin-filtered.
            _isAdmin = false;
            _userName = '';
            try {
                if (typeof getUser === 'function') {
                    const u = JSON.parse(getUser() || '{}');
                    _userName = (u && u.userName) || '';
                    _isAdmin = (u && u.userName === 'admin') ||
                        (typeof hasUserAccess === 'function' && hasUserAccess('Admin'));
                }
            } catch (_) { _isAdmin = false; }
            // Before the master read: the read trusts the editors' rows as well.
            _editors = (company && company.editors && _masterStorage === 'userProperties') ? SharedData.editSettingsUsers() : [];
            if (!_isAdmin && _userName && _editors.some(function (n) { return n.toLowerCase() === _userName.toLowerCase(); })) {
                _isAdmin = true;
            }

            USER   = _loadJson(_readSettings(_userKey))   || {};
            MASTER = _loadJson(_readMaster())             || {};

            _initialised = true;
        }

        /**
         * Resolves a setting: the user's value (unless an admin locked editing), then the master, then propFallback, then defaults.
         * @param {string} key - The setting key.
         * @returns {*} The resolved value, or undefined when no layer has it.
         */
        function resolve(key) {
            const locked = MASTER && MASTER._userEditingAllowed === false;
            // config.company.keys: the company's value, when there is one, comes first.
            if (_companyKeys.indexOf(key) >= 0 && MASTER && MASTER[key] != null) return MASTER[key];
            if (!locked && USER && USER[key] !== undefined) return USER[key];
            if (MASTER && MASTER[key] !== undefined) return MASTER[key];
            const prop = _propFallback[key];
            if (prop) {
                const raw = (typeof getProperty === 'function')
                    ? getProperty(prop.name, prop.dflt) : prop.dflt;
                return prop.parse ? prop.parse(raw) : raw;
            }
            return _defaults[key];
        }

        /**
         * Resolves every known key into one object: defaults, propFallback, then keys saved in the user payload.
         * User keys starting with '_' are skipped; master-only keys are not included.
         * @returns {object} Setting key to resolved value.
         */
        function effective() {
            const out = {};
            const seen = new Set();
            Object.keys(_defaults).forEach(k => { seen.add(k); out[k] = resolve(k); });
            Object.keys(_propFallback).forEach(k => {
                if (!seen.has(k)) { seen.add(k); out[k] = resolve(k); }
            });
            // Also surface any keys persisted in user/master but not in defaults
            Object.keys(USER).forEach(k => { if (!seen.has(k) && k.charAt(0) !== '_') out[k] = resolve(k); });
            return out;
        }

        /**
         * Sets a key in the in-memory user payload; call saveUser() to persist it.
         * @param {string} key - The setting key.
         * @param {*} value - Any JSON-serialisable value.
         */
        function setUserKey(key, value) { USER[key] = value; }
        /**
         * Persists the user payload through saveSettings.
         * @returns {boolean} False (nothing saved) when an admin has locked editing and the user isn't an admin; else true.
         */
        function saveUser() {
            if (MASTER._userEditingAllowed === false && !_isAdmin) return false;
            _writeSettings(_userKey, JSON.stringify(USER));
            return true;
        }
        /** Empties the user payload in memory and in storage, so every key falls back to the master and defaults. */
        function clearUser() {
            USER = {};
            _writeSettings(_userKey, '');
        }
        /**
         * Publishes the admin master payload that every user resolves beneath their own values. Admins only.
         * REPLACES the whole master (keeping the lock flag), so pass the full payload, not a patch. true is not a read-back check.
         * @param {object} payload - The complete master settings.
         * @returns {boolean} False when the user isn't an admin.
         */
        function publishMaster(payload) {
            if (!_isAdmin) return false;
            const next = Object.assign({}, payload);
            next._userEditingAllowed = (MASTER._userEditingAllowed !== false);
            MASTER = next;
            _writeMaster(JSON.stringify(MASTER));
            return true;
        }
        /**
         * Locks or unlocks everyone's own settings by rewriting the master payload. Admins only.
         * While locked, resolve() ignores user values and saveUser() refuses for non-admins.
         * @param {boolean} locked - True to lock.
         * @returns {boolean} False when the user isn't an admin.
         */
        function setLock(locked) {
            if (!_isAdmin) return false;
            MASTER._userEditingAllowed = !locked;
            _writeMaster(JSON.stringify(MASTER));
            return true;
        }

        /**
         * Sets one key of the company (master) settings, keeping the rest. Admin or, with config.company.editors, Edit Settings users.
         * For a config.company.keys key, every user then starts from this value each time the report opens.
         * @param {string} key - The setting key, e.g. 'filters' or 'docPaper'.
         * @param {*} value - Any JSON-serialisable value.
         * @returns {boolean} False when the user may not publish.
         */
        function publishCompany(key, value) {
            if (!_isAdmin) return false;
            const next = Object.assign({}, MASTER);
            next[key] = value;
            return publishMaster(next);
        }

        /**
         * Removes keys from the company (master) settings, so users go back to their own values. Same rights as publishCompany.
         * @param {string|string[]} keys - The setting key(s).
         * @returns {boolean} False when the user may not publish.
         */
        function clearCompany(keys) {
            if (!_isAdmin) return false;
            const next = Object.assign({}, MASTER);
            [].concat(keys || []).forEach(function (k) { delete next[k]; });
            return publishMaster(next);
        }

        /**
         * Tells whether the company (master) settings hold a value for a key.
         * @param {string} key - The setting key.
         * @returns {boolean} True when a company value is set.
         */
        function hasCompany(key) {
            return !!(MASTER && MASTER[key] != null);
        }

        /**
         * Returns the custom fields picked for a tile (the customFields setting), intersected with the live CF catalog.
         * Fields deactivated or deleted in Fishbowl since they were saved are dropped silently. Empty until CfCatalog loads.
         * @param {string} tileKey - The tile key, e.g. 'SO' (case-insensitive).
         * @returns {object[]} CF definitions { id, name, description, fieldType, sortOrder, required, listId }, in saved order.
         */
        function activeCfsFor(tileKey) {
            const code = String(tileKey || '').toUpperCase();
            const cfg = resolve('customFields') || {};
            const savedIds = Array.isArray(cfg[code]) ? cfg[code] : [];
            if (savedIds.length === 0) return [];
            const catalog = (FBLib.CfCatalog && FBLib.CfCatalog.map instanceof Map)
                ? FBLib.CfCatalog.map.get(code) : null;
            if (!catalog || !catalog.length) return [];
            const byId = new Map(catalog.map(cf => [cf.id, cf]));
            const result = [];
            let dropped = 0;
            savedIds.forEach(id => {
                const cf = byId.get(id);
                if (cf) result.push(cf); else dropped += 1;
            });
            if (dropped > 0) {
                try { console.info('[FBLib.Settings] ' + code + ' dropped ' + dropped + ' inactive/deleted CF(s) from saved selection.'); } catch (_) {}
            }
            return result;
        }

        return {
            init: init,
            /** True once init() has run. */
            get _initialised() { return _initialised; },
            resolve: resolve,
            effective: effective,
            /**
             * Tells whether init() found the current user to be an admin (userName 'admin' or the Admin access right).
             * @returns {boolean} True for an admin.
             */
            isAdmin: function () { return _isAdmin; },
            /**
             * The master store init() picked: 'reportData', 'userProperties' or 'none'.
             * Company settings (publishCompany) are shared and preview-safe only with 'userProperties'.
             * @returns {string} The masterStorage in use.
             */
            masterStorage: function () { return _masterStorage; },
            userEditingAllowed: _userEditingAllowed,
            /**
             * Returns the live user payload object (not a copy); change it with setUserKey() and persist with saveUser().
             * @returns {object} The user layer.
             */
            getUser: function () { return USER; },
            /**
             * Returns the live admin master payload object (not a copy).
             * @returns {object} The master layer, including its _userEditingAllowed flag.
             */
            getMaster: function () { return MASTER; },
            setUserKey: setUserKey,
            saveUser: saveUser,
            clearUser: clearUser,
            publishMaster: publishMaster,
            setLock: setLock,
            publishCompany: publishCompany,
            clearCompany: clearCompany,
            hasCompany: hasCompany,
            /**
             * The user names trusted to publish besides admin: those with Edit Settings on this report (config.company.editors).
             * @returns {string[]} A copy of the list; empty without config.company.editors.
             */
            editors: function () { return _editors.slice(); },
            activeCfsFor: activeCfsFor,
            /** A copy of config.defaultTileOrder from init(). */
            get DEFAULT_TILE_ORDER() { return _defaultTileOrder.slice(); },
            /** A copy of config.tileToTable from init(): tile key to custom-field tableRefName. */
            get TILE_TO_TABLE() { return Object.assign({}, _tileToTable); }
        };
    })();

    // ====================================================================
    // FBLib.CfCatalog — discover all active custom fields and bucket them
    // by tile (using Settings.TILE_TO_TABLE). Runs ONCE per report load.
    // ====================================================================
    /** Discovers every active custom field once per load and buckets it by tile (see Settings.TILE_TO_TABLE). */
    const CfCatalog = (function () {
        let loaded = false;
        let map = new Map();
        let readyPromise = null;

        const SQL = `
            SELECT cf.id,
                   cf.name,
                   cf.description,
                   cf.sortOrder,
                   cf.required,
                   cf.listId,
                   cf.tableId,
                   cf.customFieldTypeId,
                   tr.tableRefName AS moduleTable
            FROM customfield cf
            JOIN tablereference tr ON tr.tableId = cf.tableId
            WHERE cf.activeFlag = 1
            ORDER BY tr.tableRefName, cf.sortOrder, cf.name
        `;

        function _loadFieldTypeMap() {
            try {
                if (typeof runQuery !== 'function') return {};
                const raw = runQuery('SELECT id, name FROM customfieldtype');
                const rows = raw ? JSON.parse(raw) : [];
                const m = {};
                rows.forEach(r => { m[r.id] = r.name; });
                return m;
            } catch (_) { return {}; }
        }

        function _runLoad() {
            try {
                if (typeof runQuery !== 'function') {
                    console.warn('[FBLib.CfCatalog] runQuery() unavailable — CF catalog disabled.');
                    return new Map();
                }
                const tileToTable = FBLib.Settings.TILE_TO_TABLE;
                const tableToTile = {};
                Object.keys(tileToTable).forEach(k => {
                    tableToTile[String(tileToTable[k]).toLowerCase()] = k;
                });
                const raw = runQuery(SQL);
                const rows = raw ? JSON.parse(raw) : [];
                const typeMap = _loadFieldTypeMap();
                const m = new Map();
                Object.keys(tileToTable).forEach(k => m.set(k, []));
                const skipped = {};
                rows.forEach(r => {
                    const refLower = String(r.moduletable || '').toLowerCase();
                    const tile = tableToTile[refLower];
                    if (!tile) {
                        skipped[refLower] = (skipped[refLower] || 0) + 1;
                        return;
                    }
                    const arr = m.get(tile) || [];
                    arr.push({
                        id:          r.id,
                        name:        r.name,
                        description: r.description,
                        fieldType:   typeMap[r.customfieldtypeid] || '',
                        sortOrder:   r.sortorder,
                        required:    !!r.required,
                        listId:      r.listid
                    });
                    m.set(tile, arr);
                });
                const perTile = [];
                m.forEach((arr, key) => perTile.push(`${key}=${arr.length}`));
                console.info('[FBLib.CfCatalog] ' + rows.length + ' CF row(s) — bucketed: ' + perTile.join(', '));
                const skippedKeys = Object.keys(skipped);
                if (skippedKeys.length) {
                    console.info('[FBLib.CfCatalog] skipped tableRefName(s) not mapped to a tile: ' +
                        skippedKeys.map(k => k + ' (' + skipped[k] + ')').join(', '));
                }
                return m;
            } catch (err) {
                console.warn('[FBLib.CfCatalog] Catalog query failed — CF picker will be empty.', err && err.message ? err.message : err);
                return new Map();
            }
        }

        /**
         * Loads the active custom-field catalog once, deferred past first paint so it doesn't block the report's own query.
         * Buckets by Settings.TILE_TO_TABLE (call Settings.init first), then calls window.onFbLibCfCatalogLoaded if defined.
         * @returns {Promise<Map<string, object[]>>} Tile key to CF definitions; the same promise on every call; empty on failure.
         */
        function load() {
            if (readyPromise) return readyPromise;
            readyPromise = new Promise(function (resolve) {
                setTimeout(function () {
                    map = _runLoad();
                    loaded = true;
                    // Notify any open settings panel via report-defined hook
                    if (typeof window !== 'undefined' && typeof window.onFbLibCfCatalogLoaded === 'function') {
                        try { window.onFbLibCfCatalogLoaded(); } catch (_) {}
                    }
                    resolve(map);
                }, 0);
            });
            return readyPromise;
        }

        return {
            load: load,
            /** True once load() has finished. */
            get loaded() { return loaded; },
            /** The catalog Map (tile key to CF definitions); empty until load() finishes. */
            get map() { return map; },
            /** The promise from the first load() call, or null before it. */
            get readyPromise() { return readyPromise; }
        };
    })();

    // ====================================================================
    // FBLib.CfCols — SQL injection + DOM rendering for active CFs
    // ====================================================================
    /** Splices a tile's active custom fields into its SQL, header, filter row and body cells. */
    const CfCols = (function () {
        // Per-report registry mapping tileKey → window-level module name
        // (e.g. {'SO': 'ReportSO'}). Used to wire CF column-header sort
        // back through the host module's sortTable() function. For
        // single-tile pages, the "module" can be the page's own global
        // (e.g. window.PageController) or an inline object exposing
        // sortTable().
        const _tileModules = {};

        /**
         * Registers the window-level module whose sortTable(key) a tile's custom-field headers call when clicked.
         * @param {string} tileKey - The tile key, e.g. 'SO'.
         * @param {string} moduleName - Name of a global exposing sortTable(), e.g. 'ReportSO'.
         */
        function registerTileModule(tileKey, moduleName) {
            _tileModules[String(tileKey).toUpperCase()] = moduleName;
        }

        function _activeFor(tileKey) {
            try {
                if (!FBLib.Settings._initialised) return [];
                const arr = FBLib.Settings.activeCfsFor(tileKey);
                return Array.isArray(arr) ? arr : [];
            } catch (_) { return []; }
        }

        /**
         * Escapes single quotes for a SQL string literal (same as Common.escSQL).
         * @param {*} s - The value; null and undefined become ''.
         * @returns {string} The escaped text, without surrounding quotes.
         */
        function escSqlString(s) {
            return String(s == null ? '' : s).replace(/'/g, "''");
        }

        function _escHtml(s) {
            if (s == null) return '';
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        /**
         * Builds the SELECT-list fragment for a tile's active custom fields, each aliased cf_N (N = the field id).
         * Returns a single space when none are active, so the query is unchanged. A report with its own
         * columns passes the fields instead of a tile key: sqlSelectFor(fields, 'part') with fields
         * from FBLib.CfCatalog ([{ id, name }]), e.g. the custom-field columns the user has on.
         * @param {string|Array<{id: *, name: string}>} tileKey - The tile key, or the custom fields themselves.
         * @param {string} tableAlias - Alias of the table that holds customFields, e.g. 'so'.
         * @param {boolean} [useMax=false] - Wrap each value in MAX() for a GROUP BY query.
         * @returns {string} e.g. ", CustomFieldByName(so.customFields, 'Region') AS cf_12 " (note the leading comma).
         */
        function sqlSelectFor(tileKey, tableAlias, useMax) {
            const cfs = Array.isArray(tileKey)
                ? tileKey.filter(function (cf) { return cf && cf.name != null && cf.id != null; })
                : _activeFor(tileKey);
            if (cfs.length === 0) return ' ';
            const parts = cfs.map(function (cf) {
                const expr = "CustomFieldByName(" + tableAlias + ".customFields, '" + escSqlString(cf.name) + "')";
                const wrapped = useMax ? ("MAX(" + expr + ")") : expr;
                return "    " + wrapped + " AS cf_" + cf.id;
            });
            return ", " + parts.join(", ") + " ";
        }

        /**
         * Counts a tile's active custom-field columns.
         * @param {string} tileKey - The tile key.
         * @returns {number} The count; 0 before Settings.init() or when none are picked.
         */
        function extraColCount(tileKey) {
            return _activeFor(tileKey).length;
        }

        /**
         * Formats a custom-field value for display by its field type.
         * Dates use Common.formatDate, numbers toLocaleString, checkboxes 'Yes'/'No' (so the Yes/No filter can match).
         * @param {object} cf - The CF definition (its fieldType is used).
         * @param {*} value - The raw value.
         * @returns {string} The display text; '' for null, undefined or ''.
         */
        function formatValue(cf, value) {
            if (value === null || value === undefined || value === '') return '';
            const t = (cf.fieldType || '').toLowerCase();
            if (t === 'date') {
                try { return Common.formatDate(value); } catch (_) { return String(value); }
            }
            if (t === 'number' || t === 'integer' || t === 'decimal') {
                const n = Number(value);
                return isNaN(n) ? String(value) : n.toLocaleString();
            }
            if (t === 'checkbox' || t === 'boolean') {
                const s = String(value).toLowerCase();
                if (s === '' || s === 'null' || s === 'undefined') return '';
                const truthy = (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 't');
                return truthy ? 'Yes' : 'No';
            }
            return String(value);
        }

        /**
         * Appends a header cell per active custom field (plus an empty filter-row cell) to a tile table's head. Idempotent.
         * Header clicks call the registered module's sortTable('cf_N'); see registerTileModule.
         * @param {string|HTMLElement} containerOrTable - The table, a .tile-table, a container holding the table, or its id.
         * @param {string} tileKey - The tile key.
         */
        function injectHeader(containerOrTable, tileKey) {
            try {
                const root = (typeof containerOrTable === 'string')
                    ? document.getElementById(containerOrTable) : containerOrTable;
                if (!root) return;
                const table = (root.classList && root.classList.contains('tile-table'))
                    || root.tagName === 'TABLE' ? root : root.querySelector('table');
                if (!table) return;
                const headRow = table.querySelector('thead tr:not(.filter-row)');
                const filterRow = table.querySelector('thead tr.filter-row');
                if (!headRow) return;
                headRow.querySelectorAll('th.cf-col').forEach(n => n.remove());
                if (filterRow) filterRow.querySelectorAll('td.cf-col').forEach(n => n.remove());

                const moduleName = _tileModules[String(tileKey).toUpperCase()];
                const cfs = _activeFor(tileKey);
                cfs.forEach(function (cf) {
                    const th = document.createElement('th');
                    th.className = 'cf-col';
                    th.setAttribute('data-cf-id', String(cf.id));
                    th.setAttribute('data-column', 'cf_' + cf.id);
                    th.innerHTML = _escHtml(cf.name) +
                        ' <span class="sort-icon">⇅</span>';
                    if (moduleName) {
                        const sortKey = 'cf_' + cf.id;
                        th.addEventListener('click', function () {
                            try {
                                const mod = window[moduleName];
                                if (mod && typeof mod.sortTable === 'function') mod.sortTable(sortKey);
                            } catch (_) {}
                        });
                    }
                    headRow.appendChild(th);

                    if (filterRow) {
                        const td = document.createElement('td');
                        td.className = 'cf-col';
                        filterRow.appendChild(td);
                    }
                });
            } catch (err) {
                try { console.warn('[FBLib.CfCols] injectHeader failed for ' + tileKey, err); } catch (_) {}
            }
        }

        function _buildFilterInput(cf) {
            const t = (cf.fieldType || '').toLowerCase();
            const key = 'cf_' + cf.id;
            if (t === 'checkbox' || t === 'boolean') {
                const sel = document.createElement('select');
                sel.setAttribute('data-filter', key);
                sel.className = 'cf-filter';
                [['', '(any)'], ['Yes', 'Yes'], ['No', 'No']].forEach(function (o) {
                    const op = document.createElement('option');
                    op.value = o[0];
                    op.textContent = o[1];
                    sel.appendChild(op);
                });
                return sel;
            }
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.setAttribute('data-filter', key);
            inp.className = 'cf-filter';
            inp.placeholder = 'Filter…';
            return inp;
        }

        /**
         * Fills the filter-row cells added by injectHeader with inputs: a Yes/No select for checkbox fields, else a text box.
         * Inputs carry data-filter="cf_N" and class cf-filter; the host wires their events.
         * @param {string} tileKey - The tile key.
         * @param {HTMLElement} filterRowEl - The table's tr.filter-row.
         */
        function injectFilters(tileKey, filterRowEl) {
            try {
                if (!filterRowEl) return;
                const cfs = _activeFor(tileKey);
                const slots = filterRowEl.querySelectorAll('td.cf-col');
                cfs.forEach(function (cf, idx) {
                    const td = slots[idx];
                    if (!td) return;
                    td.innerHTML = '';
                    td.appendChild(_buildFilterInput(cf));
                });
            } catch (err) {
                try { console.warn('[FBLib.CfCols] injectFilters failed for ' + tileKey, err); } catch (_) {}
            }
        }

        /**
         * Appends one formatted cell per active custom field to a body row, reading row['cf_N'].
         * @param {object} row - The data row (from a query that used sqlSelectFor).
         * @param {string} tileKey - The tile key.
         * @param {HTMLTableRowElement} tr - The row element to append to.
         */
        function injectCells(row, tileKey, tr) {
            const cfs = _activeFor(tileKey);
            cfs.forEach(function (cf) {
                tr.appendChild(_buildCfTd(row, cf));
            });
        }

        function _buildCfTd(row, cf) {
            const td = document.createElement('td');
            td.className = 'cf-col';
            const raw = row ? row['cf_' + cf.id] : '';
            const t = (cf.fieldType || '').toLowerCase();
            const display = formatValue(cf, raw);
            if (t === 'number' || t === 'integer' || t === 'decimal') {
                td.style.textAlign = 'right';
            }
            td.textContent = display;
            if (display) td.title = display;
            return td;
        }

        /**
         * Builds one custom-field cell for a column key like 'cf_12', so hosts can interleave CF and static cells in one loop.
         * @param {object} row - The data row.
         * @param {string} tileKey - The tile key.
         * @param {string} key - The column key.
         * @returns {?HTMLTableCellElement} The cell, or null when the key isn't a CF key or that CF isn't active.
         */
        function buildCell(row, tileKey, key) {
            if (typeof key !== 'string' || key.indexOf('cf_') !== 0) return null;
            const id = parseInt(key.slice(3), 10);
            if (isNaN(id)) return null;
            const cfs = _activeFor(tileKey);
            for (let i = 0; i < cfs.length; i++) {
                if (cfs[i].id === id) return _buildCfTd(row, cfs[i]);
            }
            return null;
        }

        // CF id → CF def lookup across all loaded tile catalogs. CF IDs are
        // globally unique in the FB schema so one map covers all tiles.
        function _findCfByFilterKey(filterKey) {
            if (typeof filterKey !== 'string' || filterKey.indexOf('cf_') !== 0) return null;
            const id = parseInt(filterKey.slice(3), 10);
            if (isNaN(id)) return null;
            const catalog = FBLib.CfCatalog && FBLib.CfCatalog.map;
            if (!(catalog instanceof Map)) return null;
            for (const [, arr] of catalog) {
                for (let i = 0; i < arr.length; i++) {
                    if (arr[i].id === id) return arr[i];
                }
            }
            return null;
        }

        /**
         * Formats a raw value the way injectCells displays it, so column filters compare against the shown text.
         * @param {string} filterKey - A key like 'cf_12'; the CF is looked up across every loaded tile.
         * @param {*} rawValue - The raw SQL value.
         * @returns {?string} The display text, or null when the key isn't a known CF.
         */
        function formatForFilter(filterKey, rawValue) {
            const cf = _findCfByFilterKey(filterKey);
            return cf ? formatValue(cf, rawValue) : null;
        }

        return {
            registerTileModule: registerTileModule,
            sqlSelectFor: sqlSelectFor,
            extraColCount: extraColCount,
            escSqlString: escSqlString,
            injectHeader: injectHeader,
            injectFilters: injectFilters,
            injectCells: injectCells,
            buildCell: buildCell,
            formatValue: formatValue,
            formatForFilter: formatForFilter
        };
    })();

    // ====================================================================
    // FBLib.Columns — per-tile static-column registry + visibility helpers.
    // Reports call register(tileKey, manifest) at boot. manifest is
    // [{key, label, alwaysOn?}, ...]. The user's hidden columns persist
    // in Settings under the `hiddenStandardColumns` key.
    // ====================================================================
    /** Per-tile static-column manifests plus visibility and ordering helpers backed by FBLib.Settings. */
    const Columns = (function () {
        const _manifests = {};

        /**
         * Registers a tile's static-column manifest, replacing any earlier one.
         * @param {string} tileKey - The tile key (case-insensitive).
         * @param {Array<{key: string, label: (string|undefined), alwaysOn: (boolean|undefined)}>} manifest - Columns in default
         *   order; label defaults to the key, and alwaysOn columns can't be hidden.
         */
        function register(tileKey, manifest) {
            _manifests[String(tileKey).toUpperCase()] =
                (manifest || []).map(function (c) {
                    return { key: c.key, label: c.label || c.key, alwaysOn: !!c.alwaysOn };
                });
        }

        /**
         * Returns a copy of a tile's registered column manifest.
         * @param {string} tileKey - The tile key.
         * @returns {Array<{key: string, label: string, alwaysOn: boolean}>} The columns, or [] when none are registered.
         */
        function manifest(tileKey) {
            return (_manifests[String(tileKey).toUpperCase()] || []).slice();
        }

        /**
         * Returns the static column keys the user has hidden for a tile (the hiddenStandardColumns setting).
         * @param {string} tileKey - The tile key.
         * @returns {Set<string>} Hidden keys; empty before Settings.init(). May include alwaysOn keys, which stay visible.
         */
        function hiddenSetFor(tileKey) {
            try {
                if (!Settings._initialised) return new Set();
                const cfg = Settings.resolve('hiddenStandardColumns') || {};
                const arr = cfg[String(tileKey).toUpperCase()] || [];
                return new Set(arr);
            } catch (_) { return new Set(); }
        }

        /**
         * Tells whether a static column is hidden for a tile; alwaysOn columns never are.
         * @param {string} tileKey - The tile key.
         * @param {string} key - The column key.
         * @returns {boolean} True when hidden.
         */
        function isHidden(tileKey, key) {
            const m = manifest(tileKey).find(function (c) { return c.key === key; });
            if (m && m.alwaysOn) return false;
            return hiddenSetFor(tileKey).has(key);
        }

        /**
         * Filters a list of column keys, dropping any the user has hidden (alwaysOn keys are kept).
         * @param {string} tileKey - The tile key.
         * @param {string[]} orderedKeys - Keys in display order.
         * @returns {string[]} The visible keys, in the same order.
         */
        function visibleKeysFrom(tileKey, orderedKeys) {
            const hidden = hiddenSetFor(tileKey);
            const m = manifest(tileKey);
            const alwaysOn = new Set(m.filter(function (c) { return c.alwaysOn; }).map(function (c) { return c.key; }));
            return (orderedKeys || []).filter(function (k) {
                if (alwaysOn.has(k)) return true;
                return !hidden.has(k);
            });
        }

        /**
         * Shows or hides a table's header and filter-row cells by their data-column / data-filter keys. Idempotent.
         * Custom-field (.cf-col) cells are skipped, and body cells are left to the host's render loop.
         * @param {HTMLElement} rootEl - The table, or a container holding it.
         * @param {string} tileKey - The tile key.
         */
        function applyVisibilityToTable(rootEl, tileKey) {
            try {
                if (!rootEl) return;
                const table = rootEl.tagName === 'TABLE' ? rootEl : rootEl.querySelector('table');
                if (!table) return;
                const hidden = hiddenSetFor(tileKey);
                const m = manifest(tileKey);
                const alwaysOn = new Set(m.filter(function (c) { return c.alwaysOn; }).map(function (c) { return c.key; }));
                const shouldHide = function (key) { return !alwaysOn.has(key) && hidden.has(key); };
                table.querySelectorAll('th[data-column]').forEach(function (th) {
                    if (th.classList.contains('cf-col')) return;     // CF cols managed elsewhere
                    th.style.display = shouldHide(th.getAttribute('data-column')) ? 'none' : '';
                });
                // Filter-row cells: `data-filter` may live on the <td> directly
                // OR on an <input>/<select> inside the <td>. Match either by
                // walking from any [data-filter] element up to its enclosing
                // <td> and toggling that <td>'s display.
                table.querySelectorAll('thead tr.filter-row [data-filter]').forEach(function (el) {
                    if (el.tagName === 'TH') return;
                    const td = el.tagName === 'TD' ? el : el.closest('td');
                    if (!td || td.classList.contains('cf-col')) return;
                    td.style.display = shouldHide(el.getAttribute('data-filter')) ? 'none' : '';
                });
            } catch (err) {
                try { console.warn('[FBLib.Columns] applyVisibilityToTable failed for ' + tileKey, err); } catch (_) {}
            }
        }

        /**
         * Counts a tile's hidden static columns, e.g. to adjust an empty-state colspan.
         * @param {string} tileKey - The tile key.
         * @returns {number} Hidden columns, not counting alwaysOn ones.
         */
        function hiddenCount(tileKey) {
            const hidden = hiddenSetFor(tileKey);
            const m = manifest(tileKey);
            const alwaysOn = new Set(m.filter(function (c) { return c.alwaysOn; }).map(function (c) { return c.key; }));
            let n = 0;
            hidden.forEach(function (k) { if (!alwaysOn.has(k)) n += 1; });
            return n;
        }

        /**
         * Resolves a tile's column order: the user's saved columnOrder[TILE] limited to valid keys, then any new keys appended.
         * Valid keys are the manifest's plus 'cf_N' per active CF; new ones go statics first (manifest order), then CFs.
         * @param {string} tileKey - The tile key.
         * @param {string[]} [fallbackOrder] - Starting order used when nothing is saved yet.
         * @returns {string[]} Every valid key, once each.
         */
        function resolveOrder(tileKey, fallbackOrder) {
            const code = String(tileKey || '').toUpperCase();
            const m = manifest(code);
            const cfs = (Settings._initialised && typeof Settings.activeCfsFor === 'function')
                ? (Settings.activeCfsFor(code) || []) : [];
            const validKeys = new Set();
            m.forEach(function (c) { validKeys.add(c.key); });
            cfs.forEach(function (cf) { validKeys.add('cf_' + cf.id); });

            let saved = null;
            try {
                if (Settings._initialised) {
                    const cfg = Settings.resolve('columnOrder') || {};
                    if (Array.isArray(cfg[code])) saved = cfg[code];
                }
            } catch (_) {}

            const seed = saved || (Array.isArray(fallbackOrder) ? fallbackOrder : []);
            const result = [];
            const seen = new Set();
            seed.forEach(function (k) {
                if (validKeys.has(k) && !seen.has(k)) { result.push(k); seen.add(k); }
            });
            // Append any valid keys not yet placed — statics first (manifest
            // order), then CFs (catalog order).
            m.forEach(function (c) {
                if (!seen.has(c.key)) { result.push(c.key); seen.add(c.key); }
            });
            cfs.forEach(function (cf) {
                const k = 'cf_' + cf.id;
                if (!seen.has(k)) { result.push(k); seen.add(k); }
            });
            return result;
        }

        return {
            register: register,
            manifest: manifest,
            isHidden: isHidden,
            hiddenSetFor: hiddenSetFor,
            visibleKeysFrom: visibleKeysFrom,
            applyVisibilityToTable: applyVisibilityToTable,
            hiddenCount: hiddenCount,
            resolveOrder: resolveOrder
        };
    })();

    // ====================================================================
    // FBLib.Picker — renders one collapsible section that combines a
    // tile's standard columns and its custom fields into a single
    // visibility multi-select. Each checkbox represents a column; a
    // checked box means the column is visible. alwaysOn standard columns
    // are rendered checked and disabled.
    //
    // The host (a report's PageSettings / DashboardSettings controller)
    // calls this once per tile to build the DOM, then reads checkbox
    // state via the returned `read()` callback.
    // ====================================================================
    /** Builds the settings-panel column picker: one collapsible, drag-to-reorder section per tile. */
    const Picker = (function () {
        // HTML5 drag-and-drop for a single picker row inside its body. The
        // grip is the only visual cue; we make the whole row draggable so
        // grabbing anywhere outside the checkbox/label triggers a drag.
        // We bail out of drag handling if the drag originated on the
        // checkbox itself (otherwise the click-to-toggle gets eaten).
        function _wireRowDnd(row, body, onChange) {
            row.addEventListener('dragstart', function (e) {
                if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL')) {
                    // Allow drag from grip / row background, not from form controls
                    if (e.target.tagName === 'INPUT') { e.preventDefault(); return; }
                }
                row.classList.add('ds-cf-dragging');
                try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.orderKey || ''); } catch (_) {}
            });
            row.addEventListener('dragend', function () {
                row.classList.remove('ds-cf-dragging');
                body.querySelectorAll('.ds-cf-row.ds-cf-drop-over').forEach(function (r) { r.classList.remove('ds-cf-drop-over'); });
            });
            row.addEventListener('dragover', function (e) {
                e.preventDefault();
                try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
            });
            row.addEventListener('dragenter', function () { row.classList.add('ds-cf-drop-over'); });
            row.addEventListener('dragleave', function () { row.classList.remove('ds-cf-drop-over'); });
            row.addEventListener('drop', function (e) {
                e.preventDefault();
                row.classList.remove('ds-cf-drop-over');
                const dragging = body.querySelector('.ds-cf-dragging');
                if (!dragging || dragging === row) return;
                const rect = row.getBoundingClientRect();
                const before = (e.clientY - rect.top) < (rect.height / 2);
                body.insertBefore(dragging, before ? row : row.nextSibling);
                if (typeof onChange === 'function') onChange();
            });
        }

        function _escHtml(s) {
            if (s == null) return '';
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        /**
         * Renders one collapsible picker section for a tile: its static columns and custom fields as drag-to-reorder checkboxes.
         * A checked box means visible; alwaysOn columns are checked and disabled.
         * @param {object} opts - Section options.
         * @param {string} opts.tileKey - The tile key, e.g. 'SO'.
         * @param {string} [opts.label] - Section heading, e.g. 'Sales Orders' (defaults to the tile key).
         * @param {Set<string>} [opts.currentHiddenStatic] - Static keys currently hidden.
         * @param {Set<number>} [opts.currentSelectedCfs] - CF ids currently shown.
         * @param {Function} [opts.onChange] - Called on each checkbox flip and each drag reorder.
         * @returns {{element: HTMLElement, read: Function}} element (a div.ds-cf-mod) to append; read() returns
         *   { tileKey, hiddenStatic, selectedCfs, orderedKeys }, where orderedKeys is the row order with CFs as 'cf_N'.
         */
        function renderTileSection(opts) {
            opts = opts || {};
            const tileKey = String(opts.tileKey || '').toUpperCase();
            const label = opts.label || tileKey;
            const hiddenStatic = opts.currentHiddenStatic instanceof Set ? opts.currentHiddenStatic : new Set();
            const selectedCfs = opts.currentSelectedCfs instanceof Set ? opts.currentSelectedCfs : new Set();
            const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

            const manifest = Columns.manifest(tileKey);
            const cfs = (CfCatalog.map && CfCatalog.map.get) ? (CfCatalog.map.get(tileKey) || []) : [];
            const totalCount = manifest.length + cfs.length;
            const visibleCount =
                manifest.filter(function (c) { return c.alwaysOn || !hiddenStatic.has(c.key); }).length +
                cfs.filter(function (cf) { return selectedCfs.has(cf.id); }).length;

            const mod = document.createElement('div');
            mod.className = 'ds-cf-mod';
            mod.dataset.tile = tileKey;
            if (totalCount > 0 && (hiddenStatic.size > 0 || selectedCfs.size > 0)) {
                mod.classList.add('open');
            }

            const head = document.createElement('div');
            head.className = 'ds-cf-head';
            head.innerHTML =
                '<span class="ds-cf-caret">&#9656;</span>' +
                '<span>' + _escHtml(label) + ' <span style="color:#94a3b8;font-weight:400;">(' + tileKey + ')</span></span>' +
                '<span class="ds-cf-count">' +
                (totalCount === 0 ? 'no columns' : (visibleCount + ' of ' + totalCount + ' visible')) +
                '</span>';
            head.addEventListener('click', function () { mod.classList.toggle('open'); });
            mod.appendChild(head);

            const body = document.createElement('div');
            body.className = 'ds-cf-body';

            if (totalCount === 0) {
                body.innerHTML = '<div class="ds-cf-empty">No columns registered for this tile.</div>';
                mod.appendChild(body);
                return { element: mod, read: function () { return { tileKey: tileKey, hiddenStatic: [], selectedCfs: [], orderedKeys: [] }; } };
            }

            function makeRow(kind, key, displayName, isChecked, isDisabled, typeChip) {
                const row = document.createElement('div');
                row.className = 'ds-cf-row';
                row.draggable = true;
                row.dataset.tile = tileKey;
                row.dataset.colKind = kind;         // 'static' | 'cf'
                row.dataset.colKey  = String(key);
                row.dataset.orderKey = kind === 'cf' ? ('cf_' + key) : String(key);

                const grip = document.createElement('span');
                grip.className = 'ds-cf-grip';
                grip.textContent = '☰';        // ☰ — visual drag handle
                grip.title = 'Drag to reorder';
                row.appendChild(grip);

                const lbl = document.createElement('label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.dataset.colKind = kind;
                cb.dataset.colKey  = String(key);
                cb.checked = !!isChecked;
                if (isDisabled) { cb.disabled = true; }
                cb.addEventListener('change', function () {
                    refreshHeadCount();
                    onChange();
                });
                lbl.appendChild(cb);
                const nameSpan = document.createElement('span');
                nameSpan.textContent = displayName;
                lbl.appendChild(nameSpan);
                if (typeChip) {
                    const chip = document.createElement('span');
                    chip.className = 'ds-cf-type';
                    chip.textContent = typeChip;
                    lbl.appendChild(chip);
                }
                row.appendChild(lbl);
                _wireRowDnd(row, body, onChange);
                return row;
            }

            manifest.forEach(function (col) {
                const visible = col.alwaysOn || !hiddenStatic.has(col.key);
                body.appendChild(makeRow('static', col.key, col.label, visible, !!col.alwaysOn, null));
            });
            cfs.forEach(function (cf) {
                const visible = selectedCfs.has(cf.id);
                body.appendChild(makeRow('cf', cf.id, cf.name, visible, false, 'Custom'));
            });

            function refreshHeadCount() {
                let vis = 0, tot = 0;
                body.querySelectorAll('.ds-cf-row input[type=checkbox]').forEach(function (cb) {
                    tot += 1;
                    if (cb.checked) vis += 1;
                });
                const badge = head.querySelector('.ds-cf-count');
                if (badge) badge.textContent = tot === 0 ? 'no columns' : (vis + ' of ' + tot + ' visible');
            }

            mod.appendChild(body);

            // `orderedKeys` is the DOM order of every row in the picker,
            // emitted with the cf_<id> prefix for CFs. The host saves this
            // straight into Settings.columnOrder.<TILE> so the next load
            // (and any rebuild) honours the user's chosen sequence.
            function read() {
                const hidden = [];
                const selected = [];
                const orderedKeys = [];
                body.querySelectorAll('.ds-cf-row').forEach(function (row) {
                    const kind = row.dataset.colKind;
                    const key  = row.dataset.colKey;
                    const cb   = row.querySelector('input[type=checkbox]');
                    if (row.dataset.orderKey) orderedKeys.push(row.dataset.orderKey);
                    if (!cb) return;
                    if (kind === 'static') {
                        if (!cb.checked && !cb.disabled) hidden.push(key);
                    } else if (kind === 'cf') {
                        if (cb.checked) {
                            const id = parseInt(key, 10);
                            if (!isNaN(id)) selected.push(id);
                        }
                    }
                });
                return { tileKey: tileKey, hiddenStatic: hidden, selectedCfs: selected, orderedKeys: orderedKeys };
            }

            return { element: mod, read: read };
        }

        return { renderTileSection: renderTileSection };
    })();

    // ====================================================================
    // FBLib.Table — sortable / filterable / drag-reorder / drag-resize
    // table scaffolding. Lifted from the PurchaseOrderSummary.htm render
    // pattern but generalised so any report can adopt it with one init()
    // call.
    //
    // FEATURES
    //   • Click-to-sort with 3-state toggle (unsorted → asc → desc → unsorted)
    //   • Per-column text/select filters in a second sticky header row
    //   • Drag-to-reorder columns (HTML5 drag-and-drop on the title <th>)
    //   • Drag-to-resize column widths (handle on the right edge of each title)
    //   • Lazy chunked body rendering (CHUNK_SIZE rows per tick + scroll-to-load)
    //   • Sticky thead (relies on the host's CSS — see CANONICAL CSS below)
    //   • Optional persistence to FBLib.Settings (column order + widths +
    //     visibility) under a host-supplied settings key.
    //   • Optional Columns drop-down (FBLib.ColumnMenu): show / hide, drag to
    //     reorder, reset; with `rename: true` an admin renames a heading for
    //     everyone (company settings). Pass `columnMenu: { mount }`.
    //
    // CANONICAL CSS  (drop into the host page's <style> block)
    //   .fb-table-container { overflow:auto; }
    //   table.fb-table { width:100%; border-collapse:collapse; font-size:12px; table-layout:fixed; }
    //   table.fb-table th {
    //       background:var(--menu-bg); color:#fff; font-weight:500;   /* brand navy #0B3140 */
    //       padding:7px 10px; text-align:left; white-space:nowrap;
    //       cursor:grab; user-select:none; position:sticky; top:0; z-index:10;
    //       position:relative;
    //   }
    //   table.fb-table th:active { cursor:grabbing; }
    //   table.fb-table th.sort-asc::after  { content:' ▲'; opacity:0.8; }
    //   table.fb-table th.sort-desc::after { content:' ▼'; opacity:0.8; }
    //   table.fb-table th.col-drag-over { background:#164A5F; border-left:3px solid #CBE5FB; }
    //   table.fb-table tr.filter-row th {
    //       top:34px; z-index:9; background:#DEEAF4; cursor:default;
    //       padding:4px 6px;
    //   }
    //   table.fb-table tr.filter-row input, table.fb-table tr.filter-row select {
    //       width:100%; padding:3px 6px; font-size:11px; border:1px solid #C6D0D4;
    //       border-radius:4px; background:#fff;
    //   }
    //   table.fb-table td { padding:4px 10px; border-bottom:1px solid #E3E3E3; white-space:nowrap; }
    //   table.fb-table tr:nth-child(even) td { background:#F7F7F7; }
    //   table.fb-table tr:hover td { background:#DEEAF4 !important; }
    //   .fb-col-resize {
    //       position:absolute; right:0; top:0; width:6px; height:100%;
    //       cursor:col-resize; user-select:none;
    //   }
    //   .fb-col-resize:hover { background:rgba(255,255,255,0.3); }
    //
    // COLUMN SHAPE
    //   {
    //     key:      'num'             // mandatory — must match a row property
    //     label:    'PO #'            // header text
    //     vis:      true              // default visible; set false to hide
    //     width:    160               // initial width in px (optional — flexes if omitted)
    //     align:    'left'            // 'left' (default) | 'right' | 'center'
    //     filter:   'text'            // 'text' | 'select' | false (default 'text')
    //     filterOptions: [...]        // for filter:'select' — array of {value,label}, or 'auto' to populate from data
    //     format:   v => '$' + v      // optional cell formatter (string-in, string-or-Node-out)
    //     link:     'Sales Order'     // optional — wraps cell in <a> calling openModule(link, cellValue)
    //     sortable: true              // default true
    //     menu:     false             // keep an internal (drill / filter-only) column out of the Columns menu
    //     locked:   true              // listed in the Columns menu but can't be hidden
    //   }
    //
    // API
    //   var table = FBLib.Table.init({
    //       tableEl:    document.getElementById('reportTable'),  // your <table class="fb-table"> element
    //       columns:    _columns,
    //       getRows:    () => _dataset,                          // called every render
    //       chunkSize:  200,
    //       lazy:       true,                                    // append-on-scroll (default true)
    //       onSort:     (key, dir) => {},                        // optional hook
    //       onReorder:  (newColumns) => {},                      // optional hook
    //       settingsKey: 'tablePrefs',                           // optional FBLib.Settings key for persistence
    //       columnMenu: {                                        // optional Columns drop-down
    //           mount:  'colsMount',                             //   element / id the button goes in
    //           rename: true,                                    //   admins rename headings for everyone
    //           labelsKey: 'tablePrefsLabels'                    //   company key (default settingsKey + 'Labels')
    //       }
    //   });
    //   table.render();                  // call after getRows() data changes
    //   table.setColumns(newColumns);    // replace columns + re-render
    //   table.getColumns();              // current column array (ordered + widths reflect drag state)
    //   table.sort('num', 'asc');        // programmatic sort
    //   table.getFilters();              // { colKey: filterValue }
    //   table.setFilter(colKey, value);  // programmatic filter
    //   table.clearFilters();
    //   table.setVisible(key, bool);     // show / hide a column (saved)
    //   table.moveColumn(key, targetKey, after);   // reorder (saved)
    //   table.resetColumns();            // the page's own order, visibility and widths
    //   table.setLabel(key, label);      // admin: rename for everyone; '' / null = the page's own name
    //   table.columnMenu                 // the FBLib.ColumnMenu, when columnMenu was given
    //
    // RENAMED HEADINGS live in the company (master) settings under labelsKey
    // as { colKey: 'Heading' }, so they need FBLib.Settings.init with a master
    // store everyone reads (masterStorage 'userProperties', or 'reportData' on
    // a saved report). Only FBLib.Settings.isAdmin() users may rename.
    // getColumns() returns the renamed label, so exports and prints follow
    // it; `defaultLabel` keeps the page's own.
    // ====================================================================
    /** Sort, filter, drag-reorder, drag-resize and lazy-render scaffolding for a plain table; start with init(). */
    const Table = (function () {

        function _escHtml(s) {
            if (s == null) return '';
            return String(s).replace(/[&<>"']/g, function (c) {
                return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
            });
        }

        /**
         * Turns a table into a sortable, filterable, drag-reorder and drag-resize grid with lazy chunked rendering.
         * See the FBLib.Table block above for the column shape and CSS. Nothing is drawn until you call render().
         * @param {object} opts - Table options.
         * @param {HTMLTableElement} opts.tableEl - The table; wrapped in a .fb-table-container if it isn't in one.
         * @param {Function} opts.getRows - Returns the full row array; called on every render.
         * @param {object[]} [opts.columns] - Column definitions { key, label, vis, width, align, filter, format, link, ... }.
         * @param {number} [opts.chunkSize=200] - Rows appended per chunk.
         * @param {boolean} [opts.lazy=true] - Append further chunks as the user scrolls.
         * @param {Function} [opts.onSort] - Called with (key, dir) after a sort; both null when unsorted.
         * @param {Function} [opts.onReorder] - Called with the reordered columns.
         * @param {Function} [opts.onResize] - Called with (key, width) after a resize.
         * @param {string} [opts.settingsKey] - FBLib.Settings key that persists order, widths, hidden columns and sort.
         * @param {object} [opts.columnMenu] - Adds a Columns drop-down: { mount, rename?, labelsKey?, buttonText?, buttonClass? }.
         * @returns {object} API: render(), setColumns(cols), getColumns(), sort(key, dir?), getFilters(), setFilter(key, value),
         *   clearFilters(), getVisibleRows(), setVisible(key, vis), moveColumn(key, targetKey, after), resetColumns(),
         *   setLabel(key, label), columnMenu, element.
         * @throws {Error} Without tableEl or getRows.
         */
        function init(opts) {
            opts = opts || {};
            if (!opts.tableEl) throw new Error('FBLib.Table.init: tableEl required');
            if (typeof opts.getRows !== 'function') throw new Error('FBLib.Table.init: getRows required');

            const tableEl = opts.tableEl;
            tableEl.classList.add('fb-table');
            // Wrap in a scroll container if not already inside one.
            let scrollEl = tableEl.parentElement;
            if (!scrollEl || !scrollEl.classList.contains('fb-table-container')) {
                scrollEl = document.createElement('div');
                scrollEl.className = 'fb-table-container';
                tableEl.parentNode.insertBefore(scrollEl, tableEl);
                scrollEl.appendChild(tableEl);
            }

            // Ensure <thead> + <tbody> exist.
            let theadEl = tableEl.querySelector('thead');
            if (!theadEl) { theadEl = document.createElement('thead'); tableEl.appendChild(theadEl); }
            let tbodyEl = tableEl.querySelector('tbody');
            if (!tbodyEl) { tbodyEl = document.createElement('tbody'); tableEl.appendChild(tbodyEl); }

            // Internal state. _defs keeps the page's own columns, for reset.
            let _defs = (opts.columns || []).map(_normCol);
            let columns = _defs.map(function (c) { return Object.assign({}, c); });
            const getRows = opts.getRows;
            const chunkSize = opts.chunkSize || 200;
            const lazy = opts.lazy !== false;
            const onSort = typeof opts.onSort === 'function' ? opts.onSort : function () {};
            const onReorder = typeof opts.onReorder === 'function' ? opts.onReorder : function () {};
            const onResize = typeof opts.onResize === 'function' ? opts.onResize : function () {};
            const settingsKey = opts.settingsKey || null;
            const menuOpts = opts.columnMenu || null;
            const labelsKey = (menuOpts && menuOpts.labelsKey) || ((settingsKey || tableEl.id || 'table') + 'Labels');
            let columnMenu = null;

            let sortCol = null, sortDir = 'asc';
            const filters = {};
            let dragColKey = null;
            let _renderOffset = 0;
            let _visRows = [];

            // Restore persisted prefs (column order + widths + sort), then the
            // company's renamed headings.
            _restoreFromSettings();
            _applyLabels();

            function _normCol(c) {
                const col = Object.assign({
                    vis: true, sortable: true, filter: 'text', align: 'left'
                }, c);
                if (col.defaultLabel == null) col.defaultLabel = col.label;
                col._defVis = col.vis;
                return col;
            }

            function _settingsReady() {
                return !!(window.FBLib && FBLib.Settings && FBLib.Settings._initialised);
            }

            // Renamed headings: { colKey: label } in the company settings.
            function _labels() {
                if (!_settingsReady()) return {};
                try {
                    const v = (FBLib.Settings.getMaster() || {})[labelsKey];
                    return v && typeof v === 'object' ? v : {};
                } catch (_) { return {}; }
            }
            function _applyLabels() {
                const map = _labels();
                columns.forEach(function (c) {
                    const v = map[c.key];
                    c.label = (typeof v === 'string' && v.trim()) ? v.trim() : c.defaultLabel;
                });
            }

            function _restoreFromSettings() {
                if (!settingsKey || !window.FBLib || !FBLib.Settings || !FBLib.Settings._initialised) return;
                try {
                    const saved = FBLib.Settings.resolve(settingsKey);
                    if (!saved || typeof saved !== 'object') return;
                    if (Array.isArray(saved.order) && saved.order.length) {
                        const map = {};
                        columns.forEach(function (c) { map[c.key] = c; });
                        const reordered = saved.order.map(function (k) { return map[k]; }).filter(Boolean);
                        const extras = columns.filter(function (c) { return saved.order.indexOf(c.key) === -1; });
                        columns = reordered.concat(extras);
                    }
                    if (saved.widths && typeof saved.widths === 'object') {
                        columns.forEach(function (c) {
                            if (saved.widths[c.key]) c.width = saved.widths[c.key];
                        });
                    }
                    if (saved.hidden && Array.isArray(saved.hidden)) {
                        const hs = new Set(saved.hidden);
                        columns.forEach(function (c) { if (hs.has(c.key) && !c.locked) c.vis = false; });
                    }
                    // Columns hidden by default that the user switched on.
                    if (saved.shown && Array.isArray(saved.shown)) {
                        const ss = new Set(saved.shown);
                        columns.forEach(function (c) { if (ss.has(c.key) && c.menu !== false) c.vis = true; });
                    }
                    if (saved.sortCol) { sortCol = saved.sortCol; sortDir = saved.sortDir || 'asc'; }
                } catch (_) {}
            }

            function _persist() {
                if (!settingsKey || !window.FBLib || !FBLib.Settings || !FBLib.Settings._initialised) return;
                try {
                    FBLib.Settings.setUserKey(settingsKey, {
                        order:   columns.map(function (c) { return c.key; }),
                        widths:  columns.reduce(function (a, c) { if (c.width) a[c.key] = c.width; return a; }, {}),
                        hidden:  columns.filter(function (c) { return !c.vis; }).map(function (c) { return c.key; }),
                        shown:   columns.filter(function (c) { return c.vis && !c._defVis; }).map(function (c) { return c.key; }),
                        sortCol: sortCol,
                        sortDir: sortDir
                    });
                    FBLib.Settings.saveUser();
                } catch (_) {}
            }

            // ─── HEADER ─────────────────────────────────────────────────
            function _renderHead() {
                theadEl.innerHTML = '';
                const vis = columns.filter(function (c) { return c.vis; });

                // Title row.
                const titleTr = document.createElement('tr');
                vis.forEach(function (col) {
                    const th = document.createElement('th');
                    th.dataset.colKey = col.key;
                    th.textContent = col.label;
                    th.title = col.label !== col.defaultLabel ? col.label + ' (' + col.defaultLabel + ')' : col.label;
                    if (col.width) th.style.width = col.width + 'px';
                    if (col.align === 'right')  th.style.textAlign = 'right';
                    if (col.align === 'center') th.style.textAlign = 'center';
                    if (sortCol === col.key) th.classList.add('sort-' + sortDir);
                    if (col.sortable) {
                        th.draggable = true;
                        th.addEventListener('click', function (e) {
                            // Ignore clicks on the resize handle.
                            if (e.target && e.target.classList && e.target.classList.contains('fb-col-resize')) return;
                            sort(col.key);
                        });
                        // Drag-to-reorder.
                        th.addEventListener('dragstart', function (e) {
                            dragColKey = col.key;
                            setTimeout(function () { th.style.opacity = '0.4'; }, 0);
                            try { e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
                        });
                        th.addEventListener('dragend', function () {
                            dragColKey = null; th.style.opacity = '';
                            titleTr.querySelectorAll('th').forEach(function (h) { h.classList.remove('col-drag-over'); });
                        });
                        th.addEventListener('dragover', function (e) {
                            e.preventDefault();
                            try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
                            titleTr.querySelectorAll('th').forEach(function (h) { h.classList.remove('col-drag-over'); });
                            if (dragColKey && dragColKey !== col.key) th.classList.add('col-drag-over');
                        });
                        th.addEventListener('dragleave', function () { th.classList.remove('col-drag-over'); });
                        th.addEventListener('drop', function (e) {
                            e.preventDefault();
                            th.classList.remove('col-drag-over');
                            if (!dragColKey || dragColKey === col.key) return;
                            const fi = columns.findIndex(function (c) { return c.key === dragColKey; });
                            const ti = columns.findIndex(function (c) { return c.key === col.key; });
                            if (fi === -1 || ti === -1) return;
                            const [moved] = columns.splice(fi, 1);
                            columns.splice(ti, 0, moved);
                            onReorder(columns.slice());
                            _persist();
                            render();
                            if (columnMenu) columnMenu.refresh();
                        });
                    }
                    // Drag-to-resize handle.
                    const grip = document.createElement('div');
                    grip.className = 'fb-col-resize';
                    grip.draggable = false;
                    grip.addEventListener('mousedown', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        const startX = e.clientX;
                        const startW = th.getBoundingClientRect().width;
                        document.body.style.userSelect = 'none';
                        function onMove(ev) {
                            const delta = ev.clientX - startX;
                            const w = Math.max(40, startW + delta);
                            col.width = Math.round(w);
                            th.style.width = col.width + 'px';
                        }
                        function onUp() {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                            document.body.style.userSelect = '';
                            onResize(col.key, col.width);
                            _persist();
                        }
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                    });
                    th.appendChild(grip);
                    titleTr.appendChild(th);
                });
                theadEl.appendChild(titleTr);

                // Filter row.
                const filterTr = document.createElement('tr');
                filterTr.className = 'filter-row';
                vis.forEach(function (col) {
                    const th = document.createElement('th');
                    th.dataset.colKey = col.key;
                    if (col.filter === false) { filterTr.appendChild(th); return; }
                    const inp = col.filter === 'select'
                        ? document.createElement('select')
                        : document.createElement('input');
                    if (inp.tagName === 'INPUT') {
                        inp.type = 'text';
                        inp.placeholder = 'Filter…';
                        // Datalist for autocomplete on text filters.
                        const listId = tableEl.id + '_dl_' + col.key;
                        let dl = document.getElementById(listId);
                        if (!dl) {
                            dl = document.createElement('datalist');
                            dl.id = listId;
                            tableEl.parentNode.appendChild(dl);
                        }
                        inp.setAttribute('list', listId);
                    } else {
                        const blank = document.createElement('option');
                        blank.value = ''; blank.textContent = '(all)';
                        inp.appendChild(blank);
                        const options = (col.filterOptions === 'auto' || !col.filterOptions)
                            ? _autoOptionsFor(col)
                            : col.filterOptions;
                        options.forEach(function (o) {
                            const op = document.createElement('option');
                            op.value = o.value != null ? o.value : o;
                            op.textContent = o.label != null ? o.label : (o.value != null ? o.value : o);
                            inp.appendChild(op);
                        });
                    }
                    if (filters[col.key]) inp.value = filters[col.key];
                    const apply = function () { filters[col.key] = inp.value; render(); };
                    if (inp.tagName === 'INPUT') {
                        inp.addEventListener('input', _debounce(apply, 180));
                        inp.addEventListener('change', apply);
                    } else {
                        inp.addEventListener('change', apply);
                    }
                    th.appendChild(inp);
                    filterTr.appendChild(th);
                });
                theadEl.appendChild(filterTr);
            }

            function _autoOptionsFor(col) {
                const seen = Object.create(null);
                getRows().forEach(function (r) {
                    const v = r[col.key];
                    if (v == null || v === '') return;
                    seen[String(v)] = true;
                });
                return Object.keys(seen).sort().map(function (v) { return { value: v, label: v }; });
            }

            function _refreshAutocompleteDatalists(rows) {
                const vis = columns.filter(function (c) { return c.vis && c.filter !== false && c.filter !== 'select'; });
                vis.forEach(function (col) {
                    const dl = document.getElementById(tableEl.id + '_dl_' + col.key);
                    if (!dl) return;
                    const seen = Object.create(null);
                    rows.forEach(function (r) {
                        const v = r[col.key];
                        if (v == null || v === '') return;
                        seen[String(v)] = true;
                    });
                    const opts = Object.keys(seen).sort();
                    dl.innerHTML = opts.map(function (v) { return '<option value="' + _escHtml(v) + '"></option>'; }).join('');
                });
            }

            // ─── SORT + FILTER ──────────────────────────────────────────
            function sort(key, dir) {
                if (dir) { sortCol = key; sortDir = dir; }
                else if (sortCol === key) sortDir = (sortDir === 'asc' ? 'desc' : (sortDir === 'desc' ? null : 'asc'));
                else { sortCol = key; sortDir = 'asc'; }
                if (sortDir === null) sortCol = null;
                onSort(sortCol, sortDir);
                _persist();
                render();
            }

            function _sortRows(rows) {
                if (!sortCol) return rows;
                const col = columns.find(function (c) { return c.key === sortCol; });
                const numeric = !!(col && (col.money || col.qty || col.type === 'number'));
                const dirMul = sortDir === 'desc' ? -1 : 1;
                return rows.slice().sort(function (a, b) {
                    let va = a[sortCol], vb = b[sortCol];
                    if (va == null) va = '';
                    if (vb == null) vb = '';
                    if (numeric) {
                        va = parseFloat(va) || 0;
                        vb = parseFloat(vb) || 0;
                    } else {
                        va = String(va).toLowerCase();
                        vb = String(vb).toLowerCase();
                    }
                    return (va < vb ? -1 : va > vb ? 1 : 0) * dirMul;
                });
            }

            function _filterRows(rows) {
                const active = Object.keys(filters).filter(function (k) {
                    return filters[k] != null && String(filters[k]).trim() !== '';
                });
                if (!active.length) return rows;
                return rows.filter(function (r) {
                    for (let i = 0; i < active.length; i++) {
                        const k = active[i];
                        const f = String(filters[k]).trim().toLowerCase();
                        const v = r[k] == null ? '' : String(r[k]).toLowerCase();
                        const col = columns.find(function (c) { return c.key === k; });
                        if (col && col.filter === 'select') {
                            if (v !== f) return false;
                        } else {
                            if (v.indexOf(f) === -1) return false;
                        }
                    }
                    return true;
                });
            }

            // ─── BODY ────────────────────────────────────────────────────
            function _renderBody() {
                tbodyEl.innerHTML = '';
                const all = getRows() || [];
                const filtered = _filterRows(all);
                _visRows = _sortRows(filtered);
                _renderOffset = 0;
                _refreshAutocompleteDatalists(all);

                if (!_visRows.length) {
                    const vis = columns.filter(function (c) { return c.vis; });
                    const tr = document.createElement('tr');
                    const td = document.createElement('td');
                    td.colSpan = vis.length;
                    td.style.cssText = 'padding:2rem;color:#8FA1A7;text-align:center;';
                    td.textContent = all.length ? 'No rows match the current filters.' : 'No data to display.';
                    tr.appendChild(td);
                    tbodyEl.appendChild(tr);
                    return;
                }

                _appendChunk();
                _ensureLazyScroll();
            }

            function _appendChunk() {
                const vis = columns.filter(function (c) { return c.vis; });
                const slice = _visRows.slice(_renderOffset, _renderOffset + chunkSize);
                if (!slice.length) return;
                const frag = document.createDocumentFragment();
                slice.forEach(function (row) {
                    const tr = document.createElement('tr');
                    vis.forEach(function (col) {
                        const td = document.createElement('td');
                        if (col.align === 'right')  td.style.textAlign = 'right';
                        if (col.align === 'center') td.style.textAlign = 'center';
                        const raw = row[col.key];
                        if (col.link && raw != null && raw !== '') {
                            const a = document.createElement('a');
                            a.href = 'javascript:void(0)';
                            a.className = 'fb-row-link';
                            a.textContent = col.format ? col.format(raw, row) : String(raw);
                            a.addEventListener('click', function (e) {
                                e.preventDefault();
                                if (typeof openModule === 'function') openModule(col.link, raw);
                            });
                            td.appendChild(a);
                        } else if (typeof col.format === 'function') {
                            const out = col.format(raw, row);
                            if (out && out.nodeType) td.appendChild(out);
                            else td.innerHTML = out == null ? '' : String(out);
                        } else {
                            td.textContent = raw == null ? '' : String(raw);
                        }
                        tr.appendChild(td);
                    });
                    frag.appendChild(tr);
                });
                tbodyEl.appendChild(frag);
                _renderOffset += slice.length;
            }

            function _ensureLazyScroll() {
                if (!lazy || scrollEl._fbLazyBound) return;
                scrollEl._fbLazyBound = true;
                let ticking = false;
                scrollEl.addEventListener('scroll', function () {
                    if (ticking) return;
                    ticking = true;
                    requestAnimationFrame(function () {
                        ticking = false;
                        if (_renderOffset >= _visRows.length) return;
                        const near = (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) < 400;
                        if (near) _appendChunk();
                    });
                });
            }

            function _debounce(fn, ms) {
                let t = null;
                return function () {
                    const args = arguments, self = this;
                    clearTimeout(t);
                    t = setTimeout(function () { fn.apply(self, args); }, ms);
                };
            }

            // ─── PUBLIC ──────────────────────────────────────────────────
            function render() { _renderHead(); _renderBody(); }
            function setColumns(newCols) {
                _defs = (newCols || []).map(_normCol);
                columns = _defs.map(function (c) { return Object.assign({}, c); });
                _restoreFromSettings(); _applyLabels(); render();
                if (columnMenu) columnMenu.refresh();
            }
            function getColumns() { return columns.slice(); }

            function setVisible(key, vis) {
                const c = columns.find(function (x) { return x.key === key; });
                if (!c || c.menu === false || (c.locked && !vis)) return;
                c.vis = !!vis;
                _persist(); render();
            }
            // Moves a column next to another: before it, or after it when `after`.
            function moveColumn(key, targetKey, after) {
                if (key === targetKey) return;
                const fi = columns.findIndex(function (c) { return c.key === key; });
                if (fi === -1) return;
                const moved = columns.splice(fi, 1)[0];
                const ti = columns.findIndex(function (c) { return c.key === targetKey; });
                if (ti === -1) { columns.splice(fi, 0, moved); return; }
                columns.splice(after ? ti + 1 : ti, 0, moved);
                onReorder(columns.slice());
                _persist(); render();
            }
            // Back to the page's own order, visibility and widths. Keeps the
            // sort, the filters and the company's headings.
            function resetColumns() {
                columns = _defs.map(function (c) { return Object.assign({}, c); });
                _applyLabels();
                onReorder(columns.slice());
                _persist(); render();
            }
            // Admin: renames a heading for everyone. '' / null / the page's own
            // name drops the rename. True once the company settings hold it.
            function setLabel(key, label) {
                if (!_settingsReady() || !FBLib.Settings.isAdmin()) return false;
                const c = columns.find(function (x) { return x.key === key; });
                if (!c) return false;
                const text = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
                const next = Object.assign({}, _labels());
                if (!text || text === c.defaultLabel) delete next[key]; else next[key] = text;
                let ok;
                try {
                    ok = Object.keys(next).length ? FBLib.Settings.publishCompany(labelsKey, next)
                                                   : FBLib.Settings.clearCompany(labelsKey);
                } catch (_) { ok = false; }
                if (!ok) return false;
                _applyLabels();
                render();
                return true;
            }

            if (menuOpts) {
                columnMenu = ColumnMenu.create({
                    mount: menuOpts.mount,
                    buttonText: menuOpts.buttonText,
                    buttonClass: menuOpts.buttonClass,
                    items: function () {
                        return columns.filter(function (c) { return c.menu !== false; }).map(function (c) {
                            return { key: c.key, label: c.label, defaultLabel: c.defaultLabel, vis: c.vis, locked: !!c.locked };
                        });
                    },
                    canRename: function () { return !!menuOpts.rename && _settingsReady() && FBLib.Settings.isAdmin(); },
                    onToggle: setVisible,
                    onMove: moveColumn,
                    onReset: resetColumns,
                    onRename: setLabel
                });
            }
            function getFilters() { return Object.assign({}, filters); }
            function setFilter(key, value) { filters[key] = value; render(); }
            function clearFilters() { Object.keys(filters).forEach(function (k) { delete filters[k]; }); render(); }
            function getVisibleRows() { return _visRows.slice(); }

            return {
                render: render,
                setColumns: setColumns,
                getColumns: getColumns,
                sort: sort,
                getFilters: getFilters,
                setFilter: setFilter,
                clearFilters: clearFilters,
                getVisibleRows: getVisibleRows,
                setVisible: setVisible,
                moveColumn: moveColumn,
                resetColumns: resetColumns,
                setLabel: setLabel,
                columnMenu: columnMenu,
                element: tableEl
            };
        }

        return { init: init };
    })();

    // ====================================================================
    // FBLib.ColumnMenu — a "Columns" drop-down button: tick to show or
    // hide, drag a row to reorder, Show all / Reset. With canRename() an
    // admin clicks a name to rename that heading (for everyone: the host
    // decides where it is stored). Built for tables with several tabs,
    // where one settings drawer can't hold every table's columns.
    //
    //   const menu = FBLib.ColumnMenu.create({
    //       mount:     'colsMount',            // element / id; the button is appended
    //       items:     () => [{ key, label, defaultLabel, vis, locked }],   // in order
    //       onToggle:  (key, vis) => {},
    //       onMove:    (key, targetKey, after) => {},
    //       onReset:   () => {},               // optional: adds Reset
    //       canRename: () => isAdmin,          // optional
    //       onRename:  (key, label) => true,   // '' = back to defaultLabel; false = not saved
    //       buttonText: 'Columns', buttonClass: 'fb-colmenu-btn'
    //   });
    //   menu.refresh();  menu.open();  menu.close();  menu.element
    //
    // FBLib.Table (.fb-table) and FBLib.RptCols (a report-rendered
    // .rpt-table) build one from their columnMenu option; prefer that to
    // calling create() yourself. Styles: fb-styles
    // §37. The popover is position:fixed on <body>, so a scrolling or
    // clipping parent never cuts it off.
    // ====================================================================
    /** A Columns drop-down: show / hide, drag to reorder, reset, and admin rename; see create(). */
    const ColumnMenu = (function () {
        const SVG_COLS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>';
        const SVG_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>';
        const SVG_GRIP = '<svg viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.4"/>' +
            '<circle cx="7" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/>' +
            '<circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></svg>';
        let _openMenu = null;

        function el(tag, cls, text) {
            const n = document.createElement(tag);
            if (cls) n.className = cls;
            if (text != null) n.textContent = text;
            return n;
        }

        /**
         * Builds a Columns drop-down button in a mount element; see the FBLib.ColumnMenu block above.
         * @param {object} opts - Options.
         * @param {HTMLElement|string} opts.mount - Where the button goes.
         * @param {Function} opts.items - Returns [{ key, label, defaultLabel, vis, locked }] in display order.
         * @param {Function} opts.onToggle - (key, vis) when a box is ticked or cleared.
         * @param {Function} opts.onMove - (key, targetKey, after) when a row is dropped on another.
         * @param {Function} [opts.onReset] - Back to the page's own columns; adds the Reset link.
         * @param {Function} [opts.canRename] - True when this user may rename headings.
         * @param {Function} [opts.onRename] - (key, label) → false when not saved.
         * @param {string} [opts.buttonText='Columns'] - The button's text.
         * @param {string} [opts.buttonClass='fb-colmenu-btn'] - The button's class.
         * @returns {object} { open(), close(), refresh(), element } or null without a mount.
         */
        function create(opts) {
            opts = opts || {};
            const mount = typeof opts.mount === 'string' ? document.getElementById(opts.mount) : opts.mount;
            if (!mount) return null;
            const items = typeof opts.items === 'function' ? opts.items : function () { return []; };
            const canRename = function () { try { return !!(opts.canRename && opts.canRename()); } catch (_) { return false; } };

            const btn = el('button', opts.buttonClass || 'fb-colmenu-btn');
            btn.type = 'button';
            btn.title = 'Show, hide and reorder columns';
            btn.innerHTML = SVG_COLS;
            btn.appendChild(el('span', 'fb-colmenu-txt', opts.buttonText || 'Columns'));
            const badge = el('span', 'fb-colmenu-badge');
            btn.appendChild(badge);
            mount.appendChild(btn);

            const pop = el('div', 'fb-colmenu-pop');
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-label', 'Columns');
            let _editing = null, _msg = '', _msgKind = '', _dragKey = null;

            function setMsg(text, kind) { _msg = text || ''; _msgKind = kind || ''; }

            function renderBadge() {
                const hidden = items().filter(function (i) { return !i.vis; }).length;
                badge.textContent = hidden ? hidden + ' hidden' : '';
                btn.classList.toggle('fb-colmenu-on', hidden > 0);
            }

            function render() {
                renderBadge();
                if (!pop.isConnected) return;
                const list = items();
                const admin = canRename();
                const prev = pop.querySelector('.fb-colmenu-list');
                const scrollTop = prev ? prev.scrollTop : 0;
                pop.innerHTML = '';

                const head = el('div', 'fb-colmenu-head');
                head.appendChild(el('span', 'fb-colmenu-title', 'Columns'));
                const acts = el('span', 'fb-colmenu-acts');
                const showAll = el('a', null, 'Show all');
                showAll.onclick = function () {
                    list.forEach(function (i) { if (!i.vis) opts.onToggle(i.key, true); });
                    render();
                };
                acts.appendChild(showAll);
                if (typeof opts.onReset === 'function') {
                    const reset = el('a', null, 'Reset');
                    reset.title = "Back to this table's own order and columns";
                    reset.onclick = function () { opts.onReset(); setMsg(''); render(); };
                    acts.appendChild(reset);
                }
                head.appendChild(acts);
                pop.appendChild(head);
                pop.appendChild(el('div', 'fb-colmenu-hint', admin
                    ? 'Tick to show, drag to reorder. Click a name to rename it for everyone.'
                    : 'Tick to show, drag to reorder.'));

                const ul = el('div', 'fb-colmenu-list');
                list.forEach(function (i) { ul.appendChild(row(i, admin)); });
                pop.appendChild(ul);
                ul.scrollTop = scrollTop;
                if (_msg) pop.appendChild(el('div', 'fb-colmenu-msg' + (_msgKind ? ' ' + _msgKind : ''), _msg));
                if (_editing) {
                    const inp = pop.querySelector('.fb-colmenu-input');
                    if (inp) { inp.focus(); inp.select(); }
                }
            }

            function row(i, admin) {
                const r = el('div', 'fb-colmenu-row' + (i.vis ? '' : ' off'));
                r.dataset.key = i.key;
                r.draggable = _editing !== i.key;
                const grip = el('span', 'fb-colmenu-grip');
                grip.innerHTML = SVG_GRIP;
                r.appendChild(grip);

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = !!i.vis;
                cb.disabled = !!i.locked;
                if (i.locked) cb.title = 'This column is always shown';
                cb.onchange = function () { opts.onToggle(i.key, cb.checked); render(); };
                r.appendChild(cb);

                const renamed = i.defaultLabel != null && i.label !== i.defaultLabel;
                if (_editing === i.key) {
                    const inp = document.createElement('input');
                    inp.type = 'text';
                    inp.className = 'fb-colmenu-input';
                    inp.maxLength = 80;
                    inp.value = i.label;
                    inp.placeholder = i.defaultLabel || '';
                    let done = false;
                    const finish = function (save) {
                        if (done) return;
                        done = true;
                        _editing = null;
                        if (save && inp.value.trim() !== i.label) {
                            const ok = opts.onRename && opts.onRename(i.key, inp.value);
                            setMsg(ok === false ? "That heading didn't save." : 'Saved for everyone.', ok === false ? 'err' : 'ok');
                        }
                        render();
                    };
                    inp.onkeydown = function (e) {
                        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
                    };
                    inp.onblur = function () { finish(true); };
                    r.appendChild(inp);
                    r.appendChild(el('span', 'fb-colmenu-was', i.defaultLabel && renamed ? i.defaultLabel : ''));
                    return r;
                }

                const name = el(admin ? 'button' : 'label', 'fb-colmenu-name' + (renamed ? ' renamed' : ''), i.label);
                if (admin) {
                    name.type = 'button';
                    name.title = 'Rename for everyone' + (renamed ? ' (Fishbowl name: ' + i.defaultLabel + ')' : '');
                    name.onclick = function () { _editing = i.key; setMsg(''); render(); };
                    const pen = el('span', 'fb-colmenu-pen');
                    pen.innerHTML = SVG_EDIT;
                    name.appendChild(pen);
                } else {
                    if (renamed) name.title = 'Fishbowl name: ' + i.defaultLabel;
                    name.onclick = function () { if (!cb.disabled) { cb.checked = !cb.checked; cb.onchange(); } };
                }
                r.appendChild(name);
                if (admin && renamed) {
                    const undo = el('button', 'fb-colmenu-undo', '↺');
                    undo.type = 'button';
                    undo.title = 'Back to "' + i.defaultLabel + '" for everyone';
                    undo.onclick = function () {
                        const ok = opts.onRename && opts.onRename(i.key, '');
                        setMsg(ok === false ? "That heading didn't save." : 'Saved for everyone.', ok === false ? 'err' : 'ok');
                        render();
                    };
                    r.appendChild(undo);
                }

                r.addEventListener('dragstart', function (e) {
                    if (e.target && e.target.tagName === 'INPUT') { e.preventDefault(); return; }
                    _dragKey = i.key;
                    r.classList.add('dragging');
                    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', i.key); } catch (_) {}
                });
                r.addEventListener('dragend', function () {
                    _dragKey = null;
                    pop.querySelectorAll('.fb-colmenu-row').forEach(function (x) { x.classList.remove('dragging', 'drop-before', 'drop-after'); });
                });
                r.addEventListener('dragover', function (e) {
                    if (!_dragKey || _dragKey === i.key) return;
                    e.preventDefault();
                    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
                    const b = r.getBoundingClientRect();
                    const after = e.clientY > b.top + b.height / 2;
                    pop.querySelectorAll('.fb-colmenu-row').forEach(function (x) { if (x !== r) x.classList.remove('drop-before', 'drop-after'); });
                    r.classList.toggle('drop-after', after);
                    r.classList.toggle('drop-before', !after);
                });
                r.addEventListener('dragleave', function () { r.classList.remove('drop-before', 'drop-after'); });
                r.addEventListener('drop', function (e) {
                    e.preventDefault();
                    const after = r.classList.contains('drop-after');
                    r.classList.remove('drop-before', 'drop-after');
                    if (!_dragKey || _dragKey === i.key) return;
                    opts.onMove(_dragKey, i.key, after);
                    _dragKey = null;
                    render();
                });
                return r;
            }

            // Fixed position under the button, right edges aligned; flips
            // above when there is no room below. Divides by the body zoom.
            function place() {
                const rect = btn.getBoundingClientRect();
                const z = (btn.offsetWidth && rect.width) ? rect.width / btn.offsetWidth : 1;
                const vw = window.innerWidth / z, vh = window.innerHeight / z;
                const bt = rect.top / z, bb = rect.bottom / z, br = rect.right / z;
                const w = Math.min(300, vw - 16);
                pop.style.width = w + 'px';
                pop.style.left = Math.max(8, Math.min(br - w, vw - w - 8)) + 'px';
                const below = vh - bb - 12, above = bt - 12;
                const up = below < 240 && above > below;
                pop.style.maxHeight = Math.max(160, Math.min(460, up ? above : below)) + 'px';
                pop.style.top = up ? '' : (bb + 4) + 'px';
                pop.style.bottom = up ? (vh - bt + 4) + 'px' : '';
            }

            function onOutside(e) {
                if (pop.contains(e.target) || btn.contains(e.target)) return;
                close();
            }
            function onKey(e) { if (e.key === 'Escape' && !_editing) close(); }

            function open() {
                if (_openMenu && _openMenu !== api) _openMenu.close();
                if (pop.isConnected) return;
                setMsg('');
                document.body.appendChild(pop);
                btn.classList.add('open');
                _openMenu = api;
                render();
                place();
                document.addEventListener('pointerdown', onOutside, true);
                document.addEventListener('keydown', onKey);
                window.addEventListener('resize', place);
            }
            function close() {
                if (!pop.isConnected) return;
                const inp = pop.querySelector('.fb-colmenu-input');
                if (inp) inp.blur();            // saves a rename in progress
                _editing = null;
                pop.remove();
                btn.classList.remove('open');
                if (_openMenu === api) _openMenu = null;
                document.removeEventListener('pointerdown', onOutside, true);
                document.removeEventListener('keydown', onKey);
                window.removeEventListener('resize', place);
            }

            btn.addEventListener('click', function () { if (pop.isConnected) close(); else open(); });

            const api = { open: open, close: close, refresh: render, element: btn };
            renderBadge();
            return api;
        }

        return { create: create };
    })();

    // ====================================================================
    // FBLib.Export — blob download + CSV + native .xlsx workbook writer
    // --------------------------------------------------------------------
    // WHY THIS EXISTS
    //   1. Every report had its own copy of the `<a download>` blob dance,
    //      and most copies were subtly broken (see DOWNLOAD below).
    //   2. "Export Excel" buttons were all emitting CSV. Customers then
    //      re-format and Save-As on every single export. This module
    //      writes a real .xlsx so the formatting ships with the file.
    //
    // NO THIRD-PARTY LIBRARY ON PURPOSE
    //   An .xlsx is a ZIP of XML parts, so the whole writer is ~300 lines
    //   of plain JS. SheetJS's community build cannot write cell styles at
    //   all (fills/fonts are a paid feature) and ExcelJS is ~280 kB — and
    //   CLAUDE.md rules out relying on a CDN, because on-premise sites are
    //   frequently on restricted networks. Hand-rolling keeps reports
    //   offline-safe and gives us exactly the style vocabulary we need.
    //   Where `CompressionStream('deflate-raw')` exists we deflate the
    //   parts; otherwise we emit a store-only ZIP, which Excel opens fine
    //   (just a larger file).
    //
    // DOWNLOAD — the JxBrowser gotchas this module exists to centralise
    //   * A *detached* <a download> does not reliably fire in JxBrowser.
    //     The anchor must be appended to document.body before click().
    //   * Revoking the object URL synchronously after click() races the
    //     download handler. When the URL dies first, Chromium can no
    //     longer resolve the `download` filename and falls back to the
    //     blob's UUID path segment — which is why an export that worked
    //     once comes back a second time with no file extension. Cleanup
    //     is therefore deferred by 4s.
    //   * The native Save-As dialog opens BEHIND the Fishbowl window (or
    //     on another monitor). That is a client limitation, not a bug in
    //     report JS — tell users to Alt+Tab if "nothing happens".
    //
    // API
    //   FBLib.Export.download(dataOrBlob, filename, mime)
    //   FBLib.Export.csv({ filename, cols, rows })                  -> filename
    //   await FBLib.Export.xlsx({ filename, sheets: [sheet, ...] }) -> filename
    //       // single-sheet shorthand: pass `sheet:` instead of `sheets:`
    //
    //   sheet = {
    //     name:      'SOA Detail',     // tab name (sanitised, <=31 chars)
    //     title:     'SOA Report',     // merged banner row (optional)
    //     subtitle:  ['Group: NSW…'],  // string | string[] under the title
    //     cols:      [col, ...],
    //     rows:      [ {…}, … ],       // objects keyed by col.key
    //     totals:    true,             // SUBTOTAL(109) footer row
    //     freeze:    true,             // freeze above the data (default true)
    //     freezeCols:1,                // also pin N leading columns (cross-tabs)
    //     autoFilter:true,             // (default true)
    //     landscape: true,             // (default true) fit-to-width printing
    //     headerFill:'FF1E3A5F'        // ARGB, defaults to the BI table navy
    //   }
    //
    //   col = { key, label, w, type }  where `type` is one of
    //     'text' | 'int' | 'qty' | 'money' | 'date' | 'percent'.
    //   The legacy boolean flags reports already carry (`money: true`,
    //   `qty: true`, `date: true`) are honoured too, so an existing
    //   `_cols` array can be handed straight in. `w` is the on-screen
    //   pixel width and is converted to Excel character units.
    //   `noTotal: true` keeps a numeric column out of the totals row —
    //   set it on unit prices and other RATES, which must never be summed.
    //   NOTE: a 'percent' cell wants the FRACTION (0.82), not 82 — Excel's
    //   percent format multiplies by 100 on display.
    //
    //   PER-ROW OVERRIDES (cross-tab reports). A column-level type can't
    //   describe a cross-tab, where one column holds a currency on one row,
    //   a percentage on the next and free text on a third. Any row may
    //   therefore carry two reserved keys:
    //     __fmt: { colKey: 'percent', otherKey: 'text', … }  per-cell type
    //     __row: 'total'                                     emphasised row
    //   Rows flagged __row:'total' are skipped by the sheet-level `totals`
    //   footer so a section summary is never summed into the grand total.
    //
    // WHAT THE FORMATTING BUYS YOU OVER CSV
    //   Dates land as real Excel date serials and money/qty as real
    //   numbers, so there are no "text stored as a number" warnings and
    //   the user can sum a column the moment the file opens. The totals
    //   row uses SUBTOTAL(109,…) rather than static values, so it follows
    //   whatever the user picks in the AutoFilter instead of going stale.
    // ====================================================================
    /** File downloads that work in JxBrowser, plus CSV and native .xlsx writers (no CDN dependency). */
    const Export = (function () {

        const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        // ─── DOWNLOAD ────────────────────────────────────────────────
        /**
         * Downloads data as a file in a way that works in JxBrowser (an attached anchor, its URL revoked after 4 s).
         * The Save-As dialog can open behind the Fishbowl window; tell users to Alt+Tab if nothing seems to happen.
         * @param {Blob|string|BufferSource} data - The content; anything but a Blob is wrapped in a Blob of type mime.
         * @param {string} [filename='download'] - The suggested file name.
         * @param {string} [mime='application/octet-stream'] - MIME type for non-Blob data.
         * @returns {string} The filename argument, as passed.
         */
        function download(data, filename, mime) {
            const blob = (typeof Blob !== 'undefined' && data instanceof Blob)
                ? data
                : new Blob([data], { type: mime || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || 'download';
            a.rel = 'noopener';
            a.style.display = 'none';
            document.body.appendChild(a);           // detached anchors don't fire in JxBrowser
            a.click();
            // Deferred cleanup — revoking synchronously races the download
            // handler and costs us the filename (see the block comment).
            setTimeout(function () {
                try { document.body.removeChild(a); } catch (_) {}
                try { URL.revokeObjectURL(url); } catch (_) {}
            }, 4000);
            return filename;
        }

        // ─── SHARED HELPERS ──────────────────────────────────────────
        /**
         * Makes a filename-safe slug for composing a filename: runs of non-alphanumerics become '_', trimmed at both ends.
         * @param {*} s - The text, e.g. a customer name.
         * @param {string} [fallback='export'] - Returned when nothing is left.
         * @returns {string} e.g. "Acme_Corp_Pty_Ltd".
         */
        function slug(s, fallback) {
            const out = String(s == null ? '' : s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            return out || (fallback || 'export');
        }
        /**
         * Returns today's local date as YYYY-MM-DD, for composing a filename.
         * @returns {string} e.g. "2026-10-13".
         */
        function stamp() {
            const d = new Date();
            return d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
        }
        function withExt(name, ext) {
            const n = String(name || 'export');
            return new RegExp('\\.' + ext + '$', 'i').test(n) ? n : n + '.' + ext;
        }

        // Cell types. The order is positional — it indexes into the cellXfs
        // blocks built by stylesXml() — so append new types at the END.
        const _TYPE_ORDER = { text: 0, int: 1, qty: 2, money: 3, date: 4, percent: 5 };
        const _NTYPES = 6;
        const _XF_DATA = 5;                        // first data xf (plain rows)
        const _XF_BAND = _XF_DATA + _NTYPES;       // banded rows
        const _XF_TOTAL = _XF_BAND + _NTYPES;      // totals row

        function colType(c) {
            if (c && c.type && _TYPE_ORDER[c.type] != null) return c.type;
            if (!c) return 'text';
            if (c.money) return 'money';
            if (c.qty) return 'qty';
            if (c.date) return 'date';
            if (c.int) return 'int';
            if (c.percent) return 'percent';
            return 'text';
        }

        // Per-ROW format override. Cross-tab reports put a percentage, a
        // count and a free-text note in the same column on different rows,
        // which a column-level type cannot express. A row may therefore
        // carry `__fmt: { colKey: 'text' | 'percent' | … }` to override the
        // column type for that row only, and `__row: 'total'` to render the
        // whole row in the emphasised totals style.
        function cellType(row, col, colT) {
            const o = row && row.__fmt;
            const t = o && o[col.key];
            return (t && _TYPE_ORDER[t] != null) ? t : colT;
        }
        function dateText(v) {
            try { return Common.formatDate(v); }
            catch (_) { return String(v == null ? '' : v).split(' ')[0]; }
        }

        // ─── CSV ─────────────────────────────────────────────────────
        /**
         * Downloads rows as a UTF-8 CSV (with a BOM so Excel reads it as UTF-8); every field is quoted.
         * Kept beside xlsx() for systems that want a plain file, and as the fallback where Excel is locked down.
         * @param {object} opts - CSV options.
         * @param {string} [opts.filename='export'] - File name; '.csv' is added if missing.
         * @param {object[]} opts.cols - Columns { key, label, type } (as for xlsx); dates use formatDate, money 2 decimals.
         * @param {object[]} opts.rows - Row objects keyed by col.key.
         * @returns {string} The file name used.
         */
        function csv(opts) {
            opts = opts || {};
            const cols = opts.cols || [];
            const rows = opts.rows || [];
            const q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
            const lines = [cols.map(function (c) { return q(c.label || c.key); }).join(',')];
            rows.forEach(function (r) {
                lines.push(cols.map(function (c) {
                    const t = cellType(r, c, colType(c));
                    let v = r[c.key];
                    if (t === 'date') v = dateText(v);
                    else if (t === 'money') v = (parseFloat(v) || 0).toFixed(2);
                    return q(v);
                }).join(','));
            });
            const name = withExt(opts.filename || 'export', 'csv');
            // Leading BOM so Excel reads it as UTF-8 rather than ANSI.
            download(String.fromCharCode(0xFEFF) + lines.join('\r\n'), name, 'text/csv;charset=utf-8;');
            return name;
        }

        // ═══ ZIP CONTAINER ═══════════════════════════════════════════
        const _CRC = (function () {
            const t = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[n] = c >>> 0;
            }
            return t;
        })();
        function crc32(buf) {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < buf.length; i++) c = _CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        }
        function u16(n) { return [n & 255, (n >>> 8) & 255]; }
        function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
        function utf8(s) { return new TextEncoder().encode(s); }
        function concat(chunks) {
            let len = 0;
            chunks.forEach(function (c) { len += c.length; });
            const out = new Uint8Array(len);
            let o = 0;
            chunks.forEach(function (c) { out.set(c, o); o += c.length; });
            return out;
        }
        async function deflateRaw(bytes) {
            if (typeof CompressionStream !== 'function') return null;
            try {
                const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
                const buf = await new Response(stream).arrayBuffer();
                const out = new Uint8Array(buf);
                return out.length < bytes.length ? out : null;   // no point if it grew
            } catch (_) { return null; }
        }

        // files: [{ name, text }] → Blob of a valid ZIP archive.
        async function zip(files) {
            const now = new Date();
            const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
            const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
            const local = [], central = [];
            let offset = 0;

            for (const f of files) {
                const nameBytes = utf8(f.name);
                const raw = utf8(f.text);
                const packed = await deflateRaw(raw);
                const body = packed || raw;
                const method = packed ? 8 : 0;
                const crc = crc32(raw);

                const lh = Uint8Array.from([].concat(
                    u32(0x04034B50), u16(20), u16(0x0800), u16(method),
                    u16(dosTime), u16(dosDate),
                    u32(crc), u32(body.length), u32(raw.length),
                    u16(nameBytes.length), u16(0)
                ));
                local.push(lh, nameBytes, body);

                central.push(Uint8Array.from([].concat(
                    u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(method),
                    u16(dosTime), u16(dosDate),
                    u32(crc), u32(body.length), u32(raw.length),
                    u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
                    u32(0), u32(offset)
                )), nameBytes);

                offset += lh.length + nameBytes.length + body.length;
            }

            const cd = concat(central);
            const eocd = Uint8Array.from([].concat(
                u32(0x06054B50), u16(0), u16(0),
                u16(files.length), u16(files.length),
                u32(cd.length), u32(offset), u16(0)
            ));
            return new Blob([concat(local), cd, eocd], { type: XLSX_MIME });
        }

        // ═══ SPREADSHEETML ═══════════════════════════════════════════
        const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

        // XML 1.0 forbids most C0 control characters outright, and Fishbowl
        // strips them from inline script anyway — scrub rather than emit.
        function xesc(s) {
            return String(s == null ? '' : s)
                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        function colLetter(i) {                     // 0 -> A, 26 -> AA
            let s = '';
            i += 1;
            while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; }
            return s;
        }
        // Excel serial date — day 0 is 1899-12-30, so 1970-01-01 is 25569.
        function excelDate(v) {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v));
            if (!m) return null;
            return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
        }
        // px (on-screen column width) → Excel character units.
        function excelWidth(px) {
            const n = parseFloat(px);
            if (!n || n <= 0) return 14;
            return Math.min(60, Math.max(6, Math.round(((n - 5) / 7) * 100) / 100));
        }
        function sheetName(s, i) {
            let n = String(s == null ? '' : s).replace(/[\[\]\*\?\/\\:]/g, ' ').trim();
            if (!n) n = 'Sheet' + (i + 1);
            return n.slice(0, 31);
        }

        // Java SimpleDateFormat (DateFormatShort) → an Excel number format.
        // Only the d/M/y tokens and plain separators are portable; anything
        // exotic falls back to an unambiguous ISO-ish format.
        function excelDateFormat() {
            let f = 'dd/MM/yyyy';
            try { if (Common.FB_DATE_FORMAT) f = Common.FB_DATE_FORMAT; } catch (_) {}
            return /^[dMy\/\-\. ]+$/.test(f) ? f.toLowerCase() : 'yyyy-mm-dd';
        }
        function excelMoneyFormat() {
            let sym = '$';
            try { sym = (Common.currency() || {}).symbol || '$'; } catch (_) {}
            sym = String(sym).replace(/"/g, '');
            const body = '"' + sym + '"#,##0.00';
            return body + ';[Red]-' + body;
        }

        // styles.xml. The cellXfs indices are positional and the writer
        // below depends on the exact layout, so keep them in step:
        //   0 body-default   1 title   2 subtitle   3 header   4 header-right
        //   then three blocks of _NTYPES xfs in _TYPE_ORDER order
        //   (text,int,qty,money,date,percent): data-plain at _XF_DATA,
        //   data-banded at _XF_BAND, totals at _XF_TOTAL.
        //
        // QTY USES numFmtId 0 ("General") ON PURPOSE. Quantities have to
        // render 2 as "2" and 1.5 as "1.5" in the same column, and Excel
        // has no mask that does that: every optional-decimal pattern
        // (#,##0.####, 0.####, #,##0.###) renders a whole number with a
        // dangling decimal point — "2." — which was verified in Excel
        // itself. General is the only format that gets both right. The
        // cost is no thousands separator on quantities, which is
        // acceptable at Fishbowl qty magnitudes and matches what
        // Common.formatQty already shows on screen.
        function stylesXml(headerFill) {
            const money = xesc(excelMoneyFormat());
            const date = xesc(excelDateFormat());
            const dataXf = function (fill, border) {
                return [
                    '<xf numFmtId="0"   fontId="0" fillId="' + fill + '" borderId="' + border + '" applyFill="1" applyBorder="1"/>',
                    '<xf numFmtId="3"   fontId="0" fillId="' + fill + '" borderId="' + border + '" applyNumberFormat="1" applyFill="1" applyBorder="1"/>',
                    '<xf numFmtId="0"   fontId="0" fillId="' + fill + '" borderId="' + border + '" applyFill="1" applyBorder="1"/>',
                    '<xf numFmtId="164" fontId="0" fillId="' + fill + '" borderId="' + border + '" applyNumberFormat="1" applyFill="1" applyBorder="1"/>',
                    '<xf numFmtId="166" fontId="0" fillId="' + fill + '" borderId="' + border + '" applyNumberFormat="1" applyFill="1" applyBorder="1"/>',
                    '<xf numFmtId="167" fontId="0" fillId="' + fill + '" borderId="' + border + '" applyNumberFormat="1" applyFill="1" applyBorder="1"/>'
                ].join('');
            };
            const totalXf = [
                '<xf numFmtId="0"   fontId="4" fillId="4" borderId="2" applyFont="1" applyFill="1" applyBorder="1"/>',
                '<xf numFmtId="3"   fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>',
                '<xf numFmtId="0"   fontId="4" fillId="4" borderId="2" applyFont="1" applyFill="1" applyBorder="1"/>',
                '<xf numFmtId="164" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>',
                '<xf numFmtId="166" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>',
                '<xf numFmtId="167" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>'
            ].join('');

            return XML_HEAD +
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                '<numFmts count="3">' +
                    '<numFmt numFmtId="164" formatCode="' + money + '"/>' +
                    '<numFmt numFmtId="166" formatCode="' + date + '"/>' +
                    // 0.0% rather than Excel's built-in 0.00% so the workbook
                    // matches the 1-dp percentages the reports show on screen.
                    '<numFmt numFmtId="167" formatCode="0.0%"/>' +
                '</numFmts>' +
                '<fonts count="5">' +
                    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
                    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
                    '<font><b/><sz val="16"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>' +
                    '<font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>' +
                    '<font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>' +
                '</fonts>' +
                '<fills count="5">' +
                    '<fill><patternFill patternType="none"/></fill>' +
                    '<fill><patternFill patternType="gray125"/></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor rgb="' + xesc(headerFill) + '"/><bgColor indexed="64"/></patternFill></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill>' +
                '</fills>' +
                '<borders count="3">' +
                    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
                    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>' +
                    '<border><left/><right/><top style="double"><color rgb="' + xesc(headerFill) + '"/></top><bottom/><diagonal/></border>' +
                '</borders>' +
                '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
                '<cellXfs count="' + (_XF_TOTAL + _NTYPES) + '">' +
                    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
                    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
                    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
                    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
                    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>' +
                    dataXf(0, 1) + dataXf(3, 1) + totalXf +
                '</cellXfs>' +
                '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
                '</styleSheet>';
        }

        function inlineStrCell(ref, style, text) {
            if (text == null || text === '') return '<c r="' + ref + '" s="' + style + '"/>';
            return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
                xesc(text) + '</t></is></c>';
        }
        function numCell(ref, style, n) {
            return '<c r="' + ref + '" s="' + style + '"><v>' + n + '</v></c>';
        }

        // Build one worksheet part. Returns { xml, printTitles }.
        function sheetXml(sheet) {
            const cols = (sheet.cols || []).filter(Boolean);
            const rows = sheet.rows || [];
            const lastCol = colLetter(Math.max(0, cols.length - 1));
            const subtitles = sheet.subtitle == null ? []
                : (Array.isArray(sheet.subtitle) ? sheet.subtitle : [sheet.subtitle]).filter(function (s) { return s !== '' && s != null; });
            const types = cols.map(colType);
            const body = [];
            const merges = [];
            let r = 1;

            // ── banner ───────────────────────────────────────────────
            if (sheet.title) {
                body.push('<row r="' + r + '" ht="22" customHeight="1">' + inlineStrCell('A' + r, 1, sheet.title) + '</row>');
                if (cols.length > 1) merges.push('A' + r + ':' + lastCol + r);
                r++;
            }
            subtitles.forEach(function (s) {
                body.push('<row r="' + r + '" ht="15" customHeight="1">' + inlineStrCell('A' + r, 2, s) + '</row>');
                if (cols.length > 1) merges.push('A' + r + ':' + lastCol + r);
                r++;
            });
            if (sheet.title || subtitles.length) r++;          // spacer row

            // ── header ───────────────────────────────────────────────
            const headerRow = r;
            body.push('<row r="' + r + '" ht="28" customHeight="1">' +
                cols.map(function (c, i) {
                    const numeric = types[i] !== 'text';
                    return inlineStrCell(colLetter(i) + r, numeric ? 4 : 3, c.label || c.key);
                }).join('') + '</row>');
            r++;

            // ── data ─────────────────────────────────────────────────
            const firstData = r;
            rows.forEach(function (row, ri) {
                // Banded rows read better on paper. A row flagged __row:'total'
                // (cross-tab summary lines) takes the emphasised block instead.
                const isTotalRow = row && row.__row === 'total';
                const base = isTotalRow ? _XF_TOTAL : (ri % 2 === 1 ? _XF_BAND : _XF_DATA);
                const cells = cols.map(function (c, i) {
                    const ref = colLetter(i) + r;
                    const t = cellType(row, c, types[i]);
                    const s = base + _TYPE_ORDER[t];
                    const v = row[c.key];
                    if (t === 'date') {
                        const d = excelDate(v);
                        return d == null ? inlineStrCell(ref, base, v == null ? '' : String(v)) : numCell(ref, s, d);
                    }
                    if (t === 'money' || t === 'qty' || t === 'int' || t === 'percent') {
                        const n = parseFloat(v);
                        return isNaN(n) ? '<c r="' + ref + '" s="' + s + '"/>' : numCell(ref, s, n);
                    }
                    return inlineStrCell(ref, s, v == null ? '' : String(v));
                }).join('');
                body.push('<row r="' + r + '">' + cells + '</row>');
                r++;
            });
            const lastData = r - 1;

            // ── totals ───────────────────────────────────────────────
            // SUBTOTAL(109,…) rather than SUM so the footer tracks the
            // user's AutoFilter selection. Rate columns (unit price and
            // friends) carry noTotal and are deliberately left blank.
            //
            // The blank spacer row is load-bearing, not cosmetic: on open
            // Excel expands an AutoFilter to the whole contiguous block,
            // which swallows an adjacent totals row (it then shows up in
            // the filter dropdowns and gets hidden by filtering). A gap
            // terminates the region and keeps the filter over data only.
            let totalRow = 0;
            if (sheet.totals && rows.length) {
                r++;
                totalRow = r;
                const cells = cols.map(function (c, i) {
                    const ref = colLetter(i) + r;
                    const t = types[i];
                    const s = _XF_TOTAL + _TYPE_ORDER[t];
                    if (i === 0) return inlineStrCell(ref, _XF_TOTAL, 'Total (' + rows.length + ' line' + (rows.length === 1 ? '' : 's') + ')');
                    if (c.noTotal || (t !== 'money' && t !== 'qty' && t !== 'int')) return '<c r="' + ref + '" s="' + s + '"/>';
                    let sum = 0;
                    rows.forEach(function (row) {
                        if (row && row.__row === 'total') return;   // don't re-sum a section's own summary line
                        const n = parseFloat(row[c.key]);
                        if (!isNaN(n)) sum += n;
                    });
                    const range = colLetter(i) + firstData + ':' + colLetter(i) + lastData;
                    return '<c r="' + ref + '" s="' + s + '"><f>SUBTOTAL(109,' + range + ')</f>' +
                        '<v>' + (Math.round(sum * 1e6) / 1e6) + '</v></c>';
                }).join('');
                body.push('<row r="' + r + '" ht="20" customHeight="1">' + cells + '</row>');
                r++;
            }

            // ── assemble (element order is fixed by the schema) ──────
            const freeze = sheet.freeze !== false;
            // freezeCols pins N leading columns as well as the header rows —
            // essential for a wide cross-tab, where the row-label column
            // scrolls out of view otherwise.
            const xSplit = Math.max(0, parseInt(sheet.freezeCols, 10) || 0);
            const parts = [];
            parts.push(XML_HEAD, '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
            parts.push('<sheetPr><tabColor rgb="' + xesc(sheet.headerFill || 'FF1E3A5F') + '"/><pageSetUpPr fitToPage="1"/></sheetPr>');
            parts.push('<dimension ref="A1:' + lastCol + Math.max(1, r - 1) + '"/>');
            parts.push('<sheetViews><sheetView showGridLines="0" workbookViewId="0">');
            if (freeze || xSplit) {
                const ySplit = freeze ? headerRow : 0;
                const topLeft = colLetter(xSplit) + (ySplit + 1);
                // activePane must match which splits are present, or Excel
                // silently drops the frozen panes.
                const pane = (ySplit && xSplit) ? 'bottomRight' : (ySplit ? 'bottomLeft' : 'topRight');
                parts.push('<pane' +
                    (xSplit ? ' xSplit="' + xSplit + '"' : '') +
                    (ySplit ? ' ySplit="' + ySplit + '"' : '') +
                    ' topLeftCell="' + topLeft + '" activePane="' + pane + '" state="frozen"/>' +
                    '<selection pane="' + pane + '" activeCell="' + topLeft + '" sqref="' + topLeft + '"/>');
            }
            parts.push('</sheetView></sheetViews>');
            parts.push('<sheetFormatPr defaultRowHeight="15"/>');
            if (cols.length) {
                parts.push('<cols>' + cols.map(function (c, i) {
                    return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + excelWidth(c.w) + '" customWidth="1"/>';
                }).join('') + '</cols>');
            }
            parts.push('<sheetData>' + body.join('') + '</sheetData>');
            if (sheet.autoFilter !== false && cols.length && rows.length) {
                parts.push('<autoFilter ref="A' + headerRow + ':' + lastCol + lastData + '"/>');
            }
            if (merges.length) {
                parts.push('<mergeCells count="' + merges.length + '">' +
                    merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>');
            }
            parts.push('<printOptions horizontalCentered="0"/>');
            parts.push('<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>');
            parts.push('<pageSetup paperSize="9" orientation="' + (sheet.landscape === false ? 'portrait' : 'landscape') +
                '" fitToWidth="1" fitToHeight="0"/>');
            parts.push('<headerFooter><oddFooter>&amp;L' + xesc(sheet.title || sheet.name || '') +
                '&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>');
            parts.push('</worksheet>');

            return { xml: parts.join(''), headerRow: headerRow, totalRow: totalRow };
        }

        // ─── WORKBOOK ────────────────────────────────────────────────
        /**
         * Builds a formatted .xlsx workbook (real dates and numbers, banded rows, SUBTOTAL totals row) and downloads it.
         * See the FBLib.Export block above for the sheet and column shapes. Percent cells want a fraction (0.82, not 82).
         * @async
         * @param {object} opts - Workbook options.
         * @param {string} [opts.filename='export'] - File name; '.xlsx' is added if missing.
         * @param {object[]} [opts.sheets] - Sheet specs { name, title, subtitle, cols, rows, totals, freeze, freezeCols, ... }.
         * @param {object} [opts.sheet] - Single-sheet shorthand for sheets: [sheet].
         * @param {string} [opts.headerFill='FF1E3A5F'] - ARGB header colour for every sheet.
         * @returns {Promise<string>} The file name used.
         * @throws {Error} When no sheets are supplied.
         */
        async function xlsx(opts) {
            opts = opts || {};
            const sheets = (opts.sheets || (opts.sheet ? [opts.sheet] : [])).filter(Boolean);
            if (!sheets.length) throw new Error('FBLib.Export.xlsx: no sheets supplied.');

            const names = [];
            const built = sheets.map(function (s, i) {
                let n = sheetName(s.name, i);
                let dedupe = 2;
                while (names.indexOf(n.toLowerCase()) !== -1) { n = sheetName(s.name, i).slice(0, 28) + ' ' + (dedupe++); }
                names.push(n.toLowerCase());
                return { name: n, built: sheetXml(Object.assign({ headerFill: opts.headerFill }, s)) };
            });

            // Repeat the header row at the top of every printed page.
            const defined = built.map(function (b, i) {
                return '<definedName name="_xlnm.Print_Titles" localSheetId="' + i + '">' +
                    '\'' + xesc(b.name.replace(/'/g, "''")) + '\'!$' + b.built.headerRow + ':$' + b.built.headerRow +
                    '</definedName>';
            }).join('');

            const files = [
                {
                    name: '[Content_Types].xml',
                    text: XML_HEAD +
                        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                        '<Default Extension="xml" ContentType="application/xml"/>' +
                        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                        built.map(function (b, i) {
                            return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
                        }).join('') +
                        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                        '</Types>'
                },
                {
                    name: '_rels/.rels',
                    text: XML_HEAD +
                        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                        '</Relationships>'
                },
                {
                    name: 'xl/workbook.xml',
                    text: XML_HEAD +
                        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
                        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                        '<workbookPr date1904="0"/>' +
                        '<sheets>' + built.map(function (b, i) {
                            return '<sheet name="' + xesc(b.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
                        }).join('') + '</sheets>' +
                        (defined ? '<definedNames>' + defined + '</definedNames>' : '') +
                        // fullCalcOnLoad so the SUBTOTAL footer is live the
                        // moment the workbook opens.
                        '<calcPr calcId="171027" fullCalcOnLoad="1"/>' +
                        '</workbook>'
                },
                {
                    name: 'xl/_rels/workbook.xml.rels',
                    text: XML_HEAD +
                        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                        built.map(function (b, i) {
                            return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
                        }).join('') +
                        '<Relationship Id="rId' + (built.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
                        '</Relationships>'
                },
                { name: 'xl/styles.xml', text: stylesXml(opts.headerFill || 'FF1E3A5F') }
            ];
            built.forEach(function (b, i) {
                files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: b.built.xml });
            });

            const blob = await zip(files);
            const name = withExt(opts.filename || 'export', 'xlsx');
            download(blob, name, XLSX_MIME);
            return name;
        }

        return {
            download: download,
            csv: csv,
            xlsx: xlsx,
            slug: slug,
            stamp: stamp
        };
    })();

    // ====================================================================
    // FBLib.FilterViews — saved views behind one compact header button.
    //
    // Two kinds of view, shown as two groups in one popover:
    //   My views       per Fishbowl user; each user's own list.
    //   Company views  published by an admin, read LIVE by everyone from
    //                  FBLib.SharedData. Not copied into anyone's list, so
    //                  "delete for all" removes a view for everyone on their
    //                  next load and never touches a personal view. Users can
    //                  "save a copy" to edit one; they can't change the
    //                  original.
    // Either kind can be starred as "open by default" (per user). An admin
    // can also flag one company view as the default for everyone; a user's
    // own star wins over it.
    //
    // TWO WAYS TO PLUG IN
    //
    //  1. Filter-row tables (Dashboards / Individual Pages) — zero config:
    //       const views = FBLib.FilterViews.attach({
    //           tile: 'SO', mount: 'fvMount', toggles: ['hideEstimates'],
    //           getSort: () => ({ col: sortColumn, dir: sortDirection }),
    //           setSort: s => { sortColumn = s.col; sortDirection = s.dir; },
    //           apply:   () => applyFilters()
    //       });
    //       views.beforeLoad()   top of every build (loadData)
    //       views.changed()      after every filter / sort change
    //       views.detach()       from Clear Filters
    //     State = every `.filter-row [data-filter]` value + the toggle
    //     checkboxes + the sort. Also owns the page's `persistFilters`
    //     ("remember table filters") session memory.
    //
    //  2. Anything else (the Summary reports) — the page supplies the state:
    //       attach({ tile, mount,
    //                capture: () => stateObject,          // JSON-able
    //                restore: state => { ... },           // may return a Promise
    //                canon:   state => 'comparable string',   // optional
    //                matches: (viewState, liveState) => bool, // optional, wins over canon
    //                describe: state => 'one-line summary',  // optional
    //                storage: { load: () => ({views, defaultId}),
    //                           save: obj => bool } })       // optional
    //     then calls views.changed() whenever the on-screen state may have
    //     moved. For the starred default either call views.adoptDefault()
    //     before the first query (returns the state to apply, or null) or
    //     views.openDefault() once the page is ready (restores it).
    //
    // STORAGE
    //   My views      default: this page's FBLib.Settings user payload,
    //                 `views.<TILE>` + `defaultView.<TILE>`.
    //   Company views FBLib.SharedData key `<FB_REPORT.key>.shared.v1`
    //                 (override: opts.sharedKey), field `filterViews.<TILE>`:
    //                 { views, defaultId, at, by }. Writes merge onto the
    //                 rest of that payload — a SharedData write replaces the
    //                 whole value. opts.legacyCompany(blob) may map an older
    //                 shape; opts.legacyCleanup(nextBlob) drops old fields on
    //                 the first publish.
    //   A view is { id, name, state, updated }.
    //
    // CSS is injected here (not fb-styles) because the Individual Pages don't
    // load fb-styles yet; it reads the fb-styles tokens with literal fallbacks,
    // so it follows the brand palette wherever fb-styles is present.
    // ====================================================================
    /** Saved views (My views plus admin-published Company views) behind one compact header button; see attach(). */
    const FilterViews = (function () {
        const CSS_ID = 'fbLibFilterViewsStyle';
        const T = function (name, fallback) { return 'var(' + name + ',' + fallback + ')'; };
        const CSS =
            '.fbfv-wrap{position:relative;display:inline-block}' +
            '.fbfv-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;' +
                'width:28px;height:28px;padding:0;border:1px solid ' + T('--border', '#E3E3E3') + ';background:#fff;' +
                'border-radius:8px;color:' + T('--c-secondary', '#506872') + ';cursor:pointer;transition:all .15s}' +
            '.fbfv-btn:hover{background:' + T('--bg-1', '#F7F7F7') + ';border-color:' + T('--border-strong', '#C6D0D4') + '}' +
            '.fbfv-btn svg{width:15px;height:15px}' +
            '.fbfv-btn.fbfv-on{background:' + T('--tint-blue', '#DEEAF4') + ';border-color:' + T('--tint-blue-2', '#CBE5FB') + ';' +
                'color:' + T('--color-primary-dark', '#1e7bb4') + '}' +
            '.fbfv-btn.fbfv-dirty::after{content:"";position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;' +
                'background:' + T('--acc-orange', '#F69133') + ';border:1px solid #fff}' +
            '.fbfv-pop{position:absolute;top:calc(100% + 4px);right:0;z-index:10002;width:320px;max-height:72vh;' +
                'display:flex;flex-direction:column;background:#fff;border:1px solid ' + T('--border', '#E3E3E3') + ';' +
                'border-radius:8px;box-shadow:0 10px 25px -5px rgba(0,0,0,.18);overflow:hidden;' +
                'font-family:' + T('--font', "'Inter',sans-serif") + ';font-size:12px;color:' + T('--c-primary', '#101010') + ';' +
                'text-align:left;white-space:normal;line-height:1.4}' +
            '.fbfv-pop[hidden]{display:none}' +
            '.fbfv-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;flex-shrink:0;' +
                'background:' + T('--menu-bg', '#0B3140') + ';color:#fff;font-weight:700;font-size:13px}' +
            '.fbfv-x{border:none;background:none;cursor:pointer;color:#fff;opacity:.85;font-size:18px;line-height:1;padding:0 2px}' +
            '.fbfv-x:hover{opacity:1}' +
            '.fbfv-body{overflow-y:auto;flex:1 1 auto;min-height:0}' +
            '.fbfv-sec{padding:9px 12px;border-bottom:1px solid ' + T('--bg-2', '#EBEEED') + '}' +
            '.fbfv-sec:last-child{border-bottom:none}' +
            '.fbfv-lbl{display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:700;' +
                'text-transform:uppercase;letter-spacing:.04em;color:' + T('--c-secondary', '#506872') + ';margin-bottom:6px}' +
            '.fbfv-lbl span{font-weight:500;text-transform:none;letter-spacing:0;color:' + T('--c-tertiary', '#8FA1A7') + '}' +
            '.fbfv-cur{margin-bottom:6px;font-weight:600;color:' + T('--menu-bg', '#0B3140') + '}' +
            '.fbfv-mod{display:inline-block;margin-left:5px;padding:0 5px;border-radius:3px;font-size:9px;font-weight:700;' +
                'text-transform:uppercase;letter-spacing:.04em;vertical-align:1px;' +
                'background:' + T('--acc-orange-bg', '#F5E7DD') + ';color:' + T('--acc-orange-con', '#8A4E10') + '}' +
            '.fbfv-tag{display:inline-block;margin-left:5px;padding:0 5px;border-radius:3px;font-size:9px;font-weight:700;' +
                'text-transform:uppercase;letter-spacing:.04em;vertical-align:1px;' +
                'background:' + T('--tint-blue', '#DEEAF4') + ';color:' + T('--menu-bg', '#0B3140') + '}' +
            '.fbfv-chips{display:flex;flex-wrap:wrap;gap:4px}' +
            '.fbfv-chip{display:inline-flex;align-items:center;gap:3px;max-width:100%;padding:2px 7px;border-radius:999px;' +
                'font-size:11px;background:' + T('--tint-blue', '#DEEAF4') + ';color:' + T('--menu-bg', '#0B3140') + '}' +
            '.fbfv-chip.fbfv-hid{background:' + T('--acc-yellow-bg', '#FBEDC4') + ';color:' + T('--acc-yellow-con', '#7A5A08') + '}' +
            '.fbfv-chip.fbfv-sort{background:' + T('--bg-2', '#EBEEED') + ';color:' + T('--c-secondary', '#506872') + '}' +
            '.fbfv-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
            '.fbfv-chip button{border:none;background:none;cursor:pointer;color:inherit;font-weight:700;padding:0;line-height:1}' +
            '.fbfv-sum{font-size:11px;color:' + T('--c-secondary', '#506872') + '}' +
            '.fbfv-none{color:' + T('--c-tertiary', '#8FA1A7') + ';font-style:italic;font-size:11px}' +
            '.fbfv-acts{display:flex;gap:6px;margin-top:8px;align-items:center}' +
            '.fbfv-b{display:inline-flex;align-items:center;padding:4px 9px;font-size:11px;font-weight:600;font-family:inherit;' +
                'border:1px solid ' + T('--border-strong', '#C6D0D4') + ';background:#fff;color:#415157;border-radius:6px;cursor:pointer}' +
            '.fbfv-b:hover:not([disabled]){background:' + T('--bg-2', '#EBEEED') + '}' +
            '.fbfv-b.fbfv-pri{background:' + T('--color-primary', '#2d9cdb') + ';border-color:' + T('--color-primary', '#2d9cdb') + ';color:#fff}' +
            '.fbfv-b.fbfv-pri:hover:not([disabled]){background:' + T('--color-primary-dark', '#1e7bb4') + '}' +
            '.fbfv-b[disabled]{opacity:.45;cursor:default}' +
            '.fbfv-in{flex:1;min-width:0;padding:4px 8px;font-size:12px;font-family:inherit;' +
                'border:1px solid ' + T('--border', '#E3E3E3') + ';border-radius:6px;background:' + T('--bg-1', '#F7F7F7') + '}' +
            '.fbfv-in:focus{outline:none;border-color:' + T('--color-primary', '#2d9cdb') + ';background:#fff}' +
            '.fbfv-row{display:flex;align-items:center;gap:2px;padding:3px 4px;border-radius:6px;border:1px solid transparent}' +
            '.fbfv-row:hover{background:' + T('--bg-1', '#F7F7F7') + '}' +
            '.fbfv-row.fbfv-act{background:#F4FAFE;border-color:' + T('--tint-blue-2', '#CBE5FB') + '}' +
            '.fbfv-main{flex:1;min-width:0;cursor:pointer;padding:1px 3px}' +
            '.fbfv-name{font-weight:600;color:' + T('--menu-bg', '#0B3140') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
            '.fbfv-meta{font-size:10px;color:' + T('--c-tertiary', '#8FA1A7') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
            '.fbfv-ic{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;background:none;' +
                'cursor:pointer;color:' + T('--c-tertiary', '#8FA1A7') + ';padding:0;border-radius:4px;font-size:13px;line-height:1;flex-shrink:0}' +
            '.fbfv-ic svg{width:13px;height:13px}' +
            '.fbfv-ic:hover{color:' + T('--link', '#2d9cdb') + ';background:#eff6ff}' +
            '.fbfv-ic.fbfv-del:hover{color:' + T('--fb-negative', '#C43046') + ';background:' + T('--acc-maroon-bg', '#F0D7DD') + '}' +
            '.fbfv-ic.fbfv-on{color:' + T('--acc-orange', '#F69133') + '}' +
            '.fbfv-ic.fbfv-all.fbfv-on{color:' + T('--color-primary', '#2d9cdb') + '}' +
            '.fbfv-msg{padding:7px 12px;font-size:11px;line-height:1.45;background:' + T('--acc-maroon-bg', '#F0D7DD') + ';' +
                'color:' + T('--acc-maroon-con', '#5E1D30') + '}' +
            '.fbfv-msg.fbfv-ok{background:' + T('--acc-sage', '#DBE8E1') + ';color:' + T('--acc-sage-con', '#1B7A46') + '}' +
            '.fbfv-foot{padding:6px 12px;font-size:10px;color:' + T('--c-tertiary', '#8FA1A7') + ';border-top:1px solid ' +
                T('--bg-2', '#EBEEED') + ';flex-shrink:0}';

        const ICON_BTN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>';
        const SVG = {
            save:    '<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/>',
            publish: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/><path d="M5 21h14"/>',
            copy:    '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
            rename:  '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
            everyone:'<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5A5 5 0 0121 19"/>'
        };

        function injectCss() {
            if (document.getElementById(CSS_ID)) return;
            const style = document.createElement('style');
            style.id = CSS_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }

        // Tiny DOM builder — user-entered text only ever goes in as text
        // nodes, so view names never need escaping.
        function h(tag, attrs, kids) {
            const el = document.createElement(tag);
            Object.keys(attrs || {}).forEach(function (k) {
                const v = attrs[k];
                if (v == null || v === false) return;
                if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
                else if (k === 'text') el.textContent = v;
                else if (k === 'className') el.className = v;
                else if (k === 'svg') el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
                    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + v + '</svg>';
                else el.setAttribute(k, v === true ? '' : v);
            });
            [].concat(kids || []).forEach(function (c) {
                if (c == null || c === false) return;
                el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
            });
            return el;
        }
        function icon(name, title, onClick, extraCls) {
            return h('button', { type: 'button', className: 'fbfv-ic' + (extraCls ? ' ' + extraCls : ''), title: title,
                'aria-label': title, svg: SVG[name], on: { click: onClick } });
        }
        function glyph(text, title, onClick, extraCls) {
            return h('button', { type: 'button', className: 'fbfv-ic' + (extraCls ? ' ' + extraCls : ''), title: title,
                'aria-label': title, text: text, on: { click: onClick } });
        }
        function newId(prefix) { return (prefix || 'v') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
        function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
        function stable(o) {
            if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
            if (o && typeof o === 'object') {
                return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}';
            }
            return JSON.stringify(o === undefined ? null : o);
        }
        function fmtWhen(iso) {
            if (!iso) return '';
            try { return new Date(iso).toLocaleDateString(); } catch (_) { return String(iso).slice(0, 10); }
        }

        /**
         * Mounts the saved-views button and popover, wired to the page's filters. See the FBLib.FilterViews block above.
         * Default mode reads .filter-row [data-filter] inputs, toggles and sort; pass capture and restore to own the state.
         * @param {object} opts - Options (also canon, matches, describe, chips, storage, filterSelector, company, alsoTrust).
         * @param {string} opts.tile - Tile key that scopes the stored views.
         * @param {string|HTMLElement} opts.mount - Host element, or its id, for the button.
         * @param {string[]} [opts.toggles] - Ids of checkboxes saved with a view.
         * @param {Function} [opts.getSort] - Returns the live { col, dir }.
         * @param {Function} [opts.setSort] - Applies a saved { col, dir }.
         * @param {Function} [opts.apply] - Re-runs the page's filtering after a view loads (which should call changed()).
         * @param {Function} [opts.capture] - Custom mode: returns the JSON-able state.
         * @param {Function} [opts.restore] - Custom mode: applies a saved state; may return a Promise.
         * @param {string} [opts.sharedKey] - Company-views SharedData key (default FB_REPORT.key + '.shared.v1').
         * @param {boolean} [opts.editors] - Users with Edit Settings on this report may publish company views too (see SharedData.editSettingsUsers).
         * @param {boolean} [opts.companyFirst] - The company default view opens even for users who starred their own.
         * @returns {object} API: beforeLoad(), changed(), detach(), openDefault(), adoptDefault(), open(), close(), activeView.
         */
        function attach(opts) {
            opts = Object.assign({}, opts || {});
            if (opts.editors) {
                opts.alsoTrust = [].concat(opts.alsoTrust || [], SharedData.editSettingsUsers());
            }
            const TILE = String(opts.tile || '').toUpperCase();
            const CUSTOM = typeof opts.capture === 'function' && typeof opts.restore === 'function';
            const FILTER_SEL = opts.filterSelector ||
                '.filter-row input[data-filter], .filter-row select[data-filter]';
            const TOGGLES = (opts.toggles || []).slice();
            const getSort = typeof opts.getSort === 'function' ? opts.getSort : function () { return null; };
            const setSort = typeof opts.setSort === 'function' ? opts.setSort : function () {};
            const apply = typeof opts.apply === 'function' ? opts.apply : function () {};
            const SAVE_DEBOUNCE = 400;

            let _state = null;          // DOM mode: live { filters, toggles, sort }
            let _activeId = null;
            let _booted = false;
            let _timer = null, _lastWritten = null;
            let _btn = null, _pop = null;
            let _mode = null;           // null | 'saveas' | { rename: id }
            let _draft = '';
            let _msg = '', _msgOk = false;

            // ---- my views: storage adapter ----
            function settingsMap(key) {
                let u = {};
                try { u = Settings.getUser() || {}; } catch (_) {}
                const m = u[key];
                return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
            }
            function setSettingsTile(key, value) {
                const next = Object.assign({}, settingsMap(key));
                if (value === undefined || value === null) delete next[TILE]; else next[TILE] = value;
                Settings.setUserKey(key, next);
            }
            const store = opts.storage || {
                load: function () {
                    return { views: settingsMap('views')[TILE], defaultId: settingsMap('defaultView')[TILE] || null };
                },
                save: function (o) {
                    setSettingsTile('views', o.views);
                    setSettingsTile('defaultView', o.defaultId || null);
                    try { return Settings.saveUser() !== false; } catch (_) { return false; }
                }
            };
            // Older views carried filters/toggles/sort at the top level.
            function norm(v) {
                if (!v || !v.id) return null;
                const state = v.state || { filters: v.filters || {}, toggles: v.toggles || {}, sort: v.sort || null };
                return { id: String(v.id), name: String(v.name || 'Untitled'), state: state, updated: v.updated || '' };
            }
            function mine() {
                let o = {};
                try { o = store.load() || {}; } catch (_) {}
                return { views: (Array.isArray(o.views) ? o.views : []).map(norm).filter(Boolean), defaultId: o.defaultId || null };
            }
            function saveMine(views, defaultId) {
                let ok = false;
                try { ok = store.save({ views: views, defaultId: defaultId || null }) !== false; } catch (_) { ok = false; }
                if (!ok) setMsg('Couldn\'t save — your settings may be locked by an admin.');
                return ok;
            }

            // ---- company views: FBLib.SharedData ----
            function sharedKey() {
                if (opts.sharedKey) return opts.sharedKey;
                const id = report();
                return id.key ? id.key + '.shared.v1' : null;
            }
            const SHARE_OK = opts.company !== false && !!sharedKey() && !!SharedData;
            function isAdmin() { try { return !!SharedData.isAdmin(opts.alsoTrust); } catch (_) { return false; } }
            function company() {
                if (!SHARE_OK) return { views: [], defaultId: null };
                let blob = {};
                try { blob = SharedData.readJson(sharedKey(), {}, { alsoTrust: opts.alsoTrust }) || {}; } catch (_) {}
                let e = blob.filterViews && blob.filterViews[TILE];
                if (!e && typeof opts.legacyCompany === 'function') { try { e = opts.legacyCompany(blob); } catch (_) {} }
                e = e || {};
                return {
                    views: (Array.isArray(e.views) ? e.views : []).map(norm).filter(Boolean),
                    defaultId: e.defaultId || null, at: e.at || '', by: e.by || ''
                };
            }
            function saveCompany(views, defaultId) {
                if (!SHARE_OK || !isAdmin()) { setMsg('Only an administrator can change company views.'); return false; }
                let ok = false;
                try {
                    const next = Object.assign({}, SharedData.readJson(sharedKey(), {}, { fresh: true, alsoTrust: opts.alsoTrust }) || {});
                    next.filterViews = Object.assign({}, next.filterViews);
                    next.filterViews[TILE] = {
                        views: views, defaultId: defaultId || null,
                        at: new Date().toISOString(), by: SharedData.currentUserName()
                    };
                    if (typeof opts.legacyCleanup === 'function') { try { opts.legacyCleanup(next); } catch (_) {} }
                    ok = SharedData.writeJson(sharedKey(), next, { adminOnly: true, alsoTrust: opts.alsoTrust });
                } catch (_) { ok = false; }
                if (!ok) setMsg('Couldn\'t publish — the shared store didn\'t save. Check that fb-lib is current and runQuery is available.');
                return ok;
            }

            function allViews() {
                const m = mine().views.map(function (v) { v.company = false; return v; });
                const c = company().views.map(function (v) { v.company = true; return v; });
                return c.concat(m);
            }
            function findView(id) {
                if (!id) return null;
                return allViews().filter(function (v) { return v.id === id; })[0] || null;
            }
            function defaultView() {
                if (opts.companyFirst) return findView(company().defaultId) || findView(mine().defaultId) || null;
                return findView(mine().defaultId) || findView(company().defaultId) || null;
            }
            function setMsg(text, ok) { _msg = text || ''; _msgOk = !!ok; }

            // ---- live state ----
            function filterEls() { return Array.prototype.slice.call(document.querySelectorAll(FILTER_SEL)); }
            function catalogPending() { return !(CfCatalog && CfCatalog.loaded); }
            function readDom() {
                const filters = {}, present = {};
                filterEls().forEach(function (el) {
                    const k = el.getAttribute('data-filter');
                    present[k] = true;
                    if (el.value) filters[k] = el.value;
                });
                // Custom-field filter inputs only appear once the CF catalog
                // returns; carry their values across until then.
                if (_state && _state.filters && catalogPending()) {
                    Object.keys(_state.filters).forEach(function (k) {
                        if (!present[k] && k.indexOf('cf_') === 0) filters[k] = _state.filters[k];
                    });
                }
                const toggles = {};
                TOGGLES.forEach(function (id) { const el = document.getElementById(id); if (el) toggles[id] = !!el.checked; });
                let sort = null;
                try {
                    const s = getSort();
                    if (s && s.col) sort = { col: String(s.col), dir: s.dir === 'desc' ? 'desc' : 'asc' };
                } catch (_) {}
                return { filters: filters, toggles: toggles, sort: sort };
            }
            function writeDom(state, withExtras) {
                const f = (state && state.filters) || {};
                filterEls().forEach(function (el) {
                    const k = el.getAttribute('data-filter');
                    el.value = (f[k] != null) ? f[k] : '';
                });
                if (!withExtras) return;
                TOGGLES.forEach(function (id) {
                    const el = document.getElementById(id);
                    if (el && state.toggles && typeof state.toggles[id] === 'boolean') el.checked = state.toggles[id];
                });
                if (state.sort && state.sort.col) { try { setSort(state.sort); } catch (_) {} }
            }
            function live() {
                if (CUSTOM) { try { return opts.capture(); } catch (_) { return {}; } }
                return _state || {};
            }
            function canon(s) {
                if (typeof opts.canon === 'function') { try { return String(opts.canon(s || {})); } catch (_) { return ''; } }
                if (CUSTOM) return stable(s || {});
                s = s || {};
                const f = s.filters || {}, t = s.toggles || {};
                return JSON.stringify({
                    f: Object.keys(f).filter(function (k) { return f[k] !== '' && f[k] != null; }).sort()
                        .map(function (k) { return [k, String(f[k])]; }),
                    t: TOGGLES.map(function (id) { return !!t[id]; }),
                    s: s.sort && s.sort.col ? [s.sort.col, s.sort.dir] : null
                });
            }
            function isDirty() {
                const v = findView(_activeId);
                if (!v) return false;
                if (typeof opts.matches === 'function') {
                    try { return !opts.matches(v.state, live()); } catch (_) { return false; }
                }
                return canon(v.state) !== canon(live());
            }

            // ---- DOM mode: session memory (`persistFilters`) ----
            function persistEnabled() {
                if (CUSTOM) return false;
                try { return !!Settings.resolve('persistFilters'); } catch (_) { return false; }
            }
            function persistShape() { return JSON.stringify([_state && _state.filters, _activeId, _state && _state.toggles, _state && _state.sort]); }
            function schedulePersist() {
                if (!persistEnabled()) return;
                if (_timer) clearTimeout(_timer);
                _timer = setTimeout(function () {
                    _timer = null;
                    const shape = persistShape();
                    if (shape === _lastWritten) return;
                    _lastWritten = shape;
                    try {
                        setSettingsTile('savedFilters', Object.assign({}, _state.filters));
                        setSettingsTile('lastView', { id: _activeId, toggles: _state.toggles, sort: _state.sort });
                        Settings.saveUser();
                    } catch (_) {}
                }, SAVE_DEBOUNCE);
            }
            function initialState() {
                if (persistEnabled()) {
                    const f = settingsMap('savedFilters')[TILE];
                    const lv = settingsMap('lastView')[TILE] || {};
                    const hasF = f && typeof f === 'object' && Object.keys(f).length > 0;
                    if (hasF || lv.id || lv.sort || lv.toggles) {
                        if (findView(lv.id)) _activeId = lv.id;
                        return { filters: hasF ? f : {}, toggles: lv.toggles || null, sort: lv.sort || null };
                    }
                }
                const dv = defaultView();
                if (dv) { _activeId = dv.id; return clone(dv.state); }
                return null;
            }

            // ---- lifecycle hooks ----
            function beforeLoad() {
                if (CUSTOM) return;
                if (!_booted) {
                    _booted = true;
                    const init = initialState();
                    if (init) {
                        _state = { filters: Object.assign({}, init.filters || {}), toggles: init.toggles || {}, sort: init.sort || null };
                        writeDom(init, true);
                    }
                    _state = readDom();
                    _lastWritten = persistShape();
                    render();
                    return;
                }
                if (_state) writeDom(_state, false);
            }
            function changed() {
                if (!CUSTOM) {
                    if (!_booted) return;
                    _state = readDom();
                    schedulePersist();
                }
                render();
            }
            function detach() {
                _activeId = null;
                _mode = null;
                if (!CUSTOM) _state = { filters: {}, toggles: (_state && _state.toggles) || {}, sort: _state && _state.sort };
                render();
            }
            // CUSTOM mode: apply the starred default once the page is ready.
            // Resolves true when a view was applied.
            // CUSTOM mode, before the page's first query: mark the default view
            // active and hand back its state for the page to apply itself —
            // saves the second load that openDefault() would cost.
            function adoptDefault() {
                const dv = defaultView();
                if (!dv) return null;
                _activeId = dv.id;
                render();
                return clone(dv.state);
            }
            function openDefault() {
                const dv = defaultView();
                if (!dv) return Promise.resolve(false);
                return loadView(dv.id).then(function () { return true; });
            }

            // ---- view operations ----
            function loadView(id) {
                const v = findView(id);
                if (!v) return Promise.resolve();
                _activeId = v.id;
                _mode = null; setMsg('');
                close();
                if (CUSTOM) {
                    let r;
                    try { r = opts.restore(clone(v.state)); } catch (e) { try { console.warn('[FBLib.FilterViews] restore failed', e); } catch (_) {} }
                    return Promise.resolve(r).then(function () { render(); });
                }
                _state = clone(v.state);
                writeDom(_state, true);
                apply();                                   // → changed(): persist + render
                return Promise.resolve();
            }
            function stamp() { return new Date().toISOString(); }
            function saveActive() {
                const v = findView(_activeId);
                if (!v) return;
                const s = clone(live());
                if (v.company) {
                    if (!isAdmin()) return;
                    if (!confirm('Update the company view "' + v.name + '" for everyone?')) return;
                    const c = company();
                    const list = c.views.map(function (x) { return x.id === v.id ? Object.assign({}, x, { state: s, updated: stamp() }) : x; });
                    if (saveCompany(strip(list), c.defaultId)) setMsg('Updated for everyone.', true);
                } else {
                    const m = mine();
                    const list = m.views.map(function (x) { return x.id === v.id ? Object.assign({}, x, { state: s, updated: stamp() }) : x; });
                    saveMine(list, m.defaultId);
                }
                render();
            }
            function strip(list) {
                return list.map(function (v) { return { id: v.id, name: v.name, state: v.state, updated: v.updated }; });
            }
            function saveAs(name) {
                name = String(name || '').trim().slice(0, 60);
                if (!name) { setMsg('Give the view a name.'); render(); return; }
                const m = mine();
                const lower = name.toLowerCase();
                const same = m.views.filter(function (v) { return v.name.toLowerCase() === lower; })[0];
                const s = clone(live());
                let list = m.views.slice();
                if (same) {
                    if (!confirm('You already have a view named "' + same.name + '". Replace it?')) return;
                    list = list.map(function (v) { return v.id === same.id ? Object.assign({}, v, { state: s, updated: stamp() }) : v; });
                    _activeId = same.id;
                } else {
                    const nv = { id: newId('v'), name: name, state: s, updated: stamp() };
                    list.push(nv);
                    _activeId = nv.id;
                }
                _mode = null; _draft = '';
                if (saveMine(strip(list), m.defaultId)) setMsg('');
                schedulePersist();
                render();
            }
            function renameView(v, name) {
                name = String(name || '').trim().slice(0, 60);
                _mode = null; _draft = '';
                if (!name || name === v.name) { render(); return; }
                if (v.company) {
                    const c = company();
                    saveCompany(strip(c.views.map(function (x) { return x.id === v.id ? Object.assign({}, x, { name: name }) : x; })), c.defaultId);
                } else {
                    const m = mine();
                    saveMine(strip(m.views.map(function (x) { return x.id === v.id ? Object.assign({}, x, { name: name }) : x; })), m.defaultId);
                }
                render();
            }
            function deleteView(v) {
                if (v.company) {
                    if (!confirm('Delete "' + v.name + '" for EVERYONE?\n\nIt disappears from every user\'s list the next time ' +
                                 'they open this report. Their own views are not touched.')) return;
                    const c = company();
                    if (saveCompany(strip(c.views.filter(function (x) { return x.id !== v.id; })),
                                    c.defaultId === v.id ? null : c.defaultId)) setMsg('Deleted for everyone.', true);
                } else {
                    if (!confirm('Delete your view "' + v.name + '"?')) return;
                    const m = mine();
                    saveMine(strip(m.views.filter(function (x) { return x.id !== v.id; })), m.defaultId === v.id ? null : m.defaultId);
                }
                if (_activeId === v.id) _activeId = null;
                schedulePersist();
                render();
            }
            function toggleMyDefault(v) {
                const m = mine();
                saveMine(strip(m.views), m.defaultId === v.id ? null : v.id);
                render();
            }
            function toggleCompanyDefault(v) {
                const c = company();
                if (saveCompany(strip(c.views), c.defaultId === v.id ? null : v.id)) {
                    setMsg(c.defaultId === v.id ? 'No company default now.' : '"' + v.name + '" now opens by default for everyone ' +
                        '(unless they\'ve starred their own).', true);
                }
                render();
            }
            function publish(v) {
                const c = company();
                const same = c.views.filter(function (x) { return x.name.toLowerCase() === v.name.toLowerCase(); })[0];
                let list = c.views.slice();
                if (same) {
                    if (!confirm('A company view named "' + same.name + '" already exists. Replace it for everyone?')) return;
                    list = list.map(function (x) { return x.id === same.id ? Object.assign({}, x, { state: clone(v.state), updated: stamp() }) : x; });
                } else {
                    if (!confirm('Publish "' + v.name + '" to everyone?\n\nIt appears under Company views for every user the ' +
                                 'next time they open this report.')) return;
                    list.push({ id: newId('c'), name: v.name, state: clone(v.state), updated: stamp() });
                }
                if (saveCompany(strip(list), c.defaultId)) setMsg('Published "' + v.name + '" for everyone.', true);
                render();
            }
            function saveCopy(v) {
                const m = mine();
                let name = v.name;
                const taken = function (n) { return m.views.some(function (x) { return x.name.toLowerCase() === n.toLowerCase(); }); };
                if (taken(name)) { let i = 2; while (taken(name + ' (' + i + ')')) i++; name = name + ' (' + i + ')'; }
                const nv = { id: newId('v'), name: name, state: clone(v.state), updated: stamp() };
                if (saveMine(strip(m.views.concat([nv])), m.defaultId)) setMsg('Saved a copy as "' + name + '" in My views.', true);
                render();
            }

            // ---- UI ----
            function headerLabel(key) {
                const th = document.querySelector('th[data-column="' + String(key).replace(/"/g, '\\"') + '"]');
                if (!th) return key;
                const t = (th.textContent || '').replace(/⇅|▲|▼|↑|↓/g, '').trim();
                return t || th.getAttribute('title') || key;
            }
            function chip(text, cls, onRemove, title) {
                return h('span', { className: 'fbfv-chip' + (cls ? ' ' + cls : ''), title: title || text }, [
                    h('span', { text: text }),
                    onRemove ? h('button', { type: 'button', title: 'Remove', text: '×', on: { click: onRemove } }) : null
                ]);
            }
            function nowChips() {
                if (typeof opts.chips === 'function') {
                    let list = [];
                    try { list = opts.chips() || []; } catch (_) {}
                    return list.map(function (c) {
                        return chip(c.text, c.hidden ? 'fbfv-hid' : '', c.remove ? function () { c.remove(); changed(); } : null, c.title);
                    });
                }
                if (CUSTOM) {
                    const d = describe(live());
                    return d ? [h('div', { className: 'fbfv-sum', text: d })] : [];
                }
                const out = [];
                filterEls().forEach(function (el) {
                    if (!el.value) return;
                    const key = el.getAttribute('data-filter');
                    let shown = el.value;
                    if (el.tagName === 'SELECT' && el.selectedIndex >= 0) shown = el.options[el.selectedIndex].text || el.value;
                    const td = el.closest('td');
                    const hidden = (td && td.style.display === 'none') || el.offsetParent === null;
                    out.push(chip(headerLabel(key) + ': ' + shown + (hidden ? ' (hidden column)' : ''), hidden ? 'fbfv-hid' : '',
                        function () { el.value = ''; apply(); },
                        hidden ? 'This column is hidden but its filter still applies' : null));
                });
                TOGGLES.forEach(function (id) {
                    const el = document.getElementById(id);
                    if (!el || !el.checked) return;
                    const lab = el.closest('label');
                    out.push(chip((lab && lab.textContent.trim()) || id, '', function () { el.checked = false; apply(); }));
                });
                const s = _state && _state.sort;
                if (s && s.col) out.push(chip('Sort: ' + headerLabel(s.col) + (s.dir === 'desc' ? ' ↓' : ' ↑'), 'fbfv-sort', null));
                return out;
            }
            function describe(state) {
                if (typeof opts.describe !== 'function') return '';
                try { return String(opts.describe(state) || ''); } catch (_) { return ''; }
            }
            function nameInput(initial, onOk) {
                const inp = h('input', {
                    className: 'fbfv-in', type: 'text', maxlength: '60', placeholder: 'View name',
                    on: {
                        input: function (e) { _draft = e.target.value; },
                        keydown: function (e) {
                            if (e.key === 'Enter') { e.preventDefault(); onOk(inp.value); }
                            else if (e.key === 'Escape') { e.stopPropagation(); _mode = null; _draft = ''; render(); }
                        }
                    }
                });
                inp.value = initial || '';
                setTimeout(function () { try { inp.focus(); inp.select(); } catch (_) {} }, 0);
                return inp;
            }
            function viewRow(v, ctx) {
                if (_mode && _mode.rename === v.id) {
                    const inp = nameInput(_draft || v.name, function (val) { renameView(v, val); });
                    return h('div', { className: 'fbfv-row' }, [inp,
                        glyph('✓', 'Save name', function () { renameView(v, inp.value); })]);
                }
                const isMyDef = ctx.myDef === v.id;
                const kids = [
                    glyph(isMyDef ? '★' : '☆', isMyDef ? 'Opens by default for you — click to unset' : 'Open this view by default (just me)',
                        function () { toggleMyDefault(v); }, isMyDef ? 'fbfv-on' : ''),
                    h('div', { className: 'fbfv-main', title: 'Switch to "' + v.name + '"', on: { click: function () { loadView(v.id); } } }, [
                        h('div', { className: 'fbfv-name' }, [v.name,
                            (v.company && ctx.coDef === v.id) ? h('span', { className: 'fbfv-tag', text: 'default' }) : null]),
                        describe(v.state) ? h('div', { className: 'fbfv-meta', text: describe(v.state) }) : null
                    ])
                ];
                if (v.company) {
                    if (ctx.admin) {
                        const isCoDef = ctx.coDef === v.id;
                        kids.push(icon('everyone', isCoDef ? 'Default for everyone — click to unset' : 'Open by default for everyone',
                            function () { toggleCompanyDefault(v); }, 'fbfv-all' + (isCoDef ? ' fbfv-on' : '')));
                        kids.push(icon('rename', 'Rename for everyone', function () { _mode = { rename: v.id }; _draft = v.name; render(); }));
                        kids.push(glyph('×', 'Delete for everyone', function () { deleteView(v); }, 'fbfv-del'));
                    } else {
                        kids.push(icon('copy', 'Save a copy to My views (to edit it)', function () { saveCopy(v); }));
                    }
                } else {
                    if (ctx.admin && SHARE_OK) kids.push(icon('publish', 'Publish for everyone', function () { publish(v); }));
                    kids.push(icon('rename', 'Rename', function () { _mode = { rename: v.id }; _draft = v.name; render(); }));
                    kids.push(glyph('×', 'Delete', function () { deleteView(v); }, 'fbfv-del'));
                }
                return h('div', { className: 'fbfv-row' + (v.id === _activeId ? ' fbfv-act' : '') }, kids);
            }
            function renderPop() {
                if (!_pop) return;
                const m = mine(), c = company(), admin = isAdmin();
                const active = findView(_activeId);
                const dirty = isDirty();
                const ctx = { admin: admin, myDef: m.defaultId, coDef: c.defaultId };
                _pop.innerHTML = '';

                _pop.appendChild(h('div', { className: 'fbfv-head' }, [
                    h('span', { text: 'Saved views' }),
                    h('button', { type: 'button', className: 'fbfv-x', title: 'Close', 'aria-label': 'Close', text: '×', on: { click: close } })
                ]));
                const body = h('div', { className: 'fbfv-body' });
                _pop.appendChild(body);

                // What's on screen now.
                const chips = nowChips();
                const canSave = !!active && dirty && (!active.company || admin);
                body.appendChild(h('div', { className: 'fbfv-sec' }, [
                    h('div', { className: 'fbfv-lbl' }, [document.createTextNode('Showing now')]),
                    h('div', { className: 'fbfv-cur' }, active
                        ? [active.name, active.company ? h('span', { className: 'fbfv-tag', text: 'company' }) : null,
                           dirty ? h('span', { className: 'fbfv-mod', text: 'modified' }) : null]
                        : [h('span', { className: 'fbfv-none', text: 'No saved view' })]),
                    h('div', { className: 'fbfv-chips' }, chips.length ? chips : [h('span', { className: 'fbfv-none', text: 'No filters' })]),
                    _mode === 'saveas'
                        ? h('div', { className: 'fbfv-acts' }, (function () {
                            const inp = nameInput(_draft, saveAs);
                            return [inp,
                                h('button', { type: 'button', className: 'fbfv-b fbfv-pri', text: 'Save', on: { click: function () { saveAs(inp.value); } } }),
                                h('button', { type: 'button', className: 'fbfv-b', text: 'Cancel', on: { click: function () { _mode = null; _draft = ''; render(); } } })];
                        })())
                        : h('div', { className: 'fbfv-acts' }, [
                            active ? h('button', {
                                type: 'button', className: 'fbfv-b fbfv-pri', disabled: !canSave,
                                title: !dirty ? 'No changes to save'
                                    : (active.company && !admin) ? 'Company views can\'t be changed — use Save as new'
                                    : (active.company ? 'Update "' + active.name + '" for everyone' : 'Overwrite "' + active.name + '"'),
                                text: active.company && admin ? 'Save for everyone' : 'Save', on: { click: saveActive }
                            }) : null,
                            h('button', { type: 'button', className: 'fbfv-b' + (active ? '' : ' fbfv-pri'), text: 'Save as new…',
                                on: { click: function () { _mode = 'saveas'; _draft = ''; setMsg(''); render(); } } })
                        ])
                ]));

                // Company views — shown when there are any, or to an admin.
                if (SHARE_OK && (c.views.length || admin)) {
                    const who = c.at ? 'by ' + (c.by || '?') + ', ' + fmtWhen(c.at) : '';
                    body.appendChild(h('div', { className: 'fbfv-sec' }, [
                        h('div', { className: 'fbfv-lbl' }, [document.createTextNode('Company views'), admin && who ? h('span', { text: who }) : null])
                    ].concat(c.views.length ? c.views.map(function (v) { v.company = true; return viewRow(v, ctx); })
                        : [h('div', { className: 'fbfv-none', text: 'None yet — publish one of your views with the ↑ button.' })])));
                }

                body.appendChild(h('div', { className: 'fbfv-sec' }, [
                    h('div', { className: 'fbfv-lbl' }, [document.createTextNode('My views')])
                ].concat(m.views.length ? m.views.map(function (v) { v.company = false; return viewRow(v, ctx); })
                    : [h('div', { className: 'fbfv-none', text: 'None yet — set your filters, then Save as new.' })])));

                if (_msg) _pop.appendChild(h('div', { className: 'fbfv-msg' + (_msgOk ? ' fbfv-ok' : ''), text: _msg }));
                _pop.appendChild(h('div', { className: 'fbfv-foot',
                    text: admin ? '☆ opens by default for you · ↑ publishes for everyone.' : '☆ opens by default. Views are saved to your Fishbowl user.' }));
            }
            function render() {
                if (!_btn) return;
                const v = findView(_activeId);
                const dirty = isDirty();
                _btn.classList.toggle('fbfv-on', !!v);
                _btn.classList.toggle('fbfv-dirty', dirty);
                _btn.title = v ? ('View: ' + v.name + (dirty ? ' (modified)' : '')) : 'Saved views';
                if (_pop && !_pop.hidden) renderPop();
            }
            function open() {
                if (!_pop) return;
                setMsg('');
                if (SHARE_OK) { try { SharedData.invalidate(sharedKey()); } catch (_) {} }
                _pop.hidden = false;
                renderPop();
            }
            function close() { if (!_pop) return; _pop.hidden = true; _mode = null; _draft = ''; }

            function mount() {
                const host = typeof opts.mount === 'string' ? document.getElementById(opts.mount) : opts.mount;
                if (!host) return;
                injectCss();
                _btn = h('button', { type: 'button', className: 'fbfv-btn', title: 'Saved views', 'aria-haspopup': 'true' });
                _btn.innerHTML = ICON_BTN;
                _pop = h('div', { className: 'fbfv-pop', hidden: true });
                const wrap = h('span', { className: 'fbfv-wrap' }, [_btn, _pop]);
                host.innerHTML = '';
                host.appendChild(wrap);
                _btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (_pop.hidden) open(); else close();
                });
                // Outside click / Escape close it. confirm() dialogs fire no
                // mousedown on the page, so they don't close it mid-action.
                document.addEventListener('mousedown', function (e) {
                    if (!_pop.hidden && !wrap.contains(e.target)) close();
                });
                document.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape' && !_pop.hidden) close();
                });
            }

            mount();
            render();
            return {
                beforeLoad: beforeLoad,
                changed: changed,
                detach: detach,
                openDefault: openDefault,
                adoptDefault: adoptDefault,
                open: open,
                close: close,
                get activeView() { return findView(_activeId); }
            };
        }

        return { attach: attach };
    })();

    // ====================================================================
    // FBLib.RowCap — keep a big result from stalling a report. A query asks
    // for one row past the cap; when it comes back full the report shows the
    // cap's rows and a notice with "Load all", which re-runs it uncapped.
    // (Rendering is already lazy: reports paint in chunks as the user
    // scrolls. This bounds what is fetched and held.)
    //
    //   sql = FBLib.RowCap.sql(sql, limit?)      // + "LIMIT limit+1" (a query
    //                                            //   that already ends in a
    //                                            //   LIMIT is left alone)
    //   const r = FBLib.RowCap.apply(rows, limit?, { keyOf? })
    //                                            // { rows, capped, limit }; with
    //                                            // keyOf(row) the cut falls on a
    //                                            // group boundary, so every group
    //                                            // shown is complete (a single
    //                                            // group larger than the cap is
    //                                            // kept as fetched)
    //   FBLib.RowCap.notice({ before: el, capped, limit, onLoadAll, what?, totals? })
    //                                            // totals: false = the report has no
    //                                            // totals (drops "Totals cover…");
    //                                            // html: the whole message instead
    //                                            // (escaped by the caller)
    //                                            // shows / hides the notice
    //                                            // just above `before`
    // limit: default FBLib.RowCap.DEFAULT (10,000); 0 or Infinity = no cap.
    // ====================================================================
    /** Caps a large result at N rows with a "Load all" notice; see sql(), apply() and notice(). */
    const RowCap = (function () {
        /** The row cap used when a limit is omitted (10,000). */
        const DEFAULT = 10000;
        const lim = n => (n == null ? DEFAULT : n);
        /**
         * Appends "LIMIT limit+1" to a query so apply() can tell a capped result from a complete one.
         * Strips a trailing semicolon; a query that already ends in a LIMIT is left alone.
         * @param {string} text - The SELECT statement.
         * @param {number} [limit=RowCap.DEFAULT] - The cap; 0 or Infinity returns the query unchanged.
         * @returns {string} The query to run.
         */
        function sql(text, limit) {
            const n = lim(limit);
            if (!n || n === Infinity) return text;
            const s = String(text).replace(/;\s*$/, '');
            if (/\blimit\s+\d+(\s*,\s*\d+|\s+offset\s+\d+)?\s*$/i.test(s)) return s;
            return s + '\nLIMIT ' + (n + 1);
        }
        /**
         * Cuts a result fetched with sql() back to the cap and reports whether more rows matched.
         * @param {object[]} rows - The fetched rows.
         * @param {number} [limit=RowCap.DEFAULT] - The cap; 0 or Infinity means no cap.
         * @param {object} [opts] - Options.
         * @param {Function} [opts.keyOf] - Group key of a row; the cut then falls on a group boundary (one oversized group is kept whole).
         * @returns {{rows: object[], capped: boolean, limit: number}} The rows to show, and the flags for notice().
         */
        function apply(rows, limit, opts) {
            const n = lim(limit);
            rows = Array.isArray(rows) ? rows : [];
            if (!n || n === Infinity || rows.length <= n) return { rows: rows, capped: false, limit: n };
            let end = n;
            const keyOf = opts && typeof opts.keyOf === 'function' ? opts.keyOf : null;
            if (keyOf) {
                // The row past the cap continues the last group: drop that group.
                const k = keyOf(rows[n]);
                let e = n;
                while (e > 0 && keyOf(rows[e - 1]) === k) e--;
                if (e > 0) end = e;
            }
            return { rows: rows.slice(0, end), capped: true, limit: n };
        }
        /**
         * Shows the "Showing the first N ... Load all" notice just above an element, or removes it when not capped.
         * @param {object} opts - Notice options.
         * @param {HTMLElement} opts.before - The element the notice sits above (e.g. the table wrapper).
         * @param {boolean} opts.capped - apply()'s capped flag.
         * @param {number} opts.limit - apply()'s limit.
         * @param {Function} opts.onLoadAll - Called when Load all is clicked; re-run the query uncapped.
         * @param {string} [opts.what='rows'] - Noun for the rows, e.g. 'orders'.
         * @param {boolean} [opts.totals] - false drops the "Totals cover the rows shown" sentence.
         * @param {string} [opts.html] - The whole message as HTML instead (the caller escapes it).
         */
        function notice(opts) {
            opts = opts || {};
            const before = opts.before;
            if (!before || !before.parentNode) return;
            let el = before.parentNode.querySelector(':scope > .rowcap-note');
            if (!opts.capped) { if (el) el.remove(); return; }
            if (!el) {
                el = document.createElement('div');
                el.className = 'rowcap-note';
                before.parentNode.insertBefore(el, before);
            }
            const what = opts.what || 'rows';
            el.innerHTML = opts.html ? '<span>' + opts.html + '</span><button type="button" class="hdr-btn rowcap-all">Load all</button>' : '<span>Showing the first <strong>' + Number(opts.limit).toLocaleString() + '</strong> ' + _esc(what) +
                ': more match these filters.' + (opts.totals === false ? '' : ' Totals cover the ' + _esc(what) + ' shown.') + ' Narrow the filters, or</span>' +
                '<button type="button" class="hdr-btn rowcap-all">Load all</button>';
            el.querySelector('.rowcap-all').onclick = function () {
                this.disabled = true; this.textContent = 'Loading…';
                if (typeof opts.onLoadAll === 'function') opts.onLoadAll();
            };
        }
        function _esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
            });
        }
        return { DEFAULT: DEFAULT, sql: sql, apply: apply, notice: notice };
    })();

    // ====================================================================
    // FBLib.RptCols — resize, header-click sort and drag-reorder for a
    // report's own table (the report chrome's .rpt-table), whose rows the
    // report renders itself (groups, totals, minor rows…). The report keeps
    // rendering; this decorates its headings after every render and tells it
    // what changed. State (widths, order, sort) is saved per user in the
    // report's FBLib.Settings under `key`.
    //
    //   const cols = FBLib.RptCols.attach({
    //       table:     document.getElementById('rpt'),   // headings: <th data-col="key">
    //       key:       'rptCols',                          // settings key (default)
    //       sortable:  k => true,                          // which headings sort (default all)
    //       draggable: k => true,                          // which headings move (default all)
    //       onSort:    (key, dir) => render(),             // dir 'asc' | 'desc' | null
    //       onReorder: order => render(),                  // order = column keys
    //       pinned:    ['so'],                             // columns kept first, in this order
    //                                                      // (e.g. a tree column); never moved
    //       noUnsorted: true,                              // headings cycle asc ↔ desc only (a
    //                                                      // report whose standard order is a sort)
    //       columnMenu: {                                  // optional Columns drop-down (below)
    //           mount:     'colsMount',                    //   element / id the button goes in
    //           rename:    true,                           //   admins rename headings for everyone
    //           labelsKey: 'rptColsLabels',                //   company key (default key + 'Labels')
    //           onChange:  () => render()                  //   after a hide / show / rename / reset
    //       }                                              //   (default: onReorder)
    //   });
    //   cols.arrange(columns, c => c.key)   // the report's columns in the user's order
    //   cols.sort()                         // { key, dir } | null
    //   cols.compare(a, b, valueOf)         // comparator for the current sort (or 0)
    //   cols.reset()                        // forget widths, order and sort (and hidden columns)
    //   FBLib.RptCols.totalsCells(columns, labelHtml, { key: figureHtml })
    //                                       // a group / totals row that stays aligned
    //                                       // whatever order the columns are in
    //
    // Click a heading: ascending, descending, then back to the report's own
    // order. Drag a heading onto another to move it there. Drag a heading's
    // right edge to resize; double-click the edge to return every column
    // to its natural width.
    //
    // COLUMNS DROP-DOWN (columnMenu): an FBLib.ColumnMenu button (fb-styles
    // §37) to tick columns on and off, drag them into order (the same order
    // as dragging a heading), Show all / Reset (= cols.reset()), and, with
    // `rename: true`, for an admin to rename a heading for everyone. With it,
    // arrange() returns only the columns shown, as copies whose `label` is
    // the company's heading (`defaultLabel` keeps the page's own), so a page
    // that builds its App table, PDF report spec and Excel sheet from
    // arrange() gets the same columns, in the same order, with the same
    // headings everywhere. Column flags, as FBLib.Table's: `vis: false`
    // (hidden until the user shows it), `menu: false` (always shown, not
    // listed: a drill or tree column), `locked: true` (listed, can't be
    // hidden). Pinned columns are listed but don't move.
    //   - Hidden / shown columns are saved per user with the widths, order
    //     and sort (under `key`, as `vis: { colKey: bool }`).
    //   - Headings live in the company (master) settings under labelsKey as
    //     { colKey: 'Heading' }, read straight from the master copy (a user's
    //     own row under that key can't hide them). Renaming needs
    //     FBLib.Settings.init({ masterStorage: 'userProperties' }) (never
    //     'reportData': it raises a native dialog in preview) and
    //     Settings.isAdmin(), which with company.editors includes the
    //     report's Edit Settings users.
    //   - Document output (FB_LAUNCH output 'pdf', FBDoc.output.requested())
    //     prints what the company would: the page's own columns and order
    //     with the company's headings; one user's hide / move never applies,
    //     no button is drawn and nothing is saved.
    //   cols.setVisible(key, vis)  cols.move(key, targetKey, after)
    //   cols.setLabel(key, label)  ('' = the page's own; false = not saved)
    //   cols.labels()              // { colKey: heading } (company)
    //   cols.columnMenu            // the FBLib.ColumnMenu, or null
    // ====================================================================
    /** Resize, heading-click sort and drag-reorder for a report-rendered .rpt-table; see attach(). */
    const RptCols = (function () {
        const MIN_W = 36;
        /**
         * Adds resize, heading-click sort and drag-reorder to a report-rendered table whose headings are th[data-col].
         * The report keeps rendering its rows and re-sorts on onSort; state is saved per user under opts.key.
         * @param {object} opts - Options.
         * @param {HTMLTableElement} opts.table - The .rpt-table.
         * @param {string} [opts.key='rptCols'] - FBLib.Settings key for widths, order and sort.
         * @param {Function|boolean} [opts.sortable] - Per-key predicate, or false to turn sorting off.
         * @param {Function|boolean} [opts.draggable] - Per-key predicate, or false to turn reordering off.
         * @param {Function} [opts.onSort] - Called with (key, dir); dir is 'asc', 'desc' or null for the report's own order.
         * @param {Function} [opts.onReorder] - Called with the new column-key order.
         * @param {string[]} [opts.pinned] - Keys kept first, in this order, and never moved.
         * @param {boolean} [opts.noUnsorted] - Headings cycle asc and desc only.
         * @param {object} [opts.columnMenu] - Adds a Columns drop-down (FBLib.ColumnMenu): { mount, rename?, labelsKey?, onChange?,
         *   buttonText?, buttonClass? }. arrange() then returns only the shown columns, relabelled with the company's headings.
         * @returns {object} API: decorate(), arrange(columns, keyOf?), compare(a, b, valueOf), sort(), setSort(key, dir), reset(),
         *   setVisible(key, vis), move(key, targetKey, after), setLabel(key, label), labels(), columnMenu.
         */
        function attach(opts) {
            const table = opts.table;
            const KEY = opts.key || 'rptCols';
            const canSort = typeof opts.sortable === 'function' ? opts.sortable : function () { return opts.sortable !== false; };
            const pinned = Array.isArray(opts.pinned) ? opts.pinned.slice() : [];
            const isPinned = k => pinned.indexOf(k) !== -1;
            const canDrag0 = typeof opts.draggable === 'function' ? opts.draggable : function () { return opts.draggable !== false; };
            const canDrag = k => !isPinned(k) && canDrag0(k);
            // The Columns drop-down (opts.columnMenu). Without it nothing below
            // changes what this helper does.
            const menuOpts = opts.columnMenu && typeof opts.columnMenu === 'object' ? opts.columnMenu : null;
            const LABELS = menuOpts ? String(menuOpts.labelsKey || KEY + 'Labels') : null;
            // Document output prints what the company would: no user's hide / move.
            const output = !!menuOpts && (function () {
                try { return !!(window.FBDoc && window.FBDoc.output && window.FBDoc.output.requested()); } catch (_) { return false; }
            })();
            let known = [];        // every column of the last arrange() (hidden too), in order
            let menu = null;
            let st = load();
            let resizing = false, dragKey = null;

            function load() {
                let v = null;
                try { v = Settings.resolve(KEY); } catch (_) {}
                v = v && typeof v === 'object' ? v : {};
                const s = {
                    order: Array.isArray(v.order) ? v.order.slice() : [],
                    widths: v.widths && typeof v.widths === 'object' ? Object.assign({}, v.widths) : {},
                    sort: v.sort && v.sort.key ? { key: v.sort.key, dir: v.sort.dir === 'desc' ? 'desc' : 'asc' } : null
                };
                if (menuOpts) s.vis = v.vis && typeof v.vis === 'object' ? Object.assign({}, v.vis) : {};
                return s;
            }
            function save() {
                if (output) return;
                const v = { order: st.order, widths: st.widths, sort: st.sort };
                if (menuOpts) v.vis = st.vis || {};
                try { Settings.setUserKey(KEY, v); Settings.saveUser(); } catch (_) {}
            }
            const heads = () => table.tHead ? Array.prototype.slice.call(table.tHead.querySelectorAll('th[data-col]')) : [];
            const zoom = el => { const r = el.getBoundingClientRect(); return el.offsetWidth ? r.width / el.offsetWidth : 1; };

            function applyWidths() {
                const ths = heads();
                const fixed = Object.keys(st.widths).length > 0 && ths.length > 0;
                if (!fixed) { table.classList.remove('rpt-fixed'); table.style.width = ''; ths.forEach(th => { th.style.maxWidth = ''; }); return; }
                // A column shown since the last resize: lay the table out
                // naturally once and keep that column's own width.
                const fresh = ths.filter(th => !st.widths[th.dataset.col]);
                if (fresh.length) {
                    table.classList.remove('rpt-fixed'); table.style.width = '';
                    ths.forEach(th => { th.style.width = th.style.minWidth = th.style.maxWidth = ''; });
                    const z = zoom(table);
                    fresh.forEach(th => { st.widths[th.dataset.col] = Math.max(MIN_W, Math.round(th.getBoundingClientRect().width / z)) || 120; });
                    save();
                }
                table.classList.add('rpt-fixed');
                let sum = 0;
                ths.forEach(th => {
                    let w = st.widths[th.dataset.col];
                    if (!w) w = /\bnum-cell\b/.test(th.className) ? 110 : 150;
                    th.style.width = th.style.minWidth = th.style.maxWidth = w + 'px';
                    sum += w;
                });
                // Headings without data-col (rare) keep a default share.
                Array.prototype.forEach.call(table.tHead.rows[0] ? table.tHead.rows[0].cells : [], c => {
                    if (!c.dataset.col) { c.style.width = c.style.width || '120px'; sum += parseFloat(c.style.width) || 120; }
                });
                table.style.width = sum + 'px';
            }
            function decorate() {
                const ths = heads();
                ths.forEach(th => {
                    const k = th.dataset.col;
                    th.classList.toggle('sort-asc', !!st.sort && st.sort.key === k && st.sort.dir === 'asc');
                    th.classList.toggle('sort-desc', !!st.sort && st.sort.key === k && st.sort.dir === 'desc');
                    th.classList.toggle('rpt-sortable', canSort(k));
                    if (!th.querySelector(':scope > .rpt-col-grip')) {
                        const g = document.createElement('span');
                        g.className = 'rpt-col-grip';
                        g.title = 'Drag to resize · double-click to reset every column';
                        th.appendChild(g);
                    }
                    th.draggable = canDrag(k);
                });
                applyWidths();
            }

            // Sort: click a heading (not its resize edge).
            table.addEventListener('click', function (e) {
                if (resizing) return;
                const th = e.target.closest('th[data-col]');
                if (!th || !table.tHead || !table.tHead.contains(th) || e.target.closest('.rpt-col-grip')) return;
                const k = th.dataset.col;
                if (!canSort(k)) return;
                if (!st.sort || st.sort.key !== k) st.sort = { key: k, dir: 'asc' };
                else if (st.sort.dir === 'asc') st.sort = { key: k, dir: 'desc' };
                else st.sort = opts.noUnsorted ? { key: k, dir: 'asc' } : null;
                save();
                if (typeof opts.onSort === 'function') opts.onSort(st.sort ? st.sort.key : null, st.sort ? st.sort.dir : null);
                decorate();
            });

            // Resize: drag a heading's right edge.
            table.addEventListener('pointerdown', function (e) {
                const grip = e.target.closest('.rpt-col-grip');
                if (!grip) return;
                e.preventDefault(); e.stopPropagation();
                const th = grip.parentNode, z = zoom(th);
                // First resize: freeze every column at its current width.
                if (!Object.keys(st.widths).length) heads().forEach(h => { st.widths[h.dataset.col] = Math.round(h.getBoundingClientRect().width / z); });
                const k = th.dataset.col, startX = e.clientX, startW = st.widths[k] || Math.round(th.getBoundingClientRect().width / z);
                resizing = true;
                th.draggable = false;
                const move = ev => { st.widths[k] = Math.max(MIN_W, Math.round(startW + (ev.clientX - startX) / z)); applyWidths(); };
                const up = () => {
                    document.removeEventListener('pointermove', move);
                    document.removeEventListener('pointerup', up);
                    th.draggable = canDrag(k);
                    save();
                    setTimeout(() => { resizing = false; }, 0);   // swallow the click that ends the drag
                };
                document.addEventListener('pointermove', move);
                document.addEventListener('pointerup', up);
            }, true);
            table.addEventListener('dblclick', function (e) {
                if (!e.target.closest('.rpt-col-grip')) return;
                st.widths = {}; save(); applyWidths();
            });

            // Reorder: drag a heading onto another.
            table.addEventListener('dragstart', function (e) {
                const th = e.target.closest && e.target.closest('th[data-col]');
                if (!th || resizing || !canDrag(th.dataset.col)) return;
                dragKey = th.dataset.col;
                try { e.dataTransfer.setData('text/plain', dragKey); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
            });
            table.addEventListener('dragover', function (e) {
                const th = dragKey && e.target.closest('th[data-col]');
                if (!th || th.dataset.col === dragKey || isPinned(th.dataset.col)) return;
                e.preventDefault();
                heads().forEach(h => h.classList.toggle('col-drag-over', h === th));
            });
            table.addEventListener('dragleave', function (e) {
                const th = e.target.closest && e.target.closest('th[data-col]');
                if (th) th.classList.remove('col-drag-over');
            });
            table.addEventListener('drop', function (e) {
                const th = dragKey && e.target.closest('th[data-col]');
                heads().forEach(h => h.classList.remove('col-drag-over'));
                if (!th || th.dataset.col === dragKey || isPinned(th.dataset.col)) { dragKey = null; return; }
                e.preventDefault();
                const shown = heads().map(h => h.dataset.col);
                const from = shown.indexOf(dragKey), to = shown.indexOf(th.dataset.col);
                if (menuOpts) {
                    // Hidden columns keep their place: move within every column.
                    const k = dragKey;
                    dragKey = null;
                    move(k, th.dataset.col, from < to);
                    return;
                }
                shown.splice(from, 1);
                shown.splice(to, 0, dragKey);
                // Keep columns not shown now (switched off) where they were.
                const rest = st.order.filter(k => shown.indexOf(k) === -1);
                st.order = shown.concat(rest);
                dragKey = null;
                save();
                if (typeof opts.onReorder === 'function') opts.onReorder(st.order.slice());
            });
            table.addEventListener('dragend', function () { dragKey = null; heads().forEach(h => h.classList.remove('col-drag-over')); });

            // Re-decorate after every render of the headings.
            if (table.tHead && typeof MutationObserver === 'function') new MutationObserver(decorate).observe(table.tHead, { childList: true });
            decorate();

            function arrange(columns, keyOf) {
                keyOf = keyOf || (c => c.key);
                if (!menuOpts) return ordered(columns, keyOf, st.order);
                // Document output: the page's own order (pinned first), never the user's.
                const all = ordered(columns, keyOf, output ? [] : st.order);
                const map = labels();
                known = all.map(c => {
                    const o = c && typeof c === 'object' ? c : {};
                    const dflt = o.defaultLabel != null ? String(o.defaultLabel) : (o.label != null ? String(o.label) : String(keyOf(c)));
                    return { key: keyOf(c), dflt: dflt, menu: o.menu !== false, locked: !!o.locked, on: o.vis !== false };
                });
                const res = [];
                all.forEach((c, i) => {
                    const k = known[i];
                    if (!shown(k)) return;
                    if (!c || typeof c !== 'object') { res.push(c); return; }
                    const v = map[k.key];
                    res.push(Object.assign({}, c, { label: typeof v === 'string' && v.trim() ? v.trim() : k.dflt, defaultLabel: k.dflt }));
                });
                if (menu && !menu.element.classList.contains('open')) menu.refresh();
                return res;
            }
            function ordered(columns, keyOf, order) {
                if (!order.length) {
                    if (!pinned.length) return columns.slice();
                    const first = pinned.map(p => columns.find(c => keyOf(c) === p)).filter(Boolean);
                    return first.concat(columns.filter(c => !isPinned(keyOf(c))));
                }
                // The user's order for the columns they have placed; any other
                // column (switched on since) goes right after its natural
                // left-hand neighbour, so untouched columns never jump.
                const keys = columns.map(keyOf);
                const res = order.filter(k => keys.indexOf(k) !== -1);
                keys.forEach((k, i) => {
                    if (res.indexOf(k) !== -1) return;
                    let j = i - 1;
                    while (j >= 0 && res.indexOf(keys[j]) === -1) j--;
                    res.splice(j < 0 ? 0 : res.indexOf(keys[j]) + 1, 0, k);
                });
                const list = res.map(k => columns[keys.indexOf(k)]);
                if (!pinned.length) return list;
                const first = pinned.map(p => list.find(c => keyOf(c) === p)).filter(Boolean);
                return first.concat(list.filter(c => !isPinned(keyOf(c))));
            }
            function compare(a, b, valueOf) {
                if (!st.sort) return 0;
                const va = valueOf(a, st.sort.key), vb = valueOf(b, st.sort.key);
                const ba = va == null || va === '', bb = vb == null || vb === '';
                if (ba || bb) return ba === bb ? 0 : (ba ? 1 : -1);   // blanks last, either direction
                const d = (typeof va === 'number' && typeof vb === 'number') ? va - vb
                    : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
                return st.sort.dir === 'desc' ? -d : d;
            }
            function reset() {
                st = { order: [], widths: {}, sort: null };
                if (menuOpts) st.vis = {};
                save(); decorate();
            }

            // ---- The Columns drop-down (opts.columnMenu) --------------------
            // A column is shown unless the user hid it (or it starts hidden,
            // vis: false, and they haven't shown it). Document output: the
            // page's own visibility. menu: false columns are the page's to show.
            function shown(k) {
                if (!k.menu) return k.on;
                if (k.locked) return true;
                if (output || !st.vis || st.vis[k.key] === undefined) return k.on;
                return !!st.vis[k.key];
            }
            // The company's headings, read from the master copy itself.
            function labels() {
                if (!LABELS) return {};
                try {
                    const v = (Settings.getMaster() || {})[LABELS];
                    return v && typeof v === 'object' ? Object.assign({}, v) : {};
                } catch (_) { return {}; }
            }
            function changed() {
                const fn = menuOpts && typeof menuOpts.onChange === 'function' ? menuOpts.onChange : opts.onReorder;
                if (typeof fn === 'function') fn(st.order.slice());
            }
            function setVisible(key, vis) {
                if (!menuOpts || output) return;
                const k = known.find(x => x.key === key);
                if (!k || !k.menu || (k.locked && !vis)) return;
                // Never hide the last column shown.
                if (!vis && known.filter(x => shown(x) && x.key !== key).length === 0) return;
                st.vis[key] = !!vis;
                save();
                changed();
            }
            // Moves a column before another (after it when `after`), counting
            // hidden columns, so they keep their place. Pinned columns don't move.
            function move(key, targetKey, after) {
                if (output || key === targetKey || !canDrag(key) || isPinned(targetKey)) return;
                const order = known.length ? known.map(x => x.key) : heads().map(h => h.dataset.col);
                const from = order.indexOf(key);
                if (from === -1 || order.indexOf(targetKey) === -1) return;
                order.splice(from, 1);
                const to = order.indexOf(targetKey);
                order.splice(after ? to + 1 : to, 0, key);
                // Columns not in this render (another grouping's) keep their place after.
                st.order = order.concat(st.order.filter(k => order.indexOf(k) === -1));
                save();
                if (typeof opts.onReorder === 'function') opts.onReorder(st.order.slice());
            }
            function canRename() {
                try {
                    return !!(menuOpts && menuOpts.rename) && !output && Settings._initialised && Settings.isAdmin() &&
                        Settings.masterStorage() === 'userProperties';
                } catch (_) { return false; }
            }
            // Admin: renames a heading for everyone ('' / null / the page's own
            // name drops the rename). True once the company settings hold it.
            function setLabel(key, label) {
                if (!canRename()) return false;
                const k = known.find(x => x.key === key);
                if (!k) return false;
                const text = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
                const next = labels();
                if (!text || text === k.dflt) delete next[key]; else next[key] = text;
                let ok;
                try { ok = Object.keys(next).length ? Settings.publishCompany(LABELS, next) : Settings.clearCompany(LABELS); }
                catch (_) { ok = false; }
                if (!ok) return false;
                changed();
                return true;
            }
            if (menuOpts && !output) {
                menu = ColumnMenu.create({
                    mount: menuOpts.mount,
                    buttonText: menuOpts.buttonText,
                    buttonClass: menuOpts.buttonClass,
                    items: function () {
                        const map = labels();
                        return known.filter(k => k.menu).map(k => ({
                            key: k.key, label: typeof map[k.key] === 'string' && map[k.key].trim() ? map[k.key].trim() : k.dflt,
                            defaultLabel: k.dflt, vis: shown(k), locked: k.locked
                        }));
                    },
                    canRename: canRename,
                    onToggle: setVisible,
                    onMove: move,
                    onReset: function () { reset(); changed(); },
                    onRename: setLabel
                });
            }
            return {
                decorate: decorate,
                arrange: arrange,
                compare: compare,
                sort: () => (st.sort ? { key: st.sort.key, dir: st.sort.dir } : null),
                setSort: (key, dir) => { st.sort = key ? { key: key, dir: dir === 'desc' ? 'desc' : 'asc' } : null; save(); decorate(); },
                reset: reset,
                setVisible: setVisible,
                move: move,
                setLabel: setLabel,
                labels: labels,
                columnMenu: menu
            };
        }
        /**
         * Builds a group or totals row's cells for columns in their current order, so the row stays aligned after a reorder.
         * The label spans the first run of columns with no figure; every figure keeps its own column, before or after it.
         * @param {object[]} cols - The columns in display order (a truthy num gives a cell the num-cell class).
         * @param {string} identity - The label's HTML.
         * @param {object} figs - Column key to figure HTML.
         * @param {object} [opts] - Options: keyOf(col), cell(col) for a custom cell, labelClass for the label cell.
         * @returns {string} The row's td cells as HTML.
         */
        function totalsCells(cols, identity, figs, opts) {
            opts = opts || {};
            const keyOf = opts.keyOf || (c => c.key);
            const has = c => figs[keyOf(c)] != null && figs[keyOf(c)] !== '';
            const cell = opts.cell || (c => '<td class="' + (c.num ? 'num-cell' : '') + '">' + (figs[keyOf(c)] == null ? '' : figs[keyOf(c)]) + '</td>');
            let at = cols.findIndex(c => !has(c));
            if (at < 0) at = 0;
            let end = at;
            while (end < cols.length && !has(cols[end])) end++;
            if (end === at) end = at + 1;
            return cols.slice(0, at).map(cell).join('') + '<td colspan="' + (end - at) + '"' + (opts.labelClass ? ' class="' + opts.labelClass + '"' : '') + '>' + identity + '</td>' +
                cols.slice(end).map(cell).join('');
        }
        return { attach: attach, totalsCells: totalsCells };
    })();

    // ====================================================================
    // FBLib.Pivot — a pivot (cross-tab) view of a report's flat rows: rows ×
    // columns of any two dimensions (a second row dimension nests), one
    // measure with Sum / Count / Avg / Min / Max, date dimensions bucketed by
    // day / week / month / quarter / year, row and column totals, swap, and a
    // click-through to the rows behind a cell. Promoted from the four
    // summary reports' pivot (fb-styles §34 styles it). Config is saved per
    // user in the report's FBLib.Settings under `settingsKey`.
    //
    //   const pv = FBLib.Pivot.mount(hostEl, {
    //       fields: [ { key, label, type: 'text'|'date'|'number'|'money'|'qty', dim?, measure? } ],
    //                // dim: may be a row/column (default: text and date);
    //                // measure: may be the measure (default: number/money/qty)
    //       rows:   () => report.rows,          // flat rows, values under field keys
    //       defaults: { rowDim, rowDim2, colDim, measure, agg, rowBucket, colBucket },
    //       settingsKey: 'pivot',
    //       format: (field, value) => text,     // optional cell formatter
    //       countLabel: 'Tag count'             // the count measure's name (default "Row count")
    //   });
    // A field may also carry:
    //   order: [value, …] or (a, b) => n   // a dimension's own order (e.g. age bands)
    //   ratio: [numKey, denKey]            // a measure computed as sum(num) / sum(den)
    //                                      // in every cell and total (e.g. turnover)
    //   distinct: true                     // a measure counting the distinct values of
    //                                      // this field (e.g. { key: 'partid',
    //                                      // label: 'Parts', distinct: true })
    //   pv.relabel(key, label)             // rename a field after mounting (e.g.
    //                                      // "Price (inc. tax)")
    //   pv.render()      // after the rows change, or when the view is shown
    //   pv.pdfSpec()     // { head, rows, foot } <tr> strings for the PDF view
    //   pv.sheet()       // { name, cols, rows } for FBLib.Export.xlsx
    // ====================================================================
    /** Pivot (cross-tab) view of a report's flat rows, with drill-down, PDF and Excel output; see mount(). */
    const Pivot = (function () {
        const BUCKETS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];
        const AGGS = [['sum', 'Sum'], ['count', 'Count'], ['avg', 'Average'], ['min', 'Min'], ['max', 'Max']];
        const RS = String.fromCharCode(31);   // compound row key separator (written as an escape: Fishbowl strips control characters)
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        const isNumType = t => t === 'number' || t === 'money' || t === 'qty';

        /**
         * Buckets a "YYYY-MM-DD..." date into a pivot period label.
         * @param {string} v - The date value.
         * @param {string} bucket - 'day' | 'week' | 'month' | 'quarter' | 'year'; anything else means day.
         * @returns {string} e.g. "2026-10-13", "2026-W42" (ISO week), "2026-10", "2026-Q4" or "2026"; '(blank)' when too short.
         */
        function bucketDate(v, bucket) {
            const s = String(v || '');
            if (s.length < 10) return '(blank)';
            const yyyy = s.substring(0, 4), mm = s.substring(5, 7), dd = s.substring(8, 10), m = parseInt(mm, 10);
            if (bucket === 'year') return yyyy;
            if (bucket === 'quarter') return yyyy + '-Q' + Math.ceil(m / 3);
            if (bucket === 'month') return yyyy + '-' + mm;
            if (bucket === 'week') {
                const d = new Date(Date.UTC(+yyyy, m - 1, +dd));
                if (isNaN(d.getTime())) return '(blank)';
                d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
                const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                return d.getUTCFullYear() + '-W' + String(Math.ceil((((d - y0) / 86400000) + 1) / 7)).padStart(2, '0');
            }
            return yyyy + '-' + mm + '-' + dd;
        }

        /**
         * Mounts a pivot view in a host element: row and column dimensions, a measure and its aggregate; click a cell to drill.
         * Config is saved per user under opts.settingsKey. Nothing is drawn until you call render(). Field options: see above.
         * @param {HTMLElement} host - The element to render into (its content is replaced).
         * @param {object} opts - Options.
         * @param {object[]} opts.fields - { key, label, type: 'text'|'date'|'number'|'money'|'qty', dim?, measure?, order?, ratio?, distinct? }.
         * @param {Function} opts.rows - Returns the current flat rows.
         * @param {object} [opts.defaults] - Initial rowDim, rowDim2, colDim, measure, agg, bucket choices and totals flags.
         * @param {string} [opts.settingsKey='pivot'] - FBLib.Settings key.
         * @param {Function} [opts.format] - (field, value) returns display text, or null for the default.
         * @param {string} [opts.countLabel='Row count'] - Name of the count measure.
         * @param {Function} [opts.onDrill] - (rows, title) replaces the built-in drill-down modal.
         * @returns {object} API: render(), pdfSpec(), sheet(name?), relabel(key, label), config(), el, last().
         */
        function mount(host, opts) {
            const fields = (opts.fields || []).map(f => Object.assign({ type: 'text' }, f));
            const byKey = {};
            fields.forEach(f => { byKey[f.key] = f; });
            const dims = fields.filter(f => f.dim != null ? f.dim : !isNumType(f.type));
            const measures = fields.filter(f => f.measure != null ? f.measure : (isNumType(f.type) || !!f.ratio || !!f.distinct));
            const countLabel = opts.countLabel || 'Row count';
            const KEY = opts.settingsKey || 'pivot';
            const d0 = opts.defaults || {};
            let saved = null;
            try { saved = Settings.resolve(KEY); } catch (_) {}
            const cfg = Object.assign({
                rowDim: d0.rowDim || (dims[0] && dims[0].key) || '', rowDim2: d0.rowDim2 || '', colDim: d0.colDim || '',
                measure: d0.measure || (measures[0] ? measures[0].key : '__count__'), agg: d0.agg || 'sum',
                rowBucket: d0.rowBucket || 'month', rowBucket2: d0.rowBucket2 || 'month', colBucket: d0.colBucket || 'month',
                // defaults.showColTotals: false where totals add unlike units
                showRowTotals: d0.showRowTotals !== false, showColTotals: d0.showColTotals !== false
            }, saved && typeof saved === 'object' ? saved : {});
            const valid = k => !k || !!byKey[k];
            if (!valid(cfg.rowDim) || !cfg.rowDim) cfg.rowDim = (dims[0] && dims[0].key) || '';
            if (!valid(cfg.rowDim2)) cfg.rowDim2 = '';
            if (!valid(cfg.colDim)) cfg.colDim = '';
            if (cfg.measure !== '__count__' && !byKey[cfg.measure]) cfg.measure = measures[0] ? measures[0].key : '__count__';
            let last = null;

            const dimOpts = (blank) => (blank ? '<option value="">(none)</option>' : '') + dims.map(f => '<option value="' + esc(f.key) + '">' + esc(f.label) + '</option>').join('');
            const bucketSel = cls => '<select class="' + cls + '" title="Date grouping">' + BUCKETS.map(b => '<option value="' + b[0] + '">' + b[1] + '</option>').join('') + '</select>';
            host.classList.add('pivot-host');
            host.innerHTML =
                '<div class="pivot-bar open">' +
                  '<span class="pv-group">Rows <select class="pv-row">' + dimOpts(false) + '</select>' + bucketSel('pv-rowb') +
                    '<span class="pv-plus">+</span><select class="pv-row2" title="A second row dimension (optional)">' + dimOpts(true) + '</select>' + bucketSel('pv-rowb2') + '</span>' +
                  '<span class="pv-group">Columns <select class="pv-col">' + dimOpts(true) + '</select>' + bucketSel('pv-colb') + '</span>' +
                  '<span class="pv-group">Measure <select class="pv-measure"><option value="__count__">' + esc(countLabel) + '</option>' +
                    measures.map(f => '<option value="' + esc(f.key) + '">' + esc(f.label) + '</option>').join('') + '</select>' +
                    '<select class="pv-agg">' + AGGS.map(a => '<option value="' + a[0] + '">' + a[1] + '</option>').join('') + '</select></span>' +
                  '<button type="button" class="pv-swap" title="Swap rows and columns">⇄ Swap</button>' +
                  '<label class="pv-totals"><input type="checkbox" class="pv-rt"> Row totals</label>' +
                  '<label class="pv-totals"><input type="checkbox" class="pv-ct"> Column totals</label>' +
                '</div>' +
                '<div class="pivot-overflow"></div>' +
                '<div class="pivot-scroll"><table class="pivot-table"><thead></thead><tbody></tbody></table></div>';
            const $q = s => host.querySelector(s);
            const ctl = {
                row: $q('.pv-row'), rowb: $q('.pv-rowb'), row2: $q('.pv-row2'), rowb2: $q('.pv-rowb2'), col: $q('.pv-col'), colb: $q('.pv-colb'),
                measure: $q('.pv-measure'), agg: $q('.pv-agg'), rt: $q('.pv-rt'), ct: $q('.pv-ct')
            };
            function syncCtl() {
                ctl.row.value = cfg.rowDim; ctl.row2.value = cfg.rowDim2; ctl.col.value = cfg.colDim;
                ctl.rowb.value = cfg.rowBucket; ctl.rowb2.value = cfg.rowBucket2; ctl.colb.value = cfg.colBucket;
                ctl.measure.value = cfg.measure; ctl.agg.value = cfg.agg;
                ctl.rt.checked = !!cfg.showRowTotals; ctl.ct.checked = !!cfg.showColTotals;
                const isDate = k => !!k && byKey[k] && byKey[k].type === 'date';
                ctl.rowb.style.display = isDate(cfg.rowDim) ? '' : 'none';
                ctl.rowb2.style.display = isDate(cfg.rowDim2) ? '' : 'none';
                ctl.colb.style.display = isDate(cfg.colDim) ? '' : 'none';
                ctl.agg.disabled = cfg.measure === '__count__' || !!(byKey[cfg.measure] && (byKey[cfg.measure].ratio || byKey[cfg.measure].distinct));
            }
            function readCtl() {
                cfg.rowDim = ctl.row.value; cfg.rowDim2 = ctl.row2.value; cfg.colDim = ctl.col.value;
                cfg.rowBucket = ctl.rowb.value; cfg.rowBucket2 = ctl.rowb2.value; cfg.colBucket = ctl.colb.value;
                cfg.measure = ctl.measure.value; cfg.agg = ctl.agg.value;
                cfg.showRowTotals = ctl.rt.checked; cfg.showColTotals = ctl.ct.checked;
            }
            function save() { try { Settings.setUserKey(KEY, Object.assign({}, cfg)); Settings.saveUser(); } catch (_) {} }
            host.querySelector('.pivot-bar').addEventListener('change', () => { readCtl(); syncCtl(); save(); render(); });
            host.querySelector('.pv-swap').addEventListener('click', () => {
                if (!cfg.colDim) return;
                const r = cfg.rowDim, rb = cfg.rowBucket;
                cfg.rowDim = cfg.colDim; cfg.rowBucket = cfg.colBucket; cfg.colDim = r; cfg.colBucket = rb;
                syncCtl(); save(); render();
            });

            const keyFor = (row, k, bucket) => {
                if (!k) return '__all__';
                const v = row[k];
                if (v == null || v === '') return '(blank)';
                return byKey[k].type === 'date' ? bucketDate(v, bucket) : String(v);
            };
            function build(rows) {
                const isCount = cfg.measure === '__count__';
                const ratio = !isCount && byKey[cfg.measure] && byKey[cfg.measure].ratio;
                const distinct = !isCount && byKey[cfg.measure] && byKey[cfg.measure].distinct;
                const acc = () => ({ sum: 0, n: 0, min: Infinity, max: -Infinity, count: 0, num: 0, den: 0, set: distinct ? new Set() : null });
                const add = (a, v, r, dv) => {
                    a.count++;
                    if (a.set) { if (dv != null && dv !== '') a.set.add(dv); return; }
                    if (r) { a.num += r[0]; a.den += r[1]; return; }
                    if (v != null && !isNaN(v)) { a.sum += v; a.n++; if (v < a.min) a.min = v; if (v > a.max) a.max = v; }
                };
                const nz = x => { const n = parseFloat(x); return isNaN(n) ? 0 : n; };
                const cells = new Map(), rowAcc = new Map(), colAcc = new Map(), all = acc();
                const rk0 = [], ck0 = [];
                rows.forEach(r => {
                    let rk = keyFor(r, cfg.rowDim, cfg.rowBucket);
                    if (cfg.rowDim2) rk += RS + keyFor(r, cfg.rowDim2, cfg.rowBucket2);
                    const ck = keyFor(r, cfg.colDim, cfg.colBucket);
                    const v = isCount || ratio || distinct ? null : parseFloat(r[cfg.measure]);
                    const dv = distinct ? r[cfg.measure] : null;
                    const rv = ratio ? [nz(r[ratio[0]]), nz(r[ratio[1]])] : null;
                    if (!rowAcc.has(rk)) { rowAcc.set(rk, acc()); rk0.push(rk); }
                    if (!colAcc.has(ck)) { colAcc.set(ck, acc()); ck0.push(ck); }
                    const k = rk + '|' + ck;
                    if (!cells.has(k)) cells.set(k, acc());
                    add(cells.get(k), v, rv, dv); add(rowAcc.get(rk), v, rv, dv); add(colAcc.get(ck), v, rv, dv); add(all, v, rv, dv);
                });
                const reduce = a => {
                    if (!a || !a.count) return null;
                    if (isCount) return a.count;
                    if (distinct) return a.set.size;
                    if (ratio) return a.den ? a.num / a.den : null;
                    if (cfg.agg === 'count') return a.count;
                    if (!a.n) return null;
                    if (cfg.agg === 'avg') return a.sum / a.n;
                    if (cfg.agg === 'min') return a.min;
                    if (cfg.agg === 'max') return a.max;
                    return a.sum;
                };
                const sortKeys = (arr, k) => arr.slice().sort((a, b) => {
                    const ord = k && byKey[k] && byKey[k].order;
                    if (typeof ord === 'function') return ord(a, b);
                    if (Array.isArray(ord)) {
                        const ia = ord.indexOf(a), ib = ord.indexOf(b);
                        if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
                    }
                    if (k && byKey[k] && byKey[k].type === 'date') return a < b ? -1 : a > b ? 1 : 0;
                    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
                });
                let rowKeys = sortKeys(rk0, cfg.rowDim), colKeys = cfg.colDim ? sortKeys(ck0, cfg.colDim) : ['__all__'];
                let overflow = false;
                if (rowKeys.length * colKeys.length > 10000) {
                    // Keep the top 50 of each axis by size, in their natural order.
                    overflow = true;
                    const top = (keys, accs) => keys.slice().sort((a, b) => Math.abs(reduce(accs.get(b)) || 0) - Math.abs(reduce(accs.get(a)) || 0)).slice(0, 50);
                    const keepR = new Set(top(rowKeys, rowAcc)), keepC = new Set(top(colKeys, colAcc));
                    rowKeys = rowKeys.filter(k => keepR.has(k));
                    if (cfg.colDim) colKeys = colKeys.filter(k => keepC.has(k));
                }
                return {
                    rowKeys, colKeys, overflow,
                    cell: (rk, ck) => reduce(cells.get(rk + '|' + ck)),
                    rowTotal: rk => reduce(rowAcc.get(rk)), colTotal: ck => reduce(colAcc.get(ck)), grand: reduce(all)
                };
            }
            function fmt(v) {
                if (v == null) return '';
                const f = byKey[cfg.measure];
                if (cfg.measure === '__count__' || (f && f.distinct) || (cfg.agg === 'count' && !(f && f.ratio))) return Math.round(v).toLocaleString();
                if (typeof opts.format === 'function') { const t = opts.format(f, v); if (t != null) return t; }
                try {
                    if (f && f.type === 'money' && Common.formatMoney) return Common.formatMoney(v);
                    if (f && f.type === 'qty' && Common.formatQty) return Common.formatQty(v);
                } catch (_) {}
                return (Math.round(v * 100) / 100).toLocaleString();
            }
            const label = k => (byKey[k] ? byKey[k].label : '');
            const colHead = ck => (ck === '__all__' ? (cfg.measure === '__count__' ? countLabel : label(cfg.measure)) : ck);

            // The grid as plain rows (cells of text), shared by the screen, PDF and Excel.
            function grid() {
                const p = last = build(opts.rows() || []);
                const two = !!cfg.rowDim2;
                const head = (two ? [label(cfg.rowDim), label(cfg.rowDim2) + (cfg.colDim ? ' × ' + label(cfg.colDim) : '')]
                                  : [label(cfg.rowDim) + (cfg.colDim ? ' × ' + label(cfg.colDim) : '')])
                    .concat(p.colKeys.map(colHead)).concat(cfg.showRowTotals && cfg.colDim ? ['Total'] : []);
                let prev = null;
                const body = p.rowKeys.map(rk => {
                    const parts = rk.split(RS);
                    const lead = two ? [parts[0] === prev ? '' : parts[0], parts[1] || ''] : [rk];
                    prev = parts[0];
                    return { rk, lead, vals: p.colKeys.map(ck => p.cell(rk, ck)), total: p.rowTotal(rk) };
                });
                const foot = cfg.showColTotals ? { vals: p.colKeys.map(ck => p.colTotal(ck)), total: p.grand } : null;
                return { p, two, head, body, foot };
            }

            function render() {
                syncCtl();
                const g = grid(), p = g.p;
                const withTotal = cfg.showRowTotals && !!cfg.colDim;
                $q('.pivot-overflow').classList.toggle('show', p.overflow);
                $q('.pivot-overflow').textContent = p.overflow ? 'The pivot is too large: showing the 50 largest rows and columns. Narrow the filters or use a coarser date grouping for the full grid.' : '';
                $q('thead').innerHTML = '<tr>' + g.head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr>';
                if (!g.body.length) { $q('tbody').innerHTML = '<tr><td class="pv-empty" colspan="99">No data for the current filters.</td></tr>'; return; }
                const rowsHtml = g.body.map(b =>
                    '<tr data-rk="' + esc(b.rk) + '">' + b.lead.map(t => '<td class="pv-label">' + esc(t) + '</td>').join('') +
                    b.vals.map((v, i) => v == null ? '<td class="pv-empty">—</td>' : '<td data-ck="' + esc(p.colKeys[i]) + '">' + esc(fmt(v)) + '</td>').join('') +
                    (withTotal ? '<td class="pv-total">' + esc(fmt(b.total)) + '</td>' : '') + '</tr>');
                if (g.foot) rowsHtml.push('<tr class="pv-totals-row"><td class="pv-total"' + (g.two ? ' colspan="2"' : '') + '>Total</td>' +
                    g.foot.vals.map(v => '<td class="pv-total">' + esc(fmt(v)) + '</td>').join('') +
                    (withTotal ? '<td class="pv-total">' + esc(fmt(g.foot.total)) + '</td>' : '') + '</tr>');
                $q('tbody').innerHTML = rowsHtml.join('');
            }

            // Click a cell: the rows behind it.
            host.querySelector('.pivot-table').addEventListener('click', e => {
                const td = e.target.closest('td[data-ck]');
                if (!td) return;
                const rk = td.parentNode.getAttribute('data-rk'), ck = td.getAttribute('data-ck');
                const parts = rk.split(RS);
                const match = (opts.rows() || []).filter(r =>
                    keyFor(r, cfg.rowDim, cfg.rowBucket) === parts[0] &&
                    (!cfg.rowDim2 || keyFor(r, cfg.rowDim2, cfg.rowBucket2) === (parts[1] || '')) &&
                    (!cfg.colDim || keyFor(r, cfg.colDim, cfg.colBucket) === ck));
                const title = label(cfg.rowDim) + ' = ' + parts[0] + (cfg.rowDim2 ? ' · ' + label(cfg.rowDim2) + ' = ' + (parts[1] || '') : '') +
                    (cfg.colDim ? ' · ' + label(cfg.colDim) + ' = ' + ck : '');
                if (typeof opts.onDrill === 'function') { opts.onDrill(match, title); return; }
                drill(match, title);
            });
            function drill(rows, title) {
                let ov = document.getElementById('fbPivotDrill');
                if (!ov) {
                    ov = document.createElement('div');
                    ov.id = 'fbPivotDrill'; ov.className = 'modal-overlay';
                    ov.innerHTML = '<div class="modal-card"><div class="modal-head"><h3></h3><button type="button" class="fb-drawer-close" aria-label="Close">&times;</button></div>' +
                        '<div class="modal-body pivot-drill-body"></div></div>';
                    document.body.appendChild(ov);
                    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.fb-drawer-close')) ov.classList.remove('open'); });
                }
                ov.querySelector('h3').textContent = title + ' — ' + rows.length.toLocaleString() + ' row' + (rows.length === 1 ? '' : 's');
                const show = rows.slice(0, 2000);
                ov.querySelector('.modal-body').innerHTML = '<table><thead><tr>' + fields.map(f => '<th>' + esc(f.label) + '</th>').join('') + '</tr></thead><tbody>' +
                    show.map(r => '<tr>' + fields.map(f => {
                        const v = r[f.key];
                        const t = v == null ? '' : f.type === 'date' ? String(v).slice(0, 10) : isNumType(f.type) && typeof opts.format === 'function' ? (opts.format(f, v) ?? v) : v;
                        return '<td' + (isNumType(f.type) ? ' class="num-cell"' : '') + '>' + esc(t) + '</td>';
                    }).join('') + '</tr>').join('') + '</tbody></table>' +
                    (rows.length > show.length ? '<p style="padding:8px 12px;color:#506872">The first 2,000 rows are shown.</p>' : '');
                ov.classList.add('open');
            }

            // For the PDF view: the grid as report rows (first columns text, figures right-aligned).
            function pdfSpec() {
                const g = grid(), withTotal = cfg.showRowTotals && !!cfg.colDim, lead = g.two ? 2 : 1;
                const head = '<tr>' + g.head.map((h, i) => '<th' + (i >= lead ? ' class="num-cell"' : '') + '>' + esc(h) + '</th>').join('') + '</tr>';
                const rows = g.body.map(b => '<tr>' + b.lead.map(t => '<td>' + esc(t) + '</td>').join('') +
                    b.vals.map(v => '<td class="num-cell">' + esc(fmt(v)) + '</td>').join('') +
                    (withTotal ? '<td class="num-cell">' + esc(fmt(b.total)) + '</td>' : '') + '</tr>');
                const foot = g.foot ? '<tr><td' + (g.two ? ' colspan="2"' : '') + '>Total</td>' + g.foot.vals.map(v => '<td class="num-cell">' + esc(fmt(v)) + '</td>').join('') +
                    (withTotal ? '<td class="num-cell">' + esc(fmt(g.foot.total)) + '</td>' : '') + '</tr>' : '';
                return { head, rows, foot };
            }
            // For Excel: one sheet of the grid (figures as numbers).
            function sheet(name) {
                const g = grid(), withTotal = cfg.showRowTotals && !!cfg.colDim;
                const isRatio = !!(byKey[cfg.measure] && byKey[cfg.measure].ratio);
                const isDistinct = !!(byKey[cfg.measure] && byKey[cfg.measure].distinct);
                const mtype = cfg.measure === '__count__' || isDistinct || (cfg.agg === 'count' && !isRatio) ? 'int' : (byKey[cfg.measure] && byKey[cfg.measure].type === 'money' ? 'money' : 'number');
                const lead = g.two ? 2 : 1;
                const cols = g.head.map((h, i) => ({ key: 'c' + i, label: h, w: i < lead ? 160 : 100, type: i < lead ? 'text' : mtype, noTotal: true }));
                const rows = g.body.map(b => {
                    const o = {};
                    b.lead.forEach((t, i) => { o['c' + i] = t; });
                    b.vals.forEach((v, i) => { o['c' + (lead + i)] = v; });
                    if (withTotal) o['c' + (lead + b.vals.length)] = b.total;
                    return o;
                });
                if (g.foot) {
                    const o = { c0: 'Total' };
                    g.foot.vals.forEach((v, i) => { o['c' + (lead + i)] = v; });
                    if (withTotal) o['c' + (lead + g.foot.vals.length)] = g.foot.total;
                    rows.push(o);
                }
                return { name: name || 'Pivot', cols, rows, totals: false };
            }
            function relabel(key, text) {
                if (!byKey[key]) return;
                byKey[key].label = text;
                host.querySelectorAll('option[value="' + String(key).replace(/"/g, '') + '"]').forEach(o => { o.textContent = text; });
            }
            syncCtl();
            return { render, pdfSpec, sheet, relabel, config: () => Object.assign({}, cfg), el: host, last: () => last };
        }
        return { mount: mount, bucketDate: bucketDate };
    })();

    return {
        BUILD: BUILD,
        report: report,
        Common: Common,
        SharedData: SharedData,
        Export: Export,
        Settings: Settings,
        CfCatalog: CfCatalog,
        CfCols: CfCols,
        Columns: Columns,
        Picker: Picker,
        Table: Table,
        ColumnMenu: ColumnMenu,
        FilterViews: FilterViews,
        RowCap: RowCap,
        RptCols: RptCols,
        Pivot: Pivot
    };
})();
