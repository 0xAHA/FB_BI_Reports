@echo off
REM ============================================================================
REM  QuickOrder-Preview.bat  --  open a BI report in a normal browser
REM                              instead of the Fishbowl client.
REM
REM  SELF-CONTAINED. This one file is the whole tool: the Node server is
REM  carried as a payload at the bottom and extracted to %TEMP% at run time.
REM  Nothing else needs to sit beside it.
REM
REM  SELF-LOCATING. Drop it anywhere and double-click:
REM    * Beside .htm reports -> serves THAT folder. Opens QuickOrder.htm if
REM      present, else the only report there, else a pick-list.
REM    * Somewhere with no reports -> serves the folder anyway and lists it.
REM
REM  Usage:
REM     QuickOrder-Preview.bat                  auto-pick as described above
REM     QuickOrder-Preview.bat Other.htm        open a specific report
REM
REM  Optional environment overrides:
REM     set FB_PORT=8731                   port this preview server listens on
REM     set FB_URL=http://localhost:2456   Fishbowl REST server to proxy to
REM     set FB_READONLY=1                  refuse to forward POST/PUT/DELETE
REM
REM  Requires Node.js on PATH. The .htm is never modified.
REM
REM  WHY A SERVER AND NOT JUST file:// -- Fishbowl's REST API accepts
REM  SAME-ORIGIN requests only; a file:// page sends "Origin: null" and is
REM  refused, so it would render but never load data. Serving the page here
REM  and proxying /api/* through the same port puts both on one origin, so
REM  the browser never runs a CORS check.
REM ============================================================================

setlocal enabledelayedexpansion

if "%FB_PORT%"=="" set "FB_PORT=8731"

REM ══════════════════════════════════════════════════════════════════
REM  >>> THE ONLY LINE YOU NORMALLY EDIT <<<
REM
REM  Which Fishbowl server to talk to. No prompt -- change it here.
REM      hosted :  https://fb1007837.myfishbowl.com
REM      local  :  http://localhost:2456
REM
REM  Prefer https:// for anything not on this machine: the login sends your
REM  Fishbowl password, and over plain http it crosses the network readable.
REM ══════════════════════════════════════════════════════════════════
if "%FB_URL%"=="" set "FB_URL=https://fb1007837.myfishbowl.com"

REM Setting FB_URL in the environment before launching overrides the line above,
REM which is handy for a desktop shortcut that points at a different server.
REM
REM Any reachable server works. The browser only ever talks to localhost; only
REM THIS process talks to Fishbowl, and server-to-server calls are not subject
REM to CORS. That is what makes a hosted server usable from a browser at all --
REM verified: a hosted Fishbowl sends no Access-Control-Allow-* headers and
REM 403s every origin but its own, so fetching it directly can never work.

REM Reject anything that is not an http(s) URL -- a bare hostname would be
REM parsed as a relative path and fail confusingly much later.
echo %FB_URL% | findstr /i /r /c:"^https*://" >nul
if errorlevel 1 (
    echo.
    echo   "%FB_URL%" is not a URL. Include the scheme, e.g. https://host or
    echo   http://localhost:2456
    echo.
    pause
    exit /b 1
)

set "EXTRA="
if not "%FB_READONLY%"=="" set "EXTRA=--readonly"
if not "%FB_INSECURE%"=="" set "EXTRA=%EXTRA% --insecure"
if not "%FB_TLS13%"==""    set "EXTRA=%EXTRA% --tls13"

REM Folder holding this .bat, without the trailing backslash.
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

REM ── Node present? ──────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js was not found on PATH.
    echo   Install it from https://nodejs.org and reopen this window.
    echo.
    pause
    exit /b 1
)

REM ── Extract the embedded server to %TEMP% ──────────────────────────
REM The payload is plain text after the marker line and is never parsed by
REM cmd -- execution stops at "exit /b" well above it -- so it needs no
REM escaping. The marker is built by concatenation below so the only literal
REM copy in this file is the real one at the bottom.
REM SELF must be exported for PowerShell to read this file back -- %~f0 is not
REM visible to a child process on its own.
set "SELF=%~f0"
set "SERVE=%TEMP%\fb-preview-serve.js"
powershell -NoProfile -Command "$s=[IO.File]::ReadAllText($env:SELF); $m='//__FBPRE'+'VIEW_JS__'; $i=$s.IndexOf($m); if($i -lt 0){exit 1}; [IO.File]::WriteAllText($env:SERVE, $s.Substring($i+$m.Length))" 2>nul
if errorlevel 1 goto :extractfail
if not exist "%SERVE%" goto :extractfail

REM ── Decide what to serve and what to open ──────────────────────────
set "REPORT=%~1"
if defined REPORT set "REPORT=!REPORT:\=/!"
set "ROOT=%HERE%"

if not defined REPORT (
    set "COUNT=0"
    set "FIRST="
    for %%F in ("%HERE%\*.htm" "%HERE%\*.html") do (
        set /a COUNT+=1
        if not defined FIRST set "FIRST=%%~nxF"
    )
    if exist "%HERE%\QuickOrder.htm" (
        set "REPORT=QuickOrder.htm"
    ) else (
        if !COUNT! EQU 1 set "REPORT=!FIRST!"
    )
)

echo.
echo   Serving : !ROOT!
if defined REPORT (echo   Opening : !REPORT!) else (echo   Opening : folder list)
echo   Port    : %FB_PORT%
echo   API     : %FB_URL%
if defined EXTRA echo   Mode    : READ-ONLY

REM The SERVER opens the browser, not this script. Guessing "it'll be up in two
REM seconds" raced the startup, and worse, if the port was already taken by a
REM stale server the browser was pointed at THAT one -- which looks exactly like
REM this tool serving the wrong folder. The server opens the browser only once
REM it is actually listening, and only on the port it actually got.
node "%SERVE%" --root "!ROOT!" --port %FB_PORT% --fb %FB_URL% --open "!REPORT!" %EXTRA%

del "%SERVE%" >nul 2>&1
echo.
echo   Preview server stopped.
pause
endlocal
exit /b 0

:extractfail
echo.
echo   Could not extract the embedded server to:
echo       %SERVE%
echo   PowerShell must be available and %%TEMP%% writable.
echo.
echo   Re-running the extraction with errors shown:
echo   ------------------------------------------------
powershell -NoProfile -Command "$s=[IO.File]::ReadAllText($env:SELF); $m='//__FBPRE'+'VIEW_JS__'; $i=$s.IndexOf($m); if($i -lt 0){throw 'marker not found in ' + $env:SELF}; [IO.File]::WriteAllText($env:SERVE, $s.Substring($i+$m.Length))"
echo   ------------------------------------------------
echo.
pause
endlocal
exit /b 1

//__FBPREVIEW_JS__
/*
 * Local browser preview harness for BI reports.
 * Embedded payload of QuickOrder-Preview.bat -- extracted to %TEMP% at run time.
 * Node built-ins only, no npm install.
 *
 *   node serve.js [--root <dir>] [--port 8731] [--fb http://localhost:2456] [--readonly]
 *
 * Fishbowl's Jetty accepts SAME-ORIGIN CORS requests only. Measured against a
 * live server:
 *     Origin: http://localhost:2456   -> 200
 *     Origin: http://localhost:3000   -> 403 "Invalid CORS request"
 *     Origin: null (a file:// page)   -> 403 "Invalid CORS request"
 * Serving the page here and proxying the API through the same port puts both
 * on ONE origin, so the browser never runs a CORS check at all. Same shape as
 * the Cloudflare Pages Function behind QuickOrder's 'portal' mode, but local.
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const spawn = require('child_process').spawn;
// No require('url') -- the legacy url.parse() prints a CVE-flavoured
// DeprecationWarning on every launch. The WHATWG URL global is standard,
// warning-free, and does everything needed here.

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : fallback;
}
const PORT     = parseInt(arg('port', '8731'), 10);
const FB_URL   = arg('fb', 'http://localhost:2456').replace(/\/$/, '');
const READONLY = process.argv.includes('--readonly');
const OPEN     = arg('open', '');            // '' = open the folder listing
// The launcher always passes --root. cwd is the fallback because this file
// runs from %TEMP%, so __dirname would be meaningless here.
const ROOT     = path.resolve(arg('root', process.cwd()));
const FB       = new URL(FB_URL);

// A hosted Fishbowl is reached over TLS, so the upstream client is chosen from
// the scheme. This used to be hardcoded to http, which silently failed against
// any https:// server.
const IS_TLS    = FB.protocol === 'https:';
const FB_CLIENT = IS_TLS ? https : http;
const FB_PORT_N = FB.port || (IS_TLS ? 443 : 80);
// Escape hatch for a Fishbowl behind a self-signed certificate. Off by default:
// silently trusting any certificate on a public network is how a proxied login
// gets intercepted.
const INSECURE  = process.argv.includes('--insecure');
const TLS13     = process.argv.includes('--tls13');

// One connection per request. Node's default agent has kept sockets alive since
// v19, and a pooled TLS socket that the far end has already dropped resurfaces
// as an intermittent "packet length too long" EPROTO on the NEXT request --
// observed against a hosted Fishbowl, where roughly every second call failed
// while the one before it succeeded. A preview harness does single-digit
// requests per page; a fresh handshake each time costs nothing and removes a
// failure mode that looks exactly like a flaky server.
const FB_AGENT = new FB_CLIENT.Agent({ keepAlive: false });

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(FB.hostname);

if (!fs.existsSync(ROOT)) {
    console.error('\n  Root folder does not exist: ' + ROOT + '\n');
    process.exit(1);
}

const MIME = {
    '.htm': 'text/html; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8'
};

// A report in standalone mode defaults its server URL to the Fishbowl port
// directly, which the browser can never reach for the CORS reason above. Point
// it at THIS origin instead. Injected into the response rather than edited into
// the file, so the .htm on disk stays byte-identical to what gets pasted into
// Fishbowl. A URL the user typed is left alone unless it names the Fishbowl
// port -- the one value that is always wrong in a browser.
// Injected into every served page, ahead of the report's own scripts.
//
// The page must aim its API calls at THIS origin, never at Fishbowl directly --
// a direct call is cross-origin and Fishbowl refuses it, which surfaces as
// "Failed to fetch ... CORS rejected the preflight". Three defences, because
// the report reads its server URL straight out of the Connect modal's input
// field (submitLogin), so simply seeding stored settings is not enough: anything
// typed into that box wins.
//
//   1. force the stored baseUrl to this origin
//   2. rewrite any absolute /api/ fetch aimed elsewhere back to this origin --
//      this is what makes a typed-in address harmless
//   3. make the Server URL field read-only and say why
const SEED = `<script>
/* ── local preview harness ───────────────────────────────────────────
   Injected ahead of the report's own scripts. Four jobs:

     1. point the stored connection at THIS origin
     2. validate a resumed session BEFORE the report initialises
     3. redirect any absolute /api/ fetch back to this origin
     4. simplify the Connect dialog and give it a real logout

   The report reads its server URL straight out of the Connect modal's
   input field (submitLogin), so seeding stored settings alone is not
   enough — anything typed into that box wins. Hence 3 and 4.
   ─────────────────────────────────────────────────────────────────── */
(function () {
    var K        = 'cdx.bi.fbconn.v1';
    var ORIGIN   = location.origin;
    var UPSTREAM = ${JSON.stringify(FB_URL)};

    /* ── 0. Refuse to run anywhere but the harness ───────────────────
       This block is injected into the HTTP RESPONSE by the local preview
       server; the .htm on disk never contains it, so Fishbowl and the
       Cloudflare portal are untouched by construction. This guard is the
       belt to that braces: if a copy of a served page ever escaped — saved
       out of the browser, pasted into the BI editor, deployed to Pages —
       it must do nothing rather than hijack fetch or rewrite settings.

       Inside Fishbowl the report runs from a data: URL, whose origin is
       "null"; on the portal the origin is the Pages domain. Neither is
       loopback, so both no-op here. */
    var LOOPBACK = /^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?$/i;
    if (!LOOPBACK.test(String(ORIGIN))) {
        console.info('[local-preview] origin ' + ORIGIN + ' is not loopback — harness inert');
        return;
    }

    function read()  { try { return JSON.parse(localStorage.getItem(K) || '{}'); } catch (e) { return {}; } }
    function write(c){ try { localStorage.setItem(K, JSON.stringify(c)); } catch (e) {} }

    var conn = read();
    conn.baseUrl = ORIGIN;

    /* ── 2. Session resume ───────────────────────────────────────────
       Runs SYNCHRONOUSLY, in <head>, before the report's own script is
       parsed. That ordering is the point: the report decides whether to
       show the login dialog by looking for a cached token, so the token
       has to be either proven good or removed by the time it looks.
       Doing this asynchronously would let it start querying with a dead
       token and surface a wall of errors instead of a login prompt.

       An unreachable server must NOT log the user out. Closing a laptop
       or moving between networks looks identical to a dead session from
       the client side, and destroying a still-valid session because the
       wifi blipped is far worse than briefly keeping a stale one — a
       stale token just prompts on its next real call. So only an
       explicit 401/403 clears it. */
    if (conn.token) {
        var verdict;
        try {
            var x = new XMLHttpRequest();
            x.open('GET', ORIGIN + '/api/data-query?query=' + encodeURIComponent('SELECT 1'), false);
            x.setRequestHeader('Authorization', 'Bearer ' + conn.token);
            x.send(null);
            if (x.status === 401 || x.status === 403) {
                delete conn.token;
                verdict = 'expired on the server — login required';
            } else if (x.status >= 200 && x.status < 300) {
                verdict = 'resumed';
            } else {
                verdict = 'inconclusive (HTTP ' + x.status + ') — token kept';
            }
        } catch (e) {
            verdict = 'server unreachable — token kept (offline?)';
        }
        console.info('[local-preview] session ' + verdict);
    }
    write(conn);

    /* ── 3. Redirect stray API calls ─────────────────────────────────
       Scoped to /api/ only; rewriting every cross-origin request would
       break legitimate outbound calls (map tiles, fonts). */
    var of = window.fetch;
    window.fetch = function (input, init) {
        try {
            var u = (typeof input === 'string') ? input : (input && input.url);
            if (u && /^https?:\\/\\//i.test(u)) {
                var p = new URL(u);
                if (p.host !== location.host && p.pathname.indexOf('/api/') === 0) {
                    var fixed = ORIGIN + p.pathname + p.search;
                    console.info('[local-preview] redirected ' + u + ' -> ' + fixed);
                    input = (typeof input === 'string') ? fixed : new Request(fixed, input);
                }
            }
        } catch (e) {}
        return of.call(this, input, init);
    };

    /* ── 4. Dialog: hide plumbing, add a real logout ───────────────── */
    function hideRow(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var row = el.closest ? el.closest('.modal-row') : null;
        (row || el).style.display = 'none';
    }

    // The report's own logout only nulls the token locally — it never calls
    // the server, so the Fishbowl session lives on until it times out.
    // Wrap it so the session is actually surrendered.
    function installLogout() {
        if (window.__lpLogoutWrapped) return;
        var orig = window.disconnectStandalone;
        if (typeof orig !== 'function') return;
        window.__lpLogoutWrapped = true;
        window.disconnectStandalone = function () {
            var c = read();
            if (c.token) {
                try {
                    // Synchronous on purpose: this fires from a click that
                    // immediately tears the dialog down, and an async call can
                    // be abandoned before it leaves the browser.
                    var x = new XMLHttpRequest();
                    x.open('POST', ORIGIN + '/api/logout', false);
                    x.setRequestHeader('Authorization', 'Bearer ' + c.token);
                    x.send(null);
                    console.info('[local-preview] server logout -> HTTP ' + x.status);
                } catch (e) {
                    console.warn('[local-preview] logout call failed', e);
                }
            }
            delete c.token;
            c.baseUrl = ORIGIN;
            write(c);
            try { orig(); } catch (e) {}
            if (typeof window.openConnModal === 'function') window.openConnModal();
        };
    }

    function tidyDialog() {
        // Server URL, App Name and App ID are all fixed by the harness.
        hideRow('qoConnBaseUrl');
        hideRow('qoConnAppName');
        hideRow('qoConnAppId');

        var url = document.getElementById('qoConnBaseUrl');
        if (url) url.value = ORIGIN;

        var sub = document.querySelector('#qoLoginModal .modal-sub');
        if (sub) {
            sub.textContent = 'Sign in with your Fishbowl username and password. '
                            + 'Connecting to ' + UPSTREAM + ' through the local preview harness.';
        }

        var btn = document.getElementById('qoConnDisconnect');
        if (btn) {
            btn.textContent = 'Log out';
            btn.title = 'Ends the session on the Fishbowl server, not just in this browser.';
            btn.style.display = read().token ? '' : 'none';
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        installLogout();
        tidyDialog();
        // openConnModal repopulates the fields every time it runs, so re-apply
        // afterwards rather than only once at startup.
        var origOpen = window.openConnModal;
        if (typeof origOpen === 'function' && !window.__lpOpenWrapped) {
            window.__lpOpenWrapped = true;
            window.openConnModal = function () {
                var r = origOpen.apply(this, arguments);
                tidyDialog();
                return r;
            };
        }
    });

    console.info('[local-preview] API proxied to ' + UPSTREAM + ' via ' + ORIGIN + '/api/*');
})();
</script>
`;

const t = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log('[' + t() + ']', ...a);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── API reverse proxy ────────────────────────────────────────────────
function proxy(req, res) {
    if (READONLY && req.method !== 'GET' && req.method !== 'OPTIONS') {
        log('BLOCKED', req.method, req.url.split('?')[0], '(--readonly)');
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            title: 'Blocked by local preview harness',
            detail: 'Started with --readonly, so ' + req.method + ' requests are not forwarded.'
        }));
        return;
    }

    // Drop the headers that describe the OLD hop. host must match the upstream
    // or Jetty vhost-routes wrongly; origin/referer would re-trigger the very
    // CORS filter this proxy exists to sidestep.
    const headers = Object.assign({}, req.headers);
    delete headers.host; delete headers.origin; delete headers.referer;
    delete headers.connection; delete headers['accept-encoding'];

    const started = Date.now();
    const opts = {
        protocol: FB.protocol,
        hostname: FB.hostname,
        port: FB_PORT_N,
        method: req.method,
        path: req.url,
        headers: headers
    };
    opts.agent = FB_AGENT;
    if (IS_TLS) {
        opts.servername = FB.hostname;             // SNI -- shared hosts need it
        if (INSECURE) opts.rejectUnauthorized = false;
        // Cap at TLS 1.2 unless asked otherwise. Measured against a hosted
        // Fishbowl, 6 identical requests each way:
        //     TLS 1.3 (Node default) -> 2/6 succeeded, rest died mid-write with
        //                               EPROTO "packet length too long"
        //     TLS 1.2 pinned         -> 6/6 succeeded
        // Reproduced with a bare https.request outside this proxy, so it is the
        // far end's 1.3 stack, not anything here. 1.2 with a verified
        // certificate is still fully encrypted; FB_TLS13=1 opts back in.
        if (!TLS13) opts.maxVersion = 'TLSv1.2';
    }
    const up = FB_CLIENT.request(opts, upRes => {
        log(req.method, req.url.split('?')[0], '->', upRes.statusCode, (Date.now() - started) + 'ms');
        const out = Object.assign({}, upRes.headers);
        delete out['transfer-encoding'];
        res.writeHead(upRes.statusCode, out);
        upRes.pipe(res);
    });

    up.on('error', e => {
        log('PROXY ERROR', req.method, req.url.split('?')[0], '-', e.message);
        // A certificate failure is a completely different fix from "server is
        // down", so name it rather than reporting both as unreachable.
        const certIssue = /certificate|CERT_|self.signed|ERR_TLS/i.test(e.message || '')
                       || /^(UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/.test(e.code || '');
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            title: certIssue ? 'TLS certificate rejected' : 'Cannot reach Fishbowl',
            detail: certIssue
                ? 'The certificate presented by ' + FB.hostname + ' was not trusted ('
                  + e.message + '). If this server uses a self-signed certificate, '
                  + 'relaunch with FB_INSECURE=1 — but only on a network you trust.'
                : 'Could not connect to ' + FB_URL + ' (' + e.message + '). '
                  + 'Check the server address, that Fishbowl is running, and that '
                  + 'REST is enabled.'
        }));
    });

    req.pipe(up);
}

// ── Directory index ──────────────────────────────────────────────────
// Reached when the URL is a folder, including '/' when there is no single
// obvious report. Lists reports rather than 404ing.
function sendIndex(res, dirAbs, dirUrl) {
    let entries = [];
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); }
    catch (_) { res.writeHead(500).end('Cannot read folder'); return; }

    const reports = entries.filter(e => e.isFile() && /\.html?$/i.test(e.name))
                           .map(e => e.name).sort();
    const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')
                                        && e.name !== 'node_modules')
                           .map(e => e.name).sort();

    const base = dirUrl.endsWith('/') ? dirUrl : dirUrl + '/';
    const li = (href, label, cls) =>
        '<li class="' + cls + '"><a href="' + esc(base + encodeURIComponent(href)) + '">'
        + esc(label) + '</a></li>';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><meta charset="utf-8"><title>BI report preview</title>'
        + '<style>'
        + 'body{font:14px/1.5 system-ui,Segoe UI,sans-serif;margin:40px auto;max-width:640px;color:#0f172a}'
        + 'h1{font-size:17px;margin:0 0 2px}'
        + 'p.sub{color:#64748b;font-size:12px;margin:0 0 20px}'
        + 'code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:12px}'
        + 'ul{list-style:none;padding:0;margin:0}'
        + 'li{border-bottom:1px solid #e2e8f0}'
        + 'li a{display:block;padding:9px 4px;text-decoration:none;color:#2d9cdb}'
        + 'li a:hover{background:#f8fafc}'
        + 'li.dir a{color:#475569}'
        + '</style>'
        + '<h1>BI report preview</h1>'
        + '<p class="sub">Serving <code>' + esc(dirAbs) + '</code> &middot; API &rarr; <code>'
        + esc(FB_URL) + '</code>' + (READONLY ? ' <b>[read-only]</b>' : '') + '</p>'
        + (reports.length
            ? '<ul>' + reports.map(f => li(f, f, 'rpt')).join('') + '</ul>'
            : '<p>No <code>.htm</code> files in this folder.</p>')
        + (folders.length ? '<ul>' + folders.map(d => li(d + '/', d, 'dir')).join('') + '</ul>' : ''));
}

// ── Static files ─────────────────────────────────────────────────────
function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); }
    catch (_) { res.writeHead(400).end('Bad path'); return; }

    const file = path.resolve(ROOT, '.' + rel);
    // Containment -- a crafted ../ must not escape the served folder.
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.stat(file, (err, st) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>404 &mdash; not found</h2><p style="font-family:sans-serif">'
                  + 'No file at <code>' + esc(rel) + '</code> under<br><code>'
                  + esc(ROOT) + '</code></p>');
            return;
        }
        if (st.isDirectory()) { sendIndex(res, file, pathname); return; }

        const ext = path.extname(file).toLowerCase();
        const head = {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-store'          // the point is to see the edit you just made
        };

        if (ext === '.htm' || ext === '.html') {
            fs.readFile(file, 'utf8', (e, html) => {
                if (e) { res.writeHead(500).end('Read error'); return; }
                const out = html.includes('<head>')
                    ? html.replace('<head>', '<head>\n' + SEED)
                    : SEED + html;
                head['Content-Length'] = Buffer.byteLength(out);
                res.writeHead(200, head);
                res.end(out);
            });
            return;
        }

        head['Content-Length'] = st.size;
        res.writeHead(200, head);
        fs.createReadStream(file).pipe(res);
    });
}

// ── Server ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    // Base is a throwaway -- req.url is path-only, and WHATWG URL requires one.
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname || '/'; }
    catch (_) { res.writeHead(400).end('Bad request URL'); return; }
    if (pathname.startsWith('/api/')) { proxy(req, res); return; }
    serveStatic(req, res, pathname);
});

// Bind with fallback. A port left occupied by an earlier preview window used to
// be fatal, and because the launcher opened the browser on a timer the browser
// still landed on the OLD server -- which serves a different folder and 404s in
// a way that looks like this tool is broken. Stepping to the next free port and
// opening the browser only on the port we actually got removes that whole class
// of confusion.
const MAX_PORT_TRIES = 10;

// ONE 'listening' handler, registered once, reading the port actually bound.
// Passing a callback to server.listen() instead registers it on 'listening'
// permanently -- a failed attempt's callback survives the retry and fires on
// the eventual success too, announcing a port the server is not on.
server.on('listening', () => {
    // Retire the retry handler now that we are bound, so a later socket error
    // cannot re-enter the retry loop.
    server.removeAllListeners('error');
    server.on('error', e => console.error('  Server error: ' + e.message));
    ready(server.address().port);
});

function listenFrom(port, triesLeft) {
    server.once('error', e => {
        if (e.code === 'EADDRINUSE' && triesLeft > 0) {
            console.log('  Port ' + port + ' is busy (another preview window?) — trying '
                      + (port + 1) + '…');
            listenFrom(port + 1, triesLeft - 1);
            return;
        }
        console.error('\n  ' + (e.code === 'EADDRINUSE'
            ? 'Ports ' + PORT + '-' + (PORT + MAX_PORT_TRIES) + ' are all in use.'
            : 'Server error: ' + e.message) + '\n');
        process.exit(1);
    });
    // 127.0.0.1, never 0.0.0.0 -- this proxy forwards an authenticated Fishbowl
    // session and must not be reachable from the network.
    server.listen(port, '127.0.0.1');
}

function ready(port) {
    const target = 'http://localhost:' + port + '/' + encodeURI(OPEN);
    console.log('');
    console.log('  Local BI report preview');
    console.log('  ------------------------------------------------');
    console.log('  Serving   ' + ROOT);
    console.log('  Browse    ' + target);
    console.log('  API       /api/*  ->  ' + FB_URL + (READONLY ? '   [READ-ONLY]' : ''));
    console.log('  ------------------------------------------------');
    console.log('  Writes ARE forwarded to the database above.'
              + (READONLY ? ' (blocked: --readonly)' : ' Set FB_READONLY=1 to block them.'));
    // Cleartext to a remote host means the Fishbowl password crosses the
    // network in the clear on every login. Loopback http is fine; this is not.
    if (!LOCAL_HOST && !IS_TLS) {
        console.log('');
        console.log('  *** WARNING: ' + FB.hostname + ' is remote and this is plain http. Your');
        console.log('      Fishbowl username and password will cross the network unencrypted.');
        console.log('      Use https:// instead if the server offers it.');
    }
    if (INSECURE) {
        console.log('  *** WARNING: TLS certificate checking is DISABLED (FB_INSECURE).');
    }
    console.log('  Close this window to stop the server.');
    console.log('');

    if (process.env.FB_NO_BROWSER) return;      // set by the automated test
    try {
        spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
        console.log('  Could not launch a browser automatically — open the URL above.');
    }
}

listenFrom(PORT, MAX_PORT_TRIES);
