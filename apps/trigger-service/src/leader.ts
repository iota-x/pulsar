import IORedis from 'ioredis';
import { randomUUID } from 'crypto';

/**
 * Active-passive leader election over a Redis lock, so the trigger-service can
 * run as N replicas without double-firing: only the leader subscribes, polls,
 * and enqueues. The leader holds a lock with a short TTL and renews it; if it
 * crashes or hangs (can't renew), the lock expires and a standby takes over
 * within ~TTL seconds. This is what makes the watcher survive a process death.
 *
 * The lock renewal doubles as a liveness check: a wedged leader that can't renew
 * is automatically deposed, even if its process is technically still running.
 */
const LOCK_KEY = 'pulsar:leader:trigger-service';
const TTL_MS = Number(process.env.LEADER_TTL_MS ?? 12000);
const RENEW_MS = Number(process.env.LEADER_RENEW_MS ?? 4000);

// Atomic "extend only if I still hold it" — guards against renewing a lock a
// standby has already taken after our TTL lapsed.
const RENEW_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export interface LeaderHandle {
  readonly isLeader: boolean;
  stop(): Promise<void>;
}

export function runWithLeaderElection(opts: {
  onElected: () => void | Promise<void>;
  onDeposed: () => void | Promise<void>;
}): LeaderHandle {
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  redis.on('error', (e) => console.error('[leader] redis error:', e.message));
  const id = randomUUID();
  let leader = false;
  let stopped = false;

  const depose = async (reason: string) => {
    leader = false;
    console.warn(`[leader] stepping down (${reason})`);
    await opts.onDeposed();
  };

  const tick = async () => {
    if (stopped) return;
    try {
      if (leader) {
        const held = await redis.eval(RENEW_LUA, 1, LOCK_KEY, id, String(TTL_MS));
        if (held !== 1) await depose('lost the lock');
      } else {
        const acquired = await redis.set(LOCK_KEY, id, 'PX', TTL_MS, 'NX');
        if (acquired === 'OK') {
          leader = true;
          console.log(`[leader] elected ${id.slice(0, 8)} — this replica is now active`);
          await opts.onElected();
        }
      }
    } catch (err) {
      // A Redis blip shouldn't crash us; if we were leader, fail safe and step
      // down so we don't keep acting without a renewable lock.
      console.error('[leader] tick error:', err instanceof Error ? err.message : err);
      if (leader) await depose('redis error').catch(() => {});
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), RENEW_MS);

  return {
    get isLeader() {
      return leader;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (leader) {
        try {
          await redis.eval(RELEASE_LUA, 1, LOCK_KEY, id);
        } catch {
          /* best-effort release; TTL will reclaim it */
        }
        await Promise.resolve(opts.onDeposed()).catch(() => {});
      }
      await redis.quit().catch(() => {});
    },
  };
}
