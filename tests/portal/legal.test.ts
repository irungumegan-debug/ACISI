import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/portal/session', () => ({
  ...jest.requireActual('../../src/portal/session'),
  loadPatientSession: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    patient: { findUnique: jest.fn() },
    clinic: { findUnique: jest.fn() },
    department: { findFirst: jest.fn() },
    legalAcceptance: { findFirst: jest.fn(), createMany: jest.fn() },
  },
}));
jest.mock('../../src/services/checkInService', () => ({ initiateCheckIn: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({ getOwnVisitHistory: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { loadPatientSession, PATIENT_SESSION_COOKIE_NAME } from '../../src/portal/session';
import { prisma } from '../../src/db/prisma';
import { initiateCheckIn } from '../../src/services/checkInService';
import { PRIVACY_NOTICE_VERSION, TERMS_OF_SERVICE_VERSION } from '../../src/config/legal';
import { portalCheckinRouter } from '../../src/portal/checkin';
import { portalLegalRouter } from '../../src/portal/legal';

const mockFindAcceptance = prisma.legalAcceptance.findFirst as jest.Mock;
const mockCreateMany = prisma.legalAcceptance.createMany as jest.Mock;
const mockInitiate = initiateCheckIn as jest.Mock;

const SESSION = { patientId: 'patient-1', patientCode: 'ACI-7F2K', firstName: 'Jane' };
const CLINIC = { id: 'clinic-A', name: 'Sunrise Family Clinic', isActive: true };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/checkin', portalCheckinRouter);
  app.use('/legal', portalLegalRouter);
  return app;
}

const withCookie = (req: request.Test) => req.set('Cookie', `${PATIENT_SESSION_COOKIE_NAME}=tok`);

beforeEach(() => {
  jest.clearAllMocks();
  (loadPatientSession as jest.Mock).mockResolvedValue(SESSION);
  (prisma.patient.findUnique as jest.Mock).mockResolvedValue({ id: 'patient-1', phoneNumber: '+254712345678' });
  (prisma.clinic.findUnique as jest.Mock).mockResolvedValue(CLINIC);
  (prisma.department.findFirst as jest.Mock).mockResolvedValue({ id: 'dept-1' });
  mockInitiate.mockResolvedValue({ checkIn: { id: 'ci-1', status: 'PENDING_PAYMENT' } });
});

describe('web check-in: Privacy Notice checkbox', () => {
  const body = { clinicId: 'clinic-A', departmentId: 'dept-1' };

  it('says the checkbox is needed at a clinic the patient has not acknowledged, with the clinic name', async () => {
    mockFindAcceptance.mockResolvedValue(null);
    const res = await withCookie(request(buildApp()).get('/checkin/privacy-notice?clinicId=clinic-A'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ acknowledgmentRequired: true, clinicName: 'Sunrise Family Clinic', version: PRIVACY_NOTICE_VERSION });
    expect(mockFindAcceptance.mock.calls[0][0].where).toMatchObject({ patientId: 'patient-1', clinicId: 'clinic-A' });
  });

  it('cannot check in without ticking it, and nothing is recorded or charged', async () => {
    mockFindAcceptance.mockResolvedValue(null);
    for (const extra of [{}, { privacyNoticeAcknowledged: false }]) {
      const res = await withCookie(request(buildApp()).post('/checkin').send({ ...body, ...extra }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PRIVACY_NOTICE_ACK_REQUIRED');
      expect(res.body.error).toContain('Sunrise Family Clinic');
    }
    expect(mockInitiate).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('records the acknowledgment with the version, clinic and check-in when ticked', async () => {
    mockFindAcceptance.mockResolvedValue(null);
    const res = await withCookie(request(buildApp()).post('/checkin').send({ ...body, privacyNoticeAcknowledged: true }));
    expect(res.status).toBe(201);
    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [
        {
          document: 'PRIVACY_NOTICE',
          version: PRIVACY_NOTICE_VERSION,
          context: 'PATIENT_WEB_CHECKIN',
          patientId: 'patient-1',
          clinicId: 'clinic-A',
          checkInId: 'ci-1',
        },
      ],
    });
  });

  it('does not ask again at a clinic already acknowledged for the current version', async () => {
    mockFindAcceptance.mockResolvedValue({ id: 'la-1' });
    const status = await withCookie(request(buildApp()).get('/checkin/privacy-notice?clinicId=clinic-A'));
    expect(status.body.acknowledgmentRequired).toBe(false);

    const res = await withCookie(request(buildApp()).post('/checkin').send(body));
    expect(res.status).toBe(201);
    expect(mockInitiate).toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('404s for an unknown clinic', async () => {
    (prisma.clinic.findUnique as jest.Mock).mockResolvedValue(null);
    expect((await withCookie(request(buildApp()).get('/checkin/privacy-notice?clinicId=nope'))).status).toBe(404);
  });
});

describe('portal login: accept the current Terms once', () => {
  it('asks when there is no acceptance of the current Terms', async () => {
    mockFindAcceptance.mockResolvedValue(null);
    const res = await withCookie(request(buildApp()).get('/legal'));
    expect(res.status).toBe(200);
    expect(res.body.termsAcceptanceRequired).toBe(true);
  });

  it('does not ask once accepted', async () => {
    mockFindAcceptance.mockResolvedValue({ id: 'la-1' });
    expect((await withCookie(request(buildApp()).get('/legal'))).body.termsAcceptanceRequired).toBe(false);
  });

  it('cannot accept without ticking the box', async () => {
    for (const body of [{}, { accept: false }, { accept: 'yes' }]) {
      expect((await withCookie(request(buildApp()).post('/legal/accept').send(body))).status).toBe(400);
    }
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('records the Terms and Privacy Notice with their versions', async () => {
    const res = await withCookie(request(buildApp()).post('/legal/accept').send({ accept: true }));
    expect(res.status).toBe(201);
    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [
        { document: 'TERMS_OF_SERVICE', version: TERMS_OF_SERVICE_VERSION, context: 'PATIENT_PORTAL_LOGIN', patientId: 'patient-1' },
        { document: 'PRIVACY_NOTICE', version: PRIVACY_NOTICE_VERSION, context: 'PATIENT_PORTAL_LOGIN', patientId: 'patient-1' },
      ],
    });
  });

  it('needs a logged-in patient', async () => {
    (loadPatientSession as jest.Mock).mockResolvedValue(null);
    expect((await withCookie(request(buildApp()).post('/legal/accept').send({ accept: true }))).status).toBe(401);
  });
});
