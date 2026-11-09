import { PrismaClient, StaffRole, Sex } from '@prisma/client';
import bcrypt from 'bcrypt';
import {
  PRIVACY_NOTICE_VERSION,
  TERMS_OF_SERVICE_VERSION,
  CONFIDENTIALITY_UNDERTAKING_VERSION,
} from '../src/config/legal';
import { CONSENT_VERSION } from '../src/config/constants';

/**
 * Sales-demo clinic "Avyora Health – Westlands": departments, staff logins and
 * a few patients. Every person and phone number here is FICTIONAL. Phone
 * numbers all use the +254 700 555 xxx block so they are easy to spot.
 *
 * Refuses to run with NODE_ENV=production: on a shared database the demo
 * clinic would show up in real patients' clinic lists and in the owner site.
 * Run it only against a separate demo/sandbox database.
 *
 *   npx ts-node scripts/seedAvyoraDemo.ts
 *
 * Safe to run again: everything is upserted by fixed codes.
 */

const prisma = new PrismaClient();

export const DEMO_PIN = '246810';
const CLINIC = {
  name: 'Avyora Health – Westlands',
  county: 'Nairobi',
  ussdCode: '901',
  inviteCode: 'AVYORA-DEMO',
};

const DEPARTMENTS = [
  { name: 'General Consultation', code: 'GEN' },
  { name: 'Paediatrics', code: 'PAED' },
  { name: 'Gynaecology', code: 'GYN' },
  { name: 'Pharmacy & Checkout', code: 'PHAR' },
] as const;

const STAFF: Array<{ staffCode: string; name: string; phone: string; role: StaffRole; dept?: string }> = [
  { staffCode: 'ACI-STF-AVAD', name: 'Wanjiru Kamau', phone: '+254700555101', role: 'ADMIN' },
  { staffCode: 'ACI-STF-AVRC', name: 'Achieng Otieno', phone: '+254700555102', role: 'RECEPTIONIST' },
  { staffCode: 'ACI-STF-AVGP', name: 'Dr. Kiprono Langat', phone: '+254700555103', role: 'DOCTOR', dept: 'GEN' },
  { staffCode: 'ACI-STF-AVPD', name: 'Dr. Fatuma Abdi', phone: '+254700555104', role: 'DOCTOR', dept: 'PAED' },
  { staffCode: 'ACI-STF-AVGY', name: 'Dr. Nyambura Gichuru', phone: '+254700555105', role: 'DOCTOR', dept: 'GYN' },
  { staffCode: 'ACI-STF-AVPH', name: 'Mwende Musyoka', phone: '+254700555106', role: 'RECEPTIONIST' },
];

const PATIENTS: Array<{ patientCode: string; first: string; last: string; phone: string; dob: string; sex: Sex; withPin: boolean }> = [
  // The patient whose visit the demo follows (has a portal login).
  { patientCode: 'ACI-AV01', first: 'Grace', last: 'Wairimu', phone: '+254700555201', dob: '1991-04-17', sex: 'FEMALE', withPin: true },
  { patientCode: 'ACI-AV02', first: 'Hassan', last: 'Omar', phone: '+254700555202', dob: '1986-09-03', sex: 'MALE', withPin: false },
  { patientCode: 'ACI-AV03', first: 'Imani', last: 'Odhiambo', phone: '+254700555203', dob: '2021-02-11', sex: 'FEMALE', withPin: false },
  { patientCode: 'ACI-AV04', first: 'Lilian', last: 'Chebet', phone: '+254700555204', dob: '1995-12-28', sex: 'FEMALE', withPin: false },
  { patientCode: 'ACI-AV05', first: 'Peter', last: 'Kariuki', phone: '+254700555205', dob: '1978-06-20', sex: 'MALE', withPin: false },
  { patientCode: 'ACI-AV06', first: 'Zawadi', last: 'Mwakio', phone: '+254700555206', dob: '2019-08-05', sex: 'MALE', withPin: false },
  { patientCode: 'ACI-AV07', first: 'Joseph', last: 'Ndegwa', phone: '+254700555207', dob: '1969-03-14', sex: 'MALE', withPin: false },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed the demo clinic into a production database. Use a separate demo database.');
  }
  const pinHash = await bcrypt.hash(DEMO_PIN, 10);

  const clinic = await prisma.clinic.upsert({ where: { inviteCode: CLINIC.inviteCode }, update: { name: CLINIC.name }, create: CLINIC });

  // `--reset-visits`: clear the demo clinic's visits (and only this clinic's)
  // so the walkthrough starts from an empty queue again.
  if (process.argv.includes('--reset-visits')) {
    const clinicId = clinic.id;
    await prisma.$transaction([
      prisma.payment.deleteMany({ where: { clinicId } }),
      prisma.bill.deleteMany({ where: { clinicId } }),
      prisma.mpesaTransaction.deleteMany({ where: { checkIn: { clinicId } } }),
      prisma.legalAcceptance.deleteMany({ where: { checkIn: { clinicId } } }),
      prisma.encounter.deleteMany({ where: { clinicId } }),
      prisma.checkIn.deleteMany({ where: { clinicId } }),
    ]);
    console.log('Demo visits cleared.');
  }

  await prisma.clinicPaymentSettings.upsert({
    where: { clinicId: clinic.id },
    update: {},
    create: { clinicId: clinic.id, acceptsCash: true, acceptsMobileMoney: true, mobileMoneyType: 'TILL', mobileMoneyNumber: '5550101', defaultConsultationFeeKes: 1000 },
  });

  const deptByCode: Record<string, string> = {};
  for (const d of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { clinicId_code: { clinicId: clinic.id, code: d.code } },
      update: {},
      create: { clinicId: clinic.id, name: d.name, nameKey: d.name.toLowerCase(), code: d.code },
    });
    deptByCode[d.code] = row.id;
  }

  for (const s of STAFF) {
    const departmentId = s.dept ? deptByCode[s.dept] : undefined;
    const staff = await prisma.staff.upsert({
      where: { staffCode: s.staffCode },
      update: { pinHash, isActive: true },
      create: {
        clinicId: clinic.id,
        staffCode: s.staffCode,
        phoneNumber: s.phone,
        name: s.name,
        pinHash,
        role: s.role,
        departmentId,
        departments: departmentId ? { create: [{ departmentId }] } : undefined,
      },
    });
    const accepted = await prisma.legalAcceptance.count({ where: { staffId: staff.id } });
    if (accepted === 0) {
      // Demo staff are treated as having already accepted at a first login, so the walkthrough starts on the console.
      const context = s.role === 'ADMIN' ? 'CLINIC_REGISTRATION' : 'STAFF_LOGIN';
      await prisma.legalAcceptance.createMany({
        data: [
          { document: 'TERMS_OF_SERVICE', version: TERMS_OF_SERVICE_VERSION, context, staffId: staff.id, clinicId: clinic.id },
          { document: 'PRIVACY_NOTICE', version: PRIVACY_NOTICE_VERSION, context, staffId: staff.id, clinicId: clinic.id },
          { document: 'CONFIDENTIALITY_UNDERTAKING', version: CONFIDENTIALITY_UNDERTAKING_VERSION, context, staffId: staff.id, clinicId: clinic.id },
        ],
      });
    }
  }

  for (const p of PATIENTS) {
    const patient = await prisma.patient.upsert({
      where: { patientCode: p.patientCode },
      update: p.withPin ? { pinHash } : {},
      create: {
        patientCode: p.patientCode,
        phoneNumber: p.phone,
        firstName: p.first,
        lastName: p.last,
        dateOfBirth: new Date(p.dob),
        sex: p.sex,
        county: 'Nairobi',
        pinHash: p.withPin ? pinHash : null,
        phoneVerifiedAt: new Date(),
        phoneVerifiedVia: 'IN_PERSON',
      },
    });
    const hasConsent = await prisma.consent.count({ where: { patientId: patient.id } });
    if (hasConsent === 0) {
      await prisma.consent.create({ data: { patientId: patient.id, type: 'PLATFORM_REGISTRATION', granted: true, channel: 'STAFF_ASSISTED', version: CONSENT_VERSION } });
    }
    if (p.withPin && (await prisma.legalAcceptance.count({ where: { patientId: patient.id } })) === 0) {
      await prisma.legalAcceptance.createMany({
        data: [
          { document: 'TERMS_OF_SERVICE', version: TERMS_OF_SERVICE_VERSION, context: 'PATIENT_SIGNUP', patientId: patient.id },
          { document: 'PRIVACY_NOTICE', version: PRIVACY_NOTICE_VERSION, context: 'PATIENT_SIGNUP', patientId: patient.id },
        ],
      });
    }
  }

  console.log(`Demo clinic "${clinic.name}" ready. Staff PIN and patient PIN: ${DEMO_PIN}`);
  for (const s of STAFF) console.log(`  ${s.staffCode}  ${s.role.padEnd(12)} ${s.name}`);
  console.log(`  Patient portal: ${PATIENTS[0]!.phone} (Grace Wairimu)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
