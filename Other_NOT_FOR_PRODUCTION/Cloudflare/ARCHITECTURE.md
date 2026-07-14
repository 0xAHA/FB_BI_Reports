# Fishbowl BI Portal — Cloudflare Architecture

A reference architecture for serving a **Fishbowl BI report** (a self-contained
HTML/JS page) to authenticated users **outside** the Fishbowl desktop client —
over the public internet — **without**:

- exposing the on-prem Fishbowl server to the internet,
- putting any Fishbowl API key, password, or session token in browser
  JavaScript,
- writing any custom backend that stores Fishbowl credentials in plaintext.

The same HTML report runs unchanged in three contexts (see **Report modes**
below); this document describes the **portal** context, which is the Cloudflare
deployment.

> This package is a **generic reference**. All hostnames, IDs, emails and
> tenant names in it are placeholders (`example.com`, `<YOUR_ACCESS_APP_AUD>`,
> `Example Co`, …). Replace them with your own values when deploying.

---

## 1. Topology

```
                         ┌──────────────────────────────────────────────┐
                         │                 Cloudflare edge               │
  End user's browser     │                                              │
  ┌───────────────┐      │   ┌───────────────┐     ┌──────────────────┐ │
  │ report.htm    │      │   │ Cloudflare    │     │ Cloudflare Pages │ │
  │ (portal mode) │─────────▶│ Access (OTP / │────▶│ static hosting   │ │
  │               │ HTTPS│   │ IdP) gate     │     │  + Pages Function│ │
  └───────┬───────┘      │   └───────────────┘     │  /api/* gateway  │ │
          │ same-origin  │                         └────────┬─────────┘ │
          │ /api/*       │                                  │ service    │
          │ (Access      │                                  │ binding    │
          │  cookie)     │                         ┌────────▼─────────┐ │
          │              │                         │ Worker           │ │
          │              │                         │ (no public URL)  │ │
          │              │                         │  • tenant resolve│ │
          │              │                         │  • rate limit    │ │
          │              │            ┌────────────┤  • proxy /api/*  │ │
          │              │   KV       │            └───┬──────────┬───┘ │
          │              │  ┌─────────▼──┐             │          │     │
          │              │  │ KEYS       │   Durable   │          │     │
          │              │  │ (per-user  │   Object    │          │     │
          │              │  │  FB creds, │  ┌──────────▼──────┐   │     │
          │              │  │  encrypted)│  │ TokenManager    │   │     │
          │              │  ├────────────┤  │ (cached FB      │   │     │
          │              │  │ TENANTS    │  │  Bearer token)  │   │     │
          │              │  │ (code→URL) │  └──────────┬──────┘   │     │
          │              │  └────────────┘             │          │     │
          └──────────────┘                             │          │     │
                         └─────────────────────────────┼──────────┼─────┘
                                                        │ HTTPS    │
                                          ┌─────────────▼──────────▼───┐
                                          │  Cloudflare Tunnel         │
                                          │  (cloudflared, on-prem)    │
                                          └─────────────┬──────────────┘
                                                        │ localhost
                                          ┌─────────────▼──────────────┐
                                          │  Fishbowl REST API         │
                                          │  http://localhost:2456     │
                                          └────────────────────────────┘
```

### The request chain, step by step

1. **Browser** loads the report from a Cloudflare Pages site (e.g.
   `https://portal.example.com`). The Pages site is protected by **Cloudflare
   Access**, so the user must pass your identity provider / one-time-PIN before
   any file is served.
2. The report runs in **portal mode** (detected by hostname). Every data call
   is a **same-origin** `fetch('/api/…')` — no cross-origin, no API key in the
   URL, no `Authorization` header from JS. The browser automatically sends the
   Cloudflare Access session cookie.
3. The **Pages Function** at `pages/functions/api/[[path]].js` catches every
   `/api/*` request. It reads the `Cf-Access-Jwt-Assertion` header, **verifies
   the JWT** against Cloudflare's public keys (JWKS) — checking signature,
   issuer, audience, and expiry — then forwards the request to the Worker over a
   **service binding**, setting `X-User-Email` from the verified `email` claim.
   It strips any client-supplied `Authorization` / `X-User-Email` so the user
   can't impersonate anyone.
4. The **Worker** (`worker/worker.js`) has **no public hostname** — it's only
   reachable through the Pages Function's service binding. It trusts
   `X-User-Email` (already verified upstream), then:
   - resolves the user's **active tenant + Fishbowl credentials** from the
     `KEYS` KV namespace (per-user, password stored **AES-GCM encrypted**),
   - gets a Fishbowl **Bearer token** from the per-tenant **TokenManager
     Durable Object** (which caches the token and serialises logins so parallel
     requests share one Fishbowl session),
   - **proxies** the original request (path + query + body) to the tenant's
     Fishbowl server.
5. The Worker reaches Fishbowl through a **Cloudflare Tunnel** (`cloudflared`
   running on the Fishbowl host). The tunnel gives the on-prem Fishbowl REST API
   a stable hostname (e.g. `https://fb-api.example.com`) **without opening any
   inbound firewall port** — the tunnel dials out to Cloudflare.
6. **Fishbowl REST API** (`http://localhost:2456` on the FB host) runs the query
   / import and returns the result back up the chain.

---

## 2. Report modes

The same report HTML runs in three modes; it detects which at load time:

| Mode | When | Data transport | Auth |
|---|---|---|---|
| `fishbowl` | Inside the Fishbowl desktop client (JxBrowser) or the iOS app | Native `runQuery` / `runQueryAsync` / `runRestApiAsync` bridges | Host session |
| `portal` | Page hostname is a known portal host (Pages site behind Access) | Same-origin `fetch('/api/…')` | Cloudflare Access cookie (no token in JS) |
| `standalone` | Anything else (dev / LAN) | Cross-origin `fetch` to the FB REST API | Bearer token from `/api/login`, held in memory |

Detection (see `pages/report-sample.htm`):

```js
const PORTAL_HOSTS = ['your-portal.pages.dev', 'portal.example.com'];
const MODE = (typeof runQuery === 'function'
           || typeof runQueryAsync === 'function'
           || typeof runRestApiAsync === 'function') ? 'fishbowl'
       : PORTAL_HOSTS.includes(location.hostname) ? 'portal'
       : 'standalone';
```

The data layer (`qp()` → `standaloneQuery()`) is identical across portal and
standalone; only the base URL and auth differ. In portal mode the base URL is
empty (same-origin) and the Access cookie authenticates; in standalone the base
URL points at the FB server and a Bearer token is attached.

---

## 3. Endpoint contract

Everything the report calls is under `/api/*` and is served (portal) by the
Pages Function → Worker, or (standalone) directly by the Fishbowl REST API.

| Endpoint | Method | Body / params | Purpose |
|---|---|---|---|
| `/api/data-query` | GET | `?query=<url-encoded SQL SELECT>` | Run a read-only query. Returns a JSON array (or `{rows\|data\|results:[…]}`). |
| `/api/login` | POST | JSON `{appName, appId, username, password}` | **standalone only** — obtain a Bearer token. Never used in portal mode. |
| `/api/import/<Type>` | POST | `text/plain` CSV body | Fishbowl CSV import (e.g. `Sales-Order`, `Customer`, `Custom-Fields`). |
| `/api/_internal/whoami` | GET | — | **portal only** — returns `{email, connections[], activeTenantId, needsLogin}`. |
| `/api/_internal/connect` | POST | JSON `{tenantId, fbUsername, fbPassword, displayName}` | **portal only** — bind a Fishbowl account to the signed-in user (validated + encrypted). |
| `/api/_internal/switch-tenant` | POST | JSON `{tenantId}` | **portal only** — change the active tenant. |
| `/api/_internal/disconnect` | POST | none = all, or JSON `{tenantId}` | **portal only** — remove a binding. |
| `/cdn-cgi/access/logout` | navigation | — | **portal only** — clear the Cloudflare Access session (Cloudflare-provided). |

The `/api/_internal/*` endpoints are the **control plane** — handled entirely
inside the Worker, never proxied to Fishbowl (except a one-off login probe at
`/connect` to validate credentials + capture the company name).

---

## 4. Identity & multi-tenancy

- **Identity = the Cloudflare Access email.** The Pages Function injects it as
  `X-User-Email` after verifying the Access JWT. The Worker keys everything off
  this email.
- **One user → many tenant bindings.** The `KEYS` KV entry for an email holds a
  list of connections, each `{tenantId, tenantName, companyName, server,
  fbUsername, encryptedPassword, displayName, connectedAt}`, plus a
  `lastTenantId` marking the active one. A user connects a tenant once
  (`/connect`); thereafter the report shows a tenant switcher.
- **Tenant registry (`TENANTS` KV).** Admin-managed map of a short tenant code
  → `{name, server}` (the tenant's tunnel hostname). End users never enumerate
  it; `/connect` resolves a code the admin gave them to a server URL. See
  `docs/TENANT_ONBOARDING.md`.
- **Password storage.** Fishbowl passwords in `KEYS` are **AES-GCM encrypted**
  with a 256-bit key held only as a Worker secret (`KEYS_ENC_KEY`). A KV leak
  alone yields nothing without that secret. Each ciphertext carries its own
  random IV.
- **Token caching.** One **TokenManager Durable Object** per `tenant:fbUsername`
  caches the Fishbowl Bearer token and serialises logins
  (`blockConcurrencyWhile`), so N parallel page queries share **one** FB session
  rather than each logging in (which Fishbowl's single-session-per-user model
  would otherwise thrash). Tokens are proactively refreshed before Fishbowl's
  idle timeout; a 401 triggers one logout-and-retry.
- **Idle logout.** The report enforces a short idle timeout by navigating to
  `/cdn-cgi/access/logout`, clearing the Access session so an unattended browser
  can't keep the connection alive to Fishbowl's default 24h Access session.

---

## 5. Security posture

- **No secrets in the browser.** In portal mode the page never holds a Fishbowl
  token, password, or API key. Auth is the Access cookie; everything else is
  server-side.
- **Defence-in-depth JWT check.** Cloudflare's edge already authenticated the
  request, but the Pages Function re-verifies the Access JWT (RS256 only;
  rejects `alg:none`/`HS256` confusion; checks `iss`/`aud`/`exp`) before trusting
  the email.
- **Private Worker.** The Worker has no public route — only the Pages Function's
  service binding can reach it, and only after Access. The Worker trusts
  `X-User-Email` precisely because that path is the only way in.
- **Anti-enumeration.** `/connect` returns one generic failure whether the
  tenant code is unknown or the credentials are wrong, so an attacker past
  Access still can't brute-force tenant codes.
- **Rate limiting.** Cloudflare rate-limit bindings cap `/connect`
  (10/min/email) and the general proxy (120/min/email).
- **No inbound firewall exposure.** The Fishbowl host runs `cloudflared`, which
  dials **out** to Cloudflare. No port is opened toward the internet.

---

## 6. Files in this package

```
Cloudflare/
├── ARCHITECTURE.md              ← this document
├── README.md                   ← deploy walkthrough / checklist
├── tenant.example.json         ← shape of a TENANTS registry entry
├── worker/
│   ├── worker.js               ← the Worker (proxy + control plane + Durable Object)
│   ├── wrangler.toml           ← Worker config (bindings, migrations, rate limits)
│   └── .dev.vars.example       ← local secret placeholders
├── pages/
│   ├── index.html              ← apex redirect to the report
│   ├── report-sample.htm       ← a generic report (open sales orders) w/ portal + mock
│   └── functions/api/[[path]].js  ← the Access-verifying /api/* gateway
└── docs/
    ├── TUNNEL_SETUP.md         ← install cloudflared on the Fishbowl host
    └── TENANT_ONBOARDING.md    ← register a tenant + provision a user
```

---

## 7. Deploy checklist (summary — full detail in README.md)

1. **Tunnel:** install `cloudflared` on the Fishbowl host, route a hostname
   (e.g. `fb-api.example.com`) → `http://localhost:2456`. See
   `docs/TUNNEL_SETUP.md`.
2. **Worker:** `cd worker`, create the two KV namespaces (`KEYS`, `TENANTS`),
   paste their IDs into `wrangler.toml`, set the `KEYS_ENC_KEY` secret, then
   `wrangler deploy --env production`.
3. **Tenant registry:** add a `TENANTS` entry mapping a tenant code to the
   tunnel hostname. See `docs/TENANT_ONBOARDING.md`.
4. **Pages:** deploy `pages/` as a Cloudflare Pages project (the report + the
   `functions/` gateway). Add a **service binding** `PORTAL_WORKER` → the Worker.
5. **Access:** create a Cloudflare Access application over the Pages hostname;
   copy the **Team domain** and **AUD tag** into
   `pages/functions/api/[[path]].js`.
6. **Report:** put your report HTML in `pages/` and add your Pages hostname to
   its `PORTAL_HOSTS` array.
