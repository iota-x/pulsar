import 'dotenv/config';
import { type TriggerConfig, type TriggerData, isTriggerType, solanaWsUrl, resolveNetwork } from '@web3-zapier/shared';
import prisma from './prisma';
import { enqueueExecution } from './queue';
import { SolanaWatcher, type DetectedEvent } from './watcher';
import {
  matchSub,
  priceSatisfied,
  WALLET_TYPES,
  PROGRAM_TYPES,
  ACCOUNT_TYPES,
  type Subscription,
} from './match';
import { getFiredStates, setFiredState } from './priceState';

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
// WS follows the RPC unless explicitly overridden — so a dedicated RPC needs
// only SOLANA_RPC_URL set.
const WS_URL = solanaWsUrl(RPC_URL, process.env.SOLANA_WS_URL);
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS ?? 15000);
const PRICE_POLL_MS = Number(process.env.PRICE_POLL_MS ?? 30000);
const JUPITER_PRICE_API = process.env.JUPITER_PRICE_API ?? 'https://api.jup.ag/price/v2';

// Trigger type → subscription family lives in ./match (shared with the matcher).

// Cluster-specific program addresses resolve from SOLANA_RPC_URL (devnet vs
// mainnet); an explicit env override still wins for custom/relocated programs.
const net = resolveNetwork(RPC_URL);

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

async function main() {
  console.log(`🛰️  Trigger service starting (RPC: ${RPC_URL})`);
  const watcher = new SolanaWatcher(RPC_URL, WS_URL, (event) => {
    handleEvent(event).catch((err) => console.error('[trigger] handleEvent error:', err));
  });

  const refresh = async () => {
    try {
      await watcher.sync(await loadSubscriptions());
    } catch (err) {
      console.error('[trigger] refresh error:', err);
    }
  };

  await refresh();
  setInterval(refresh, REFRESH_INTERVAL_MS);
  setInterval(() => void pollPrices(), PRICE_POLL_MS);
  console.log(
    `🛰️  Watching ${index.size} target(s), ${scheduleTimers.size} schedule(s), ${priceWatches.length} price(s); refresh ${REFRESH_INTERVAL_MS}ms`,
  );
}

process.on('unhandledRejection', (reason) =>
  console.error('[trigger] unhandledRejection:', reason instanceof Error ? reason.message : reason),
);
process.on('uncaughtException', (err) => console.error('[trigger] uncaughtException:', err.message));

main().catch((err) => {
  console.error('[trigger] fatal:', err);
  process.exit(1);
});
