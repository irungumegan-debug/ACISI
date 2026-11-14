// Populates required env vars with dummy values before any module (like
// src/config/env.ts) is imported, so tests never need real credentials.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/acisi_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.AT_USERNAME ??= 'sandbox';
process.env.AT_API_KEY ??= 'test-api-key';
process.env.MPESA_CONSUMER_KEY ??= 'test-consumer-key';
process.env.MPESA_CONSUMER_SECRET ??= 'test-consumer-secret';
process.env.MPESA_SHORTCODE ??= '174379';
process.env.MPESA_PASSKEY ??= 'test-passkey';
process.env.MPESA_CALLBACK_URL ??= 'https://example.com/api/mpesa/callback';
// A fixed test key (never used anywhere real), so encryption runs in tests.
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

// The inactivity logoff needs Redis. Route tests fake the session itself, so
// by default every session counts as active; tests/services/idleTimeout.test.ts
// unmocks this to test the real logic.
jest.mock('../src/services/idleTimeout', () => ({
  markSessionActive: jest.fn(async () => undefined),
  isSessionIdle: jest.fn(async () => false),
  clearSessionActivity: jest.fn(async () => undefined),
}));
