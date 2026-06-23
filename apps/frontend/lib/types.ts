// Trigger/action catalog comes from the shared workspace package so the builder
// always matches what the backend validates and the worker executes.
export {
  TRIGGER_TYPES,
  ACTION_TYPES,
  TRIGGER_CATALOG,
  ACTION_CATALOG,
  TRIGGER_BY_TYPE,
  ACTION_BY_TYPE,
  TRIGGER_LABELS,
  ACTION_LABELS,
} from '@web3-zapier/shared';
export type {
  TriggerType,
  ActionType,
  Implementation,
  CatalogEntry,
  CatalogField,
} from '@web3-zapier/shared';

import type { TriggerType, ActionType } from '@web3-zapier/shared';

export interface Trigger {
  id: string;
  type: TriggerType;
  config: Record<string, unknown>;
}

export interface Action {
  id: string;
  type: ActionType;
  config: Record<string, unknown>;
  order: number;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  trigger?: Trigger | null;
  actions?: Action[];
  _count?: { actions: number; logs: number };
}

export interface LogEntry {
  id: string;
  workflowId: string;
  status: 'success' | 'failed' | 'partial';
  message?: string | null;
  triggerData?: Record<string, unknown> | null;
  resultData?: unknown;
  createdAt: string;
  workflow?: { id: string; name: string };
}

export interface DashboardStats {
  totalWorkflows: number;
  activeWorkflows: number;
  failedExecutions: number;
  recentExecutions: LogEntry[];
}

export interface User {
  id: string;
  email: string;
  walletAddress?: string | null;
  createdAt: string;
}
