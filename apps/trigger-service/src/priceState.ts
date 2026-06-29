import IORedis from 'ioredis';

/**
 * Durable edge-trigger state for token_price_threshold, persisted in Redis.
 *
 * Price triggers fire on a false→true crossing of the threshold. If this state
 * lived only in memory, a trigger-service restart while the condition is already
 * satisfied would re-fire it — and price events have no natural on-chain id, so
 * the worker's exactly-once claim can't dedupe them. For a stop-loss that means
 * a duplicate sell. Persisting the last satisfied state makes restarts safe.
 */
const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
redis.on('error', (e) => console.error('[price-state] redis error:', e.message));

const key = (workflowId: string) => `pulsar:price-fired:${workflowId}`;
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days; idle watches expire harmlessly.

/** Batch-read the last satisfied state for many workflows (one round-trip). */
export async function getFiredStates(workflowIds: string[]): Promise<Map<string, boolean>> {
  if (workflowIds.length === 0) return new Map();
  const values = await redis.mget(workflowIds.map(key));
  return new Map(workflowIds.map((id, i) => [id, values[i] === '1']));
}

/** Persist whether a workflow's price condition is currently satisfied. */
export async function setFiredState(workflowId: string, satisfied: boolean): Promise<void> {
  await redis.set(key(workflowId), satisfied ? '1' : '0', 'EX', TTL_SECONDS);
}
