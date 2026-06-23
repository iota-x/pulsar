import { Queue, type ConnectionOptions } from 'bullmq';
import { EXECUTION_QUEUE, type ExecutionJob } from '@web3-zapier/shared';

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

/** Push a matched workflow onto the execution queue for the worker. */
export const enqueueExecution = (job: ExecutionJob) =>
  queue.add('execute', job, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
