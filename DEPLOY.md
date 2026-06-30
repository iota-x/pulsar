# Deploying Pulsar for free (single always-on box)

This runs the **entire stack** — frontend, backend API, worker, trigger service,
Postgres and Redis — on one machine with Docker Compose. The recommended free
host is an **Oracle Cloud "Always Free" VM**, but any Linux box with Docker works
(a VPS, a spare PC, a Raspberry Pi 4).

```
┌────────────────────── one VM ──────────────────────┐
│  frontend :3000   backend :4000   worker   trigger  │
│         └──────── Postgres ──── Redis ───────┘      │
└─────────────────────────────────────────────────────┘
```

---

## 1. Get a free VM

[Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) → create a compute
instance:

- **Shape:** `VM.Standard.A1.Flex` (Ampere ARM — always free). Give it **2 OCPU /
  ~8 GB RAM** (free allowance covers up to 4 OCPU / 24 GB). 1 GB is too small to
  build the frontend.
- **Image:** Ubuntu 22.04.
- Save the SSH key, note the **public IP**.

> Signup needs a card for identity (no charge on the free tier). If the ARM shape
> says "out of capacity," try another availability domain/region or retry later.

## 2. Open the ports

Two firewalls to open for **TCP 3000 and 4000**:

1. **Cloud side** — VCN → Security List → add Ingress rules: source `0.0.0.0/0`,
   TCP, dest ports `3000` and `4000`.
2. **On the VM:**
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 4000 -j ACCEPT
   sudo netfilter-persistent save     # persist across reboots
   ```

## 3. Install Docker

```bash
ssh ubuntu@YOUR_VM_IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker     # run docker without sudo
```

## 4. Clone & configure

```bash
git clone <your-repo-url> pulsar && cd pulsar
cp .env.example .env
nano .env
```

In `.env`, set at minimum:

- `PUBLIC_API_URL=http://YOUR_VM_IP:4000` and `CORS_ORIGIN=http://YOUR_VM_IP:3000`
- `POSTGRES_PASSWORD` + the matching password inside `DATABASE_URL`
- `JWT_SECRET` (a long random string)
- `SOLANA_SIGNER_SECRET_KEY` (optional — only if you want on-chain actions to run)

## 5. Build & launch

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build takes a few minutes (installs deps, generates Prisma, builds Next).
It runs migrations automatically (the one-shot `migrate` service), then starts
everything.

```bash
docker compose -f docker-compose.prod.yml ps      # all "Up"? migrate "Exited (0)"
docker compose -f docker-compose.prod.yml logs -f backend
```

## 6. Use it

Open **http://YOUR_VM_IP:3000** → sign up → build a workflow. The API is at
`http://YOUR_VM_IP:4000`.

To enable on-chain actions, fund the signer (see its pubkey in the worker logs:
`[solana] signer loaded: …`):

```bash
solana airdrop 2 <SIGNER_PUBKEY> --url devnet   # or https://faucet.solana.com
```

## 7. Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 8. (Optional) HTTPS + a domain — included, free

Direct IP + port is HTTP-only. For `https://yourdomain.com`, the stack ships a
**Caddy** service that auto-provisions and renews a free **Let's Encrypt** cert.
No domain? A free **DuckDNS** subdomain (`yourname.duckdns.org`) works fine.

1. Point your domain's **DNS A-record at the VM's public IP**.
2. Open **ports 80 and 443** (same firewall steps as §2; you can now close 3000/4000).
3. In `.env`:
   ```ini
   DOMAIN=yourdomain.com
   PUBLIC_API_URL=https://yourdomain.com/api
   CORS_ORIGIN=https://yourdomain.com
   ```
4. Launch with the https profile (rebuilds the frontend with the new API URL):
   ```bash
   docker compose -f docker-compose.prod.yml --profile https up -d --build
   ```

Caddy serves the frontend at `/` and proxies the API under `/api/*`. Visit
**https://yourdomain.com** — the cert is issued automatically on first request
(give it a few seconds). Certs renew themselves; nothing else to do.

## Troubleshooting

| Symptom                           | Fix                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Frontend loads but API calls fail | `PUBLIC_API_URL` wrong → fix `.env`, **rebuild** (it's baked into the build). Check `CORS_ORIGIN`. |
| `migrate` keeps restarting        | DB not ready / wrong `DATABASE_URL` password. Check `docker compose logs postgres`.                |
| Build killed / OOM                | VM has too little RAM — use ≥4 GB.                                                                 |
| On-chain actions are "simulated"  | `SOLANA_SIGNER_SECRET_KEY` empty or unfunded.                                                      |
| Public RPC 429s                   | Expected under load — add a free Helius/QuickNode RPC URL.                                         |

## Notes on "free"

- Oracle Ampere + this stack is genuinely $0/month and always-on.
- Stay on **devnet** to avoid real costs; the public Solana RPC is free but rate-limited.
- Back up the program upgrade keypair if you redeploy the Anchor program (it's the
  worker signer here, kept in `SOLANA_SIGNER_SECRET_KEY`).

## Going to mainnet (delegated swaps)

The `execute_buy_sell_order` action supports a **non-custodial delegated swap** that
only works on mainnet (Jupiter routes mainnet liquidity; on devnet the quote returns
"no route"). To enable it:

1. Set `SOLANA_RPC` to a mainnet endpoint and redeploy the Anchor program to
   mainnet-beta (update `WEB3_ZAPIER_PROGRAM_ID` / `NEXT_PUBLIC_PROGRAM_ID`).
2. Fund the worker signer (operator) with a little SOL for fees — keep it a hot
   wallet with minimal balance. **Never commit a mainnet key.**
3. A user links their wallet, then on the **Wallet** page authorizes the input token
   (the token they're selling, or wSOL via "Delegate SOL" if they're buying). For
   swap-delegations, leave the recipient allowlist empty (or include the operator),
   since the pull's intermediate destination is the operator's account.
4. In a workflow, pick **Execute a buy/sell order** and tick **Use my own wallet
   (delegated)**.

When the trigger fires, the worker builds ONE atomic transaction: pull the user's
delegated token (capped by the delegation) → swap via Jupiter → deliver the output
straight to the user. If any step fails the whole tx reverts, so the operator never
custodies funds beyond the atomic boundary. The amount is always bounded by the
on-chain delegation cap — the user can revoke anytime from their wallet.

### Rolling per-period caps

Delegations support a **rolling cap window** (Wallet page → "Cap window"): instead of
a single lifetime cap, the user can authorize e.g. "max 5 per day". The on-chain
`Delegation` account tracks `period_seconds` + a window counter that resets once the
window elapses, so a compromised operator can drain at most one window's worth before
the user notices and revokes — a much smaller blast radius than a lifetime cap.

> **Account layout changed** with this feature. After upgrading the program, any
> delegations created by the _previous_ version must be revoked and re-created (their
> on-chain accounts predate the new fields). On devnet just revoke + re-authorize from
> the Wallet page.

## High availability (production)

The single-VM setup survives _process/container_ crashes (Docker `restart` + the
watcher's leader election + Redis Sentinel) but not a _machine_ failure. Everything is
already built to span hosts — services coordinate through Redis, so going multi-host is
**configuration, not code**:

1. **Trigger-service (the watcher)** already runs 2 replicas with Redis leader election:
   only the leader watches/enqueues; a standby takes over in ~12s. For machine-HA, run
   those replicas on **separate hosts** — they just need the same Redis.

2. **Redis** is the coordinator + queue, so it must be HA too. Use
   `docker-compose.redis-ha.yml` (Sentinel: primary + 2 replicas + 3 sentinels) spread
   **across hosts**, or a managed HA Redis (Upstash / ElastiCache / Redis Cloud). Then:
   - `REDIS_SENTINELS=host1:26379,host2:26379,host3:26379` + `REDIS_MASTER_NAME=mymaster`, or
   - `REDIS_URL=<managed-endpoint>`

   No app changes — every service uses the shared Sentinel-aware connection builder.

3. **RPC** — a dead RPC blinds the watcher even when it's healthy. Give it 2+ providers
   (same cluster): `SOLANA_RPC_URLS=https://your-helius,https://your-alchemy`. It probes
   the active endpoint and rotates on an unreachable _or_ stalled node.

4. **Workers** are stateless and horizontally scalable — run as many as you want. BullMQ
   distributes jobs and the worker's exactly-once claim prevents double-execution; no
   leader needed.

5. **Backend / frontend** are stateless — run multiple behind a load balancer.

**Minimal production HA:** two hosts, each running a trigger replica + worker(s) +
backend, a 3-node Sentinel Redis (or managed), and `SOLANA_RPC_URLS` with two providers.
Any single host — or RPC, or the Redis primary — can then fail without stopping automations.
