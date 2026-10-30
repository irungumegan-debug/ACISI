/**
 * In-memory stand-in for the ioredis client, for tests that exercise code
 * using Redis (lockouts, session revocation, SMS failure counter). Covers
 * just the commands the app uses: get, set (with EX/NX), incr, expire, del.
 *
 * Usage:
 *   jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
 *   ...
 *   beforeEach(() => require('../helpers/fakeRedis').resetFakeRedis());
 */
const store = new Map<string, { value: string; expiresAt?: number }>();

function live(key: string) {
  const entry = store.get(key);
  if (entry?.expiresAt && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry;
}

export const fakeRedis = {
  get: jest.fn(async (key: string) => live(key)?.value ?? null),
  set: jest.fn(async (key: string, value: string, ...args: (string | number)[]) => {
    const nx = args.includes('NX');
    if (nx && live(key)) return null;
    const exIndex = args.indexOf('EX');
    const seconds = exIndex >= 0 ? Number(args[exIndex + 1]) : undefined;
    store.set(key, { value: String(value), expiresAt: seconds ? Date.now() + seconds * 1000 : undefined });
    return 'OK';
  }),
  incr: jest.fn(async (key: string) => {
    const entry = live(key);
    const next = Number(entry?.value ?? 0) + 1;
    store.set(key, { value: String(next), expiresAt: entry?.expiresAt });
    return next;
  }),
  expire: jest.fn(async (key: string, seconds: number) => {
    const entry = live(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }),
  del: jest.fn(async (...keys: string[]) => {
    let n = 0;
    for (const k of keys) if (store.delete(k)) n += 1;
    return n;
  }),
};

export function fakeRedisModule() {
  return { redis: fakeRedis, redisQueueConnection: fakeRedis };
}

export function resetFakeRedis(): void {
  store.clear();
}

export function fakeRedisKeys(): string[] {
  return [...store.keys()].filter((k) => live(k));
}
