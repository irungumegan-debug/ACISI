import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Local/dev-only seed data so you can exercise the USSD flows end-to-end
 * without a real onboarding process. Not run against production.
 *
 * Seeds 7 clinics (not just 1) so the paginated clinic-selection menu
 * actually has a second page to exercise during manual testing.
 */
const CLINICS: Array<{ name: string; county: string; ussdCode: string }> = [
  { name: 'Sunrise Family Clinic', county: 'Nairobi', ussdCode: '482' },
  { name: 'Baraka Health Centre', county: 'Nairobi', ussdCode: '483' },
  { name: 'Uzima Medical Clinic', county: 'Kiambu', ussdCode: '484' },
  { name: 'Tumaini Community Clinic', county: 'Nakuru', ussdCode: '485' },
  { name: 'Amani Health Point', county: 'Mombasa', ussdCode: '486' },
  { name: 'Jipe Moyo Clinic', county: 'Kisumu', ussdCode: '487' },
  { name: 'Nuru Family Clinic', county: 'Machakos', ussdCode: '488' },
];

/// Shared, platform-wide department list — see the note on the Department
/// model in schema.prisma. Extending this list later is just a new row, no
/// code change (both the USSD and web check-in flows read it live).
const DEPARTMENTS = ['General', 'Gynecology', 'Dental', 'Pediatrics'];

async function main() {
  const clinics = await Promise.all(
    CLINICS.map((clinic) =>
      prisma.clinic.upsert({
        where: { ussdCode: clinic.ussdCode },
        update: {},
        create: clinic,
      }),
    ),
  );

  await Promise.all(
    DEPARTMENTS.map((name) =>
      prisma.department.upsert({
        where: { name },
        update: {},
        create: { name },
      }),
    ),
  );

  const primaryClinic = clinics[0]!;
  const pinHash = await bcrypt.hash('1234', 10);

  await prisma.staff.upsert({
    where: { phoneNumber: '+254700000001' },
    update: {},
    create: {
      clinicId: primaryClinic.id,
      phoneNumber: '+254700000001',
      name: 'Test Receptionist',
      pinHash,
      role: 'RECEPTIONIST',
    },
  });

  console.log(
    `Seeded ${clinics.length} clinics, ${DEPARTMENTS.length} departments, and one staff login (+254700000001, PIN 1234) at "${primaryClinic.name}".`,
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
