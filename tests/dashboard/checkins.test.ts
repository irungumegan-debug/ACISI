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
  it('includes department name and encounter status per row', async () => {
    mockFindManyCheckIns.mockResolvedValue([
      {
        id: 'ci-1',
        patientId: 'p-1',
        amountKes: '50',
        status: 'PAID',
        paidAt: new Date(),
        createdAt: new Date(),
        patient: { firstName: 'Jane', lastName: 'Wanjiru', patientCode: 'ACI-1042', phoneNumber: '+254712345678' },
        department: { name: 'General' },
        encounter: { id: 'enc-1', status: 'WAITING' },
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
    });
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

  it('checks the visit out once ready', async () => {
    mockFindFirstEncounter.mockResolvedValue({ id: 'enc-1' });
    mockCheckout.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    const res = await withCookie(request(buildApp()).post('/checkins/ci-1/checkout'));

    expect(res.status).toBe(200);
    expect(mockCheckout).toHaveBeenCalledWith('enc-1', 'clinic-1', 'staff-1');
    expect(res.body.status).toBe('DONE');
  });

  it('rejects a visit that is not ready for checkout', async () => {
    mockFindFirstEncounter.mockResolvedValue({ id: 'enc-1' });
    mockCheckout.mockRejectedValue(new EncounterNotReadyForCheckoutError());

    const res = await withCookie(request(buildApp()).post('/checkins/ci-1/checkout'));

    expect(res.status).toBe(409);
  });
});
