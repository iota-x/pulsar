'use client';

import Link from 'next/link';
import { AuroraBackground } from '@/components/AuroraBackground';
import { MarketingNav } from '@/components/MarketingNav';
import { Reveal } from '@/components/Reveal';
import { Logo } from '@/components/Logo';
import { APP_NAME } from '@/lib/brand';

const concepts = [
  {
    t: 'Wallet',
    d: 'Your account on Solana, identified by a public address (a long string like 7xKq…). It holds SOL and tokens.',
  },
  {
    t: 'SOL & lamports',
    d: "Solana's native coin. Fees are tiny — a transaction costs a fraction of a cent. 1 SOL = 1,000,000,000 lamports.",
  },
  {
    t: 'SPL token',
    d: 'Any token on Solana that isn’t SOL — like USDC or a project token. Each has a unique “mint” address.',
  },
  {
    t: 'NFT',
    d: 'A one-of-a-kind token (supply 1, 0 decimals). Art, collectibles, tickets — all live on-chain as NFTs.',
  },
  {
    t: 'Devnet vs Mainnet',
    d: 'Devnet is a free practice network with fake SOL — perfect for learning. Mainnet is the real one with real value.',
  },
  { t: 'Trigger', d: 'The “when” of a workflow — an on-chain event Pulsar watches for, like “a wallet receives SOL.”' },
  {
    t: 'Action',
    d: 'The “then” — what runs when the trigger fires: send tokens, notify Discord, swap, call a contract…',
  },
  {
    t: 'Signer',
    d: 'A keypair Pulsar uses to sign on-chain actions. Off-chain actions (webhooks, email) need no signer at all.',
  },
];

const recipes = [
  { name: 'Whale watch', when: 'A wallet receives ≥ 100 SOL', then: 'Post an alert to Discord', tag: 'Notifications' },
  { name: 'NFT mint alert', when: 'A new NFT is minted in a collection', then: 'Send yourself an email', tag: 'NFTs' },
  { name: 'Auto-reward', when: 'A wallet sends your token', then: 'Mint reward tokens back to them', tag: 'Tokens' },
  { name: 'Treasury guard', when: 'A wallet balance drops below 1 SOL', then: 'Top it up automatically', tag: 'DeFi' },
];

const steps = [
  {
    t: 'Create an account',
    d: 'Sign up with an email and password — that’s it. No wallet connection needed to start.',
  },
  {
    t: 'Open the builder',
    d: 'Hit “New workflow”. You’ll pick one trigger and one or more actions, each with simple config fields.',
  },
  {
    t: 'Choose your trigger',
    d: 'Start with “Wallet receives SOL”. Paste any Solana address to watch and an optional minimum amount.',
  },
  {
    t: 'Add an action',
    d: 'Pick “Store log” or “Send a notification” to keep it simple — these need no signer. Save the workflow.',
  },
  {
    t: 'Test it instantly',
    d: 'Open the workflow and hit “Run now” to fire it manually, then check the execution history.',
  },
  {
    t: 'Go live',
    d: 'Activate it. Pulsar now watches the chain and runs your workflow automatically whenever the event happens.',
  },
];

export default function LearnPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <AuroraBackground />
      <MarketingNav />

      <section className="mx-auto max-w-4xl px-4 pb-16 pt-36 text-center sm:pt-44">
        <Reveal>
          <span className="chip">📚 Beginner guide</span>
          <h1 className="font-display mt-6 text-balance text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
            New to web3? <span className="gradient-text">You’re in the right place.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
            {APP_NAME} lets you automate the Solana blockchain without writing a single line of code. This 5-minute
            guide explains the basics and walks you through your first workflow.
          </p>
        </Reveal>
      </section>

      {/* What is it */}
      <section className="mx-auto max-w-4xl px-4 py-10">
        <Reveal>
          <div className="card">
            <h2 className="font-display text-2xl font-semibold text-white">What is on-chain automation?</h2>
            <p className="mt-3 leading-relaxed text-slate-400">
              The Solana blockchain is a giant public ledger where things happen every second — wallets receive money,
              NFTs get minted, tokens get swapped. Normally you’d have to watch for those events yourself and react
              manually.
            </p>
            <p className="mt-3 leading-relaxed text-slate-400">
              {APP_NAME} does the watching for you. You describe a rule in plain terms —{' '}
              <span className="text-slate-200">
                “when <span className="text-violet-300">this</span> happens, do{' '}
                <span className="text-cyan-300">that</span>”
              </span>{' '}
              — and it runs automatically, 24/7. Think of it like email filters or IFTTT, but for the blockchain.
            </p>
          </div>
        </Reveal>
      </section>

      {/* Concepts */}
      <section className="mx-auto max-w-5xl px-4 py-12">
        <Reveal>
          <h2 className="font-display text-center text-3xl font-bold tracking-tight text-white">
            The words you’ll see
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-400">
            A quick glossary so nothing feels like jargon.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {concepts.map((c, i) => (
            <Reveal key={c.t} delay={(i % 2) * 0.06}>
              <div className="card card-hover h-full">
                <h3 className="font-display text-lg font-semibold text-white">{c.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{c.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Tutorial steps */}
      <section className="mx-auto max-w-4xl px-4 py-12">
        <Reveal>
          <h2 className="font-display text-center text-3xl font-bold tracking-tight text-white">
            Build your first workflow
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-400">
            Six steps, about five minutes. No crypto required — practice on free devnet.
          </p>
        </Reveal>
        <div className="mt-10 space-y-3">
          {steps.map((s, i) => (
            <Reveal key={s.t} delay={i * 0.05}>
              <div className="card flex items-start gap-4">
                <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold text-white">{s.t}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">{s.d}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Recipes */}
      <section className="mx-auto max-w-5xl px-4 py-12">
        <Reveal>
          <h2 className="font-display text-center text-3xl font-bold tracking-tight text-white">Ideas to steal</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-400">
            Popular recipes you can recreate in a couple of clicks.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {recipes.map((r, i) => (
            <Reveal key={r.name} delay={(i % 2) * 0.06}>
              <div className="card card-hover h-full">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-semibold text-white">{r.name}</h3>
                  <span className="chip">{r.tag}</span>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="flex gap-2 text-slate-300">
                    <span className="font-semibold text-violet-300">WHEN</span> {r.when}
                  </p>
                  <p className="flex gap-2 text-slate-300">
                    <span className="font-semibold text-cyan-300">THEN</span> {r.then}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center">
        <Reveal>
          <h2 className="font-display text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to try it yourself?
          </h2>
          <div className="mt-7 flex justify-center gap-3">
            <Link href="/login" className="btn-primary px-7 py-3 text-base">
              Create your free account
            </Link>
            <Link href="/" className="btn-ghost px-7 py-3 text-base">
              Back to home
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-slate-500 sm:flex-row">
          <Logo />
          <p>Built on Solana · {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
