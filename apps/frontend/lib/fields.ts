// Config field definitions are sourced from the shared catalog, keyed by type
// for convenient lookup in the builder.
import {
  TRIGGER_BY_TYPE,
  ACTION_BY_TYPE,
  type TriggerType,
  type ActionType,
  type CatalogField,
} from '@web3-zapier/shared';

export type FieldDef = CatalogField;

export const TRIGGER_FIELDS = Object.fromEntries(
  Object.entries(TRIGGER_BY_TYPE).map(([type, entry]) => [type, entry.fields]),
) as Record<TriggerType, CatalogField[]>;

export const ACTION_FIELDS = Object.fromEntries(
  Object.entries(ACTION_BY_TYPE).map(([type, entry]) => [type, entry.fields]),
) as Record<ActionType, CatalogField[]>;
