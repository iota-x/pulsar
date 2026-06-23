'use client';

import { useEffect, useMemo, useState } from 'react';
import bs58 from 'bs58';
import { Connection } from '@solana/web3.js';
import { useWallet } from '@/components/WalletContext';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import { buildDelegationTx } from '@/lib/delegation';

export default function WalletPage() {
  const connection = useMemo(
    () => new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed'),
    [],
  );
  const { publicKey, connected, connecting, installed, connect, disconnect, signMessage, sendTransaction } = useWallet();
  const [me, setMe] = useState<User | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // delegation form
  const [mint, setMint] = useState('');
  const [max, setMax] = useState('100');
  const [expiryDays, setExpiryDays] = useState('');

  useEffect(() => {
    api<User>('/auth/me').then(setMe).catch(() => {});
  }, []);

  const connectedAddr = publicKey?.toBase58();
  const linked = me?.walletAddress && me.walletAddress === connectedAddr;

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
    if (!mint.trim()) return setMsg({ kind: 'err', text: 'Enter a token mint address' });
    const maxUi = Number(max);
    if (!Number.isFinite(maxUi) || maxUi <= 0) return setMsg({ kind: 'err', text: 'Enter a valid max amount' });
    setBusy('authorize');
    setMsg(null);
    try {
      const expiryUnix = expiryDays
        ? Math.floor(Date.now() / 1000) + Number(expiryDays) * 86400
        : 0;
      const tx = await buildDelegationTx(connection, publicKey, mint.trim(), maxUi, expiryUnix);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setMsg({
        kind: 'ok',
        text: `Authorized! Pulsar can now move up to ${maxUi} of this token, automatically, until you revoke.`,
      });
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
          Connect your wallet and authorize Pulsar to run on-chain actions on your behalf —
          non-custodially. We never hold your keys; you grant a capped, revocable permission.
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
            <button onClick={() => connect().catch((e) => setMsg({ kind: 'err', text: e.message }))} disabled={connecting} className="btn-primary py-2">
              {connecting ? 'Connecting…' : installed ? 'Connect wallet' : 'Install Phantom'}
            </button>
          )}
        </div>

        {connected && (
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-sm">
              <span className="text-slate-400">Connected: </span>
              <span className="font-mono text-slate-200">{connectedAddr?.slice(0, 6)}…{connectedAddr?.slice(-4)}</span>
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
            Grant a <span className="text-slate-200">capped, time-limited</span> permission for one token.
            Your workflows can then move it automatically — never more than this cap.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="label">Token mint address</label>
            <input className="input" placeholder="e.g. EPjFWdd5…" value={mint} onChange={(e) => setMint(e.target.value)} />
          </div>
          <div>
            <label className="label">Max amount</label>
            <input className="input" type="number" value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
          <div>
            <label className="label">Expires in (days, optional)</label>
            <input className="input" type="number" placeholder="never" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
          </div>
        </div>
        <button onClick={authorize} disabled={!linked || busy === 'authorize'} className="btn-primary">
          {busy === 'authorize' ? 'Confirm in your wallet…' : 'Authorize (one signature)'}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        How it works: you sign one transaction that approves Pulsar&apos;s on-chain program as a
        bounded delegate. When a trigger fires, the program moves your tokens within the cap — without
        any further approval. Revoke anytime from your wallet.
      </p>
    </div>
  );
}
