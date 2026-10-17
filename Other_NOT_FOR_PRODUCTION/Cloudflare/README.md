# Fishbowl BI Portal — Cloudflare package

A generic, deployable reference for exposing a **Fishbowl BI report** to
authenticated external users through Cloudflare, without exposing the on-prem
Fishbowl server or putting any credential in browser JavaScript.

Read **[ARCHITECTURE.md](./ARCHITECTURE.md)** first for the full picture. This
README is the deploy walkthrough.

> Everything here uses placeholders — `example.com`, `<YOUR_ACCESS_APP_AUD>`,
> `Example Co`, `your-portal.pages.dev`, etc. Replace them with your own values.
> Nothing in this package contains real infrastructure identifiers.

---

## Prerequisites

- A Cloudflare account (Workers + Pages are on the free plan; the Durable Object
  uses the SQLite-backed variant which is free-plan compatible).
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) installed
  (`npm i -g wrangler`) and `wrangler login` done.
- [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
  installed on the machine that runs Fishbowl.
- A Fishbowl server with the REST API enabled (default `http://localhost:2456`)
  and an **Integrated Application** approved for the app name/ID your report
  uses (see the report's `/api/login` call — default `Fishbowl BI Portal`, app
  ID `102`).

---

## 1. Stand up the tunnel (on the Fishbowl host)

Give the on-prem Fishbowl REST API a stable hostname without opening a firewall
port. Full steps in **[docs/TUNNEL_SETUP.md](./docs/TUNNEL_SETUP.md)**. In short:

```sh
cloudflared tunnel login
cloudflared tunnel create fishbowl-api
# route a hostname to the local FB REST API:
cloudflared tunnel route dns fishbowl-api fb-api.example.com
# config.yml maps that hostname → http://localhost:2456
cloudflared tunnel run fishbowl-api
```

Verify: `https://fb-api.example.com/api/data-query?query=SELECT%201` returns
(after login) — it should at least reach Fishbowl (a 401 is fine here; it proves
the tunnel is up).

---

## 2. Deploy the Worker

```sh
cd worker

# Create the two KV namespaces, then paste the printed IDs into wrangler.toml
npx wrangler kv namespace create KEYS    --env production
npx wrangler kv namespace create TENANTS --env production
#   → replace <KEYS_KV_NAMESPACE_ID> and <TENANTS_KV_NAMESPACE_ID> in wrangler.toml

# Set the encryption key used to encrypt stored Fishbowl passwords in KV
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put KEYS_ENC_KEY --env production   # paste the base64 string

# Point FB_URL (in wrangler.toml) at your tunnel hostname, then deploy
npx wrangler deploy --env production
```

`wrangler.toml` also declares the `TokenManager` Durable Object migration and
two rate-limit bindings — no extra steps, they apply on deploy.

Smoke test the Worker's health endpoint via the Pages Function once Pages is up
(the Worker has no public URL of its own).

---

## 3. Register a tenant

Add a `TENANTS` KV entry mapping a short **tenant code** to the tunnel hostname.
See **[docs/TENANT_ONBOARDING.md](./docs/TENANT_ONBOARDING.md)** and
[`tenant.example.json`](./tenant.example.json).

```sh
npx wrangler kv key put --binding=TENANTS --env=production \
  "exampleco" '{"name":"Example Co","server":"https://fb-example.example.com"}'
```

End users never see this namespace; you hand each user their tenant code
out-of-band, and they enter it once on first connect.

---

## 4. Deploy Pages (report + gateway)

Deploy the `pages/` directory as a Cloudflare Pages project. It contains:

- `index.html` — apex redirect to the report,
- `report-sample.htm` — the sample report (replace with your own report HTML),
- `functions/api/[[path]].js` — the `/api/*` gateway that verifies Access and
  forwards to the Worker.

```sh
cd ../pages
npx wrangler pages deploy . --project-name fishbowl-portal
```

Then in the Cloudflare dashboard:

- **Pages → your project → Settings → Functions → Service bindings:** add a
  binding named **`PORTAL_WORKER`** pointing at the Worker you deployed in step
  2. (The gateway forwards to `env.PORTAL_WORKER`.)

---

## 5. Put Cloudflare Access in front of Pages

1. **Zero Trust → Access → Applications → Add** a self-hosted app over your
   Pages hostname (e.g. `portal.example.com`). Add an identity provider / email
   OTP policy.
2. Copy two values into `pages/functions/api/[[path]].js`:
   - `ACCESS_TEAM_DOMAIN` — your team domain
     (`https://your-team.cloudflareaccess.com`),
   - `ACCESS_APP_AUD` — the application's **AUD tag** (Application → Overview →
     "Application Audience (AUD) Tag").
3. Redeploy Pages.

Now every request to the Pages site (and thus every `/api/*` call) must pass
Access first; the gateway re-verifies the JWT as defence-in-depth.

---

## 6. Wire the report

In your report HTML, add your Pages hostname to `PORTAL_HOSTS` so it detects
portal mode:

```js
const PORTAL_HOSTS = ['your-portal.pages.dev', 'portal.example.com'];
```

`report-sample.htm` shows the whole pattern end-to-end (mode detection, the
`qp()`/`standaloneQuery()` transport, and a mock-data fallback so it renders
even before the backend is live).

---

## Local development

```sh
cd worker
cp .dev.vars.example .dev.vars     # fill in KEYS_ENC_KEY (a base64 32-byte key)
npx wrangler dev --env production
```

In `wrangler dev` the rate-limit bindings are no-ops and KV/DO run locally. To
exercise the Pages Function + Worker together, use `wrangler pages dev` with the
service binding configured.

---

## Security notes

- Never commit `.dev.vars`, real KV IDs, the `KEYS_ENC_KEY`, the Access AUD tag,
  or `cloudflared` credentials. `.dev.vars` and `.wrangler/` should be
  git-ignored.
- Stored Fishbowl passwords are AES-GCM encrypted with `KEYS_ENC_KEY`; treat
  that secret like a master key.
- The Worker deliberately has no public route — do not add a `route`/`workers.dev`
  trigger. It should only be reachable via the Pages service binding.
