import type { ConnectionOptions } from 'bullmq';

/** Parse a redis:// URL into BullMQ connection options. */
export const redisConnection = (url: string): ConnectionOptions => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
  };
};
