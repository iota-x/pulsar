# Publishing Pulsar — Mac + Tailscale Funnel (free public HTTPS)

Runs the whole stack on one Mac and serves it to the public internet over HTTPS,
for free — no domain, no port-forwarding, no static IP. The frontend is published
on port **443** and the backend API on port **8443** of the same Tailscale hostname
(Funnel allows ports 443 / 8443 / 10000), which avoids any reverse-proxy or path
rewriting.

```
Everyone ──HTTPS──> <host>.<tailnet>.ts.net:443   → frontend (localhost:3000)
                    <host>.<tailnet>.ts.net:8443  → backend  (localhost:4000)
```

## 0. Prerequisites
- **Docker Desktop** — install, and enable *Settings → General → "Start Docker Desktop when you sign in"* (so it survives reboots).
- **Tailscale** — `brew install tailscale` (or the app from tailscale.com), then `tailscale up`.
- In the Tailscale admin console (login.tailscale.com):
  - **DNS** tab → enable **MagicDNS** and **HTTPS Certificates**.
  - **Funnel** must be allowed for the tailnet — the first `tailscale funnel` command prints a link to approve it.

## 1. Find your public hostname
```bash
tailscale status        # your node's name; full URL is <host>.<tailnet>.ts.net
```
e.g. `https://minis-mac.tail1a2b3c.ts.net`. The frontend will be on `:443`, the API on `:8443`.

## 2. Point the app at that hostname
Edit `.env` (it's already in the folder you copied):
```
PUBLIC_API_URL=https://<host>.<tailnet>.ts.net:8443
CORS_ORIGIN=https://<host>.<tailnet>.ts.net
```

## 3. Build + start the stack
The frontend bakes `PUBLIC_API_URL` at build time, so rebuild after step 2:
```bash
docker compose -f docker-compose.prod.yml up -d --build
curl http://localhost:4000/health     # -> {"status":"ok"}
```

## 4. Publish both services with Funnel
```bash
tailscale funnel --bg --https=443  localhost:3000   # frontend
tailscale funnel --bg --https=8443 localhost:4000   # backend API
tailscale funnel status                              # shows the public URLs
```

## 5. Share the link
Open **`https://<host>.<tailnet>.ts.net`** — anyone can visit, register, and build
workflows. Still devnet, so no real funds are at risk.

## Turning it off
```bash
tailscale funnel --https=443 off
tailscale funnel --https=8443 off
```

## Notes & caveats
- **Reboot-proof:** Docker `restart: unless-stopped` + Docker-start-on-login keep the
  stack up; `tailscale funnel --bg` persists as a background service.
- **Fresh database:** this stack has its own internal Postgres volume — it starts
  empty; register a new account.
- **Rate limiting** is Redis-backed and keyed per **user** on authed routes and per
  **email** on login — so it stays per-visitor even if the proxy collapses client IPs.
  Only registration is IP-keyed; if IP-based limits look off behind Funnel, set
  `TRUST_PROXY` in `.env` to the real number of proxy hops (default 1) and restart the
  backend.
- **Funnel is for reasonable personal/demo use** — it is not a CDN.
