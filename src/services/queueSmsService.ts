import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { buildQueueNextSms } from './smsTemplates';
import { sendSms } from './smsSender';

/**
 * The walk-in "you're next" SMS. The "you are number N" SMS on joining is
 * sent by walkInService; this one goes out once a walk-in reaches the front
 * of their department's waiting list.
 */

/**
 * Called whenever someone leaves the waiting list of a department (a
 * doctor opens their visit): if the patient now first in line is a walk-in
 * who got a queue SMS, send them one "you're next" SMS. At most once per
 * visit (claimed atomically). Never throws.
 */
export async function notifyNextInQueue(clinicId: string, departmentId: string): Promise<void> {
  try {
    const next = await prisma.encounter.findFirst({
      where: { clinicId, status: 'WAITING', checkIn: { departmentId } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        queueJoinSmsAt: true,
        queueNextSmsAt: true,
        checkIn: { select: { source: true } },
        patient: { select: { id: true, phoneNumber: true, smsOptOut: true, deletedAt: true } },
        clinic: { select: { name: true } },
      },
    });
    if (!next || next.checkIn.source !== 'WALK_IN' || !next.queueJoinSmsAt || next.queueNextSmsAt) return;
    if (next.patient.smsOptOut || next.patient.deletedAt) return;
    const claimed = await prisma.encounter.updateMany({ where: { id: next.id, queueNextSmsAt: null }, data: { queueNextSmsAt: new Date() } });
    if (claimed.count === 0) return;
    const ok = await sendSms(next.patient.phoneNumber, buildQueueNextSms(next.clinic.name), { purpose: 'queue-next', patientId: next.patient.id });
    if (ok) {
      await recordAuditEvent({
        actorType: 'SYSTEM',
        clinicId,
        patientId: next.patient.id,
        action: 'QUEUE_NEXT_SMS_SENT',
        entityType: 'Encounter',
        entityId: next.id,
      });
    }
  } catch {
    // Best effort only — the queue itself is unaffected.
  }
}

/** Same, given the visit that just left the waiting list (a doctor opened it). Never throws. */
export async function notifyNextInQueueAfter(encounterId: string): Promise<void> {
  try {
    const left = await prisma.encounter.findUnique({ where: { id: encounterId }, select: { clinicId: true, checkIn: { select: { departmentId: true } } } });
    if (left) await notifyNextInQueue(left.clinicId, left.checkIn.departmentId);
  } catch {
    // Best effort only.
  }
}
