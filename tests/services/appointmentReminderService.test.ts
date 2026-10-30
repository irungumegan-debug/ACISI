jest.mock('../../src/db/prisma', () => ({
  prisma: { appointment: { findMany: jest.fn(), updateMany: jest.fn() } },
}));
jest.mock('../../src/services/smsService', () => ({ sendPatientSms: jest.fn(async () => 'sent') }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { sendPatientSms } from '../../src/services/smsService';
import { recordAuditEvent } from '../../src/services/auditService';
import { sendDueAppointmentReminders } from '../../src/services/appointmentReminderService';
import { buildAppointmentReminderSms, smsPartCount } from '../../src/services/smsTemplates';

const findMany = prisma.appointment.findMany as jest.Mock;
const updateMany = prisma.appointment.updateMany as jest.Mock;

const APPT = {
  id: 'a1',
  clinicId: 'c1',
  scheduledFor: new Date('2026-10-31T07:00:00Z'), // 10:00 in Kenya
  patient: { phoneNumber: '+254712345678', smsOptOut: false, deletedAt: null },
  clinic: { name: 'Sunrise Family Clinic' },
};

beforeEach(() => {
  jest.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
});

describe('appointment reminder SMS (C12)', () => {
  it('message: clinic, day and time only, one SMS, no health details', () => {
    const text = buildAppointmentReminderSms({ clinicName: 'Sunrise Family Clinic', scheduledFor: APPT.scheduledFor });
    expect(text).toBe('ACISI: Reminder of your appointment at Sunrise Family Clinic on Sat 31 Oct at 10:00.');
    expect(smsPartCount(text)).toBe(1);
    const long = buildAppointmentReminderSms({ clinicName: 'X'.repeat(300), scheduledFor: APPT.scheduledFor });
    expect(smsPartCount(long)).toBe(1);
  });

  it('does nothing before 09:00 Kenya time', async () => {
    const result = await sendDueAppointmentReminders(new Date('2026-10-30T05:59:00Z')); // 08:59 EAT
    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('from 09:00 the day before, sends for CONFIRMED appointments tomorrow that have not had one', async () => {
    findMany.mockResolvedValue([APPT]);
    const result = await sendDueAppointmentReminders(new Date('2026-10-30T06:00:00Z')); // 09:00 EAT
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: 'CONFIRMED',
      reminderSmsSentAt: null,
      scheduledFor: { gte: new Date('2026-10-30T21:00:00Z'), lt: new Date('2026-10-31T21:00:00Z') },
    });
    expect(result.sent).toBe(1);
    const [patient, , options] = (sendPatientSms as jest.Mock).mock.calls[0];
    expect(patient).toBe(APPT.patient);
    expect(options).toEqual({ purpose: 'APPOINTMENT_REMINDER', clinicId: 'c1' });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPOINTMENT_REMINDER_SMS_SENT', entityId: 'a1', clinicId: 'c1' }));
  });

  it('respects "does not want SMS" (non-essential) and records that it was not sent', async () => {
    findMany.mockResolvedValue([{ ...APPT, patient: { ...APPT.patient, smsOptOut: true } }]);
    (sendPatientSms as jest.Mock).mockResolvedValue('opted_out');
    const result = await sendDueAppointmentReminders(new Date('2026-10-30T06:00:00Z'));
    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect((sendPatientSms as jest.Mock).mock.calls[0][2].essential).toBeFalsy();
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPOINTMENT_REMINDER_SMS_NOT_SENT', metadata: { outcome: 'opted_out' } }));
  });

  it('never sends twice: an appointment already claimed by another run is skipped', async () => {
    findMany.mockResolvedValue([APPT]);
    updateMany.mockResolvedValue({ count: 0 });
    await sendDueAppointmentReminders(new Date('2026-10-30T06:00:00Z'));
    expect(sendPatientSms).not.toHaveBeenCalled();
  });
});
