import 'dotenv/config';
import http from 'http';
import { type TriggerConfig, type TriggerData, isTriggerType, solanaWsUrl, resolveNetwork } from '@web3-zapier/shared';
import prisma from './prisma';
import { enqueueExecution } from './queue';
import { SolanaWatcher, type DetectedEvent } from './watcher';
import { runWithLeaderElection, type LeaderHandle } from './leader';
import {
  matchSub,
  priceSatisfied,
  WALLET_TYPES,
  PROGRAM_TYPES,
  ACCOUNT_TYPES,
  type Subscription,
} from './match';
import { getFiredStates, setFiredState } from './priceState';

// RPC failover: a comma-separated SOLANA_RPC_URLS list (or the single
// SOLANA_RPC_URL) the watcher rotates through when an endpoint dies or stalls —
// so a leader can't be "alive but blind to the chain". All entries must be the
// same cluster. WS follows the active RPC unless SOLANA_WS_URL overrides it.
const RPC_URLS = (process.env.SOLANA_RPC_URLS ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
let rpcIndex = 0;
const currentRpc = () => RPC_URLS[rpcIndex % RPC_URLS.length];
const currentWs = () => solanaWsUrl(currentRpc(), process.env.SOLANA_WS_URL);

const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS ?? 15000);
const PRICE_POLL_MS = Number(process.env.PRICE_POLL_MS ?? 30000);
const RPC_HEALTH_MS = Number(process.env.RPC_HEALTH_MS ?? 10000);
const RPC_FAIL_THRESHOLD = Number(process.env.RPC_FAIL_THRESHOLD ?? 3); // consecutive failed probes → rotate
const RPC_STALL_THRESHOLD = Number(process.env.RPC_STALL_THRESHOLD ?? 6); // consecutive no-progress probes → rotate
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 4100);
const JUPITER_PRICE_API = process.env.JUPITER_PRICE_API ?? 'https://api.jup.ag/price/v2';

// Trigger type → subscription family lives in ./match (shared with the matcher).

// Cluster-specific program addresses resolve from the RPC (devnet vs mainnet);
// every failover endpoint is the same cluster, so the first one decides it.
const net = resolveNetwork(RPC_URLS[0]);

// Trigger types detected by watching a fixed well-known program's logs.
const FIXED_PROGRAMS: Record<string, string> = {
  nft_minted: net.metaplexTokenMetadata,
  new_token_listing: process.env.RAYDIUM_CPMM_PROGRAM ?? net.raydiumCpmmProgram,
  cross_chain_token_transfer: process.env.WORMHOLE_CORE_BRIDGE ?? net.wormholeCoreBridge,
};

/** Resolve the on-chain target string a trigger should subscribe to. */
function targetFor(type: string, c: TriggerConfig): string | null {
  if (FIXED_PROGRAMS[type]) return FIXED_PROGRAMS[type];
  if (type === 'nft_transferred') return (c.mint as string) ?? null;
  if (WALLET_TYPES.has(type)) return c.wallet ?? null;
  if (PROGRAM_TYPES.has(type)) return (c.programId as string) ?? null;
  if (type === 'liquidity_pool_balance_changed') return (c.poolAddress as string) ?? null;
  if (type === 'staking_rewards_earned') return (c.stakeAccount as string) ?? c.wallet ?? null;
  if (type === 'token_vesting_release') return (c.vestingAccount as string) ?? null;
  if (type === 'new_block_mined') return 'slot';
  return null;
}

let index = new Map<string, Subscription[]>();
const scheduleTimers = new Map<string, NodeJS.Timeout>();
let priceWatches: Subscription[] = [];
// Edge-trigger state now lives in Redis (priceState) so it survives restarts.
// Track consecutive price-feed failures to surface a sustained outage — a stop-loss
// can't protect anything while the feed is dark.
let priceFeedFailures = 0;
const PRICE_FEED_ALERT_AFTER = 3;

/** Load active triggers; rebuild the index + target sets and reconcile timers. */
async function loadSubscriptions() {
  const triggers = await prisma.trigger.findMany({
    where: { workflow: { isActive: true } },
    include: { workflow: { select: { id: true } } },
  });

  const next = new Map<string, Subscription[]>();
  const wallets = new Set<string>();
  const programs = new Set<string>();
  const accounts = new Set<string>();
  const fixedPrograms = new Map<string, string>();
  const mints = new Set<string>();
  const prices: Subscription[] = [];
  const scheduledIds = new Set<string>();
  let slots = false;

  for (const t of triggers) {
    const config = (t.config ?? {}) as TriggerConfig;
    const sub: Subscription = { workflowId: t.workflowId, triggerType: t.type, config };

    if (t.type === 'scheduled_time') {
      scheduledIds.add(t.workflowId);
      ensureScheduleTimer(t.workflowId, Number(config.intervalSeconds) || 0);
      continue;
    }
    if (t.type === 'token_price_threshold') {
      if (config.mint && config.targetPrice != null) prices.push(sub);
      continue;
    }

    const target = targetFor(t.type, config);
    if (!target) continue;

    const list = next.get(target) ?? [];
    list.push(sub);
    next.set(target, list);

    if (target === 'slot') slots = true;
    else if (FIXED_PROGRAMS[t.type]) fixedPrograms.set(target, t.type);
    else if (t.type === 'nft_transferred') mints.add(target);
    else if (WALLET_TYPES.has(t.type)) wallets.add(target);
    else if (PROGRAM_TYPES.has(t.type)) programs.add(target);
    else if (ACCOUNT_TYPES.has(t.type)) accounts.add(target);
  }

  for (const id of [...scheduleTimers.keys()]) {
    if (!scheduledIds.has(id)) {
      clearInterval(scheduleTimers.get(id)!);
      scheduleTimers.delete(id);
    }
  }

  index = next;
  priceWatches = prices;
  return { wallets, programs, accounts, slots, fixedPrograms, mints };
}

function ensureScheduleTimer(workflowId: string, intervalSeconds: number) {
  if (intervalSeconds <= 0 || scheduleTimers.has(workflowId)) return;
  const timer = setInterval(
    () =>
      enqueueExecution({
        workflowId,
        triggerData: { triggerType: 'scheduled_time', scheduledAt: new Date().toISOString() },
      }).catch((err) => console.error('[schedule] enqueue error:', err)),
    intervalSeconds * 1000,
  );
  scheduleTimers.set(workflowId, timer);
  console.log(`[schedule] every ${intervalSeconds}s → workflow ${workflowId}`);
}

async function handleEvent({ target, data }: DetectedEvent): Promise<void> {
  const subs = index.get(target) ?? [];
  const matched = subs.filter((s) => matchSub(s, data));
  if (matched.length === 0) return;

  for (const sub of matched) {
    if (!isTriggerType(sub.triggerType)) continue;
    const triggerData: TriggerData = { ...data, triggerType: sub.triggerType };
    console.log(`[trigger] ${sub.triggerType} on ${target} → workflow ${sub.workflowId}`);
    await enqueueExecution({ workflowId: sub.workflowId, triggerData });
  }
}

/** Poll token prices and fire token_price_threshold on a false→true crossing. */
async function pollPrices(): Promise<void> {
  if (priceWatches.length === 0) return;
  const mints = [...new Set(priceWatches.map((s) => s.config.mint as string))];
  let prices: Record<string, number> = {};
  try {
    const res = await fetch(`${JUPITER_PRICE_API}?ids=${mints.join(',')}`);
    if (!res.ok) throw new Error(`price feed HTTP ${res.status}`);
    const body = await res.json();
    for (const [mint, info] of Object.entries(body.data ?? {})) {
      const price = Number((info as { price?: string }).price);
      if (Number.isFinite(price)) prices[mint] = price;
    }
    if (priceFeedFailures >= PRICE_FEED_ALERT_AFTER) {
      console.log(`[price] feed recovered after ${priceFeedFailures} failed poll(s)`);
    }
    priceFeedFailures = 0;
  } catch (err) {
    priceFeedFailures += 1;
    const detail = err instanceof Error ? err.message : String(err);
    // Escalate once a sustained outage means price triggers can't fire at all.
    if (priceFeedFailures >= PRICE_FEED_ALERT_AFTER) {
      console.error(`[price] ⚠ FEED DOWN — ${priceFeedFailures} consecutive failures; ${priceWatches.length} price trigger(s) are blind: ${detail}`);
    } else {
      console.error(`[price] poll error (${priceFeedFailures}): ${detail}`);
    }
    return;
  }

  // Durable edge-state (Redis) so a restart can't re-fire an already-satisfied
  // condition into a duplicate sell.
  const prevStates = await getFiredStates(priceWatches.map((s) => s.workflowId));

  for (const sub of priceWatches) {
    const mint = sub.config.mint as string;
    const price = prices[mint];
    if (price == null) {
      console.warn(`[price] no price for ${mint} — workflow ${sub.workflowId} can't evaluate this poll`);
      continue;
    }
    const target = Number(sub.config.targetPrice);
    const satisfied = priceSatisfied(price, target, sub.config.direction as string | undefined);
    const prev = prevStates.get(sub.workflowId) ?? false;
    if (satisfied !== prev) await setFiredState(sub.workflowId, satisfied);
    if (satisfied && !prev) {
      console.log(`[trigger] token_price_threshold ${mint} @ ${price} → workflow ${sub.workflowId}`);
      await enqueueExecution({
        workflowId: sub.workflowId,
        triggerData: { triggerType: 'token_price_threshold', mint, price, targetPrice: target },
      }).catch((err) => console.error('[price] enqueue error:', err));
    }
  }
}

// --- Active work (only the elected leader runs this) -------------------------
let watcher: SolanaWatcher | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let priceTimer: NodeJS.Timeout | null = null;
let rpcHealthTimer: NodeJS.Timeout | null = null;

const EMPTY_TARGETS = {
  wallets: new Set<string>(),
  programs: new Set<string>(),
  accounts: new Set<string>(),
  slots: false,
  fixedPrograms: new Map<string, string>(),
  mints: new Set<string>(),
};

async function startWatching(): Promise<void> {
  console.log(`🛰️  leader active — starting watcher on ${currentRpc()}`);
  watcher = new SolanaWatcher(currentRpc(), currentWs(), (event) => {
    handleEvent(event).catch((err) => console.error('[trigger] handleEvent error:', err));
  });
  const refresh = async () => {
    try {
      await watcher!.sync(await loadSubscriptions());
    } catch (err) {
      console.error('[trigger] refresh error:', err);
    }
  };
  await refresh();
  refreshTimer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  priceTimer = setInterval(() => void pollPrices(), PRICE_POLL_MS);
  startRpcHealthMonitor();
  console.log(
    `🛰️  Watching ${index.size} target(s), ${scheduleTimers.size} schedule(s), ${priceWatches.length} price(s); refresh ${REFRESH_INTERVAL_MS}ms`,
  );
}

/** Tear down ALL active work so a deposed replica can never enqueue. */
async function stopWatching(): Promise<void> {
  console.log('🛑 standby — stopping watcher');
  if (refreshTimer) clearInterval(refreshTimer);
  if (priceTimer) clearInterval(priceTimer);
  if (rpcHealthTimer) clearInterval(rpcHealthTimer);
  refreshTimer = priceTimer = rpcHealthTimer = null;
  for (const t of scheduleTimers.values()) clearInterval(t);
  scheduleTimers.clear();
  if (watcher) {
    try {
      await watcher.sync(EMPTY_TARGETS); // unsubscribe everything
    } catch {
      /* best effort */
    }
    watcher = null;
  }
  index = new Map();
  priceWatches = [];
}

// --- RPC failover ------------------------------------------------------------
let lastSlot = -1;
let probeFailures = 0;
let stallCount = 0;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]);
}

/** Probe the active RPC; rotate to the next endpoint when it's down or stalled. */
async function probeRpc(): Promise<void> {
  if (!watcher) return;
  try {
    const slot = await withTimeout(watcher.currentSlot(), 5000);
    probeFailures = 0;
    if (slot > lastSlot) {
      lastSlot = slot;
      stallCount = 0;
    } else {
      stallCount += 1;
      if (stallCount >= RPC_STALL_THRESHOLD) {
        await rotateRpc(`slot frozen at ${lastSlot} for ${stallCount} probes`);
      }
    }
  } catch (err) {
    probeFailures += 1;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[rpc] probe failed (${probeFailures}/${RPC_FAIL_THRESHOLD}) on ${currentRpc()}: ${detail}`);
    if (probeFailures >= RPC_FAIL_THRESHOLD) await rotateRpc('endpoint unreachable');
  }
}

/** Advance to the next RPC endpoint and rebuild the watcher (re-subscribes all). */
async function rotateRpc(reason: string): Promise<void> {
  const from = currentRpc();
  if (RPC_URLS.length > 1) rpcIndex = (rpcIndex + 1) % RPC_URLS.length;
  const to = currentRpc();
  console.error(
    `[rpc] ⚠ FAILOVER (${reason}) — ${from} → ${to}${RPC_URLS.length === 1 ? ' (single endpoint: reconnecting)' : ''}`,
  );
  await stopWatching();
  await startWatching(); // re-syncs every target on the new connection
}

function startRpcHealthMonitor(): void {
  if (rpcHealthTimer) clearInterval(rpcHealthTimer);
  lastSlot = -1;
  probeFailures = 0;
  stallCount = 0;
  rpcHealthTimer = setInterval(() => void probeRpc(), RPC_HEALTH_MS);
}

let leaderHandle: LeaderHandle | null = null;

async function main() {
  console.log(`🛰️  Trigger service starting (${RPC_URLS.length} RPC endpoint(s)) — awaiting leadership`);

  // Liveness/observability endpoint. A standby is healthy (correctly idle); the
  // health is about process responsiveness, not leadership.
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          leader: leaderHandle?.isLeader ?? false,
          rpc: currentRpc(),
          rpcEndpoints: RPC_URLS.length,
          targets: index.size,
          priceWatches: priceWatches.length,
        }),
      );
    })
    .listen(HEALTH_PORT, () => console.log(`[health] listening on :${HEALTH_PORT}`));

  leaderHandle = runWithLeaderElection({ onElected: startWatching, onDeposed: stopWatching });

  // Graceful shutdown: release leadership promptly so failover is fast.
  const shutdown = async () => {
    console.log('[trigger] shutting down…');
    await leaderHandle?.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

process.on('unhandledRejection', (reason) =>
  console.error('[trigger] unhandledRejection:', reason instanceof Error ? reason.message : reason),
);
process.on('uncaughtException', (err) => console.error('[trigger] uncaughtException:', err.message));

main().catch((err) => {
  console.error('[trigger] fatal:', err);
  process.exit(1);
});
