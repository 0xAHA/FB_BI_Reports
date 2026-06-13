# QuickOrder Portal — Cloudflare Worker + Pages Function

This is the auth + proxy layer that lets `SalesOrder/QuickOrder.htm`
run from any browser instead of only inside the Fishbowl desktop
client.

Two pieces of code live here:

- **`worker.js`** — a private Worker that talks to the Fishbowl REST
  API. Holds the KV namespace, the `TokenManager` Durable Object, and
  the proxy logic. Has NO public URL — it's reachable only via a
  Service Binding from the Pages Function.
- **`../../SalesOrder/functions/api/[[path]].js`** — a Cloudflare
  Pages Function that sits behind Cloudflare Access. Verifies the
  Access JWT on every request, then forwards to the Worker via the
  Service Binding with `X-User-Email` set to the verified email
  claim.

## Architecture

```
Staff browser
   │
   │  Cloudflare Access OTP — gates page load
   ▼
Pages: https://0xaha.com/ (the QuickOrder UI, static HTML)
   │
   │  same-origin fetch /api/*
   ▼
Pages Function (functions/api/[[path]].js)
   │  - Verifies Cf-Access-Jwt-Assertion against Cloudflare JWKS
   │  - Checks aud + iss + exp + nbf claims
   │  - Sets X-User-Email from the verified email claim
   │
   │  Service Binding (internal, no public URL)
   ▼
Worker (this code)
   │  - KV lookup by email → @domain → *
   │  - Per-FB-user TokenManager DO (cached FB token, serialised refresh)
   │  - Body buffered upfront so 401-retry on POST keeps the payload
   │  - Proactive refresh once cached token > 50 min old
   │
   ▼  HTTPS via Tunnel
cloudflared (Windows service, on the FB host)
   │  localhost:2456
   ▼
Fishbowl REST API
```

## Why this shape

A few constraints drove the architecture:

- **Cloudflare Access can't gate the API.** When `api.0xaha.com` was
  in front of Access, cross-subdomain `fetch()` failed — Access
  redirects to OTP, and XHR can't follow that. Solution: put the
  Pages Function at `/api/*` on the same origin as the page, so the
  Access cookie is automatically present.
- **The Worker has no public URL.** Service Binding from Pages →
  Worker is the only entry point. Removes the "anyone with X-User-Email
  header can impersonate" attack class entirely.
- **DO keyed by FB username, not email.** Multiple staff signing in
  with their own emails but sharing one FB account (e.g. shared
  `fam` user) land on the same DO and share its cached token. Without
  this, each staff member would log in independently and FB's
  single-session-per-user behaviour would have them invalidating each
  other's tokens.
- **JWT verified against JWKS, not trusted blindly.** The Pages
  Function fetches Cloudflare's JWKS (cached at the edge for 1 hour),
  verifies the RS256 signature with Web Crypto, and checks aud + iss
  + exp + nbf. Defence in depth — Cloudflare's edge already
  authenticated the request, but a verified signature ensures no
  forged-header path can sneak past.
- **Body buffered for 401 retry.** Workers request bodies are
  one-shot streams. The Worker reads the body into an ArrayBuffer
  once, then reuses it across the initial attempt + the 401-retry.
  Without this, SO submits would silently lose the CSV body on a
  stale-session refresh and create an empty order.

## Bindings

### Worker (`worker.js`)

Configured in `wrangler.toml`:

| Binding         | Type                 | Purpose                                          |
|-----------------|----------------------|--------------------------------------------------|
| `KEYS`          | KV namespace         | email / @domain / * → FB credentials JSON        |
| `TOKEN_MANAGER` | Durable Object       | Per-FB-user cached token + serialised refresh    |
| `FB_URL`        | env var              | Tunnel hostname for the FB REST API              |
| `WORKER_VERSION`| env var              | Surfaced at `/health` for cache-bust visibility  |

### Pages Function (`SalesOrder/functions/api/[[path]].js`)

Configured in the Pages project dashboard → Settings → Bindings:

| Binding             | Type            | Purpose                                       |
|---------------------|-----------------|-----------------------------------------------|
| `QUICKORDER_WORKER` | Service binding | Forward to the private Worker (entrypoint: default) |

The Function also hardcodes two values at the top of the file —
update these if you re-create the Access Application or move teams:

| Constant              | Where to find it                                              |
|-----------------------|---------------------------------------------------------------|
| `ACCESS_TEAM_DOMAIN`  | Zero Trust → Settings → Custom Pages. Always `https://<team>.cloudflareaccess.com` |
| `ACCESS_APP_AUD`      | Zero Trust → Access → Applications → your app → Overview → "Application Audience (AUD) Tag" |

## KV: how staff get mapped to FB credentials

The Worker tries three lookups in order — first hit wins:

1. **Exact email** — `KEYS["andrew.doenau@fbinv.com"]`. Use for
   per-user mappings (best audit trail).
2. **Domain wildcard** — `KEYS["@fbinv.com"]`. Use to onboard a team
   that shares one FB account.
3. **Global fallback** — `KEYS["*"]`. Last resort. Only set if you
   trust every email the Access policy admits.

Each entry is a JSON object:

```json
{
  "fbUsername":  "<fb-username>",
  "fbPassword":  "<fb-password>",
  "appName":     "Quick Order",
  "appId":       102,
  "displayName": "Fishbowl Staff"
}
```

`appName` + `appId` are the Integrated Application credentials
registered in Fishbowl → Maintenance → Integrated Applications.
QuickOrder.htm registers as `(Quick Order, 102)` by default — the
same IA approval covers both this portal and the desktop QuickOrder.

---

## One-time setup

### 1. cloudflared on the Fishbowl host

On the Windows machine that runs Fishbowl Server:

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login                  # opens browser; pick your domain
cloudflared tunnel create fb-api          # note the UUID + credentials JSON path
```

Create `C:\Users\<you>\.cloudflared\config.yml`:

```yaml
tunnel: <tunnel-uuid>
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-uuid>.json

ingress:
  - hostname: fb-api.0xaha.com           # change to your domain
    service: http://localhost:2456
  - service: http_status:404
```

Route DNS:

```powershell
cloudflared tunnel route dns fb-api fb-api.0xaha.com
```

Install as a Windows service so it survives reboots:

```powershell
cloudflared service install
```

**Gotcha:** the service runs as `LocalSystem`, whose home dir is
`C:\Windows\System32\config\systemprofile\.cloudflared\`. `cloudflared
service install` usually copies the config across automatically, but
sometimes you need to do it manually:

```cmd
set SVCDIR=C:\Windows\System32\config\systemprofile\.cloudflared
if not exist "%SVCDIR%" mkdir "%SVCDIR%"
copy "%USERPROFILE%\.cloudflared\config.yml"   "%SVCDIR%\" /Y
copy "%USERPROFILE%\.cloudflared\*.json"       "%SVCDIR%\" /Y
copy "%USERPROFILE%\.cloudflared\cert.pem"     "%SVCDIR%\" /Y
sc stop cloudflared
sc start cloudflared
```

Another gotcha: in some versions `cloudflared service install`
configures the service with no command-line args (i.e. just runs
`cloudflared.exe` with nothing). Fix manually:

```cmd
sc config cloudflared binPath= "\"C:\Program Files (x86)\cloudflared\cloudflared.exe\" --config \"C:\Windows\System32\config\systemprofile\.cloudflared\config.yml\" tunnel run"
sc start cloudflared
```

Verify:

```cmd
sc query cloudflared              :: STATE: 4 RUNNING
cloudflared tunnel info fb-api    :: should show active connectors
curl -i https://fb-api.0xaha.com/api/login   :: 4xx from FB = tunnel OK
```

### 2. Cloudflare Access

Zero Trust → **Access** → **Applications** → **Add an application** →
**Self-hosted**:

- **Application name:** `QuickOrder`
- **Session duration:** 24 hours (or whatever you prefer)
- **Application domains:**
  - `0xaha.com` (path blank — covers everything including `/api/*`)
- **Identity providers:** One-time PIN (default; built in)
- **Policy:** Allow, emails ending in `@fbinv.com` (plus any
  explicit personal addresses)

Copy the **Application Audience (AUD) Tag** from the Overview tab —
paste into `ACCESS_APP_AUD` at the top of `[[path]].js`.

Confirm Cloudflare's team domain — usually
`https://<your-team>.cloudflareaccess.com`. Set `ACCESS_TEAM_DOMAIN`
in `[[path]].js`.

### 3. Worker

KV namespace:

```cmd
cd tools\cloudflare-worker
npx wrangler kv namespace create KEYS
:: paste the printed id into wrangler.toml under [[env.production.kv_namespaces]]
```

Set `FB_URL` in `wrangler.toml` to your tunnel hostname. Bump
`WORKER_VERSION` whenever you deploy.

Deploy:

```cmd
npx wrangler deploy --env production
```

The first deploy auto-runs the `[[migrations]]` block in
`wrangler.toml` to create the `TokenManager` SQLite-backed DO class.

Make the Worker private — dashboard → Workers & Pages →
`quickorder-worker-production` → **Settings** → **Domains & Routes**:

- Remove any custom domain rows (e.g. the old `api.0xaha.com`)
- Disable the `workers.dev` subdomain toggle

Now the Worker is reachable only via service binding.

### 4. Pages project

The Pages project (`quickorder-portal`) holds the static HTML and
the auth gateway Function.

Deploy from inside the Pages source directory so Wrangler picks up
the `functions/` subdirectory:

```cmd
cd SalesOrder
npx wrangler pages deploy . --project-name quickorder-portal --branch main
```

You should see `✨ Compiled Worker successfully` and `Uploading
Functions bundle` in the output — that confirms the Function was
bundled.

Bindings — dashboard → Workers & Pages → `quickorder-portal` →
**Settings** → **Bindings** (or **Functions** → **Service bindings**):

- Add **Service binding**:
  - Variable name: `QUICKORDER_WORKER`
  - Service: `quickorder-worker-production`
  - Entrypoint: `default`

Custom domains — Pages → `quickorder-portal` → **Custom domains** →
add `0xaha.com` (or whatever your staff URL is).

### 5. Provision your first tenant

Each Fishbowl install you proxy to is a "tenant" — a TENANTS KV
entry mapping a short tenant code (slug you pick) to its FB server
URL. Create the TENANTS namespace + seed one entry for your own
Fishbowl:

```cmd
cd tools\cloudflare-worker

:: Create the namespace (only needed once; if it already exists,
:: `wrangler kv namespace list` will show it)
npx wrangler kv namespace create TENANTS --env production

:: Paste the printed id into wrangler.toml under [[env.production.kv_namespaces]] binding="TENANTS"

:: Seed the first tenant. The tenant code (here "hq") is what users
:: type into the QuickOrder connect modal.
npx wrangler kv key put --binding=TENANTS --env=production --remote ^
    "hq" ^
    "{\"name\":\"Fishbowl HQ\",\"server\":\"https://fb-api.0xaha.com\"}"
```

Each additional tenant (real customer or test) gets its own slug +
TENANTS entry pointing at THEIR tunnel hostname.

> The KEYS namespace stays empty initially — staff self-populate it
> when they go through the connect flow. No admin-provisioned
> credentials.

### 6. Smoke test

In an incognito browser window, visit `https://0xaha.com/`:

1. Cloudflare Access OTP page → enter your email → get code → enter it
2. QuickOrder page loads + shows the "Connect your Fishbowl account" modal
3. Enter your tenant code (e.g. `hq`), your Fishbowl username, password, optional display name → Connect
4. Page reloads; header pill shows your FB company name (from `SELECT name FROM company WHERE id = 1`)
5. Products + customers load (data flows through Pages Function → Worker → Tunnel → FB)
6. Click the pill → see your active connection + "Connect another tenant" option
7. Sit idle for 8 minutes → an amber countdown pill appears (`2:00`) → ticks down → after 10 min total idle, page logs you out

---

## Day-to-day ops

### List provisioned tenants

```cmd
npx wrangler kv key list --binding=TENANTS --env=production
```

### Add a new tenant

```cmd
npx wrangler kv key put --binding=TENANTS --env=production --remote ^
    "<tenant-code>" ^
    "{\"name\":\"<Display Name>\",\"server\":\"https://<their-tunnel-host>\"}"
```

Then tell the customer's staff: the tenant code is `<tenant-code>`,
URL is `https://0xaha.com/`. They each go through the connect modal
once with their own FB user/password.

### Remove a tenant

```cmd
npx wrangler kv key delete --binding=TENANTS --env=production --remote "<tenant-code>"
```

Existing connected users keep working until their cached connection
fails (FB password change, etc.); to force them out, also delete
their KEYS entries (see below) and/or remove their email domain
from the Access policy.

### List user connections

```cmd
npx wrangler kv key list --binding=KEYS --env=production
```

Each key is a staff email; value is `{ lastTenantId, connections: [...] }`
where each connection holds an encrypted FB password.

### Revoke a user

```cmd
npx wrangler kv key delete --binding=KEYS --env=production --remote "<email>"
```

Their next page load returns 403 + the connect modal. Loading the
static page still works (Cloudflare Access lets them through) but
no data flows.

To lock them out at the Access layer entirely (no OTP), edit the
Access Application → Policies → remove their email or domain.

### Rotate an FB password

End-users self-recover: when FB rejects the cached password, the page
re-shows the connect modal. The user types the new password, the
connection updates, done. No admin action needed.

To force re-onboarding for a specific user (e.g. their PC was lost),
delete their KEYS entry as above — their next visit shows the
connect modal pre-filled with the tenant code from the previous
session.

### Inspect a user's stored connections

```cmd
npx wrangler kv key get --binding=KEYS --env=production --remote "<email>"
```

The FB passwords are AES-GCM-encrypted ciphertext — readable bytes
on screen are useless without the `KEYS_ENC_KEY` Worker secret.
Still, don't run this on shared screens.

### Tail Worker / Function logs

```cmd
npx wrangler tail --env production quickorder-worker
npx wrangler pages deployment tail --project-name quickorder-portal
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Load failed: Unexpected token '<'` in the browser | Pages Function isn't routing — `/api/*` is falling through to static. Re-deploy from inside `SalesOrder/` (NOT the repo root) so Wrangler sees the `functions/` directory. |
| `"Not authenticated via Cloudflare Access"` | Pages Function didn't see the JWT. Either Access isn't in front of this path (check Application Domains include `0xaha.com` with empty path), OR you're hitting the `pages.dev` URL instead of `0xaha.com`. |
| `"JWT audience mismatch"` | `ACCESS_APP_AUD` in `[[path]].js` doesn't match your Access Application's AUD. Update + redeploy. |
| `"JWT issuer mismatch"` | `ACCESS_TEAM_DOMAIN` is wrong. Should be `https://<team>.cloudflareaccess.com`. |
| `"no Fishbowl account is mapped to that address"` | KV has no entry for the user's email, domain, OR `*`. Provision one (see Step 5 above). |
| `1033` from `fb-api.0xaha.com` | cloudflared service not running on the FB host. `sc query cloudflared` → if not RUNNING, see Step 1 gotchas. |
| `502 FB login failed` | KV `fbUsername`/`fbPassword` is wrong, OR the Fishbowl Integrated Application isn't approved. Check Fishbowl → Maintenance → Integrated Applications. |
| Random `401`s every ~50 min | The cached token's age hit the proactive-refresh threshold and refresh failed. Check `MAX_TOKEN_AGE_SECONDS` and the IA still being valid in FB. |
| Multiple FB sessions accumulating | DO key collision — verify `TokenManager.idFromName('fb:' + fbUsername)` is being used, not the email. Multiple users sharing one FB account MUST share one DO or they fight each other's sessions. |

---

## Local development

```cmd
:: Worker dev (no public URL, just local hot reload)
cd tools\cloudflare-worker
npx wrangler dev --env production

:: Pages dev (with Functions)
cd SalesOrder
npx wrangler pages dev .
```

For end-to-end testing with real Access, deploy to a separate Pages
project + Worker in your dev account.
