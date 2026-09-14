# Tenant onboarding

How an admin adds a new Fishbowl tenant (customer/site) to the portal, and how
a user connects their Fishbowl account the first time.

## Concepts

- **Tenant** — one Fishbowl server, reachable via its own tunnel hostname. Each
  tenant has a short **tenant code** (a slug the admin invents, e.g. `exampleco`).
- **`TENANTS` KV** — maps `tenant code → { name, server }`. Admin-managed; end
  users never enumerate it.
- **`KEYS` KV** — per-user Fishbowl bindings, keyed by the user's Cloudflare
  Access email. Written by the portal when a user connects; passwords stored
  AES-GCM encrypted.
- **Identity** — the user's Cloudflare Access email (from your IdP / OTP). One
  email can hold connections to several tenants.

## Admin: register a tenant

1. Stand up a tunnel for that tenant's Fishbowl host (see `TUNNEL_SETUP.md`),
   e.g. hostname `fb-exampleco.example.com`.
2. Add the `TENANTS` entry:

   ```sh
   npx wrangler kv key put --binding=TENANTS --env=production \
     "exampleco" '{"name":"Example Co","server":"https://fb-exampleco.example.com"}'
   ```

   (Key = tenant code; value shape = `tenant.example.json`.)
3. Ensure the tenant's Fishbowl has the portal **Integrated Application**
   approved: Maintenance → Integrated Applications → approve the app name/ID the
   portal logs in with (default `Fishbowl BI Portal`, app ID `102`). Until it's
   approved, `/connect` returns an "integrated application has not been approved"
   message.
4. Give the user two things out-of-band: the **portal URL** and their **tenant
   code**. (The tenant code is not a secret, but it isn't discoverable from the
   UI either — this is the anti-enumeration boundary.)

## Admin: grant a user access

Access to the portal itself is governed by your **Cloudflare Access policy** —
add the user's email (or their domain/group) to the Access application's policy.
That's what lets them load the page at all. Connecting a Fishbowl account is then
self-service (below).

## User: first connect

1. Open the portal URL and pass Cloudflare Access (OTP / IdP).
2. The report calls `/api/_internal/whoami`; with no binding yet it returns
   `needsLogin: true` and the page shows a connect form.
3. The user enters their **tenant code**, **Fishbowl username**, and **Fishbowl
   password** (and an optional display name). The portal `POST`s
   `/api/_internal/connect`.
4. The Worker looks up the tenant code → server, validates the credentials
   against that Fishbowl (`/api/login`), captures the company name, logs the
   probe out, **encrypts** the password, and stores the binding in `KEYS` under
   the user's email.
5. The page reloads connected. Thereafter the user just loads the URL — the
   binding is reused and the Fishbowl token is cached server-side.

## User: multiple tenants / switching

A user who works across several Fishbowl companies connects each once; the portal
shows a tenant switcher. Under the hood:

- `POST /api/_internal/connect` — add another tenant binding.
- `POST /api/_internal/switch-tenant {tenantId}` — change the active one.
- `POST /api/_internal/disconnect` (no body) — remove all bindings;
  `{tenantId}` — remove one.
- Navigating to `/cdn-cgi/access/logout` clears the Cloudflare Access session
  entirely.

## Offboarding

- Remove the user from the Access policy (stops them loading the portal).
- Optionally delete their `KEYS` entry:
  `npx wrangler kv key delete --binding=KEYS --env=production "user@example.com"`.
- To retire a tenant: delete its `TENANTS` entry and tear down its tunnel.

## Credential-change flow

If a user's Fishbowl password changes, they just re-run **connect** with the same
tenant code — the Worker replaces that tenant's binding with the new (encrypted)
credentials.
