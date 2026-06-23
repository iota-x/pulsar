'use client';

import Link from 'next/link';
import { Logo } from './Logo';

/** Sticky glass nav for the public (logged-out) marketing + learn pages. */
export function MarketingNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto mt-4 flex max-w-6xl items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 backdrop-blur-xl sm:px-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
          <Link href="/#how" className="transition hover:text-white">
            How it works
          </Link>
          <Link href="/#features" className="transition hover:text-white">
            Features
          </Link>
          <Link href="/learn" className="transition hover:text-white">
            Learn
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost hidden py-2 sm:inline-flex">
            Sign in
          </Link>
          <Link href="/login" className="btn-primary py-2">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
