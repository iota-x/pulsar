'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { DashboardStats } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';

function StatCard({ label, value, accent, bar }: { label: string; value: number; accent?: string; bar: string }) {
  return (
    <div className="card card-hover relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-px ${bar}`} />
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`font-display mt-3 text-4xl font-bold ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<DashboardStats>('/dashboard')
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-rose-400">{error}</p>;
  if (!stats) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">Your automations at a glance.</p>
        </div>
        <Link href="/workflows/new" className="btn-primary">
          + New workflow
        </Link>
      </div>

      <OnboardingChecklist stats={stats} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total workflows"
          value={stats.totalWorkflows}
          bar="bg-gradient-to-r from-violet-500/0 via-violet-500/60 to-violet-500/0"
        />
        <StatCard
          label="Active workflows"
          value={stats.activeWorkflows}
          accent="text-emerald-300"
          bar="bg-gradient-to-r from-emerald-500/0 via-emerald-500/60 to-emerald-500/0"
        />
        <StatCard
          label="Failed executions"
          value={stats.failedExecutions}
          accent="text-rose-300"
          bar="bg-gradient-to-r from-rose-500/0 via-rose-500/60 to-rose-500/0"
        />
      </div>

      <div>
        <h2 className="font-display mb-3 text-lg font-semibold text-white">Recent executions</h2>
        {stats.recentExecutions.length === 0 ? (
          <div className="card text-sm text-slate-400">
            No executions yet. Create a workflow and trigger it to see activity here.
          </div>
        ) : (
          <div className="card divide-y divide-white/[0.06] p-0">
            {stats.recentExecutions.map((log) => (
              <div key={log.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{log.workflow?.name ?? 'Workflow'}</p>
                  <p className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{log.message}</span>
                  <StatusBadge status={log.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
