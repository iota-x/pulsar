import { Queue, type ConnectionOptions } from 'bullmq';
import { EXECUTION_QUEUE, type ExecutionJob, dedupeKeyFor, bullmqJobId, redisConnectionOptions } from '@web3-zapier/shared';

const queue = new Queue<ExecutionJob>(EXECUTION_QUEUE, {
  connection: redisConnectionOptions() as ConnectionOptions,
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
  return queue.add(
    'execute',
    { ...job, dedupeKey },
    {
      jobId: bullmqJobId(dedupeKey),
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  );
};
