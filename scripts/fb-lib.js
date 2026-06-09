window.FBLib = (function () {
    'use strict';

    // ====================================================================
    // FBLib.Common — date / debug / status indicators
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
        // after this module loads, so we expose it as a getter. While
        // Settings hasn't been initialised, we fall back to the
        // BI_SHOW_DEBUG property (matches the old DashboardCommon).
        function _debugMode() {
            try {
                if (FBLib.Settings && FBLib.Settings._initialised) {
                    return !!FBLib.Settings.resolve('debug');
                }
            } catch (_) {}
            const raw = (typeof getProperty === 'function')
                ? getProperty('BI_SHOW_DEBUG', 'false') : 'false';
            return raw === 'true' || raw === true;
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
            const colors = { blue: '#2d9cdb', orange: '#f59e0b', red: '#ef4444' };
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
                svg.style.color = '#f59e0b';
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

        return {
            FB_DATE_FORMAT: FB_DATE_FORMAT,
            MOMENT_DATE_FORMAT: MOMENT_DATE_FORMAT,
            get DEBUG_MODE() { return _debugMode(); },
            formatDate: formatDate,
            getScheduleStatus: getScheduleStatus,
            getStatusTitle: getStatusTitle,
            createScheduleIndicator: createScheduleIndicator,
            createAvailabilityIndicator: createAvailabilityIndicator,
            debugLog: debugLog,
            clearDebugLog: clearDebugLog
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
            if (typeof loadReportData === 'function') {
                try { return loadReportData(); } catch (_) { return null; }
            }
            try { return localStorage.getItem(_masterKey); } catch (_) { return null; }
        }
        function _writeMaster(value) {
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
            _userKey   = config.userKey   || 'cdx.bi.report.user.v1';
            _masterKey = config.masterKey || 'cdx.bi.report.master.v1';
            _defaults  = config.defaults  || {};
            _propFallback = config.propFallback || {};
            _defaultTileOrder = (config.defaultTileOrder || []).slice();
            _tileToTable = Object.assign({}, config.tileToTable || {});

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

    return {
        Common: Common,
        Settings: Settings,
        CfCatalog: CfCatalog,
        CfCols: CfCols,
        Columns: Columns,
        Picker: Picker
    };
})();
