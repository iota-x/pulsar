'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { tokenStore } from '@/lib/api';
import { APP_NAME, APP_TAGLINE } from '@/lib/brand';
import { TRIGGER_CATALOG, ACTION_CATALOG } from '@web3-zapier/shared';
import { AuroraBackground } from '@/components/AuroraBackground';
import { MarketingNav } from '@/components/MarketingNav';
import { Reveal } from '@/components/Reveal';
import { Logo } from '@/components/Logo';

const steps = [
  { n: '01', t: 'Pick a trigger', d: 'Choose an on-chain event — a wallet receiving SOL, an NFT mint, a program log, a price level.' },
  { n: '02', t: 'Add actions', d: 'Chain real actions: send tokens, swap on Jupiter, post to Discord, call a smart contract, and more.' },
  { n: '03', t: 'Activate & relax', d: 'Pulsar watches the chain 24/7 and runs your workflow automatically — every run logged.' },
];

const features = [
  { t: 'Real on-chain actions', d: 'Send/mint/burn tokens, transfer NFTs, stake, swap, create Raydium pools, run governance — signed and submitted for real.', icon: '⚡' },
  { t: 'Live event detection', d: 'Raw RPC websockets watch wallets, SPL tokens, NFTs, programs, slots and prices — no polling, no API keys.', icon: '📡' },
  { t: 'Visual builder', d: 'A Zapier-style drag-free builder. Trigger → action → action, with typed config for every step.', icon: '🧩' },
  { t: 'Cross-chain ready', d: 'Publish Wormhole messages to bridge intent to other chains, straight from a workflow.', icon: '🌉' },
  { t: 'Execution history', d: 'Every run is logged with status, trigger data and per-action results — with explorer links.', icon: '📜' },
  { t: 'Your keys, your rules', d: 'Bring a devnet or mainnet signer. Off-chain actions need no key at all.', icon: '🔐' },
];

export default function LandingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (tokenStore.get()) router.replace('/dashboard');
    else setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <AuroraBackground />
      <MarketingNav />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-36 sm:pt-44">
        <div className="flex flex-col items-center text-center">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="chip"
          >
            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-brand-green" />
            {APP_TAGLINE}
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="font-display mt-6 max-w-4xl text-balance text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-7xl"
          >
            Automate <span className="gradient-text">anything</span> that happens on Solana
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12 }}
            className="mt-6 max-w-2xl text-balance text-lg text-slate-400"
          >
            {APP_NAME} is Zapier for the Solana ecosystem. When an on-chain event fires, your workflow
            runs — sending tokens, swapping, notifying, or calling a contract. No code required.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
            <Link href="/login" className="btn-primary px-6 py-3 text-base">
              Start building — free
            </Link>
            <Link href="/learn" className="btn-ghost px-6 py-3 text-base">
              New to web3? Start here →
            </Link>
          </motion.div>

          <p className="mt-4 text-xs text-slate-500">
            {TRIGGER_CATALOG.length} triggers · {ACTION_CATALOG.length} actions · live on Solana devnet
          </p>
        </div>

        {/* Hero flow visual */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.25 }}
          className="ring-grad mx-auto mt-16 max-w-3xl rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl sm:p-10"
        >
          <FlowVisual />
        </motion.div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <SectionHeading eyebrow="How it works" title="From on-chain event to action in three steps" />
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="card card-hover h-full">
                <span className="font-display text-sm font-semibold text-violet-300/70">{s.n}</span>
                <h3 className="font-display mt-3 text-xl font-semibold text-white">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <SectionHeading eyebrow="Built for the chain" title="Everything is real — not a mockup" />
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.t} delay={(i % 3) * 0.08}>
              <div className="card card-hover h-full">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-lg">
                  {f.icon}
                </div>
                <h3 className="font-display mt-4 text-lg font-semibold text-white">{f.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Catalog marquee */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <Reveal>
          <p className="mb-5 text-center text-xs uppercase tracking-[0.2em] text-slate-500">
            Triggers & actions in the box
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            {[...TRIGGER_CATALOG.slice(0, 8), ...ACTION_CATALOG.slice(0, 8)].map((e) => (
              <span key={e.type} className="chip">
                {e.label}
              </span>
            ))}
            <span className="chip text-violet-300">+ {TRIGGER_CATALOG.length + ACTION_CATALOG.length - 16} more</span>
          </div>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-24">
        <Reveal>
          <div className="ring-grad relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600/15 via-fuchsia-600/10 to-cyan-500/10 px-6 py-16 text-center backdrop-blur-xl sm:px-16">
            <div className="absolute -right-20 -top-20 h-64 w-64 animate-float rounded-full bg-fuchsia-500/20 blur-3xl" />
            <h2 className="font-display relative text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Ship your first automation today
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-slate-300">
              Create a free account, connect a trigger, and watch {APP_NAME} run it the moment your
              event fires on-chain.
            </p>
            <div className="relative mt-8 flex justify-center gap-3">
              <Link href="/login" className="btn-primary px-7 py-3 text-base">
                Get started
              </Link>
              <Link href="/learn" className="btn-ghost px-7 py-3 text-base">
                Read the tutorial
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-slate-500 sm:flex-row">
          <Logo />
          <p>Built on Solana · {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300/80">{eyebrow}</span>
      <h2 className="font-display mt-3 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}

function FlowVisual() {
  const nodes = [
    { kind: 'TRIGGER', label: 'Wallet receives SOL', sub: '≥ 0.5 SOL', color: 'from-violet-500/30 to-violet-500/5 border-violet-400/30' },
    { kind: 'ACTION', label: 'Send Discord alert', sub: 'webhook', color: 'from-emerald-500/30 to-emerald-500/5 border-emerald-400/30' },
    { kind: 'ACTION', label: 'Swap to USDC', sub: 'Jupiter', color: 'from-cyan-500/30 to-cyan-500/5 border-cyan-400/30' },
  ];
  return (
    <div className="flex flex-col items-stretch gap-3">
      {nodes.map((n, i) => (
        <div key={i} className="flex flex-col items-center gap-3">
          {i > 0 && (
            <div className="flex flex-col items-center">
              <span className="h-6 w-px bg-gradient-to-b from-white/30 to-transparent" />
              <span className="text-[10px] text-slate-500">then</span>
            </div>
          )}
          <div
            className={`w-full rounded-2xl border bg-gradient-to-br ${n.color} px-5 py-4 text-left backdrop-blur`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{n.kind}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-display text-base font-semibold text-white">{n.label}</span>
              <span className="rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] text-slate-300">
                {n.sub}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
