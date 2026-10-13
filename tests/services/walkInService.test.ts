jest.mock('../../src/db/prisma', () => {
  const tx = {
    $executeRaw: jest.fn(),
    encounter: { findFirst: jest.fn(), create: jest.fn() },
    checkIn: { findFirst: jest.fn(), create: jest.fn() },
    consent: { create: jest.fn() },
    patient: { update: jest.fn() },
    clinicPatient: { upsert: jest.fn() },
  };
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      clinic: { findUnique: jest.fn() },
      encounter: { findFirst: jest.fn(), count: jest.fn(), groupBy: jest.fn(), updateMany: jest.fn() },
      checkIn: { groupBy: jest.fn() },
      patient: { findMany: jest.fn(), findFirst: jest.fn() },
      __tx: tx,
    },
  };
});
jest.mock('../../src/config/africastalking', () => ({ smsClient: { send: jest.fn() } }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/patientService', () => {
  const { DuplicatePatientError } = jest.requireActual('../../src/services/patientService');
  // Most tests think in terms of "the patient on this phone"; findPatientsByPhone wraps that one.
  const findPatientByPhone = jest.fn();
  return {
    findPatientByPhone,
    findPatientsByPhone: jest.fn(async (phone: string) => {
      const p = await findPatientByPhone(phone);
      return p ? [p] : [];
    }),
    findPatientByCode: jest.fn(),
    registerPatient: jest.fn(),
    DuplicatePatientError,
  };
});
jest.mock('../../src/services/departmentService', () => ({ findActiveDepartment: jest.fn() }));
jest.mock('../../src/services/doctorAssignmentService', () => ({ assignDoctorForCheckIn: jest.fn() }));
jest.mock('../../src/services/appointmentService', () => ({ findArrivalMatch: jest.fn(), markAppointmentCompleted: jest.fn() }));
jest.mock('../../src/services/realtimeEvents', () => ({ publishWalkInCheckedIn: jest.fn() }));
jest.mock('../../src/services/legalService', () => ({ walkInNeedsPrivacyAck: jest.fn(), recordLegalAcceptances: jest.fn() }));
// The remote, fee-charging path — mocked only to prove walk-ins never touch it.
jest.mock('../../src/mpesa/stkPush', () => ({ initiateStkPush: jest.fn() }));
jest.mock('../../src/jobs/queue', () => ({ enqueueSmsReceipt: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { smsClient } from '../../src/config/africastalking';
import { DuplicatePatientError, findPatientByCode, findPatientByPhone, findPatientsByPhone, registerPatient } from '../../src/services/patientService';
import { findActiveDepartment } from '../../src/services/departmentService';
import { assignDoctorForCheckIn } from '../../src/services/doctorAssignmentService';
import { findArrivalMatch, markAppointmentCompleted } from '../../src/services/appointmentService';
import { publishWalkInCheckedIn } from '../../src/services/realtimeEvents';
import { recordLegalAcceptances, walkInNeedsPrivacyAck } from '../../src/services/legalService';
import { initiateStkPush } from '../../src/mpesa/stkPush';
import { notifyNextInQueue } from '../../src/services/queueSmsService';
import { enqueueSmsReceipt } from '../../src/jobs/queue';
import {
  checkInWalkIn,
  getTodayCheckInCounts,
  lookupWalkInPatient,
  normalizeWalkInPhone,
  resolveDateOfBirth,
  splitFullName,
  WalkInCheckInInput,
  WalkInError,
} from '../../src/services/walkInService';

const tx = (prisma as unknown as { __tx: Record<string, Record<string, jest.Mock>> & { $executeRaw: jest.Mock } }).__tx;
const mockFindPatient = findPatientByPhone as jest.Mock;
const mockRegister = registerPatient as jest.Mock;
const mockSend = smsClient.send as jest.Mock;

const PATIENT = { id: 'p-1', patientCode: 'ACI-7F2K', firstName: 'Jane', lastName: 'Wanjiru', phoneNumber: '+254712345678' };
const ENCOUNTER_AT = new Date('2026-10-03T08:00:00Z');

function input(overrides: Partial<WalkInCheckInInput> = {}): WalkInCheckInInput {
  return {
    clinicId: 'clinic-A',
    staffId: 'staff-1',
    phone: '0712 345 678',
    departmentId: 'dept-general',
    reasonForVisit: 'Fever and headache',
    smsConsent: false,
    privacyNoticeExplained: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.clinic.findUnique as jest.Mock).mockResolvedValue({ name: 'Sunrise Family Clinic', isActive: true });
  (findActiveDepartment as jest.Mock).mockResolvedValue({ id: 'dept-general', name: 'General' });
  (assignDoctorForCheckIn as jest.Mock).mockResolvedValue('doc-1');
  (findArrivalMatch as jest.Mock).mockResolvedValue(null);
  (prisma.encounter.count as jest.Mock).mockResolvedValue(3);
  mockFindPatient.mockResolvedValue(PATIENT);
  (prisma.patient.findMany as jest.Mock).mockImplementation(async () => {
    const p = await mockFindPatient();
    return p ? [p] : [];
  });
  (prisma.encounter.groupBy as jest.Mock).mockResolvedValue([]);
  (prisma.encounter.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (walkInNeedsPrivacyAck as jest.Mock).mockResolvedValue(false);
  tx.encounter!.findFirst!.mockResolvedValue(null);
  tx.checkIn!.findFirst!.mockResolvedValue(null);
  tx.checkIn!.create!.mockResolvedValue({ id: 'ci-1' });
  tx.encounter!.create!.mockResolvedValue({ id: 'enc-1', createdAt: ENCOUNTER_AT });
  mockSend.mockResolvedValue({ SMSMessageData: { Recipients: [{ status: 'Success', statusCode: 101 }] } });
});

describe('phone normalisation', () => {
  it.each(['0712345678', '0712 345 678', '+254712345678', '254712345678', '254 712-345-678'])('normalises %s to +254712345678', (raw) => {
    expect(normalizeWalkInPhone(raw)).toBe('+254712345678');
  });

  it('normalises the newer 01… prefix', () => {
    expect(normalizeWalkInPhone('0110 123 456')).toBe('+254110123456');
  });

  it.each(['12345', '0812345678', '+1 555 123 4567', ''])('rejects %j with a clear 400', (raw) => {
    expect(() => normalizeWalkInPhone(raw)).toThrow(WalkInError);
    try {
      normalizeWalkInPhone(raw);
    } catch (err) {
      expect((err as WalkInError).status).toBe(400);
    }
  });

  it('searches by the normalised number whatever format staff typed', async () => {
    await lookupWalkInPatient('254712345678', 'clinic-A', 'staff-1');
    expect(findPatientsByPhone).toHaveBeenCalledWith('+254712345678');
  });
});

describe('lookupWalkInPatient', () => {
  it('returns the existing patient with their last visit at this clinic only', async () => {
    (prisma.encounter.groupBy as jest.Mock).mockResolvedValue([{ patientId: 'p-1', _max: { createdAt: new Date('2026-09-20T10:00:00Z') } }]);
    const result = await lookupWalkInPatient('0712345678', 'clinic-A', 'staff-1');
    expect(result).toMatchObject({
      query: '+254712345678',
      kind: 'phone',
      phoneNumber: '+254712345678',
      patients: [
        {
          id: 'p-1',
          name: 'Jane Wanjiru',
          patientCode: 'ACI-7F2K',
          lastVisitAt: new Date('2026-09-20T10:00:00Z'),
          hasIdOnFile: false,
          hasNextOfKinOnFile: false,
          privacyNoticeAckRequired: false,
        },
      ],
    });
    expect(prisma.encounter.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { patientId: { in: ['p-1'] }, clinicId: 'clinic-A' } }));
  });

  it('returns nobody when the phone number is new', async () => {
    mockFindPatient.mockResolvedValue(null);
    expect(await lookupWalkInPatient('0799000111', 'clinic-A', 'staff-1')).toEqual({
      query: '+254799000111',
      kind: 'phone',
      phoneNumber: '+254799000111',
      patients: [],
    });
  });

  it('finds a patient by ACISI ID', async () => {
    (findPatientByCode as jest.Mock).mockResolvedValue(PATIENT);
    const result = await lookupWalkInPatient('ACI-7F2K', 'clinic-A', 'staff-1');
    expect(result).toMatchObject({ kind: 'patientCode', phoneNumber: null, patients: [{ id: 'p-1' }] });
  });
});

describe('finding or creating the patient', () => {
  it('reuses the existing patient and never registers a duplicate, even if new-patient details were sent', async () => {
    const result = await checkInWalkIn(
      input({ newPatient: { fullName: 'Someone Else', registrationConsent: true } }),
    );
    expect(mockRegister).not.toHaveBeenCalled();
    expect(result).toMatchObject({ patientId: 'p-1', isNewPatient: false, patientName: 'Jane Wanjiru' });
  });

  it('creates a new patient with staff-assisted consent and sharing off by default', async () => {
    mockFindPatient.mockResolvedValue(null);
    mockRegister.mockResolvedValue({ ...PATIENT, id: 'p-new', firstName: 'Amina', lastName: 'Achieng Otieno' });
    const result = await checkInWalkIn(
      input({ phone: '+254799000111', newPatient: { fullName: '  Amina  Achieng Otieno ', age: 34, sex: 'FEMALE', registrationConsent: true } }),
    );
    expect(mockRegister).toHaveBeenCalledWith({
      phoneNumberE164: '+254799000111',
      firstName: 'Amina',
      lastName: 'Achieng Otieno',
      dateOfBirth: new Date(Date.UTC(new Date().getUTCFullYear() - 34, 0, 1)),
      dateOfBirthEstimated: true,
      sex: 'FEMALE',
      consentChannel: 'STAFF_ASSISTED',
    });
    expect(result).toMatchObject({ patientId: 'p-new', isNewPatient: true });
  });

  it('refuses to register a new patient without their record consent', async () => {
    mockFindPatient.mockResolvedValue(null);
    await expect(checkInWalkIn(input({ newPatient: { fullName: 'Amina Achieng', registrationConsent: false } }))).rejects.toMatchObject({
      status: 400,
    });
    expect(mockRegister).not.toHaveBeenCalled();
    expect(tx.checkIn!.create).not.toHaveBeenCalled();
  });

  it('asks for details when the phone is new and none were given', async () => {
    mockFindPatient.mockResolvedValue(null);
    await expect(checkInWalkIn(input())).rejects.toMatchObject({ status: 400 });
  });

  it('reuses the record if someone else registered the same phone a moment earlier (no duplicate)', async () => {
    mockFindPatient.mockResolvedValueOnce(null);
    mockRegister.mockRejectedValue(new DuplicatePatientError(PATIENT as never));
    const result = await checkInWalkIn(input({ newPatient: { fullName: 'Jane Wanjiru', registrationConsent: true } }));
    expect(result).toMatchObject({ patientId: 'p-1', isNewPatient: false });
    expect(tx.checkIn!.create).toHaveBeenCalledTimes(1);
  });
});

describe('adding the walk-in to the queue', () => {
  it('creates a WALK_IN check-in and a WAITING visit assigned to a doctor, recording who and when', async () => {
    const result = await checkInWalkIn(input());

    expect(tx.checkIn!.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patientId: 'p-1',
        clinicId: 'clinic-A',
        departmentId: 'dept-general',
        staffId: 'staff-1',
        source: 'WALK_IN',
        status: 'NO_FEE',
        ussdSessionId: expect.stringMatching(/^WALKIN-/),
      }),
    });
    expect(tx.encounter!.create).toHaveBeenCalledWith({
      data: { patientId: 'p-1', clinicId: 'clinic-A', checkInId: 'ci-1', assignedDoctorId: 'doc-1', visitReason: 'Fever and headache' },
    });
    expect(publishWalkInCheckedIn).toHaveBeenCalledWith({ checkInId: 'ci-1', clinicId: 'clinic-A' });
    expect(result).toMatchObject({ checkInId: 'ci-1', encounterId: 'enc-1', queuePosition: 3, departmentName: 'General' });
  });

  it('reports position as the count of patients waiting in that department up to and including this one, in arrival order', async () => {
    await checkInWalkIn(input());
    expect(prisma.encounter.count).toHaveBeenCalledWith({
      where: { clinicId: 'clinic-A', status: 'WAITING', checkIn: { departmentId: 'dept-general' }, createdAt: { lte: ENCOUNTER_AT } },
    });
  });

  it('links and completes a booking the patient had for today', async () => {
    (findArrivalMatch as jest.Mock).mockResolvedValue({ id: 'appt-1' });
    await checkInWalkIn(input());
    expect(tx.checkIn!.create).toHaveBeenCalledWith({ data: expect.objectContaining({ appointmentId: 'appt-1' }) });
    expect(markAppointmentCompleted).toHaveBeenCalledWith('appt-1');
  });

  it('refuses a patient who is already in the queue at this clinic', async () => {
    tx.encounter!.findFirst!.mockResolvedValue({ id: 'enc-open' });
    await expect(checkInWalkIn(input())).rejects.toMatchObject({ status: 409 });
    expect(tx.checkIn!.create).not.toHaveBeenCalled();
  });

  it('refuses a patient whose remote check-in today is still awaiting payment', async () => {
    tx.checkIn!.findFirst!.mockResolvedValue({ id: 'ci-remote', status: 'PENDING_PAYMENT' });
    await expect(checkInWalkIn(input())).rejects.toThrow(/Confirm payment/);
    expect(tx.checkIn!.create).not.toHaveBeenCalled();
  });

  it('takes a per-patient lock so a double submit cannot queue them twice', async () => {
    await checkInWalkIn(input());
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('rejects an unknown department or blank reason', async () => {
    (findActiveDepartment as jest.Mock).mockResolvedValueOnce(null);
    await expect(checkInWalkIn(input())).rejects.toMatchObject({ status: 400 });
    await expect(checkInWalkIn(input({ reasonForVisit: '   ' }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('no ACISI fee for walk-ins', () => {
  it('charges nothing and never starts a payment or sends a receipt', async () => {
    await checkInWalkIn(input());
    const data = tx.checkIn!.create!.mock.calls[0]![0].data;
    expect(Number(data.amountKes)).toBe(0);
    expect(data.status).toBe('NO_FEE');
    expect(initiateStkPush).not.toHaveBeenCalled();
    expect(enqueueSmsReceipt).not.toHaveBeenCalled();
  });
});

describe('queue SMS', () => {
  it('sends one "you are number N" SMS on joining, with no department name', async () => {
    const result = await checkInWalkIn(input());
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      to: ['+254712345678'],
      message: 'You are number 3 in the queue at Sunrise Family Clinic. Next time, check in from home at acisi.co.ke/patient',
    });
    expect(mockSend.mock.calls[0][0].message).not.toContain('General');
    expect(result.sms).toBe('sent');
    // Claimed before sending, so it can never go out twice.
    expect(prisma.encounter.updateMany).toHaveBeenCalledWith({ where: { id: 'enc-1', queueJoinSmsAt: null }, data: { queueJoinSmsAt: expect.any(Date) } });
  });

  it('marks someone already first in line so they never also get "you\'re next"', async () => {
    (prisma.encounter.count as jest.Mock).mockResolvedValue(1);
    await checkInWalkIn(input());
    expect(prisma.encounter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { queueJoinSmsAt: expect.any(Date), queueNextSmsAt: expect.any(Date) } }),
    );
  });

  it('records SMS consent when the box is ticked, before sending', async () => {
    await checkInWalkIn(input({ smsConsent: true }));
    expect(tx.consent!.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ patientId: 'p-1', type: 'SMS_CLINIC_MESSAGES', granted: true, channel: 'STAFF_ASSISTED' }),
    });
    expect(tx.consent!.create!.mock.invocationCallOrder[0]!).toBeLessThan(mockSend.mock.invocationCallOrder[0]!);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('still completes the check-in when the SMS fails, and reports the failure', async () => {
    mockSend.mockRejectedValue(new Error('Africa\'s Talking unreachable'));
    const result = await checkInWalkIn(input());
    expect(result).toMatchObject({ checkInId: 'ci-1', sms: 'failed' });
    expect(tx.checkIn!.create).toHaveBeenCalledTimes(1);
  });

  it('treats a recipient rejected by the provider as a failure', async () => {
    mockSend.mockResolvedValue({ SMSMessageData: { Recipients: [{ status: 'InsufficientBalance', statusCode: 405 }] } });
    expect((await checkInWalkIn(input())).sms).toBe('failed');
  });

  it('sends nothing to a patient who opted out earlier', async () => {
    mockFindPatient.mockResolvedValue({ ...PATIENT, smsOptOut: true });
    expect((await checkInWalkIn(input())).sms).toBe('not_requested');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('picking a patient on a shared phone', () => {
  it('requires staff to confirm name and date of birth', async () => {
    (prisma.patient.findFirst as jest.Mock).mockResolvedValue(PATIENT);
    await expect(checkInWalkIn(input({ phone: undefined, patientId: 'p-1' }))).rejects.toMatchObject({ status: 400 });
    expect(tx.checkIn!.create).not.toHaveBeenCalled();
    await checkInWalkIn(input({ phone: undefined, patientId: 'p-1', identityConfirmed: true }));
    expect(tx.checkIn!.create).toHaveBeenCalledTimes(1);
  });

  it('refuses to guess when only a shared phone is given', async () => {
    (findPatientsByPhone as jest.Mock).mockResolvedValueOnce([PATIENT, { ...PATIENT, id: 'p-2' }]);
    await expect(checkInWalkIn(input())).rejects.toMatchObject({ status: 409 });
  });

  it('links the patient to the clinic as part of the check-in', async () => {
    await checkInWalkIn(input());
    expect(tx.clinicPatient!.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ clinicId: 'clinic-A', patientId: 'p-1', source: 'VISIT' }) }),
    );
  });
});

describe('"you\'re next" SMS', () => {
  const NEXT = {
    id: 'enc-9',
    queueJoinSmsAt: new Date(),
    queueNextSmsAt: null,
    checkIn: { source: 'WALK_IN' },
    patient: { id: 'p-9', phoneNumber: '+254700000009', smsOptOut: false, deletedAt: null },
    clinic: { name: 'Sunrise Family Clinic' },
  };

  it('texts the walk-in now first in line, once', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(NEXT);
    await notifyNextInQueue('clinic-A', 'dept-general');
    expect(mockSend).toHaveBeenCalledWith({ to: ['+254700000009'], message: "You're next at Sunrise Family Clinic. Please stay near reception." });
    (prisma.encounter.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await notifyNextInQueue('clinic-A', 'dept-general');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a remote check-in', { checkIn: { source: 'REMOTE' } }],
    ['someone already told', { queueNextSmsAt: new Date() }],
    ['someone who got no join SMS', { queueJoinSmsAt: null }],
    ['someone who opted out', { patient: { ...NEXT.patient, smsOptOut: true } }],
  ])('sends nothing to %s', async (_l, overrides) => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue({ ...NEXT, ...overrides });
    await notifyNextInQueue('clinic-A', 'dept-general');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('"Does not want SMS"', () => {
  it('records the opt-out on the patient and sends nothing', async () => {
    const result = await checkInWalkIn(input({ smsOptOut: true }));
    expect(tx.patient!.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({ smsOptOut: true }),
    });
    expect(mockSend).not.toHaveBeenCalled();
    expect(result.sms).toBe('not_requested');
  });

  it('refuses both boxes ticked at once', async () => {
    await expect(checkInWalkIn(input({ smsConsent: true, smsOptOut: true }))).rejects.toMatchObject({ status: 400 });
    expect(tx.checkIn!.create).not.toHaveBeenCalled();
  });

  it('agreeing to SMS again clears an earlier opt-out', async () => {
    mockFindPatient.mockResolvedValue({ ...PATIENT, smsOptOut: true });
    await checkInWalkIn(input({ smsConsent: true }));
    expect(tx.patient!.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: expect.objectContaining({ smsOptOut: false }) });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('leaves the preference alone when neither box is ticked', async () => {
    await checkInWalkIn(input());
    expect(tx.patient!.update).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('splits a full name into first and last', () => {
    expect(splitFullName(' Jane  Wanjiru Mwangi ')).toEqual({ firstName: 'Jane', lastName: 'Wanjiru Mwangi' });
    expect(splitFullName('Jane')).toEqual({ firstName: 'Jane', lastName: '' });
  });

  it('resolves date of birth from a date (preferred) or an age', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    expect(resolveDateOfBirth({ dateOfBirth: '1990-05-01', age: 10 }, now)).toEqual(new Date(Date.UTC(1990, 4, 1)));
    expect(resolveDateOfBirth({ age: 30 }, now)).toEqual(new Date(Date.UTC(1996, 0, 1)));
    expect(resolveDateOfBirth({}, now)).toBeUndefined();
    for (const bad of ['2001-02-30', '2030-01-01', '1850-01-01', '01/05/1990']) {
      expect(() => resolveDateOfBirth({ dateOfBirth: bad }, now)).toThrow(WalkInError);
    }
  });

  it("counts today's check-ins by source", async () => {
    (prisma.checkIn.groupBy as jest.Mock).mockResolvedValue([
      { source: 'WALK_IN', _count: { _all: 4 } },
      { source: 'REMOTE', _count: { _all: 12 } },
    ]);
    expect(await getTodayCheckInCounts('clinic-A')).toEqual({ walkIn: 4, remote: 12 });
  });
});

describe('Privacy Notice checkbox at walk-in check-in', () => {
  const mockNeedsAck = walkInNeedsPrivacyAck as jest.Mock;
  const mockRecordLegal = recordLegalAcceptances as jest.Mock;
  const NEW_PATIENT = { fullName: 'Amina Otieno', registrationConsent: true };

  it("tells the front desk to ask at the patient's first walk-in at this clinic", async () => {
    mockNeedsAck.mockResolvedValue(true);
    const result = await lookupWalkInPatient('0712345678', 'clinic-A', 'staff-1');
    expect(result.patients[0]?.privacyNoticeAckRequired).toBe(true);
    expect(mockNeedsAck).toHaveBeenCalledWith('p-1', 'clinic-A');
  });

  it('refuses a new patient without the box ticked, before registering anyone', async () => {
    mockFindPatient.mockResolvedValue(null);
    await expect(checkInWalkIn(input({ newPatient: NEW_PATIENT, privacyNoticeExplained: false }))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Privacy Notice'),
    });
    expect(mockRegister).not.toHaveBeenCalled();
    expect(tx.checkIn!.create).not.toHaveBeenCalled();
    expect(mockRecordLegal).not.toHaveBeenCalled();
  });

  it('refuses an existing patient who has not been told at this clinic yet', async () => {
    mockNeedsAck.mockResolvedValue(true);
    await expect(checkInWalkIn(input({ privacyNoticeExplained: false }))).rejects.toBeInstanceOf(WalkInError);
    expect(tx.checkIn!.create).not.toHaveBeenCalled();
    expect(mockRecordLegal).not.toHaveBeenCalled();
  });

  it('records the acknowledgment with the version, staff member, clinic and check-in', async () => {
    mockNeedsAck.mockResolvedValue(true);
    await checkInWalkIn(input({ privacyNoticeExplained: true }));
    expect(mockRecordLegal).toHaveBeenCalledWith(
      ['PRIVACY_NOTICE'],
      'WALK_IN_CHECKIN',
      { patientId: 'p-1', staffId: 'staff-1', clinicId: 'clinic-A', checkInId: 'ci-1' },
      tx,
    );
  });

  it('records it for a newly registered patient too', async () => {
    mockFindPatient.mockResolvedValue(null);
    mockRegister.mockResolvedValue({ ...PATIENT, id: 'p-new' });
    await checkInWalkIn(input({ newPatient: NEW_PATIENT }));
    expect(mockRecordLegal).toHaveBeenCalledWith(
      ['PRIVACY_NOTICE'],
      'WALK_IN_CHECKIN',
      expect.objectContaining({ patientId: 'p-new', staffId: 'staff-1' }),
      tx,
    );
  });

  it('does not ask again once this clinic has recorded it for the current version', async () => {
    mockNeedsAck.mockResolvedValue(false);
    await expect(checkInWalkIn(input({ privacyNoticeExplained: false }))).resolves.toMatchObject({ checkInId: 'ci-1' });
    expect(mockRecordLegal).not.toHaveBeenCalled();
  });
});

describe('ID document and next of kin at walk-in check-in', () => {
  it('saves what was entered, in the same transaction as the check-in', async () => {
    await checkInWalkIn(
      input({ identity: { idType: 'NATIONAL_ID', idNumber: '1234 5678', nextOfKinName: 'Peter Otieno', nextOfKinPhone: '0722 000 111' } }),
    );
    expect(tx.patient!.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { idType: 'NATIONAL_ID', idNumber: '12345678', nextOfKinName: 'Peter Otieno', nextOfKinPhone: '+254722000111' },
    });
  });

  it('never wipes details on file when the fields are left empty', async () => {
    await checkInWalkIn(input({ identity: { idType: '', idNumber: '', nextOfKinName: '', nextOfKinPhone: '' } }));
    expect(tx.patient!.update).not.toHaveBeenCalled();
  });

  it('refuses a bad ID before registering anyone or checking them in', async () => {
    mockFindPatient.mockResolvedValue(null);
    await expect(
      checkInWalkIn(input({ newPatient: { fullName: 'Amina Otieno', registrationConsent: true }, identity: { idType: 'NATIONAL_ID', idNumber: 'AB12' } })),
    ).rejects.toMatchObject({ status: 400, message: 'A national ID number is 6 to 9 digits' });
    expect(mockRegister).not.toHaveBeenCalled();
    expect(tx.checkIn!.create).not.toHaveBeenCalled();
  });

  it('lookup only says whether details are on file, never what they are', async () => {
    mockFindPatient.mockResolvedValue({ ...PATIENT, idType: 'PASSPORT', idNumber: 'AK123456', nextOfKinName: 'Peter', nextOfKinPhone: null });
    const result = await lookupWalkInPatient('0712345678', 'clinic-A', 'staff-1');
    expect(result.patients[0]).toMatchObject({ hasIdOnFile: true, hasNextOfKinOnFile: true });
    expect(JSON.stringify(result)).not.toContain('AK123456');
  });
});
