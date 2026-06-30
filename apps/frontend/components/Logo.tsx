import Link from 'next/link';
import { APP_NAME } from '@/lib/brand';

/** Brand pulse mark (matches the favicon) + wordmark. */
export function Logo({ href = '/', size = 'md' }: { href?: string; size?: 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5">
      <span className="relative inline-flex h-7 w-7 items-center justify-center">
        {/* Animated glow behind the mark. */}
        <span className="absolute inset-0 animate-pulse-glow rounded-[10px] bg-fuchsia-500/40 blur-md" />
        {/* Pulsar mark — same artwork as app/icon.svg / the favicon. */}
        <svg viewBox="0 0 512 512" className="relative h-7 w-7" aria-hidden="true">
          <defs>
            <linearGradient id="pulsarLogo" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#C86DD7" />
              <stop offset="50%" stopColor="#9B6BE8" />
              <stop offset="100%" stopColor="#5A4FCF" />
            </linearGradient>
          </defs>
          <rect width="512" height="512" rx="112" fill="url(#pulsarLogo)" />
          <circle cx="256" cy="256" r="155" fill="none" stroke="#fff" strokeWidth="14" opacity="0.18" />
          <circle cx="256" cy="256" r="110" fill="none" stroke="#fff" strokeWidth="16" opacity="0.34" />
          <circle cx="256" cy="256" r="68" fill="none" stroke="#fff" strokeWidth="20" opacity="0.6" />
          <circle cx="256" cy="256" r="34" fill="#fff" />
        </svg>
      </span>
      <span className={`font-display ${text} font-bold tracking-tight text-white`}>{APP_NAME}</span>
    </Link>
  );
}
