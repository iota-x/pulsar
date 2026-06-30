'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Connection } from '@solana/web3.js';
import { useWallet } from '@/components/WalletContext';
import { fetchDelegations, type DelegationInfo } from '@/lib/delegation';
import { api } from '@/lib/api';

type Mode = 'stop_loss' | 'take_profit';

const MODES: Record<Mode, { label: string; verb: string; direction: 'below' | 'above'; hint: string }> = {
  stop_loss: {
    label: 'Stop-loss',
    verb: 'falls below',
    direction: 'below',
    hint: 'Cap your downside — sell automatically if the price drops.',
  },
  take_profit: {
    label: 'Take-profit',
    verb: 'rises above',
    direction: 'above',
    hint: 'Lock in gains — sell automatically when the price hits your target.',
  },
};

export default function ProtectPage() {
  const router = useRouter();
  const connection = useMemo(
    () => new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed'),
    [],
  );
  const { publicKey, connected } = useWallet();

  const [mode, setMode] = useState<Mode>('stop_loss');
  const [mint, setMint] = useState('');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [slippage, setSlippage] = useState('1');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [delegations, setDelegations] = useState<DelegationInfo[]>([]);

  useEffect(() => {
    if (!publicKey) return setDelegations([]);
    fetchDelegations(connection, publicKey)
      .then(setDelegations)
      .catch(() => {});
  }, [publicKey, connection]);

  // Is there a live (unexpired) delegation covering the token we're protecting?
  const delegated = useMemo(() => {
    const m = mint.trim();
    if (!m) return null;
    const d = delegations.find((x) => x.mint === m);
    if (!d) return false;
    return d.expiry === 0 || d.expiry * 1000 > Date.now();
  }, [mint, delegations]);

  const create = useCallback(async () => {
    const m = mint.trim();
    const amt = Number(amount);
    const target = Number(price);
    if (!m) return setMsg({ kind: 'err', text: 'Enter the token mint address' });
    if (!Number.isFinite(amt) || amt <= 0) return setMsg({ kind: 'err', text: 'Enter how much of the token to sell' });
    if (!Number.isFinite(target) || target <= 0) return setMsg({ kind: 'err', text: 'Enter a valid trigger price' });

    setBusy(true);
    setMsg(null);
    try {
      const { direction, label } = MODES[mode];
      const slippageBps = String(Math.max(1, Math.round(Number(slippage || '1') * 100)));
      await api('/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: `${label} · ${m.slice(0, 4)}…${m.slice(-4)} @ $${target}`,
          description: `Auto-sell ${amt} when price ${MODES[mode].verb} $${target} (non-custodial, via Jupiter).`,
          trigger: { type: 'token_price_threshold', config: { mint: m, targetPrice: String(target), direction } },
          actions: [
            { type: 'execute_buy_sell_order', config: { mint: m, side: 'sell', amount: String(amt), slippageBps } },
          ],
        }),
      });
      router.push('/workflows');
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to create protection' });
    } finally {
      setBusy(false);
    }
  }, [mint, amount, price, slippage, mode, router]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Protect a token</h1>
        <p className="mt-1 text-sm text-slate-400">
          Set a price-triggered auto-sell. When your target is hit, Pulsar swaps the token through Jupiter —
          <span className="text-slate-200"> from your own wallet, non-custodially</span>, capped by the delegation you
          authorized.
        </p>
      </div>

      {msg && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            msg.kind === 'ok'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/20 bg-rose-500/10 text-rose-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="card space-y-5">
        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                mode === m ? 'border-brand bg-brand/10' : 'border-white/10 bg-black/20 hover:border-white/20'
              }`}
            >
              <div className="font-semibold text-white">{MODES[m].label}</div>
              <div className="mt-0.5 text-xs text-slate-400">{MODES[m].hint}</div>
            </button>
          ))}
        </div>

        <div>
          <label className="label">Token mint</label>
          <input
            className="input"
            placeholder="SPL token mint address"
            value={mint}
            onChange={(e) => setMint(e.target.value)}
          />
          {connected && mint.trim() && (
            <p className={`mt-1 text-xs ${delegated ? 'text-emerald-400' : 'text-amber-300'}`}>
              {delegated
                ? '✓ delegation active for this token'
                : '⚠ no delegation for this token yet — authorize one on the Wallet page'}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Amount to sell (tokens)</label>
            <input
              className="input"
              type="number"
              placeholder="e.g. 1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Trigger price (USD)</label>
            <input
              className="input"
              type="number"
              placeholder={mode === 'stop_loss' ? 'sell if it drops to…' : 'sell if it climbs to…'}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>

        <div className="sm:w-1/2">
          <label className="label">Max slippage (%)</label>
          <input className="input" type="number" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </div>

        <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-4 py-3 text-xs text-violet-200/90">
          Runs <span className="font-medium">non-custodially</span> from your wallet via a capped delegation. A
          <span className="font-medium"> 0.5% platform fee</span> is taken on-chain from each sell.
          <span className="text-amber-300"> Swaps use Jupiter liquidity — mainnet only.</span>
        </div>

        {connected && mint.trim() && delegated === false && (
          <Link href="/wallet" className="block text-sm text-brand underline">
            → Authorize a delegation for this token first
          </Link>
        )}

        <button onClick={create} disabled={busy} className="btn-primary w-full">
          {busy ? 'Creating…' : `Create ${MODES[mode].label.toLowerCase()}`}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        How it works: a price watcher fires the moment your token crosses the trigger, then the program sells your
        position within the limits you set — no further approval, and you can revoke anytime from your wallet.
      </p>
    </div>
  );
}
