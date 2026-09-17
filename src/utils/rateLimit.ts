import { redis } from '../config/redis';

/**
 * Generic fixed-window Redis rate limiter, keyed by caller-supplied key.
 * Extracted from the dashboard PIN login limiter so the patient portal's OTP
 * endpoints can use the exact same brute-force guard without duplicating it.
 */
export async function isRateLimited(key: string, maxAttempts: number): Promise<boolean> {
  const count = await redis.get(key);
  return Number(count ?? 0) >= maxAttempts;
}

export async function recordAttempt(key: string, windowSeconds: number): Promise<void> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  await redis.del(key);
}
