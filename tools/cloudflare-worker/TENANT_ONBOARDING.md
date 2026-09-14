# Onboarding a New Tenant

Admin runbook for bringing a new Fishbowl customer onto the QuickOrder
portal. ~15 minutes of dashboard work on your side, plus a 2-command
install on theirs ([CUSTOMER_TUNNEL_SETUP.md](CUSTOMER_TUNNEL_SETUP.md)).

This doc assumes the portal infrastructure (Pages, Worker, KV, Access)
is already up. If you're standing it up for the first time, follow
[README.md](README.md) instead.

---

## What you need before starting

| Thing | From | Notes |
|---|---|---|
| **Tenant code (slug)** | You pick | Short, lowercase, no spaces. Examples: `acme`, `bayside`, `coastal-eng`. Used internally + typed by staff in the connect modal. |
| **Tenant display name** | The customer | Friendly label (e.g. "Acme Manufacturing"). Shown in error messages. The portal pill itself shows the FB `company.name` so this is less visible. |
| **Customer's email domain(s)** | The customer | E.g. `@acme.com`. Used in the Cloudflare Access policy. |
| **The customer's Fishbowl Server is reachable** | The customer's IT | They need to be able to install `cloudflared` on the FB host machine. |
| **Outbound HTTPS allowed on their FB host** | The customer's IT | cloudflared uses ports 443 + 7844. Standard outbound — almost never blocked. |

---

## Steps

### 1. Pick a tenant code

The tenant code is the slug your customer's staff will type into the
"Connect your Fishbowl account" modal once. Keep it short, memorable,
URL-safe. Example: `acme`.

> Treat the tenant code as a soft secret — it's not the only auth gate
> (FB credentials still required), but exposing the list of valid codes
> on the public internet would let an attacker probe each one with
> guessed FB passwords. Generic-error responses + rate limiting on
> `/api/_internal/connect` already make this hard. Don't list codes
> publicly anywhere.

### 2. Create the tunnel in Cloudflare

Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** →
**Create a tunnel**:

- **Choose connector type:** Cloudflared
- **Name:** `fb-<tenant-code>` (e.g. `fb-acme`)
- Click **Save tunnel**

You're now on the install screen showing OS choices + a long
**connector token**. Copy that token — you'll send it to the customer
in step 5. (You can come back and copy it later if needed.)

Click **Next** to configure routes (don't worry about the install
instructions on this page; the customer's setup doc covers that).

### 3. Configure the tunnel's public hostname

In the same wizard, the **Public Hostnames** tab. Click **Add a public
hostname**:

- **Subdomain:** `fb-<tenant-code>` (e.g. `fb-acme`)
- **Domain:** your registered domain (e.g. `0xaha.com`)
- **Path:** leave blank
- **Service Type:** `HTTP`
- **URL:** `localhost:2456`

Click **Save hostname**, then **Save tunnel**.

> Cloudflare auto-creates the DNS record (`fb-acme.0xaha.com` → tunnel).
> No DNS edits required.

### 4. Add the tenant to the TENANTS KV namespace

```cmd
cd /d "C:\Users\andrew.doenau\OneDrive - Fishbowl Inventory\Desktop\Git\FB_BI_Reports\tools\cloudflare-worker"

npx wrangler kv key put --binding=TENANTS --env=production --remote ^
    "<tenant-code>" ^
    "{\"name\":\"<Tenant Display Name>\",\"server\":\"https://fb-<tenant-code>.0xaha.com\"}"
```

Substitute:
- `<tenant-code>` — e.g. `acme`
- `<Tenant Display Name>` — e.g. `Acme Manufacturing`

Verify it stuck:

```cmd
npx wrangler kv key list --binding=TENANTS --env=production
```

### 5. Add the customer's email domain to the Access policy

Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** →
edit the QuickOrder application → **Policies** tab → edit the
"Fishbowl staff" policy (or whatever you named it).

In the **Include** rule:
- Add a new criterion: **Emails ending in** `@<customer-domain>`
- Save

The customer's staff can now OTP into the portal. Staff at other
domains continue to be admitted/blocked exactly as before.

> If you'd rather isolate tenants behind separate Access Applications
> (each restricted to ONE email domain), see **Tighter isolation** at
> the bottom of this doc.

### 6. Tell the customer

Email the customer's contact person:

```
Subject: QuickOrder portal setup — Acme

Hi <name>,

Two things to get the QuickOrder portal connected to your Fishbowl
server:

1. Have your IT install cloudflared on the Windows machine that runs
   Fishbowl Server. Attached is a setup guide [CUSTOMER_TUNNEL_SETUP.md].
   The connector token they'll need is:

       <paste the long connector token from step 2>

   Treat this token like a password — it grants the ability to be the
   connector for your tunnel.

2. Once that's done, ping me. I'll verify the tunnel is connecting
   from my end, then you can share these details with your staff:

   - URL:           https://0xaha.com/
   - Tenant code:   acme
   - Sign-in:       Their work email (any @<customer-domain>) +
                    one-time PIN; then their Fishbowl username +
                    password (one time).

3. ** IMPORTANT — please do this BEFORE your first staff member
   tries to connect:** Inside Fishbowl, your admin needs to
   approve the Integrated Application called "Quick Order" (app
   ID 102) under Maintenance → Integrated Applications.

   Without this, the first staff member to attempt sign-in will
   see "this Fishbowl tenant has not yet approved the QuickOrder
   integrated application". The approval is a one-time action —
   after that, all staff sign-ins work seamlessly.
```

Attach [CUSTOMER_TUNNEL_SETUP.md](CUSTOMER_TUNNEL_SETUP.md) +
the connector token via your preferred secure channel (1Password Send,
Bitwarden Send, encrypted email — NOT plain email if you can avoid it).

### 7. Verify end-to-end (after they confirm install)

```cmd
:: Tunnel is connecting
curl -i https://fb-<tenant-code>.0xaha.com/api/login
:: Expect: 4xx from Fishbowl (login required). 521/522 = tunnel down.
```

Test the connect flow yourself from an incognito browser (use a personal
email that's on the Access policy):
1. Open `https://0xaha.com/`
2. OTP in
3. Connect modal → type the tenant code + a real FB user/pwd from that tenant
4. Confirm the pill shows that tenant's company name (from `SELECT name FROM company WHERE id = 1`)
5. Confirm products + customers load

If anything fails, see Troubleshooting below.

### 8. Hand off

Tell the customer's contact:
- Their staff can now go to `https://0xaha.com/` and sign in
- First-time: OTP + tenant code (`acme`) + FB credentials
- Subsequent visits: just open the URL — auto-signed-in for 24h, then re-OTP
- FB password changes: the staff member re-enters their new password once
- They should approve the `Quick Order` integrated app inside Fishbowl

---

## Decommissioning a tenant

When a customer winds down:

1. **Disable their staff at the Access layer:** Remove their email domain
   from the Access policy include list. They can no longer OTP in.
2. **Delete the tenant from TENANTS KV:**
   ```cmd
   npx wrangler kv key delete --binding=TENANTS --env=production --remote "<tenant-code>"
   ```
3. **Delete user connections:** List `KEYS` entries and remove any that
   belonged to that tenant's staff:
   ```cmd
   npx wrangler kv key list --binding=KEYS --env=production
   npx wrangler kv key delete --binding=KEYS --env=production --remote "<staff-email>"
   ```
4. **Tear down the tunnel:** Zero Trust → Networks → Tunnels → click
   `fb-<tenant-code>` → ⋯ menu → **Delete tunnel**. Confirm.
5. **Remove DNS record:** Should be auto-removed when the tunnel is
   deleted. Double-check on the DNS tab of the zone.
6. **Tell the customer's IT:** They can `cloudflared service uninstall`
   on their FB host to clean up the now-orphaned service.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Customer staff get OTP page but their email isn't accepted | Access policy doesn't include their domain. Edit the QuickOrder Application → Policies → Include. |
| OTP works, connect modal shows "Could not connect. Check the tenant code…" | One of: tenant code typo, wrong FB user/pwd, FB host unreachable. Try the tenant code yourself with known-good FB creds to narrow it down. |
| Connect succeeds but data doesn't load (502s) | Tunnel is down OR Fishbowl REST API isn't responding. Check `cloudflared` status on the FB host and that the FB server itself is running on `localhost:2456`. |
| Tunnel `1033` from `curl` | cloudflared on the FB host is installed but not running, OR the connector token expired/was revoked. Have IT run `sc query cloudflared` and check the log at `C:\Windows\System32\config\systemprofile\.cloudflared\cloudflared.log`. |
| Repeated 401s from FB after working briefly | Fishbowl Integrated Application not approved (or was revoked). The customer's FB admin needs to approve `Quick Order` (app ID 102) under Maintenance → Integrated Applications. |
| Pill shows "Fishbowl" not the actual company name | The user is on a legacy KV entry (rare for new tenants). Have them disconnect from the pill dropdown and reconnect; the new connect flow captures `company.name` via `SELECT`. |

---

## Tighter isolation (optional)

The default setup uses **one Access Application** for `0xaha.com` and
matches every onboarded email domain via a single policy. That's fine
when the tenants trust your operational control (they all share the
same Pages site).

If you want each tenant on their own URL with their own Access policy:

1. **Custom domain per tenant:** Cloudflare Workers & Pages →
   `quickorder-portal` → Custom domains → add `acme.0xaha.com`.
2. **New Access Application for that domain:** Zero Trust → Access →
   Applications → Add an application → Self-hosted with `acme.0xaha.com`
   as the domain.
3. **Restrict the policy:** include only `@acme.com` emails.

Result: Only `@acme.com` staff can reach `acme.0xaha.com`. Even if
they know your other tenants' tenant codes, they can't reach those
tenants' sign-in page because Access blocks them at the gate.

Cost: one additional Access Application per tenant. Cloudflare's free
tier allows 50 Zero Trust users total across all apps — onboarding more
tenants pushes against this.

---

## Quick reference

| Action | Command |
|---|---|
| List tenants | `npx wrangler kv key list --binding=TENANTS --env=production` |
| Show one tenant | `npx wrangler kv key get --binding=TENANTS --env=production --remote "<code>"` |
| Add tenant | See step 4 |
| Delete tenant | `npx wrangler kv key delete --binding=TENANTS --env=production --remote "<code>"` |
| List user connections | `npx wrangler kv key list --binding=KEYS --env=production` |
| Rotate a connector token | Zero Trust → Networks → Tunnels → click the tunnel → ⋯ → **Refresh token** |
| Tail Worker logs | `cd tools\cloudflare-worker && npx wrangler tail --env production` |
| Tail Pages Function logs | `npx wrangler pages deployment tail --project-name quickorder-portal` |
