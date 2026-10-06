import { LegalAcceptanceContext, LegalDocument, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { PRIVACY_NOTICE_VERSION, TERMS_OF_SERVICE_VERSION } from '../config/legal';

/**
 * Acceptance of the Terms of Service and acknowledgment of the Privacy
 * Notice. Rows are only ever added (see LegalAcceptance in schema.prisma);
 * "has this person accepted?" always means "is there a row for the
 * *current* version?", so bumping a version in config/legal.ts asks again.
 */

export const CURRENT_LEGAL_VERSIONS: Readonly<Record<LegalDocument, string>> = {
  PRIVACY_NOTICE: PRIVACY_NOTICE_VERSION,
  TERMS_OF_SERVICE: TERMS_OF_SERVICE_VERSION,
};

type Db = Prisma.TransactionClient | typeof prisma;

export interface LegalAcceptanceParties {
  patientId?: string;
  staffId?: string;
  clinicId?: string;
  checkInId?: string;
}

/** Records acceptance of the current version of each document, all with the same context and parties. */
export async function recordLegalAcceptances(
  documents: LegalDocument[],
  context: LegalAcceptanceContext,
  parties: LegalAcceptanceParties,
  db: Db = prisma,
): Promise<void> {
  await db.legalAcceptance.createMany({
    data: documents.map((document) => ({ document, version: CURRENT_LEGAL_VERSIONS[document], context, ...parties })),
  });
}

async function hasCurrent(document: LegalDocument, where: Prisma.LegalAcceptanceWhereInput): Promise<boolean> {
  const row = await prisma.legalAcceptance.findFirst({
    where: { ...where, document, version: CURRENT_LEGAL_VERSIONS[document] },
    select: { id: true },
  });
  return row !== null;
}

/** A patient must accept the current Terms (signup, or the one-time screen after portal login). */
export async function patientNeedsTermsAcceptance(patientId: string): Promise<boolean> {
  return !(await hasCurrent('TERMS_OF_SERVICE', {
    patientId,
    context: { in: ['PATIENT_SIGNUP', 'PATIENT_PORTAL_LOGIN'] },
  }));
}

/**
 * Web check-in: asked once per patient per clinic (and again for a new
 * Privacy Notice version). Only the patient's own acknowledgment counts
 * here — a front-desk confirmation at a walk-in is not the patient ticking
 * the box themselves.
 */
export async function patientNeedsWebCheckInPrivacyAck(patientId: string, clinicId: string): Promise<boolean> {
  return !(await hasCurrent('PRIVACY_NOTICE', { patientId, clinicId, context: 'PATIENT_WEB_CHECKIN' }));
}

/**
 * Walk-in: asked at the patient's first walk-in at this clinic (and again
 * for a new Privacy Notice version). Not needed if the patient has already
 * acknowledged the current notice for this clinic themselves on the web.
 */
export async function walkInNeedsPrivacyAck(patientId: string, clinicId: string): Promise<boolean> {
  return !(await hasCurrent('PRIVACY_NOTICE', {
    patientId,
    clinicId,
    context: { in: ['WALK_IN_CHECKIN', 'PATIENT_WEB_CHECKIN'] },
  }));
}

/** Staff (including the clinic admin, who accepts at registration) must accept the current Terms. */
export async function staffNeedsTermsAcceptance(staffId: string): Promise<boolean> {
  return !(await hasCurrent('TERMS_OF_SERVICE', {
    staffId,
    context: { in: ['CLINIC_REGISTRATION', 'STAFF_LOGIN'] },
  }));
}
