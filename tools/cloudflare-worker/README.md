# QuickOrder Portal — Cloudflare Worker

This Worker is the auth + CORS layer that lets `SalesOrder/QuickOrder.htm`
run from any browser instead of only inside the Fishbowl desktop client.

## Architecture

```
Staff browser
   │  HTTPS  (CORS-permissive, gated by ?key=)
   ▼
Cloudflare Worker (this code)
   │  HTTPS  (Tunnel hostname, e.g. fb-api.yourco.com)
   ▼
cloudflared (Windows service, runs on the FB host)
   │  localhost:2456
   ▼
Fishbowl REST API
```

The Worker:
1. Reads `?key=` (or `Authorization: Bearer`) from the inbound request.
2. Looks the key up in the **KEYS** KV namespace (stored: `fbUsername`,
   `fbPassword`, `appName`, `appId`, `displayName`).
3. Asks the per-key **TokenManager** Durable Object for a current FB
   Bearer token. On a cache miss the DO logs in via `POST /api/login`
   and stashes the token in DO storage; on a hit it returns the
   cached one with no upstream round trip.
4. Proxies the request to the Tunnel URL stamping in that token.
5. If FB returns 401 the cached token has expired — the Worker tells
   the DO to invalidate (which logs out the old token before clearing
   it), gets a fresh one, and retries the request once.
6. Re-emits the response with `Access-Control-Allow-Origin: *` so the
   browser will accept it from any origin.

## Why a Durable Object

The earlier design cached the Bearer token in KV and refreshed on 401.
That works fine sequentially but leaks FB sessions on concurrent burst
loads: QuickOrder fires ~5 parallel queries on first paint; if the
cached token is stale, every Worker invocation independently logs in
and orphans 4–5 sessions in Fishbowl's "logged-in users" list.
Cloudflare KV has no compare-and-swap so the race is unfixable inside
plain Workers.

We then shipped a per-request login + logout flow as a stop-gap — zero
session leaks at the cost of ~100 ms login round trip on EVERY staff
request. Correct, but chatty.

The Durable Object solves both problems:

- **One DO instance per API key** (`idFromName(apiKey)`). Concurrent
  requests for the same key share a single token; different keys are
  isolated from each other.
- **`blockConcurrencyWhile` serialises refresh.** Exactly one
  `/api/login` round trip per token-expiry event no matter how many
  parallel staff requests arrive. The other requests wait inside the
  DO for the in-flight login to finish, then receive the fresh token.
- **Invalidation logs out the previous token** before discarding it,
  so every login still matches a logout — no orphaned sessions in
  Fishbowl's "logged-in users" list.
- **Cached on the hot path.** A request that hits a warm token sees
  zero login latency — the DO returns the cached token from its
  in-memory copy (rehydrated from SQLite storage on cold start).

### Plan compatibility

The Worker uses `new_sqlite_classes` in the migration (see
`wrangler.toml`). SQLite-backed DOs are available on the **Workers
Free** plan — the older KV-style DO (`new_classes`) requires Workers
Paid. For QuickOrder's volume (small team, occasional usage), Free is
fine.

---

## One-time setup

### 1. Install `cloudflared` on the Fishbowl host

On the Windows machine that runs Fishbowl Server:

```powershell
# Option A: winget
winget install --id Cloudflare.cloudflared

# Option B: download the MSI from
# https://github.com/cloudflare/cloudflared/releases
```

Authenticate:

```powershell
cloudflared tunnel login
```

This opens a browser. Pick the Cloudflare-managed domain you want to use
(e.g. `yourco.com`).

### 2. Create the Tunnel

```powershell
cloudflared tunnel create fb-api
```

This prints a Tunnel UUID and a path to a credentials JSON file.
Note both — you'll need them for the config.

Edit (or create) `C:\Users\<user>\.cloudflared\config.yml`:

```yaml
tunnel: <tunnel-uuid>
credentials-file: C:\Users\<user>\.cloudflared\<tunnel-uuid>.json

ingress:
  - hostname: fb-api.yourco.com
    service: http://localhost:2456
  - service: http_status:404
```

Then point a DNS record for that hostname at the Tunnel:

```powershell
cloudflared tunnel route dns fb-api fb-api.yourco.com
```

### 3. Install as a Windows service

So the tunnel runs even after the user logs out:

```powershell
cloudflared service install
```

Verify with:

```powershell
Get-Service cloudflared
```

It should show `Running`. Logs are at
`C:\Windows\System32\config\systemprofile\.cloudflared\cloudflared.log`.

### 4. Confirm the tunnel is up

From any machine **outside** the FB server's LAN:

```bash
curl -i https://fb-api.yourco.com/api/login
```

Expect a `4xx` from Fishbowl (login required). A `5xx` or DNS error means
the tunnel isn't routing. A `Cloudflare 521` means cloudflared isn't running.

### 5. Provision the Cloudflare Worker

Install Wrangler:

```bash
npm install -g wrangler
wrangler login
```

Create the KV namespace (wrangler v3+ syntax — older `wrangler kv:namespace`
with a colon also works):

```bash
wrangler kv namespace create KEYS
# → ✨ Add the following to your configuration file:
# kv_namespaces = [
#   { binding = "KEYS", id = "abc123..." }
# ]
```

Paste that `id` into `wrangler.toml` (replace the existing `id` under
`[[env.production.kv_namespaces]]`).

Update `wrangler.toml`:
- Set `FB_URL` under `[env.production.vars]` to your Tunnel hostname.
- Bump `WORKER_VERSION` whenever you deploy.

The Durable Object binding is already declared at the bottom of
`wrangler.toml`. The first `wrangler deploy` applies the `[[migrations]]`
entry, which creates the `TokenManager` SQLite-backed DO class. No
manual setup needed — Cloudflare provisions storage on first DO access.

Deploy:

```bash
wrangler deploy --env production
```

The first deploy prints the Worker URL — e.g.
`https://quickorder-worker.<your-cf-subdomain>.workers.dev`.
Bookmark this. You can also map a custom hostname under
Cloudflare's "Workers Routes" later (e.g. `orders.yourco.com`).

### 6. Provision your first staff API key

For each Fishbowl user who needs portal access:

```bash
# 1. Generate a random key (Linux/Mac).
#    On Windows:  -join ((48..57)+(97..122) | Get-Random -Count 32 | %{[char]$_})
KEY=$(openssl rand -hex 24)
echo "Hand this key to the staff member: $KEY"

# 2. Write the KV entry. Per-request login means we only store the
#    credentials; the FB Bearer token is freshly minted each request
#    and reaped immediately after.
wrangler kv key put --binding=KEYS --env=production "$KEY" \
    "$(jq -n --arg u "andrew.doenau" \
              --arg p "<their-FB-password>" \
              --arg n "Andrew Doenau" \
              '{fbUsername:$u, fbPassword:$p, appName:"Quick Order", appId:102, displayName:$n}')"
```

On Windows cmd, use this one-liner (no jq):
```cmd
npx wrangler kv key put --binding=KEYS --env=production --remote "%KEY%" "{\"fbUsername\":\"andrew.doenau\",\"fbPassword\":\"<their-FB-password>\",\"appName\":\"Quick Order\",\"appId\":102,\"displayName\":\"Andrew Doenau\"}"
```

Staff member's URL becomes:

```
https://quickorder-worker.<subdomain>.workers.dev/?key=<KEY>
```

They bookmark it. Done.

### 7. Smoke test

```bash
# Health
curl https://quickorder-worker.<subdomain>.workers.dev/health
# → {"ok":true,"version":"0.1.0","upstream":"https://fb-api.yourco.com"}

# Auth gate
curl -i https://quickorder-worker.<subdomain>.workers.dev/api/parts
# → 401 (no key)

curl -i "https://quickorder-worker.<subdomain>.workers.dev/api/parts?key=$KEY"
# → 200 with the same JSON as a direct call to FB.

# CORS — from a browser DevTools console on any random page:
fetch('https://quickorder-worker.<subdomain>.workers.dev/api/parts?key=...')
  .then(r => r.json())
  .then(console.log)
# → should print parts, NOT throw "Failed to fetch".
```

---

## Day-to-day operations

### List active keys

```bash
wrangler kv key list --binding=KEYS --env=production
```

### Revoke a key

```bash
wrangler kv key delete --binding=KEYS --env=production "<key>"
```

The staff member's bookmark immediately stops working — the next request
returns 401.

### Force a token refresh

Tokens auto-refresh on 401, so manual intervention is rarely needed.
If the staff member's FB password changes, re-provision the KV entry
(re-run step 6 with the same `KEY` — KV `put` overwrites in place).
The next request will fail to refresh against the cached (now-invalid)
token, the DO will logout + re-login with the updated KV credentials,
and the cycle stabilises on the new token within one request.

### Inspect what's stored for a key

```bash
wrangler kv key get --binding=KEYS --env=production "<key>"
```

(Hands you back the JSON blob, including the FB password if stored —
keep this off shared screens.)

---

## Local development

```bash
wrangler dev --env dev
```

Opens a local URL. KV reads/writes go against a local simulator unless you
pass `--remote`. For a true integration test, deploy to a dev environment
with `wrangler deploy --env dev` and a separate `FB_URL` pointing at a dev
Fishbowl instance.

---

## Known unknowns (to verify during implementation)

- **FB `/api/login` response shape** — the Worker's `extractToken()` probes
  `token`, `access_token`, `bearer`, `bearerToken`. If FB uses a different
  field, adjust that helper.
- **FB session lifetime** — if tokens last days, the refresh-on-401 path
  is rarely hit. If they last minutes, KV writes scale per-request — that
  may need promoting to a Durable Object later for serialised refresh.
- **Import endpoint exact path** — Phase 3 (SO submission) will hit the
  Fishbowl REST import endpoint. The Worker is fully transparent so it
  doesn't need to know the path, but the QuickOrder.htm side does.
