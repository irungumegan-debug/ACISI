import { prisma } from '../db/prisma';

/**
 * Demo clinics (Clinic.isDemo) exist to show ACISI to a prospective clinic.
 * Their seeded patients and staff are fake people with made-up numbers, so
 * nothing ACISI sends may ever reach those numbers: no SMS, no M-Pesa
 * prompt. Who counts as a demo recipient is decided by the database alone —
 * never by the shape of the number, since the numbers the seed uses are in a
 * real Safaricom range a real person could one day hold:
 *
 * - a patient with demoClinicId set (created by a demo seed, or registered
 *   as a walk-in at a demo clinic), or
 * - a staff member of a demo clinic.
 *
 * A real patient checking in at a demo clinic (the presenter's own phone,
 * during the demo) is not a demo recipient: they get the M-Pesa prompt,
 * receipt and visit summary like anywhere else.
 */

/** The check-in fee at a demo clinic, used for the presenter's live check-in during a demo. */
export const DEMO_CHECKIN_FEE_KES = 150;

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

/** Thrown instead of sending an M-Pesa prompt to a demo patient or staff member. */
export class DemoRecipientError extends Error {
  constructor() {
    super('Demo patients never receive M-Pesa prompts');
    this.name = 'DemoRecipientError';
  }
}
