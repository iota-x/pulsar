/**
 * One Sentinel-aware Redis connection builder for every service (worker, trigger,
 * backend) and every client kind (ioredis directly + BullMQ's `connection`).
 *
 * Redis holds the leader lock, the job queue, cursors and price-state — so a
 * single Redis is the system's biggest single point of failure. With Sentinel
 * (a primary + replicas + a sentinel quorum that auto-promotes a replica on
 * primary failure), clients connect THROUGH the sentinels and follow the current
 * primary automatically across a failover.
 *
 *   HA:        REDIS_SENTINELS=host1:26379,host2:26379,host3:26379  REDIS_MASTER_NAME=mymaster
 *   single:    REDIS_URL=redis://host:6379   (the default — dev / managed single endpoint)
 *
 * The returned object is structurally an ioredis RedisOptions, which is exactly
 * what BullMQ's `connection` field accepts too — so all call sites share it.
 */

export interface RedisConnectionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  // Sentinel mode:
  sentinels?: { host: string; port: number }[];
  name?: string; // the monitored primary's group name
  sentinelPassword?: string;
}

export function redisConnectionOptions(): RedisConnectionOptions {
  const sentinels = process.env.REDIS_SENTINELS?.trim();
  if (sentinels) {
    return {
      sentinels: sentinels.split(',').map((s) => {
        const [host, port] = s.trim().split(':');
        return { host, port: Number(port || 26379) };
      }),
      name: process.env.REDIS_MASTER_NAME?.trim() || 'mymaster',
      // Password for the data nodes (primary/replicas); sentinels may use a separate one.
      password: process.env.REDIS_PASSWORD || undefined,
      sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || undefined,
    };
  }

  // Single-endpoint fallback: parse REDIS_URL (covers dev and managed Redis).
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}
