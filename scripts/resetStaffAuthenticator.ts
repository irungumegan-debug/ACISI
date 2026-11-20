/**
 * Forgets a staff member's authenticator app (lost or changed phone) when
 * their clinic admin can't do it from the console, e.g. the clinic's only
 * admin lost their phone. Run on the server, like reset-staff-pin. They set
 * the app up again at their next login.
 *
 * Usage: npm run reset-staff-authenticator -- <staffCode>
 */
import { prisma } from '../src/db/prisma';
import { redis } from '../src/config/redis';
import { recordAuditEvent } from '../src/services/auditService';
import { resetAuthenticator } from '../src/services/staffMfaService';

const staffCode = process.argv[2]?.trim().toUpperCase();

async function main(): Promise<void> {
  if (!staffCode) {
    console.error('Usage: npm run reset-staff-authenticator -- <staffCode>');
    process.exitCode = 1;
    return;
  }
  const staff = await prisma.staff.findUnique({ where: { staffCode } });
  if (!staff) {
    console.error(`No staff member with ID ${staffCode}.`);
    process.exitCode = 1;
    return;
  }
  await resetAuthenticator(staff.id);
  await recordAuditEvent({
    actorType: 'SYSTEM',
    action: 'STAFF_AUTHENTICATOR_RESET',
    entityType: 'Staff',
    entityId: staff.id,
    metadata: { via: 'server-script', resetStaffCode: staff.staffCode },
  });
  console.log(`Authenticator app reset for ${staff.name} (${staff.staffCode}). They set it up again at their next login.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
