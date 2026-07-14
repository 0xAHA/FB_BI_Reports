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
        function openDrawer(id) {
            // Close every other registered drawer first — only one open at a time.
            Object.keys(_drawers).forEach(function (other) {
                if (other !== id) closeDrawer(other);
            });
            const cfg = _drawers[id];
            try { if (cfg && cfg.onBeforeOpen) cfg.onBeforeOpen(); } catch (_) {}
            const el = document.getElementById(id);
            if (el) el.classList.add('open');
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
                return items.filter(function (o) { return String(o.label).toLowerCase().indexOf(f) !== -1; });
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
                    const sp = document.createElement('span');
                    sp.textContent = o.label;
                    row.appendChild(cb);
                    row.appendChild(sp);
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
                    const lbl = document.createElement('span'); lbl.textContent = item ? item.label : v;
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
            if (allEl) allEl.addEventListener('click', function () {
                items.forEach(function (o) { selected.add(String(o.value)); });
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
    // FBLib.Settings — layered preference resolver
    //   1. per-user payload   (loadSettings / saveSettings)
    //   2. admin master       (loadReportData / saveReportData)
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
        // Admin "master" layer is backed by Fishbowl's loadReportData/saveReportData,
        // which only work on a SAVED report. Pages that run WITHOUT a saved-report
        // context (embedded/opened with no report ID, or an editor preview) make the
        // client throw a native "Loading data is only available on reports" dialog on
        // the very first read — the try/catch below swallows the JS return but cannot
        // suppress the native modal. Such pages pass `useReportDataMaster: false` to
        // skip that layer entirely (per-user loadSettings/saveSettings are unaffected —
        // they are account-scoped, not report-scoped, so they never trigger it).
        let _useReportDataMaster = true;

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
        function _readMaster() {
            if (_useReportDataMaster && typeof loadReportData === 'function') {
                try { return loadReportData(); } catch (_) { return null; }
            }
            try { return localStorage.getItem(_masterKey); } catch (_) { return null; }
        }
        function _writeMaster(value) {
            if (_useReportDataMaster && typeof saveReportData === 'function') {
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
            _userKey   = config.userKey   || 'cdx.bi.report.user.v1';
            _masterKey = config.masterKey || 'cdx.bi.report.master.v1';
            _defaults  = config.defaults  || {};
            _propFallback = config.propFallback || {};
            _defaultTileOrder = (config.defaultTileOrder || []).slice();
            _tileToTable = Object.assign({}, config.tileToTable || {});
            // Default ON (every saved report keeps the admin-master layer). Pages with
            // no saved-report context pass useReportDataMaster:false to skip it.
            _useReportDataMaster = (config.useReportDataMaster !== false);

            USER   = _loadJson(_readSettings(_userKey))   || {};
            MASTER = _loadJson(_readMaster())             || {};

            _isAdmin = false;
            try {
                if (typeof getUser === 'function') {
                    const u = JSON.parse(getUser() || '{}');
                    _isAdmin = (u && u.userName === 'admin') ||
                        (typeof hasUserAccess === 'function' && hasUserAccess('Admin'));
                }
            } catch (_) { _isAdmin = false; }

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

    return {
        Common: Common,
        Settings: Settings,
        CfCatalog: CfCatalog,
        CfCols: CfCols,
        Columns: Columns,
        Picker: Picker,
        Table: Table
    };
})();
