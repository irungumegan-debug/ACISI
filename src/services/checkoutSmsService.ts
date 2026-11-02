import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { formatKenyaDate } from '../utils/kenyaTime';
import { recordAuditEvent } from './auditService';
import { sendPatientSms } from './smsService';
import { buildCheckoutSms } from './smsTemplates';

export type CheckoutSmsOutcome = 'sent' | 'opted_out' | 'failed';

/**
 * The one SMS a patient gets at checkout: receipt and visit summary
 * together (clinic, visit date, amount and method, prescription; never the
 * diagnosis or department). See smsTemplates.buildCheckoutSms.
 *
 * Called once, by encounterService.checkoutEncounter, after the visit has
 * moved to DONE (a conditional update, so a double click can't send two).
 * Respects "does not want SMS". When the bill is fully paid, it also counts
 * as the bill's receipt (receiptSmsSentAt), so no separate receipt follows.
 * Never throws: a failed SMS must not undo the checkout.
 */
export async function sendCheckoutSms(encounterId: string): Promise<CheckoutSmsOutcome> {
  try {
    const encounter = await prisma.encounter.findUniqueOrThrow({
      where: { id: encounterId },
      select: {
        id: true,
        clinicId: true,
        createdAt: true,
        prescription: true,
        clinic: { select: { name: true } },
        patient: { select: { id: true, phoneNumber: true, smsOptOut: true, deletedAt: true } },
        bill: {
          select: {
            id: true,
            status: true,
            totalKes: true,
            paidKes: true,
            payments: {
              where: { status: 'SUCCEEDED' },
              orderBy: { completedAt: 'asc' },
              select: { method: true, mpesaReceiptNumber: true, reference: true },
            },
          },
        },
      },
    });

    if (encounter.patient.smsOptOut || encounter.patient.deletedAt) {
      await recordAuditEvent({ actorType: 'SYSTEM', action: 'CHECKOUT_SMS_SKIPPED_OPT_OUT', entityType: 'Encounter', entityId: encounter.id, clinicId: encounter.clinicId });
      return 'opted_out';
    }

    const bill = encounter.bill;
    const message = buildCheckoutSms({
      clinicName: encounter.clinic.name,
      date: formatKenyaDate(encounter.createdAt),
      bill: bill
        ? {
            totalKes: bill.totalKes,
            paidKes: bill.paidKes,
            payments: bill.payments.map((p) => ({ method: p.method, reference: p.mpesaReceiptNumber ?? p.reference })),
          }
        : null,
      prescription: encounter.prescription,
    });

    const outcome = await sendPatientSms(encounter.patient, message, { purpose: 'CHECKOUT_SUMMARY', clinicId: encounter.clinicId });
    if (outcome !== 'sent') return 'failed';

    // A fully paid bill's receipt was in this SMS: never send it again.
    if (bill && bill.status === 'PAID') {
      await prisma.bill.updateMany({ where: { id: bill.id, receiptSmsSentAt: null }, data: { receiptSmsSentAt: new Date() } });
    }
    await recordAuditEvent({ actorType: 'SYSTEM', action: 'CHECKOUT_SMS_SENT', entityType: 'Encounter', entityId: encounter.id, clinicId: encounter.clinicId });
    return 'sent';
  } catch (err) {
    logger.error({ err, encounterId }, 'Failed to send checkout SMS');
    return 'failed';
  }
}
