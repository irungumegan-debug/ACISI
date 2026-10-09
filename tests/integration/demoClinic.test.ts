/**
 * Demo clinic seed, reset and delete against a real Postgres, proving they
 * only ever touch the demo clinic. Runs only when TEST_DATABASE_URL points at
 * a disposable, already-migrated database whose name contains "test" (every
 * table in it is emptied first):
 *
 *   createdb acisi_test && DATABASE_URL=<url> npx prisma migrate deploy
 *   TEST_DATABASE_URL=<url> npx jest tests/integration
 *
 * The core check: snapshot every row of every table, then seed the demo,
 * run a real patient's visit through it, reset it and delete it. Afterwards
 * the whole database must be exactly the snapshot again — not one row of any
 * real clinic, staff member or patient added, changed or removed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
const describeDb = TEST_DB && /test/i.test(new URL(TEST_DB).pathname) ? describe : describe.skip;

type Service = typeof import('../../src/services/demoClinicService');

const westlands = JSON.parse(fs.readFileSync(path.join(__dirname, '../../demo/westlands.json'), 'utf8'));
const alina = JSON.parse(fs.readFileSync(path.join(__dirname, '../../demo/alina.json'), 'utf8'));

describeDb('demo clinics against a real database', () => {
  // Real database work (several seeds and resets per test): Jest's 5s default is too tight on a cold database.
  jest.setTimeout(60_000);

  let prisma: PrismaClient;
  let demo: Service;
  let tables: string[];

  /** Every row of every table, as JSON, keyed by table. */
  async function snapshot(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const t of tables) {
      const rows = await prisma.$queryRawUnsafe<unknown[]>(
        `SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`,
      );
      out[t] = (rows as { j: string }[]).map((r) => r.j);
    }
    return out;
  }

  /** A real clinic with staff, a patient, a paid and checked-out visit, and audit and legal rows. */
  async function seedRealWorld(): Promise<{ clinicId: string; patientId: string; staffId: string }> {
    const clinic = await prisma.clinic.create({
      data: { name: 'Real Clinic', ussdCode: '401', inviteCode: 'REAL-AAAA' },
    });
    const dept = await prisma.department.create({
      data: { clinicId: clinic.id, name: 'General', nameKey: 'general', code: 'GEN' },
    });
    const doctor = await prisma.staff.create({
      data: {
        clinicId: clinic.id,
        staffCode: 'ACI-STF-REAL',
        phoneNumber: '+254711000001',
        name: 'Dr. Real',
        pinHash: 'x',
        role: 'DOCTOR',
        departmentId: dept.id,
        departments: { create: [{ departmentId: dept.id }] },
      },
    });
    const patient = await prisma.patient.create({
      data: { patientCode: 'ACI-REAL', phoneNumber: '+254711000002', firstName: 'Real', lastName: 'Patient' },
    });
    await prisma.consent.create({
      data: {
        patientId: patient.id,
        type: 'PLATFORM_REGISTRATION',
        granted: true,
        channel: 'WEB',
        version: '1',
      },
    });
    const checkIn = await prisma.checkIn.create({
      data: {
        patientId: patient.id,
        clinicId: clinic.id,
        departmentId: dept.id,
        ussdSessionId: 'REAL-1',
        amountKes: 100,
        status: 'PAID',
        paidAt: new Date(),
        mpesaCheckoutRequestId: 'ws_CO_REAL',
      },
    });
    await prisma.mpesaTransaction.create({
      data: {
        checkInId: checkIn.id,
        merchantRequestId: 'mr',
        checkoutRequestId: 'ws_CO_REAL',
        resultCode: 0,
        phoneNumber: '254711000002',
        amountKes: 100,
      },
    });
    const encounter = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        clinicId: clinic.id,
        checkInId: checkIn.id,
        assignedDoctorId: doctor.id,
        status: 'DONE',
        diagnosis: 'Real',
      },
    });
    const bill = await prisma.bill.create({
      data: {
        billNumber: 'B-REAL01',
        encounterId: encounter.id,
        clinicId: clinic.id,
        createdByStaffId: doctor.id,
        subtotalKes: 500,
        totalKes: 500,
        paidKes: 500,
        status: 'PAID',
        items: {
          create: [{ kind: 'CONSULTATION', description: 'Consultation', amountKes: 500, position: 0 }],
        },
      },
    });
    await prisma.payment.create({
      data: {
        billId: bill.id,
        clinicId: clinic.id,
        method: 'CASH',
        status: 'SUCCEEDED',
        amountKes: 500,
        idempotencyKey: 'real-1',
        takenByStaffId: doctor.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorType: 'STAFF',
        actorId: doctor.id,
        staffId: doctor.id,
        action: 'X',
        entityType: 'Encounter',
        entityId: encounter.id,
      },
    });
    await prisma.legalAcceptance.create({
      data: { document: 'TERMS_OF_SERVICE', version: '1', context: 'STAFF_LOGIN', staffId: doctor.id },
    });
    return { clinicId: clinic.id, patientId: patient.id, staffId: doctor.id };
  }

  /** The presenter's own (real) account doing a live check-in at the demo: paid, with the doctor, audited. */
  async function liveCheckInAtDemo(patientId: string, demoKey: string): Promise<void> {
    const clinic = await prisma.clinic.findUniqueOrThrow({
      where: { demoKey },
      include: { departments: true, staff: true },
    });
    const checkIn = await prisma.checkIn.create({
      data: {
        patientId,
        clinicId: clinic.id,
        departmentId: clinic.departments[0]!.id,
        ussdSessionId: `WEB-live-${demoKey}`,
        amountKes: 150,
        status: 'PAID',
        paidAt: new Date(),
        mpesaCheckoutRequestId: `ws_CO_live_${demoKey}`,
      },
    });
    await prisma.mpesaTransaction.create({
      data: {
        checkInId: checkIn.id,
        merchantRequestId: 'mr',
        checkoutRequestId: `ws_CO_live_${demoKey}`,
        resultCode: 0,
        phoneNumber: '254711000002',
        amountKes: 150,
      },
    });
    const encounter = await prisma.encounter.create({
      data: {
        patientId,
        clinicId: clinic.id,
        checkInId: checkIn.id,
        status: 'IN_CONSULTATION',
        assignedDoctorId: clinic.staff.find((s) => s.role === 'DOCTOR')!.id,
      },
    });
    await prisma.legalAcceptance.create({
      data: {
        document: 'PRIVACY_NOTICE',
        version: '1',
        context: 'PATIENT_WEB_CHECKIN',
        patientId,
        clinicId: clinic.id,
        checkInId: checkIn.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorType: 'PATIENT',
        actorId: patientId,
        action: 'CHECK_IN_CREATED',
        entityType: 'CheckIn',
        entityId: checkIn.id,
      },
    });
    await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', action: 'CHECK_IN_PAID', entityType: 'Encounter', entityId: encounter.id },
    });
  }

  beforeAll(async () => {
    // Required here, after DATABASE_URL points at the test database.
    prisma = (await import('../../src/db/prisma')).prisma;
    demo = await import('../../src/services/demoClinicService');
    const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`,
    );
    tables = rows.map((r) => r.tablename);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    // Opened by deleteDemoClinic's session revocation; left open, Jest never exits.
    const { redis, redisQueueConnection } = await import('../../src/config/redis');
    redis.disconnect();
    redisQueueConnection.disconnect();
  });

  it('seed → live check-in → reset → delete leaves every other row in the database exactly as it was', async () => {
    const real = await seedRealWorld();
    await demo.seedDemoClinic(alina, { pin: '482915' }); // a second demo, which must survive too
    const before = await snapshot();

    await demo.seedDemoClinic(westlands, { pin: '482915' });
    await liveCheckInAtDemo(real.patientId, 'westlands');
    await demo.resetDemoClinic(westlands, { pin: '482915' });
    await liveCheckInAtDemo(real.patientId, 'westlands');
    const result = await demo.deleteDemoClinic('westlands');

    expect(result).toEqual({ deleted: true, keptPatientIds: [] });
    expect(await snapshot()).toEqual(before);
  });

  it('reset leaves every row outside the demo clinic untouched, and removes the live visit made during the demo', async () => {
    const real = await seedRealWorld();
    await demo.seedDemoClinic(westlands, { pin: '482915' });
    await liveCheckInAtDemo(real.patientId, 'westlands');
    const before = await snapshot();

    await demo.resetDemoClinic(westlands, { pin: '482915' });

    // The real patient is still there, unchanged; their demo visit is gone.
    const after = await snapshot();
    expect(after.patients).toContain(before.patients!.find((j) => JSON.parse(j).id === real.patientId));
    expect(await prisma.checkIn.count({ where: { patientId: real.patientId } })).toBe(1);
    expect(await prisma.encounter.count({ where: { patientId: real.patientId } })).toBe(1);
    // Every row of the real clinic is byte-for-byte the same.
    for (const t of tables) {
      const realRows = (before[t] ?? []).filter((j) => j.includes(real.clinicId) || j.includes(real.staffId));
      for (const row of realRows) expect(after[t]).toContain(row);
    }
    // And the fresh demo is complete again.
    expect(await prisma.patient.count({ where: { demoClinic: { demoKey: 'westlands' } } })).toBe(8);
  });

  it('reset can run again and again, and the demo always comes back the same size', async () => {
    await seedRealWorld();
    for (let i = 0; i < 3; i++) await demo.resetDemoClinic(westlands, { pin: '482915' });
    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { demoKey: 'westlands' } });
    expect(await prisma.clinic.count({ where: { demoKey: 'westlands' } })).toBe(1);
    expect(await prisma.encounter.count({ where: { clinicId: clinic.id } })).toBe(10); // 8 today + 2 past visits
    expect(await prisma.staff.count({ where: { clinicId: clinic.id } })).toBe(7);
  });

  it('refuses to delete a clinic that is not a demo, and changes nothing', async () => {
    const real = await seedRealWorld();
    await prisma.clinic.update({ where: { id: real.clinicId }, data: { demoKey: 'real' } }); // a key, but isDemo false
    const before = await snapshot();

    await expect(demo.deleteDemoClinic('real')).rejects.toBeInstanceOf(demo.DemoClinicError);
    expect(await snapshot()).toEqual(before);
  });

  it('does nothing for an unknown demo', async () => {
    await seedRealWorld();
    const before = await snapshot();
    await expect(demo.deleteDemoClinic('nowhere')).resolves.toEqual({ deleted: false, keptPatientIds: [] });
    expect(await snapshot()).toEqual(before);
  });

  it('will not seed over a real account that holds one of the demo numbers, and writes nothing', async () => {
    await seedRealWorld();
    await prisma.patient.create({
      data: {
        patientCode: 'ACI-HOLD',
        phoneNumber: demo.demoPhone(1, 50),
        firstName: 'Real',
        lastName: 'Holder',
      },
    });
    const before = await snapshot();

    await expect(demo.seedDemoClinic(westlands, { pin: '482915' })).rejects.toThrow(
      'already belong to an account',
    );
    expect(await snapshot()).toEqual(before);
  });

  it('keeps a fake patient who somehow has a visit at a real clinic, rather than deleting a real record', async () => {
    const real = await seedRealWorld();
    await demo.seedDemoClinic(westlands, { pin: '482915' });
    const fake = await prisma.patient.findFirstOrThrow({ where: { demoClinic: { demoKey: 'westlands' } } });
    const dept = await prisma.department.findFirstOrThrow({ where: { clinicId: real.clinicId } });
    await prisma.checkIn.create({
      data: {
        patientId: fake.id,
        clinicId: real.clinicId,
        departmentId: dept.id,
        ussdSessionId: 'REAL-2',
        amountKes: 100,
        status: 'PAID',
      },
    });

    const result = await demo.deleteDemoClinic('westlands');

    expect(result.keptPatientIds).toEqual([fake.id]);
    expect(await prisma.patient.findUnique({ where: { id: fake.id } })).toMatchObject({ demoClinicId: null });
    expect(await prisma.checkIn.count({ where: { clinicId: real.clinicId } })).toBe(2);
  });
});
