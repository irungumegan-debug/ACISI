import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => ({
  prisma: { legalAcceptance: { findFirst: jest.fn(), createMany: jest.fn() } },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { prisma } from '../../src/db/prisma';
import { TERMS_OF_SERVICE_VERSION } from '../../src/config/legal';
import { legalRouter } from '../../src/dashboard/legal';

const mockFindAcceptance = prisma.legalAcceptance.findFirst as jest.Mock;
const mockCreateMany = prisma.legalAcceptance.createMany as jest.Mock;

const STAFF = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-TEST',
  staffName: 'Test Receptionist',
  role: 'RECEPTIONIST',
  clinicId: 'clinic-A',
  clinicName: 'Sunrise',
  departmentId: null,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/legal', legalRouter);
  return app;
}

const withCookie = (req: request.Test) => req.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

beforeEach(() => {
  jest.clearAllMocks();
  (loadDashboardSession as jest.Mock).mockResolvedValue(STAFF);
});

describe('console login: existing staff accept the current Terms once', () => {
  it('asks a staff member with no acceptance of the current Terms', async () => {
    mockFindAcceptance.mockResolvedValue(null);
    const res = await withCookie(request(buildApp()).get('/legal'));
    expect(res.status).toBe(200);
    expect(res.body.termsAcceptanceRequired).toBe(true);
    expect(mockFindAcceptance.mock.calls[0][0].where).toMatchObject({ staffId: 'staff-1', version: TERMS_OF_SERVICE_VERSION });
  });

  it('does not ask once accepted (including a clinic admin who accepted at registration)', async () => {
    mockFindAcceptance.mockResolvedValue({ id: 'la-1' });
    expect((await withCookie(request(buildApp()).get('/legal'))).body.termsAcceptanceRequired).toBe(false);
  });

  it('cannot continue without ticking the box', async () => {
    for (const body of [{}, { accept: false }]) {
      expect((await withCookie(request(buildApp()).post('/legal/accept').send(body))).status).toBe(400);
    }
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('records the Terms with its version, the staff member and the clinic', async () => {
    const res = await withCookie(request(buildApp()).post('/legal/accept').send({ accept: true }));
    expect(res.status).toBe(201);
    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [{ document: 'TERMS_OF_SERVICE', version: TERMS_OF_SERVICE_VERSION, context: 'STAFF_LOGIN', staffId: 'staff-1', clinicId: 'clinic-A' }],
    });
  });

  it('needs a staff session', async () => {
    (loadDashboardSession as jest.Mock).mockResolvedValue(null);
    expect((await withCookie(request(buildApp()).get('/legal'))).status).toBe(401);
  });
});
