import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));

jest.mock('../../src/services/checkInService', () => ({
  confirmCheckInPaidManually: jest.fn(),
  CheckInNotPendingError: class CheckInNotPendingError extends Error {
    constructor() {
      super('This check-in is not awaiting payment');
      this.name = 'CheckInNotPendingError';
    }
  },
}));

jest.mock('../../src/services/encounterService', () => ({
  checkoutEncounter: jest.fn(),
  EncounterNotReadyForCheckoutError: class EncounterNotReadyForCheckoutError extends Error {
    constructor() {
      super('This visit is not ready for checkout yet');
      this.name = 'EncounterNotReadyForCheckoutError';
    }
  },
}));

jest.mock('../../src/services/doctorReassignmentService', () => ({
  ...jest.requireActual('../../src/services/doctorReassignmentService'),
  listDoctorOptions: jest.fn(),
  changeDoctor: jest.fn(),
}));

jest.mock('../../src/services/departmentService', () => ({
  ...jest.requireActual('../../src/services/departmentService'),
  getDoctorDepartmentIds: jest.fn(),
}));

jest.mock('../../src/db/prisma', () => ({
  prisma: {
    checkIn: { findMany: jest.fn() },
    encounter: { findFirst: jest.fn() },
  },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { confirmCheckInPaidManually, CheckInNotPendingError } from '../../src/services/checkInService';
import { checkoutEncounter, EncounterNotReadyForCheckoutError } from '../../src/services/encounterService';
import { prisma } from '../../src/db/prisma';
import { checkinsRouter } from '../../src/dashboard/checkins';
import { changeDoctor, listDoctorOptions, ReassignError } from '../../src/services/doctorReassignmentService';
import { getDoctorDepartmentIds } from '../../src/services/departmentService';

const mockLoadSession = loadDashboardSession as jest.Mock;
const mockConfirmPaid = confirmCheckInPaidManually as jest.Mock;
const mockCheckout = checkoutEncounter as jest.Mock;
const mockFindManyCheckIns = prisma.checkIn.findMany as jest.Mock;
const mockFindFirstEncounter = prisma.encounter.findFirst as jest.Mock;

const SESSION = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-TEST',
  staffName: 'Test Receptionist',
  role: 'RECEPTIONIST',
  clinicId: 'clinic-1',
  clinicName: 'Sunrise Family Clinic',
  departmentId: null,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/checkins', checkinsRouter);
  return app;
}

function withCookie(req: request.Test) {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadSession.mockResolvedValue(SESSION);
});

describe('GET /checkins/today', () => {
  function row(id: string, patientId: string, status: string) {
    return {
      id,
      patientId,
      amountKes: '50',
      status,
      paidAt: null,
      createdAt: new Date(),
      patient: {
        firstName: 'Jane',
        lastName: 'Wanjiru',
        patientCode: 'ACI-1042',
        phoneNumber: '+254712345678',
      },
      department: { id: 'dept-1', name: 'General', code: 'GEN' },
      encounter: null,
    };
  }

  it("drops a FAILED check-in once the same patient has paid at this clinic today, but keeps other patients' failed ones", async () => {
    mockFindManyCheckIns
      .mockResolvedValueOnce([
        row('ci-paid', 'p-1', 'PAID'),
        row('ci-failed', 'p-1', 'FAILED'),
        row('ci-other-failed', 'p-2', 'FAILED'),
      ])
      .mockResolvedValueOnce([{ patientId: 'p-1' }]);

    const res = await withCookie(request(buildApp()).get('/checkins/today'));

    expect(res.body.checkIns.map((c: { checkInId: string }) => c.checkInId)).toEqual([
      'ci-paid',
      'ci-other-failed',
    ]);
    // Clinic-wide lookup, so a paid retry in another department still counts.
    expect(mockFindManyCheckIns.mock.calls[1][0].where).toMatchObject({
      clinicId: 'clinic-1',
      status: { in: ['PAID', 'NO_FEE'] },
      patientId: { in: ['p-1', 'p-2'] },
    });
    expect(mockFindManyCheckIns.mock.calls[1][0].where).not.toHaveProperty('departmentId');
  });

  it('skips the extra lookup when nothing failed', async () => {
    mockFindManyCheckIns.mockResolvedValueOnce([row('ci-paid', 'p-1', 'PAID')]);
    await withCookie(request(buildApp()).get('/checkins/today'));
    expect(mockFindManyCheckIns).toHaveBeenCalledTimes(1);
  });

  it('shows a doctor only the patients in their own departments', async () => {
    mockLoadSession.mockResolvedValue({ ...SESSION, role: 'DOCTOR', staffId: 'doc-1' });
    (getDoctorDepartmentIds as jest.Mock).mockResolvedValue(['dept-braces', 'dept-invisalign']);
    mockFindManyCheckIns.mockResolvedValue([]);

    await withCookie(request(buildApp()).get('/checkins/today'));

    expect(getDoctorDepartmentIds).toHaveBeenCalledWith('doc-1');
    expect(mockFindManyCheckIns).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clinicId: 'clinic-1',
          departmentId: { in: ['dept-braces', 'dept-invisalign'] },
        }),
      }),
    );
  });

  it('shows front desk every department', async () => {
    mockFindManyCheckIns.mockResolvedValue([]);

    await withCookie(request(buildApp()).get('/checkins/today'));

    expect(getDoctorDepartmentIds).not.toHaveBeenCalled();
    expect(mockFindManyCheckIns.mock.calls[0][0].where).not.toHaveProperty('departmentId');
  });

  it('includes department name and encounter status per row', async () => {
    mockFindManyCheckIns.mockResolvedValue([
      {
        id: 'ci-1',
        patientId: 'p-1',
        amountKes: '50',
        status: 'PAID',
        paidAt: new Date(),
        createdAt: new Date(),
        patient: {
          firstName: 'Jane',
          lastName: 'Wanjiru',
          patientCode: 'ACI-1042',
          phoneNumber: '+254712345678',
        },
        department: { name: 'General' },
        encounter: { id: 'enc-1', status: 'WAITING', assignedDoctor: { name: 'Dr. Amani Wambui' } },
      },
    ]);

    const res = await withCookie(request(buildApp()).get('/checkins/today'));

    expect(res.status).toBe(200);
    expect(res.body.checkIns[0]).toMatchObject({
      checkInId: 'ci-1',
      encounterId: 'enc-1',
      departmentName: 'General',
      encounterStatus: 'WAITING',
      checkInStatus: 'PAID',
      assignedDoctorName: 'Dr. Amani Wambui',
    });
  });

  it('includes FAILED check-ins (not just PENDING_PAYMENT/PAID) so front desk can rescue a failed M-Pesa attempt', async () => {
    mockFindManyCheckIns.mockResolvedValue([]);

    await withCookie(request(buildApp()).get('/checkins/today'));

    expect(mockFindManyCheckIns).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['PENDING_PAYMENT', 'PAID', 'FAILED', 'NO_FEE'] } }),
      }),
    );
  });

  it('includes walk-ins (NO_FEE) and reports their source and who checked them in', async () => {
    mockFindManyCheckIns.mockResolvedValue([
      {
        id: 'ci-walk',
        patientId: 'p-1',
        patient: {
          firstName: 'Jane',
          lastName: 'Wanjiru',
          patientCode: 'ACI-7F2K',
          phoneNumber: '+254712345678',
          email: null,
        },
        department: { name: 'General' },
        staff: { name: 'Test Receptionist' },
        amountKes: 0,
        status: 'NO_FEE',
        source: 'WALK_IN',
        encounter: { id: 'enc-1', status: 'WAITING', assignedDoctor: null },
        paidAt: null,
        createdAt: new Date(),
      },
    ]);

    const res = await withCookie(request(buildApp()).get('/checkins/today'));

    expect(res.body.checkIns[0]).toMatchObject({
      checkInStatus: 'NO_FEE',
      source: 'WALK_IN',
      checkedInByName: 'Test Receptionist',
      amountKes: 0,
      encounterStatus: 'WAITING',
    });
  });

  it('reports assignedDoctorName as null when the encounter has no assigned doctor', async () => {
    mockFindManyCheckIns.mockResolvedValue([
      {
        id: 'ci-2',
        patientId: 'p-2',
        amountKes: '50',
        status: 'PAID',
        paidAt: new Date(),
        createdAt: new Date(),
        patient: {
          firstName: 'Amos',
          lastName: 'Kiptoo',
          patientCode: 'ACI-2091',
          phoneNumber: '+254798765432',
        },
        department: { name: 'General' },
        encounter: { id: 'enc-2', status: 'WAITING', assignedDoctor: null },
      },
    ]);

    const res = await withCookie(request(buildApp()).get('/checkins/today'));

    expect(res.body.checkIns[0]).toMatchObject({ assignedDoctorName: null });
  });

  it("includes each row's patientEmail (null when not on file) and a top-level emailDeliveryAvailable flag", async () => {
    mockFindManyCheckIns.mockResolvedValue([
      {
        id: 'ci-3',
        patientId: 'p-3',
        amountKes: '50',
        status: 'PAID',
        paidAt: new Date(),
        createdAt: new Date(),
        patient: {
          firstName: 'Jane',
          lastName: 'Wanjiru',
          patientCode: 'ACI-1042',
          phoneNumber: '+254712345678',
          email: 'jane@example.com',
        },
        department: { name: 'General' },
        encounter: null,
      },
      {
        id: 'ci-4',
        patientId: 'p-4',
        amountKes: '50',
        status: 'PAID',
        paidAt: new Date(),
        createdAt: new Date(),
        patient: {
          firstName: 'Amos',
          lastName: 'Kiptoo',
          patientCode: 'ACI-2091',
          phoneNumber: '+254798765432',
          email: null,
        },
        department: { name: 'General' },
        encounter: null,
      },
    ]);

    const res = await withCookie(request(buildApp()).get('/checkins/today'));

    expect(typeof res.body.emailDeliveryAvailable).toBe('boolean');
    expect(res.body.checkIns[0]).toMatchObject({ patientEmail: 'jane@example.com' });
    expect(res.body.checkIns[1]).toMatchObject({ patientEmail: null });
  });
});

describe('POST /checkins/:id/confirm-payment', () => {
  it('confirms payment and returns the updated status', async () => {
    mockConfirmPaid.mockResolvedValue({ id: 'ci-1', status: 'PAID' });

    const res = await withCookie(request(buildApp()).post('/checkins/ci-1/confirm-payment'));

    expect(res.status).toBe(200);
    expect(mockConfirmPaid).toHaveBeenCalledWith('ci-1', 'clinic-1', 'staff-1');
    expect(res.body.status).toBe('PAID');
  });

  it('rejects a check-in that is not pending payment', async () => {
    mockConfirmPaid.mockRejectedValue(new CheckInNotPendingError());

    const res = await withCookie(request(buildApp()).post('/checkins/ci-1/confirm-payment'));

    expect(res.status).toBe(409);
  });
});

describe('POST /checkins/:id/checkout', () => {
  it('returns 404 when no encounter matches this check-in in this clinic', async () => {
    mockFindFirstEncounter.mockResolvedValue(null);

    const res = await withCookie(request(buildApp()).post('/checkins/ci-1/checkout'));

    expect(res.status).toBe(404);
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it('checks the visit out once ready, defaulting to SMS-only delivery when no method is given', async () => {
    mockFindFirstEncounter.mockResolvedValue({ id: 'enc-1' });
    mockCheckout.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    const res = await withCookie(request(buildApp()).post('/checkins/ci-1/checkout'));

    expect(res.status).toBe(200);
    expect(mockCheckout).toHaveBeenCalledWith('enc-1', 'clinic-1', 'staff-1', 'sms');
    expect(res.body.status).toBe('DONE');
  });

  it('passes through an explicit sms_and_email delivery choice', async () => {
    mockFindFirstEncounter.mockResolvedValue({ id: 'enc-1' });
    mockCheckout.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    const res = await withCookie(
      request(buildApp()).post('/checkins/ci-1/checkout').send({ deliveryMethod: 'sms_and_email' }),
    );

    expect(res.status).toBe(200);
    expect(mockCheckout).toHaveBeenCalledWith('enc-1', 'clinic-1', 'staff-1', 'sms_and_email');
  });

  it('rejects an invalid delivery method', async () => {
    const res = await withCookie(
      request(buildApp()).post('/checkins/ci-1/checkout').send({ deliveryMethod: 'carrier_pigeon' }),
    );

    expect(res.status).toBe(400);
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it('rejects a visit that is not ready for checkout', async () => {
    mockFindFirstEncounter.mockResolvedValue({ id: 'enc-1' });
    mockCheckout.mockRejectedValue(new EncounterNotReadyForCheckoutError());

    const res = await withCookie(request(buildApp()).post('/checkins/ci-1/checkout'));

    expect(res.status).toBe(409);
  });
});

describe('change doctor', () => {
  const mockList = listDoctorOptions as jest.Mock;
  const mockChange = changeDoctor as jest.Mock;

  it('lists doctor options for front desk', async () => {
    mockList.mockResolvedValue({ currentDoctorId: 'doc-a', doctors: [] });
    const res = await withCookie(request(buildApp()).get('/checkins/ci-1/doctor-options'));
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith('ci-1', 'clinic-1');
  });

  it('moves a patient and passes who did it', async () => {
    mockChange.mockResolvedValue({ changed: true, doctorName: 'Dr. Lisa' });
    const res = await withCookie(
      request(buildApp()).post('/checkins/ci-1/doctor').send({ doctorId: 'doc-b' }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ changed: true, doctorName: 'Dr. Lisa' });
    expect(mockChange).toHaveBeenCalledWith({
      checkInId: 'ci-1',
      clinicId: 'clinic-1',
      doctorId: 'doc-b',
      staffId: 'staff-1',
    });
  });

  it('refuses doctors on the server', async () => {
    mockLoadSession.mockResolvedValue({ ...SESSION, role: 'DOCTOR', departmentId: 'dept-1' });
    expect((await withCookie(request(buildApp()).get('/checkins/ci-1/doctor-options'))).status).toBe(403);
    expect(
      (await withCookie(request(buildApp()).post('/checkins/ci-1/doctor').send({ doctorId: 'doc-b' })))
        .status,
    ).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockChange).not.toHaveBeenCalled();
  });

  it('requires a doctor', async () => {
    expect((await withCookie(request(buildApp()).post('/checkins/ci-1/doctor').send({}))).status).toBe(400);
    expect(mockChange).not.toHaveBeenCalled();
  });

  it('turns rule errors into their status and message', async () => {
    mockChange.mockRejectedValue(
      new ReassignError('Only a patient who is still waiting can be moved to another doctor.', 409),
    );
    const res = await withCookie(
      request(buildApp()).post('/checkins/ci-1/doctor').send({ doctorId: 'doc-b' }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('still waiting');
  });
});
