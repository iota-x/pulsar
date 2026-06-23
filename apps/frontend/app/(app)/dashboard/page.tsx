'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { DashboardStats } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? ''}`}>{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<DashboardStats>('/dashboard').then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-rose-400">{error}</p>;
  if (!stats) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/workflows/new" className="btn-primary">
          + New workflow
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total workflows" value={stats.totalWorkflows} />
        <StatCard label="Active workflows" value={stats.activeWorkflows} accent="text-emerald-400" />
        <StatCard label="Failed executions" value={stats.failedExecutions} accent="text-rose-400" />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent executions</h2>
        {stats.recentExecutions.length === 0 ? (
          <div className="card text-sm text-slate-400">
            No executions yet. Create a workflow and trigger it to see activity here.
          </div>
        ) : (
          <div className="card divide-y divide-slate-800 p-0">
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
