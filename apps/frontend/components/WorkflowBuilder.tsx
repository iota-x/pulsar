'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TRIGGER_CATALOG,
  ACTION_CATALOG,
  TRIGGER_BY_TYPE,
  ACTION_BY_TYPE,
  type TriggerType,
  type ActionType,
  type Implementation,
} from '@/lib/types';
import { TRIGGER_FIELDS, ACTION_FIELDS, type FieldDef } from '@/lib/fields';

export type Config = Record<string, string>;
export interface ActionDraft {
  type: ActionType;
  config: Config;
}

/** The shape both create and edit submit to the API. */
export interface WorkflowDraft {
  name: string;
  description?: string;
  trigger: { type: TriggerType; config: Config };
  actions: { type: ActionType; config: Config }[];
}

export interface WorkflowInitial {
  name: string;
  description: string;
  triggerType: TriggerType;
  triggerConfig: Config;
  actions: ActionDraft[];
}

export const EMPTY_WORKFLOW: WorkflowInitial = {
  name: '',
  description: '',
  triggerType: 'wallet_received_sol',
  triggerConfig: {},
  actions: [{ type: 'send_discord_message', config: {} }],
};

/** Small badge showing how a primitive is implemented. */
function ImplBadge({ impl }: { impl: Implementation }) {
  const map: Record<Implementation, [string, string]> = {
    api: ['API Call', 'bg-sky-500/15 text-sky-400'],
    smart_contract: ['Smart Contract', 'bg-amber-500/15 text-amber-400'],
    hybrid: ['Hybrid', 'bg-fuchsia-500/15 text-fuchsia-400'],
  };
  const [label, cls] = map[impl];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

/** Render the dynamic config inputs for a trigger/action type. */
function ConfigFields({
  fields,
  config,
  onChange,
}: {
  fields: FieldDef[];
  config: Config;
  onChange: (key: string, value: string) => void;
}) {
  if (fields.length === 0) return <p className="text-xs text-slate-500">No configuration needed.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="label">
            {f.label} {f.required && <span className="text-rose-400">*</span>}
          </label>
          {f.type === 'select' ? (
            <select className="input" value={config[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)}>
              <option value="">— select —</option>
              {f.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              type={f.type === 'number' ? 'number' : 'text'}
              placeholder={f.placeholder}
              value={config[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          )}
          {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * Shared trigger + actions builder used by both the "new" and "edit" pages.
 * Owns the form state (seeded from `initial`) and hands a cleaned draft to
 * `onSubmit`; the parent decides whether that's a POST (create) or PUT (edit).
 */
export function WorkflowBuilder({
  heading,
  submitLabel,
  initial,
  onSubmit,
}: {
  heading: string;
  submitLabel: string;
  initial: WorkflowInitial;
  onSubmit: (draft: WorkflowDraft) => Promise<void>;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [triggerType, setTriggerType] = useState<TriggerType>(initial.triggerType);
  const [triggerConfig, setTriggerConfig] = useState<Config>(initial.triggerConfig);
  const [actions, setActions] = useState<ActionDraft[]>(initial.actions);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const setTriggerField = (key: string, value: string) => setTriggerConfig((c) => ({ ...c, [key]: value }));

  const updateAction = (i: number, patch: Partial<ActionDraft>) =>
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  const setActionField = (i: number, key: string, value: string) =>
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, config: { ...a.config, [key]: value } } : a)));

  const addAction = () => setActions((prev) => [...prev, { type: 'store_log', config: {} }]);
  const removeAction = (i: number) => setActions((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setActions((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // Drop empty strings so optional fields aren't stored as "".
  const clean = (c: Config) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== ''));

  const submit = async () => {
    setError('');
    if (!name.trim()) return setError('Workflow name is required');
    setSaving(true);
    try {
      await onSubmit({
        name,
        description: description || undefined,
        trigger: { type: triggerType, config: clean(triggerConfig) },
        actions: actions.map((a) => ({ type: a.type, config: clean(a.config) })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold tracking-tight text-white">{heading}</h1>

      {/* Metadata */}
      <div className="card space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Whale wallet tracker" />
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      {/* Trigger */}
      <div className="card space-y-4 border-l-4 border-l-brand">
        <div className="flex items-center gap-2">
          <span className="rounded bg-brand/20 px-2 py-0.5 text-xs font-medium text-brand">TRIGGER</span>
          <h2 className="font-semibold">When this happens…</h2>
          <ImplBadge impl={TRIGGER_BY_TYPE[triggerType].implementation} />
        </div>
        <select
          className="input"
          value={triggerType}
          onChange={(e) => {
            setTriggerType(e.target.value as TriggerType);
            setTriggerConfig({});
          }}
        >
          {TRIGGER_CATALOG.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">{TRIGGER_BY_TYPE[triggerType].description}</p>
        <ConfigFields fields={TRIGGER_FIELDS[triggerType]} config={triggerConfig} onChange={setTriggerField} />
      </div>

      {/* Actions */}
      <div className="space-y-4">
        {actions.map((action, i) => (
          <div key={i} className="card space-y-4 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                  ACTION {i + 1}
                </span>
                <h2 className="font-semibold">…do this</h2>
                <ImplBadge impl={ACTION_BY_TYPE[action.type].implementation} />
              </div>
              <div className="flex gap-1 text-xs">
                <button className="btn-ghost px-2 py-1" onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button className="btn-ghost px-2 py-1" onClick={() => move(i, 1)} disabled={i === actions.length - 1}>
                  ↓
                </button>
                {actions.length > 1 && (
                  <button className="btn-ghost px-2 py-1 text-rose-400" onClick={() => removeAction(i)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            <select
              className="input"
              value={action.type}
              onChange={(e) => updateAction(i, { type: e.target.value as ActionType, config: {} })}
            >
              {ACTION_CATALOG.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">{ACTION_BY_TYPE[action.type].description}</p>
            {(action.type === 'send_tokens' ||
              action.type === 'reward_user_tokens' ||
              action.type === 'execute_buy_sell_order') && (
              <label className="flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-violet-500"
                  checked={action.config.useDelegation === 'true'}
                  onChange={(e) => setActionField(i, 'useDelegation', e.target.checked ? 'true' : '')}
                />
                {action.type === 'execute_buy_sell_order' ? (
                  <span>
                    Use my own wallet (delegated) — swaps <span className="font-medium text-violet-300">your</span> delegated
                    token via Jupiter, capped by what you authorized. <span className="text-amber-300">Mainnet only.</span>
                  </span>
                ) : (
                  <span>
                    Use my own wallet (delegated) — moves the token from{' '}
                    <span className="font-medium text-violet-300">your</span> linked wallet, capped by what you authorized.
                  </span>
                )}
              </label>
            )}
            <ConfigFields
              fields={ACTION_FIELDS[action.type]}
              config={action.config}
              onChange={(key, value) => setActionField(i, key, value)}
            />
          </div>
        ))}
        <button onClick={addAction} className="btn-ghost w-full border-dashed">
          + Add action
        </button>
      </div>

      {error && <p className="text-rose-400">{error}</p>}

      <div className="flex gap-3">
        <button onClick={submit} className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button onClick={() => router.back()} className="btn-ghost">
          Cancel
        </button>
      </div>
    </div>
  );
}
