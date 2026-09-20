/* ===========================================================================
   FB Report Host — the Fishbowl JS bridge, reproduced outside the client.

   Injected with AddScriptToExecuteOnDocumentCreatedAsync, so every global
   below exists BEFORE the report's own <script> runs. That matters: almost
   every report opens with a runtime guard that rewrites document.body when
   runQuery is missing, and a guard that fires first can never be un-fired.

   SYNC vs ASYNC. runQuery is synchronous in Fishbowl (238 call sites in this
   repo depend on it), so it goes through chrome.webview.hostObjects.sync —
   the one WebView2 path that blocks JS until the host answers. Everything
   that is async in Fishbowl uses the promise proxy instead, so a slow query
   does not freeze the window.
   =========================================================================== */
(function () {
    'use strict';

    if (!window.chrome || !window.chrome.webview || !window.chrome.webview.hostObjects) {
        console.error('[fb-host] host objects unavailable — the bridge did not load.');
        return;
    }

    var SYNC = window.chrome.webview.hostObjects.sync.fb;   // blocking
    var ASYNC = window.chrome.webview.hostObjects.fb;       // promise-returning

    function parse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

    // A host COMException carries the JSON error body in its message, so the
    // rejection a report sees keeps the {status, message} shape it expects
    // from runRestApiAsync rather than degrading to "[object Object]".
    function restError(e) {
        var raw = (e && (e.message || e.toString())) || '';
        var m = raw.match(/\{[\s\S]*\}/);
        var o = m ? parse(m[0]) : null;
        if (o && (o.status || o.message)) return o;
        return { status: 0, message: raw || 'REST call failed' };
    }

    /* ── QUERY ─────────────────────────────────────────────────────── */

    // Returns a JSON STRING, like Fishbowl. Reports JSON.parse() the result.
    window.runQuery = function (sql /*, showErrors */) {
        return SYNC.RunQuery(String(sql));
    };

    // Returns already-parsed rows, like Fishbowl — do NOT JSON.parse this.
    window.runQueryAsync = function (sql) {
        return ASYNC.RunQueryAsync(String(sql)).then(function (txt) {
            var r = parse(txt);
            return Array.isArray(r) ? r : (r ? [r] : []);
        });
    };

    /* ── REST ──────────────────────────────────────────────────────── */

    window.runRestApiAsync = function (request) {
        if (!request || !request.path) {
            return Promise.reject(new Error(
                'runRestApiAsync({path, method, queryParameters, body, contentType}) — `path` is required.'));
        }
        return ASYNC.RunRest(JSON.stringify(request)).then(
            function (txt) {
                if (txt === '' || txt == null) return null;
                var o = parse(txt);
                return o === null ? txt : o;      // raw string when not JSON, as Fishbowl does
            },
            function (e) { return Promise.reject(restError(e)); }
        );
    };

    /* ── LEGACY SOCKET ─────────────────────────────────────────────── */

    // Synchronous, matching the client. This is the call a browser-only
    // harness cannot make at all — no raw sockets from page JS.
    window.runApiRequest = function (requestType, payloadJson) {
        return SYNC.RunApiRequest(String(requestType), String(payloadJson == null ? '{}' : payloadJson));
    };

    /* ── USER / ENVIRONMENT ────────────────────────────────────────── */

    window.getUser = function () { return SYNC.GetUser(); };
    window.hasUserAccess = function (right) { return !!SYNC.HasUserAccess(String(right)); };
    window.getLocationGroupList = function () { return parse(SYNC.GetLocationGroupList()) || []; };
    window.getProperty = function (name, dflt) {
        return SYNC.GetProperty(String(name), dflt == null ? '' : String(dflt));
    };
    window.currencyLocale = function () {
        return parse(SYNC.CurrencyLocale()) || { locale: 'en-AU', symbol: '$' };
    };
    window.getCompanyAddress = function (lgId, showCountry) {
        return SYNC.GetCompanyAddress(parseInt(lgId, 10) || 0, !!showCountry);
    };

    /* ── NAVIGATION ────────────────────────────────────────────────── */

    // There is no way to drive the desktop client's navigation from outside
    // it. The call is logged and shown as a toast so a click is visibly
    // registered rather than appearing to do nothing.
    window.openModule = function (moduleName, item) {
        SYNC.OpenModule(String(moduleName || ''), String(item == null ? '' : item));
    };

    /* ── SETTINGS ──────────────────────────────────────────────────── */

    window.loadSettings = function (key) { return SYNC.LoadSettings(String(key)); };
    window.saveSettings = function (key, value) { SYNC.SaveSettings(String(key), String(value == null ? '' : value)); };
    window.loadReportData = function () { return SYNC.LoadReportData(); };
    window.saveReportData = function (value) { SYNC.SaveReportData(String(value == null ? '' : value)); };

    /* ── MONEY HELPERS ─────────────────────────────────────────────── */

    // formatCurrency takes a Java DecimalFormat string; only the common
    // grouping/decimal shapes are honoured, which covers every use in this
    // repo. roundMoney is half-up to 2dp, matching Fishbowl's money rounding.
    window.formatCurrency = function (currencyId, amount, decimalFormat) {
        var n = parseFloat(amount) || 0;
        var dp = 2;
        var m = String(decimalFormat || '').match(/\.(0+)/);
        if (m) dp = m[1].length;
        var c = window.currencyLocale();
        return (n < 0 ? '-' : '') + c.symbol + Math.abs(n).toLocaleString(c.locale, {
            minimumFractionDigits: dp, maximumFractionDigits: dp
        });
    };
    window.roundMoney = function (value /*, isTotal */) {
        var n = parseFloat(value) || 0;
        return Math.round((n + Number.EPSILON) * 100) / 100;
    };

    /* ── NOT AVAILABLE OUTSIDE THE CLIENT ──────────────────────────── */

    // These run Fishbowl's own engines or read server-local files. Throwing
    // with the reason beats returning an empty array, which would read as a
    // legitimate "nothing found".
    ['getAutoPo', 'getAutoMo', 'getIcon', 'getImageFile', 'getAllTrackingInfo',
     'getParentName', 'getHighValueReport', 'runPickStatusHelper'].forEach(function (fn) {
        window[fn] = function () { return SYNC.Unsupported(fn); };
    });

    console.log('[fb-host] Fishbowl bridge ready.');
})();
