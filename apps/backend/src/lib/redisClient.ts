import IORedis from 'ioredis';
import { redisConnectionOptions } from '@web3-zapier/shared';

/**
 * Shared Redis client for the API (rate-limit store). Separate from the BullMQ
 * queue connection. Persisting limits in Redis means they survive restarts and
 * are shared across backend instances — important under real traffic. Sentinel-
 * aware so it follows a primary failover like the rest of the stack.
 */
export const redis = new IORedis({ ...redisConnectionOptions(), maxRetriesPerRequest: null });
redis.on('error', (e) => console.error('[redis] error:', e.message));
