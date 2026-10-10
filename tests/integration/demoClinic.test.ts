/**
 * Demo clinics against a real Postgres: the whole demo path (website
 * check-in with simulated payment, doctor, checkout, walk-in), reset and
 * delete — proving they only ever touch the demo clinic and its demo
 * patients. Runs only when TEST_DATABASE_URL points at a disposable,
 * already-migrated database whose name contains "test" (every table in it is
 * emptied first):
 *
 *   createdb acisi_test && DATABASE_URL=<url> npx prisma migrate deploy
 *   TEST_DATABASE_URL=<url> npx jest tests/integration
 *
 * The core check: snapshot every row of every table with a real clinic in
 * it, then seed two demos, run the demo, reset, and delete both. Afterwards
 * every table must be exactly the snapshot again (the append-only audit log
 * keeps every original row untouched; it may only have gained rows).
 */
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
const describeDb = TEST_DB && /test/i.test(new URL(TEST_DB).pathname) ? describe : describe.skip;

// Nothing may ever leave the building: M-Pesa and SMS throw if reached.
jest.mock('../../src/mpesa/stkPush', () => ({
  initiateStkPush: jest.fn(() => {
    throw new Error('STK push must never be sent in a demo');
  }),
}));
jest.mock('../../src/mpesa/clinicStk', () => ({
  clinicStkConfigured: jest.fn(() => false),
  sendClinicStkPush: jest.fn(() => {
    throw new Error('Clinic STK push must never be sent in a demo');
  }),
}));
jest.mock('../../src/jobs/queue', () => ({
  enqueueSmsReceipt: jest.fn(),
  enqueueVisitSummarySms: jest.fn(),
  enqueueVisitSummaryEmail: jest.fn(),
  scheduleClinicStkStatusCheck: jest.fn(),
}));
jest.mock('../../src/services/sessionRevocation', () => ({ revokeSessionsFor: jest.fn() }));

jest.setTimeout(60_000);

const ALINA = {
  key: 'alina',
  name: 'Alina Medical Centre',
  location: 'Hurlingham',
  departments: [
    { name: 'General Consultation', code: 'G' },
    { name: 'Paediatrics', code: 'P' },
    { name: 'Gynaecology & Antenatal', code: 'GY' },
    { name: 'Laboratory', code: 'L' },
    { name: 'Pharmacy', code: 'PH' },
  ],
};
const WESTLANDS = {
  key: 'westlands',
  name: 'Westlands Medical Centre',
  location: 'Westlands',
  departments: [
    { name: 'General Outpatient', code: 'GP', consultationFeeKes: 1200 },
    { name: 'Paediatrics', code: 'PAED' },
    { name: 'Dental', code: 'DEN' },
    { name: 'Laboratory', code: 'LAB' },
  ],
};
const PIN = '482915';

describeDb('demo clinics against a real database', () => {
  let prisma: PrismaClient;
  let demo: typeof import('../../src/services/demoClinicService');
  let tables: string[];

  async function snapshot(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const t of tables) {
      const rows = await prisma.$queryRawUnsafe<{ j: string }[]>(
        `SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`,
      );
      out[t] = rows.map((r) => r.j);
    }
    return out;
  }

  function expectUnchanged(before: Record<string, string[]>, after: Record<string, string[]>): void {
    for (const t of tables) {
      if (t === 'audit_logs') {
        // Append-only: every original row still there, exactly as it was.
        expect(after[t]).toEqual(expect.arrayContaining(before[t]!));
      } else {
        expect({ table: t, rows: after[t] }).toEqual({ table: t, rows: before[t] });
      }
    }
  }

  /** A real clinic with a doctor, a patient and a finished, paid visit. */
  async function seedRealWorld() {
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
    const checkIn = await prisma.checkIn.create({
      data: {
        patientId: patient.id,
        clinicId: clinic.id,
        departmentId: dept.id,
        ussdSessionId: 'REAL-1',
        amountKes: 100,
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    await prisma.encounter.create({
      data: {
        patientId: patient.id,
        clinicId: clinic.id,
        checkInId: checkIn.id,
        assignedDoctorId: doctor.id,
        status: 'DONE',
        diagnosis: 'Real',
      },
    });
    await prisma.legalAcceptance.create({
      data: { document: 'TERMS_OF_SERVICE', version: '1', context: 'STAFF_LOGIN', staffId: doctor.id },
    });
    await prisma.auditLog.create({
      data: {
        actorType: 'STAFF',
        actorId: doctor.id,
        staffId: doctor.id,
        action: 'X',
        entityType: 'Clinic',
        entityId: clinic.id,
      },
    });
    return { clinic, dept, patient };
  }

  /** What the demo looks like: today's queue by department and status, and past visits. */
  async function demoState(clinicId: string) {
    const encounters = await prisma.encounter.findMany({
      where: { clinicId },
      include: { patient: true, checkIn: { include: { department: true } }, assignedDoctor: true },
      orderBy: { createdAt: 'asc' },
    });
    return encounters
      .map(
        (e) =>
          `${e.patient.firstName} ${e.patient.lastName} | ${e.checkIn.department.code} | ${e.status} | ${e.checkIn.source}/${e.checkIn.status} | ${e.assignedDoctor?.name ?? '-'} | ${e.prescription ?? ''}`,
      )
      .sort();
  }

  beforeAll(async () => {
    ({ prisma } = await import('../../src/db/prisma'));
    demo = await import('../../src/services/demoClinicService');
    tables = (
      await prisma.$queryRawUnsafe<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`,
      )
    ).map((r) => r.tablename);
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs the demo, resets it and deletes it without touching anything real', async () => {
    const real = await seedRealWorld();
    const before = await snapshot();

    // --- Seed ---------------------------------------------------------------
    const alina = await demo.seedDemoClinic(ALINA, { pin: PIN });
    expect(alina.clinicName).toBe('Alina Medical Centre – Hurlingham (Demo)');
    expect(alina.patients.map((p) => p.phone)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `0700 000 00${n}`),
    );
    expect(alina.logins.map((l) => `${l.staffCode} ${l.name}`)).toEqual([
      'AMC-FD Faith Morgan',
      'AMC-DR1 Dr. Grace Bennett',
      'AMC-DR2 Dr. Daniel Brooks',
      'AMC-DR3 Dr. Sarah Collins',
      'AMC-LAB Ruth Hayes',
      'AMC-PH Samuel Grant',
    ]);
    const westlands = await demo.seedDemoClinic(WESTLANDS, { pin: PIN });
    expect(westlands.clinicName).toBe('Westlands Medical Centre (Demo)');
    expect(westlands.patients[0]!.phone).toBe('0700 000 101'); // the next free block
    await expect(demo.seedDemoClinic(ALINA, { pin: PIN })).rejects.toThrow('already exists');

    const seeded = await demoState(alina.clinicId);
    const today = (
      await prisma.encounter.findMany({
        where: {
          clinicId: alina.clinicId,
          status: 'WAITING',
          createdAt: { gte: new Date(Date.now() - 3 * 3600_000) },
        },
        include: { checkIn: { include: { department: true } } },
      })
    ).map((e) => e.checkIn.department.code);
    expect(today.filter((c) => c === 'G')).toHaveLength(2);
    expect(today.filter((c) => c === 'P')).toHaveLength(1);
    expect(today.filter((c) => c === 'GY')).toHaveLength(1);
    expect(today.filter((c) => c === 'L')).toHaveLength(1);
    expect(seeded).toContain(
      'Linda Parker | G | READY_FOR_CHECKOUT | REMOTE/PAID | Dr. Grace Bennett | Vitamin D3 1000 IU, one tablet daily for 30 days.',
    );
    expect(seeded.some((s) => s.startsWith('Brian Ellis | G | WAITING | WALK_IN/NO_FEE'))).toBe(true);

    // --- Owner site: demo left out of every total ----------------------------
    const { ownerOverviewRouter } = await import('../../src/owner/overview');
    const app = express().use('/', ownerOverviewRouter);
    const overview = (await request(app).get('/')).body;
    expect(overview).toMatchObject({
      clinics: { active: 1, total: 1 },
      staff: { total: 1 },
      patients: { active: 1 },
      visits: { total: 1 },
      revenueKes: { total: 100 },
    });

    // --- a) Joy checks in on the website and pays (simulated) ----------------
    const { initiateCheckIn, simulateCheckInPayment } = await import('../../src/services/checkInService');
    const { DemoBoundaryError } = await import('../../src/services/demoGuard');
    const joy = await prisma.patient.findUniqueOrThrow({ where: { phoneNumber: '+254700000001' } });
    const general = await prisma.department.findFirstOrThrow({
      where: { clinicId: alina.clinicId, code: 'G' },
    });
    const { checkIn } = await initiateCheckIn({
      ussdSessionId: 'WEB-demo-1',
      patientId: joy.id,
      clinicId: alina.clinicId,
      clinicName: alina.clinicName,
      departmentId: general.id,
      phoneNumberE164: joy.phoneNumber,
    });
    expect(checkIn).toMatchObject({ status: 'PENDING_PAYMENT', mpesaCheckoutRequestId: null });
    expect(Number(checkIn.amountKes)).toBe(100);
    const paid = await simulateCheckInPayment(checkIn.id, joy.id);
    expect(paid.status).toBe('PAID');

    // The boundary: no real patient at a demo clinic, no demo patient at a real clinic.
    await expect(
      initiateCheckIn({
        ussdSessionId: 'WEB-x',
        patientId: real.patient.id,
        clinicId: alina.clinicId,
        clinicName: 'x',
        departmentId: general.id,
        phoneNumberE164: real.patient.phoneNumber,
      }),
    ).rejects.toBeInstanceOf(DemoBoundaryError);
    await expect(
      initiateCheckIn({
        ussdSessionId: 'WEB-y',
        patientId: joy.id,
        clinicId: real.clinic.id,
        clinicName: 'x',
        departmentId: real.dept.id,
        phoneNumberE164: joy.phoneNumber,
      }),
    ).rejects.toBeInstanceOf(DemoBoundaryError);
    await expect(
      initiateCheckIn({
        ussdSessionId: 'WEB-z',
        patientId: joy.id,
        clinicId: westlands.clinicId,
        clinicName: 'x',
        departmentId: general.id,
        phoneNumberE164: joy.phoneNumber,
      }),
    ).rejects.toBeInstanceOf(DemoBoundaryError);

    // --- b) Walk-in at the front desk ----------------------------------------
    const { checkInWalkIn, lookupWalkInPatient, WalkInError } =
      await import('../../src/services/walkInService');
    const faith = await prisma.staff.findUniqueOrThrow({ where: { staffCode: 'AMC-FD' } });
    const victor = await lookupWalkInPatient('0700 000 006', alina.clinicId, faith.id);
    expect(victor.patient?.name).toBe('Victor Shaw');
    const walkIn = await checkInWalkIn({
      clinicId: alina.clinicId,
      staffId: faith.id,
      phone: '0700000006',
      departmentId: general.id,
      reasonForVisit: 'Routine check-up',
      smsConsent: false,
      privacyNoticeExplained: true,
    });
    expect(walkIn.patientName).toBe('Victor Shaw');
    // A real patient's number shows nothing at a demo clinic, and can't be added there.
    await expect(lookupWalkInPatient('0711000002', alina.clinicId, faith.id)).rejects.toBeInstanceOf(
      WalkInError,
    );
    await expect(lookupWalkInPatient('0711999999', alina.clinicId, faith.id)).rejects.toBeInstanceOf(
      WalkInError,
    );
    await expect(lookupWalkInPatient('0700000001', real.clinic.id, faith.id)).rejects.toBeInstanceOf(
      WalkInError,
    );

    // --- c) Doctor: own queue, past visit, consultation -----------------------
    const enc = await import('../../src/services/encounterService');
    const grace = await prisma.staff.findUniqueOrThrow({ where: { staffCode: 'AMC-DR1' } });
    const daniel = await prisma.staff.findUniqueOrThrow({ where: { staffCode: 'AMC-DR2' } });
    const joyVisit = await prisma.encounter.findUniqueOrThrow({ where: { checkInId: checkIn.id } });
    expect(joyVisit.assignedDoctorId).toBe(grace.id);
    const queue = await enc.getDoctorQueue(alina.clinicId, [general.id], grace.id);
    expect(queue.map((q) => q.patientName)).toEqual(
      expect.arrayContaining(['Joy Carter', 'Kevin Hart', 'Brian Ellis']),
    );
    // History only for the doctor whose queue she's in.
    const paeds = await prisma.department.findFirstOrThrow({
      where: { clinicId: alina.clinicId, code: 'P' },
    });
    await expect(
      enc.getEncounterForDoctor(joyVisit.id, alina.clinicId, [paeds.id], daniel.id),
    ).rejects.toBeInstanceOf(enc.EncounterNotAccessibleError);
    const detail = await enc.getEncounterForDoctor(joyVisit.id, alina.clinicId, [general.id], grace.id);
    expect(detail.history.some((h) => h.diagnosis?.startsWith('Routine check-up'))).toBe(true);
    await enc.submitConsultation({
      encounterId: joyVisit.id,
      clinicId: alina.clinicId,
      departmentIds: [general.id],
      staffId: grace.id,
      diagnosis: 'Routine follow-up visit.',
      prescription: 'Vitamin C 500 mg, one tablet daily for 14 days.',
      pin: PIN,
    });

    // --- d) Checkout: bill, simulated M-Pesa, summary --------------------------
    const billing = await import('../../src/services/billingService');
    await billing.saveBill({
      encounterId: joyVisit.id,
      clinicId: alina.clinicId,
      staffId: faith.id,
      items: [{ kind: 'CONSULTATION', description: 'Consultation', amountKes: 1000 }],
      discountKes: 0,
    });
    const view = await billing.getCheckoutView(joyVisit.id, alina.clinicId);
    expect(view).toMatchObject({
      isDemo: true,
      settings: { stkAvailable: true },
      // The prescription has flowed from the doctor to the front desk; the diagnosis has not.
      prescription: 'Vitamin C 500 mg, one tablet daily for 14 days.',
      prescribedBy: 'Dr. Grace Bennett',
    });
    expect(JSON.stringify(view)).not.toContain('Routine follow-up visit.');
    const { payment, bill } = await billing.requestStkPayment({
      billId: view.bill!.id,
      clinicId: alina.clinicId,
      staffId: faith.id,
      idempotencyKey: 'demo-pay-1',
      amountKes: 1000,
    });
    expect(payment).toMatchObject({ status: 'SUCCEEDED', resultDesc: billing.SIMULATED_MPESA_DESC });
    expect(bill.status).toBe('PAID');
    await enc.checkoutEncounter(joyVisit.id, alina.clinicId, faith.id);
    const { enqueueVisitSummarySms, enqueueSmsReceipt } = await import('../../src/jobs/queue');
    expect(enqueueVisitSummarySms).not.toHaveBeenCalled();

    // --- e) Patient's last visit ----------------------------------------------
    const { getOwnVisitHistory } = await import('../../src/services/patientService');
    const history = await getOwnVisitHistory(joy.id);
    expect(history[0]).toMatchObject({ prescription: 'Vitamin C 500 mg, one tablet daily for 14 days.' });

    // The SMS gate: a demo patient's number is never sent anything.
    const { isDemoRecipient } = await import('../../src/services/demoGuard');
    expect(await isDemoRecipient(joy.phoneNumber)).toBe(true);
    expect(await isDemoRecipient(real.patient.phoneNumber)).toBe(false);
    expect(enqueueSmsReceipt).toHaveBeenCalled(); // queued, but the gate in smsClient drops it

    // --- Reset ------------------------------------------------------------------
    await demo.resetDemoClinic('alina');
    expect(await demoState(alina.clinicId)).toEqual(seeded);
    const joyAfter = await prisma.patient.findUniqueOrThrow({ where: { id: joy.id } });
    expect(joyAfter.pinHash).toBe(joy.pinHash); // same logins and PIN after reset

    // --- Delete -------------------------------------------------------------------
    await expect(demo.deleteDemoClinic('nonexistent')).resolves.toEqual({ deleted: false, clinicName: null });
    await demo.deleteDemoClinic('alina');
    await demo.deleteDemoClinic('westlands');
    expectUnchanged(before, await snapshot());
  });

  it('refuses to reset or delete a clinic that is not a demo', async () => {
    await prisma.clinic.create({
      data: { name: 'Sneaky', ussdCode: '999', inviteCode: 'SNEAK-1', demoKey: 'sneaky' },
    });
    await expect(demo.deleteDemoClinic('sneaky')).rejects.toThrow('not a demo clinic');
    await expect(demo.resetDemoClinic('sneaky')).rejects.toThrow('not a demo clinic');
    expect(await prisma.clinic.count({ where: { demoKey: 'sneaky' } })).toBe(1);
  });
});
