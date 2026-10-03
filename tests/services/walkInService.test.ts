jest.mock('../../src/db/prisma', () => {
  const tx = {
    $executeRaw: jest.fn(),
    encounter: { findFirst: jest.fn(), create: jest.fn() },
    checkIn: { findFirst: jest.fn(), create: jest.fn() },
    consent: { create: jest.fn() },
    patient: { update: jest.fn() },
  };
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      clinic: { findUnique: jest.fn() },
      encounter: { findFirst: jest.fn(), count: jest.fn() },
      checkIn: { groupBy: jest.fn() },
      __tx: tx,
    },
  };
});
jest.mock('../../src/config/africastalking', () => ({ smsClient: { send: jest.fn() } }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({ findPatientByPhone: jest.fn(), registerPatient: jest.fn() }));
jest.mock('../../src/services/departmentService', () => ({ findActiveDepartment: jest.fn() }));
jest.mock('../../src/services/doctorAssignmentService', () => ({ assignDoctorForCheckIn: jest.fn() }));
jest.mock('../../src/services/appointmentService', () => ({ findArrivalMatch: jest.fn(), markAppointmentCompleted: jest.fn() }));
jest.mock('../../src/services/realtimeEvents', () => ({ publishWalkInCheckedIn: jest.fn() }));
// The remote, fee-charging path — mocked only to prove walk-ins never touch it.
jest.mock('../../src/mpesa/stkPush', () => ({ initiateStkPush: jest.fn() }));
jest.mock('../../src/jobs/queue', () => ({ enqueueSmsReceipt: jest.fn(), scheduleStkStatusCheck: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { smsClient } from '../../src/config/africastalking';
import { findPatientByPhone, registerPatient } from '../../src/services/patientService';
import { findActiveDepartment } from '../../src/services/departmentService';
import { assignDoctorForCheckIn } from '../../src/services/doctorAssignmentService';
import { findArrivalMatch, markAppointmentCompleted } from '../../src/services/appointmentService';
import { publishWalkInCheckedIn } from '../../src/services/realtimeEvents';
import { initiateStkPush } from '../../src/mpesa/stkPush';
import { enqueueSmsReceipt, scheduleStkStatusCheck } from '../../src/jobs/queue';
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
    expect(mockFindPatient).toHaveBeenCalledWith('+254712345678');
  });
});

describe('lookupWalkInPatient', () => {
  it('returns the existing patient with their last visit at this clinic only', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue({ createdAt: new Date('2026-09-20T10:00:00Z') });
    const result = await lookupWalkInPatient('0712345678', 'clinic-A', 'staff-1');
    expect(result).toEqual({
      phoneNumber: '+254712345678',
      patient: { id: 'p-1', name: 'Jane Wanjiru', patientCode: 'ACI-7F2K', lastVisitAt: new Date('2026-09-20T10:00:00Z') },
    });
    expect(prisma.encounter.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { patientId: 'p-1', clinicId: 'clinic-A' } }));
  });

  it('returns no patient when the phone number is new', async () => {
    mockFindPatient.mockResolvedValue(null);
    expect(await lookupWalkInPatient('0799000111', 'clinic-A', 'staff-1')).toEqual({ phoneNumber: '+254799000111', patient: null });
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
      sex: 'FEMALE',
      consentChannel: 'STAFF_ASSISTED',
      crossClinicConsent: false,
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
    mockFindPatient.mockResolvedValueOnce(null).mockResolvedValueOnce(PATIENT);
    mockRegister.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
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
    expect(scheduleStkStatusCheck).not.toHaveBeenCalled();
    expect(enqueueSmsReceipt).not.toHaveBeenCalled();
  });
});

describe('SMS invite', () => {
  it('sends nothing and records no consent when the box is not ticked', async () => {
    const result = await checkInWalkIn(input({ smsConsent: false }));
    expect(mockSend).not.toHaveBeenCalled();
    expect(tx.consent!.create).not.toHaveBeenCalled();
    expect(result.sms).toBe('not_requested');
  });

  it('records the consent with a timestamped row, then sends exactly one invite', async () => {
    const result = await checkInWalkIn(input({ smsConsent: true }));
    expect(tx.consent!.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ patientId: 'p-1', type: 'SMS_CLINIC_MESSAGES', granted: true, channel: 'STAFF_ASSISTED' }),
    });
    expect(tx.consent!.create!.mock.invocationCallOrder[0]!).toBeLessThan(mockSend.mock.invocationCallOrder[0]!);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      to: ['+254712345678'],
      message: 'Welcome to Sunrise Family Clinic. Next time, skip the queue: check in from home at acisi.co.ke/patient',
    });
    expect(result.sms).toBe('sent');
  });

  it('still completes the check-in when the SMS fails, and reports the failure', async () => {
    mockSend.mockRejectedValue(new Error('Africa\'s Talking unreachable'));
    const result = await checkInWalkIn(input({ smsConsent: true }));
    expect(result).toMatchObject({ checkInId: 'ci-1', sms: 'failed' });
    expect(tx.checkIn!.create).toHaveBeenCalledTimes(1);
    expect(tx.consent!.create).toHaveBeenCalledTimes(1);
  });

  it('treats a recipient rejected by the provider as a failure', async () => {
    mockSend.mockResolvedValue({ SMSMessageData: { Recipients: [{ status: 'InsufficientBalance', statusCode: 405 }] } });
    expect((await checkInWalkIn(input({ smsConsent: true }))).sms).toBe('failed');
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
