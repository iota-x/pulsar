import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../lib/redisClient';
import type { AuthedRequest } from './authMiddleware';

// Redis-backed store so limits survive restarts and are shared across instances.
const store = (prefix: string) =>
  new RedisStore({
    sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as Promise<never>,
    prefix,
  });

const ipKey = (req: { ip?: string }) => ipKeyGenerator(req.ip ?? '');

/**
 * Key authed routes by user id — the trustworthy per-visitor limit. Behind a
 * reverse proxy like Tailscale Funnel the client IP can be unreliable, so we
 * only fall back to IP before the user is known.
 */
const userOrIpKey = (req: AuthedRequest): string => (req.userId ? `u:${req.userId}` : `ip:${ipKey(req)}`);

/** General API limiter — per authenticated user (apply AFTER authMiddleware). */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: store('rl:api:'),
  keyGenerator: userOrIpKey,
  message: { error: 'Rate limit exceeded, slow down.' },
});

/** Tighter limiter for expensive authed actions (enqueue run, simulate). */
export const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: store('rl:action:'),
  keyGenerator: userOrIpKey,
  message: { error: 'Too many actions, slow down.' },
});

/**
 * Login limiter keyed by the target email (falling back to IP) — caps brute
 * force against a single account without globally locking out everyone if the
 * proxy collapses client IPs.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: store('rl:login:'),
  keyGenerator: (req) => {
    const email = (req.body?.email as string | undefined)?.toLowerCase().trim();
    return email ? `email:${email}` : `ip:${ipKey(req)}`;
  },
  message: { error: 'Too many login attempts for this account, try again later.' },
});

/** Registration limiter (IP-keyed) — blunts mass account creation from one source. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: store('rl:register:'),
  keyGenerator: (req) => `ip:${ipKey(req)}`,
  message: { error: 'Too many accounts created from here, try again later.' },
});
