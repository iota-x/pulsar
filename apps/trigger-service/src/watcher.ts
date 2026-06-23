import { Connection, PublicKey } from '@solana/web3.js';
import type { TriggerData } from '@web3-zapier/shared';

export type DetectedEvent = { wallet: string; data: TriggerData };
type EventHandler = (event: DetectedEvent) => void;

/**
 * Manages Solana websocket subscriptions for a changing set of wallets.
 *
 * For each watched wallet it subscribes to:
 *   - account changes  → detects incoming SOL (wallet_received_sol)
 *   - transaction logs  → detects confirmed transactions (transaction_confirmed)
 *
 * Token / NFT triggers can be added by parsing SPL-token program logs inside
 * the existing onLogs subscription — the wiring is already here.
 */
export class SolanaWatcher {
  private connection: Connection;
  private onEvent: EventHandler;

  private accountSubs = new Map<string, number>();
  private logSubs = new Map<string, number>();
  private lastLamports = new Map<string, number>();

  constructor(rpcUrl: string, wsUrl: string, onEvent: EventHandler) {
    this.connection = new Connection(rpcUrl, { wsEndpoint: wsUrl, commitment: 'confirmed' });
    this.onEvent = onEvent;
  }

  /** Reconcile live subscriptions with the desired set of wallet addresses. */
  async sync(wallets: Set<string>): Promise<void> {
    // Subscribe to newly-added wallets.
    for (const wallet of wallets) {
      if (!this.accountSubs.has(wallet)) await this.subscribe(wallet);
    }
    // Unsubscribe from wallets no longer referenced by any active workflow.
    for (const wallet of [...this.accountSubs.keys()]) {
      if (!wallets.has(wallet)) await this.unsubscribe(wallet);
    }
  }

  private async subscribe(wallet: string): Promise<void> {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(wallet);
    } catch {
      console.warn(`[watcher] invalid wallet address, skipping: ${wallet}`);
      return;
    }

    // Seed the current balance so the first change reports an accurate delta.
    try {
      this.lastLamports.set(wallet, await this.connection.getBalance(pubkey));
    } catch {
      this.lastLamports.set(wallet, 0);
    }

    const accountSub = this.connection.onAccountChange(pubkey, (info) => {
      const prev = this.lastLamports.get(wallet) ?? info.lamports;
      const delta = info.lamports - prev;
      const balanceSol = info.lamports / 1e9;
      this.lastLamports.set(wallet, info.lamports);

      if (delta > 0) {
        this.onEvent({
          wallet,
          data: { triggerType: 'wallet_received_sol', wallet, amount: delta / 1e9, balanceSol },
        });
      }
      // Always emit a balance snapshot; index.ts matches it against each
      // workflow's configured threshold.
      this.onEvent({
        wallet,
        data: { triggerType: 'wallet_balance_below_threshold', wallet, balanceSol },
      });
    });

    const logSub = this.connection.onLogs(pubkey, (logs) => {
      if (logs.err) return; // only confirmed/successful transactions
      this.onEvent({
        wallet,
        data: { triggerType: 'transaction_confirmed', wallet, signature: logs.signature },
      });
    });

    this.accountSubs.set(wallet, accountSub);
    this.logSubs.set(wallet, logSub);
    console.log(`[watcher] subscribed to ${wallet}`);
  }

  private async unsubscribe(wallet: string): Promise<void> {
    const accountSub = this.accountSubs.get(wallet);
    const logSub = this.logSubs.get(wallet);
    if (accountSub !== undefined) await this.connection.removeAccountChangeListener(accountSub);
    if (logSub !== undefined) await this.connection.removeOnLogsListener(logSub);
    this.accountSubs.delete(wallet);
    this.logSubs.delete(wallet);
    this.lastLamports.delete(wallet);
    console.log(`[watcher] unsubscribed from ${wallet}`);
  }
}
