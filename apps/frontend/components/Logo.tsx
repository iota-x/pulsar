import Link from 'next/link';
import { APP_NAME } from '@/lib/brand';

/** Animated pulse mark + wordmark. */
export function Logo({ href = '/', size = 'md' }: { href?: string; size?: 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5">
      <span className="relative inline-flex h-7 w-7 items-center justify-center">
        <span className="absolute inset-0 rounded-[10px] bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 opacity-90 transition group-hover:opacity-100" />
        <span className="absolute inset-0 animate-pulse-glow rounded-[10px] bg-fuchsia-500/50 blur-md" />
        <span className="relative h-2 w-2 rounded-full bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.8)]" />
      </span>
      <span className={`font-display ${text} font-bold tracking-tight text-white`}>{APP_NAME}</span>
    </Link>
  );
}
