import IORedis from 'ioredis';

/**
 * Per-target watch cursors (last-seen tx signature), persisted in Redis so the
 * service can resume after a restart/disconnect instead of silently losing
 * events. Replayed signatures are deduped downstream by the worker's
 * exactly-once claim, so backfill is safe to re-run.
 */
const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
redis.on('error', (e) => console.error('[cursor] redis error:', e.message));

const key = (target: string) => `pulsar:cursor:${target}`;

export const getCursor = (target: string): Promise<string | null> => redis.get(key(target));

export const setCursor = (target: string, signature: string): Promise<unknown> =>
  // 7-day TTL: a target idle that long no longer needs backfill on return.
  redis.set(key(target), signature, 'EX', 7 * 24 * 60 * 60);
