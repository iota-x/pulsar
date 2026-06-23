'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { TRIGGER_LABELS, type Workflow, type TriggerType } from '@/lib/types';

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    api<Workflow[]>('/workflows')
      .then(setWorkflows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggle = async (wf: Workflow) => {
    await api(`/workflows/${wf.id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !wf.isActive }),
    });
    load();
  };

  const remove = async (wf: Workflow) => {
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    await api(`/workflows/${wf.id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Workflows</h1>
        <Link href="/workflows/new" className="btn-primary">
          + New workflow
        </Link>
      </div>

      {error && <p className="text-rose-400">{error}</p>}
      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : workflows.length === 0 ? (
        <div className="card text-sm text-slate-400">
          No workflows yet.{' '}
          <Link href="/workflows/new" className="text-brand hover:underline">
            Create your first one
          </Link>
          .
        </div>
      ) : (
        <div className="grid gap-4">
          {workflows.map((wf) => (
            <div key={wf.id} className="card flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link href={`/workflows/${wf.id}`} className="font-medium hover:text-brand">
                    {wf.name}
                  </Link>
                  <span
                    className={`h-2 w-2 rounded-full ${wf.isActive ? 'bg-emerald-400' : 'bg-slate-600'}`}
                    title={wf.isActive ? 'Active' : 'Inactive'}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {wf.trigger ? TRIGGER_LABELS[wf.trigger.type as TriggerType] : 'No trigger'} ·{' '}
                  {wf._count?.actions ?? 0} actions · {wf._count?.logs ?? 0} runs
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggle(wf)} className="btn-ghost py-1.5 text-xs">
                  {wf.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <Link href={`/workflows/${wf.id}`} className="btn-ghost py-1.5 text-xs">
                  View
                </Link>
                <button
                  onClick={() => remove(wf)}
                  className="btn-ghost py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
