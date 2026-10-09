import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { generateBillNumber, generatePatientCode } from '../utils/idCodes';
import { pinPolicyError } from '../utils/pinPolicy';
import { DEMO_CHECKIN_FEE_KES } from './demoGuard';
import { hashPin } from './staffService';
import { revokeSessionsFor } from './sessionRevocation';

/**
 * Demo clinics: a clinic-branded copy of ACISI with a believable day already
 * under way, for showing ACISI to a prospective clinic. One config file per
 * clinic (demo/<key>.json); seed, reset and delete only ever touch the clinic
 * whose demoKey matches and the fake patients created for it (see
 * demoGuard.ts for how those are kept away from SMS and M-Pesa).
 */

export const demoConfigSchema = z.object({
  /** Config slug, e.g. "westlands": the demo link is acisi.co.ke/patient?demo=<key>. */
  key: z.string().regex(/^[a-z0-9-]{2,40}$/, 'key: lower-case letters, digits and dashes'),
  /** The real clinic's name; the demo is called "<name> (Demo)". */
  name: z.string().min(2).max(80),
  county: z.string().min(2).max(40),
  /** Where the clinic is, for your own reference (the clinic record has no address field). */
  location: z.string().max(120).optional(),
  /** Short prefix for the demo staff logins, e.g. "WMC" gives WMC-FD1, WMC-DR1, WMC-ADM. */
  loginPrefix: z.string().regex(/^[A-Z]{2,5}$/, 'loginPrefix: 2–5 capital letters'),
  /**
   * Which block of fake numbers this demo uses (+254799000<block><nn>), 1–9.
   * Each demo config needs its own block, since phone numbers are unique.
   */
  phoneBlock: z.number().int().min(1).max(9),
  departments: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        code: z.string().regex(/^[A-Z0-9]{2,6}$/, 'department code: 2–6 capital letters or digits'),
        consultationFeeKes: z.number().int().min(0).optional(),
      }),
    )
    .min(1),
  /** Department codes the seeded queue is spread across, in order (the first one gets the most patients). */
  queueDepartments: z.array(z.string()).min(1),
  doctors: z
    .array(z.object({ name: z.string().min(2), departments: z.array(z.string()).min(1) }))
    .min(1)
    .max(4),
  frontDesk: z
    .array(z.object({ name: z.string().min(2) }))
    .min(1)
    .max(2),
  admin: z.object({ name: z.string().min(2) }),
});

export type DemoConfig = z.infer<typeof demoConfigSchema>;

export class DemoClinicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoClinicError';
  }
}

export interface DemoLogin {
  role: 'Front desk' | 'Doctor' | 'Clinic admin';
  name: string;
  staffCode: string;
  departments: string[];
}

export interface DemoSeedResult {
  clinicId: string;
  clinicName: string;
  logins: DemoLogin[];
  pin: string;
  patientCount: number;
}

export interface DemoDeleteResult {
  deleted: boolean;
  /** Fake patients kept because they somehow have visits at another clinic. */
  keptPatientIds: string[];
}

/** The fake numbers a demo uses: +254799000<block><nn>. A real Safaricom range, so never treated as "demo" by itself (see demoGuard.ts). */
export function demoPhone(block: number, n: number): string {
  return `+254799000${block}${String(n).padStart(2, '0')}`;
}

/** A six-digit PIN that passes the normal PIN rules, from DEMO_PIN or random. */
export function chooseDemoPin(fromEnv?: string): string {
  if (fromEnv) {
    const problem = pinPolicyError(fromEnv);
    if (problem) throw new DemoClinicError(`DEMO_PIN: ${problem}`);
    return fromEnv;
  }
  for (;;) {
    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (!pinPolicyError(pin)) return pin;
  }
}

function checkConfig(config: DemoConfig): void {
  const codes = new Set(config.departments.map((d) => d.code));
  for (const code of [...config.queueDepartments, ...config.doctors.flatMap((d) => d.departments)]) {
    if (!codes.has(code))
      throw new DemoClinicError(`Department code "${code}" is used but not listed under departments`);
  }
}

/**
 * One believable morning at the clinic, relative to now so it always looks
 * like today: two finished visits with notes and a prescription, one at
 * checkout, one with the doctor, three waiting in different departments and
 * a walk-in. The last-name "Mfano" (Swahili for "example") marks every
 * patient as fake at a glance.
 */
const SCENARIO: Array<{
  firstName: string;
  sex: 'FEMALE' | 'MALE';
  birthYear: number;
  minutesAgo: number;
  queueSlot: number;
  stage: 'DONE' | 'READY_FOR_CHECKOUT' | 'IN_CONSULTATION' | 'WAITING' | 'WALK_IN';
  visitReason?: string;
  diagnosis?: string;
  prescription?: string;
  medicinesKes?: number;
}> = [
  {
    firstName: 'Neema',
    sex: 'FEMALE',
    birthYear: 1991,
    minutesAgo: 165,
    queueSlot: 0,
    stage: 'DONE',
    diagnosis: 'Acute tonsillitis. Temp 38.4 °C, enlarged tonsils with exudate. No difficulty breathing.',
    prescription:
      'Amoxicillin 500 mg, 1 capsule 3 times daily for 7 days\nParacetamol 1 g, 3 times daily for 3 days',
    medicinesKes: 650,
  },
  {
    firstName: 'James',
    sex: 'MALE',
    birthYear: 1968,
    minutesAgo: 140,
    queueSlot: 4,
    stage: 'DONE',
    diagnosis: 'Hypertension review. BP 142/90, down from 158/96 last month. Tolerating medication well.',
    prescription: 'Amlodipine 5 mg, once daily for 30 days\nReview in 4 weeks with home BP readings',
    medicinesKes: 900,
  },
  {
    firstName: 'Imani',
    sex: 'FEMALE',
    birthYear: 2019,
    minutesAgo: 95,
    queueSlot: 1,
    stage: 'READY_FOR_CHECKOUT',
    diagnosis: 'Upper respiratory tract infection. Mild cough, clear chest, feeding well.',
    prescription: 'Paracetamol syrup 120 mg/5 ml, 7.5 ml 3 times daily for 3 days\nOral rehydration and rest',
  },
  {
    firstName: 'Joseph',
    sex: 'MALE',
    birthYear: 1984,
    minutesAgo: 50,
    queueSlot: 0,
    stage: 'IN_CONSULTATION',
  },
  { firstName: 'Rehema', sex: 'FEMALE', birthYear: 1996, minutesAgo: 35, queueSlot: 2, stage: 'WAITING' },
  { firstName: 'David', sex: 'MALE', birthYear: 1977, minutesAgo: 25, queueSlot: 3, stage: 'WAITING' },
  {
    firstName: 'Baraka',
    sex: 'MALE',
    birthYear: 2001,
    minutesAgo: 18,
    queueSlot: 0,
    stage: 'WALK_IN',
    visitReason: 'Cough and fever for 3 days',
  },
  { firstName: 'Mary', sex: 'FEMALE', birthYear: 1988, minutesAgo: 8, queueSlot: 0, stage: 'WAITING' },
];

/** Earlier visits for the first patient (Neema), so her record history has something to show. */
const PAST_VISITS = [
  {
    daysAgo: 23,
    queueSlot: 0,
    diagnosis: 'Malaria (RDT positive). Fever and headache for 2 days.',
    prescription:
      'Artemether-lumefantrine 80/480 mg, 1 tablet twice daily for 3 days\nParacetamol 1 g, 3 times daily as needed',
    medicinesKes: 480,
  },
  {
    daysAgo: 58,
    queueSlot: 4,
    diagnosis: 'Iron-deficiency anaemia. Hb 10.2 g/dL. Tiredness for 3 weeks.',
    prescription:
      'Ferrous sulphate 200 mg, once daily for 30 days\nFolic acid 5 mg, once daily for 30 days\nRepeat Hb in 6 weeks',
    medicinesKes: 350,
  },
];

/**
 * Creates the demo clinic from its config, in one transaction: the clinic
 * ("<name> (Demo)", hidden from public lists), its departments, demo staff
 * logins (all with the same PIN) and a morning's worth of fake patients.
 * Refuses if the demo already exists (use resetDemoClinic) or if any of its
 * fake numbers already belongs to a real account.
 */
export async function seedDemoClinic(
  rawConfig: unknown,
  options: { pin?: string; now?: Date } = {},
): Promise<DemoSeedResult> {
  const config = demoConfigSchema.parse(rawConfig);
  checkConfig(config);
  const now = options.now ?? new Date();
  const pin = chooseDemoPin(options.pin);
  const pinHash = await hashPin(pin);
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  const staffSeeds = [
    ...config.frontDesk.map((s, i) => ({
      ...s,
      role: 'RECEPTIONIST' as const,
      code: `${config.loginPrefix}-FD${i + 1}`,
      departments: [] as string[],
    })),
    ...config.doctors.map((s, i) => ({
      ...s,
      role: 'DOCTOR' as const,
      code: `${config.loginPrefix}-DR${i + 1}`,
    })),
    {
      ...config.admin,
      role: 'ADMIN' as const,
      code: `${config.loginPrefix}-ADM`,
      departments: [] as string[],
    },
  ].map((s, i) => ({ ...s, phone: demoPhone(config.phoneBlock, i + 1) }));
  const patientPhones = SCENARIO.map((_, i) => demoPhone(config.phoneBlock, 50 + i));

  const result = await prisma.$transaction(
    async (tx) => {
      if (await tx.clinic.findUnique({ where: { demoKey: config.key } })) {
        throw new DemoClinicError(`Demo "${config.key}" already exists. Use reset to start it fresh.`);
      }
      const [takenStaff, takenPatients, takenCodes] = await Promise.all([
        tx.staff.findMany({
          where: { phoneNumber: { in: staffSeeds.map((s) => s.phone) } },
          select: { phoneNumber: true },
        }),
        tx.patient.findMany({ where: { phoneNumber: { in: patientPhones } }, select: { phoneNumber: true } }),
        tx.staff.findMany({
          where: { staffCode: { in: staffSeeds.map((s) => s.code) } },
          select: { staffCode: true },
        }),
      ]);
      if (takenStaff.length || takenPatients.length) {
        throw new DemoClinicError(
          `These demo numbers already belong to an account: ${[...takenStaff, ...takenPatients].map((r) => r.phoneNumber).join(', ')}. Pick another phoneBlock.`,
        );
      }
      if (takenCodes.length) {
        throw new DemoClinicError(
          `These logins are already in use: ${takenCodes.map((r) => r.staffCode).join(', ')}. Pick another loginPrefix.`,
        );
      }

      const clinic = await tx.clinic.create({
        data: {
          name: `${config.name} (Demo)`,
          county: config.county,
          ussdCode: `demo-${config.key}`,
          inviteCode: `DEMO-${config.key.toUpperCase()}`,
          isDemo: true,
          demoKey: config.key,
        },
      });
      await tx.clinicPaymentSettings.create({
        data: { clinicId: clinic.id, acceptsCash: true, acceptsCard: true, defaultConsultationFeeKes: 1000 },
      });

      const departments = new Map<string, { id: string; name: string; fee: number }>();
      for (const d of config.departments) {
        const created = await tx.department.create({
          data: {
            clinicId: clinic.id,
            name: d.name,
            nameKey: d.name.trim().toLowerCase(),
            code: d.code,
            consultationFeeKes: d.consultationFeeKes ?? null,
          },
        });
        departments.set(d.code, { id: created.id, name: created.name, fee: d.consultationFeeKes ?? 1000 });
      }
      const dept = (code: string) => departments.get(code)!;
      const queueDept = (slot: number) =>
        dept(config.queueDepartments[slot % config.queueDepartments.length]!);

      const staff = new Map<string, { id: string; departments: string[] }>();
      for (const s of staffSeeds) {
        const created = await tx.staff.create({
          data: {
            clinicId: clinic.id,
            staffCode: s.code,
            phoneNumber: s.phone,
            name: s.name,
            pinHash,
            role: s.role,
            departmentId: s.departments[0] ? dept(s.departments[0]).id : null,
            // Doctors are "in today", so the live check-in gets assigned to one.
            ...(s.role === 'DOCTOR' ? { presenceOverride: 'IN' as const, presenceOverrideAt: now } : {}),
            departments: { create: s.departments.map((code) => ({ departmentId: dept(code).id })) },
          },
        });
        staff.set(s.code, { id: created.id, departments: s.departments });
      }
      const frontDeskId = staff.get(`${config.loginPrefix}-FD1`)!.id;
      const doctorFor = (deptCode: string) =>
        [...staff.entries()].find(
          ([code, s]) => code.includes('-DR') && s.departments.includes(deptCode),
        )?.[1].id ?? null;
      const deptCodeOf = (id: string) => [...departments.entries()].find(([, d]) => d.id === id)![0];

      let visitNo = 0;
      async function createVisit(input: {
        patientId: string;
        departmentId: string;
        at: Date;
        stage: (typeof SCENARIO)[number]['stage'];
        visitReason?: string;
        diagnosis?: string;
        prescription?: string;
        medicinesKes?: number;
        consultationFeeKes: number;
      }): Promise<void> {
        visitNo += 1;
        const walkIn = input.stage === 'WALK_IN';
        const doctorId = doctorFor(deptCodeOf(input.departmentId));
        const consulted = input.stage === 'DONE' || input.stage === 'READY_FOR_CHECKOUT';
        const checkIn = await tx.checkIn.create({
          data: {
            patientId: input.patientId,
            clinicId: clinic.id,
            departmentId: input.departmentId,
            ussdSessionId: `DEMO-${config.key}-${visitNo}`,
            source: walkIn ? 'WALK_IN' : 'REMOTE',
            staffId: walkIn ? frontDeskId : null,
            amountKes: walkIn ? 0 : DEMO_CHECKIN_FEE_KES,
            status: walkIn ? 'NO_FEE' : 'PAID',
            paidAt: walkIn ? null : input.at,
            createdAt: input.at,
          },
        });
        const encounter = await tx.encounter.create({
          data: {
            patientId: input.patientId,
            clinicId: clinic.id,
            checkInId: checkIn.id,
            assignedDoctorId: doctorId,
            status: input.stage === 'WALK_IN' ? 'WAITING' : input.stage,
            visitReason: input.visitReason,
            diagnosis: input.diagnosis,
            prescription: input.prescription,
            consultedByStaffId: consulted ? doctorId : null,
            consultedAt: consulted ? new Date(input.at.getTime() + 25 * 60_000) : null,
            checkedOutByStaffId: input.stage === 'DONE' ? frontDeskId : null,
            checkedOutAt: input.stage === 'DONE' ? new Date(input.at.getTime() + 40 * 60_000) : null,
            createdAt: input.at,
          },
        });
        if (input.stage !== 'DONE') return;

        const medicines = input.medicinesKes ?? 0;
        const total = input.consultationFeeKes + medicines;
        const paidAt = new Date(input.at.getTime() + 40 * 60_000);
        const bill = await tx.bill.create({
          data: {
            billNumber: generateBillNumber(),
            encounterId: encounter.id,
            clinicId: clinic.id,
            createdByStaffId: frontDeskId,
            subtotalKes: total,
            totalKes: total,
            paidKes: total,
            status: 'PAID',
            paidAt,
            createdAt: paidAt,
            items: {
              create: [
                {
                  kind: 'CONSULTATION',
                  description: 'Consultation',
                  amountKes: input.consultationFeeKes,
                  position: 0,
                },
                ...(medicines > 0
                  ? [
                      {
                        kind: 'MEDICATION' as const,
                        description: 'Medicines',
                        amountKes: medicines,
                        position: 1,
                      },
                    ]
                  : []),
              ],
            },
          },
        });
        await tx.payment.create({
          data: {
            billId: bill.id,
            clinicId: clinic.id,
            method: 'CASH',
            status: 'SUCCEEDED',
            amountKes: total,
            cashTenderedKes: total,
            changeKes: 0,
            idempotencyKey: `demo-${config.key}-${visitNo}`,
            takenByStaffId: frontDeskId,
            completedAt: paidAt,
            createdAt: paidAt,
          },
        });
      }

      const patientIds: string[] = [];
      for (const [i, p] of SCENARIO.entries()) {
        const patient = await tx.patient.create({
          data: {
            patientCode: await uniquePatientCode(tx),
            phoneNumber: patientPhones[i]!,
            firstName: p.firstName,
            lastName: 'Mfano',
            sex: p.sex,
            dateOfBirth: new Date(Date.UTC(p.birthYear, 5, 15)),
            county: config.county,
            demoClinicId: clinic.id,
          },
        });
        patientIds.push(patient.id);
        const d = queueDept(p.queueSlot);
        await createVisit({
          ...p,
          patientId: patient.id,
          departmentId: d.id,
          at: minutesAgo(p.minutesAgo),
          consultationFeeKes: d.fee,
        });
      }
      for (const v of PAST_VISITS) {
        const d = queueDept(v.queueSlot);
        await createVisit({
          ...v,
          stage: 'DONE',
          patientId: patientIds[0]!,
          departmentId: d.id,
          at: minutesAgo(v.daysAgo * 24 * 60 + 300),
          consultationFeeKes: d.fee,
        });
      }

      return { clinicId: clinic.id, clinicName: clinic.name, patientCount: patientIds.length };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const departmentName = new Map(config.departments.map((d) => [d.code, d.name]));
  return {
    ...result,
    pin,
    logins: staffSeeds.map((s) => ({
      role: s.role === 'RECEPTIONIST' ? 'Front desk' : s.role === 'DOCTOR' ? 'Doctor' : 'Clinic admin',
      name: s.name,
      staffCode: s.code,
      departments: s.departments.map((code) => departmentName.get(code) ?? code),
    })),
  };
}

async function uniquePatientCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generatePatientCode();
    if (!(await tx.patient.findUnique({ where: { patientCode: code }, select: { id: true } }))) return code;
  }
  throw new DemoClinicError('Could not generate a unique patient code');
}

/**
 * Removes a demo clinic completely, in one transaction: everything recorded
 * at that clinic (visits, check-ins, bills, payments, appointments, M-Pesa
 * records, legal acceptances and audit entries), its staff, departments and
 * settings, then its fake patients. Only rows tied to this clinic's id are
 * touched, and it refuses anything that isn't a demo clinic. A real patient
 * who checked in at the demo (the presenter's own account) keeps their
 * account; only that visit goes.
 */
export async function deleteDemoClinic(demoKey: string): Promise<DemoDeleteResult> {
  const clinic = await prisma.clinic.findUnique({ where: { demoKey } });
  if (!clinic) return { deleted: false, keptPatientIds: [] };
  if (!clinic.isDemo)
    throw new DemoClinicError(`Clinic "${clinic.name}" is not a demo clinic; refusing to delete it`);

  const keptPatientIds = await prisma.$transaction(
    async (tx) => {
      const clinicId = clinic.id;
      const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.id);
      const [staffIds, checkInIds, encounterIds, billIds, appointmentIds, paymentIds, demoPatientIds] =
        await Promise.all([
          ids(tx.staff.findMany({ where: { clinicId }, select: { id: true } })),
          ids(tx.checkIn.findMany({ where: { clinicId }, select: { id: true } })),
          ids(tx.encounter.findMany({ where: { clinicId }, select: { id: true } })),
          ids(tx.bill.findMany({ where: { clinicId }, select: { id: true } })),
          ids(tx.appointment.findMany({ where: { clinicId }, select: { id: true } })),
          ids(tx.payment.findMany({ where: { clinicId }, select: { id: true } })),
          ids(tx.patient.findMany({ where: { demoClinicId: clinicId }, select: { id: true } })),
        ]);

      await tx.legalAcceptance.deleteMany({
        where: { OR: [{ clinicId }, { staffId: { in: staffIds } }, { checkInId: { in: checkInIds } }] },
      });
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { staffId: { in: staffIds } },
            { actorId: { in: [...staffIds, ...demoPatientIds] } },
            {
              entityId: {
                in: [
                  clinicId,
                  ...staffIds,
                  ...demoPatientIds,
                  ...checkInIds,
                  ...encounterIds,
                  ...billIds,
                  ...appointmentIds,
                  ...paymentIds,
                ],
              },
            },
          ],
        },
      });
      await tx.payment.deleteMany({ where: { clinicId } });
      await tx.bill.deleteMany({ where: { clinicId } }); // bill items cascade
      await tx.mpesaTransaction.deleteMany({ where: { checkInId: { in: checkInIds } } });
      await tx.encounter.deleteMany({ where: { clinicId } });
      await tx.checkIn.deleteMany({ where: { clinicId } });
      await tx.appointment.deleteMany({ where: { clinicId } });
      await tx.staffOtp.deleteMany({ where: { staffId: { in: staffIds } } });
      await tx.staff.deleteMany({ where: { clinicId } }); // staff departments cascade
      await tx.department.deleteMany({ where: { clinicId } });
      await tx.clinicPaymentSettings.deleteMany({ where: { clinicId } });

      // The fake patients, unless one somehow has records at another clinic.
      const kept: string[] = [];
      for (const patientId of demoPatientIds) {
        const [visits, checkIns, appointments] = await Promise.all([
          tx.encounter.count({ where: { patientId } }),
          tx.checkIn.count({ where: { patientId } }),
          tx.appointment.count({ where: { patientId } }),
        ]);
        if (visits + checkIns + appointments > 0) {
          kept.push(patientId);
          await tx.patient.update({ where: { id: patientId }, data: { demoClinicId: null } });
          continue;
        }
        await tx.consent.deleteMany({ where: { patientId } });
        await tx.otp.deleteMany({ where: { patientId } });
        await tx.legalAcceptance.deleteMany({ where: { patientId } });
        await tx.patient.delete({ where: { id: patientId } });
      }

      await tx.clinic.delete({ where: { id: clinicId } });
      return kept;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  // Log out anyone still signed in to the demo's staff logins.
  try {
    await revokeSessionsFor(`clinic:${clinic.id}`);
  } catch {
    // Redis unavailable: their session cookies point at staff that no longer exist anyway.
  }
  return { deleted: true, keptPatientIds };
}

/** Wipes the demo clinic (if it exists) and seeds it fresh from its config. */
export async function resetDemoClinic(
  rawConfig: unknown,
  options: { pin?: string; now?: Date } = {},
): Promise<DemoSeedResult> {
  const config = demoConfigSchema.parse(rawConfig);
  await deleteDemoClinic(config.key);
  return seedDemoClinic(config, options);
}
