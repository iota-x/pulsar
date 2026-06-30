/**
 * @web3-zapier/shared
 *
 * The single source of truth shared by the API, the trigger service and the
 * worker. Trigger/action types and their config schemas live in `catalog.ts`;
 * this module re-exports them plus the queue/job/log contracts.
 */

export * from './catalog';
export * from './capabilities';
export * from './networks';
export * from './redis';
import type { TriggerType, ActionType } from './catalog';

// ---------------------------------------------------------------------------
// Config shapes (loose — the catalog's CatalogField list drives the UI)
// ---------------------------------------------------------------------------

/** Config stored on a Trigger row. Fields depend on the trigger type. */
export interface TriggerConfig {
  wallet?: string;
  minAmount?: number;
  threshold?: number;
  fromAddress?: string;
  collection?: string;
  mint?: string;
  programId?: string;
  intervalSeconds?: number;
  [key: string]: unknown;
}

/** Config stored on an Action row. Fields depend on the action type. */
export interface ActionConfig {
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  webhookUrl?: string;
  content?: string;
  to?: string;
  subject?: string;
  body?: string;
  channel?: string;
  message?: string;
  wallet?: string;
  mint?: string;
  amount?: number;
  limit?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Queue / job contract
// ---------------------------------------------------------------------------

/** Name of the BullMQ queue shared by the trigger service and the worker. */
export const EXECUTION_QUEUE = 'workflow-execution';

/**
 * Resolve the Solana websocket endpoint. Prefer an explicit override (some
 * providers use a different ws host); otherwise derive it from the RPC URL
 * (https→wss, http→ws). This lets a dedicated RPC be configured with a single
 * `SOLANA_RPC_URL` and have subscriptions follow automatically.
 */
export function solanaWsUrl(rpcUrl: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  return rpcUrl.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);
}

/** Data the trigger service detected on-chain, passed through to the actions. */
export interface TriggerData {
  triggerType: TriggerType;
  wallet?: string;
  signature?: string;
  amount?: number;
  [key: string]: unknown;
}

/** Payload enqueued for every workflow that matches a detected trigger. */
export interface ExecutionJob {
  workflowId: string;
  triggerData: TriggerData;
  /**
   * Stable key identifying the logical trigger event. The worker claims it
   * exactly-once (Postgres unique constraint) so retries/replays don't re-run
   * money-moving actions. Computed by the producer via {@link dedupeKeyFor}.
   */
  dedupeKey?: string;
  /** Dry-run: validate + describe the actions without executing anything. */
  dryRun?: boolean;
}

/**
 * Derive a stable dedupe key for a (workflow, trigger event) pair. Prefers a
 * natural on-chain identifier (tx signature, slot) so the SAME event collapses
 * to one execution even across processes; falls back to a detection timestamp
 * for events with no natural id (so retries of one job still share a key, but
 * distinct detections don't collide).
 */
export function dedupeKeyFor(workflowId: string, data: TriggerData): string {
  const t = data.triggerType;
  if (typeof data.signature === 'string') return `${workflowId}:${t}:${data.signature}`;
  if (typeof data.slot === 'number') return `${workflowId}:${t}:slot:${data.slot}`;
  if (typeof data.scheduledAt === 'string') return `${workflowId}:${t}:${data.scheduledAt}`;
  // Edge-triggered/price/account events: bind to the detection instant.
  const stamp = (data.detectedAt as string) ?? new Date().toISOString();
  return `${workflowId}:${t}:${stamp}`;
}

/**
 * Turn a dedupe key into a BullMQ-safe custom jobId. BullMQ uses ':' as an
 * internal Redis key separator and rejects a custom jobId that contains ':'
 * unless it splits into exactly 3 parts — but our keys embed ISO timestamps
 * (`HH:MM:SS`) and `slot:` segments, so they'd throw "Custom Id cannot contain :".
 * Map ':' to '_' for the jobId; the canonical ':'-delimited key still lives in
 * the job payload (the worker's Postgres claim relies on it for exactly-once).
 */
export function bullmqJobId(dedupeKey: string): string {
  return dedupeKey.replace(/:/g, '_');
}

// ---------------------------------------------------------------------------
// Execution result / log status
// ---------------------------------------------------------------------------

// 'running' = claimed, in flight; 'skipped' = duplicate (idempotency);
// 'dead_letter' = retries exhausted in the queue.
export const LOG_STATUS = ['running', 'success', 'failed', 'partial', 'skipped', 'dead_letter'] as const;
export type LogStatus = (typeof LOG_STATUS)[number];

/** Result of running a single action, collected into the Log's resultData. */
export interface ActionResult {
  actionId: string;
  type: ActionType;
  status: 'success' | 'failed' | 'simulated';
  detail?: string;
}
