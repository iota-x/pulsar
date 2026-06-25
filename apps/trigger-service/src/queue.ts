import { Queue, type ConnectionOptions } from 'bullmq';
import { EXECUTION_QUEUE, type ExecutionJob, dedupeKeyFor } from '@web3-zapier/shared';

/** Parse a redis:// URL into BullMQ connection options. */
const redisConnection = (url: string): ConnectionOptions => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
  };
};

const queue = new Queue<ExecutionJob>(EXECUTION_QUEUE, {
  connection: redisConnection(process.env.REDIS_URL ?? 'redis://localhost:6379'),
});

/**
 * Push a matched workflow onto the execution queue. Every job carries a stable
 * `dedupeKey` (also used as the BullMQ jobId) so duplicate detections collapse at
 * the queue level, and the worker's Postgres claim guarantees exactly-once even
 * across restarts. Failed jobs retry with backoff, then land in the failed set
 * (visible as a dead-letter; see the worker's `failed` handler).
 */
export const enqueueExecution = (job: ExecutionJob) => {
  const dedupeKey = job.dedupeKey ?? dedupeKeyFor(job.workflowId, job.triggerData);
  // BullMQ uses ':' as an internal Redis key separator and rejects it in a
  // custom jobId; the dedupeKey is ':'-delimited, so map it to a safe char.
  // Keep the canonical dedupeKey in the payload (the worker's Postgres claim
  // relies on it); only the jobId needs sanitising.
  const jobId = dedupeKey.replace(/:/g, '_');
  return queue.add(
    'execute',
    { ...job, dedupeKey },
    {
      jobId,
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  );
};
