import { PrismaClient } from '@prisma/client';
import { toE164 } from '../src/utils/phone';

const prisma = new PrismaClient();

/**
 * Dev-only helper for testing the staff dashboard queue without a real
 * M-Pesa sandbox account. With placeholder Daraja credentials, a check-in
 * never even reaches PENDING_PAYMENT — checkInService.initiateCheckIn's STK
 * push call throws immediately and the CheckIn is marked FAILED — so there's
 * nothing for a "flip existing row to PAID" script to flip without this.
 *
 * This does the same two writes checkInService.applyPaymentResult does on a
 * real successful Daraja callback (mark PAID, create the Encounter that
 * makes it show up in the queue), just triggered by hand instead of a
 * webhook. It does NOT send an SMS receipt or hit any external API.
 *
 * Usage:
 *   npm run dev:mark-paid -- 0712345678
 *   npm run dev:mark-paid -- <checkInId>
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run devMarkCheckInPaid against a production environment.');
    process.exit(1);
  }

  const rawPhoneOrId = process.argv[2];
  if (!rawPhoneOrId) {
    console.error('Usage: npm run dev:mark-paid -- <phoneNumber|checkInId>');
    process.exit(1);
  }

  let checkIn = await prisma.checkIn.findUnique({
    where: { id: rawPhoneOrId },
    include: { patient: true, clinic: true, department: true, encounter: true },
  });

  if (!checkIn) {
    let phoneE164: string;
    try {
      phoneE164 = toE164(rawPhoneOrId);
    } catch {
      console.error(`"${rawPhoneOrId}" is not a valid check-in id or Kenyan phone number.`);
      process.exit(1);
    }

    checkIn = await prisma.checkIn.findFirst({
      where: { patient: { phoneNumber: phoneE164 } },
      orderBy: { createdAt: 'desc' },
      include: { patient: true, clinic: true, department: true, encounter: true },
    });
  }

  if (!checkIn) {
    console.error(`No check-in found for "${rawPhoneOrId}". Start a check-in via the portal or USSD first.`);
    process.exit(1);
  }

  if (checkIn.encounter) {
    console.log(
      `Check-in ${checkIn.id} already has an encounter (consultation status: ${checkIn.encounter.consultationStatus}) — nothing to do.`,
    );
    return;
  }

  await prisma.$transaction([
    prisma.checkIn.update({
      where: { id: checkIn.id },
      data: { status: 'PAID', paidAt: new Date() },
    }),
    prisma.encounter.create({
      data: { patientId: checkIn.patientId, clinicId: checkIn.clinicId, checkInId: checkIn.id },
    }),
  ]);

  console.log(
    `Marked check-in ${checkIn.id} as PAID for ${checkIn.patient.firstName} ${checkIn.patient.lastName} ` +
      `at ${checkIn.clinic.name}${checkIn.department ? ` (${checkIn.department.name})` : ''}. ` +
      'It should now show up as Waiting in the staff dashboard queue.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
