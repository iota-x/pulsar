import { Queue } from 'bullmq';
import { EXECUTION_QUEUE, type ExecutionJob, dedupeKeyFor } from '@web3-zapier/shared';
import { config } from '../config';
import { redisConnection } from './redis';

// Let BullMQ own its Redis connection (built from REDIS_URL) so we don't pin a
// specific ioredis instance — avoids dual-package type/runtime mismatches.
export const executionQueue = new Queue<ExecutionJob>(EXECUTION_QUEUE, {
  connection: redisConnection(config.redisUrl),
});

/** Enqueue a workflow for the worker to execute (stamped with a dedupe key). */
export const enqueueExecution = (job: ExecutionJob) => {
  const dedupeKey = job.dedupeKey ?? dedupeKeyFor(job.workflowId, job.triggerData);
  return executionQueue.add(
    'execute',
    { ...job, dedupeKey },
    {
      jobId: dedupeKey,
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  );
};
