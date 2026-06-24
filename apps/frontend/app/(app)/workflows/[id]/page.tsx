'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  TRIGGER_LABELS,
  ACTION_LABELS,
  type Workflow,
  type LogEntry,
  type TriggerType,
  type ActionType,
} from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';

function FlowNode({ kind, title, subtitle }: { kind: 'trigger' | 'action'; title: string; subtitle?: string }) {
  const color = kind === 'trigger' ? 'border-l-brand' : 'border-l-emerald-500';
  return (
    <div className={`card border-l-4 ${color} w-full max-w-md`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{kind}</p>
      <p className="font-medium">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [plan, setPlan] = useState<{ ok: boolean; plan: { type: string; status: string; detail?: string }[] } | null>(null);

  const load = () => {
    api<Workflow>(`/workflows/${id}`).then(setWf).catch((e) => setError(e.message));
    api<LogEntry[]>(`/logs/${id}`).then(setLogs).catch(() => {});
  };
  useEffect(load, [id]);

  const run = async () => {
    setMsg('');
    await api(`/workflows/${id}/run`, { method: 'POST', body: JSON.stringify({}) });
    setMsg('Execution enqueued — refresh history in a moment.');
    setTimeout(load, 1500);
  };

  const simulate = async () => {
    setMsg('');
    setPlan(null);
    const result = await api<{ ok: boolean; plan: { type: string; status: string; detail?: string }[] }>(
      `/workflows/${id}/simulate`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    setPlan(result);
  };

  const remove = async () => {
    if (!confirm('Delete this workflow?')) return;
    await api(`/workflows/${id}`, { method: 'DELETE' });
    router.push('/workflows');
  };

  if (error) return <p className="text-rose-400">{error}</p>;
  if (!wf) return <p className="text-slate-400">Loading…</p>;

  const summarize = (config: Record<string, unknown>) =>
    Object.entries(config)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' · ') || undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">{wf.name}</h1>
          {wf.description && <p className="text-sm text-slate-400">{wf.description}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={simulate} className="btn-ghost">
            🧪 Test (dry-run)
          </button>
          <button onClick={run} className="btn-primary">
            ▶ Run now
          </button>
          <button onClick={remove} className="btn-ghost text-rose-400">
            Delete
          </button>
        </div>
      </div>

      {msg && <p className="text-sm text-emerald-400">{msg}</p>}

      {plan && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Dry-run plan</h2>
            <span className={`text-sm ${plan.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
              {plan.ok ? '✓ All actions valid — nothing executed' : '✗ Fix the issues below'}
            </span>
          </div>
          <ul className="space-y-1.5 text-sm">
            {plan.plan.map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                <StatusBadge status={p.status} />
                <span className="text-slate-300">{ACTION_LABELS[p.type as ActionType] ?? p.type}</span>
                {p.detail && <span className="text-slate-500">— {p.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Visual flow */}
      <div className="flex flex-col items-center gap-2">
        {wf.trigger && (
          <FlowNode
            kind="trigger"
            title={TRIGGER_LABELS[wf.trigger.type as TriggerType]}
            subtitle={summarize(wf.trigger.config)}
          />
        )}
        {wf.actions?.map((a) => (
          <div key={a.id} className="flex w-full flex-col items-center gap-2">
            <span className="text-slate-600">↓</span>
            <FlowNode
              kind="action"
              title={ACTION_LABELS[a.type as ActionType]}
              subtitle={summarize(a.config)}
            />
          </div>
        ))}
      </div>

      {/* History */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Execution history</h2>
        {logs.length === 0 ? (
          <div className="card text-sm text-slate-400">No executions yet.</div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="card">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</span>
                  <StatusBadge status={log.status} />
                </div>
                <p className="mt-1 text-sm">{log.message}</p>
                {log.resultData != null && (
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-400">
                    {JSON.stringify(log.resultData, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
