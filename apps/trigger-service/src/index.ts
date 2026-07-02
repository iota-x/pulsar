import 'dotenv/config';
import http from 'http';
import {
  type TriggerConfig,
  type TriggerData,
  isTriggerType,
  solanaWsUrl,
  resolveNetwork,
  clusterFromRpc,
  toSupportedNetwork,
  type Cluster,
} from '@web3-zapier/shared';
import prisma from './prisma';
import { enqueueExecution } from './queue';
import { SolanaWatcher, type DetectedEvent } from './watcher';
import { runWithLeaderElection, type LeaderHandle } from './leader';
import { matchSub, priceSatisfied, WALLET_TYPES, PROGRAM_TYPES, ACCOUNT_TYPES, type Subscription } from './match';
import { getFiredStates, setFiredState } from './priceState';

const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS ?? 15000);
const PRICE_POLL_MS = Number(process.env.PRICE_POLL_MS ?? 30000);
const RPC_HEALTH_MS = Number(process.env.RPC_HEALTH_MS ?? 10000);
const RPC_FAIL_THRESHOLD = Number(process.env.RPC_FAIL_THRESHOLD ?? 3); // consecutive failed probes → rotate
const RPC_STALL_THRESHOLD = Number(process.env.RPC_STALL_THRESHOLD ?? 6); // consecutive no-progress probes → rotate
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 4100);
const JUPITER_PRICE_API = process.env.JUPITER_PRICE_API ?? 'https://api.jup.ag/price/v2';
const PRICE_FEED_ALERT_AFTER = 3;

const parseRpcs = (raw: string) =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Target sets a watcher subscribes to — one bundle per cluster. */
interface TargetSets {
  wallets: Set<string>;
  programs: Set<string>;
  accounts: Set<string>;
  slots: boolean;
  fixedPrograms: Map<string, string>;
  mints: Set<string>;
}

const emptyTargets = (): TargetSets => ({
  wallets: new Set(),
  programs: new Set(),
  accounts: new Set(),
  slots: false,
  fixedPrograms: new Map(),
  mints: new Set(),
});

// Scheduled triggers are cluster-agnostic (they just enqueue on a timer; the
// worker runs them against the workflow's own network), so their timers live
// here, shared across all runtimes.
const scheduleTimers = new Map<string, NodeJS.Timeout>();

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

/**
 * All cluster-specific state — RPC failover, the live watcher, the target index,
 * price watches and health probing — for a single Solana cluster. One instance
 * per configured network; devnet and mainnet run side by side with no shared
 * connection, so a workflow's `network` decides which chain actually watches it.
 */
class NetworkRuntime {
  readonly cluster: Cluster;
  private readonly rpcUrls: string[];
  private readonly wsOverride?: string;
  private rpcIndex = 0;
  private readonly fixedPrograms: Record<string, string>;

  private index = new Map<string, Subscription[]>();
  private priceWatches: Subscription[] = [];
  private priceFeedFailures = 0;

  private watcher: SolanaWatcher | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private priceTimer: NodeJS.Timeout | null = null;
  private rpcHealthTimer: NodeJS.Timeout | null = null;

  private lastSlot = -1;
  private probeFailures = 0;
  private stallCount = 0;

  constructor(cluster: Cluster, rpcUrls: string[], wsOverride?: string) {
    this.cluster = cluster;
    this.rpcUrls = rpcUrls;
    this.wsOverride = wsOverride;
    // Cluster-specific program addresses resolve from the RPC; every failover
    // endpoint is the same cluster, so the first one decides it.
    const net = resolveNetwork(rpcUrls[0]);
    this.fixedPrograms = {
      nft_minted: net.metaplexTokenMetadata,
      new_token_listing: process.env.RAYDIUM_CPMM_PROGRAM ?? net.raydiumCpmmProgram,
      cross_chain_token_transfer: process.env.WORMHOLE_CORE_BRIDGE ?? net.wormholeCoreBridge,
    };
  }

  get rpcCount() {
    return this.rpcUrls.length;
  }
  get targetCount() {
    return this.index.size;
  }
  get priceCount() {
    return this.priceWatches.length;
  }
  currentRpc() {
    return this.rpcUrls[this.rpcIndex % this.rpcUrls.length];
  }
  private currentWs() {
    return solanaWsUrl(this.currentRpc(), this.wsOverride ?? process.env.SOLANA_WS_URL);
  }

  /** Resolve the on-chain target a trigger subscribes to (cluster-aware fixed programs). */
  targetFor(type: string, c: TriggerConfig): string | null {
    if (this.fixedPrograms[type]) return this.fixedPrograms[type];
    if (type === 'nft_transferred') return (c.mint as string) ?? null;
    if (WALLET_TYPES.has(type)) return c.wallet ?? null;
    if (PROGRAM_TYPES.has(type)) return (c.programId as string) ?? null;
    if (type === 'liquidity_pool_balance_changed') return (c.poolAddress as string) ?? null;
    if (type === 'staking_rewards_earned') return (c.stakeAccount as string) ?? c.wallet ?? null;
    if (type === 'token_vesting_release') return (c.vestingAccount as string) ?? null;
    if (type === 'new_block_mined') return 'slot';
    return null;
  }

  isFixedProgram(type: string) {
    return Boolean(this.fixedPrograms[type]);
  }

  /** Swap in the freshly-loaded index + price watches for this cluster. */
  setSubscriptions(index: Map<string, Subscription[]>, priceWatches: Subscription[]) {
    this.index = index;
    this.priceWatches = priceWatches;
  }

  private async handleEvent({ target, data }: DetectedEvent): Promise<void> {
    const subs = this.index.get(target) ?? [];
    const matched = subs.filter((s) => matchSub(s, data));
    for (const sub of matched) {
      if (!isTriggerType(sub.triggerType)) continue;
      const triggerData: TriggerData = { ...data, triggerType: sub.triggerType };
      console.log(`[trigger:${this.cluster}] ${sub.triggerType} on ${target} → workflow ${sub.workflowId}`);
      await enqueueExecution({ workflowId: sub.workflowId, triggerData });
    }
  }

  /** Poll token prices and fire token_price_threshold on a false→true crossing. */
  private async pollPrices(): Promise<void> {
    if (this.priceWatches.length === 0) return;
    const mints = [...new Set(this.priceWatches.map((s) => s.config.mint as string))];
    const prices: Record<string, number> = {};
    try {
      const res = await fetch(`${JUPITER_PRICE_API}?ids=${mints.join(',')}`);
      if (!res.ok) throw new Error(`price feed HTTP ${res.status}`);
      const body = await res.json();
      for (const [mint, info] of Object.entries(body.data ?? {})) {
        const price = Number((info as { price?: string }).price);
        if (Number.isFinite(price)) prices[mint] = price;
      }
      if (this.priceFeedFailures >= PRICE_FEED_ALERT_AFTER) {
        console.log(`[price:${this.cluster}] feed recovered after ${this.priceFeedFailures} failed poll(s)`);
      }
      this.priceFeedFailures = 0;
    } catch (err) {
      this.priceFeedFailures += 1;
      const detail = err instanceof Error ? err.message : String(err);
      if (this.priceFeedFailures >= PRICE_FEED_ALERT_AFTER) {
        console.error(
          `[price:${this.cluster}] ⚠ FEED DOWN — ${this.priceFeedFailures} consecutive failures; ${this.priceWatches.length} price trigger(s) are blind: ${detail}`,
        );
      } else {
        console.error(`[price:${this.cluster}] poll error (${this.priceFeedFailures}): ${detail}`);
      }
      return;
    }

    const prevStates = await getFiredStates(this.priceWatches.map((s) => s.workflowId));
    for (const sub of this.priceWatches) {
      const mint = sub.config.mint as string;
      const price = prices[mint];
      if (price == null) {
        console.warn(`[price:${this.cluster}] no price for ${mint} — workflow ${sub.workflowId} can't evaluate this poll`);
        continue;
      }
      const target = Number(sub.config.targetPrice);
      const satisfied = priceSatisfied(price, target, sub.config.direction as string | undefined);
      const prev = prevStates.get(sub.workflowId) ?? false;
      if (satisfied !== prev) await setFiredState(sub.workflowId, satisfied);
      if (satisfied && !prev) {
        console.log(`[trigger:${this.cluster}] token_price_threshold ${mint} @ ${price} → workflow ${sub.workflowId}`);
        await enqueueExecution({
          workflowId: sub.workflowId,
          triggerData: { triggerType: 'token_price_threshold', mint, price, targetPrice: target },
        }).catch((err) => console.error('[price] enqueue error:', err));
      }
    }
  }

  /** Start watching this cluster: connect, sync targets, begin price + health loops. */
  async start(targets: TargetSets): Promise<void> {
    console.log(`🛰️  [${this.cluster}] starting watcher on ${this.currentRpc()}`);
    this.watcher = new SolanaWatcher(this.currentRpc(), this.currentWs(), (event) => {
      this.handleEvent(event).catch((err) => console.error(`[trigger:${this.cluster}] handleEvent error:`, err));
    });
    await this.watcher.sync(targets);
    this.priceTimer = setInterval(() => void this.pollPrices(), PRICE_POLL_MS);
    this.startRpcHealthMonitor();
    console.log(
      `🛰️  [${this.cluster}] watching ${this.index.size} target(s), ${this.priceWatches.length} price(s)`,
    );
  }

  /** Re-sync the watcher's subscriptions to the current index (called on refresh). */
  async sync(targets: TargetSets): Promise<void> {
    if (this.watcher) await this.watcher.sync(targets);
  }

  /** Tear down all work for this cluster. */
  async stop(): Promise<void> {
    if (this.priceTimer) clearInterval(this.priceTimer);
    if (this.rpcHealthTimer) clearInterval(this.rpcHealthTimer);
    this.priceTimer = this.rpcHealthTimer = null;
    if (this.watcher) {
      try {
        await this.watcher.sync(emptyTargets()); // unsubscribe everything
      } catch {
        /* best effort */
      }
      this.watcher = null;
    }
    this.index = new Map();
    this.priceWatches = [];
  }

  // --- RPC failover (per cluster) --------------------------------------------
  private startRpcHealthMonitor(): void {
    if (this.rpcHealthTimer) clearInterval(this.rpcHealthTimer);
    this.lastSlot = -1;
    this.probeFailures = 0;
    this.stallCount = 0;
    this.rpcHealthTimer = setInterval(() => void this.probeRpc(), RPC_HEALTH_MS);
  }

  private async probeRpc(): Promise<void> {
    if (!this.watcher) return;
    try {
      const slot = await withTimeout(this.watcher.currentSlot(), 5000);
      this.probeFailures = 0;
      if (slot > this.lastSlot) {
        this.lastSlot = slot;
        this.stallCount = 0;
      } else {
        this.stallCount += 1;
        if (this.stallCount >= RPC_STALL_THRESHOLD) {
          await this.rotateRpc(`slot frozen at ${this.lastSlot} for ${this.stallCount} probes`);
        }
      }
    } catch (err) {
      this.probeFailures += 1;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[rpc:${this.cluster}] probe failed (${this.probeFailures}/${RPC_FAIL_THRESHOLD}) on ${this.currentRpc()}: ${detail}`,
      );
      if (this.probeFailures >= RPC_FAIL_THRESHOLD) await this.rotateRpc('endpoint unreachable');
    }
  }

  /** Advance to the next endpoint and rebuild the watcher (re-subscribes all). */
  private async rotateRpc(reason: string): Promise<void> {
    const from = this.currentRpc();
    if (this.rpcUrls.length > 1) this.rpcIndex = (this.rpcIndex + 1) % this.rpcUrls.length;
    const to = this.currentRpc();
    console.error(
      `[rpc:${this.cluster}] ⚠ FAILOVER (${reason}) — ${from} → ${to}${this.rpcUrls.length === 1 ? ' (single endpoint: reconnecting)' : ''}`,
    );
    // Tear down first (stop() clears this runtime's index), THEN reload so the
    // fresh subscriptions survive, then reconnect on the new endpoint.
    await this.stop();
    const targets = await loadSubscriptions();
    await this.start(targets.get(this.cluster) ?? emptyTargets());
  }
}

// --- Runtimes: one per configured cluster ------------------------------------
function buildRuntimes(): Map<Cluster, NetworkRuntime> {
  const runtimes = new Map<Cluster, NetworkRuntime>();

  // Primary cluster — existing SOLANA_RPC_URLS/SOLANA_RPC_URL (usually devnet).
  const primary = parseRpcs(process.env.SOLANA_RPC_URLS ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com');
  const primaryCluster = clusterFromRpc(primary[0]);
  runtimes.set(primaryCluster, new NetworkRuntime(primaryCluster, primary));

  // Optional mainnet cluster — only when a mainnet RPC is configured.
  const mainnet = parseRpcs(process.env.SOLANA_RPC_URLS_MAINNET ?? '');
  if (mainnet.length && !runtimes.has('mainnet-beta')) {
    runtimes.set('mainnet-beta', new NetworkRuntime('mainnet-beta', mainnet, process.env.SOLANA_WS_URL_MAINNET));
  }

  return runtimes;
}

const runtimes = buildRuntimes();

const unroutedNetworks = new Set<string>(); // log an unconfigured target network once

/**
 * Load active triggers, partition them by their workflow's network, and populate
 * each runtime's index + price watches. Returns the per-cluster target sets to
 * hand to each watcher. Scheduled timers (cluster-agnostic) are reconciled here.
 */
async function loadSubscriptions(): Promise<Map<Cluster, TargetSets>> {
  const triggers = await prisma.trigger.findMany({
    where: { workflow: { isActive: true } },
    include: { workflow: { select: { id: true, network: true } } },
  });

  // Per-cluster accumulators.
  const perCluster = new Map<
    Cluster,
    { index: Map<string, Subscription[]>; prices: Subscription[]; targets: TargetSets }
  >();
  for (const cluster of runtimes.keys()) {
    perCluster.set(cluster, { index: new Map(), prices: [], targets: emptyTargets() });
  }

  const scheduledIds = new Set<string>();

  for (const t of triggers) {
    const config = (t.config ?? {}) as TriggerConfig;

    // Scheduled triggers fire on a timer regardless of cluster.
    if (t.type === 'scheduled_time') {
      scheduledIds.add(t.workflowId);
      ensureScheduleTimer(t.workflowId, Number(config.intervalSeconds) || 0);
      continue;
    }

    const cluster = toSupportedNetwork(t.workflow.network) as Cluster;
    const rt = runtimes.get(cluster);
    const bucket = perCluster.get(cluster);
    if (!rt || !bucket) {
      if (!unroutedNetworks.has(cluster)) {
        console.warn(`[trigger] no watcher configured for network "${cluster}" — its workflows won't be watched`);
        unroutedNetworks.add(cluster);
      }
      continue;
    }

    const sub: Subscription = { workflowId: t.workflowId, triggerType: t.type, config };

    if (t.type === 'token_price_threshold') {
      if (config.mint && config.targetPrice != null) bucket.prices.push(sub);
      continue;
    }

    const target = rt.targetFor(t.type, config);
    if (!target) continue;

    const list = bucket.index.get(target) ?? [];
    list.push(sub);
    bucket.index.set(target, list);

    const ts = bucket.targets;
    if (target === 'slot') ts.slots = true;
    else if (rt.isFixedProgram(t.type)) ts.fixedPrograms.set(target, t.type);
    else if (t.type === 'nft_transferred') ts.mints.add(target);
    else if (WALLET_TYPES.has(t.type)) ts.wallets.add(target);
    else if (PROGRAM_TYPES.has(t.type)) ts.programs.add(target);
    else if (ACCOUNT_TYPES.has(t.type)) ts.accounts.add(target);
  }

  // Reconcile schedule timers (drop any whose workflow deactivated/deleted).
  for (const id of [...scheduleTimers.keys()]) {
    if (!scheduledIds.has(id)) {
      clearInterval(scheduleTimers.get(id)!);
      scheduleTimers.delete(id);
    }
  }

  const out = new Map<Cluster, TargetSets>();
  for (const [cluster, bucket] of perCluster) {
    runtimes.get(cluster)!.setSubscriptions(bucket.index, bucket.prices);
    out.set(cluster, bucket.targets);
  }
  return out;
}

// --- Active work (only the elected leader runs this) -------------------------
let refreshTimer: NodeJS.Timeout | null = null;

async function startWatching(): Promise<void> {
  const clusters = [...runtimes.keys()].join(', ');
  console.log(`🛰️  leader active — starting watcher(s): ${clusters}`);
  const targets = await loadSubscriptions();
  for (const [cluster, rt] of runtimes) {
    await rt.start(targets.get(cluster) ?? emptyTargets());
  }

  const refresh = async () => {
    try {
      const next = await loadSubscriptions();
      for (const [cluster, rt] of runtimes) await rt.sync(next.get(cluster) ?? emptyTargets());
    } catch (err) {
      console.error('[trigger] refresh error:', err);
    }
  };
  refreshTimer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  console.log(`🛰️  refresh every ${REFRESH_INTERVAL_MS}ms`);
}

/** Tear down ALL active work so a deposed replica can never enqueue. */
async function stopWatching(): Promise<void> {
  console.log('🛑 standby — stopping watcher(s)');
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  for (const t of scheduleTimers.values()) clearInterval(t);
  scheduleTimers.clear();
  for (const rt of runtimes.values()) await rt.stop();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]);
}

let leaderHandle: LeaderHandle | null = null;

async function main() {
  const clusters = [...runtimes.values()].map((rt) => `${rt.cluster}(${rt.rpcCount})`).join(', ');
  console.log(`🛰️  Trigger service starting — clusters: ${clusters} — awaiting leadership`);

  // Liveness/observability endpoint. A standby is healthy (correctly idle); the
  // health is about process responsiveness, not leadership.
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          leader: leaderHandle?.isLeader ?? false,
          clusters: [...runtimes.values()].map((rt) => ({
            cluster: rt.cluster,
            rpc: rt.currentRpc(),
            rpcEndpoints: rt.rpcCount,
            targets: rt.targetCount,
            priceWatches: rt.priceCount,
          })),
          schedules: scheduleTimers.size,
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
