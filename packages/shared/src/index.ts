/**
 * @web3-zapier/shared
 *
 * The single source of truth shared by the API, the trigger service and the
 * worker. Trigger/action types and their config schemas live in `catalog.ts`;
 * this module re-exports them plus the queue/job/log contracts.
 */

export * from './catalog';
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
}

// ---------------------------------------------------------------------------
// Execution result / log status
// ---------------------------------------------------------------------------

export const LOG_STATUS = ['success', 'failed', 'partial'] as const;
export type LogStatus = (typeof LOG_STATUS)[number];

/** Result of running a single action, collected into the Log's resultData. */
export interface ActionResult {
  actionId: string;
  type: ActionType;
  status: 'success' | 'failed' | 'simulated';
  detail?: string;
}
