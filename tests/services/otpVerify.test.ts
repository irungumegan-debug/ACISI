import bcrypt from 'bcrypt';

jest.mock('../../src/db/prisma', () => ({ prisma: { otp: { findFirst: jest.fn(), update: jest.fn() } } }));
jest.mock('../../src/services/smsService', () => ({ sendPatientSms: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { verifyPinResetOtp } from '../../src/services/otpService';

const otp = prisma.otp as unknown as { findFirst: jest.Mock; update: jest.Mock };
const row = async (id: string, purpose: string, code: string, attempts = 0) => ({ id, purpose, codeHash: await bcrypt.hash(code, 4), attempts });

beforeEach(() => jest.clearAllMocks());

function stub(setup: object | null, sms: object | null) {
  otp.findFirst.mockImplementation(async ({ where }: { where: { purpose: string } }) => (where.purpose === 'IN_PERSON_SETUP' ? setup : sms));
}

describe('verifyPinResetOtp', () => {
  it('accepts the front-desk setup code even when a newer SMS code exists ("Forgot PIN" pressed afterwards)', async () => {
    stub(await row('setup', 'IN_PERSON_SETUP', '177778'), await row('sms', 'PIN_RESET', '555555'));
    expect(await verifyPinResetOtp('p1', '177778')).toBe('IN_PERSON_CODE');
    expect(otp.update).toHaveBeenCalledWith({ where: { id: 'setup' }, data: { consumedAt: expect.any(Date) } });
  });

  it('accepts the SMS code', async () => {
    stub(await row('setup', 'IN_PERSON_SETUP', '177778'), await row('sms', 'PIN_RESET', '555555'));
    expect(await verifyPinResetOtp('p1', '555555')).toBe('SMS_CODE');
  });

  it('a wrong code counts a try on every live code and returns null', async () => {
    stub(await row('setup', 'IN_PERSON_SETUP', '177778'), await row('sms', 'PIN_RESET', '555555'));
    expect(await verifyPinResetOtp('p1', '000000')).toBeNull();
    expect(otp.update).toHaveBeenCalledTimes(2);
    expect(otp.update).toHaveBeenCalledWith({ where: { id: 'setup' }, data: { attempts: { increment: 1 } } });
  });

  it('a code with too many tries is not accepted, even if right', async () => {
    stub(await row('setup', 'IN_PERSON_SETUP', '177778', 99), null);
    expect(await verifyPinResetOtp('p1', '177778')).toBeNull();
  });

  it('no live code: null', async () => {
    stub(null, null);
    expect(await verifyPinResetOtp('p1', '177778')).toBeNull();
  });
});
