/**
 * Lab orders: the doctor's request moves the visit to the lab queue, the
 * lab's signed results send it back to the same doctor with one SMS, and
 * nothing is saved without the right PIN.
 */
jest.mock('../../src/db/prisma', () => {
  const p = {
    encounter: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    labTest: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    labOrder: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    labOrderItem: { update: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  p.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: typeof p) => unknown)(p) : Promise.all(arg as unknown[])));
  return { prisma: p };
});
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/realtimeEvents', () => ({ publishQueueChanged: jest.fn() }));
jest.mock('../../src/services/smsService', () => ({ sendPatientSms: jest.fn() }));
jest.mock('../../src/services/signingPin', () => {
  class InvalidPinError extends Error {}
  class PinLockedOutError extends Error {}
  return { verifySigningPin: jest.fn(), InvalidPinError, PinLockedOutError };
});

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { publishQueueChanged } from '../../src/services/realtimeEvents';
import { sendPatientSms } from '../../src/services/smsService';
import { InvalidPinError, verifySigningPin } from '../../src/services/signingPin';
import { buildLabResultsReadySms, SINGLE_SMS_MAX_CHARS } from '../../src/services/smsTemplates';
import { CLINIC_COUNTED_SMS_PURPOSES } from '../../src/config/constants';
import { ageInYears, completeLabOrder, createLabTest, getLabQueue, requestLabTests, saveLabResults } from '../../src/services/labService';

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const mockPin = verifySigningPin as jest.Mock;
const mockSms = sendPatientSms as jest.Mock;
const mockAudit = recordAuditEvent as jest.Mock;

const REQUEST = { encounterId: 'enc-1', clinicId: 'clinic-1', departmentIds: ['dept-1'], staffId: 'doc-1', labTestIds: ['t-1', 't-2'], pin: '1234' };
const TESTS = [
  { id: 't-1', name: 'Malaria RDT', priceKes: 300, clinicId: 'clinic-1', isActive: true },
  { id: 't-2', name: 'Full blood count', priceKes: 800, clinicId: 'clinic-1', isActive: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPin.mockResolvedValue(undefined);
  db.encounter!.findFirst!.mockResolvedValue({ id: 'enc-1', status: 'IN_CONSULTATION', checkInId: 'ci-1' });
  db.encounter!.findUnique!.mockResolvedValue({ checkInId: 'ci-1' });
  db.encounter!.updateMany!.mockResolvedValue({ count: 1 });
  db.labTest!.findMany!.mockResolvedValue(TESTS);
  db.labOrder!.create!.mockResolvedValue({ id: 'order-1' });
  db.labOrder!.updateMany!.mockResolvedValue({ count: 1 });
  db.labOrder!.count!.mockResolvedValue(0);
});

describe('doctor requests lab tests', () => {
  it('only for a visit in this doctor’s own queue, and only while it is with them', async () => {
    db.encounter!.findFirst!.mockResolvedValueOnce(null);
    await expect(requestLabTests(REQUEST)).rejects.toMatchObject({ status: 404 });
    const where = db.encounter!.findFirst!.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'enc-1', clinicId: 'clinic-1', OR: [{ assignedDoctorId: 'doc-1' }, { assignedDoctorId: null }] });

    db.encounter!.findFirst!.mockResolvedValueOnce({ id: 'enc-1', status: 'WAITING', checkInId: 'ci-1' });
    await expect(requestLabTests(REQUEST)).rejects.toMatchObject({ status: 409 });
    expect(db.labOrder!.create).not.toHaveBeenCalled();
  });

  it('refuses a test that is not active on this clinic’s list', async () => {
    db.labTest!.findMany!.mockResolvedValue([TESTS[0]]);
    await expect(requestLabTests(REQUEST)).rejects.toMatchObject({ status: 400 });
    expect(db.labTest!.findMany!.mock.calls[0][0].where).toEqual({ id: { in: ['t-1', 't-2'] }, clinicId: 'clinic-1', isActive: true });
    expect(mockPin).not.toHaveBeenCalled();
  });

  it('saves nothing when the PIN is wrong', async () => {
    mockPin.mockRejectedValue(new InvalidPinError());
    await expect(requestLabTests(REQUEST)).rejects.toBeInstanceOf(InvalidPinError);
    expect(db.encounter!.updateMany).not.toHaveBeenCalled();
    expect(db.labOrder!.create).not.toHaveBeenCalled();
  });

  it('moves the visit to the lab (conditionally) and copies each test’s name and price', async () => {
    const result = await requestLabTests({ ...REQUEST, labTestIds: ['t-2', 't-1', 't-2'], noteForLab: '  fasting since 8pm ' });
    expect(result).toEqual({ labOrderId: 'order-1' });
    expect(db.encounter!.updateMany).toHaveBeenCalledWith({ where: { id: 'enc-1', status: 'IN_CONSULTATION' }, data: { status: 'AWAITING_LAB' } });
    const data = db.labOrder!.create!.mock.calls[0][0].data;
    expect(data).toMatchObject({ encounterId: 'enc-1', clinicId: 'clinic-1', requestedByStaffId: 'doc-1', noteForLab: 'fasting since 8pm' });
    expect(data.items.create).toEqual([
      { labTestId: 't-2', testName: 'Full blood count', priceKes: 800, position: 0 },
      { labTestId: 't-1', testName: 'Malaria RDT', priceKes: 300, position: 1 },
    ]);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'LAB_ORDER_REQUESTED', entityId: 'order-1', metadata: { encounterId: 'enc-1', testCount: 2 } }));
    expect(publishQueueChanged).toHaveBeenCalledWith({ checkInId: 'ci-1', clinicId: 'clinic-1' });
  });

  it('a double click sends the patient only once', async () => {
    db.encounter!.updateMany!.mockResolvedValue({ count: 0 });
    await expect(requestLabTests(REQUEST)).rejects.toMatchObject({ status: 409 });
    expect(db.labOrder!.create).not.toHaveBeenCalled();
  });
});

const OPEN_ORDER = {
  id: 'order-1',
  clinicId: 'clinic-1',
  encounterId: 'enc-1',
  status: 'IN_PROGRESS',
  requestedAt: new Date(),
  noteForLab: null,
  completedAt: null,
  patientNotifiedAt: null,
  requestedByStaff: { name: 'Dr. Amani' },
  completedByStaff: null,
  files: [],
  items: [
    { id: 'i-1', testName: 'Malaria RDT', resultValue: 'Negative', resultUnit: null, resultFlag: 'NORMAL', resultComment: null },
    { id: 'i-2', testName: 'Full blood count', resultValue: null, resultUnit: null, resultFlag: 'ABNORMAL', resultComment: 'Low Hb' },
  ],
  encounter: { patientId: 'p-1', patient: { firstName: 'Jane', lastName: 'W', patientCode: 'ACI-1', dateOfBirth: null, sex: 'FEMALE' } },
};

describe('lab signs the results', () => {
  beforeEach(() => {
    db.labOrder!.findFirst!.mockResolvedValue(OPEN_ORDER);
    db.labOrder!.findUniqueOrThrow!.mockResolvedValue({
      id: 'order-1',
      clinicId: 'clinic-1',
      clinic: { name: 'Sunrise Family Clinic' },
      encounter: { patient: { phoneNumber: '+254712345678', smsOptOut: false, deletedAt: null } },
    });
    mockSms.mockResolvedValue('sent');
  });

  it('needs a result or a flag on every test', async () => {
    db.labOrder!.findFirst!.mockResolvedValue({ ...OPEN_ORDER, items: [{ ...OPEN_ORDER.items[0], resultValue: null, resultFlag: null }] });
    await expect(completeLabOrder({ labOrderId: 'order-1', clinicId: 'clinic-1', staffId: 'lab-1', pin: '1' })).rejects.toMatchObject({ status: 400 });
    expect(mockPin).not.toHaveBeenCalled();
  });

  it('only finds open orders at the lab technician’s own clinic', async () => {
    db.labOrder!.findFirst!.mockResolvedValue(null);
    await expect(completeLabOrder({ labOrderId: 'order-9', clinicId: 'clinic-1', staffId: 'lab-1', pin: '1' })).rejects.toMatchObject({ status: 404 });
    expect(db.labOrder!.findFirst!.mock.calls[0][0].where).toEqual({ id: 'order-9', clinicId: 'clinic-1', status: { in: ['REQUESTED', 'IN_PROGRESS'] } });
  });

  it('wrong PIN: nothing changes and no SMS', async () => {
    mockPin.mockRejectedValue(new InvalidPinError());
    await expect(completeLabOrder({ labOrderId: 'order-1', clinicId: 'clinic-1', staffId: 'lab-1', pin: 'x' })).rejects.toBeInstanceOf(InvalidPinError);
    expect(db.labOrder!.updateMany).not.toHaveBeenCalled();
    expect(mockSms).not.toHaveBeenCalled();
  });

  it('sends the visit back to the doctor’s queue and texts the patient once, without the results', async () => {
    const out = await completeLabOrder({ labOrderId: 'order-1', clinicId: 'clinic-1', staffId: 'lab-1', pin: '1' });
    expect(out).toEqual({ sms: 'sent' });
    expect(db.labOrder!.updateMany!.mock.calls[0][0]).toMatchObject({
      where: { id: 'order-1', status: { in: ['REQUESTED', 'IN_PROGRESS'] } },
      data: { status: 'RESULTS_READY', completedByStaffId: 'lab-1' },
    });
    expect(db.encounter!.updateMany).toHaveBeenCalledWith({ where: { id: 'enc-1', status: 'AWAITING_LAB' }, data: { status: 'WAITING' } });
    const [patient, message, options] = mockSms.mock.calls[0];
    expect(patient).toMatchObject({ phoneNumber: '+254712345678' });
    expect(message).toBe('ACISI: Your lab results at Sunrise Family Clinic are ready. Please go back to the doctor.');
    expect(message).not.toMatch(/Malaria|blood|Negative|Hb/i);
    expect(options).toEqual({ purpose: 'LAB_RESULTS_READY', clinicId: 'clinic-1' });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'LAB_RESULTS_COMPLETED', metadata: { encounterId: 'enc-1', backToDoctor: true } }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'LAB_RESULTS_SMS_SENT' }));
  });

  it('with another lab request still open, the patient stays at the lab and gets no SMS yet', async () => {
    db.labOrder!.count!.mockResolvedValue(1);
    const out = await completeLabOrder({ labOrderId: 'order-1', clinicId: 'clinic-1', staffId: 'lab-1', pin: '1' });
    expect(out).toEqual({ sms: 'not_sent_yet' });
    expect(db.encounter!.updateMany).not.toHaveBeenCalled();
    expect(mockSms).not.toHaveBeenCalled();
  });

  it('respects "does not want SMS"', async () => {
    mockSms.mockResolvedValue('opted_out');
    const out = await completeLabOrder({ labOrderId: 'order-1', clinicId: 'clinic-1', staffId: 'lab-1', pin: '1' });
    expect(out).toEqual({ sms: 'opted_out' });
    expect(db.labOrder!.update).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'LAB_RESULTS_SMS_SKIPPED_OPT_OUT' }));
  });

  it('refuses results for a test that is not part of the order', async () => {
    await expect(
      saveLabResults({ labOrderId: 'order-1', clinicId: 'clinic-1', staffId: 'lab-1', results: [{ itemId: 'someone-elses-item', value: 'x' }] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.labOrderItem!.update).not.toHaveBeenCalled();
  });
});

describe('what the lab sees', () => {
  it('the lab queue asks the database only for name, ACISI ID, age, sex and tests: no phone, no diagnosis', async () => {
    db.labOrder!.findMany!.mockResolvedValue([]);
    await getLabQueue('clinic-1');
    const args = db.labOrder!.findMany!.mock.calls[0][0];
    expect(args.where).toEqual({ clinicId: 'clinic-1', status: { in: ['REQUESTED', 'IN_PROGRESS'] } });
    const patientSelect = args.include.encounter.select.patient.select;
    expect(Object.keys(patientSelect).sort()).toEqual(['dateOfBirth', 'firstName', 'lastName', 'patientCode', 'sex']);
    expect(JSON.stringify(args)).not.toMatch(/diagnosis|prescription|phoneNumber/);
  });

  it('age in whole years', () => {
    expect(ageInYears(new Date('2000-06-15'), new Date('2026-06-14'))).toBe(25);
    expect(ageInYears(new Date('2000-06-15'), new Date('2026-06-15'))).toBe(26);
    expect(ageInYears(null)).toBeNull();
  });
});

describe('the "results ready" SMS', () => {
  it('is one SMS even with a very long clinic name, and is counted against the clinic allowance', () => {
    const sms = buildLabResultsReadySms({ clinicName: 'The Very Long Name Of A Community Health Centre And Maternity Wing In Upper Kiambu County' });
    expect(sms.length).toBeLessThanOrEqual(SINGLE_SMS_MAX_CHARS);
    expect(sms).toMatch(/^ACISI: Your lab results at .+ are ready\. Please go back to the doctor\.$/);
    expect(CLINIC_COUNTED_SMS_PURPOSES).toContain('LAB_RESULTS_READY');
  });
});

describe('the clinic’s test list', () => {
  it('refuses a price that is not whole shillings', async () => {
    await expect(createLabTest({ clinicId: 'c', staffId: 's', name: 'Malaria RDT', priceKes: 12.5 })).rejects.toMatchObject({ status: 400 });
    expect(db.labTest!.create).not.toHaveBeenCalled();
  });
});
