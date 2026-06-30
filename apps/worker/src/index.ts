import 'dotenv/config';
import { Worker, type ConnectionOptions } from 'bullmq';
import { EXECUTION_QUEUE, type ExecutionJob, redisConnectionOptions } from '@web3-zapier/shared';
import { executeWorkflow } from './executor';
import { deadLetter } from './deadLetter';

const worker = new Worker<ExecutionJob>(
  EXECUTION_QUEUE,
  async (job) => {
    console.log(`[worker] processing job ${job.id} for workflow ${job.data.workflowId}`);
    await executeWorkflow(job.data);
  },
  {
    connection: redisConnectionOptions() as ConnectionOptions,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  },
);

worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
worker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  // Only dead-letter once retries are exhausted.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void deadLetter(job.data, err.message);
  }
});
worker.on('error', (err) => console.error('[worker] worker error:', err.message));

// A queue worker must survive a single bad job: a stray rejection (e.g. an RPC
// 429 from an on-chain action) must never take the whole process down.
process.on('unhandledRejection', (reason) =>
  console.error('[worker] unhandledRejection:', reason instanceof Error ? reason.message : reason),
);
process.on('uncaughtException', (err) => console.error('[worker] uncaughtException:', err.message));

console.log('🛠️  Worker started, waiting for jobs on queue:', EXECUTION_QUEUE);

const shutdown = async () => {
  console.log('\n[worker] shutting down…');
  await worker.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
