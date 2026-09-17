import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/clinicService', () => ({
  listActiveClinics: jest.fn(),
  getActiveClinicById: jest.fn(),
}));
jest.mock('../../src/services/departmentService', () => ({
  listActiveDepartments: jest.fn(),
  getActiveDepartmentById: jest.fn(),
}));
jest.mock('../../src/services/patientService', () => ({
  findPatientByPhone: jest.fn(),
  registerPatient: jest.fn(),
}));
jest.mock('../../src/services/checkInService', () => ({ initiateCheckIn: jest.fn() }));
jest.mock('../../src/services/consultationService', () => ({ listTodayQueue: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({
  prisma: { checkIn: { findUnique: jest.fn() } },
}));

import { getActiveClinicById, listActiveClinics } from '../../src/services/clinicService';
import { getActiveDepartmentById, listActiveDepartments } from '../../src/services/departmentService';
import { findPatientByPhone, registerPatient } from '../../src/services/patientService';
import { initiateCheckIn } from '../../src/services/checkInService';
import { listTodayQueue } from '../../src/services/consultationService';
import { prisma } from '../../src/db/prisma';
import { portalCheckinRouter } from '../../src/portal/checkin';

const mockListClinics = listActiveClinics as jest.Mock;
const mockGetClinic = getActiveClinicById as jest.Mock;
const mockListDepartments = listActiveDepartments as jest.Mock;
const mockGetDepartment = getActiveDepartmentById as jest.Mock;
const mockFindPatient = findPatientByPhone as jest.Mock;
const mockRegisterPatient = registerPatient as jest.Mock;
const mockInitiateCheckIn = initiateCheckIn as jest.Mock;
const mockListQueue = listTodayQueue as jest.Mock;
const mockFindCheckIn = prisma.checkIn.findUnique as jest.Mock;

const CLINIC = { id: 'clinic-1', name: 'Sunrise Family Clinic' };
const DEPARTMENT = { id: 'dept-1', name: 'General' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', portalCheckinRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /clinics and /departments', () => {
  it('passes through the real clinic and department lists', async () => {
    mockListClinics.mockResolvedValue([CLINIC]);
    mockListDepartments.mockResolvedValue([DEPARTMENT]);

    const app = buildApp();
    expect((await request(app).get('/clinics')).body).toEqual({ clinics: [CLINIC] });
    expect((await request(app).get('/departments')).body).toEqual({ departments: [DEPARTMENT] });
  });
});

describe('POST /checkin', () => {
  const basePayload = {
    clinicId: CLINIC.id,
    departmentId: DEPARTMENT.id,
    phoneNumber: '0712345678',
    clientRequestId: 'req-1',
  };

  beforeEach(() => {
    mockGetClinic.mockResolvedValue(CLINIC);
    mockGetDepartment.mockResolvedValue(DEPARTMENT);
  });

  it('rejects an unknown clinic', async () => {
    mockGetClinic.mockResolvedValue(null);
    const res = await request(buildApp()).post('/checkin').send(basePayload);
    expect(res.status).toBe(400);
  });

  it('asks for registration when the phone number has no patient record yet', async () => {
    mockFindPatient.mockResolvedValue(null);
    const res = await request(buildApp()).post('/checkin').send(basePayload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'REGISTRATION_REQUIRED' });
    expect(mockInitiateCheckIn).not.toHaveBeenCalled();
  });

  it('registers a new patient when registration details are provided, then checks in', async () => {
    mockFindPatient.mockResolvedValue(null);
    mockRegisterPatient.mockResolvedValue({ id: 'patient-1' });
    mockInitiateCheckIn.mockResolvedValue({ checkIn: { id: 'checkin-1', status: 'PENDING_PAYMENT' } });

    const res = await request(buildApp())
      .post('/checkin')
      .send({
        ...basePayload,
        registration: { firstName: 'Jane', lastName: 'Wanjiru', birthYear: 1990, sex: 'FEMALE', consent: true },
      });

    expect(mockRegisterPatient).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberE164: '+254712345678', consentChannel: 'WEB_PORTAL' }),
    );
    expect(mockInitiateCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({
        ussdSessionId: 'web:req-1',
        patientId: 'patient-1',
        clinicId: CLINIC.id,
        departmentId: DEPARTMENT.id,
        channel: 'WEB',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'PAYMENT_PENDING', checkInId: 'checkin-1' });
  });

  it('checks in an existing patient directly, without registering', async () => {
    mockFindPatient.mockResolvedValue({ id: 'patient-1' });
    mockInitiateCheckIn.mockResolvedValue({ checkIn: { id: 'checkin-1', status: 'PENDING_PAYMENT' } });

    const res = await request(buildApp()).post('/checkin').send(basePayload);

    expect(mockRegisterPatient).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PAYMENT_PENDING');
  });

  it('reports a failed STK push as a 502', async () => {
    mockFindPatient.mockResolvedValue({ id: 'patient-1' });
    mockInitiateCheckIn.mockResolvedValue({ checkIn: { id: 'checkin-1', status: 'FAILED' } });

    const res = await request(buildApp()).post('/checkin').send(basePayload);
    expect(res.status).toBe(502);
  });
});

describe('GET /checkin/:checkInId/status', () => {
  it('404s for an unknown check-in', async () => {
    mockFindCheckIn.mockResolvedValue(null);
    const res = await request(buildApp()).get('/checkin/unknown/status');
    expect(res.status).toBe(404);
  });

  it('returns the raw status while payment is still pending', async () => {
    mockFindCheckIn.mockResolvedValue({ id: 'checkin-1', status: 'PENDING_PAYMENT', encounter: null });
    const res = await request(buildApp()).get('/checkin/checkin-1/status');
    expect(res.body).toEqual({ status: 'PENDING_PAYMENT' });
  });

  it('returns queue position once paid', async () => {
    mockFindCheckIn.mockResolvedValue({
      id: 'checkin-1',
      status: 'PAID',
      clinicId: CLINIC.id,
      departmentId: DEPARTMENT.id,
      encounter: { id: 'encounter-2' },
    });
    mockListQueue.mockResolvedValue([
      { encounterId: 'encounter-1', consultationStatus: 'WAITING' },
      { encounterId: 'encounter-2', consultationStatus: 'WAITING' },
      { encounterId: 'encounter-3', consultationStatus: 'DONE' },
    ]);

    const res = await request(buildApp()).get('/checkin/checkin-1/status');
    expect(res.body).toEqual({ status: 'PAID', queuePosition: 2 });
  });
});
