import 'dotenv/config';
import { type TriggerConfig, type TriggerData, isTriggerType } from '@web3-zapier/shared';
import prisma from './prisma';
import { enqueueExecution } from './queue';
import { SolanaWatcher, type DetectedEvent } from './watcher';

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const WS_URL = process.env.SOLANA_WS_URL ?? 'wss://api.devnet.solana.com';
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS ?? 15000);

/**
 * In-memory index of active workflows keyed by the wallet they watch, so an
 * on-chain event can be matched to workflows without a DB round-trip.
 */
type Subscription = { workflowId: string; triggerType: string; config: TriggerConfig };
let walletIndex = new Map<string, Subscription[]>();

/** Timers for scheduled_time triggers, keyed by workflow id. */
const scheduleTimers = new Map<string, NodeJS.Timeout>();

/** Load active workflows + triggers; rebuild the wallet index and reconcile timers. */
async function loadSubscriptions(): Promise<Set<string>> {
  const triggers = await prisma.trigger.findMany({
    where: { workflow: { isActive: true } },
    include: { workflow: { select: { id: true } } },
  });

  const next = new Map<string, Subscription[]>();
  const scheduledIds = new Set<string>();

  for (const t of triggers) {
    const config = (t.config ?? {}) as TriggerConfig;
    const sub: Subscription = { workflowId: t.workflowId, triggerType: t.type, config };

    if (t.type === 'scheduled_time') {
      scheduledIds.add(t.workflowId);
      ensureScheduleTimer(t.workflowId, Number(config.intervalSeconds) || 0);
      continue;
    }
    if (!config.wallet) continue; // only wallet-scoped triggers can be subscribed
    const list = next.get(config.wallet) ?? [];
    list.push(sub);
    next.set(config.wallet, list);
  }

  // Tear down timers for workflows that are no longer scheduled/active.
  for (const id of [...scheduleTimers.keys()]) {
    if (!scheduledIds.has(id)) {
      clearInterval(scheduleTimers.get(id)!);
      scheduleTimers.delete(id);
      console.log(`[schedule] cleared timer for ${id}`);
    }
  }

  walletIndex = next;
  return new Set(next.keys());
}

/** Create (once) an interval timer that enqueues a scheduled workflow. */
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

/** Does a detected event satisfy a workflow's trigger type + thresholds? */
function matches(sub: Subscription, data: TriggerData): boolean {
  if (sub.triggerType !== data.triggerType) return false;

  if (data.triggerType === 'wallet_balance_below_threshold') {
    const th = sub.config.threshold;
    return typeof th === 'number' && typeof data.balanceSol === 'number' && data.balanceSol < th;
  }

  // Token / NFT receipts can be scoped to a specific mint.
  const mintScoped =
    data.triggerType === 'wallet_received_token' ||
    data.triggerType === 'wallet_received_nft' ||
    data.triggerType === 'airdrop_detected';
  if (mintScoped && sub.config.mint && data.mint !== sub.config.mint) return false;

  if (sub.config.minAmount != null && typeof data.amount === 'number') {
    return data.amount >= sub.config.minAmount;
  }
  return true;
}

/** Fan a detected on-chain event out to every matching active workflow. */
async function handleEvent({ wallet, data }: DetectedEvent): Promise<void> {
  if (!isTriggerType(data.triggerType)) return;
  const subs = walletIndex.get(wallet) ?? [];
  const matched = subs.filter((s) => matches(s, data));
  if (matched.length === 0) return;

  console.log(`[trigger] ${data.triggerType} on ${wallet} → ${matched.length} workflow(s)`);
  for (const sub of matched) {
    await enqueueExecution({ workflowId: sub.workflowId, triggerData: data });
  }
}

async function main() {
  console.log(`🛰️  Trigger service starting (RPC: ${RPC_URL})`);
  const watcher = new SolanaWatcher(RPC_URL, WS_URL, (event) => {
    handleEvent(event).catch((err) => console.error('[trigger] handleEvent error:', err));
  });

  const refresh = async () => {
    try {
      const wallets = await loadSubscriptions();
      await watcher.sync(wallets);
    } catch (err) {
      console.error('[trigger] refresh error:', err);
    }
  };

  await refresh();
  setInterval(refresh, REFRESH_INTERVAL_MS);
  console.log(
    `🛰️  Watching ${walletIndex.size} wallet(s), ${scheduleTimers.size} schedule(s); refreshing every ${REFRESH_INTERVAL_MS}ms`,
  );
}

// Survive stray rejections (e.g. RPC 429s from token-account lookups) so the
// listener keeps running instead of dying on a single bad event.
process.on('unhandledRejection', (reason) =>
  console.error('[trigger] unhandledRejection:', reason instanceof Error ? reason.message : reason),
);
process.on('uncaughtException', (err) => console.error('[trigger] uncaughtException:', err.message));

main().catch((err) => {
  console.error('[trigger] fatal:', err);
  process.exit(1);
});
