/**
 * Emergency/admin PIN reset for a staff or doctor account, run directly
 * from the Railway console — not exposed as an HTTP endpoint, so this is
 * only reachable by whoever already has production console access. Unlike
 * devMarkCheckInPaid.ts, this is a genuine account-recovery action (not a
 * "fake the real flow" bypass), so it's not gated behind NODE_ENV/MPESA_ENV
 * and is fine to run in production for legitimate recovery.
 *
 * Usage: npm run reset-staff-pin -- <staffCode> <newPin>
 */
import { prisma } from '../src/db/prisma';
import { StaffNotFoundError, InvalidPinFormatError, resetStaffPinViaConsole } from '../src/services/staffService';

const staffCode = process.argv[2];
const newPin = process.argv[3];

if (!staffCode || !newPin) {
  console.error('Usage: npm run reset-staff-pin -- <staffCode> <newPin>');
  process.exit(1);
}

resetStaffPinViaConsole(staffCode, newPin)
  .then((staff) => {
    console.log(`PIN reset for ${staff.name} (${staff.staffCode}). They can now log in with the new PIN you just set.`);
  })
  .catch((err) => {
    if (err instanceof StaffNotFoundError || err instanceof InvalidPinFormatError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
