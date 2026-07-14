# Tunnel setup — expose the on-prem Fishbowl REST API

The Worker reaches Fishbowl through a **Cloudflare Tunnel** (`cloudflared`)
running on the machine that hosts Fishbowl. The tunnel gives the local REST API
(`http://localhost:2456`) a stable public hostname (e.g.
`https://fb-api.example.com`) **without opening any inbound firewall port** —
`cloudflared` dials out to Cloudflare and Cloudflare routes requests back down
that outbound connection.

> Placeholders: replace `fb-api.example.com` with a hostname on a domain you
> control in Cloudflare, and `fishbowl-api` with any tunnel name you like.

## 1. Install cloudflared

On the Fishbowl host (Windows/macOS/Linux), install `cloudflared`:
<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>

## 2. Authenticate + create the tunnel

```sh
cloudflared tunnel login          # opens a browser; pick the zone/domain
cloudflared tunnel create fishbowl-api
```

`create` writes a credentials JSON file (a tunnel secret) under the cloudflared
config dir and prints the tunnel UUID. **Treat that credentials file as a
secret** — it authenticates the tunnel.

## 3. Route a hostname to the tunnel

```sh
cloudflared tunnel route dns fishbowl-api fb-api.example.com
```

## 4. Map the hostname to the local Fishbowl API

Create the cloudflared `config.yml` (path is printed by `cloudflared tunnel
info`; commonly `~/.cloudflared/config.yml` or
`C:\Users\<you>\.cloudflared\config.yml`):

```yaml
tunnel: fishbowl-api
credentials-file: C:\path\to\<tunnel-uuid>.json

ingress:
  - hostname: fb-api.example.com
    service: http://localhost:2456
  - service: http_status:404
```

## 5. Run it (and install as a service)

```sh
cloudflared tunnel run fishbowl-api
# once verified, install so it starts on boot:
cloudflared service install
```

## 6. Verify

```sh
curl -i "https://fb-api.example.com/api/data-query?query=SELECT%201"
```

A `401`/auth error is a **success signal here** — it means the request reached
Fishbowl's REST API through the tunnel (Fishbowl is rejecting the unauthenticated
call, which is expected). A timeout or 5xx means the tunnel or Fishbowl isn't
reachable.

## 7. Point the Worker at it

Set `FB_URL` in `worker/wrangler.toml` to `https://fb-api.example.com`, and add
the matching `TENANTS` entry (see `TENANT_ONBOARDING.md`). For multi-tenant
deployments, run one tunnel per Fishbowl host, each with its own hostname
(`fb-<tenant>.example.com`), and store that hostname as the tenant's `server`.

## Notes

- Keep Fishbowl's REST API bound to `localhost` — the tunnel is the only path in.
- The tunnel credentials file and `cert.pem` are secrets; never commit them.
- Rotate by deleting and recreating the tunnel if the credentials are ever
  exposed.
