'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Buffer } from 'buffer';
import { PublicKey, Transaction, type Connection } from '@solana/web3.js';

// web3.js needs a Buffer global in the browser.
if (typeof window !== 'undefined') {
  (window as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
}

interface InjectedProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
  on?(event: string, cb: (...args: unknown[]) => void): void;
}

function getProvider(): InjectedProvider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    phantom?: { solana?: InjectedProvider };
    solflare?: InjectedProvider;
    solana?: InjectedProvider;
  };
  return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : undefined) ?? w.solflare ?? w.solana ?? null;
}

interface WalletState {
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  installed: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletContext({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [installed, setInstalled] = useState(false);

  // Detect an injected wallet + try silent reconnect.
  useEffect(() => {
    const p = getProvider();
    setInstalled(!!p);
    if (!p) return;
    p.connect({ onlyIfTrusted: true })
      .then((r) => setPublicKey(new PublicKey(r.publicKey.toString())))
      .catch(() => {});
    p.on?.('disconnect', () => setPublicKey(null));
    p.on?.('accountChanged', (pk) => setPublicKey(pk ? new PublicKey(String(pk)) : null));
  }, []);

  const connect = useCallback(async () => {
    const p = getProvider();
    if (!p) {
      window.open('https://phantom.app/', '_blank');
      throw new Error('No Solana wallet detected. Install Phantom and reload.');
    }
    setConnecting(true);
    try {
      const r = await p.connect();
      setPublicKey(new PublicKey(r.publicKey.toString()));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await getProvider()?.disconnect();
    setPublicKey(null);
  }, []);

  const signMessage = useCallback(async (message: Uint8Array) => {
    const p = getProvider();
    if (!p) throw new Error('No wallet connected');
    const { signature } = await p.signMessage(message, 'utf8');
    return signature;
  }, []);

  const sendTransaction = useCallback(
    async (tx: Transaction, connection: Connection) => {
      const p = getProvider();
      if (!p || !publicKey) throw new Error('No wallet connected');
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const { signature } = await p.signAndSendTransaction(tx);
      return signature;
    },
    [publicKey],
  );

  return (
    <Ctx.Provider
      value={{
        publicKey,
        connected: !!publicKey,
        connecting,
        installed,
        connect,
        disconnect,
        signMessage,
        sendTransaction,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWallet must be used within WalletContext');
  return ctx;
}
