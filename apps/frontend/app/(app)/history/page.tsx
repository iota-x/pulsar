'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { LogEntry } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';

export default function HistoryPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<LogEntry[]>('/logs')
      .then(setLogs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Execution history</h1>
      {error && <p className="text-rose-400">{error}</p>}
      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : logs.length === 0 ? (
        <div className="card text-sm text-slate-400">No executions recorded yet.</div>
      ) : (
        <div className="card divide-y divide-slate-800 p-0">
          {logs.map((log) => (
            <div key={log.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <Link href={`/workflows/${log.workflowId}`} className="text-sm font-medium hover:text-brand">
                  {log.workflow?.name ?? 'Workflow'}
                </Link>
                <p className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-slate-400 sm:inline">{log.message}</span>
                <StatusBadge status={log.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
