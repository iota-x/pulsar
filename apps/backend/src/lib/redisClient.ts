import IORedis from 'ioredis';
import { config } from '../config';

/**
 * Shared Redis client for the API (rate-limit store). Separate from the BullMQ
 * queue connection. Persisting limits in Redis means they survive restarts and
 * are shared across backend instances — important under real traffic.
 */
export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
redis.on('error', (e) => console.error('[redis] error:', e.message));
