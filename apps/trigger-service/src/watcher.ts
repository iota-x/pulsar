import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, unpackAccount, getMint } from '@solana/spl-token';
import type { TriggerData } from '@web3-zapier/shared';
import { getCursor, setCursor } from './cursor';

export type DetectedEvent = { target: string; data: TriggerData & { kind: string } };
type EventHandler = (event: DetectedEvent) => void;

export interface SyncTargets {
  wallets: Set<string>;
  programs: Set<string>;
  accounts: Set<string>;
  slots: boolean;
  /** Fixed well-known programs → the specific trigger type they emit. */
  fixedPrograms: Map<string, string>;
  /** SPL mints to watch for transfers (nft_transferred). */
  mints: Set<string>;
}

// DEX program ids whose presence in a wallet's tx logs implies a swap.
const DEX_PROGRAMS = [
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb', // Raydium CPMM (devnet)
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM (mainnet)
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
];

// Per-trigger-type filter on a program's log lines (reduces noise). Kept
// lenient — these programs' main user instruction is the event we care about.
const FIXED_LOG_FILTER: Record<string, (logs: string[]) => boolean> = {
  nft_minted: (l) => l.some((x) => /Create|Mint/i.test(x)),
  new_token_listing: (l) => l.some((x) => /Initialize/i.test(x)),
  cross_chain_token_transfer: (l) => l.some((x) => /Sequence|PostMessage/i.test(x)),
};

/**
 * Manages Solana websocket subscriptions for a changing set of targets:
 *   - wallets  → SOL receipts, balance, confirmed txns, token/NFT receipts, funder
 *   - programs → program-log activity (success / failure)
 *   - accounts → account data changes (pool / stake / vesting balances)
 *   - slots    → new blocks
 *
 * Detection (here) is separated from matching (index.ts): events carry a `kind`
 * the matcher maps to the configured trigger types.
 */
export class SolanaWatcher {
  private connection: Connection;
  private onEvent: EventHandler;

  private accountSubs = new Map<string, number>(); // wallet → SOL onAccountChange
  private logSubs = new Map<string, number>(); // wallet → onLogs
  private tokenSubs = new Map<string, number>(); // wallet → token program-account
  private programSubs = new Map<string, number>(); // programId → onLogs
  private dataSubs = new Map<string, number>(); // account → onAccountChange
  private fixedSubs = new Map<string, number>(); // fixed program → onLogs
  private mintSubs = new Map<string, number>(); // mint → token-account onProgramAccountChange
  private slotSub: number | null = null;

  private lastLamports = new Map<string, number>();
  private lastValue = new Map<string, bigint>(); // watched account → token amount or lamports
  private lastTokenAmount = new Map<string, bigint>();
  private mintDecimals = new Map<string, number>();

  constructor(rpcUrl: string, wsUrl: string, onEvent: EventHandler) {
    this.connection = new Connection(rpcUrl, { wsEndpoint: wsUrl, commitment: 'confirmed' });
    this.onEvent = onEvent;
  }

  /** Reconcile all live subscriptions with the desired target sets. */
  async sync(t: SyncTargets): Promise<void> {
    await this.reconcile(this.accountSubs, t.wallets, (w) => this.subscribeWallet(w), (w) => this.unsubscribeWallet(w));
    await this.reconcile(this.programSubs, t.programs, (p) => this.subscribeProgram(p), (p) => this.unsubscribeProgram(p));
    await this.reconcile(this.dataSubs, t.accounts, (a) => this.subscribeAccount(a), (a) => this.unsubscribeAccount(a));
    await this.reconcile(
      this.fixedSubs,
      new Set(t.fixedPrograms.keys()),
      (p) => this.subscribeFixedProgram(p, t.fixedPrograms.get(p)!),
      (p) => this.unsubscribeFixedProgram(p),
    );
    await this.reconcile(this.mintSubs, t.mints, (m) => this.subscribeMint(m), (m) => this.unsubscribeMint(m));

    if (t.slots && this.slotSub === null) {
      this.slotSub = this.connection.onSlotChange(({ slot }) =>
        this.onEvent({ target: 'slot', data: { triggerType: 'new_block_mined', kind: 'slot', slot } }),
      );
      console.log('[watcher] subscribed to slots');
    } else if (!t.slots && this.slotSub !== null) {
      await this.connection.removeSlotChangeListener(this.slotSub);
      this.slotSub = null;
      console.log('[watcher] unsubscribed from slots');
    }
  }

  private async reconcile(
    live: Map<string, number>,
    desired: Set<string>,
    add: (k: string) => Promise<void>,
    remove: (k: string) => Promise<void>,
  ) {
    for (const k of desired) if (!live.has(k)) await add(k);
    for (const k of [...live.keys()]) if (!desired.has(k)) await remove(k);
  }

  // --- Wallets ----------------------------------------------------------

  private async subscribeWallet(wallet: string): Promise<void> {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(wallet);
    } catch {
      console.warn(`[watcher] invalid wallet, skipping: ${wallet}`);
      return;
    }

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
        this.onEvent({ target: wallet, data: { triggerType: 'wallet_received_sol', kind: 'wallet', wallet, amount: delta / 1e9, balanceSol } });
        void this.lookupFunder(wallet, delta / 1e9);
      }
      this.onEvent({ target: wallet, data: { triggerType: 'wallet_balance_below_threshold', kind: 'wallet', wallet, balanceSol } });
    });

    const logSub = this.connection.onLogs(pubkey, (logs) => {
      if (logs.err) return;
      void setCursor(wallet, logs.signature);
      this.emitWalletTx(wallet, logs.signature, logs.logs);
    });

    await this.subscribeTokens(wallet, pubkey);
    this.accountSubs.set(wallet, accountSub);
    this.logSubs.set(wallet, logSub);
    // Replay any transactions missed while we were down (deduped downstream).
    await this.backfill(wallet, pubkey, (sig, lines) => this.emitWalletTx(wallet, sig, lines));
    console.log(`[watcher] subscribed wallet ${wallet}`);
  }

  /** Emit the transaction-level events for a wallet signature (live or backfill). */
  private emitWalletTx(wallet: string, signature: string, lines: string[]): void {
    this.onEvent({ target: wallet, data: { triggerType: 'transaction_confirmed', kind: 'wallet', wallet, signature } });
    // A swap if any line references a known DEX program.
    if (lines.some((line) => DEX_PROGRAMS.some((p) => line.includes(p)))) {
      this.onEvent({ target: wallet, data: { triggerType: 'token_swap_executed', kind: 'wallet', wallet, signature } });
    }
  }

  /**
   * Replay transactions that occurred since the persisted cursor (a missed
   * window during downtime). Fetches signatures newer than the cursor and
   * re-emits them oldest-first; the worker's exactly-once claim drops any that
   * were already processed, so this is safe and idempotent.
   */
  private async backfill(target: string, pubkey: PublicKey, emit: (sig: string, lines: string[]) => void): Promise<void> {
    try {
      const cursor = await getCursor(target);
      const sigs = await this.connection.getSignaturesForAddress(pubkey, { until: cursor ?? undefined, limit: 50 });
      if (sigs.length === 0) return;
      // First run (no cursor): just set the high-water mark, don't replay history.
      if (!cursor) {
        await setCursor(target, sigs[0].signature);
        return;
      }
      const missed = sigs.filter((s) => !s.err).reverse(); // oldest → newest
      for (const s of missed) {
        const tx = await this.connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        emit(s.signature, tx?.meta?.logMessages ?? []);
      }
      await setCursor(target, sigs[0].signature);
      if (missed.length) console.log(`[watcher] backfilled ${missed.length} missed tx for ${target}`);
    } catch (err) {
      console.warn(`[watcher] backfill failed for ${target}:`, err instanceof Error ? err.message : err);
    }
  }

  /** On a SOL receipt, resolve the sender so wallet_funded_by_address can match. */
  private async lookupFunder(wallet: string, amount: number): Promise<void> {
    try {
      const sigs = await this.connection.getSignaturesForAddress(new PublicKey(wallet), { limit: 1 });
      if (!sigs.length) return;
      const tx = await this.connection.getParsedTransaction(sigs[0].signature, { maxSupportedTransactionVersion: 0 });
      const keys = tx?.transaction.message.accountKeys ?? [];
      const signer = keys.find((k) => k.signer)?.pubkey.toBase58();
      if (signer && signer !== wallet) {
        this.onEvent({ target: wallet, data: { triggerType: 'wallet_funded_by_address', kind: 'wallet', wallet, amount, fromAddress: signer } });
      }
    } catch {
      /* best-effort */
    }
  }

  private async subscribeTokens(wallet: string, pubkey: PublicKey): Promise<void> {
    try {
      const existing = await this.connection.getTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID });
      for (const { pubkey: acct, account } of existing.value) {
        this.lastTokenAmount.set(acct.toBase58(), unpackAccount(acct, account, TOKEN_PROGRAM_ID).amount);
      }
    } catch (err) {
      console.warn(`[watcher] token seed failed for ${wallet}:`, err);
    }

    const tokenSub = this.connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      (keyed) => void this.handleTokenChange(wallet, keyed.accountId, keyed.accountInfo),
      'confirmed',
      [{ dataSize: 165 }, { memcmp: { offset: 32, bytes: wallet } }],
    );
    this.tokenSubs.set(wallet, tokenSub);
  }

  private async handleTokenChange(wallet: string, accountId: PublicKey, accountInfo: Parameters<typeof unpackAccount>[1]): Promise<void> {
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
    if (delta <= 0n) return;

    const mint = parsed.mint.toBase58();
    const decimals = await this.getDecimals(parsed.mint);
    const uiAmount = Number(delta) / 10 ** decimals;
    this.onEvent({ target: wallet, data: { triggerType: 'wallet_received_token', kind: 'wallet', wallet, mint, amount: uiAmount } });
    this.onEvent({ target: wallet, data: { triggerType: 'airdrop_detected', kind: 'wallet', wallet, mint, amount: uiAmount } });
    if (decimals === 0) {
      this.onEvent({ target: wallet, data: { triggerType: 'wallet_received_nft', kind: 'wallet', wallet, mint } });
    }
  }

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

  private async unsubscribeWallet(wallet: string): Promise<void> {
    const a = this.accountSubs.get(wallet);
    const l = this.logSubs.get(wallet);
    const t = this.tokenSubs.get(wallet);
    if (a !== undefined) await this.connection.removeAccountChangeListener(a);
    if (l !== undefined) await this.connection.removeOnLogsListener(l);
    if (t !== undefined) await this.connection.removeProgramAccountChangeListener(t);
    this.accountSubs.delete(wallet);
    this.logSubs.delete(wallet);
    this.tokenSubs.delete(wallet);
    this.lastLamports.delete(wallet);
    console.log(`[watcher] unsubscribed wallet ${wallet}`);
  }

  // --- Programs ---------------------------------------------------------

  private async subscribeProgram(programId: string): Promise<void> {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(programId);
    } catch {
      console.warn(`[watcher] invalid programId, skipping: ${programId}`);
      return;
    }
    const sub = this.connection.onLogs(pubkey, (logs) => {
      void setCursor(programId, logs.signature);
      void this.emitProgramEvent(programId, logs.signature, logs.logs, !!logs.err);
    });
    this.programSubs.set(programId, sub);
    await this.backfill(programId, pubkey, (sig, lines) => void this.emitProgramEvent(programId, sig, lines, false));
    console.log(`[watcher] subscribed program ${programId}`);
  }

  /**
   * Emit a program-activity event enriched with the tx's log lines and the
   * accounts it touched — so the matcher can apply the per-type filters
   * (wallet for dApp interactions, an instruction match for governance votes).
   */
  private async emitProgramEvent(programId: string, signature: string, logs: string[], err: boolean): Promise<void> {
    const accounts = err ? [] : await this.fetchAccounts(signature);
    this.onEvent({
      target: programId,
      data: {
        triggerType: 'contract_event_emitted',
        kind: err ? 'program_failed' : 'program_success',
        programId,
        signature,
        logs,
        accounts,
      },
    });
  }

  /**
   * Best-effort list of base58 account keys involved in a transaction. Includes
   * addresses pulled in via Address Lookup Tables (meta.loadedAddresses) — modern
   * dApps put the user's wallet there, not in the static keys, so a wallet filter
   * that ignored them would miss real interactions.
   */
  private async fetchAccounts(signature: string): Promise<string[]> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
      const keys = (tx?.transaction.message.accountKeys ?? []).map((k) => k.pubkey.toBase58());
      const loaded = tx?.meta?.loadedAddresses;
      if (loaded) {
        for (const k of [...loaded.writable, ...loaded.readonly]) keys.push(k.toBase58());
      }
      return keys;
    } catch {
      return [];
    }
  }

  private async unsubscribeProgram(programId: string): Promise<void> {
    const s = this.programSubs.get(programId);
    if (s !== undefined) await this.connection.removeOnLogsListener(s);
    this.programSubs.delete(programId);
    console.log(`[watcher] unsubscribed program ${programId}`);
  }

  // --- Fixed well-known programs (Metaplex / Raydium / Wormhole) ---------

  private async subscribeFixedProgram(programId: string, triggerType: string): Promise<void> {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(programId);
    } catch {
      return;
    }
    const filter = FIXED_LOG_FILTER[triggerType];
    const sub = this.connection.onLogs(pubkey, (logs) => {
      if (logs.err) return;
      if (filter && !filter(logs.logs)) return;
      // Enrich with accounts so collection/mint filters (nft_minted /
      // new_token_listing) can scope the event to the configured address.
      void this.fetchAccounts(logs.signature).then((accounts) =>
        this.onEvent({
          target: programId,
          data: { triggerType: triggerType as TriggerData['triggerType'], kind: 'fixed', signature: logs.signature, logs: logs.logs, accounts },
        }),
      );
    });
    this.fixedSubs.set(programId, sub);
    console.log(`[watcher] subscribed fixed program ${programId} (${triggerType})`);
  }

  private async unsubscribeFixedProgram(programId: string): Promise<void> {
    const s = this.fixedSubs.get(programId);
    if (s !== undefined) await this.connection.removeOnLogsListener(s);
    this.fixedSubs.delete(programId);
  }

  // --- Mints (NFT transfers) --------------------------------------------

  private async subscribeMint(mint: string): Promise<void> {
    let mintKey: PublicKey;
    try {
      mintKey = new PublicKey(mint);
    } catch {
      return;
    }
    // Watch token accounts of this mint (memcmp at offset 0 = mint) for changes.
    const sub = this.connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      () => this.onEvent({ target: mint, data: { triggerType: 'nft_transferred', kind: 'mint', mint } }),
      'confirmed',
      [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mintKey.toBase58() } }],
    );
    this.mintSubs.set(mint, sub);
    console.log(`[watcher] subscribed mint ${mint} (nft_transferred)`);
  }

  private async unsubscribeMint(mint: string): Promise<void> {
    const s = this.mintSubs.get(mint);
    if (s !== undefined) await this.connection.removeProgramAccountChangeListener(s);
    this.mintSubs.delete(mint);
  }

  // --- Accounts ---------------------------------------------------------

  /**
   * The account's "value" for direction detection. For an SPL token account
   * (vesting vault, liquid-stake position) that's the token amount held in the
   * account DATA — lamports stay pinned at the rent-exempt minimum, so a token
   * release wouldn't show up there. For everything else (native stake accounts,
   * pool accounts) fall back to lamports.
   */
  private accountValue(pubkey: PublicKey, info: { owner: PublicKey; data: Buffer; lamports: number } | null): bigint {
    if (info && info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length === 165) {
      try {
        return unpackAccount(pubkey, info as Parameters<typeof unpackAccount>[1], TOKEN_PROGRAM_ID).amount;
      } catch {
        /* fall through to lamports */
      }
    }
    return BigInt(info?.lamports ?? 0);
  }

  private async subscribeAccount(account: string): Promise<void> {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(account);
    } catch {
      console.warn(`[watcher] invalid account, skipping: ${account}`);
      return;
    }
    try {
      this.lastValue.set(account, this.accountValue(pubkey, await this.connection.getAccountInfo(pubkey)));
    } catch {
      this.lastValue.set(account, 0n);
    }
    const sub = this.connection.onAccountChange(pubkey, (info) => {
      const value = this.accountValue(pubkey, info);
      const prev = this.lastValue.get(account) ?? value;
      const valueDelta = Number(value - prev);
      this.lastValue.set(account, value);
      // Direction lets the matcher tell rewards (value ↑) from a vesting
      // release (value ↓); liquidity_pool_balance_changed fires on either.
      this.onEvent({
        target: account,
        data: { triggerType: 'liquidity_pool_balance_changed', kind: 'account', account, lamports: info.lamports, valueDelta },
      });
    });
    this.dataSubs.set(account, sub);
    console.log(`[watcher] subscribed account ${account}`);
  }

  private async unsubscribeAccount(account: string): Promise<void> {
    const s = this.dataSubs.get(account);
    if (s !== undefined) await this.connection.removeAccountChangeListener(s);
    this.dataSubs.delete(account);
    this.lastValue.delete(account);
    console.log(`[watcher] unsubscribed account ${account}`);
  }
}
