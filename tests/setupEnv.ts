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
