'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { tokenStore } from '@/lib/api';
import { AuroraBackground } from '@/components/AuroraBackground';
import { Logo } from '@/components/Logo';

const nav = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/history', label: 'History' },
  { href: '/learn', label: 'Learn' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && !tokenStore.get()) router.replace('/login');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <AuroraBackground grid={false} />

      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#050611]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-8">
            <Logo href="/dashboard" />
            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-1.5 text-sm transition ${
                      active ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-400 sm:inline">{user?.email}</span>
            <button onClick={logout} className="btn-ghost py-1.5">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
    </div>
  );
}
