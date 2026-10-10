import crypto from 'node:crypto';
import { Prisma, Sex, StaffRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { generateBillNumber, generatePatientCode } from '../utils/idCodes';
import { pinPolicyError } from '../utils/pinPolicy';
import { DEMO_CHECKIN_FEE_KES } from './demoGuard';
import { prepareDepartmentList } from './departmentService';
import { hashPin } from './staffService';
import { revokeSessionsFor } from './sessionRevocation';

/**
 * Demo clinics: a clinic-branded copy of ACISI with a believable morning
 * already under way, for showing ACISI to a prospective clinic in person.
 *
 *   seed   creates "<Name> – <Location> (Demo)" from parameters (name,
 *          location, departments), with demo logins, fake patients and
 *          today's queue. The parameters are stored on the clinic.
 *   reset  puts that demo back exactly as seeded (same logins, same PIN),
 *          so the demo can be run again.
 *   delete removes it completely.
 *
 * Each only ever touches the one clinic whose demoKey matches and the demo
 * patients created for it, and refuses anything that isn't a demo clinic.
 * See demoGuard.ts for how demo data is kept away from SMS, M-Pesa, real
 * patients and the owner site's totals.
 *
 * Names are neutral English names, chosen on purpose (no names tied to any
 * Kenyan community), and every phone number is in the obviously fake
 * 0700 000 xxx block. Visit notes are routine and non-alarming: ACISI is a
 * records system and makes no health claims.
 */

const departmentSchema = z.object({
  name: z.string().trim().min(2).max(60),
  code: z.string().trim().min(1).max(6),
  consultationFeeKes: z.number().int().min(0).optional(),
});

export const demoConfigSchema = z.object({
  /** Slug for the demo, e.g. "alina": the patient link is acisi.co.ke/patient?demo=<key>. */
  key: z.string().regex(/^[a-z0-9-]{2,40}$/, 'key: 2–40 lower-case letters, digits or dashes'),
  /** The real clinic's name, e.g. "Alina Medical Centre". */
  name: z.string().trim().min(2).max(80),
  /** Area, e.g. "Hurlingham". Shown in the demo clinic's name. */
  location: z.string().trim().min(2).max(60),
  county: z.string().trim().min(2).max(40).default('Nairobi'),
  /** Prefix for the demo logins, e.g. "AMC" gives AMC-FD, AMC-DR1… Defaults to the name's initials. */
  loginPrefix: z
    .string()
    .regex(/^[A-Z]{2,5}$/, 'loginPrefix: 2–5 capital letters')
    .optional(),
  /**
   * Which block of fake numbers this demo uses: 0700 000 <block><nn>, 0–9.
   * Patients are <block>01–<block>08, staff <block>11 upwards. Chosen
   * automatically (the lowest free block) when not given.
   */
  phoneBlock: z.number().int().min(0).max(9).optional(),
  departments: z.array(departmentSchema).min(1).max(12),
});

export type DemoConfigInput = z.input<typeof demoConfigSchema>;
/** A config with every default filled in, as stored on the clinic. */
export type DemoConfig = z.output<typeof demoConfigSchema> & { loginPrefix: string; phoneBlock: number };

export class DemoClinicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoClinicError';
  }
}

export interface DemoLogin {
  role: string;
  name: string;
  staffCode: string;
  departments: string[];
}

export interface DemoSeedResult {
  clinicId: string;
  clinicName: string;
  key: string;
  pin: string;
  logins: DemoLogin[];
  patients: { name: string; phone: string; note: string }[];
}

// --- Fixed cast --------------------------------------------------------------

type DeptKind = 'consult' | 'lab' | 'pharmacy';

/** What kind of department a name is, so the right person is put in it. */
export function departmentKind(name: string): DeptKind {
  if (/\blab/i.test(name)) return 'lab';
  if (/pharm|dispens/i.test(name)) return 'pharmacy';
  return 'consult';
}

/** Which doctor works a consulting department, by its name. */
function doctorFor(name: string): 0 | 1 | 2 {
  if (/paed|pediat|child/i.test(name)) return 1;
  if (/gyn|antenatal|obstet|maternity|women/i.test(name)) return 2;
  return 0;
}

const DOCTORS = ['Dr. Grace Bennett', 'Dr. Daniel Brooks', 'Dr. Sarah Collins'] as const;
const LAB_STAFF = 'Ruth Hayes';
const PHARMACY_STAFF = 'Samuel Grant';
const FRONT_DESK = 'Faith Morgan';

type Stage = 'WAITING' | 'READY_FOR_CHECKOUT';

interface PatientSeed {
  firstName: string;
  lastName: string;
  sex: Sex;
  birthYear: number;
  /**
   * One line for the printed summary, so the presenter knows who is who.
   * {today} and {past} become the department names of the visits below.
   */
  note: string;
  /** Today's visit, if any. */
  today?: {
    dept: DeptKind | 'paediatric' | 'antenatal';
    minutesAgo: number;
    walkIn?: boolean;
    stage: Stage;
    visitReason?: string;
    diagnosis?: string;
    prescription?: string;
  };
  /** Earlier finished visits, shown in the record history. */
  past?: {
    dept: DeptKind | 'paediatric' | 'antenatal';
    daysAgo: number;
    diagnosis: string;
    prescription: string;
  }[];
}

/**
 * The morning at the clinic. Phone n (1–8) is 0700 000 <block>0n, in this
 * order. Joy Carter and Victor Shaw have no visit today: Joy is the patient
 * the presenter checks in live from the website (her past visit is what the
 * doctor opens), Victor is the live walk-in at the front desk.
 */
export const DEMO_PATIENTS: PatientSeed[] = [
  {
    firstName: 'Joy',
    lastName: 'Carter',
    sex: 'FEMALE',
    birthYear: 1990,
    note: 'Live check-in from the website (has a past visit in {past})',
    past: [
      {
        dept: 'consult',
        daysAgo: 21,
        diagnosis: 'Routine check-up. Patient reports feeling well. Blood pressure and weight recorded.',
        prescription: 'No medication. Routine follow-up visit in 3 weeks.',
      },
    ],
  },
  {
    firstName: 'Brian',
    lastName: 'Ellis',
    sex: 'MALE',
    birthYear: 1983,
    note: 'Waiting in {today} (walk-in added at the front desk)',
    today: {
      dept: 'consult',
      minutesAgo: 34,
      walkIn: true,
      stage: 'WAITING',
      visitReason: 'Routine check-up',
    },
  },
  {
    firstName: 'Mercy',
    lastName: 'Lawson',
    sex: 'FEMALE',
    birthYear: 1995,
    note: 'Waiting in {today} (checked in remotely, paid)',
    today: { dept: 'antenatal', minutesAgo: 22, stage: 'WAITING' },
    past: [
      {
        dept: 'antenatal',
        daysAgo: 28,
        diagnosis:
          'Routine antenatal visit. Patient reports feeling well. Weight and blood pressure recorded.',
        prescription: 'Folic acid 400 mcg, one tablet daily. Next antenatal visit in 4 weeks.',
      },
    ],
  },
  {
    firstName: 'Kevin',
    lastName: 'Hart',
    sex: 'MALE',
    birthYear: 1978,
    note: 'Waiting in {today} (checked in remotely, paid)',
    today: { dept: 'consult', minutesAgo: 18, stage: 'WAITING' },
  },
  {
    firstName: 'Esther',
    lastName: 'Wells',
    sex: 'FEMALE',
    birthYear: 1969,
    note: 'Waiting in {today} (checked in remotely, paid)',
    today: { dept: 'lab', minutesAgo: 12, stage: 'WAITING' },
  },
  {
    firstName: 'Victor',
    lastName: 'Shaw',
    sex: 'MALE',
    birthYear: 1986,
    note: 'Not in the queue: use his number for the live walk-in',
  },
  {
    firstName: 'Linda',
    lastName: 'Parker',
    sex: 'FEMALE',
    birthYear: 1987,
    note: 'Seen by the doctor, prescription ready at checkout ({today})',
    today: {
      dept: 'consult',
      minutesAgo: 70,
      stage: 'READY_FOR_CHECKOUT',
      diagnosis: 'Follow-up visit. Patient reports feeling well. Blood pressure and weight recorded.',
      prescription: 'Vitamin D3 1000 IU, one tablet daily for 30 days.',
    },
  },
  {
    firstName: 'Caleb',
    lastName: 'Foster',
    sex: 'MALE',
    birthYear: 2020,
    note: 'Waiting in {today} (checked in remotely, paid; has a past visit)',
    today: { dept: 'paediatric', minutesAgo: 27, stage: 'WAITING' },
    past: [
      {
        dept: 'paediatric',
        daysAgo: 42,
        diagnosis: "Child's routine visit. Height and weight recorded. Parent reports the child is well.",
        prescription: 'No medication. Next routine visit in 3 months.',
      },
    ],
  },
];

// --- Helpers -----------------------------------------------------------------

/** 0700 000 <block><nn> in E.164. */
export function demoPhone(block: number, n: number): string {
  return `+254700000${block}${String(n).padStart(2, '0')}`;
}

/** How a demo number is written for people: 0700 000 001. */
export function displayPhone(e164: string): string {
  const local = `0${e164.slice(4)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** "Alina Medical Centre", "Hurlingham" → "Alina Medical Centre – Hurlingham (Demo)". */
export function demoClinicName(name: string, location: string): string {
  const withPlace = name.toLowerCase().includes(location.toLowerCase()) ? name : `${name} – ${location}`;
  return `${withPlace} (Demo)`;
}

function initials(name: string): string {
  const letters = name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('');
  return (letters.length >= 2 ? letters : `${letters}DM`).slice(0, 5);
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

/**
 * Parses "General Consultation:G,Paediatrics:P:1200,…" (name, short code,
 * optional consultation fee in KES) into department entries.
 */
export function parseDepartmentList(raw: string): z.input<typeof departmentSchema>[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, code, fee] = part.split(':').map((s) => s.trim());
      if (!name || !code)
        throw new DemoClinicError(`Department "${part}" needs a name and a short code, like "Paediatrics:P"`);
      if (fee !== undefined && !/^\d+$/.test(fee))
        throw new DemoClinicError(`Fee for "${name}" must be a whole number of KES`);
      return { name, code, ...(fee !== undefined ? { consultationFeeKes: Number(fee) } : {}) };
    });
}

/** Validates the parameters the same way clinic registration does, and fills in defaults. */
async function resolveConfig(
  input: DemoConfigInput,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<DemoConfig> {
  const parsed = demoConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DemoClinicError(`${issue?.path.join('.') || 'config'}: ${issue?.message ?? 'invalid'}`);
  }
  const config = parsed.data;

  // Same rules as a clinic admin registering: unique names, valid codes.
  let departments;
  try {
    departments = prepareDepartmentList(config.departments);
  } catch (err) {
    throw new DemoClinicError(err instanceof Error ? err.message : 'Invalid departments');
  }
  if (!departments.some((d) => departmentKind(d.name) === 'consult')) {
    throw new DemoClinicError(
      'List at least one department where patients see a doctor (e.g. "General Consultation:G")',
    );
  }

  let phoneBlock = config.phoneBlock;
  if (phoneBlock === undefined) {
    const others = await db.clinic.findMany({
      where: { isDemo: true, NOT: { demoKey: config.key } },
      select: { demoConfig: true },
    });
    const used = new Set(others.map((c) => (c.demoConfig as { phoneBlock?: number } | null)?.phoneBlock));
    phoneBlock = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((b) => !used.has(b));
    if (phoneBlock === undefined)
      throw new DemoClinicError('All 10 demo phone blocks are in use. Delete an old demo first.');
  }

  return {
    ...config,
    departments: departments.map((d) => ({
      name: d.name,
      code: d.code,
      ...(d.consultationFeeKes !== null ? { consultationFeeKes: d.consultationFeeKes } : {}),
    })),
    loginPrefix: config.loginPrefix ?? initials(config.name),
    phoneBlock,
  };
}

interface StaffSeed {
  code: string;
  name: string;
  role: StaffRole;
  roleLabel: string;
  phone: string;
  departmentCodes: string[];
}

function staffFor(config: DemoConfig): StaffSeed[] {
  const consult = config.departments.filter((d) => departmentKind(d.name) === 'consult');
  const byDoctor: string[][] = [[], [], []];
  for (const d of consult) byDoctor[doctorFor(d.name)]!.push(d.code);
  const p = config.loginPrefix;
  let n = 11;
  const phone = () => demoPhone(config.phoneBlock, n++);

  const seeds: StaffSeed[] = [
    {
      code: `${p}-FD`,
      name: FRONT_DESK,
      role: 'ADMIN',
      roleLabel: 'Front desk (clinic admin)',
      phone: phone(),
      departmentCodes: [],
    },
  ];
  DOCTORS.forEach((name, i) => {
    const codes = byDoctor[i]!;
    if (codes.length)
      seeds.push({
        code: `${p}-DR${i + 1}`,
        name,
        role: 'DOCTOR',
        roleLabel: 'Doctor',
        phone: phone(),
        departmentCodes: codes,
      });
  });
  const lab = config.departments.find((d) => departmentKind(d.name) === 'lab');
  if (lab)
    seeds.push({
      code: `${p}-LAB`,
      name: LAB_STAFF,
      role: 'CLINICIAN',
      roleLabel: 'Laboratory',
      phone: phone(),
      departmentCodes: [lab.code],
    });
  const pharmacy = config.departments.find((d) => departmentKind(d.name) === 'pharmacy');
  if (pharmacy) {
    seeds.push({
      code: `${p}-PH`,
      name: PHARMACY_STAFF,
      role: 'CLINICIAN',
      roleLabel: 'Pharmacy',
      phone: phone(),
      departmentCodes: [pharmacy.code],
    });
  }
  return seeds;
}

/** The department code a scenario visit goes to, falling back to the first consulting department. */
function deptCodeFor(config: DemoConfig, dept: DeptKind | 'paediatric' | 'antenatal'): string {
  const consult = config.departments.filter((d) => departmentKind(d.name) === 'consult');
  const pick =
    dept === 'paediatric'
      ? consult.find((d) => doctorFor(d.name) === 1)
      : dept === 'antenatal'
        ? consult.find((d) => doctorFor(d.name) === 2)
        : dept === 'consult'
          ? (consult.find((d) => doctorFor(d.name) === 0) ?? consult[0])
          : config.departments.find((d) => departmentKind(d.name) === dept);
  return (pick ?? consult[0]!).code;
}

const CLINIC_DEFAULT_FEE_KES = 1000;
const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

// --- Seeding the day ---------------------------------------------------------

/**
 * Fills a demo clinic that has its departments, staff and patients in place
 * with the scenario: today's queue and the past visits. Times are relative to
 * `now`, so the queue always looks like this morning.
 */
async function seedScenario(
  tx: Prisma.TransactionClient,
  clinicId: string,
  config: DemoConfig,
  now: Date,
): Promise<void> {
  const [departments, staff, patients] = await Promise.all([
    tx.department.findMany({ where: { clinicId } }),
    tx.staff.findMany({ where: { clinicId }, include: { departments: true } }),
    tx.patient.findMany({ where: { demoClinicId: clinicId } }),
  ]);
  const deptByCode = new Map(departments.map((d) => [d.code, d]));
  const frontDesk = staff.find((s) => s.role === 'ADMIN')!;
  const doctorOf = (departmentId: string) =>
    staff.find((s) => s.role === 'DOCTOR' && s.departments.some((d) => d.departmentId === departmentId))
      ?.id ?? null;
  const patientByPhone = new Map(patients.map((p) => [p.phoneNumber, p]));
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  let visitNo = 0;

  async function visit(input: {
    patientId: string;
    deptCode: string;
    at: Date;
    walkIn: boolean;
    status: 'WAITING' | 'READY_FOR_CHECKOUT' | 'DONE';
    visitReason?: string;
    diagnosis?: string;
    prescription?: string;
  }): Promise<void> {
    visitNo += 1;
    const dept = deptByCode.get(input.deptCode)!;
    const doctorId = doctorOf(dept.id);
    const consulted = input.status !== 'WAITING';
    const checkIn = await tx.checkIn.create({
      data: {
        patientId: input.patientId,
        clinicId,
        departmentId: dept.id,
        ussdSessionId: `DEMO-${config.key}-${now.getTime()}-${visitNo}`,
        source: input.walkIn ? 'WALK_IN' : 'REMOTE',
        staffId: input.walkIn ? frontDesk.id : null,
        amountKes: input.walkIn ? 0 : DEMO_CHECKIN_FEE_KES,
        status: input.walkIn ? 'NO_FEE' : 'PAID',
        paidAt: input.walkIn ? null : input.at,
        createdAt: input.at,
      },
    });
    const encounter = await tx.encounter.create({
      data: {
        patientId: input.patientId,
        clinicId,
        checkInId: checkIn.id,
        assignedDoctorId: doctorId,
        status: input.status,
        visitReason: input.visitReason,
        diagnosis: input.diagnosis,
        prescription: input.prescription,
        consultedByStaffId: consulted ? doctorId : null,
        consultedAt: consulted ? new Date(input.at.getTime() + 20 * 60_000) : null,
        checkedOutByStaffId: input.status === 'DONE' ? frontDesk.id : null,
        checkedOutAt: input.status === 'DONE' ? new Date(input.at.getTime() + 35 * 60_000) : null,
        createdAt: input.at,
      },
    });
    if (input.status !== 'DONE') return;

    // A past visit: billed and paid in cash at the time.
    const fee = dept.consultationFeeKes ?? CLINIC_DEFAULT_FEE_KES;
    const paidAt = new Date(input.at.getTime() + 35 * 60_000);
    const bill = await tx.bill.create({
      data: {
        billNumber: generateBillNumber(),
        encounterId: encounter.id,
        clinicId,
        createdByStaffId: frontDesk.id,
        subtotalKes: fee,
        totalKes: fee,
        paidKes: fee,
        status: 'PAID',
        paidAt,
        createdAt: paidAt,
        items: {
          create: [{ kind: 'CONSULTATION', description: 'Consultation', amountKes: fee, position: 0 }],
        },
      },
    });
    await tx.payment.create({
      data: {
        billId: bill.id,
        clinicId,
        method: 'CASH',
        status: 'SUCCEEDED',
        amountKes: fee,
        cashTenderedKes: fee,
        changeKes: 0,
        idempotencyKey: `demo-${config.key}-${now.getTime()}-${visitNo}`,
        takenByStaffId: frontDesk.id,
        completedAt: paidAt,
        createdAt: paidAt,
      },
    });
  }

  for (const [i, seed] of DEMO_PATIENTS.entries()) {
    const patient = patientByPhone.get(demoPhone(config.phoneBlock, i + 1))!;
    for (const past of seed.past ?? []) {
      await visit({
        patientId: patient.id,
        deptCode: deptCodeFor(config, past.dept),
        at: minutesAgo(past.daysAgo * 24 * 60 + 120),
        walkIn: false,
        status: 'DONE',
        diagnosis: past.diagnosis,
        prescription: past.prescription,
      });
    }
    if (seed.today) {
      await visit({
        patientId: patient.id,
        deptCode: deptCodeFor(config, seed.today.dept),
        at: minutesAgo(seed.today.minutesAgo),
        walkIn: seed.today.walkIn ?? false,
        status: seed.today.stage,
        visitReason: seed.today.visitReason,
        diagnosis: seed.today.diagnosis,
        prescription: seed.today.prescription,
      });
    }
  }
}

/** Patient fields as seeded; reset writes them back over anything changed during a demo. */
function patientData(seed: PatientSeed, county: string) {
  return {
    firstName: seed.firstName,
    lastName: seed.lastName,
    sex: seed.sex,
    dateOfBirth: new Date(Date.UTC(seed.birthYear, 5, 15)),
    county,
    email: null,
    smsOptOut: false,
    smsOptOutUpdatedAt: null,
    idType: null,
    idNumber: null,
    nextOfKinName: null,
    nextOfKinPhone: null,
    deletedAt: null,
    deletedByType: null,
  };
}

async function uniquePatientCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generatePatientCode();
    if (!(await tx.patient.findUnique({ where: { patientCode: code }, select: { id: true } }))) return code;
  }
  throw new DemoClinicError('Could not generate a unique patient code');
}

function describe(config: DemoConfig, clinic: { id: string; name: string }, pin: string): DemoSeedResult {
  const deptName = new Map(config.departments.map((d) => [d.code, d.name]));
  return {
    clinicId: clinic.id,
    clinicName: clinic.name,
    key: config.key,
    pin,
    logins: staffFor(config).map((s) => ({
      role: s.roleLabel,
      name: s.name,
      staffCode: s.code,
      departments: s.departmentCodes.map((c) => deptName.get(c) ?? c),
    })),
    patients: DEMO_PATIENTS.map((p, i) => ({
      name: `${p.firstName} ${p.lastName}`,
      phone: displayPhone(demoPhone(config.phoneBlock, i + 1)),
      note: p.note
        .replace('{today}', p.today ? (deptName.get(deptCodeFor(config, p.today.dept)) ?? '') : '')
        .replace('{past}', p.past?.[0] ? (deptName.get(deptCodeFor(config, p.past[0].dept)) ?? '') : ''),
    })),
  };
}

// --- Commands ----------------------------------------------------------------

/**
 * Creates a demo clinic from its parameters, in one transaction: the clinic,
 * its departments (validated like a registration), payment settings
 * (cash, card and simulated M-Pesa), the demo logins (all sharing one PIN),
 * the demo patients and today's queue. Refuses if the demo already exists
 * (use reset) or if any demo number or login is already taken.
 */
export async function seedDemoClinic(
  input: DemoConfigInput,
  options: { pin?: string; now?: Date } = {},
): Promise<DemoSeedResult> {
  const now = options.now ?? new Date();
  const pin = chooseDemoPin(options.pin);
  const pinHash = await hashPin(pin);

  const clinic = await prisma.$transaction(async (tx) => {
    const config = await resolveConfig(input, tx);
    if (await tx.clinic.findUnique({ where: { demoKey: config.key } })) {
      throw new DemoClinicError(
        `Demo "${config.key}" already exists. Use reset to start it fresh, or delete it first to change its departments.`,
      );
    }
    const staffSeeds = staffFor(config);
    const patientPhones = DEMO_PATIENTS.map((_, i) => demoPhone(config.phoneBlock, i + 1));
    const [takenStaffPhones, takenPatientPhones, takenCodes] = await Promise.all([
      tx.staff.count({ where: { phoneNumber: { in: staffSeeds.map((s) => s.phone) } } }),
      tx.patient.count({ where: { phoneNumber: { in: patientPhones } } }),
      tx.staff.findMany({
        where: { staffCode: { in: staffSeeds.map((s) => s.code) } },
        select: { staffCode: true },
      }),
    ]);
    if (takenStaffPhones || takenPatientPhones) {
      throw new DemoClinicError(
        `Demo phone block ${config.phoneBlock} is already in use. Pass a different --phone-block.`,
      );
    }
    if (takenCodes.length) {
      throw new DemoClinicError(
        `These logins are already in use: ${takenCodes.map((r) => r.staffCode).join(', ')}. Pass a different --login-prefix.`,
      );
    }

    const created = await tx.clinic.create({
      data: {
        name: demoClinicName(config.name, config.location),
        county: config.county,
        ussdCode: `demo-${config.key}`,
        // Random and never shown: demo clinics take no staff sign-ups anyway.
        inviteCode: `DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        isDemo: true,
        demoKey: config.key,
        demoConfig: config as unknown as Prisma.InputJsonValue,
      },
    });
    await buildClinic(tx, created.id, config, pinHash, now);
    return created;
  }, TX_OPTIONS);

  const stored = (await prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } }))
    .demoConfig as unknown as DemoConfig;
  return describe(stored, clinic, pin);
}

/** Payment settings, departments, staff, patients and the scenario, for a clinic that has none of them. */
async function buildClinic(
  tx: Prisma.TransactionClient,
  clinicId: string,
  config: DemoConfig,
  pinHash: string,
  now: Date,
): Promise<void> {
  await tx.clinicPaymentSettings.create({
    data: {
      clinicId,
      acceptsCash: true,
      acceptsCard: true,
      acceptsMobileMoney: true,
      mobileMoneyType: 'TILL',
      // Obviously not a real till: M-Pesa is simulated at a demo clinic.
      mobileMoneyNumber: '000000',
      defaultConsultationFeeKes: CLINIC_DEFAULT_FEE_KES,
    },
  });
  const deptId = new Map<string, string>();
  for (const d of config.departments) {
    const created = await tx.department.create({
      data: {
        clinicId,
        name: d.name,
        nameKey: d.name.toLowerCase(),
        code: d.code,
        consultationFeeKes: d.consultationFeeKes ?? null,
      },
    });
    deptId.set(d.code, created.id);
  }
  for (const s of staffFor(config)) {
    await tx.staff.create({
      data: {
        clinicId,
        staffCode: s.code,
        phoneNumber: s.phone,
        name: s.name,
        pinHash,
        role: s.role,
        departmentId: s.departmentCodes[0] ? deptId.get(s.departmentCodes[0])! : null,
        // Doctors are "in today", so a live check-in is assigned to one.
        ...(s.role === 'DOCTOR' ? { presenceOverride: 'IN' as const, presenceOverrideAt: now } : {}),
        departments:
          s.role === 'DOCTOR'
            ? { create: s.departmentCodes.map((code) => ({ departmentId: deptId.get(code)! })) }
            : undefined,
      },
    });
  }
  for (const [i, seed] of DEMO_PATIENTS.entries()) {
    await tx.patient.create({
      data: {
        ...patientData(seed, config.county),
        patientCode: await uniquePatientCode(tx),
        phoneNumber: demoPhone(config.phoneBlock, i + 1),
        pinHash,
        demoClinicId: clinicId,
      },
    });
  }
  await seedScenario(tx, clinicId, config, now);
}

async function findDemo(key: string) {
  const clinic = await prisma.clinic.findUnique({ where: { demoKey: key } });
  if (!clinic) throw new DemoClinicError(`There is no demo "${key}". Create it with seed first.`);
  if (!clinic.isDemo || !clinic.demoConfig)
    throw new DemoClinicError(`Clinic "${clinic.name}" is not a demo clinic; refusing to touch it.`);
  return { clinic, config: clinic.demoConfig as unknown as DemoConfig };
}

/**
 * Deletes everything that happened at a demo clinic (visits, check-ins,
 * bills, payments, appointments, check-in acknowledgments), inside the
 * caller's transaction. Only rows tied to this clinic's id are touched. The
 * audit log is append-only and is left as it is.
 */
async function wipeActivity(tx: Prisma.TransactionClient, clinicId: string): Promise<void> {
  const checkInIds = (await tx.checkIn.findMany({ where: { clinicId }, select: { id: true } })).map(
    (c) => c.id,
  );
  await tx.legalAcceptance.deleteMany({
    where: {
      OR: [
        { checkInId: { in: checkInIds } },
        { clinicId, context: { in: ['WALK_IN_CHECKIN', 'PATIENT_WEB_CHECKIN'] } },
      ],
    },
  });
  await tx.payment.deleteMany({ where: { clinicId } });
  await tx.bill.deleteMany({ where: { clinicId } }); // bill items cascade
  await tx.mpesaTransaction.deleteMany({ where: { checkInId: { in: checkInIds } } });
  await tx.encounter.deleteMany({ where: { clinicId } });
  await tx.checkIn.deleteMany({ where: { clinicId } });
  await tx.appointment.deleteMany({ where: { clinicId } });
}

/**
 * Puts a demo clinic back exactly as seeded, so the demo can be run again:
 * today's queue and past visits recreated (times relative to now),
 * everything done during the demo removed, departments, payment settings,
 * logins and patients restored. Logins, PIN and patient numbers stay the
 * same (a new DEMO_PIN replaces the PIN), and so do Terms already accepted
 * by those logins. Only this demo clinic and its demo patients are touched.
 */
export async function resetDemoClinic(
  key: string,
  options: { pin?: string; now?: Date } = {},
): Promise<DemoSeedResult> {
  const now = options.now ?? new Date();
  const { clinic, config } = await findDemo(key);
  const newPinHash = options.pin ? await hashPin(chooseDemoPin(options.pin)) : null;

  await prisma.$transaction(async (tx) => {
    await wipeActivity(tx, clinic.id);

    // Payment settings as seeded.
    await tx.clinicPaymentSettings.deleteMany({ where: { clinicId: clinic.id } });

    // Departments as seeded: keep the ids of the configured ones, drop any
    // added during the demo (nothing points at them once activity is gone).
    const staffSeeds = staffFor(config);
    const staffRows = await tx.staff.findMany({ where: { clinicId: clinic.id } });
    await tx.staffDepartment.deleteMany({ where: { staffId: { in: staffRows.map((s) => s.id) } } });
    await tx.staff.updateMany({ where: { clinicId: clinic.id }, data: { departmentId: null } });
    const existing = await tx.department.findMany({ where: { clinicId: clinic.id } });
    const deptId = new Map<string, string>();
    for (const d of config.departments) {
      const data = {
        name: d.name,
        nameKey: d.name.toLowerCase(),
        code: d.code,
        consultationFeeKes: d.consultationFeeKes ?? null,
        isActive: true,
      };
      const match = existing.find((e) => e.code === d.code);
      // Free the name first in case another department took it during the demo.
      await tx.department.deleteMany({
        where: { clinicId: clinic.id, nameKey: data.nameKey, NOT: { code: d.code } },
      });
      const row = match
        ? await tx.department.update({ where: { id: match.id }, data })
        : await tx.department.create({ data: { clinicId: clinic.id, ...data } });
      deptId.set(d.code, row.id);
    }
    await tx.department.deleteMany({ where: { clinicId: clinic.id, id: { notIn: [...deptId.values()] } } });

    // Logins as seeded.
    for (const s of staffSeeds) {
      const row = staffRows.find((r) => r.staffCode === s.code);
      if (!row)
        throw new DemoClinicError(`Demo login ${s.code} is missing. Delete the demo and seed it again.`);
      await tx.staff.update({
        where: { id: row.id },
        data: {
          name: s.name,
          role: s.role,
          isActive: true,
          departmentId: s.departmentCodes[0] ? deptId.get(s.departmentCodes[0])! : null,
          ...(newPinHash ? { pinHash: newPinHash } : {}),
          ...(s.role === 'DOCTOR'
            ? { presenceOverride: 'IN' as const, presenceOverrideAt: now }
            : { presenceOverride: null, presenceOverrideAt: null }),
          departments:
            s.role === 'DOCTOR'
              ? { create: s.departmentCodes.map((code) => ({ departmentId: deptId.get(code)! })) }
              : undefined,
        },
      });
    }

    // Patients as seeded (same patient IDs and numbers), without anything
    // added during the demo.
    const patients = await tx.patient.findMany({ where: { demoClinicId: clinic.id } });
    const seededPhones = DEMO_PATIENTS.map((_, i) => demoPhone(config.phoneBlock, i + 1));
    for (const [i, seed] of DEMO_PATIENTS.entries()) {
      const row = patients.find((p) => p.phoneNumber === seededPhones[i]);
      if (!row)
        throw new DemoClinicError(
          `Demo patient ${seed.firstName} ${seed.lastName} is missing. Delete the demo and seed it again.`,
        );
      await tx.patient.update({
        where: { id: row.id },
        data: { ...patientData(seed, config.county), ...(newPinHash ? { pinHash: newPinHash } : {}) },
      });
    }
    await tx.consent.deleteMany({
      where: { patientId: { in: patients.map((p) => p.id) }, type: 'SMS_CLINIC_MESSAGES' },
    });

    await tx.clinicPaymentSettings.create({
      data: {
        clinicId: clinic.id,
        acceptsCash: true,
        acceptsCard: true,
        acceptsMobileMoney: true,
        mobileMoneyType: 'TILL',
        mobileMoneyNumber: '000000',
        defaultConsultationFeeKes: CLINIC_DEFAULT_FEE_KES,
      },
    });
    await tx.clinic.update({
      where: { id: clinic.id },
      data: { name: demoClinicName(config.name, config.location), isActive: true },
    });

    await seedScenario(tx, clinic.id, config, now);
  }, TX_OPTIONS);

  return describe(config, clinic, options.pin ?? '(unchanged)');
}

/**
 * Removes a demo clinic completely, in one transaction: everything recorded
 * there, its logins, departments and settings, its demo patients, and the
 * audit entries made by its logins (they can't outlive the logins). Refuses
 * anything that isn't a demo clinic.
 */
export async function deleteDemoClinic(
  key: string,
): Promise<{ deleted: boolean; clinicName: string | null }> {
  const clinic = await prisma.clinic.findUnique({ where: { demoKey: key } });
  if (!clinic) return { deleted: false, clinicName: null };
  if (!clinic.isDemo)
    throw new DemoClinicError(`Clinic "${clinic.name}" is not a demo clinic; refusing to delete it.`);

  await prisma.$transaction(async (tx) => {
    const clinicId = clinic.id;
    await wipeActivity(tx, clinicId);
    const staffIds = (await tx.staff.findMany({ where: { clinicId }, select: { id: true } })).map(
      (s) => s.id,
    );
    const patientIds = (
      await tx.patient.findMany({ where: { demoClinicId: clinicId }, select: { id: true } })
    ).map((p) => p.id);
    await tx.legalAcceptance.deleteMany({
      where: { OR: [{ clinicId }, { staffId: { in: staffIds } }, { patientId: { in: patientIds } }] },
    });
    await tx.auditLog.deleteMany({ where: { staffId: { in: staffIds } } });
    await tx.staffOtp.deleteMany({ where: { staffId: { in: staffIds } } });
    await tx.staff.deleteMany({ where: { clinicId } }); // staff departments cascade
    await tx.department.deleteMany({ where: { clinicId } });
    await tx.clinicPaymentSettings.deleteMany({ where: { clinicId } });
    await tx.consent.deleteMany({ where: { patientId: { in: patientIds } } });
    await tx.otp.deleteMany({ where: { patientId: { in: patientIds } } });
    await tx.patient.deleteMany({ where: { id: { in: patientIds } } });
    await tx.clinic.delete({ where: { id: clinicId } });
  }, TX_OPTIONS);

  // Log out anyone still signed in to the demo's logins.
  try {
    await revokeSessionsFor(`clinic:${clinic.id}`);
  } catch {
    // Redis unavailable: their session cookies point at staff that no longer exist anyway.
  }
  return { deleted: true, clinicName: clinic.name };
}

/** The stored parameters and a description of a demo, for printing. */
export async function describeDemoClinic(key: string): Promise<DemoSeedResult> {
  const { clinic, config } = await findDemo(key);
  return describe(config, clinic, '(unchanged)');
}

export async function listDemoClinics(): Promise<{ key: string; name: string }[]> {
  const rows = await prisma.clinic.findMany({
    where: { isDemo: true },
    select: { demoKey: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ key: r.demoKey ?? '', name: r.name }));
}
