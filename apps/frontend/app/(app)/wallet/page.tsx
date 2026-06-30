'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import bs58 from 'bs58';
import { Connection } from '@solana/web3.js';
import { useWallet } from '@/components/WalletContext';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import {
  buildDelegationTx,
  buildWrapAndDelegateTx,
  buildRevokeTx,
  fetchDelegations,
  type DelegationInfo,
} from '@/lib/delegation';

const PERIOD_OPTIONS: { label: string; seconds: number }[] = [
  { label: 'Total (lifetime cap)', seconds: 0 },
  { label: 'Per hour', seconds: 3600 },
  { label: 'Per day', seconds: 86400 },
  { label: 'Per week', seconds: 604800 },
];

const periodLabel = (seconds: number): string =>
  PERIOD_OPTIONS.find((p) => p.seconds === seconds)
    ?.label.replace(/^Per /, '')
    .toLowerCase() ?? `${seconds}s`;

/** Format a raw token amount (base units) into human UI units for display. */
const fmtAmount = (raw: bigint, decimals: number): string => {
  const ui = Number(raw) / 10 ** decimals;
  return ui.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 6) });
};

export default function WalletPage() {
  const connection = useMemo(
    () => new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed'),
    [],
  );
  const { publicKey, connected, connecting, installed, connect, disconnect, signMessage, sendTransaction } =
    useWallet();
  const [me, setMe] = useState<User | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // delegation form
  const [mint, setMint] = useState('');
  const [max, setMax] = useState('100');
  const [expiryDays, setExpiryDays] = useState('');
  const [recipients, setRecipients] = useState('');
  const [solMode, setSolMode] = useState(false);
  const [period, setPeriod] = useState('0'); // 0 = lifetime cap; else seconds
  const [delegations, setDelegations] = useState<DelegationInfo[]>([]);

  useEffect(() => {
    api<User>('/auth/me')
      .then(setMe)
      .catch(() => {});
  }, []);

  const connectedAddr = publicKey?.toBase58();
  const linked = me?.walletAddress && me.walletAddress === connectedAddr;

  const loadDelegations = useCallback(async () => {
    if (!publicKey) return setDelegations([]);
    try {
      setDelegations(await fetchDelegations(connection, publicKey));
    } catch {
      /* ignore */
    }
  }, [publicKey, connection]);

  useEffect(() => {
    void loadDelegations();
  }, [loadDelegations]);

  const revoke = async (mintAddr: string) => {
    if (!publicKey || !sendTransaction) return;
    setBusy('revoke:' + mintAddr);
    setMsg(null);
    try {
      const tx = await buildRevokeTx(publicKey, mintAddr);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setMsg({ kind: 'ok', text: 'Delegation revoked.' });
      await loadDelegations();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Revoke failed' });
    } finally {
      setBusy('');
    }
  };

  const linkWallet = async () => {
    if (!publicKey || !signMessage || !me) return;
    setBusy('link');
    setMsg(null);
    try {
      const message = `Pulsar: link wallet to account ${me.id}`;
      const sig = await signMessage(new TextEncoder().encode(message));
      const updated = await api<User>('/auth/wallet', {
        method: 'POST',
        body: JSON.stringify({ walletAddress: publicKey.toBase58(), signature: bs58.encode(sig) }),
      });
      setMe(updated);
      setMsg({ kind: 'ok', text: 'Wallet linked to your account.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to link wallet' });
    } finally {
      setBusy('');
    }
  };

  const authorize = async () => {
    if (!publicKey || !sendTransaction) return;
    if (!solMode && !mint.trim()) return setMsg({ kind: 'err', text: 'Enter a token mint address' });
    const maxUi = Number(max);
    if (!Number.isFinite(maxUi) || maxUi <= 0) return setMsg({ kind: 'err', text: 'Enter a valid amount' });
    setBusy('authorize');
    setMsg(null);
    try {
      const expiryUnix = expiryDays ? Math.floor(Date.now() / 1000) + Number(expiryDays) * 86400 : 0;
      const recipientList = recipients
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const periodSeconds = Number(period) || 0;
      const tx = solMode
        ? await buildWrapAndDelegateTx(connection, publicKey, maxUi, expiryUnix, recipientList, periodSeconds)
        : await buildDelegationTx(connection, publicKey, mint.trim(), maxUi, expiryUnix, recipientList, periodSeconds);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      const capPhrase = periodSeconds > 0 ? `up to ${maxUi} per ${periodLabel(periodSeconds)}` : `up to ${maxUi}`;
      setMsg({
        kind: 'ok',
        text: `Authorized! Pulsar can now move ${capPhrase} ${solMode ? 'wSOL' : 'of this token'}${recipientList.length ? ` (only to ${recipientList.length} allowed recipient(s))` : ''}, until you revoke.`,
      });
      await loadDelegations();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Authorization failed' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Wallet & permissions</h1>
        <p className="mt-1 text-sm text-slate-400">
          Connect your wallet and authorize Pulsar to run on-chain actions on your behalf — non-custodially. We never
          hold your keys; you grant a capped, revocable permission.
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

      {/* Connect + link */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">1. Connect your wallet</h2>
            <p className="mt-1 text-sm text-slate-400">
              {installed ? 'Phantom, Solflare, or any Solana wallet.' : 'No wallet detected — install Phantom.'}
            </p>
          </div>
          {connected ? (
            <button onClick={() => disconnect()} className="btn-ghost py-2">
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => connect().catch((e) => setMsg({ kind: 'err', text: e.message }))}
              disabled={connecting}
              className="btn-primary py-2"
            >
              {connecting ? 'Connecting…' : installed ? 'Connect wallet' : 'Install Phantom'}
            </button>
          )}
        </div>

        {connected && (
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-sm">
              <span className="text-slate-400">Connected: </span>
              <span className="font-mono text-slate-200">
                {connectedAddr?.slice(0, 6)}…{connectedAddr?.slice(-4)}
              </span>
              {linked && <span className="ml-2 text-emerald-400">✓ linked to your account</span>}
            </div>
            {!linked && (
              <button onClick={linkWallet} disabled={busy === 'link'} className="btn-primary py-2 text-xs">
                {busy === 'link' ? 'Signing…' : 'Link this wallet'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Authorize delegation */}
      <div className={`card space-y-4 ${!linked ? 'pointer-events-none opacity-50' : ''}`}>
        <div>
          <h2 className="font-display text-lg font-semibold text-white">2. Authorize automation</h2>
          <p className="mt-1 text-sm text-slate-400">
            Grant a <span className="text-slate-200">capped, time-limited</span> permission for one token. Your
            workflows can then move it automatically — never more than this cap.
          </p>
          <p className="mt-2 rounded-lg border border-violet-400/20 bg-violet-500/[0.06] px-3 py-2 text-xs text-violet-200/90">
            Pulsar charges a <span className="font-medium">0.5% fee</span> on each automated transfer, deducted on-chain
            — the recipient receives the rest, and the fee counts toward your cap.
          </p>
        </div>
        <label className="flex w-fit items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] px-3 py-2 text-sm text-slate-200">
          <input
            type="checkbox"
            className="h-4 w-4 accent-cyan-500"
            checked={solMode}
            onChange={(e) => setSolMode(e.target.checked)}
          />
          Delegate <span className="font-medium text-cyan-300">SOL</span> (auto-wraps to wSOL)
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {!solMode && (
            <div className="sm:col-span-3">
              <label className="label">Token mint address</label>
              <input
                className="input"
                placeholder="e.g. EPjFWdd5…"
                value={mint}
                onChange={(e) => setMint(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="label">{solMode ? 'SOL to wrap & delegate' : 'Max amount'}</label>
            <input className="input" type="number" value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
          <div>
            <label className="label">Cap window</label>
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.seconds} value={String(p.seconds)}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Expires in (days, optional)</label>
            <input
              className="input"
              type="number"
              placeholder="never"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
            />
          </div>
          <div className="sm:col-span-3">
            <label className="label">Restrict to recipients (optional, comma-separated)</label>
            <input
              className="input"
              placeholder="leave blank to allow any recipient — up to 5 addresses"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              For extra safety: even if Pulsar were compromised, your tokens could only go to these addresses.
            </p>
          </div>
        </div>
        <button onClick={authorize} disabled={!linked || busy === 'authorize'} className="btn-primary">
          {busy === 'authorize' ? 'Confirm in your wallet…' : 'Authorize (one signature)'}
        </button>
      </div>

      {/* Active delegations */}
      {connected && delegations.length > 0 && (
        <div className="card">
          <h2 className="font-display mb-4 text-lg font-semibold text-white">Your active delegations</h2>
          <div className="space-y-3">
            {delegations.map((d) => {
              const expired = d.expiry > 0 && d.expiry * 1000 < Date.now();
              return (
                <div key={d.pubkey} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-slate-200">
                        {d.mint.slice(0, 10)}…{d.mint.slice(-6)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {d.periodSeconds > 0
                          ? `${fmtAmount(d.windowAmount, d.decimals)} / ${fmtAmount(d.maxAmount, d.decimals)} this ${periodLabel(d.periodSeconds)}`
                          : `used ${fmtAmount(d.usedAmount, d.decimals)} / cap ${fmtAmount(d.maxAmount, d.decimals)}`}
                        {' · '}
                        {d.expiry === 0 ? (
                          'no expiry'
                        ) : expired ? (
                          <span className="text-rose-400">expired</span>
                        ) : (
                          `expires ${new Date(d.expiry * 1000).toLocaleDateString()}`
                        )}
                      </p>
                      {d.periodSeconds > 0 && (
                        <p className="mt-0.5 text-xs text-cyan-400">
                          rolling cap · resets every {periodLabel(d.periodSeconds)}
                        </p>
                      )}
                      {d.recipients.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500">restricted to {d.recipients.length} recipient(s)</p>
                      )}
                    </div>
                    <button
                      onClick={() => revoke(d.mint)}
                      disabled={busy === 'revoke:' + d.mint}
                      className="btn-ghost shrink-0 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"
                    >
                      {busy === 'revoke:' + d.mint ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500">
        How it works: you sign one transaction that approves Pulsar&apos;s on-chain program as a bounded delegate. When
        a trigger fires, the program moves your tokens within the cap — without any further approval. Revoke anytime
        from your wallet.
      </p>
    </div>
  );
}
