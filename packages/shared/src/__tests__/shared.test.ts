import { describe, it, expect } from 'vitest';
import {
  dedupeKeyFor,
  bullmqJobId,
  planAction,
  solanaWsUrl,
  WORKFLOW_TEMPLATES,
  TRIGGER_BY_TYPE,
  ACTION_BY_TYPE,
  isTriggerType,
  isActionType,
  TRIGGER_TYPES,
  TRIGGER_PLACEHOLDERS,
  placeholdersFor,
  isActionAvailable,
  isTriggerAvailable,
  toSupportedNetwork,
  DEFAULT_NETWORK,
  ACTION_CAPABILITIES,
  type TriggerData,
} from '../index';

describe('solanaWsUrl', () => {
  it('derives wss from an https RPC', () => {
    expect(solanaWsUrl('https://devnet.helius-rpc.com/?api-key=abc')).toBe('wss://devnet.helius-rpc.com/?api-key=abc');
  });
  it('derives ws from an http RPC', () => {
    expect(solanaWsUrl('http://localhost:8899')).toBe('ws://localhost:8899');
  });
  it('prefers an explicit override', () => {
    expect(solanaWsUrl('https://a.com', 'wss://custom-ws.com')).toBe('wss://custom-ws.com');
  });
  it('ignores a blank override', () => {
    expect(solanaWsUrl('https://a.com', '   ')).toBe('wss://a.com');
  });
});

describe('dedupeKeyFor', () => {
  const wf = 'wf_123';

  it('prefers the tx signature (stable across processes)', () => {
    const d: TriggerData = { triggerType: 'transaction_confirmed', signature: 'sigABC' };
    expect(dedupeKeyFor(wf, d)).toBe('wf_123:transaction_confirmed:sigABC');
  });

  it('is identical for the same event (so retries collapse)', () => {
    const d: TriggerData = { triggerType: 'wallet_received_sol', signature: 'sigX', amount: 5 };
    expect(dedupeKeyFor(wf, d)).toBe(dedupeKeyFor(wf, d));
  });

  it('differs for distinct signatures (so distinct events run)', () => {
    const a = dedupeKeyFor(wf, { triggerType: 'transaction_confirmed', signature: 's1' });
    const b = dedupeKeyFor(wf, { triggerType: 'transaction_confirmed', signature: 's2' });
    expect(a).not.toBe(b);
  });

  it('uses slot when there is no signature', () => {
    expect(dedupeKeyFor(wf, { triggerType: 'new_block_mined', slot: 42 })).toBe('wf_123:new_block_mined:slot:42');
  });

  it('uses scheduledAt for scheduled triggers', () => {
    const d: TriggerData = { triggerType: 'scheduled_time', scheduledAt: '2026-01-01T00:00:00.000Z' };
    expect(dedupeKeyFor(wf, d)).toBe('wf_123:scheduled_time:2026-01-01T00:00:00.000Z');
  });

  it('falls back to a detection instant for id-less events', () => {
    const d: TriggerData = { triggerType: 'token_price_threshold', detectedAt: 'stampZ' };
    expect(dedupeKeyFor(wf, d)).toBe('wf_123:token_price_threshold:stampZ');
  });
});

describe('bullmqJobId', () => {
  // BullMQ accepts a custom jobId with ':' only if it splits into exactly 3
  // parts. Our keys embed ISO timestamps (HH:MM:SS) and 'slot:' segments, so a
  // raw key would throw "Custom Id cannot contain :". The jobId must be ':'-free.
  it('strips every colon from the dedupe key', () => {
    expect(bullmqJobId('wf:wallet_received_sol:2026-06-25T08:59:38.988Z')).not.toContain(':');
  });

  it('produces a colon-free jobId for every dedupeKeyFor shape', () => {
    const cases: TriggerData[] = [
      { triggerType: 'transaction_confirmed', signature: 'sigABC' },
      { triggerType: 'new_block_mined', slot: 42 },
      { triggerType: 'scheduled_time', scheduledAt: '2026-01-01T00:00:00.000Z' },
      { triggerType: 'wallet_received_sol', detectedAt: '2026-06-25T08:59:38.988Z' },
    ];
    for (const d of cases) {
      expect(bullmqJobId(dedupeKeyFor('wf_123', d)), d.triggerType).not.toContain(':');
    }
  });

  it('keeps distinct keys distinct (no collisions from sanitising)', () => {
    const a = bullmqJobId(dedupeKeyFor('wf', { triggerType: 'transaction_confirmed', signature: 's1' }));
    const b = bullmqJobId(dedupeKeyFor('wf', { triggerType: 'transaction_confirmed', signature: 's2' }));
    expect(a).not.toBe(b);
  });
});

describe('planAction (dry-run validation)', () => {
  it('flags an unknown action type', () => {
    expect(planAction('not_real', {})).toEqual({ type: 'not_real', status: 'failed', detail: 'Unknown action type' });
  });

  it('reports missing required fields', () => {
    // send_tokens requires a recipient/amount — empty config should fail.
    const res = planAction('send_tokens', {});
    expect(res.status).toBe('failed');
    expect(res.detail).toMatch(/Missing required/);
  });

  it('simulates when all required fields are present', () => {
    const entry = ACTION_BY_TYPE['send_tokens'];
    const config = Object.fromEntries(entry.fields.filter((f) => f.required).map((f) => [f.key, 'x']));
    const res = planAction('send_tokens', config);
    expect(res.status).toBe('simulated');
    expect(res.detail.toLowerCase()).toContain(entry.label.toLowerCase());
  });

  it('treats empty-string required fields as missing', () => {
    const entry = ACTION_BY_TYPE['send_tokens'];
    const required = entry.fields.find((f) => f.required);
    if (required) {
      expect(planAction('send_tokens', { [required.key]: '' }).status).toBe('failed');
    }
  });
});

describe('catalog + template integrity', () => {
  it('every template references valid trigger/action types', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      expect(isTriggerType(t.trigger.type), `${t.id} trigger`).toBe(true);
      for (const a of t.actions) {
        expect(isActionType(a.type), `${t.id} action ${a.type}`).toBe(true);
      }
    }
  });

  it('every template config key is a known field of its type', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const triggerKeys = new Set(TRIGGER_BY_TYPE[t.trigger.type].fields.map((f) => f.key));
      for (const k of Object.keys(t.trigger.config)) {
        expect(triggerKeys.has(k), `${t.id} trigger field ${k}`).toBe(true);
      }
      for (const a of t.actions) {
        // useDelegation is an executor-level flag, not a catalog field.
        const actionKeys = new Set([...ACTION_BY_TYPE[a.type].fields.map((f) => f.key), 'useDelegation']);
        for (const k of Object.keys(a.config)) {
          expect(actionKeys.has(k), `${t.id} action ${a.type} field ${k}`).toBe(true);
        }
      }
    }
  });

  it('templates use single-brace {placeholders} (renderTemplate matches /\\{(\\w+)\\}/)', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      for (const a of t.actions) {
        for (const [k, v] of Object.entries(a.config)) {
          expect(String(v).includes('{{'), `${t.id} action ${a.type} field ${k} has {{double braces}}`).toBe(false);
        }
      }
    }
  });

  it('every trigger type has a placeholder list, and placeholdersFor prepends triggerType', () => {
    for (const t of TRIGGER_TYPES) {
      expect(TRIGGER_PLACEHOLDERS[t], `${t} placeholders`).toBeDefined();
      const all = placeholdersFor(t);
      expect(all[0]).toBe('triggerType');
      expect(all).toEqual(['triggerType', ...TRIGGER_PLACEHOLDERS[t]]);
    }
  });

  it('template ids are unique', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('per-network availability policy', () => {
  it('devnet allows the full catalog (every action + trigger)', () => {
    for (const type of Object.keys(ACTION_CAPABILITIES)) {
      // Only mainnet-required actions are excluded on devnet (no liquidity/data).
      const expected = ACTION_CAPABILITIES[type as keyof typeof ACTION_CAPABILITIES].network !== 'mainnet';
      expect(isActionAvailable(type as any, 'devnet'), type).toBe(expected);
    }
    for (const t of TRIGGER_TYPES) {
      const expected = !['token_price_threshold', 'new_token_listing', 'cross_chain_token_transfer'].includes(t);
      expect(isTriggerAvailable(t, 'devnet'), t).toBe(expected);
    }
  });

  it('mainnet allows only off-chain (custody: none) actions', () => {
    // Off-chain webhook — allowed on mainnet (no funds move).
    expect(isActionAvailable('send_webhook', 'mainnet-beta')).toBe(true);
    expect(isActionAvailable('send_email', 'mainnet-beta')).toBe(true);
    expect(isActionAvailable('fetch_latest_transactions', 'mainnet-beta')).toBe(true);
    // Fund-moving — blocked on mainnet (no program deploy, no real funds).
    expect(isActionAvailable('mint_tokens', 'mainnet-beta')).toBe(false); // operator
    expect(isActionAvailable('send_tokens', 'mainnet-beta')).toBe(false); // delegated
    expect(isActionAvailable('execute_buy_sell_order', 'mainnet-beta')).toBe(false); // delegated + mainnet
  });

  it('mainnet-only capabilities are blocked on devnet, available on mainnet triggers', () => {
    // execute_buy_sell_order needs mainnet liquidity — never runnable on devnet...
    expect(isActionAvailable('execute_buy_sell_order', 'devnet')).toBe(false);
    // ...and still blocked on mainnet here because it's delegated (custody policy).
    expect(isActionAvailable('execute_buy_sell_order', 'mainnet-beta')).toBe(false);
    // Price-threshold trigger moves no funds, so it's usable on mainnet but not devnet.
    expect(isTriggerAvailable('token_price_threshold', 'devnet')).toBe(false);
    expect(isTriggerAvailable('token_price_threshold', 'mainnet-beta')).toBe(true);
  });

  it('toSupportedNetwork narrows strings and defaults safely', () => {
    expect(toSupportedNetwork('mainnet-beta')).toBe('mainnet-beta');
    expect(toSupportedNetwork('devnet')).toBe('devnet');
    expect(toSupportedNetwork(undefined)).toBe(DEFAULT_NETWORK);
    expect(toSupportedNetwork('garbage')).toBe(DEFAULT_NETWORK);
    expect(DEFAULT_NETWORK).toBe('devnet');
  });
});
