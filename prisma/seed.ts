import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Local/dev-only seed data so you can exercise the USSD flows end-to-end
 * without a real onboarding process. Not run against production.
 */
async function main() {
  const clinic = await prisma.clinic.upsert({
    where: { ussdCode: '482' },
    update: {},
    create: {
      name: 'Sunrise Family Clinic',
      county: 'Nairobi',
      ussdCode: '482',
    },
  });

  const pinHash = await bcrypt.hash('1234', 10);

  await prisma.staff.upsert({
    where: { phoneNumber: '+254700000001' },
    update: {},
    create: {
      clinicId: clinic.id,
      phoneNumber: '+254700000001',
      name: 'Test Receptionist',
      pinHash,
      role: 'RECEPTIONIST',
    },
  });

  console.log(`Seeded clinic "${clinic.name}" (USSD code ${clinic.ussdCode}) and staff PIN 1234.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
