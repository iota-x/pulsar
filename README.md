# ⚡ Web3 Zapier

Automation workflows for the Solana ecosystem — **IF this happens on-chain → THEN do this.**

Create workflows where a blockchain **trigger** (e.g. a wallet receives SOL) fires a chain
of **actions** (send a Discord message, call a webhook, send an email, store a log).

```
[Wallet receives SOL]  ──▶  [Send Discord message]  ──▶  [Send webhook]  ──▶  [Store log]
      trigger                      action 1                  action 2          action 3
```

## Architecture

A Turborepo monorepo of independent services that communicate through Postgres and a Redis queue:

| Service | Path | Responsibility |
| --- | --- | --- |
| **Frontend** | `apps/frontend` | Next.js UI — auth, dashboard, workflow builder, execution history |
| **Backend API** | `apps/backend` | Express + Prisma — auth (JWT), workflow CRUD, dashboard stats, logs |
| **Trigger service** | `apps/trigger-service` | Subscribes to Solana via websocket, matches active workflows, enqueues jobs |
| **Worker** | `apps/worker` | BullMQ consumer — loads a workflow, runs its actions in order, writes a log |
| **Shared** | `packages/shared` | Source-of-truth types: trigger/action types, job payload, queue name |
| **Smart contracts** | `apps/smart-contracts` | Anchor program skeleton (on-chain triggers/actions, future work) |

```
                ┌──────────────┐        enqueue        ┌──────────┐
  Solana  ─────▶│   trigger    │ ───────────────────▶  │  Redis   │
  (websocket)   │   service    │                       │ (BullMQ) │
                └──────────────┘                        └────┬─────┘
                       │                                     │ consume
                       │ reads active workflows              ▼
                ┌──────┴───────┐                        ┌──────────┐
                │   Postgres   │◀───────────────────────│  worker  │  runs actions,
                └──────┬───────┘     writes logs         └──────────┘  writes Log rows
                       │
                ┌──────┴───────┐        REST         ┌──────────┐
                │   backend    │◀───────────────────▶│ frontend │
                │   (Express)  │                     │ (Next.js)│
                └──────────────┘                     └──────────┘
```

## Prerequisites

- Node.js 18+
- Docker (for Postgres + Redis) — or local Postgres/Redis on the default ports

## Quick start

```bash
# 1. Install everything
npm install

# 2. Start Postgres + Redis
npm run db:up            # docker compose up -d

# 3. Create the database schema and the Prisma client
npm run db:migrate       # prisma migrate dev (apps/backend schema)

# 4. Run the services (each in its own terminal)
npm run dev:backend      # http://localhost:4000
npm run dev:worker       # consumes the execution queue
npm run dev:trigger      # subscribes to Solana (devnet by default)
npm run dev:frontend     # http://localhost:3000
```

Then open **http://localhost:3000**, sign up, and build a workflow.

> Tip: you can verify the full pipeline without any on-chain activity by opening a workflow
> and clicking **▶ Run now** — that enqueues a job the worker will execute immediately.

## Environment variables

Each service ships a checked-in `.env` (dev defaults). Key values:

- `apps/backend/.env` — `DATABASE_URL`, `JWT_SECRET`, `PORT` (4000), `REDIS_URL`, `CORS_ORIGIN`
- `apps/worker/.env` — `DATABASE_URL`, `REDIS_URL`, optional `SMTP_*` (email is simulated if unset)
- `apps/trigger-service/.env` — `DATABASE_URL`, `REDIS_URL`, `SOLANA_RPC_URL`, `SOLANA_WS_URL`
- `apps/frontend/.env.local` — `NEXT_PUBLIC_API_URL` (http://localhost:4000)

## Trigger & action catalog

All trigger/action types, their config fields, and their implementation kind live in one place:
[`packages/shared/src/catalog.ts`](packages/shared/src/catalog.ts). The API (validation), the
trigger service (detection), the worker (execution) and the builder UI all derive from it, and the
UI tags each item **API Call**, **Smart Contract**, or **Hybrid**.

**23 triggers** including wallet receives SOL/token/NFT, balance-below-threshold, funded-by-address,
transaction confirmed, NFT minted/transferred, contract event/failure, token price level, governance
vote, dApp interaction, token swap, LP balance change, new listing, **scheduled time**, airdrop,
vesting release, cross-chain transfer, staking rewards.

**24 actions** including send webhook / Discord / email / notification, store log, record to external
DB, fetch latest transactions, plus on-chain actions (mint/burn/transfer/send tokens, swap, stake,
governance, deploy, oracle update, cross-chain, …).

What runs for real today vs. simulated:

- **Triggers detected live** over raw RPC websockets (no API key): `wallet_received_sol`,
  `transaction_confirmed`, `wallet_balance_below_threshold`, and `scheduled_time` (interval timer in
  the trigger service). The rest are selectable/configurable; their detection is a documented
  extension point in `apps/trigger-service/src/watcher.ts`.
- **Actions executed for real**: `send_webhook`, `send_discord_message`, `send_email`,
  `send_notification`, `record_transaction_db`, `fetch_latest_transactions`, `store_log`, and the
  **on-chain SPL actions** `send_tokens` (native SOL or SPL), `mint_tokens`, `burn_tokens`,
  `transfer_nft` — each builds, signs and submits a real Solana transaction. Any action without a
  handler is recorded as **`simulated`** (selectable + logged honestly; needs an on-chain signer).

Adding a real handler is one file + one registry line in `apps/worker/src/actions/`.

### On-chain actions (signer)

`send_tokens` (and future on-chain actions) sign with the keypair in the worker's
`SOLANA_SIGNER_SECRET_KEY` (`apps/worker/.env`) — either a `solana-keygen` JSON array or a base58
secret. The key must be **funded on the active cluster**. On devnet:

```bash
# Using the Solana CLI (recommended — your IP is unlikely to be rate-limited):
solana airdrop 2 <SIGNER_PUBKEY> --url devnet
# …or paste <SIGNER_PUBKEY> into the web faucet at https://faucet.solana.com
```

The worker logs its signer pubkey on first on-chain action (`[solana] signer loaded: …`). With a
funded signer, on-chain actions return a Solana Explorer link to the confirmed transaction.
Leave `SOLANA_SIGNER_SECRET_KEY` empty to keep on-chain actions `simulated`. **Never commit a
mainnet key** — `.env` files are gitignored.

End-to-end test of the SPL actions on devnet:

```bash
npm run fund:signer            # 1. fund the signer with devnet SOL
npm run mint:create            # 2. create a test SPL mint (prints a mint address)
#                                3. build a workflow with a mint_tokens action using that mint,
#                                   to: <signer pubkey>, amount: 100 — then ▶ Run now
#                                4. burn_tokens / send_tokens / transfer_nft work the same way
```
`send_tokens` needs no mint for native SOL. `transfer_nft` needs a 0-decimal mint
(`npm run mint:create 0`) that the signer holds 1 of.

## REST API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/register` | Create account → `{ token, user }` |
| POST | `/auth/login` | Log in → `{ token, user }` |
| GET | `/auth/me` | Current user |
| GET | `/dashboard` | Workflow + execution stats |
| POST | `/workflows` | Create workflow (trigger + actions inline) |
| GET | `/workflows` | List workflows |
| GET | `/workflows/:id` | Workflow with trigger, actions, recent logs |
| PUT | `/workflows/:id` | Update workflow / trigger / actions |
| PATCH | `/workflows/:id/active` | Activate / deactivate |
| POST | `/workflows/:id/run` | Manually enqueue an execution (testing) |
| DELETE | `/workflows/:id` | Delete workflow |
| GET | `/logs` | All execution logs for the user |
| GET | `/logs/:workflowId` | Logs for one workflow |

All routes except `/auth/register`, `/auth/login` and `/health` require `Authorization: Bearer <token>`.

## How a workflow executes

1. The **trigger service** loads every active workflow's trigger, indexes them by watched
   wallet, and opens Solana websocket subscriptions.
2. When an on-chain event matches (correct type + `minAmount` threshold), it enqueues
   `{ workflowId, triggerData }` onto the `workflow-execution` Redis queue.
3. The **worker** picks up the job, loads the workflow's ordered actions, runs each handler,
   and writes a `Log` row with the per-action results (`success` / `partial` / `failed`).
4. The **frontend** reads those logs in the dashboard and per-workflow history.

## Switching to mainnet / a faster RPC

Set `SOLANA_RPC_URL` and `SOLANA_WS_URL` in `apps/trigger-service/.env` to a provider endpoint
(Helius, QuickNode, Triton). The watcher's subscription logic is unchanged; for high-volume
mainnet use, swapping the websocket subscription for provider webhooks is the recommended path.
