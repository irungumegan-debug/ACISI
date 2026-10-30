import { prisma } from '../db/prisma';
import { APPOINTMENT_REMINDER_HOUR } from '../config/constants';
import { kenyaDayRange, kenyaToday } from '../utils/kenyaTime';
import { buildAppointmentReminderSms } from './smsTemplates';
import { sendPatientSms } from './smsService';
import { recordAuditEvent } from './auditService';

const DAY_MS = 24 * 60 * 60 * 1000;
const KENYA_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Sends the day-before reminder for every CONFIRMED appointment tomorrow
 * (Kenya dates) that hasn't had one yet. Runs every hour; does nothing
 * before APPOINTMENT_REMINDER_HOUR, so reminders go out at 09:00, and one
 * confirmed later in the day goes out at the next hourly run. Each
 * appointment is claimed (reminderSmsSentAt) before sending, so it is
 * never reminded twice. Respects "does not want SMS"; nothing goes to a
 * deleted account.
 */
export async function sendDueAppointmentReminders(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const kenyaHour = new Date(now.getTime() + KENYA_OFFSET_MS).getUTCHours();
  if (kenyaHour < APPOINTMENT_REMINDER_HOUR) return { sent: 0, skipped: 0 };

  const tomorrow = kenyaDayRange(kenyaToday(new Date(now.getTime() + DAY_MS)));
  const due = await prisma.appointment.findMany({
    where: { status: 'CONFIRMED', reminderSmsSentAt: null, scheduledFor: { gte: tomorrow.start, lt: tomorrow.end } },
    include: { patient: { select: { phoneNumber: true, smsOptOut: true, deletedAt: true } }, clinic: { select: { name: true } } },
  });

  let sent = 0;
  let skipped = 0;
  for (const appointment of due) {
    const claimed = await prisma.appointment.updateMany({
      where: { id: appointment.id, reminderSmsSentAt: null, status: 'CONFIRMED' },
      data: { reminderSmsSentAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const outcome = await sendPatientSms(
      appointment.patient,
      buildAppointmentReminderSms({ clinicName: appointment.clinic.name, scheduledFor: appointment.scheduledFor }),
      { purpose: 'APPOINTMENT_REMINDER', clinicId: appointment.clinicId },
    );
    if (outcome === 'sent') sent += 1;
    else skipped += 1;

    await recordAuditEvent({
      actorType: 'SYSTEM',
      clinicId: appointment.clinicId,
      action: outcome === 'sent' ? 'APPOINTMENT_REMINDER_SMS_SENT' : 'APPOINTMENT_REMINDER_SMS_NOT_SENT',
      entityType: 'Appointment',
      entityId: appointment.id,
      metadata: { outcome },
    });
  }
  return { sent, skipped };
}
