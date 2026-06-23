'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import type { DashboardStats } from '@/lib/types';

const KEY = 'pulsar_onboarding_dismissed';

export function OnboardingChecklist({ stats }: { stats: DashboardStats }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(KEY) === '1');
  }, []);

  const steps = [
    { label: 'Create your account', done: true, href: null, cta: '' },
    { label: 'Build your first workflow', done: stats.totalWorkflows > 0, href: '/workflows/new', cta: 'Build' },
    { label: 'Activate a workflow', done: stats.activeWorkflows > 0, href: '/workflows', cta: 'Activate' },
    {
      label: 'Watch it run',
      done: stats.recentExecutions.length > 0,
      href: '/workflows',
      cta: 'Run now',
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const allDone = completed === steps.length;

  if (dismissed || allDone) return null;

  const dismiss = () => {
    localStorage.setItem(KEY, '1');
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        className="card ring-grad overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Get started in 4 steps</h2>
            <p className="mt-1 text-sm text-slate-400">
              You&apos;re {completed}/{steps.length} of the way to your first live automation.
            </p>
          </div>
          <button onClick={dismiss} className="text-xs text-slate-500 transition hover:text-slate-300">
            Dismiss
          </button>
        </div>

        {/* progress bar */}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400"
            initial={{ width: 0 }}
            animate={{ width: `${(completed / steps.length) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>

        <ul className="mt-5 space-y-2.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] transition ${
                    s.done
                      ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white'
                      : 'border border-white/15 text-slate-500'
                  }`}
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <span className={`text-sm ${s.done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                  {s.label}
                </span>
              </div>
              {!s.done && s.href && (
                <Link href={s.href} className="btn-primary px-3 py-1 text-xs">
                  {s.cta}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </motion.div>
    </AnimatePresence>
  );
}
