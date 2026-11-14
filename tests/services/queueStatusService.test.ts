jest.mock('../../src/db/prisma', () => ({
  prisma: { encounter: { count: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() } },
}));
jest.mock('../../src/services/smsService', () => ({ sendPatientSms: jest.fn(async () => 'sent') }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { sendPatientSms } from '../../src/services/smsService';
import { recordAuditEvent } from '../../src/services/auditService';
import { getVisitsToday, queuePositionFor, sendNearlyNextSms } from '../../src/services/queueStatusService';
import { buildCheckInFeeSms, buildNearlyNextSms, SINGLE_SMS_MAX_CHARS } from '../../src/services/smsTemplates';

const count = prisma.encounter.count as jest.Mock;
const findMany = prisma.encounter.findMany as jest.Mock;
const updateMany = prisma.encounter.updateMany as jest.Mock;
const sms = sendPatientSms as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('place in the queue', () => {
  const enc = { id: 'e1', clinicId: 'c1', status: 'WAITING', assignedDoctorId: null, createdAt: new Date('2026-11-14T08:00:00Z') };

  it('counts earlier waiting visits in the same clinic and department, plus this one', async () => {
    count.mockResolvedValue(2);
    expect(await queuePositionFor(enc, 'd1')).toBe(3);
    expect(count.mock.lastCall[0].where).toMatchObject({ clinicId: 'c1', status: 'WAITING', createdAt: { lt: enc.createdAt }, checkIn: { departmentId: 'd1' } });
  });

  it('a patient routed to one doctor only counts that doctor\'s queue (and unassigned visits)', async () => {
    count.mockResolvedValue(0);
    await queuePositionFor({ ...enc, assignedDoctorId: 'doc-1' }, 'd1');
    expect(count.mock.lastCall[0].where.OR).toEqual([{ assignedDoctorId: 'doc-1' }, { assignedDoctorId: null }]);
  });

  it('no number once the patient is no longer waiting', async () => {
    expect(await queuePositionFor({ ...enc, status: 'IN_CONSULTATION' }, 'd1')).toBeNull();
    expect(count).not.toHaveBeenCalled();
  });
});

describe('my visit today', () => {
  const base = {
    id: 'e1',
    clinicId: 'c1',
    assignedDoctorId: null,
    createdAt: new Date(),
    clinic: { name: 'Jangwani Health' },
    checkIn: { departmentId: 'd1', status: 'NO_FEE', feeSettledAt: null, department: { name: 'General' } },
    labOrders: [],
  };

  it('shows any check-in channel with its stage and live number', async () => {
    findMany.mockResolvedValue([
      { ...base, status: 'WAITING' },
      { ...base, id: 'e2', status: 'WAITING', labOrders: [{ id: 'lo' }] },
      { ...base, id: 'e3', status: 'IN_CONSULTATION' },
      { ...base, id: 'e4', status: 'AWAITING_LAB' },
      { ...base, id: 'e5', status: 'READY_FOR_CHECKOUT', checkIn: { ...base.checkIn, status: 'PENDING_PAYMENT' } },
    ]);
    count.mockResolvedValue(3);
    const v = await getVisitsToday('p1');
    expect(v.map((x) => [x.stage, x.queuePosition, x.feePending])).toEqual([
      ['WAITING', 4, false],
      ['BACK_FROM_LAB', 4, false],
      ['WITH_DOCTOR', null, false],
      ['AT_LAB', null, false],
      ['READY_FOR_CHECKOUT', null, true],
    ]);
    expect(findMany.mock.lastCall[0].where).toMatchObject({ patientId: 'p1', status: { in: ['WAITING', 'IN_CONSULTATION', 'AWAITING_LAB', 'READY_FOR_CHECKOUT'] } });
  });
});

describe('"you\'re nearly next" SMS', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  const cand = (id: string) => ({
    id,
    clinicId: 'c1',
    status: 'WAITING',
    assignedDoctorId: null,
    createdAt: new Date('2026-11-14T09:30:00Z'),
    clinic: { name: 'Jangwani Health' },
    checkIn: { departmentId: 'd1' },
    patient: { phoneNumber: '+254700000000', smsOptOut: false, deletedAt: null },
  });

  it('only patients waiting 10+ minutes who have not had it are considered', async () => {
    findMany.mockResolvedValue([]);
    await sendNearlyNextSms(now);
    const where = findMany.mock.lastCall[0].where;
    expect(where).toMatchObject({ status: 'WAITING', nearlyNextSmsAt: null });
    expect(where.createdAt.lte).toEqual(new Date('2026-11-14T09:50:00Z'));
  });

  it('sends once to 2 or fewer ahead, claims it first, counts it for the clinic and audits it; skips 3+ ahead', async () => {
    findMany.mockResolvedValue([cand('near'), cand('far')]);
    count.mockResolvedValueOnce(2).mockResolvedValueOnce(3); // near: number 3 (2 ahead); far: number 4
    updateMany.mockResolvedValue({ count: 1 });
    expect(await sendNearlyNextSms(now)).toEqual({ sent: 1, skipped: 0 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.lastCall[0]).toEqual({ where: { id: 'near', nearlyNextSmsAt: null, status: 'WAITING' }, data: { nearlyNextSmsAt: now } });
    expect(sms).toHaveBeenCalledWith(expect.anything(), 'ACISI: 2 people are ahead of you at Jangwani Health. Please make your way there.', {
      purpose: 'QUEUE_NEARLY_NEXT',
      clinicId: 'c1',
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'QUEUE_NEARLY_NEXT_SMS', entityId: 'near', metadata: { outcome: 'sent', peopleAhead: 2 } }));
  });

  it('never sends twice (another sweep already claimed it)', async () => {
    findMany.mockResolvedValue([cand('near')]);
    count.mockResolvedValue(0);
    updateMany.mockResolvedValue({ count: 0 });
    expect(await sendNearlyNextSms(now)).toEqual({ sent: 0, skipped: 0 });
    expect(sms).not.toHaveBeenCalled();
  });

  it('"does not want SMS" is respected (counted as skipped)', async () => {
    findMany.mockResolvedValue([cand('near')]);
    count.mockResolvedValue(0);
    updateMany.mockResolvedValue({ count: 1 });
    sms.mockResolvedValueOnce('opted_out');
    expect(await sendNearlyNextSms(now)).toEqual({ sent: 0, skipped: 1 });
  });
});

describe('SMS wording', () => {
  const long = 'A very long clinic name that goes on and on and on, Westlands and Kilimani branch';
  it('nearly next: one SMS, no department or medical words', () => {
    expect(buildNearlyNextSms({ clinicName: 'Jangwani Health', peopleAhead: 0 })).toBe('ACISI: You are next at Jangwani Health. Please be ready.');
    expect(buildNearlyNextSms({ clinicName: 'Jangwani Health', peopleAhead: 1 })).toBe('ACISI: 1 person is ahead of you at Jangwani Health. Please make your way there.');
    for (const n of [0, 1, 2]) expect(buildNearlyNextSms({ clinicName: long, peopleAhead: n }).length).toBeLessThanOrEqual(SINGLE_SMS_MAX_CHARS);
  });

  it('remote check-in confirmation adds the number when already in the queue', () => {
    expect(buildCheckInFeeSms({ clinicName: 'Jangwani Health', amountKes: 100, paid: true, queuePosition: 4 })).toBe(
      'ACISI: Check-in confirmed at Jangwani Health.\nPayment confirmed: KES 100.\nYou are number 4 in the queue.',
    );
    expect(buildCheckInFeeSms({ clinicName: 'Jangwani Health', amountKes: 100, paid: true, queuePosition: 1 })).toContain('You are next in line.');
    expect(buildCheckInFeeSms({ clinicName: long, amountKes: 100, paid: true, queuePosition: 12 }).length).toBeLessThanOrEqual(SINGLE_SMS_MAX_CHARS);
    expect(buildCheckInFeeSms({ clinicName: 'Jangwani Health', amountKes: 100, paid: true })).not.toContain('queue');
  });
});
