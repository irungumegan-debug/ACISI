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
const CLINICS: Array<{ name: string; county: string; ussdCode: string; inviteCode: string }> = [
  { name: 'Sunrise Family Clinic', county: 'Nairobi', ussdCode: '482', inviteCode: 'SUNRISE-7F2K' },
  { name: 'Baraka Health Centre', county: 'Nairobi', ussdCode: '483', inviteCode: 'BARAKA-3M9X' },
  { name: 'Uzima Medical Clinic', county: 'Kiambu', ussdCode: '484', inviteCode: 'UZIMA-5Q8T' },
  { name: 'Tumaini Community Clinic', county: 'Nakuru', ussdCode: '485', inviteCode: 'TUMAINI-2R6H' },
  { name: 'Amani Health Point', county: 'Mombasa', ussdCode: '486', inviteCode: 'AMANI-9K4Z' },
  { name: 'Jipe Moyo Clinic', county: 'Kisumu', ussdCode: '487', inviteCode: 'JIPEMOYO-6N3P' },
  { name: 'Nuru Family Clinic', county: 'Machakos', ussdCode: '488', inviteCode: 'NURU-8W2S' },
];

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

  const primaryClinic = clinics[0]!;
  const pinHash = await bcrypt.hash('1234', 10);

  const staffSeeds: Array<{ staffCode: string; phoneNumber: string; name: string; role: 'RECEPTIONIST' | 'DOCTOR' | 'ADMIN' }> = [
    { staffCode: 'ACI-STF-TEST', phoneNumber: '+254700000001', name: 'Test Receptionist', role: 'RECEPTIONIST' },
    { staffCode: 'ACI-STF-DEMO', phoneNumber: '+254700000002', name: 'Dr. Amani Wambui', role: 'DOCTOR' },
    { staffCode: 'ACI-STF-ADMN', phoneNumber: '+254700000003', name: 'Clinic Admin', role: 'ADMIN' },
  ];

  await Promise.all(
    staffSeeds.map((staff) =>
      prisma.staff.upsert({
        where: { staffCode: staff.staffCode },
        update: {},
        create: {
          clinicId: primaryClinic.id,
          staffCode: staff.staffCode,
          phoneNumber: staff.phoneNumber,
          name: staff.name,
          pinHash,
          role: staff.role,
        },
      }),
    ),
  );

  console.log(
    `Seeded ${clinics.length} clinics and ${staffSeeds.length} staff logins (PIN 1234) at "${primaryClinic.name}": ` +
      staffSeeds.map((s) => s.staffCode).join(', '),
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
