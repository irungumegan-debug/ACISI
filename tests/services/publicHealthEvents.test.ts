jest.mock('../../src/db/prisma', () => ({
  prisma: {
    publicHealthEvent: { create: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    clinic: { findUnique: jest.fn(async () => ({ name: 'Sunrise Clinic' })) },
    staff: { findMany: jest.fn(async () => [{ phoneNumber: '+254700000001' }, { phoneNumber: '+254700000002' }]) },
  },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/smsService', () => ({ sendSms: jest.fn(async () => 'sent') }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { sendSms } from '../../src/services/smsService';
import { buildHealthEventAlertSms } from '../../src/services/smsTemplates';
import { NOTIFIABLE_DISEASES } from '../../src/services/notifiableDiseases';
import {
  countUnreportedEvents,
  EVENT_FORM_ROWS,
  EVENT_TYPES,
  EventNotFoundError,
  InvalidEventError,
  markEventReported,
  recordEventSchema,
  recordPublicHealthEvent,
} from '../../src/services/publicHealthEventService';

const db = prisma as unknown as {
  publicHealthEvent: Record<'create' | 'updateMany' | 'findFirst' | 'count' | 'findMany', jest.Mock>;
  staff: { findMany: jest.Mock };
};
const NOW = new Date('2026-11-14T10:00:00Z');
const flush = () => new Promise((r) => setImmediate(r));
const base = { clinicId: 'clinic-1', staffId: 'staff-1', casesCount: 4, casesUnder5: 1, deathsCount: 0, deathsUnder5: 0, eventDescription: 'Vomiting after a wedding meal', eventPlace: null };

beforeEach(() => {
  jest.clearAllMocks();
  db.publicHealthEvent.create.mockImplementation(async ({ data }) => ({ id: 'ev-1', ...data }));
});

describe('event types', () => {
  it('every type maps to a real MOH 505 row', () => {
    const ids = new Set(NOTIFIABLE_DISEASES.map((d) => d.id));
    for (const t of Object.keys(EVENT_TYPES)) expect(ids.has(EVENT_FORM_ROWS[t as keyof typeof EVENT_FORM_ROWS].diseaseId)).toBe(true);
  });

  it('death types are counted as deaths; neonatal and malaria deaths are weekly, the rest immediate', () => {
    for (const t of ['MATERNAL_DEATH', 'NEONATAL_DEATH', 'MALARIA_DEATH'] as const) expect(EVENT_FORM_ROWS[t].count).toBe('deaths');
    const weekly = Object.entries(EVENT_TYPES).filter(([, v]) => !v.immediate).map(([k]) => k);
    expect(weekly.sort()).toEqual(['MALARIA_DEATH', 'NEONATAL_DEATH']);
  });
});

describe('validation', () => {
  const parse = (o: object) => recordEventSchema.safeParse({ type: 'ILLNESS_CLUSTER', detectedOn: '2026-11-13', eventDescription: 'Five people with diarrhoea', ...o });
  it('needs someone affected, and under-5 counts within the totals', () => {
    expect(parse({ casesCount: 0, deathsCount: 0 }).success).toBe(false);
    expect(parse({ casesCount: 2, casesUnder5: 3 }).success).toBe(false);
    expect(parse({ deathsCount: 1, deathsUnder5: 2 }).success).toBe(false);
    expect(parse({ casesCount: 2, casesUnder5: 2 }).success).toBe(true);
    expect(parse({ casesCount: -1 }).success).toBe(false);
    expect(parse({ casesCount: 1.5 }).success).toBe(false);
    expect(parse({ casesCount: 1, eventDescription: 'x' }).success).toBe(false);
  });

  it('refuses an impossible or future date, and a death event without deaths', async () => {
    await expect(recordPublicHealthEvent({ ...base, type: 'AEFI', detectedOn: '2026-02-30' }, NOW)).rejects.toBeInstanceOf(InvalidEventError);
    await expect(recordPublicHealthEvent({ ...base, type: 'AEFI', detectedOn: '2026-11-15' }, NOW)).rejects.toThrow('future');
    await expect(recordPublicHealthEvent({ ...base, type: 'MATERNAL_DEATH', detectedOn: '2026-11-14' }, NOW)).rejects.toThrow('deaths');
    expect(db.publicHealthEvent.create).not.toHaveBeenCalled();
  });

  it('"today" is Kenya time: 23:30 EAT on the 14th is still the 14th', async () => {
    await expect(recordPublicHealthEvent({ ...base, type: 'AEFI', detectedOn: '2026-11-14' }, new Date('2026-11-14T20:30:00Z'))).resolves.toBeTruthy();
  });
});

describe('recording', () => {
  it('an immediate event is saved, audit-logged and SMS-alerts admins and doctors without details', async () => {
    await recordPublicHealthEvent({ ...base, type: 'ILLNESS_CLUSTER', detectedOn: '2026-11-13' }, NOW);
    await flush();
    expect(db.publicHealthEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clinicId: 'clinic-1', recordedByStaffId: 'staff-1', casesCount: 4 }) });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'PUBLIC_HEALTH_EVENT_RECORDED', entityId: 'ev-1', metadata: { type: 'ILLNESS_CLUSTER', immediate: true } }));
    expect(db.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clinicId: 'clinic-1', isActive: true, role: { in: ['ADMIN', 'DOCTOR'] } } }));
    expect(sendSms).toHaveBeenCalledTimes(2);
    const message = (sendSms as jest.Mock).mock.calls[0][1] as string;
    expect(message).not.toContain('wedding');
    expect((sendSms as jest.Mock).mock.calls[0][2]).toBe('PUBLIC_HEALTH_EVENT_ALERT');
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'PUBLIC_HEALTH_EVENT_ALERT_SENT', metadata: { recipients: 2, sent: 2 } }));
    // The audit log never carries the description.
    expect(JSON.stringify((recordAuditEvent as jest.Mock).mock.calls)).not.toContain('wedding');
  });

  it('a weekly event (neonatal death) sends no SMS', async () => {
    await recordPublicHealthEvent({ ...base, type: 'NEONATAL_DEATH', casesCount: 0, casesUnder5: 0, deathsCount: 1, deathsUnder5: 1, detectedOn: '2026-11-13' }, NOW);
    await flush();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('a failing SMS never fails the recording', async () => {
    db.staff.findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(recordPublicHealthEvent({ ...base, type: 'AEFI', detectedOn: '2026-11-13' }, NOW)).resolves.toBeTruthy();
    await flush();
  });
});

describe('marking reported', () => {
  it('records once, scoped to the clinic, and audit-logs', async () => {
    db.publicHealthEvent.updateMany.mockResolvedValueOnce({ count: 1 });
    await markEventReported({ eventId: 'ev-1', clinicId: 'clinic-1', staffId: 'staff-2', note: '  SCDSC by phone ' });
    expect(db.publicHealthEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'ev-1', clinicId: 'clinic-1', reportedAt: null },
      data: expect.objectContaining({ reportedByStaffId: 'staff-2', reportNote: 'SCDSC by phone' }),
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'PUBLIC_HEALTH_EVENT_REPORTED' }));
  });

  it('already reported: no second audit row; another clinic\'s event: not found', async () => {
    db.publicHealthEvent.updateMany.mockResolvedValue({ count: 0 });
    db.publicHealthEvent.findFirst.mockResolvedValueOnce({ id: 'ev-1' });
    await markEventReported({ eventId: 'ev-1', clinicId: 'clinic-1', staffId: 'staff-2' });
    expect(recordAuditEvent).not.toHaveBeenCalled();
    db.publicHealthEvent.findFirst.mockResolvedValueOnce(null);
    await expect(markEventReported({ eventId: 'ev-x', clinicId: 'clinic-1', staffId: 'staff-2' })).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it('the badge counts unreported immediate events only', async () => {
    db.publicHealthEvent.count.mockResolvedValueOnce(3);
    expect(await countUnreportedEvents('clinic-1')).toBe(3);
    const where = db.publicHealthEvent.count.mock.calls[0][0].where;
    expect(where.reportedAt).toBeNull();
    expect(where.type.in).not.toContain('NEONATAL_DEATH');
    expect(where.type.in).toContain('AEFI');
  });
});

describe('alert SMS', () => {
  it('fits one SMS even with a long clinic name', () => {
    const m = buildHealthEventAlertSms({ clinicName: 'A very long clinic name that goes on and on and on and on, Westlands branch, Nairobi' });
    expect(m.length).toBeLessThanOrEqual(160);
    expect(m).toMatch(/^ACISI: A public health event was recorded at .+\. Report within 24h\./);
  });
});
