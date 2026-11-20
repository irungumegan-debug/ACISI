/** HIE connection: token caching, facility headers, retry on an expired token, errors. */
process.env.HIE_ENABLED = 'true';
process.env.HIE_CLIENT_ID = 'test-client';
process.env.HIE_CLIENT_SECRET = 'test-secret';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn(), request: jest.fn() } }));

import axios from 'axios';
import { resetFakeRedis } from '../helpers/fakeRedis';
import { getHieToken, HieError, hieRequest } from '../../src/hie/client';

const post = axios.post as jest.Mock;
const request = axios.request as jest.Mock;

beforeEach(() => {
  resetFakeRedis();
  jest.clearAllMocks();
  post.mockResolvedValue({ data: { access_token: 'tok-1', expires_in: 3600 } });
});

it('gets a token with the client credentials (form-encoded) and caches it', async () => {
  expect(await getHieToken()).toBe('tok-1');
  expect(await getHieToken()).toBe('tok-1');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][0]).toBe('https://ilm-dev.dha.go.ke/uat-middleware/api/v1/tenants/token');
  expect(post.mock.calls[0][1]).toBe('client_id=test-client&client_secret=test-secret');
});

it('sends the bearer token and the clinic facility headers', async () => {
  request.mockResolvedValue({ status: 200, data: { ok: true } });
  await hieRequest({ method: 'GET', path: '/patients', query: { a: '1', b: undefined }, facilityId: 'FID-47-115307-8' });
  const call = request.mock.calls[0][0];
  expect(call.headers).toMatchObject({ Authorization: 'Bearer tok-1', 'X-Facility-Id': 'FID-47-115307-8', 'X-Facility-Id-Type': 'fr-code' });
  expect(call.params).toEqual({ a: '1' });
});

it('no facility headers when none is given', async () => {
  request.mockResolvedValue({ status: 200, data: {} });
  await hieRequest({ method: 'GET', path: '/facilities/search' });
  expect(request.mock.calls[0][0].headers['X-Facility-Id']).toBeUndefined();
});

it('a rejected (expired) token is replaced once and the call retried', async () => {
  post.mockResolvedValueOnce({ data: { access_token: 'old', expires_in: 3600 } }).mockResolvedValueOnce({ data: { access_token: 'new', expires_in: 3600 } });
  request.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ status: 200, data: 'ok' });
  expect(await hieRequest({ method: 'GET', path: '/x' })).toBe('ok');
  expect(request.mock.calls[1][0].headers.Authorization).toBe('Bearer new');
});

it('maps HTTP errors to plain messages', async () => {
  request.mockRejectedValue({ response: { status: 404 } });
  await expect(hieRequest({ method: 'GET', path: '/x' })).rejects.toMatchObject({ kind: 'not_found' });
  request.mockRejectedValue({ response: { status: 500 } });
  await expect(hieRequest({ method: 'GET', path: '/x' })).rejects.toMatchObject({ kind: 'unavailable' });
  request.mockRejectedValue(new Error('timeout'));
  await expect(hieRequest({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(HieError);
});

it('refused credentials are reported as such', async () => {
  post.mockRejectedValue({ response: { status: 401 } });
  await expect(getHieToken()).rejects.toMatchObject({ kind: 'unauthorized' });
});

it('does nothing while HIE is switched off', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { env } = require('../../src/config/env') as { env: { HIE_ENABLED: boolean } };
  env.HIE_ENABLED = false;
  try {
    await expect(getHieToken()).rejects.toMatchObject({ kind: 'not_configured' });
    expect(post).not.toHaveBeenCalled();
  } finally {
    env.HIE_ENABLED = true;
  }
});
