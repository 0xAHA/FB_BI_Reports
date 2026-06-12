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

/**
 * Build the upstream URL: prepend FB_URL, preserve path + query.
 */
function buildUpstreamUrl(env, request) {
    const u = new URL(request.url);
    const qs = u.searchParams.toString();
    return env.FB_URL.replace(/\/$/, '') + u.pathname + (qs ? '?' + qs : '');
}

function extractToken(data) {
    return data.token || data.access_token || data.bearer || data.bearerToken || null;
}

/**
 * Send the proxied request to FB with the supplied token. `bodyBuffer`
 * is the request body pre-read into an ArrayBuffer at the top of the
 * main handler — passing it (instead of re-reading request.body) lets
 * us retry on a 401 without losing the payload. Workers request bodies
 * are one-shot streams; reading them twice silently produces an empty
 * body on the second attempt, which would corrupt SO imports.
 */
async function proxyOnce(env, fbToken, request, bodyBuffer) {
    const upstream = buildUpstreamUrl(env, request);
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
        const stored = await this.state.storage.get(['token', 'tokenIssuedAt']);
        this.token = stored.get('token') || null;
        this.tokenIssuedAt = stored.get('tokenIssuedAt') || 0;
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

    async fbLogin(creds) {
        const resp = await fetch(this.env.FB_URL.replace(/\/$/, '') + '/api/login', {
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
        await fetch(this.env.FB_URL.replace(/\/$/, '') + '/api/logout', {
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

        // KV lookup: exact email first, then domain wildcard, then global.
        //   1. KV["andrew.doenau@fbinv.com"]  ← individual user mapping
        //   2. KV["@fbinv.com"]               ← whole-domain fallback (cheap
        //                                       way to onboard a team that
        //                                       all uses the same FB account)
        //   3. KV["*"]                        ← global last-resort (only set
        //                                       if you trust every email the
        //                                       Access policy admits)
        // First hit wins, so individual overrides domain.
        const atIdx = email.indexOf('@');
        const domainKey = atIdx >= 0 ? email.slice(atIdx) : null;  // "@fbinv.com"
        const lookupOrder = [email, domainKey, '*'].filter(Boolean);
        let raw = null, matchedKey = null;
        for (const k of lookupOrder) {
            raw = await env.KEYS.get(k);
            if (raw) { matchedKey = k; break; }
        }
        if (!raw) {
            return jsonResponse(403, {
                error: 'Signed in as ' + email + ' but no Fishbowl account is mapped to that address (tried: ' + lookupOrder.join(', ') + '). Contact your admin.',
            });
        }

        let creds;
        try { creds = JSON.parse(raw); }
        catch (e) { return jsonResponse(500, { error: 'KV entry malformed for ' + matchedKey }); }

        if (!creds.fbUsername || !creds.fbPassword) {
            return jsonResponse(500, {
                error: 'KV entry for ' + matchedKey + ' is missing fbUsername/fbPassword — admin must re-provision.',
            });
        }

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
        const doId = env.TOKEN_MANAGER.idFromName('fb:' + creds.fbUsername);
        const stub = env.TOKEN_MANAGER.get(doId);

        const loginCreds = {
            fbUsername: creds.fbUsername,
            fbPassword: creds.fbPassword,
            appName:    creds.appName,
            appId:      creds.appId,
        };

        let fbToken;
        try { fbToken = await doGetToken(stub, loginCreds, MAX_TOKEN_AGE_SECONDS); }
        catch (e) {
            return jsonResponse(502, { error: 'FB login failed', detail: e && e.message });
        }

        let resp;
        try { resp = await proxyOnce(env, fbToken, request, bodyBuffer); }
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
                resp = await proxyOnce(env, fbToken, request, bodyBuffer);
            } catch (e) {
                return jsonResponse(502, { error: 'FB re-login failed', detail: e && e.message });
            }
        }

        return resp;
    },
};
