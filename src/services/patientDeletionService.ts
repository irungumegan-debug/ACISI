import { Prisma } from '@prisma/client';
import { REDACTED, redactPhoneNumbers } from '../utils/redactPhoneNumbers';
import { prisma } from '../db/prisma';
import { sendSms } from './smsService';
import { CONSENT_VERSION } from '../config/constants';
import { recordAuditEvent } from './auditService';
import { revokeSessionsFor } from './sessionRevocation';

export class PatientNotFoundError extends Error {
  constructor() {
    super('Patient not found');
    this.name = 'PatientNotFoundError';
  }
}

export type PatientDeletionActor = { type: 'PATIENT' } | { type: 'OWNER'; ownerId: string };

export { redactPhoneNumbers } from '../utils/redactPhoneNumbers';

/**
 * Deletes a patient's account: wipes everything that identifies them (name,
 * phone, email, date of birth, county, PIN, ID document, next of kin, M-Pesa
 * phone numbers), withdraws
 * cross-clinic sharing consent, cancels open appointments, and logs them out
 * everywhere. Their visits, check-ins and payments are kept — now anonymous
 * — so clinics keep their medical and financial records.
 *
 * The phone number is replaced with a unique placeholder, which frees the
 * real number: the same person can register again later as a new patient.
 * Irreversible by design — nothing is kept anywhere that could restore the
 * wiped fields.
 */
export async function deletePatientAccount(patientId: string, actor: PatientDeletionActor): Promise<void> {
  const now = new Date();
  const channel = actor.type === 'OWNER' ? 'OWNER' : 'PORTAL';

  const original = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({ where: { id: patientId } });
    if (!patient || patient.deletedAt) {
      throw new PatientNotFoundError();
    }

    await tx.patient.update({
      where: { id: patientId },
      data: {
        firstName: 'Deleted',
        lastName: 'patient',
        phoneNumber: `deleted-${patientId}`,
        email: null,
        dateOfBirth: null,
        sex: 'UNKNOWN',
        county: null,
        pinHash: null,
        idType: null,
        idNumber: null,
        nextOfKinName: null,
        nextOfKinPhone: null,
        deletedAt: now,
        deletedByType: actor.type,
      },
    });

    await tx.otp.deleteMany({ where: { patientId } });

    // A new row rather than an edit, same as any other revocation — the
    // consent history itself is never rewritten.
    await tx.consent.create({
      data: {
        patientId,
        type: 'CROSS_CLINIC_RECORD_SHARING',
        granted: false,
        channel,
        version: CONSENT_VERSION,
      },
    });

    await tx.appointment.updateMany({
      where: { patientId, status: { in: ['REQUESTED', 'CONFIRMED'] } },
      data: { status: 'CANCELLED', cancelledByType: actor.type, cancelledAt: now },
    });

    const transactions = await tx.mpesaTransaction.findMany({
      where: { checkIn: { patientId } },
      select: { id: true, rawCallbackPayload: true },
    });
    for (const t of transactions) {
      await tx.mpesaTransaction.update({
        where: { id: t.id },
        data: {
          phoneNumber: REDACTED,
          rawCallbackPayload:
            t.rawCallbackPayload === null ? undefined : (redactPhoneNumbers(t.rawCallbackPayload) as Prisma.InputJsonValue),
        },
      });
    }

    // Clinic checkout payments (C14): no phone number kept, and none inside
    // Safaricom's stored reply either.
    const payments = await tx.payment.findMany({
      where: { bill: { encounter: { patientId } } },
      select: { id: true, rawCallbackPayload: true },
    });
    for (const p of payments) {
      await tx.payment.update({
        where: { id: p.id },
        data: {
          phoneNumber: null,
          rawCallbackPayload:
            p.rawCallbackPayload === null ? undefined : (redactPhoneNumbers(p.rawCallbackPayload) as Prisma.InputJsonValue),
        },
      });
    }

    return { phoneNumber: patient.phoneNumber };
  });

  await revokeSessionsFor(`patient:${patientId}`);

  await recordAuditEvent({
    actorType: actor.type,
    actorId: actor.type === 'OWNER' ? actor.ownerId : patientId,
    action: 'PATIENT_ACCOUNT_DELETED',
    entityType: 'Patient',
    entityId: patientId,
    metadata: { channel },
  });

  // Best-effort and essential (goes even if they had opted out): the
  // deletion has already happened, and this is the last time the real
  // number is ever used.
  await sendSms(
    original.phoneNumber,
    'ACISI: Your account has been deleted and your personal details removed. To use ACISI again, simply register as a new patient.',
    'ACCOUNT_DELETED',
  );
}
