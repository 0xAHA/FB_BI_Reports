/**
 * Cloudflare Pages Function — catch-all auth gateway for /api/*.
 *
 * Sits between the staff browser and the Worker. The Pages site itself
 * (https://0xaha.com/) is Cloudflare Access-protected — every request
 * reaching this Function has already passed OTP.
 *
 * This Function:
 *  1. Reads `Cf-Access-Jwt-Assertion` from the incoming request.
 *  2. Verifies the JWT's signature against Cloudflare's JWKS (defence
 *     in depth — Cloudflare's edge already authenticated the request,
 *     but verifying again ensures no forged-header path can sneak
 *     past).
 *  3. Forwards the request to the QUICKORDER_WORKER service binding
 *     with X-User-Email set from the verified `email` claim.
 *
 * Bindings (configured on the Pages project — Settings → Functions):
 *   QUICKORDER_WORKER — Service binding to the quickorder-worker Worker.
 *
 * Constants below identify YOUR Access tenant. If you reissue the
 * Access Application or move teams, update both ACCESS_TEAM_DOMAIN
 * and ACCESS_APP_AUD.
 *
 *   ACCESS_TEAM_DOMAIN  Your Cloudflare Zero Trust team domain. Visit
 *                       Zero Trust → Settings → Custom Pages to confirm.
 *                       Always starts with https:// and ends in
 *                       .cloudflareaccess.com.
 *   ACCESS_APP_AUD      The "AUD tag" of your Access Application.
 *                       Zero Trust → Access → Applications → your app
 *                       → Overview → "Application Audience (AUD) Tag".
 */
const ACCESS_TEAM_DOMAIN = 'https://0xaha.cloudflareaccess.com';
const ACCESS_APP_AUD     = '02102aa1dc3ca6530027d978e0ecf77742811ebbef76321214f6000c6f7aebc9';

// ── base64url helpers ──────────────────────────────────────────────
function base64UrlToBytes(s) {
    let p = s.replace(/-/g, '+').replace(/_/g, '/');
    while (p.length % 4) p += '=';
    const binary = atob(p);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function decodeJwtPart(s) {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(s)));
}

// ── JWKS fetch + cache ─────────────────────────────────────────────
// Cloudflare's Access certs endpoint is publicly cacheable. Use the
// Cache API (caches.default) to memoise across invocations on the
// same colo so we don't fetch on every staff request — JWKS rotation
// is infrequent (months) and we cache for 1 hour, so the worst-case
// effect of stale JWKS is one hour of failed verification after a
// rotation, which is operationally fine.
async function fetchJwks() {
    const url = ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs';
    const cacheKey = new Request(url, { method: 'GET' });
    const cache = caches.default;
    let resp = await cache.match(cacheKey);
    if (!resp) {
        resp = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
        if (!resp.ok) throw new Error('JWKS fetch failed: ' + resp.status);
        // Re-construct with our own cache-control so the Cache API
        // actually keeps it (Cloudflare's response may not include
        // a generous max-age).
        const headers = new Headers(resp.headers);
        headers.set('Cache-Control', 'public, max-age=3600');
        const body = await resp.clone().arrayBuffer();
        resp = new Response(body, { status: resp.status, headers });
        await cache.put(cacheKey, resp.clone());
    }
    return resp.json();
}

// ── JWT verification ───────────────────────────────────────────────
// Validates the JWT signature against Cloudflare's published public
// keys, plus exp / nbf / iss / aud claims. Returns the decoded payload
// on success or throws on any failure.
async function verifyAccessJwt(jwt) {
    const parts = jwt.split('.');
    if (parts.length !== 3) throw new Error('Malformed JWT (wrong number of parts)');
    const [headerB64, payloadB64, sigB64] = parts;

    const header  = decodeJwtPart(headerB64);
    const payload = decodeJwtPart(payloadB64);

    // Algorithm check — Cloudflare Access always signs RS256. Refusing
    // anything else closes the "alg: none" / "alg: HS256 with public
    // key as secret" classic JWT vulnerability classes.
    if (header.alg !== 'RS256') throw new Error('Unsupported JWT alg: ' + header.alg);
    if (!header.kid) throw new Error('JWT header missing kid');

    // Claims first (cheap before we touch crypto).
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp == null || payload.exp < now) throw new Error('JWT expired');
    if (payload.nbf != null && payload.nbf > now + 60) throw new Error('JWT not yet valid');
    if (payload.iss !== ACCESS_TEAM_DOMAIN) throw new Error('JWT issuer mismatch: ' + payload.iss);
    const auds = Array.isArray(payload.aud) ? payload.aud : (payload.aud ? [payload.aud] : []);
    if (!auds.includes(ACCESS_APP_AUD)) throw new Error('JWT audience mismatch: ' + auds.join(','));

    // Fetch JWKS, find the matching key by kid, import it as a Web
    // Crypto key, verify the signature over headerB64.payloadB64.
    const jwks = await fetchJwks();
    const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
    if (!jwk) throw new Error('No JWKS key matches kid ' + header.kid);

    const publicKey = await crypto.subtle.importKey(
        'jwk',
        { ...jwk, key_ops: ['verify'], alg: jwk.alg || 'RS256' },
        { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
        false,
        ['verify']
    );

    const signedData = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const signature  = base64UrlToBytes(sigB64);
    const valid = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        publicKey,
        signature,
        signedData
    );
    if (!valid) throw new Error('JWT signature invalid');

    return payload;
}

export async function onRequest(context) {
    const { request, env } = context;

    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!jwt) {
        return new Response(JSON.stringify({
            error: 'Not authenticated via Cloudflare Access — the QuickOrder portal must be loaded through https://0xaha.com.',
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let payload;
    try { payload = await verifyAccessJwt(jwt); }
    catch (e) {
        return new Response(JSON.stringify({
            error: 'Access JWT verification failed.',
            detail: e && e.message,
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const email = payload.email;
    if (!email) {
        return new Response(JSON.stringify({
            error: 'Access JWT verified but missing email claim.',
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (!env.QUICKORDER_WORKER) {
        return new Response(JSON.stringify({
            error: 'Service binding QUICKORDER_WORKER not configured on Pages project. Add it under Pages → Settings → Functions → Service bindings.',
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // Forward to the Worker via service binding. Rewrite headers:
    //  - Drop the browser's Authorization (user can't pose as someone else)
    //  - Drop any prior X-User-Email (likewise)
    //  - Set X-User-Email from the verified Access claim
    //  - Preserve Content-Type and Accept verbatim
    const fwdHeaders = new Headers();
    const ct = request.headers.get('Content-Type'); if (ct) fwdHeaders.set('Content-Type', ct);
    const ac = request.headers.get('Accept');       if (ac) fwdHeaders.set('Accept', ac);
    fwdHeaders.set('X-User-Email', email);

    // Body is forwarded as-is. The Worker reads it ONCE into an
    // ArrayBuffer (see worker.js) so the 401-retry path still has the
    // payload — important for SO submits.
    const init = { method: request.method, headers: fwdHeaders };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = request.body;
    }

    return env.QUICKORDER_WORKER.fetch(new Request(request.url, init));
}
