/**
 * Cloudflare Worker — Fishbowl REST API proxy for the QuickOrder portal.
 *
 * Architecture (post-Access migration):
 *   Staff browser (logged in via Cloudflare Access OTP on 0xaha.com)
 *     → Pages Function /api/* on 0xaha.com (same-origin)
 *     → THIS WORKER via service binding (no public URL)
 *     → TokenManager Durable Object (per-email cached FB Bearer token)
 *     → Cloudflare Tunnel (cloudflared on FB host)
 *     → Fishbowl REST API on localhost:2456
 *
 * This Worker has NO public hostname — it's reachable only via service
 * binding from the Pages Function, which has already validated that the
 * caller is signed in to Cloudflare Access. So we trust the X-User-Email
 * header verbatim — no JWT validation here, that's the Pages Function's
 * job. The Pages Function strips the user's own headers and sets
 * X-User-Email from Cf-Access-Authenticated-User-Email before forwarding,
 * so the user can't forge it.
 *
 * Bindings (wrangler.toml):
 *   KEYS           — KV namespace. emailAddress → { fbUsername, fbPassword,
 *                    appName, appId, displayName }
 *   TOKEN_MANAGER  — Durable Object namespace. One DO instance per email;
 *                    each instance holds that user's cached FB token
 *                    and serialises refresh.
 *   FB_URL         — env var, the Tunnel hostname for the FB REST API.
 *                    e.g. https://fb-api.0xaha.com  (NOT localhost —
 *                    that's only reachable from the FB host itself).
 *   WORKER_VERSION — env var, surfaced at /health for cache-bust visibility.
 */

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ─── AES-GCM encryption for stored FB passwords ──────────────────────
// Stored FB passwords in KV are encrypted with AES-GCM using a 256-bit
// key that lives only as a Worker secret (KEYS_ENC_KEY). If KV ever
// leaked, the ciphertexts would be useless without the secret. Each
// encrypted value carries its own random 12-byte IV prepended.
//
// One-time setup:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//   npx wrangler secret put KEYS_ENC_KEY --env production
//   (paste the base64 string)
async function getEncKey(env) {
    if (!env.KEYS_ENC_KEY) {
        throw new Error('KEYS_ENC_KEY secret not configured — see worker.js for setup');
    }
    const keyBytes = Uint8Array.from(atob(env.KEYS_ENC_KEY), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
        'raw', keyBytes,
        { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    );
}

async function encryptString(env, plaintext) {
    const key = await getEncKey(env);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key,
        new TextEncoder().encode(plaintext)
    );
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.length);
    let bin = '';
    for (let i = 0; i < combined.length; i++) bin += String.fromCharCode(combined[i]);
    return btoa(bin);
}

async function decryptString(env, encoded) {
    const key = await getEncKey(env);
    const data = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const ct = data.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
}

// ─── Tenant + connection model ──────────────────────────────────────
//
// KV "KEYS" entries are keyed by Cloudflare Access email. Three shapes
// supported:
//
//   1. NEW (created via /api/_internal/connect) — one entry per email
//      with a list of per-tenant connections:
//      {
//        "lastTenantId": "acme",
//        "connections": [
//          { tenantId, tenantName, companyName, server,
//            fbUsername, encryptedPassword, displayName, connectedAt }
//        ]
//      }
//
//   2. LEGACY (admin-provisioned via wrangler kv put, including the
//      domain wildcard @fbinv.com and the global *):
//      { fbUsername, fbPassword | encryptedPassword, appName, appId,
//        displayName }
//
// The Worker reads both, writes only NEW. The LEGACY entries remain
// as a fallback for users who haven't done their first /connect.
//
// KV "TENANTS" entries are keyed by a short tenant code (slug) that
// admins assign per customer. Value: { name, server }. Used to
// resolve a tenant code → server URL at /connect time. Not exposed
// to end users (the page never enumerates this namespace).

async function lookupTenant(env, tenantId) {
    if (!env.TENANTS) return null;
    const raw = await env.TENANTS.get(tenantId);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
}

// SQL probe for the FB company name. Run once at /connect time so the
// connection record captures a friendly label. If it fails (older FB
// version, table renamed, query disallowed), companyName stays null
// and the UI falls back to the admin-set tenantName.
async function fetchCompanyName(server, token) {
    try {
        const url = server.replace(/\/$/, '')
                  + '/api/data-query?query='
                  + encodeURIComponent('SELECT name FROM company WHERE id = 1');
        const resp = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
        });
        if (!resp.ok) return null;
        const data = await resp.json().catch(() => null);
        const rows = Array.isArray(data) ? data
                  : (data && (data.rows || data.data || data.results)) || [];
        const row  = rows[0];
        if (!row) return null;
        return row.name || row.NAME || null;
    } catch (_) { return null; }
}

// Read the raw entry for an email — returns whichever shape is stored,
// or null if no entry. Doesn't decrypt or fall back to wildcards.
async function readRawEntry(env, email) {
    const raw = await env.KEYS.get(email);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (e) { throw new Error('Malformed KV entry for ' + email); }
}

// Resolve an authenticated email to the currently-active connection.
// Looks up email entry first (new shape preferred), then falls back to
// the legacy domain wildcard and global "*" entry. Returns a normalised
// connection object with `fbPassword` decrypted, or null if no mapping.
async function loadActiveConnection(env, email) {
    // 1. Per-email entry — could be NEW or LEGACY shape.
    let entry = await readRawEntry(env, email);
    let matchedKey = email;

    // 2. Wildcards (LEGACY shape only)
    if (!entry) {
        const at = email.indexOf('@');
        const domainKey = at >= 0 ? email.slice(at) : null;
        for (const k of [domainKey, '*'].filter(Boolean)) {
            const raw = await env.KEYS.get(k);
            if (raw) {
                try { entry = JSON.parse(raw); matchedKey = k; break; }
                catch (e) { throw new Error('Malformed KV entry for ' + k); }
            }
        }
    }
    if (!entry) return null;

    // NEW shape — pick active connection from the list.
    if (Array.isArray(entry.connections)) {
        if (entry.connections.length === 0) return null;
        const conn = entry.connections.find(c => c.tenantId === entry.lastTenantId)
                  || entry.connections[0];
        let fbPassword = null;
        if (conn.encryptedPassword) {
            try { fbPassword = await decryptString(env, conn.encryptedPassword); }
            catch (e) { throw new Error('Failed to decrypt password for ' + email + '/' + conn.tenantId + ': ' + e.message); }
        }
        if (!conn.fbUsername || !fbPassword) {
            throw new Error('Connection ' + conn.tenantId + ' is incomplete');
        }
        return {
            tenantId:    conn.tenantId,
            tenantName:  conn.tenantName || conn.tenantId,
            companyName: conn.companyName || null,
            server:      conn.server || null,
            fbUsername:  conn.fbUsername,
            fbPassword,
            appName:     conn.appName || 'Quick Order',
            appId:       conn.appId   || 102,
            displayName: conn.displayName || conn.fbUsername,
            connectedAt: conn.connectedAt || null,
            _entryKey:   matchedKey,
            _isLegacy:   false,
        };
    }

    // LEGACY shape — synthesise as a single "default" tenant connection.
    let fbPassword = entry.fbPassword || null;
    if (entry.encryptedPassword) {
        try { fbPassword = await decryptString(env, entry.encryptedPassword); }
        catch (e) { throw new Error('Failed to decrypt legacy entry for ' + matchedKey); }
    }
    if (!entry.fbUsername || !fbPassword) {
        throw new Error('KV entry for ' + matchedKey + ' missing fbUsername or password');
    }
    return {
        tenantId:    'default',
        tenantName:  'Fishbowl',
        companyName: null,
        server:      null,    // null → falls back to env.FB_URL in resolveServerUrl
        fbUsername:  entry.fbUsername,
        fbPassword,
        appName:     entry.appName || 'Quick Order',
        appId:       entry.appId   || 102,
        displayName: entry.displayName || entry.fbUsername,
        connectedAt: null,
        _entryKey:   matchedKey,
        _isLegacy:   true,
    };
}

// Effective server URL for a connection. NEW connections store the
// server inline (denormalised at /connect time). LEGACY falls back to
// env.FB_URL — single-tenant default.
function resolveServerUrl(env, conn) {
    return (conn && conn.server) || env.FB_URL;
}

/**
 * Build the upstream URL: prepend the connection's server, preserve
 * path + query. `server` is the per-tenant FB hostname (passed in by
 * the caller — could be the user's specific tenant's tunnel, NOT
 * necessarily env.FB_URL).
 */
function buildUpstreamUrl(server, request) {
    const u = new URL(request.url);
    const qs = u.searchParams.toString();
    return server.replace(/\/$/, '') + u.pathname + (qs ? '?' + qs : '');
}

function extractToken(data) {
    return data.token || data.access_token || data.bearer || data.bearerToken || null;
}

/**
 * Send the proxied request to the given FB server with the supplied
 * token. `bodyBuffer` is the request body pre-read into an
 * ArrayBuffer at the top of the main handler — passing it (instead
 * of re-reading request.body) lets us retry on a 401 without losing
 * the payload. Workers request bodies are one-shot streams; reading
 * them twice silently produces an empty body on the second attempt,
 * which would corrupt SO imports.
 */
async function proxyOnce(env, fbToken, request, bodyBuffer, server) {
    const upstream = buildUpstreamUrl(server, request);
    const headers = new Headers();
    const ct = request.headers.get('Content-Type'); if (ct) headers.set('Content-Type', ct);
    const ac = request.headers.get('Accept');       if (ac) headers.set('Accept', ac);
    headers.set('Authorization', 'Bearer ' + fbToken);

    const init = { method: request.method, headers };
    if (bodyBuffer != null) init.body = bodyBuffer;
    return fetch(upstream, init);
}

// ─── Durable Object: TokenManager ──────────────────────────────────────
//
// One DO instance per email (keyed via idFromName(email)). Each instance
// holds the current FB Bearer token in DO storage so concurrent requests
// for the same user share a single FB session. Login is serialised via
// blockConcurrencyWhile — guarantees exactly one /api/login round trip
// per token-expiry event no matter how many staff requests arrive in
// parallel. Invalidation logs out the previous token before discarding
// it, so every successful login matches a logout — no session leaks in
// Fishbowl's "logged-in users" list.
//
// The DO also tracks token AGE so the main handler can refresh
// proactively (before the FB idle timeout fires) for non-idempotent
// requests like SO submits. Cheap insurance against losing a long-built
// cart to a stale-session 401 / retry round trip.
//
// Endpoints (private; only the Worker fetch handler hits these):
//   POST /get-token   body: { fbUsername, fbPassword, appName?, appId?,
//                             maxAgeSeconds? }
//                     → { token, age }    (logs in on cache miss or
//                                          when cached age > maxAgeSeconds)
//   POST /invalidate  → { ok: true }      (logs out old token + clears cache)
//
export class TokenManager {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        // In-memory cache. Rehydrated from storage on first access after
        // a cold start.
        this.token = null;
        this.tokenIssuedAt = 0;
        this.server = null;            // FB server URL this DO is logged into
        this.hydrated = false;
    }

    async fetch(request) {
        const url = new URL(request.url);
        try {
            if (url.pathname === '/get-token')  return await this.handleGetToken(request);
            if (url.pathname === '/invalidate') return await this.handleInvalidate();
            return new Response('Not found', { status: 404 });
        } catch (e) {
            return new Response(JSON.stringify({ error: e && e.message || String(e) }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    }

    async hydrate() {
        if (this.hydrated) return;
        const stored = await this.state.storage.get(['token', 'tokenIssuedAt', 'server']);
        this.token = stored.get('token') || null;
        this.tokenIssuedAt = stored.get('tokenIssuedAt') || 0;
        this.server = stored.get('server') || null;
        this.hydrated = true;
    }

    async handleGetToken(request) {
        await this.hydrate();
        const body = await request.json();
        const now = Date.now();
        const maxAgeMs = (body.maxAgeSeconds || 0) * 1000;

        // Proactive refresh — if the caller supplied a maxAge and the
        // cached token exceeds it, drop the cache + log out before
        // re-logging-in. Avoids the 401-then-retry round trip on the
        // hot path for non-idempotent requests (SO submits etc.).
        if (this.token && maxAgeMs > 0 && (now - this.tokenIssuedAt) > maxAgeMs) {
            await this.invalidateInternal();
        }

        if (this.token) {
            return new Response(JSON.stringify({
                token: this.token,
                cached: true,
                age: Math.round((now - this.tokenIssuedAt) / 1000),
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        // blockConcurrencyWhile serialises concurrent logins. Without it,
        // N parallel requests would each see no cached token and each
        // fire its own /api/login — leaking sessions on FB's side.
        await this.state.blockConcurrencyWhile(async () => {
            if (this.token) return; // another caller raced us in
            this.token = await this.fbLogin(body);
            this.tokenIssuedAt = Date.now();
            await this.state.storage.put({
                token: this.token,
                tokenIssuedAt: this.tokenIssuedAt,
            });
        });
        return new Response(JSON.stringify({
            token: this.token,
            cached: false,
            age: 0,
        }), { headers: { 'Content-Type': 'application/json' } });
    }

    async invalidateInternal() {
        let oldToken = null;
        await this.state.blockConcurrencyWhile(async () => {
            oldToken = this.token;
            this.token = null;
            this.tokenIssuedAt = 0;
            // Note: `server` is preserved so fbLogout below can still hit
            // the right host. Cleared lazily on the next successful login.
            await this.state.storage.delete(['token', 'tokenIssuedAt']);
        });
        if (oldToken) {
            try { await this.fbLogout(oldToken); } catch (_) { /* best-effort */ }
        }
    }

    async handleInvalidate() {
        await this.hydrate();
        await this.invalidateInternal();
        return new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Per-tenant server. Always passed by the caller (in creds.server
    // from doGetToken). Stored alongside the token in DO storage so we
    // can log out against the SAME server we logged into, even after
    // DO eviction + rehydration.
    async fbLogin(creds) {
        const server = creds.server || this.env.FB_URL;
        if (!server) throw new Error('No FB server URL for this login');
        this.server = server;
        await this.state.storage.put('server', server);
        const resp = await fetch(server.replace(/\/$/, '') + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appName: creds.appName || 'Quick Order',
                appId: parseInt(creds.appId, 10) || 102,
                username: creds.fbUsername,
                password: creds.fbPassword,
            }),
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            throw new Error('FB login returned ' + resp.status + (txt ? ' — ' + txt.slice(0, 200) : ''));
        }
        const data = await resp.json().catch(() => ({}));
        const token = extractToken(data);
        if (!token) throw new Error('FB login returned no token');
        return token;
    }

    async fbLogout(token) {
        const server = this.server || this.env.FB_URL;
        if (!server) return;
        await fetch(server.replace(/\/$/, '') + '/api/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
        });
    }
}

async function doGetToken(stub, creds, maxAgeSeconds) {
    const resp = await stub.fetch('https://do.local/get-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...creds, maxAgeSeconds }),
    });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error('TokenManager.get-token ' + resp.status + (txt ? ' — ' + txt.slice(0, 200) : ''));
    }
    const data = await resp.json();
    if (!data.token) throw new Error('TokenManager returned no token');
    return data.token;
}

async function doInvalidate(stub) {
    try { await stub.fetch('https://do.local/invalidate', { method: 'POST' }); }
    catch (_) { /* next get-token will re-login regardless */ }
}

// Proactively refresh the FB token before this many seconds of age. Set
// to a few minutes shy of the FB idle timeout (default 60-120 min) so
// cached tokens never hit the timeout in the middle of a request. Tune
// down if you see stale-session 401-retries in the logs.
const MAX_TOKEN_AGE_SECONDS = 50 * 60;  // 50 minutes

// ─── Internal endpoints (multi-tenant self-onboarding) ───────────────
//
// /api/_internal/whoami         GET     → identity + connected tenants
// /api/_internal/connect        POST    → add a tenant binding
// /api/_internal/disconnect     POST    → remove a tenant binding
// /api/_internal/switch-tenant  POST    → change the active tenant
//
// All identified by X-User-Email which the Pages Function sets from
// the verified Access JWT. Worker runs these locally — never proxies
// to FB except for the validation probe at /connect.
//
// Anti-enumeration: /connect returns the SAME generic error whether
// the tenant code is unknown, the FB rejected the credentials, OR
// the user is locked out. Stops attackers who got past Access from
// brute-forcing tenant codes.
const CONNECT_GENERIC_FAIL = 'Could not connect. Check the tenant code and your Fishbowl credentials.';

// Strip the encrypted password before exposing a connection to the
// page. The page never needs to see ciphertext (or plaintext) — only
// names + IDs for the switcher dropdown.
function publicConnectionView(c) {
    return {
        tenantId:    c.tenantId,
        tenantName:  c.tenantName || c.tenantId,
        companyName: c.companyName || null,
        fbUsername:  c.fbUsername,
        displayName: c.displayName || c.fbUsername,
        connectedAt: c.connectedAt || null,
    };
}

async function handleWhoami(env, email) {
    let entry = null;
    try { entry = await readRawEntry(env, email); }
    catch (e) {
        return jsonResponse(500, { error: e.message });
    }

    // NEW shape — return the connection list.
    if (entry && Array.isArray(entry.connections)) {
        if (entry.connections.length === 0) {
            return jsonResponse(200, { email, needsLogin: true });
        }
        const active = entry.connections.find(c => c.tenantId === entry.lastTenantId)
                    || entry.connections[0];
        return jsonResponse(200, {
            email,
            needsLogin:     false,
            activeTenantId: active.tenantId,
            connections:    entry.connections.map(publicConnectionView),
        });
    }

    // LEGACY fallback (or no entry at all) — try loadActiveConnection
    // so domain wildcards / global * still surface as a single
    // implicit "default" connection. Lets existing @fbinv.com users
    // continue without doing /connect.
    try {
        const conn = await loadActiveConnection(env, email);
        if (conn) {
            return jsonResponse(200, {
                email,
                needsLogin:     false,
                activeTenantId: conn.tenantId,
                connections:    [publicConnectionView(conn)],
                legacyFallback: conn._isLegacy === true,
            });
        }
    } catch (_) {}
    return jsonResponse(200, { email, needsLogin: true });
}

async function handleConnect(env, email, request) {
    let body;
    try { body = await request.json(); }
    catch (e) { return jsonResponse(400, { error: 'Invalid JSON body' }); }

    const tenantId    = (body.tenantId    || '').trim().toLowerCase();
    const fbUsername  = (body.fbUsername  || '').trim();
    const fbPassword  =  body.fbPassword;
    const displayName = (body.displayName || '').trim() || fbUsername;
    if (!tenantId || !fbUsername || !fbPassword) {
        return jsonResponse(400, { error: 'tenantId, fbUsername, and fbPassword are required' });
    }

    // Look up the tenant. Don't leak whether the code exists vs whether
    // it has bad credentials — both return CONNECT_GENERIC_FAIL.
    const tenant = await lookupTenant(env, tenantId);
    if (!tenant || !tenant.server) {
        return jsonResponse(401, { error: CONNECT_GENERIC_FAIL });
    }

    // Validate against the tenant's FB server.
    let token;
    try {
        const loginResp = await fetch(tenant.server.replace(/\/$/, '') + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appName: 'Quick Order',
                appId: 102,
                username: fbUsername,
                password: fbPassword,
            }),
        });
        if (!loginResp.ok) {
            return jsonResponse(401, { error: CONNECT_GENERIC_FAIL });
        }
        const data = await loginResp.json().catch(() => ({}));
        token = extractToken(data);
        if (!token) return jsonResponse(401, { error: CONNECT_GENERIC_FAIL });
    } catch (e) {
        // Unreachable upstream — distinguishable from bad creds, but
        // a legitimate user can't fix a downed tunnel by guessing.
        return jsonResponse(502, {
            error: 'Fishbowl server is unreachable. Try again in a moment, or contact your admin.',
            detail: e && e.message,
        });
    }

    // Pull the company name (best-effort) before logging the probe out.
    const companyName = await fetchCompanyName(tenant.server, token);

    // Logout the probe so it doesn't linger as an orphan session.
    try {
        await fetch(tenant.server.replace(/\/$/, '') + '/api/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
        });
    } catch (_) {}

    // Encrypt the password.
    let encryptedPassword;
    try { encryptedPassword = await encryptString(env, fbPassword); }
    catch (e) {
        return jsonResponse(500, {
            error: 'Encryption failed — KEYS_ENC_KEY missing or invalid',
            detail: e && e.message,
        });
    }
    const newConn = {
        tenantId,
        tenantName: tenant.name || tenantId,
        companyName,
        server:     tenant.server,
        fbUsername,
        encryptedPassword,
        appName:    'Quick Order',
        appId:      102,
        displayName,
        connectedAt: new Date().toISOString(),
    };

    // Merge into the user's connections list. If they have a previous
    // connection for this tenant, replace it (re-entering creds after
    // an FB password change).
    let existing = null;
    try { existing = await readRawEntry(env, email); }
    catch (_) {}
    let connections = [];
    if (existing && Array.isArray(existing.connections)) {
        connections = existing.connections.filter(c => c.tenantId !== tenantId);
    }
    connections.push(newConn);
    const entry = {
        lastTenantId: tenantId,    // most recent connection becomes active
        connections,
        updatedAt:    new Date().toISOString(),
    };
    await env.KEYS.put(email, JSON.stringify(entry));

    return jsonResponse(200, {
        ok:           true,
        activeTenantId: tenantId,
        connection:   publicConnectionView(newConn),
    });
}

async function handleDisconnect(env, email, request) {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const tenantId = (body.tenantId || '').trim().toLowerCase();

    let entry = null;
    try { entry = await readRawEntry(env, email); }
    catch (_) {}
    if (!entry) return jsonResponse(200, { ok: true });

    // Legacy entry OR no tenantId specified → remove the whole record.
    if (!Array.isArray(entry.connections) || !tenantId) {
        await env.KEYS.delete(email);
        return jsonResponse(200, { ok: true });
    }

    // Remove just the matching connection.
    const before = entry.connections.length;
    entry.connections = entry.connections.filter(c => c.tenantId !== tenantId);
    if (entry.connections.length === 0) {
        await env.KEYS.delete(email);
        return jsonResponse(200, { ok: true, lastConnectionRemoved: true });
    }
    if (entry.lastTenantId === tenantId) {
        entry.lastTenantId = entry.connections[0].tenantId;
    }
    entry.updatedAt = new Date().toISOString();
    await env.KEYS.put(email, JSON.stringify(entry));
    return jsonResponse(200, {
        ok: true,
        removed:        before - entry.connections.length,
        activeTenantId: entry.lastTenantId,
    });
}

async function handleSwitchTenant(env, email, request) {
    let body;
    try { body = await request.json(); }
    catch (e) { return jsonResponse(400, { error: 'Invalid JSON body' }); }
    const tenantId = (body.tenantId || '').trim().toLowerCase();
    if (!tenantId) return jsonResponse(400, { error: 'tenantId is required' });

    const entry = await readRawEntry(env, email);
    if (!entry || !Array.isArray(entry.connections)) {
        return jsonResponse(404, { error: 'No connections to switch between' });
    }
    if (!entry.connections.find(c => c.tenantId === tenantId)) {
        return jsonResponse(404, { error: 'No such connection' });
    }
    entry.lastTenantId = tenantId;
    entry.updatedAt    = new Date().toISOString();
    await env.KEYS.put(email, JSON.stringify(entry));
    return jsonResponse(200, { ok: true, activeTenantId: tenantId });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Health check — doesn't require auth. Useful for service-binding
        // smoke tests from the Pages Function.
        if (url.pathname === '/health') {
            return jsonResponse(200, {
                ok: true,
                version: env.WORKER_VERSION || 'dev',
                upstream: env.FB_URL || null,
            });
        }

        // Identity is set by the Pages Function from
        // Cf-Access-Authenticated-User-Email. The Worker has no public
        // URL, so this header is trustworthy — the user can't reach
        // this Worker except through the Function, which strips the
        // user's own headers and sets X-User-Email from Cloudflare's
        // verified Access claim.
        const email = request.headers.get('X-User-Email');
        if (!email) {
            return jsonResponse(401, {
                error: 'Missing X-User-Email header — Worker reached outside the expected Pages Function path',
            });
        }

        // Internal management endpoints — handled locally, not proxied.
        if (url.pathname === '/api/_internal/whoami') {
            return handleWhoami(env, email);
        }
        if (url.pathname === '/api/_internal/connect' && request.method === 'POST') {
            // Rate-limit /connect by email to slow tenant-code brute force.
            // Past Cloudflare Access we trust the email header, so keying
            // by email is fair: an attacker who's already past OTP gets
            // their own bucket they can burn through, then they're cooled.
            // No-op if the binding isn't configured (e.g. wrangler dev).
            if (env.RATE_LIMIT_CONNECT) {
                const r = await env.RATE_LIMIT_CONNECT.limit({ key: 'connect:' + email });
                if (!r.success) {
                    return jsonResponse(429, {
                        error: 'Too many connection attempts. Wait a minute and try again.',
                    });
                }
            }
            return handleConnect(env, email, request);
        }
        if (url.pathname === '/api/_internal/disconnect' && request.method === 'POST') {
            return handleDisconnect(env, email, request);
        }
        if (url.pathname === '/api/_internal/switch-tenant' && request.method === 'POST') {
            return handleSwitchTenant(env, email, request);
        }

        // Rate-limit the proxy path. Per-email, 120 req/min — covers
        // normal page-load bursts (the catalogue fetches ~5 queries
        // concurrently on first paint) while shutting down runaway
        // loops before they hammer FB. 429 surfaces as a soft toast
        // in the page; user can refresh or wait.
        if (env.RATE_LIMIT_PROXY) {
            const r = await env.RATE_LIMIT_PROXY.limit({ key: 'proxy:' + email });
            if (!r.success) {
                return jsonResponse(429, {
                    error: 'Too many requests. Slow down a moment.',
                });
            }
        }

        // ─── Proxy path ─────────────────────────────────────────────
        let conn;
        try { conn = await loadActiveConnection(env, email); }
        catch (e) { return jsonResponse(500, { error: e.message }); }
        if (!conn) {
            return jsonResponse(403, {
                error: 'No Fishbowl account is connected for ' + email + '. Sign in to your Fishbowl account from the QuickOrder page.',
                needsLogin: true,
            });
        }
        const server = resolveServerUrl(env, conn);

        // Read the body ONCE at the top so we can reuse it on the 401
        // retry. Workers request bodies are one-shot streams; reading
        // them twice silently produces an empty body on the second
        // read, which would corrupt SO submits.
        let bodyBuffer = null;
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            bodyBuffer = await request.arrayBuffer();
        }

        // ─── Token from the per-FB-account TokenManager DO ────────────
        // DO keyed by the FB username, NOT the staff email. Multiple
        // staff signing in with their own emails but sharing one FB
        // account (e.g. all @fbinv.com → fbUsername "fam") land on the
        // same DO and share its cached token. Without this, each
        // staff member would log in independently and FB's
        // single-session-per-user behaviour would have them constantly
        // invalidating each other's tokens.
        // DO keyed by tenant + FB username so two tenants with the same
        // FB user name (e.g. both have an "admin" account) get isolated
        // session caches. Within a tenant, multiple staff sharing one
        // FB user still share the same DO (just like before).
        const doId = env.TOKEN_MANAGER.idFromName('fb:' + conn.tenantId + ':' + conn.fbUsername);
        const stub = env.TOKEN_MANAGER.get(doId);

        const loginCreds = {
            fbUsername: conn.fbUsername,
            fbPassword: conn.fbPassword,
            server:     server,
            appName:    conn.appName,
            appId:      conn.appId,
        };

        let fbToken;
        try { fbToken = await doGetToken(stub, loginCreds, MAX_TOKEN_AGE_SECONDS); }
        catch (e) {
            return jsonResponse(502, { error: 'FB login failed', detail: e && e.message });
        }

        let resp;
        try { resp = await proxyOnce(env, fbToken, request, bodyBuffer, server); }
        catch (e) {
            return jsonResponse(502, { error: 'Upstream FB API unreachable', detail: e && e.message });
        }

        // If FB rejects auth, the cached token has expired between the
        // pro-active age check and the actual request (rare — could
        // happen if FB admin force-logged-out the user, or if the
        // 50-minute heuristic is too generous for this install's idle
        // timeout). Tell the DO to refresh and retry once. Single retry
        // only — a second 401 means the credentials themselves are
        // wrong, not stale, and looping would hammer FB.
        if (resp.status === 401) {
            await doInvalidate(stub);
            try {
                fbToken = await doGetToken(stub, loginCreds, 0);  // force fresh
                resp = await proxyOnce(env, fbToken, request, bodyBuffer, server);
            } catch (e) {
                return jsonResponse(502, { error: 'FB re-login failed', detail: e && e.message });
            }
        }

        return resp;
    },
};
