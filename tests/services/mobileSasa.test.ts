// Mobile Sasa is used once MOBILESASA_API_TOKEN is set.
process.env.MOBILESASA_API_TOKEN = 'test-mobilesasa-token';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/config/africastalking', () => ({ smsClient: { send: jest.fn() } }));
jest.mock('../../src/db/prisma', () => ({ prisma: { clinicSmsMessage: { create: jest.fn() } } }));
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { smsClient } from '../../src/config/africastalking';
import { logger } from '../../src/utils/logger';
import { mobileSasaAccepted, MOBILESASA_SEND_URL } from '../../src/services/mobileSasaClient';
import { codeNotSentMessage, getSmsHealth, sendSms, smsCanReach, smsProvider } from '../../src/services/smsService';
import { resetFakeRedis } from '../helpers/fakeRedis';

const fetchMock = jest.fn();
const ACCEPTED = { status: true, responseCode: '0200', message: 'Accepted', messageId: 'abc' };
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const settle = () => new Promise((r) => setImmediate(r));

/** Everything written to the logs, as one string. */
const allLogs = () =>
  JSON.stringify([
    (logger.info as jest.Mock).mock.calls,
    (logger.warn as jest.Mock).mock.calls,
    (logger.error as jest.Mock).mock.calls,
  ]);

beforeEach(() => {
  jest.clearAllMocks();
  resetFakeRedis();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it('uses Mobile Sasa, not Africa\'s Talking, when the token is set', () => {
  expect(smsProvider()).toBe('mobilesasa');
});

it('posts { senderID, phone, message } with the Bearer token', async () => {
  fetchMock.mockResolvedValue(reply(200, ACCEPTED));
  expect(await sendSms('+254712345678', 'Your code is 123456', 'PIN_RESET_CODE')).toBe('sent');
  expect(fetchMock).toHaveBeenCalledWith(
    MOBILESASA_SEND_URL,
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-mobilesasa-token', 'Content-Type': 'application/json' }),
    }),
  );
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ senderID: 'ACISI', phone: '254712345678', message: 'Your code is 123456' });
  expect(smsClient.send).not.toHaveBeenCalled();
});

it.each([
  ['an error status', reply(401, { status: false, responseCode: '0401', message: 'Unauthorized' })],
  ['status false', reply(200, { status: false, responseCode: '0422', message: 'Invalid phone' })],
  ['no JSON', { ok: true, status: 200, json: async () => { throw new Error('not json'); } }],
])('treats %s as failed and counts it for the owner warning', async (_label, response) => {
  fetchMock.mockResolvedValue(response);
  expect(await sendSms('+254712345678', 'x', 'X')).toBe('failed');
  await settle();
  expect((await getSmsHealth()).consecutiveFailures).toBe(1);
});

it('a network error or timeout is a failure, never a throw', async () => {
  fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  await expect(sendSms('+254712345678', 'x', 'X')).resolves.toBe('failed');
});

it('does not try a non-Safaricom number, and that is not counted as a provider failure', async () => {
  expect(smsCanReach('+254733123456')).toBe(false);
  expect(await sendSms('+254733123456', 'x', 'PIN_RESET_CODE')).toBe('failed');
  await settle();
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await getSmsHealth()).consecutiveFailures).toBe(0);
});

it('logs the outcome with no message text, token or full phone number', async () => {
  fetchMock.mockResolvedValueOnce(reply(200, ACCEPTED)).mockResolvedValueOnce(reply(500, { status: false }));
  await sendSms('+254712345678', 'Your code is 987654', 'PIN_RESET_CODE');
  await sendSms('+254712345678', 'Your code is 987654', 'PIN_RESET_CODE');
  await sendSms('+254733123456', 'Your code is 987654', 'PIN_RESET_CODE');
  const logs = allLogs();
  expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'PIN_RESET_CODE', provider: 'mobilesasa', phone: '2547******78' }), 'SMS sent');
  expect(logger.error).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  for (const secret of ['987654', 'test-mobilesasa-token', '712345678', '733123456']) expect(logs).not.toContain(secret);
});

it('says why on screen when the number is not on Safaricom', () => {
  expect(codeNotSentMessage('+254733123456', 'Visit your clinic.')).toBe('ACISI codes can only be sent to Safaricom numbers for now. Visit your clinic.');
  expect(codeNotSentMessage('+254712345678', 'Visit your clinic.')).toBe('Visit your clinic.');
});

describe('mobileSasaAccepted', () => {
  it('needs status true or response code 0200', () => {
    expect(mobileSasaAccepted(ACCEPTED)).toBe(true);
    expect(mobileSasaAccepted({ responseCode: '0200' })).toBe(true);
    expect(mobileSasaAccepted({ status: true, responseCode: '0401' })).toBe(false);
    expect(mobileSasaAccepted({})).toBe(false);
    expect(mobileSasaAccepted(null)).toBe(false);
  });
});
