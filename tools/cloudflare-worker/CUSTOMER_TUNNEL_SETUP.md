# Connecting Your Fishbowl Server to the QuickOrder Portal

This guide walks you through installing a small program (Cloudflare's
`cloudflared`) on the Windows machine that runs your Fishbowl Server.
Once installed, your staff will be able to use the QuickOrder portal
from any web browser, on any device, without needing the Fishbowl
desktop client.

**Time required:** ~10 minutes
**You'll need:** A connector token (a long string of letters and
numbers) sent to you by your administrator. Treat this token like a password —
anyone who has it can connect to your tunnel.

---

## What this does

A small Windows service runs on your Fishbowl server and creates a
secure outbound connection to Cloudflare. The portal then routes
through Cloudflare to your Fishbowl REST API. No inbound firewall
holes, no public IP exposure of your server.

```
  Your Fishbowl Server                          Internet
  ──────────────────────                        ────────
  Fishbowl REST API     ◄───┐
       (localhost:2456)     │ outbound only
                            │ (HTTPS over QUIC/443)
  cloudflared (service) ────┘
                            │
                            ▼
                       Cloudflare's edge
                            │
                            ▼
                       QuickOrder portal
```

You do not need a Cloudflare account. You do not need to open any
firewall ports. Your server's IP address is never exposed.

---

## Step 1 — Install cloudflared

Open **Command Prompt as Administrator** on the Fishbowl Server
machine and run:

```cmd
winget install --id Cloudflare.cloudflared
```

If `winget` isn't available (older Windows), download the latest
`.msi` from <https://github.com/cloudflare/cloudflared/releases> and
double-click to install.

Verify the install:

```cmd
cloudflared --version
```

You should see a version number (e.g. `cloudflared version 2025.x.x`).

## Step 2 — Install the tunnel as a Windows service

Still in the **elevated Command Prompt**, run the following command,
replacing `<TOKEN>` with the token your administrator sent you:

```cmd
cloudflared service install <TOKEN>
```

The token is long (typically 200+ characters). Paste it on one line —
no quotes needed.

You should see output like:

```
INFO[0000] Using Systemd
INFO[0000] Installed cloudflared as a system service
INFO[0001] cloudflared service is now running
```

That's it. The service is installed, running, and will auto-start
on every reboot.

## Step 3 — Verify it's running

```cmd
sc query cloudflared
```

You want to see `STATE: 4 RUNNING`.

If you see `STATE: 1 STOPPED`, try starting it:

```cmd
sc start cloudflared
```

If that fails, see the troubleshooting section below.

## Step 4 — Tell your administrator you're done

Reply to your administrator with "tunnel installed". They'll do a quick check from
his end (~30 seconds) to confirm traffic is reaching your Fishbowl
server. After that, your staff can start using the QuickOrder portal.

He will also need to share a few small details with you:
- The **portal URL** (something like `https://0xaha.com/`)
- Their staff's first-time login process (Cloudflare email OTP, then
  their Fishbowl user/password).

---

## After install — what your team does

For each staff member who'll use the portal:

1. They visit the portal URL in their browser.
2. They enter their **work email address** at the Cloudflare login
   screen.
3. They receive a 6-digit code in their email; they enter it.
4. They see a "Connect your Fishbowl account" form. They enter their
   **Fishbowl username and password**. (This is encrypted before
   storage; only they can use it.)
5. From then on, that staff member opens the portal URL and is signed
   in automatically for up to 24 hours, then re-verifies email once.

If their Fishbowl password changes, they re-enter it once via the
same form.

---

## One-time admin step inside Fishbowl

The QuickOrder portal connects to Fishbowl using its **Integrated
Application** mechanism. The first time anyone tries to use the
portal, you'll see a notification inside the Fishbowl client asking
to approve the app:

- App name: `Quick Order`
- App ID: `102`

Approve it once. From then on, all staff using the portal share the
same Integrated Application approval — you don't need to approve it
again.

To do this manually in advance: open Fishbowl → **Maintenance →
Integrated Applications**. If `Quick Order` isn't listed yet, it
will appear automatically the first time the portal attempts a
connection.

---

## Troubleshooting

### Service won't start (`sc query` shows STOPPED with exit code 1067)

Sometimes the install doesn't include the right command-line
arguments. Fix manually (still in elevated Command Prompt):

```cmd
sc stop cloudflared
sc config cloudflared binPath= "\"C:\Program Files (x86)\cloudflared\cloudflared.exe\" service --token <TOKEN>"
sc start cloudflared
```

Replace `<TOKEN>` with the same token your administrator sent you. Note the space
after `binPath=` — that's required.

### Service runs but your administrator can't connect

Check the log:

```cmd
notepad "C:\Windows\System32\config\systemprofile\.cloudflared\cloudflared.log"
```

Look at the last 20 lines. Common errors:

- **"Couldn't connect to edge"** — your machine's outbound HTTPS is
  blocked, or a proxy is in the way. Cloudflare uses ports 443 and
  7844 over both TCP and UDP. Add an outbound rule to your firewall
  or check with your network admin.
- **"Tunnel credentials invalid"** — the token has been revoked or
  expired. Contact your administrator for a fresh one.
- **"Connection refused on localhost:2456"** — Fishbowl Server isn't
  running on this machine, or it's listening on a different port.
  Confirm the Fishbowl REST API is up: open
  <http://localhost:2456/api/login> in a browser ON THE FISHBOWL
  SERVER. You should see a JSON error response (login required) —
  that's expected and means the API is alive.

### Restart the service

```cmd
sc stop cloudflared
sc start cloudflared
```

### Uninstall

If you ever need to remove the tunnel:

```cmd
cloudflared service uninstall
```

The service stops; staff lose access to the portal until you
re-install or set up a different tunnel.

---

## Quick reference

| Action | Command |
|---|---|
| Check status | `sc query cloudflared` |
| Start service | `sc start cloudflared` |
| Stop service | `sc stop cloudflared` |
| View logs | `notepad "C:\Windows\System32\config\systemprofile\.cloudflared\cloudflared.log"` |
| Uninstall | `cloudflared service uninstall` |
| Check version | `cloudflared --version` |
| List tunnel info | `cloudflared tunnel info` (requires you to be logged in, normally only your administrator runs this) |

---

## Security notes

- The token your administrator sent you is **bearer auth** for this one specific
  tunnel. Don't email it around, don't paste it into screenshots,
  don't commit it to source control. Treat it like a password.
- If the token is ever compromised (laptop stolen, email forwarded,
  pasted publicly), tell your administrator and they'll rotate it. Cost: 5 minutes
  of his time + one re-run of Step 2 with the new token.
- Cloudflare can revoke a tunnel instantly from your administrator's dashboard,
  cutting off access. Useful if a customer winds down their
  arrangement.
- The tunnel only routes traffic from Cloudflare's portal to
  `localhost:2456`. It cannot be used to reach any other service or
  host on your network.
