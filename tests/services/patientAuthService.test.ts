/**
 * Patient sign-in security: PIN hashing, the 5-wrong/15-minute lock, weak
 * PINs, OTP expiry / single use / 3 per hour, the date-of-birth check, and
 * shared phones. Runs the real service against a small in-memory database.
 */
import bcrypt from 'bcrypt';

interface FakePatient {
  id: string;
  patientCode: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  dateOfBirthEstimated: boolean;
  pinHash: string | null;
  pinFailedAttempts: number;
  pinLockedUntil: Date | null;
  idSavedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}
interface FakeOtp {
  id: string;
  phoneNumber: string;
  purpose: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

const patients: FakePatient[] = [];
const otps: FakeOtp[] = [];
const redisStore = new Map<string, string>();
const sentSms: { to: string; message: string }[] = [];

jest.mock('../../src/config/redis', () => ({
  redis: {
    set: jest.fn(async (k: string, v: string) => redisStore.set(k, v)),
    get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
    del: jest.fn(async (k: string) => redisStore.delete(k)),
  },
}));
jest.mock('../../src/services/sessionRevocation', () => ({ revokeSessionsFor: jest.fn(async () => Date.now()) }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/smsSender', () => ({
  sendSms: jest.fn(async (to: string, message: string) => {
    sentSms.push({ to, message });
    return true;
  }),
}));
jest.mock('../../src/services/patientService', () => ({
  findPatientsByPhone: jest.fn(async (phone: string) => patients.filter((p) => p.phoneNumber === phone && !p.deletedAt)),
  findPatientByCode: jest.fn(async (code: string) => patients.find((p) => p.patientCode === code && !p.deletedAt) ?? null),
  registerPatient: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => {
  const matchOtp = (o: FakeOtp, w: Record<string, unknown>) =>
    (w.id === undefined || o.id === w.id) &&
    (w.phoneNumber === undefined || o.phoneNumber === w.phoneNumber) &&
    (w.purpose === undefined || o.purpose === w.purpose) &&
    (!('consumedAt' in w) || o.consumedAt === w.consumedAt) &&
    (!w.expiresAt || o.expiresAt > (w.expiresAt as { gt: Date }).gt) &&
    (!w.createdAt || o.createdAt >= (w.createdAt as { gte: Date }).gte);
  return {
    prisma: {
      phoneOtp: {
        count: jest.fn(async ({ where }) => otps.filter((o) => matchOtp(o, where)).length),
        create: jest.fn(async ({ data }) => {
          const o = { id: `otp-${otps.length + 1}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
          otps.push(o);
          return o;
        }),
        findFirst: jest.fn(async ({ where }) => [...otps].reverse().find((o) => matchOtp(o, where)) ?? null),
        update: jest.fn(async ({ where, data }) => {
          const o = otps.find((x) => x.id === where.id) as FakeOtp;
          if (data.attempts?.increment) o.attempts += data.attempts.increment;
          return o;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const hit = otps.filter((o) => matchOtp(o, where));
          hit.forEach((o) => Object.assign(o, data));
          return { count: hit.length };
        }),
      },
      patient: {
        findFirst: jest.fn(
          async ({ where }) =>
            patients.find((p) => p.id === where.id && !p.deletedAt && (where.phoneNumber === undefined || p.phoneNumber === where.phoneNumber)) ?? null,
        ),
        update: jest.fn(async ({ where, data }) => {
          const p = patients.find((x) => x.id === where.id) as FakePatient;
          Object.assign(p, data);
          return p;
        }),
      },
    },
  };
});

import {
  completeSetupWithPin,
  confirmPatientPin,
  loginWithPin,
  requestPatientOtp,
  selectSetupPerson,
  startSetupFlow,
  verifyPatientOtp,
  verifySetupDateOfBirth,
} from '../../src/services/patientAuthService';

const PHONE = '+254712345678';

function addPatient(overrides: Partial<FakePatient> = {}): FakePatient {
  const p: FakePatient = {
    id: `p-${patients.length + 1}`,
    patientCode: `ACS-${10000 + patients.length}`,
    phoneNumber: PHONE,
    firstName: 'Jane',
    lastName: 'Wanjiru',
    dateOfBirth: new Date('1990-03-15T00:00:00Z'),
    dateOfBirthEstimated: false,
    pinHash: null,
    pinFailedAttempts: 0,
    pinLockedUntil: null,
    idSavedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
  patients.push(p);
  return p;
}

/** The code from the last SMS we "sent". */
function lastCode(): string {
  return /(\d{6})/.exec(sentSms[sentSms.length - 1]?.message ?? '')?.[1] as string;
}

beforeEach(() => {
  patients.length = 0;
  otps.length = 0;
  sentSms.length = 0;
  redisStore.clear();
});

describe('PIN hashing', () => {
  it('stores only a bcrypt hash of the PIN, never the PIN itself', async () => {
    const p = addPatient();
    await requestPatientOtp('0712345678', 'login');
    const { flowToken } = await startSetupFlow('0712345678', 'login', lastCode());
    await verifySetupDateOfBirth(flowToken, '1990-03-15');
    await completeSetupWithPin(flowToken, '730194', '730194');

    expect(p.pinHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(p.pinHash).not.toContain('730194');
    expect(await bcrypt.compare('730194', p.pinHash as string)).toBe(true);
  });
});

describe('PIN lock: 5 wrong → locked 15 minutes', () => {
  it('locks after the 5th wrong PIN, refuses even the right PIN while locked, and unlocks after 15 minutes', async () => {
    const p = addPatient({ pinHash: await bcrypt.hash('730194', 4) });
    const t0 = new Date('2026-10-13T08:00:00Z');
    for (let i = 0; i < 4; i++) {
      await expect(loginWithPin('ACS-10000', '111222', {}, t0)).rejects.toMatchObject({ status: 401 });
    }
    expect(p.pinLockedUntil).toBeNull();
    await expect(loginWithPin('ACS-10000', '111222', {}, t0)).rejects.toMatchObject({ status: 401 });
    expect(p.pinLockedUntil).toEqual(new Date('2026-10-13T08:15:00Z'));

    await expect(loginWithPin('ACS-10000', '730194', {}, new Date('2026-10-13T08:14:00Z'))).rejects.toMatchObject({ status: 429 });
    await expect(loginWithPin(PHONE, '730194', {}, new Date('2026-10-13T08:14:00Z'))).rejects.toMatchObject({ status: 429 });

    const ok = await loginWithPin('ACS-10000', '730194', {}, new Date('2026-10-13T08:15:01Z'));
    expect(ok).toMatchObject({ kind: 'ok' });
    expect(p.pinFailedAttempts).toBe(0);
    expect(p.pinLockedUntil).toBeNull();
  });

  it('gives no extra guesses by switching between phone number and ACISI ID', async () => {
    const p = addPatient({ pinHash: await bcrypt.hash('730194', 4) });
    const now = new Date();
    for (const id of ['ACS-10000', '0712345678', 'ACS-10000', '+254712345678', 'acs-10000']) {
      await expect(loginWithPin(id, '000111', {}, now)).rejects.toMatchObject({ status: 401 });
    }
    expect(p.pinLockedUntil).not.toBeNull();
  });

  it('a successful PIN resets the count', async () => {
    const p = addPatient({ pinHash: await bcrypt.hash('730194', 4) });
    await expect(loginWithPin('ACS-10000', '000111')).rejects.toBeDefined();
    await loginWithPin('ACS-10000', '730194');
    expect(p.pinFailedAttempts).toBe(0);
  });

  it('the front-desk PIN approval shares the same lock', async () => {
    const p = addPatient({ pinHash: await bcrypt.hash('730194', 4) });
    for (let i = 0; i < 5; i++) expect(await confirmPatientPin(p.id, '000111')).toBe(false);
    await expect(confirmPatientPin(p.id, '730194')).rejects.toMatchObject({ status: 429 });
  });
});

describe('shared phone', () => {
  it('logs in the one person whose PIN matches', async () => {
    addPatient({ pinHash: await bcrypt.hash('730194', 4) });
    const child = addPatient({ firstName: 'Brian', pinHash: await bcrypt.hash('582047', 4) });
    const res = await loginWithPin('0712345678', '582047');
    expect(res).toEqual({ kind: 'ok', patient: child });
  });

  it('asks which person when the same PIN matches several, then logs in the one picked', async () => {
    const parent = addPatient({ pinHash: await bcrypt.hash('730194', 4) });
    const child = addPatient({ firstName: 'Brian', lastName: 'Kamau', pinHash: await bcrypt.hash('730194', 4) });
    const res = await loginWithPin('0712345678', '730194');
    expect(res).toEqual({
      kind: 'choose',
      people: [
        { id: parent.id, displayName: 'Jane W.' },
        { id: child.id, displayName: 'Brian K.' },
      ],
    });
    expect(await loginWithPin('0712345678', '730194', { patientId: child.id })).toEqual({ kind: 'ok', patient: child });
  });

  it('a wrong PIN by phone counts against every account on the phone', async () => {
    const a = addPatient({ pinHash: await bcrypt.hash('730194', 4) });
    const b = addPatient({ firstName: 'Brian', pinHash: await bcrypt.hash('582047', 4) });
    await expect(loginWithPin('0712345678', '000111')).rejects.toMatchObject({ status: 401 });
    expect([a.pinFailedAttempts, b.pinFailedAttempts]).toEqual([1, 1]);
  });

  it('the OTP flow lets the patient pick which person they are', async () => {
    const parent = addPatient();
    const child = addPatient({ firstName: 'Brian', dateOfBirth: new Date('2015-06-01T00:00:00Z') });
    await requestPatientOtp('0712345678', 'login');
    const { flowToken, people } = await startSetupFlow('0712345678', 'login', lastCode());
    expect(people.map((p) => p.id)).toEqual([parent.id, child.id]);
    await expect(verifySetupDateOfBirth(flowToken, '2015-06-01')).rejects.toMatchObject({ status: 400 }); // must pick first
    await selectSetupPerson(flowToken, child.id);
    await verifySetupDateOfBirth(flowToken, '2015-06-01');
    const { patient } = await completeSetupWithPin(flowToken, '582047', '582047');
    expect(patient.id).toBe(child.id);
    expect(parent.pinHash).toBeNull();
  });
});

describe('weak PINs are refused when set', () => {
  it.each(['000000', '111111', '999999', '123456', '654321', '012345', '150390', '900315', '031590', '345678'])('refuses %s', async (pin) => {
    addPatient();
    await requestPatientOtp('0712345678', 'login');
    const { flowToken } = await startSetupFlow('0712345678', 'login', lastCode());
    await verifySetupDateOfBirth(flowToken, '1990-03-15');
    await expect(completeSetupWithPin(flowToken, pin, pin)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses two PINs that differ', async () => {
    addPatient();
    await requestPatientOtp('0712345678', 'login');
    const { flowToken } = await startSetupFlow('0712345678', 'login', lastCode());
    await verifySetupDateOfBirth(flowToken, '1990-03-15');
    await expect(completeSetupWithPin(flowToken, '730194', '730195')).rejects.toThrow(/don't match/);
  });

  it('names the date of birth as the reason', async () => {
    addPatient();
    await requestPatientOtp('0712345678', 'login');
    const { flowToken } = await startSetupFlow('0712345678', 'login', lastCode());
    await verifySetupDateOfBirth(flowToken, '1990-03-15');
    await expect(completeSetupWithPin(flowToken, '150390', '150390')).rejects.toThrow(/date of birth/);
  });
});

describe('OTP', () => {
  it('is 6 digits and expires after 5 minutes', async () => {
    addPatient();
    const t0 = new Date('2026-10-13T08:00:00Z');
    await requestPatientOtp('0712345678', 'login', t0);
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(otps[0]?.expiresAt).toEqual(new Date('2026-10-13T08:05:00Z'));
    expect(await verifyPatientOtp(PHONE, 'login', code, new Date('2026-10-13T08:05:01Z'))).toBe(false);
  });

  it('works once only', async () => {
    addPatient();
    await requestPatientOtp('0712345678', 'login');
    const code = lastCode();
    expect(await verifyPatientOtp(PHONE, 'login', code)).toBe(true);
    expect(await verifyPatientOtp(PHONE, 'login', code)).toBe(false);
  });

  it('dies after 5 wrong guesses, even if the right code comes next', async () => {
    addPatient();
    await requestPatientOtp('0712345678', 'login');
    const code = lastCode();
    for (let i = 0; i < 5; i++) expect(await verifyPatientOtp(PHONE, 'login', code === '000000' ? '000001' : '000000')).toBe(false);
    expect(await verifyPatientOtp(PHONE, 'login', code)).toBe(false);
  });

  it('a login code cannot be used to reset a PIN', async () => {
    addPatient();
    await requestPatientOtp('0712345678', 'login');
    expect(await verifyPatientOtp(PHONE, 'reset', lastCode())).toBe(false);
  });

  it('is sent at most 3 times per number per hour', async () => {
    addPatient();
    const t0 = new Date();
    for (let i = 0; i < 3; i++) await requestPatientOtp('0712345678', 'login', t0);
    await expect(requestPatientOtp('0712345678', 'reset', t0)).rejects.toMatchObject({ status: 429 });
    expect(sentSms).toHaveLength(3);
    // An hour later it's allowed again.
    otps.forEach((o) => (o.createdAt = new Date(t0.getTime() - 61 * 60 * 1000)));
    await requestPatientOtp('0712345678', 'login', t0);
    expect(sentSms).toHaveLength(4);
  });

  it('sends no reset code to a number without an account', async () => {
    await requestPatientOtp('0799000111', 'reset');
    expect(sentSms).toHaveLength(0);
  });

  it('never puts medical wording in the SMS', async () => {
    addPatient();
    await requestPatientOtp('0712345678', 'login');
    expect(sentSms[0]?.message).not.toMatch(/health|medical|clinic/i);
  });
});

describe('date of birth check (recycled numbers)', () => {
  async function flowFor(overrides: Partial<FakePatient>) {
    addPatient(overrides);
    await requestPatientOtp('0712345678', 'login');
    return (await startSetupFlow('0712345678', 'login', lastCode())).flowToken;
  }

  it('the phone alone is not enough: a PIN cannot be set without the right date of birth', async () => {
    const flowToken = await flowFor({});
    await expect(verifySetupDateOfBirth(flowToken, '1991-03-15')).rejects.toMatchObject({ status: 400 });
    await expect(completeSetupWithPin(flowToken, '730194', '730194')).rejects.toMatchObject({ status: 400 });
  });

  it('ends the flow after 5 wrong dates', async () => {
    const flowToken = await flowFor({});
    for (let i = 0; i < 4; i++) await expect(verifySetupDateOfBirth(flowToken, '2000-01-02')).rejects.toMatchObject({ status: 400 });
    await expect(verifySetupDateOfBirth(flowToken, '2000-01-02')).rejects.toMatchObject({ status: 429 });
    await expect(verifySetupDateOfBirth(flowToken, '1990-03-15')).rejects.toMatchObject({ status: 401 });
  });

  it('accepts any date in the right year when only the year is known, and saves the full date', async () => {
    const flowToken = await flowFor({ dateOfBirth: new Date('1990-01-01T00:00:00Z'), dateOfBirthEstimated: true });
    await expect(verifySetupDateOfBirth(flowToken, '1989-03-15')).rejects.toMatchObject({ status: 400 });
    await verifySetupDateOfBirth(flowToken, '1990-03-15');
    expect(patients[0]).toMatchObject({ dateOfBirth: new Date('1990-03-15T00:00:00Z'), dateOfBirthEstimated: false });
  });

  it('with no date of birth on file, sends the patient to their clinic', async () => {
    const flowToken = await flowFor({ dateOfBirth: null });
    await expect(verifySetupDateOfBirth(flowToken, '1990-03-15')).rejects.toMatchObject({ status: 409, details: { reason: 'no_dob_on_file' } });
  });

  it('forgot PIN also needs OTP + date of birth, and resets the lock', async () => {
    const p = addPatient({ pinHash: await bcrypt.hash('730194', 4), pinLockedUntil: new Date(Date.now() + 600000), pinFailedAttempts: 0 });
    await requestPatientOtp('0712345678', 'reset');
    const { flowToken } = await startSetupFlow('0712345678', 'reset', lastCode());
    await verifySetupDateOfBirth(flowToken, '1990-03-15');
    await completeSetupWithPin(flowToken, '582047', '582047');
    expect(p.pinLockedUntil).toBeNull();
    expect(await loginWithPin('ACS-10000', '582047')).toMatchObject({ kind: 'ok' });
  });
});
