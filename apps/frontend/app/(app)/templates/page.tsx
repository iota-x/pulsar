'use client';

import Link from 'next/link';
import { WORKFLOW_TEMPLATES, TRIGGER_LABELS, ACTION_LABELS } from '@/lib/types';

export default function TemplatesPage() {
  const categories = [...new Set(WORKFLOW_TEMPLATES.map((t) => t.category))];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Templates</h1>
        <p className="mt-1 text-sm text-slate-400">
          Start from a proven recipe — one click pre-fills the builder, then tweak and save.
        </p>
      </div>

      {categories.map((cat) => (
        <div key={cat} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{cat}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW_TEMPLATES.filter((t) => t.category === cat).map((t) => (
              <div key={t.id} className="card flex flex-col justify-between gap-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-white">{t.name}</h3>
                  <p className="mt-1 text-sm text-slate-400">{t.description}</p>
                  <div className="mt-3 space-y-1 text-xs text-slate-500">
                    <p>
                      <span className="text-brand">When</span> {TRIGGER_LABELS[t.trigger.type]}
                    </p>
                    <p>
                      <span className="text-emerald-400">Then</span>{' '}
                      {t.actions.map((a) => ACTION_LABELS[a.type]).join(' → ')}
                    </p>
                  </div>
                </div>
                <Link href={`/workflows/new?template=${t.id}`} className="btn-primary w-full text-center text-sm">
                  Use this template
                </Link>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
