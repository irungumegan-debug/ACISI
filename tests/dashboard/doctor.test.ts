import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));

jest.mock('../../src/services/encounterService', () => ({
  getDoctorQueue: jest.fn(),
  getEncounterForDoctor: jest.fn(),
  submitConsultation: jest.fn(),
  EncounterNotAccessibleError: class EncounterNotAccessibleError extends Error {
    constructor() {
      super('Patient not found in your queue');
      this.name = 'EncounterNotAccessibleError';
    }
  },
  EncounterNotConsultableError: class EncounterNotConsultableError extends Error {
    constructor() {
      super('This patient is not currently awaiting consultation');
      this.name = 'EncounterNotConsultableError';
    }
  },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import {
  getDoctorQueue,
  getEncounterForDoctor,
  submitConsultation,
  EncounterNotAccessibleError,
} from '../../src/services/encounterService';
import { doctorRouter } from '../../src/dashboard/doctor';

const mockLoadSession = loadDashboardSession as jest.Mock;
const mockGetQueue = getDoctorQueue as jest.Mock;
const mockGetEncounter = getEncounterForDoctor as jest.Mock;
const mockSubmitConsult = submitConsultation as jest.Mock;

const DOCTOR_SESSION = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-DEMO',
  staffName: 'Dr. Amani Wambui',
  role: 'DOCTOR',
  clinicId: 'clinic-1',
  clinicName: 'Sunrise Family Clinic',
  departmentId: 'dept-1',
};

const RECEPTIONIST_SESSION = { ...DOCTOR_SESSION, role: 'RECEPTIONIST', departmentId: null };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/doctor', doctorRouter);
  return app;
}

function withCookie(req: request.Test) {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requireDoctor gating', () => {
  it('rejects a non-doctor role', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await withCookie(request(buildApp()).get('/doctor/queue'));
    expect(res.status).toBe(403);
    expect(mockGetQueue).not.toHaveBeenCalled();
  });

  it('rejects a doctor session with no department assigned', async () => {
    mockLoadSession.mockResolvedValue({ ...DOCTOR_SESSION, departmentId: null });
    const res = await withCookie(request(buildApp()).get('/doctor/queue'));
    expect(res.status).toBe(403);
  });
});

describe('GET /doctor/queue', () => {
  it("returns the doctor's own clinic+department queue", async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockGetQueue.mockResolvedValue([{ encounterId: 'enc-1', patientName: 'Jane Wanjiru' }]);

    const res = await withCookie(request(buildApp()).get('/doctor/queue'));

    expect(res.status).toBe(200);
    expect(mockGetQueue).toHaveBeenCalledWith('clinic-1', 'dept-1');
    expect(res.body.queue).toHaveLength(1);
  });
});

describe('GET /doctor/encounters/:id', () => {
  it('returns 404 when the encounter is not in this queue', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockGetEncounter.mockRejectedValue(new EncounterNotAccessibleError());

    const res = await withCookie(request(buildApp()).get('/doctor/encounters/enc-999'));

    expect(res.status).toBe(404);
  });

  it('returns the encounter detail for a valid queue member', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockGetEncounter.mockResolvedValue({ encounterId: 'enc-1', patientName: 'Jane Wanjiru', history: [] });

    const res = await withCookie(request(buildApp()).get('/doctor/encounters/enc-1'));

    expect(res.status).toBe(200);
    expect(mockGetEncounter).toHaveBeenCalledWith('enc-1', 'clinic-1', 'dept-1', 'staff-1');
  });
});

describe('POST /doctor/encounters/:id/consult', () => {
  it('rejects a missing diagnosis or prescription', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    const res = await withCookie(request(buildApp()).post('/doctor/encounters/enc-1/consult').send({ diagnosis: 'Flu' }));
    expect(res.status).toBe(400);
    expect(mockSubmitConsult).not.toHaveBeenCalled();
  });

  it('submits the consultation and moves the encounter to READY_FOR_CHECKOUT', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockSubmitConsult.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT' });

    const res = await withCookie(
      request(buildApp())
        .post('/doctor/encounters/enc-1/consult')
        .send({ diagnosis: 'Flu', prescription: 'Paracetamol 500mg' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('READY_FOR_CHECKOUT');
    expect(mockSubmitConsult).toHaveBeenCalledWith(
      expect.objectContaining({ encounterId: 'enc-1', clinicId: 'clinic-1', departmentId: 'dept-1', staffId: 'staff-1' }),
    );
  });
});
