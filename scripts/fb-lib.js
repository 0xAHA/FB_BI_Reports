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
  drawer + multi-select primitives), Settings (layered user/master/property
  preference resolver), CfCatalog / CfCols (custom-field discovery + column
  rendering), Columns (per-tile column manifest), Picker (drag/drop column
  picker), and Table (sort/filter/drag scaffolding).
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
// Every public helper hangs off `window.FBLib`. The five sub-modules
// listed here cover roughly 95% of what a typical report needs:
//
//   FBLib.Common         — date / money / qty formatting, debug logger,
//                          status indicators, debug drawer, drop-down
//                          drawer helpers, multi-select widget.
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

    // Build stamp of this fb-lib, maintained by tools/stamp/stamp.js — never
    // edit by hand. Exposed as FBLib.BUILD so a report can tell which fb-lib
    // the Fishbowl server actually served it.
    const BUILD = '2026.09.25-a4fb81b';   // @fb-build

    // The report's identity block (window.FB_REPORT, top of every report's
    // <head>): { key: storage-key prefix, build: report build stamp }.
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
    const Common = (function () {
        // Resolved at module-load. FB_DATE_FORMAT uses Java SimpleDateFormat
        // (e.g. "MM/dd/yyyy", "dd/MM/yyyy"). MOMENT_DATE_FORMAT is the
        // moment.js-compatible variant.
        const FB_DATE_FORMAT = (typeof getProperty === 'function')
            ? getProperty('DateFormatShort', 'MM/dd/yyyy')
            : 'MM/dd/yyyy';
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

        // Home-company currency locale + symbol, resolved once. Falls back to
        // en-US / $ when currencyLocale() is unavailable (e.g. outside the
        // Fishbowl client). Mirrors the inline block reports used to carry.
        let _currency = null;
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

        // Symbol + locale-aware 2-dp money formatting with negative handling.
        function formatMoney(value) {
            const num = parseFloat(value || 0);
            if (isNaN(num)) return '';
            const c = currency();
            const neg = num < 0, abs = Math.abs(num);
            return (neg ? '-' : '') + c.symbol +
                abs.toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // Integer-or-trimmed-decimal quantity formatting (drops trailing zeros).
        function formatQty(value) {
            const v = parseFloat(value);
            if (isNaN(v)) return '';
            return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(4).replace(/\.?0+$/, '');
        }

        // Escape single quotes for safe inlining into a SQL string literal.
        function escSQL(s) {
            return String(s == null ? '' : s).replace(/'/g, "''");
        }

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

        function getStatusTitle(status, fullItems, partialItems, noneItems, pendingItems) {
            if (status === 'committed') return `All items committed (${pendingItems} items)`;
            if (status === 'green')     return `All pending items available (${fullItems}/${pendingItems})`;
            if (status === 'red')       return `No pending items available (0/${pendingItems})`;
            if (status === 'orange')    return `Partially available (${fullItems} full, ${partialItems} partial, ${noneItems} none of ${pendingItems} pending)`;
            return 'No pending items (all finished)';
        }

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
        //   - Opening one drawer closes any other registered drawer (one
        //     open at a time, since they share the slot below the header).
        //   - The trigger button gets `.active` while its drawer is open.
        //   - ESC closes whichever drawer is open.
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
        // under a page's body-zoom.
        function _fbSyncDrawerTop() {
            var hdr = document.querySelector('.topbar') || document.querySelector('header');
            var top = hdr ? hdr.offsetHeight : 56;
            try { document.documentElement.style.setProperty('--fb-drawer-top', top + 'px'); } catch (_) {}
        }
        function _fbAnyDrawerOpen() {
            return Object.keys(_drawers).some(function (k) {
                var e = document.getElementById(k); return e && e.classList.contains('open');
            });
        }
        function openDrawer(id) {
            // Close every other registered drawer first — only one open at a time.
            Object.keys(_drawers).forEach(function (other) {
                if (other !== id) closeDrawer(other);
            });
            const cfg = _drawers[id];
            try { if (cfg && cfg.onBeforeOpen) cfg.onBeforeOpen(); } catch (_) {}
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('open');
                // Overlay behaviour: position under the header + grey the page behind.
                _fbSyncDrawerTop();
                var scrim = _fbDrawerScrim();
                if (scrim) scrim.classList.add('open');
            }
            if (cfg && cfg.triggerId) {
                const btn = document.getElementById(cfg.triggerId);
                if (btn) btn.classList.add('active');
            }
        }
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
        function toggleDrawer(id) {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.classList.contains('open')) closeDrawer(id);
            else openDrawer(id);
        }
        function closeAllDrawers() {
            Object.keys(_drawers).forEach(closeDrawer);
        }
        // Global ESC handler — bind once. Idempotent guard via _escBound flag.
        if (typeof document !== 'undefined' && !window._fbLibDrawerEscBound) {
            window._fbLibDrawerEscBound = true;
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeAllDrawers();
            });
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
                // Opt-in flip-up: when the panel would run past the bottom of
                // the viewport, anchor it above the trigger instead. Inline
                // top/bottom are reset on close so the default returns.
                if (flipUp) {
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

        function _msGet(containerId) { return _msRegistry[containerId] || null; }

        // Close every registered multi-select. Lets a host's OTHER dropdown
        // widgets (e.g. a report's legacy CF-value dropdown) enforce mutual
        // exclusion against the fb-lib ones.
        function _msCloseAll() {
            Object.keys(_msRegistry).forEach(function (id) {
                try { _msRegistry[id].close(); } catch (_) {}
            });
        }

        const MultiSelect = { create: _msCreate, get: _msGet, closeAll: _msCloseAll };

        // Public entry point. Idempotent — first call builds + wires the
        // drawer and returns its API; subsequent calls return the cached
        // API. Safe to call before DOMContentLoaded — the call will defer
        // until the body is ready.
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
            // Drop-down drawer pattern — see canonical doc block above.
            registerDrawer: registerDrawer,
            openDrawer: openDrawer,
            closeDrawer: closeDrawer,
            toggleDrawer: toggleDrawer,
            closeAllDrawers: closeAllDrawers,
            // Multi-select dropdown widget — see canonical comment block above.
            MultiSelect: MultiSelect
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
    const SharedData = (function () {
        const _cache = new Map();

        function _esc(v) { return String(v == null ? '' : v).replace(/'/g, "''"); }

        function currentUserName() {
            try {
                if (typeof getUser !== 'function') return '';
                return (JSON.parse(getUser() || '{}') || {}).userName || '';
            } catch (_) { return ''; }
        }
        // The client-side twin of the SQL filter below. Keep them in step.
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

        function readJson(key, fallback, opts) {
            const raw = read(key, opts);
            if (!raw) return (fallback === undefined ? null : fallback);
            try {
                const o = JSON.parse(raw);
                return (o && typeof o === 'object') ? o : (fallback === undefined ? null : fallback);
            } catch (_) { return (fallback === undefined ? null : fallback); }
        }

        function invalidate(key) {
            if (!key) { _cache.clear(); return; }
            Array.from(_cache.keys()).forEach(function (ck) {
                if (ck.indexOf(key + '|') === 0) _cache.delete(ck);
            });
        }

        // Returns TRUE only when the value verifiably round-tripped. An in-memory
        // success proves nothing — that is exactly the trap saveReportData set.
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

        // Stamps the payload so the newest publish is identifiable, then writes it.
        function writeJson(key, obj, opts) {
            const payload = Object.assign({}, obj || {});
            payload._sharedAt = new Date().toISOString();
            payload._sharedBy = currentUserName();
            return write(key, JSON.stringify(payload), opts);
        }

        return {
            read: read,
            readJson: readJson,
            write: write,
            writeJson: writeJson,
            invalidate: invalidate,
            isAdmin: isAdmin,
            currentUserName: currentUserName
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
            return SharedData.read(_masterKey, { adminOnly: true });
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
            SharedData.write(_masterKey, JSON.stringify(payload), { adminOnly: true, verify: false });
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

        function _userEditingAllowed() {
            return MASTER._userEditingAllowed !== false;
        }

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

            USER   = _loadJson(_readSettings(_userKey))   || {};
            MASTER = _loadJson(_readMaster())             || {};

            _initialised = true;
        }

        function resolve(key) {
            const locked = MASTER && MASTER._userEditingAllowed === false;
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

        function setUserKey(key, value) { USER[key] = value; }
        function saveUser() {
            if (MASTER._userEditingAllowed === false && !_isAdmin) return false;
            _writeSettings(_userKey, JSON.stringify(USER));
            return true;
        }
        function clearUser() {
            USER = {};
            _writeSettings(_userKey, '');
        }
        function publishMaster(payload) {
            if (!_isAdmin) return false;
            const next = Object.assign({}, payload);
            next._userEditingAllowed = (MASTER._userEditingAllowed !== false);
            MASTER = next;
            _writeMaster(JSON.stringify(MASTER));
            return true;
        }
        function setLock(locked) {
            if (!_isAdmin) return false;
            MASTER._userEditingAllowed = !locked;
            _writeMaster(JSON.stringify(MASTER));
            return true;
        }

        // Intersect the user's saved CF id list for a tile with the live
        // catalog, silently pruning fields that have been deactivated or
        // deleted in Fishbowl since they were saved.
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
            get _initialised() { return _initialised; },
            resolve: resolve,
            effective: effective,
            isAdmin: function () { return _isAdmin; },
            userEditingAllowed: _userEditingAllowed,
            getUser: function () { return USER; },
            getMaster: function () { return MASTER; },
            setUserKey: setUserKey,
            saveUser: saveUser,
            clearUser: clearUser,
            publishMaster: publishMaster,
            setLock: setLock,
            activeCfsFor: activeCfsFor,
            get DEFAULT_TILE_ORDER() { return _defaultTileOrder.slice(); },
            get TILE_TO_TABLE() { return Object.assign({}, _tileToTable); }
        };
    })();

    // ====================================================================
    // FBLib.CfCatalog — discover all active custom fields and bucket them
    // by tile (using Settings.TILE_TO_TABLE). Runs ONCE per report load.
    // ====================================================================
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

        // Defer until after first paint so it doesn't block the report's
        // own initial query. Returns a Promise that resolves to the Map.
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
            get loaded() { return loaded; },
            get map() { return map; },
            get readyPromise() { return readyPromise; }
        };
    })();

    // ====================================================================
    // FBLib.CfCols — SQL injection + DOM rendering for active CFs
    // ====================================================================
    const CfCols = (function () {
        // Per-report registry mapping tileKey → window-level module name
        // (e.g. {'SO': 'ReportSO'}). Used to wire CF column-header sort
        // back through the host module's sortTable() function. For
        // single-tile pages, the "module" can be the page's own global
        // (e.g. window.PageController) or an inline object exposing
        // sortTable().
        const _tileModules = {};

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

        // Build the SELECT fragment to splice into a per-tile query.
        // Returns a single space when no CFs are active so the existing
        // query is byte-identical to the pre-CF behaviour.
        function sqlSelectFor(tileKey, tableAlias, useMax) {
            const cfs = _activeFor(tileKey);
            if (cfs.length === 0) return ' ';
            const parts = cfs.map(function (cf) {
                const expr = "CustomFieldByName(" + tableAlias + ".customFields, '" + escSqlString(cf.name) + "')";
                const wrapped = useMax ? ("MAX(" + expr + ")") : expr;
                return "    " + wrapped + " AS cf_" + cf.id;
            });
            return ", " + parts.join(", ") + " ";
        }

        function extraColCount(tileKey) {
            return _activeFor(tileKey).length;
        }

        // Format a CF value for display. Date CFs use Common.formatDate so
        // they match the rest of the report's date columns. Checkbox CFs
        // render 'Yes' / 'No' so the dropdown filter can substring-match.
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

        // Append CF <th> headers + <td> filter cells to the existing
        // <thead> of the tile's table. Idempotent — strips prior CF cells
        // before re-adding. Wires the sort handler back through the host
        // module's sortTable() (registerTileModule must have been called).
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

        // Build a single CF cell for a key like 'cf_<id>'. Returns null if
        // the key isn't a CF key or the CF isn't currently active. Lets
        // hosts interleave CF cells with static cells inside one render
        // loop instead of appending CFs at the end via injectCells().
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

        // Format a raw CF value the same way injectCells would, so column
        // filters compare against the displayed string (e.g. Date CFs
        // match what moment.js rendered, not the raw SQL value).
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
    const Columns = (function () {
        const _manifests = {};

        function register(tileKey, manifest) {
            _manifests[String(tileKey).toUpperCase()] =
                (manifest || []).map(function (c) {
                    return { key: c.key, label: c.label || c.key, alwaysOn: !!c.alwaysOn };
                });
        }

        function manifest(tileKey) {
            return (_manifests[String(tileKey).toUpperCase()] || []).slice();
        }

        function hiddenSetFor(tileKey) {
            try {
                if (!Settings._initialised) return new Set();
                const cfg = Settings.resolve('hiddenStandardColumns') || {};
                const arr = cfg[String(tileKey).toUpperCase()] || [];
                return new Set(arr);
            } catch (_) { return new Set(); }
        }

        function isHidden(tileKey, key) {
            const m = manifest(tileKey).find(function (c) { return c.key === key; });
            if (m && m.alwaysOn) return false;
            return hiddenSetFor(tileKey).has(key);
        }

        // Filter a list of column keys, dropping any that are hidden.
        function visibleKeysFrom(tileKey, orderedKeys) {
            const hidden = hiddenSetFor(tileKey);
            const m = manifest(tileKey);
            const alwaysOn = new Set(m.filter(function (c) { return c.alwaysOn; }).map(function (c) { return c.key; }));
            return (orderedKeys || []).filter(function (k) {
                if (alwaysOn.has(k)) return true;
                return !hidden.has(k);
            });
        }

        // Walk the table's <thead> and hide any header / filter cells whose
        // data-column / data-filter key is currently hidden. Idempotent
        // (sets display:none on hidden cells; '' on visible cells). Pass
        // either the container element or the table itself.
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

        // Count of hidden static columns for this tile — used by render
        // loops to adjust empty-state colspan.
        function hiddenCount(tileKey) {
            const hidden = hiddenSetFor(tileKey);
            const m = manifest(tileKey);
            const alwaysOn = new Set(m.filter(function (c) { return c.alwaysOn; }).map(function (c) { return c.key; }));
            let n = 0;
            hidden.forEach(function (k) { if (!alwaysOn.has(k)) n += 1; });
            return n;
        }

        // Resolve the column order for a tile by merging the user's saved
        // order (Settings key `columnOrder.<TILE>`) with the live set of
        // valid keys (static manifest keys + 'cf_<id>' for each active CF).
        // Unknown keys in the saved order are dropped; new keys not yet in
        // the saved order are appended (statics in manifest order, then
        // CFs in catalog order). Pass `fallbackOrder` (a starting array)
        // for the case where nothing is saved yet.
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

        // opts: {
        //   tileKey:     'SO',
        //   label:       'Sales Orders',
        //   currentHiddenStatic: Set<string>,
        //   currentSelectedCfs:  Set<number>,
        //   onChange:    function()  // fired on each checkbox flip
        // }
        // Returns: { element, read() }
        //   element — the <div.ds-cf-mod> to appendChild into the host
        //   read()  — returns { tileKey, hiddenStatic: [...keys], selectedCfs: [...ids] }
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
    //   });
    //   table.render();                  // call after getRows() data changes
    //   table.setColumns(newColumns);    // replace columns + re-render
    //   table.getColumns();              // current column array (ordered + widths reflect drag state)
    //   table.sort('num', 'asc');        // programmatic sort
    //   table.getFilters();              // { colKey: filterValue }
    //   table.setFilter(colKey, value);  // programmatic filter
    //   table.clearFilters();
    // ====================================================================
    const Table = (function () {

        function _escHtml(s) {
            if (s == null) return '';
            return String(s).replace(/[&<>"']/g, function (c) {
                return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
            });
        }

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

            // Internal state.
            let columns = (opts.columns || []).map(_normCol);
            const getRows = opts.getRows;
            const chunkSize = opts.chunkSize || 200;
            const lazy = opts.lazy !== false;
            const onSort = typeof opts.onSort === 'function' ? opts.onSort : function () {};
            const onReorder = typeof opts.onReorder === 'function' ? opts.onReorder : function () {};
            const onResize = typeof opts.onResize === 'function' ? opts.onResize : function () {};
            const settingsKey = opts.settingsKey || null;

            let sortCol = null, sortDir = 'asc';
            const filters = {};
            let dragColKey = null;
            let _renderOffset = 0;
            let _visRows = [];

            // Restore persisted prefs (column order + widths + sort).
            _restoreFromSettings();

            function _normCol(c) {
                return Object.assign({
                    vis: true, sortable: true, filter: 'text', align: 'left'
                }, c);
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
                        columns.forEach(function (c) { if (hs.has(c.key)) c.vis = false; });
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
            function setColumns(newCols) { columns = (newCols || []).map(_normCol); _restoreFromSettings(); render(); }
            function getColumns() { return columns.slice(); }
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
                element: tableEl
            };
        }

        return { init: init };
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
    const Export = (function () {

        const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        // ─── DOWNLOAD ────────────────────────────────────────────────
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
        function slug(s, fallback) {
            const out = String(s == null ? '' : s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            return out || (fallback || 'export');
        }
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
        // Kept alongside the xlsx path: plenty of downstream systems still
        // want a plain delimited file, and it is the safe fallback if a
        // site's Excel is locked down.
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
            // Small utilities reports use when composing a filename.
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

        function attach(opts) {
            opts = opts || {};
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
        FilterViews: FilterViews
    };
})();
