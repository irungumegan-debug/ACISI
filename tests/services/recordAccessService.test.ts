/**
 * Sharing records between clinics: the access rule (a clinic never sees
 * another clinic's records without the patient's approval), the consent
 * code (10 minutes, single use, 5 wrong tries), PIN approval, revocation,
 * and the audit trail. Runs the real services against a small in-memory DB.
 */
import bcrypt from 'bcrypt';

interface Row {
  [k: string]: unknown;
}
const db = {
  consents: [] as Row[],
  requests: [] as Row[],
  encounters: [] as Row[],
  patients: [] as Row[],
};
const sentSms: { to: string; message: string }[] = [];
const audit: Row[] = [];
let seq = 0;

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn(async (e: Row) => audit.push(e)) }));
jest.mock('../../src/services/smsSender', () => ({
  sendSms: jest.fn(async (to: string, message: string) => {
    sentSms.push({ to, message });
    return true;
  }),
}));
jest.mock('../../src/services/patientAuthService', () => ({
  ...jest.requireActual('../../src/services/patientAuthService'),
  confirmPatientPin: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => {
  // Very small matcher for the where clauses these services use.
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return true; // clinic scoping: every test patient is known to the clinic
      if (v === undefined) return true;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const o = v as Row;
        if ('not' in o) return row[k] !== o.not;
        if ('gt' in o) return (row[k] as Date) > (o.gt as Date);
        if ('gte' in o) return (row[k] as Date) >= (o.gte as Date);
        if ('in' in o) return (o.in as unknown[]).includes(row[k]);
        return true;
      }
      return row[k] === v;
    });
  const newest = (rows: Row[]) => [...rows].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || (b.seq as number) - (a.seq as number));
  const table = (rows: Row[]) => ({
    findFirst: jest.fn(async ({ where }: { where: Row }) => newest(rows.filter((r) => matches(r, where)))[0] ?? null),
    findMany: jest.fn(async ({ where }: { where: Row }) => newest(rows.filter((r) => matches(r, where)))),
    findUnique: jest.fn(async ({ where }: { where: Row }) => rows.find((r) => r.id === where.id) ?? null),
    count: jest.fn(async ({ where }: { where: Row }) => rows.filter((r) => matches(r, where)).length),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const row = { id: `row-${++seq}`, seq, createdAt: new Date(), attempts: 0, status: 'PENDING', ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(rows.find((r) => r.id === where.id) as Row, data)),
    updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  });
  return {
    prisma: {
      consent: table(db.consents),
      recordAccessRequest: table(db.requests),
      encounter: table(db.encounters),
      patient: table(db.patients),
      clinic: { findUnique: jest.fn(async () => ({ name: 'Sunrise Clinic' })) },
    },
  };
});

import { getScopedHistory } from '../../src/services/patientService';
import { confirmPatientPin } from '../../src/services/patientAuthService';
import {
  approveRecordAccessWithCode,
  approveRecordAccessWithPin,
  clinicHasRecordAccess,
  listRecordAccess,
  requestRecordAccess,
  revokeAllClinicsSharing,
  revokeClinicRecordAccess,
} from '../../src/services/recordAccessService';

const PATIENT = 'patient-1';
const CLINIC_A = 'clinic-A';
const CLINIC_B = 'clinic-B';

function code(): string {
  return /code is (\d{6})/.exec(sentSms[sentSms.length - 1]?.message ?? '')?.[1] as string;
}

beforeEach(() => {
  for (const t of Object.values(db)) t.length = 0;
  sentSms.length = 0;
  audit.length = 0;
  db.patients.push({ id: PATIENT, phoneNumber: '+254712345678', smsOptOut: false, pinHash: 'hash', deletedAt: null });
  // One visit at each clinic.
  db.encounters.push(
    { id: 'enc-A', patientId: PATIENT, clinicId: CLINIC_A, createdAt: new Date('2026-09-01'), clinic: { name: 'Clinic A' }, diagnosis: 'A note', prescription: null },
    { id: 'enc-B', patientId: PATIENT, clinicId: CLINIC_B, createdAt: new Date('2026-08-01'), clinic: { name: 'Clinic B' }, diagnosis: 'B note', prescription: null },
  );
});

describe("the access rule: a clinic can't see other clinics' records without consent", () => {
  it('sees only its own records, and learns that others exist — never their contents', async () => {
    const res = await getScopedHistory(PATIENT, CLINIC_A);
    expect(res.history.map((h) => h.encounterId)).toEqual(['enc-A']);
    expect(res.hasHiddenHistoryElsewhere).toBe(true);
    expect(JSON.stringify(res)).not.toContain('B note');
  });

  it("another clinic's approval does not open this clinic's view", async () => {
    db.consents.push({ patientId: PATIENT, type: 'CLINIC_RECORD_ACCESS', clinicId: CLINIC_B, granted: true, createdAt: new Date(), seq: 0 });
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_A)).toBe(false);
    expect((await getScopedHistory(PATIENT, CLINIC_A)).history).toHaveLength(1);
  });

  it('after the patient approves, the clinic sees records from other clinics', async () => {
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    await approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, code());
    const res = await getScopedHistory(PATIENT, CLINIC_A);
    expect(res.history.map((h) => h.encounterId)).toEqual(['enc-A', 'enc-B']);
    expect(res.hasHiddenHistoryElsewhere).toBe(false);
  });

  it('after the patient revokes, they are hidden again', async () => {
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    await approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, code());
    await new Promise((r) => setTimeout(r, 2));
    await revokeClinicRecordAccess(PATIENT, CLINIC_A);
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_A)).toBe(false);
    expect((await getScopedHistory(PATIENT, CLINIC_A)).hasHiddenHistoryElsewhere).toBe(true);
  });

  it('an old "share with all clinics" yes still counts, until revoked from the portal', async () => {
    db.consents.push({ patientId: PATIENT, type: 'CROSS_CLINIC_RECORD_SHARING', clinicId: null, granted: true, createdAt: new Date('2026-01-01'), seq: 0 });
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_A)).toBe(true);
    expect((await listRecordAccess(PATIENT)).allClinicsFromSignup).toBe(true);
    await revokeAllClinicsSharing(PATIENT);
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_A)).toBe(false);
  });
});

describe('the consent code', () => {
  it('is sent in one SMS with the agreed wording, and stored only as a hash', async () => {
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    expect(sentSms[0]?.message).toMatch(/^Sunrise Clinic is asking to see your ACISI records from other clinics\. Your code is \d{6}\. Only share it if you agree\.$/);
    expect(sentSms[0]!.message.length).toBeLessThanOrEqual(160);
    expect(db.requests[0]?.codeHash).not.toContain(code());
    expect(await bcrypt.compare(code(), db.requests[0]?.codeHash as string)).toBe(true);
  });

  it('expires after 10 minutes', async () => {
    const t0 = new Date();
    const { expiresAt } = await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT, t0);
    expect(expiresAt.getTime() - t0.getTime()).toBe(10 * 60 * 1000);
    await expect(approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, code(), new Date(t0.getTime() + 10 * 60 * 1000 + 1))).rejects.toThrow(/expired/);
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_A)).toBe(false);
  });

  it('works only once', async () => {
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    const c = code();
    await approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, c);
    await expect(approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, c)).rejects.toMatchObject({ status: 400 });
  });

  it('dies after 5 wrong tries, even if the right code comes next', async () => {
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    const right = code();
    const wrong = right === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i++) await expect(approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, wrong)).rejects.toThrow(/not right/);
    await expect(approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, wrong)).rejects.toThrow(/Too many wrong codes/);
    await expect(approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, right)).rejects.toMatchObject({ status: 400 });
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_A)).toBe(false);
  });

  it("only works for the clinic that asked — another clinic can't use it", async () => {
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    await expect(approveRecordAccessWithCode(CLINIC_B, 'staff-9', PATIENT, code())).rejects.toMatchObject({ status: 400 });
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_B)).toBe(false);
  });

  it('a new request replaces the old code', async () => {
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    const first = code();
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    if (first !== code()) await expect(approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, first)).rejects.toBeDefined();
    await approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, code());
  });

  it('is limited to 3 SMS per patient per clinic per hour', async () => {
    for (let i = 0; i < 3; i++) await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    await expect(requestRecordAccess(CLINIC_A, 'staff-1', PATIENT)).rejects.toMatchObject({ status: 429 });
    expect(sentSms).toHaveLength(3);
  });

  it("isn't sent to a patient who doesn't want SMS (they can use their PIN)", async () => {
    db.patients[0]!.smsOptOut = true;
    await expect(requestRecordAccess(CLINIC_A, 'staff-1', PATIENT)).rejects.toMatchObject({ status: 409 });
    expect(sentSms).toHaveLength(0);
  });
});

describe("approval with the patient's own PIN (no SMS)", () => {
  it('grants access on the right PIN', async () => {
    (confirmPatientPin as jest.Mock).mockResolvedValue(true);
    await approveRecordAccessWithPin(CLINIC_A, 'staff-1', PATIENT, '730194');
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_A)).toBe(true);
    expect(sentSms).toHaveLength(0);
  });

  it('refuses a wrong PIN', async () => {
    (confirmPatientPin as jest.Mock).mockResolvedValue(false);
    await expect(approveRecordAccessWithPin(CLINIC_A, 'staff-1', PATIENT, '000000')).rejects.toMatchObject({ status: 400 });
    expect(await clinicHasRecordAccess(PATIENT, CLINIC_A)).toBe(false);
  });
});

describe('audit log', () => {
  it('records the request, the approval and the revocation with who, which clinic and which patient', async () => {
    await requestRecordAccess(CLINIC_A, 'staff-1', PATIENT);
    await approveRecordAccessWithCode(CLINIC_A, 'staff-1', PATIENT, code());
    await revokeClinicRecordAccess(PATIENT, CLINIC_A);
    expect(audit.map((a) => a.action)).toEqual(['RECORD_ACCESS_REQUESTED', 'RECORD_ACCESS_APPROVED', 'RECORD_ACCESS_REVOKED']);
    for (const a of audit) expect(a).toMatchObject({ clinicId: CLINIC_A, patientId: PATIENT });
    expect(audit[0]).toMatchObject({ staffId: 'staff-1' });
    expect(JSON.stringify(audit)).not.toMatch(/\b\d{6}\b/); // the code itself is never logged
  });
});
