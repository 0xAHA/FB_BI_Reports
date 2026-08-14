# Local browser preview

Run a BI report in a normal browser (Chrome/Edge, with DevTools) instead of the
Fishbowl client's embedded JxBrowser.

**One file, no install:**

```
SalesOrder\QuickOrder-Preview.bat
```

Double-click it. A console window opens, the browser opens on QuickOrder, and
closing the console stops the server. Requires Node.js on PATH; nothing else.

## It is self-contained

The Node server is carried as a **payload at the bottom of the `.bat`** and
extracted to `%TEMP%\fb-preview-serve.js` at run time (deleted on exit). Nothing
needs to sit beside it — copy the single file anywhere and it still works.

The payload is plain text after a `//__FBPREVIEW_JS__` marker. `cmd` stops at
`exit /b` well above it, so it is never parsed as batch and needs no escaping;
a one-line PowerShell call slices it out. To edit the server, edit the bottom
half of the `.bat` — it is ordinary JavaScript and diffs normally.

## It is self-locating

It serves **its own folder**, whatever that is:

| Where you put it | What it serves | What it opens |
|---|---|---|
| Beside `QuickOrder.htm` | that folder | `QuickOrder.htm` |
| Beside exactly one `.htm` | that folder | that report |
| Beside several `.htm` | that folder | a pick-list |
| Anywhere else | that folder | a folder listing |

Override with an argument:

```bat
QuickOrder-Preview.bat Inv_Reorder_Watchlist.htm
```

Because it serves one folder, a report that pulls in a sibling asset by
relative path (`../scripts/fb-lib.js`) needs the `.bat` at a level where that
path still resolves. QuickOrder is fully self-contained, so this does not apply
to it.

## Why it isn't just "open the .htm"

Fishbowl's REST server (Jetty) accepts **same-origin requests only**. Measured
against the live server on port 2456:

| Origin the browser sends | Result |
|---|---|
| `http://localhost:2456` | 200 |
| `http://localhost:3000` | 403 `Invalid CORS request` |
| `null` (a `file://` page) | 403 `Invalid CORS request` |

So a report opened straight off disk can render, but every query fails — no
browser flag changes that short of disabling web security entirely.

The embedded server fixes it by putting both halves on one origin: it serves the
folder on `http://localhost:8731` **and** reverse-proxies `/api/*` to `http://localhost:2456`.
The browser sees one origin and never runs a CORS check. This is the same shape
as the Cloudflare Pages Function behind QuickOrder's `portal` mode, just local
and dependency-free (Node built-ins only — no `npm install`).

## What the report sees

QuickOrder already detects its host. With no Fishbowl bridges present it selects
`MODE = 'standalone'` and drives the REST API directly, so **no report changes
are needed** — the `.htm` on disk stays byte-identical to what gets pasted into
Fishbowl.

Click **Connect** in the header and log in with your Fishbowl credentials. The
server URL is pre-seeded to this origin; the report's own default
(`http://localhost:2456`) is the one value that can never work from a browser,
so it is overwritten. That seeding is a `<script>` injected into the served HTML
at request time — nothing is written to the file.

Reports that call Fishbowl-only bridges (`getAutoPo`, `getIcon`, `openModule`,
`runApiRequest`) will degrade where those are used. Reports that guard with
`typeof x === 'function'` degrade cleanly; ones that assume the bridge exists
will throw.

## Options

| Variable | Default | Purpose |
|---|---|---|
| `FB_PORT` | `8731` | Starting port. If it's taken, the server steps up to the next free one (up to +10) and opens the browser on the port it actually got |
| `FB_URL` | set in the `.bat` | Fishbowl server to proxy to. **Normally edited in the `.bat` itself** — one clearly marked line near the top. Local or hosted; `https://` strongly preferred for anything off-machine, since the login carries the password |
| `FB_TLS13` | *(unset)* | Set to `1` to allow TLS 1.3 upstream. Off by default — see below |
| `FB_INSECURE` | *(unset)* | Set to `1` to skip TLS certificate verification (self-signed servers only, trusted networks only) |
| `FB_READONLY` | *(unset)* | Set to `1` to refuse forwarding POST/PUT/DELETE |

```bat
set FB_READONLY=1
SalesOrder\QuickOrder-Preview.bat
```

## Hosted servers, and the TLS 1.3 workaround

A hosted Fishbowl works exactly like a local one — point `FB_URL` at it. The
browser still only ever talks to `localhost`; only the preview process talks to
Fishbowl, and server-to-server calls are not subject to CORS. Fetching a hosted
server *directly* from the page can never work: measured against one, it sends
no `Access-Control-Allow-*` headers and 403s every origin but its own.

**Upstream TLS is capped at 1.2 by default.** Against a hosted Fishbowl, six
identical requests each way:

| Upstream TLS | Result |
|---|---|
| 1.3 (Node's default) | **2/6** — the rest died mid-write, `EPROTO … packet length too long` |
| 1.2 (pinned) | **6/6** |

Reproduced with a bare `https.request` outside the proxy, so it is the far end's
TLS 1.3 stack, not the harness. 1.2 with a verified certificate is still fully
encrypted. `FB_TLS13=1` opts back in if a server ever needs it.

## Security

**Read this before pointing the harness at anything you care about.**

This is a **developer desk tool**. It is not hardened, not authenticated, and
not intended for any machine other than the developer's own workstation. Do not
ship it to a customer, install it on a server, or run it on a shared host.

### 1. It defeats a browser security control on purpose

The proxy strips the `Origin` and `Referer` headers so Fishbowl's CORS filter
stops rejecting the request. That filter exists to stop a browser page from
reaching the ERP cross-origin — **this tool's entire function is to get around
it.** That trade is acceptable on a local dev box and nowhere else.

The proxy does not add `Access-Control-Allow-Origin` headers of its own, so an
arbitrary website still cannot *read* responses from it. But see (4).

### 2. A live Fishbowl session token sits in browser localStorage

On login, QuickOrder persists `{baseUrl, username, appName, appId, token}` to
`localStorage` under `cdx.bi.fbconn.v1`. Consequences:

- Your **password is never stored** (used once for `/api/login`, then dropped) —
  but the **bearer token is**, in plaintext, and survives closing the browser.
- **Disconnect is local-only.** `disconnectStandalone()` nulls the token and
  clears storage; there is no `/api/logout` call anywhere in the report, so the
  token likely stays valid server-side until it expires on its own. Disconnecting
  is not revoking.
- On a shared or unattended machine, the next person at that browser profile
  resumes your session. Clear site data, or use a browser profile you control.

### 3. Writes reach the real database

Writes are forwarded by default, because QuickOrder exists to create sales
orders and blocking them would break the app. A preview session can create real
records — including through `/api/import`, a broad endpoint — in whatever
database `FB_URL` names.

- Point `FB_URL` at a test/demo server, or set `FB_READONLY=1`, when you only
  want to look.
- Anything created is **indistinguishable from normal user activity** in
  Fishbowl's audit trail. Nothing marks it as harness traffic; cleanup is manual.

### 4. Loopback is not the same as private

Binding `127.0.0.1` keeps the proxy off the network, but **every process and
every user account on the machine can still reach it**. It is an unauthenticated
hop to Fishbowl for anything running locally.

The one thing worth actually fixing rather than disclaiming: **the embedded
server does not validate the `Host` header**, so it is exposed to DNS rebinding — a hostile
site can rebind its own name to `127.0.0.1`, at which point the browser treats
the harness as same-origin and CORS no longer protects the responses. The damage
is bounded (the attacker's origin has no access to the token in *this* origin's
localStorage, so they get 401s), but the gap is real.

### 5. A normal browser is a less trustworthy host than Fishbowl

Running outside JxBrowser means **browser extensions with host permissions can
read the page, its DOM, and its localStorage** — including the token and any
customer, pricing, or cost data on screen. DevTools' Network tab likewise shows
full request URLs (the SQL sent to `/api/data-query`) and the `Authorization`
header. The console window logs paths only, with query strings stripped.

### 6. `FB_READONLY` is a guard, not a security control

It only inspects the HTTP method, and anyone can restart without it. Treat it as
a seatbelt against your own slips, not as a boundary.

### 7. No transport encryption

Everything is plain HTTP. That is fine over loopback, but if `FB_URL` is ever
pointed at a **remote** `http://` server, the login POST carries your Fishbowl
username and password across the network in clear text. Don't.

### 8. SQL reaches the database as written

`/api/data-query` takes whatever SQL the page sends, and the proxy forwards it
verbatim. The SELECT-only restriction is enforced by **Fishbowl**, not by this
harness — the harness adds no validation of its own.

### What is guarded

- Static serving is confined to the repo root; `../` escapes are rejected
  (verified: encoded and unencoded).
- The listener binds `127.0.0.1` explicitly, never `0.0.0.0`.
- Proxy logs strip query strings, so SQL and tokens do not reach the console.
- The report file on disk is never modified.
