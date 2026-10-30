// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/config/africastalking', () => ({ smsClient: { send: jest.fn() } }));

import { smsClient } from '../../src/config/africastalking';
import { getSmsHealth, sendPatientSms, sendSms } from '../../src/services/smsService';
import { resetFakeRedis } from '../helpers/fakeRedis';

const mockSend = smsClient.send as jest.Mock;
const ACCEPTED = { SMSMessageData: { Recipients: [{ status: 'Success', statusCode: 101 }] } };
const REJECTED = { SMSMessageData: { Recipients: [{ status: 'InsufficientBalance', statusCode: 405 }] } };
const PATIENT = { phoneNumber: '+254712345678', smsOptOut: false, deletedAt: null };

/** Health tracking runs in the background; let it finish. */
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  resetFakeRedis();
});

describe('"does not want SMS" (C13)', () => {
  it('a non-essential message is not sent to a patient who opted out', async () => {
    expect(await sendPatientSms({ ...PATIENT, smsOptOut: true }, 'Receipt', { purpose: 'X' })).toBe('opted_out');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('an essential message (codes, deletion notice) still goes', async () => {
    mockSend.mockResolvedValue(ACCEPTED);
    expect(await sendPatientSms({ ...PATIENT, smsOptOut: true }, 'Your code', { purpose: 'X', essential: true })).toBe('sent');
  });

  it('nothing at all goes to a deleted account', async () => {
    expect(await sendPatientSms({ ...PATIENT, deletedAt: new Date() }, 'Code', { purpose: 'X', essential: true })).toBe('deleted_account');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('SMS failure warning for the owner page', () => {
  it('counts failures in a row, including a provider "accepted" reply that rejected the number, and warns at the threshold', async () => {
    mockSend.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(REJECTED).mockResolvedValueOnce(REJECTED);
    expect(await sendSms('+254700000001', 'a', 'X')).toBe('failed');
    await settle();
    expect((await getSmsHealth()).failing).toBe(false);
    await sendSms('+254700000001', 'b', 'X');
    await sendSms('+254700000001', 'c', 'X');
    await settle();
    const health = await getSmsHealth();
    expect(health).toMatchObject({ failing: true, consecutiveFailures: 3, threshold: 3 });
    expect(health.failingSince).toEqual(expect.any(String));
  });

  it('one successful send clears the warning', async () => {
    mockSend.mockRejectedValue(new Error('down'));
    for (let i = 0; i < 3; i++) await sendSms('+254700000001', 'x', 'X');
    await settle();
    mockSend.mockResolvedValue(ACCEPTED);
    await sendSms('+254700000001', 'x', 'X');
    await settle();
    expect(await getSmsHealth()).toMatchObject({ failing: false, consecutiveFailures: 0, failingSince: null });
  });

  it('never throws', async () => {
    mockSend.mockRejectedValue(new Error('down'));
    await expect(sendSms('+254700000001', 'x', 'X')).resolves.toBe('failed');
  });
});
