import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, unpackAccount, getMint } from '@solana/spl-token';
import type { TriggerData } from '@web3-zapier/shared';

export type DetectedEvent = { wallet: string; data: TriggerData };
type EventHandler = (event: DetectedEvent) => void;

/**
 * Manages Solana websocket subscriptions for a changing set of wallets.
 *
 * For each watched wallet it subscribes to:
 *   - account changes        → incoming SOL (wallet_received_sol) + balance snapshot
 *   - transaction logs        → confirmed transactions (transaction_confirmed)
 *   - SPL token program accts → incoming tokens / NFTs (wallet_received_token,
 *                               wallet_received_nft, airdrop_detected)
 *
 * The token subscription filters the Token program to accounts whose owner is
 * the watched wallet, so any balance increase on one of its token accounts is
 * detected as a receipt.
 */
export class SolanaWatcher {
  private connection: Connection;
  private onEvent: EventHandler;

  private accountSubs = new Map<string, number>();
  private logSubs = new Map<string, number>();
  private tokenSubs = new Map<string, number>();
  private lastLamports = new Map<string, number>();
  // Per token-account (base58) → last observed raw amount.
  private lastTokenAmount = new Map<string, bigint>();
  // Mint (base58) → decimals, cached to classify NFTs (decimals === 0).
  private mintDecimals = new Map<string, number>();

  constructor(rpcUrl: string, wsUrl: string, onEvent: EventHandler) {
    this.connection = new Connection(rpcUrl, { wsEndpoint: wsUrl, commitment: 'confirmed' });
    this.onEvent = onEvent;
  }

  /** Reconcile live subscriptions with the desired set of wallet addresses. */
  async sync(wallets: Set<string>): Promise<void> {
    for (const wallet of wallets) {
      if (!this.accountSubs.has(wallet)) await this.subscribe(wallet);
    }
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

    await this.subscribeTokens(wallet, pubkey);

    this.accountSubs.set(wallet, accountSub);
    this.logSubs.set(wallet, logSub);
    console.log(`[watcher] subscribed to ${wallet}`);
  }

  /** Watch the wallet's SPL token accounts for incoming tokens / NFTs. */
  private async subscribeTokens(wallet: string, pubkey: PublicKey): Promise<void> {
    // Seed existing token-account balances so a later change yields a real delta.
    try {
      const existing = await this.connection.getTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
      });
      for (const { pubkey: acct, account } of existing.value) {
        const parsed = unpackAccount(acct, account, TOKEN_PROGRAM_ID);
        this.lastTokenAmount.set(acct.toBase58(), parsed.amount);
      }
    } catch (err) {
      console.warn(`[watcher] could not seed token accounts for ${wallet}:`, err);
    }

    const tokenSub = this.connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      (keyed) => {
        void this.handleTokenAccountChange(wallet, keyed.accountId, keyed.accountInfo);
      },
      'confirmed',
      [{ dataSize: 165 }, { memcmp: { offset: 32, bytes: wallet } }],
    );
    this.tokenSubs.set(wallet, tokenSub);
  }

  private async handleTokenAccountChange(
    wallet: string,
    accountId: PublicKey,
    accountInfo: Parameters<typeof unpackAccount>[1],
  ): Promise<void> {
    let parsed;
    try {
      parsed = unpackAccount(accountId, accountInfo, TOKEN_PROGRAM_ID);
    } catch {
      return;
    }

    const key = accountId.toBase58();
    const prev = this.lastTokenAmount.get(key) ?? 0n;
    const delta = parsed.amount - prev;
    this.lastTokenAmount.set(key, parsed.amount);
    if (delta <= 0n) return; // only fire on receipts (balance increase)

    const mint = parsed.mint.toBase58();
    const decimals = await this.getDecimals(parsed.mint);
    const uiAmount = Number(delta) / 10 ** decimals;

    // Fungible token received (and airdrops are a special case of this).
    this.onEvent({ wallet, data: { triggerType: 'wallet_received_token', wallet, mint, amount: uiAmount } });
    this.onEvent({ wallet, data: { triggerType: 'airdrop_detected', wallet, mint, amount: uiAmount } });

    // A 0-decimal token transferred in is treated as an NFT.
    if (decimals === 0) {
      this.onEvent({ wallet, data: { triggerType: 'wallet_received_nft', wallet, mint } });
    }
  }

  /** Mint decimals, cached (used to classify NFTs vs fungible tokens). */
  private async getDecimals(mint: PublicKey): Promise<number> {
    const key = mint.toBase58();
    const cached = this.mintDecimals.get(key);
    if (cached !== undefined) return cached;
    try {
      const info = await getMint(this.connection, mint);
      this.mintDecimals.set(key, info.decimals);
      return info.decimals;
    } catch {
      return 0;
    }
  }

  private async unsubscribe(wallet: string): Promise<void> {
    const accountSub = this.accountSubs.get(wallet);
    const logSub = this.logSubs.get(wallet);
    const tokenSub = this.tokenSubs.get(wallet);
    if (accountSub !== undefined) await this.connection.removeAccountChangeListener(accountSub);
    if (logSub !== undefined) await this.connection.removeOnLogsListener(logSub);
    if (tokenSub !== undefined) await this.connection.removeProgramAccountChangeListener(tokenSub);
    this.accountSubs.delete(wallet);
    this.logSubs.delete(wallet);
    this.tokenSubs.delete(wallet);
    this.lastLamports.delete(wallet);
    console.log(`[watcher] unsubscribed from ${wallet}`);
  }
}
