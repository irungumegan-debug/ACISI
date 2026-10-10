import { prisma } from '../db/prisma';

/**
 * Demo clinics (Clinic.isDemo) exist to show ACISI to a prospective clinic.
 * Three rules keep them apart from real data and real people:
 *
 * 1. Nothing is ever sent to a demo recipient: no SMS, no M-Pesa prompt, no
 *    email. Who counts is decided by the database alone — a patient with
 *    demoClinicId set, or a staff member of a demo clinic — never by the
 *    shape of the number, since 0700 000 0xx is a real Safaricom range.
 * 2. Payments at a demo clinic are simulated (see simulateCheckInPayment and
 *    billingService.requestStkPayment): nothing is charged, nothing can fail
 *    live in front of the clinic.
 * 3. A demo clinic serves only its own demo patients, and a demo patient can
 *    only check in or book at their own demo clinic (assertDemoBoundary), so
 *    a real patient never gets a demo visit and a real clinic never sees a
 *    fake patient.
 */

/** The ACISI check-in fee shown (and simulated) at a demo clinic. */
export const DEMO_CHECKIN_FEE_KES = 100;

export async function isDemoRecipient(phoneNumberE164: string): Promise<boolean> {
  const [patient, staff] = await Promise.all([
    prisma.patient.findFirst({
      where: { phoneNumber: phoneNumberE164, demoClinicId: { not: null } },
      select: { id: true },
    }),
    prisma.staff.findFirst({
      where: { phoneNumber: phoneNumberE164, clinic: { isDemo: true } },
      select: { id: true },
    }),
  ]);
  return Boolean(patient || staff);
}

export async function isDemoClinic(clinicId: string): Promise<boolean> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { isDemo: true } });
  return clinic?.isDemo ?? false;
}

/** Thrown instead of sending an M-Pesa prompt to a demo patient or staff member. */
export class DemoRecipientError extends Error {
  constructor() {
    super('Demo patients never receive M-Pesa prompts');
    this.name = 'DemoRecipientError';
  }
}

/** A real patient at a demo clinic, or a demo patient anywhere but their own demo clinic. */
export class DemoBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoBoundaryError';
  }
}

export const DEMO_CLINIC_REAL_PATIENT_MESSAGE =
  'This is a demo clinic. Only its demo patients can check in here; sign in with a demo patient account.';
export const DEMO_PATIENT_REAL_CLINIC_MESSAGE =
  'This is a demo patient account. It can only be used at its demo clinic.';

/**
 * Throws DemoBoundaryError unless this patient may have a visit or booking
 * at this clinic: a real patient at a real clinic, or a demo patient at the
 * demo clinic they belong to.
 */
export async function assertDemoBoundary(patientId: string, clinicId: string): Promise<void> {
  const [patient, clinic] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId }, select: { demoClinicId: true } }),
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { isDemo: true } }),
  ]);
  if (!patient || !clinic) return; // the caller's own "not found" handling applies
  if (patient.demoClinicId === null && clinic.isDemo)
    throw new DemoBoundaryError(DEMO_CLINIC_REAL_PATIENT_MESSAGE);
  if (patient.demoClinicId !== null && patient.demoClinicId !== clinicId) {
    throw new DemoBoundaryError(DEMO_PATIENT_REAL_CLINIC_MESSAGE);
  }
}
