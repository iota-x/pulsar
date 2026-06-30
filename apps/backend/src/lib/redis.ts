import type { ConnectionOptions } from 'bullmq';
import { redisConnectionOptions } from '@web3-zapier/shared';

/** Sentinel-aware BullMQ connection options (single-endpoint or Sentinel HA). */
export const redisConnection = (): ConnectionOptions => redisConnectionOptions() as ConnectionOptions;
