import { describe, it, expect } from 'vitest';
import {
  dedupeKeyFor,
  planAction,
  WORKFLOW_TEMPLATES,
  TRIGGER_BY_TYPE,
  ACTION_BY_TYPE,
  isTriggerType,
  isActionType,
  type TriggerData,
} from '../index';

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

  it('template ids are unique', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
