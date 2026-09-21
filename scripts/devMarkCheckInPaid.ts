/**
 * Dev-only convenience: marks a pending CheckIn as PAID without a real
 * M-Pesa sandbox round-trip, for local testing of the doctor queue/checkout
 * flow. This is NOT the real manual payment confirmation feature (that's
 * staff-facing, audited with who/when, in the dashboard — see
 * src/dashboard/checkins.ts POST /:id/confirm-payment and
 * checkInService.confirmCheckInPaidManually). This script bypasses that
 * entirely and must never run in production.
 *
 * Usage: npm run dev:mark-paid -- <checkInId>
 */
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { devMarkCheckInPaid } from '../src/services/checkInService';

if (env.NODE_ENV === 'production') {
  console.error('devMarkCheckInPaid is a dev-only script and cannot run with NODE_ENV=production.');
  process.exit(1);
}

const checkInId = process.argv[2];
if (!checkInId) {
  console.error('Usage: npm run dev:mark-paid -- <checkInId>');
  process.exit(1);
}

devMarkCheckInPaid(checkInId)
  .then((updated) => {
    console.log(`Marked CheckIn ${updated.id} as PAID.`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
