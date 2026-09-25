import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));

jest.mock('../../src/services/staffService', () => ({
  ...jest.requireActual('../../src/services/staffService'),
  findActiveStaffById: jest.fn(),
  setDoctorPresenceBySelf: jest.fn(),
}));

jest.mock('../../src/services/appointmentService', () => ({ listDepartmentAppointmentsToday: jest.fn() }));

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
  InvalidPinError: class InvalidPinError extends Error {
    constructor() {
      super('Incorrect PIN. Please try again.');
      this.name = 'InvalidPinError';
    }
  },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import {
  getDoctorQueue,
  getEncounterForDoctor,
  submitConsultation,
  EncounterNotAccessibleError,
  InvalidPinError,
} from '../../src/services/encounterService';
import { findActiveStaffById, setDoctorPresenceBySelf } from '../../src/services/staffService';
import { listDepartmentAppointmentsToday } from '../../src/services/appointmentService';
import { doctorRouter } from '../../src/dashboard/doctor';

const mockLoadSession = loadDashboardSession as jest.Mock;
const mockGetQueue = getDoctorQueue as jest.Mock;
const mockGetEncounter = getEncounterForDoctor as jest.Mock;
const mockSubmitConsult = submitConsultation as jest.Mock;
const mockFindStaffById = findActiveStaffById as jest.Mock;
const mockSetPresenceBySelf = setDoctorPresenceBySelf as jest.Mock;
const mockListAppointmentsToday = listDepartmentAppointmentsToday as jest.Mock;

const TODAY = new Date();

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
  // requireStaffSession now re-checks the live staff row on every request;
  // default to an active account so existing tests keep exercising their own
  // concern rather than tripping this guard incidentally.
  mockFindStaffById.mockResolvedValue({ id: 'staff-1', isActive: true, lastLoginAt: null, presenceOverride: null, presenceOverrideAt: null });
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
  it("returns the doctor's own clinic+department queue, plus their current presence", async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockGetQueue.mockResolvedValue([{ encounterId: 'enc-1', patientName: 'Jane Wanjiru' }]);
    mockFindStaffById.mockResolvedValue({ id: 'staff-1', isActive: true, lastLoginAt: TODAY, presenceOverride: null, presenceOverrideAt: null });

    const res = await withCookie(request(buildApp()).get('/doctor/queue'));

    expect(res.status).toBe(200);
    expect(mockGetQueue).toHaveBeenCalledWith('clinic-1', 'dept-1', 'staff-1');
    expect(res.body.queue).toHaveLength(1);
    expect(res.body.presence).toBe('IN');
  });

  it('rejects the request when the account has since been deactivated — the live session-revocation check in requireStaffSession', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockFindStaffById.mockResolvedValue(null);

    const res = await withCookie(request(buildApp()).get('/doctor/queue'));

    expect(res.status).toBe(401);
    expect(mockGetQueue).not.toHaveBeenCalled();
  });
});

describe('POST /doctor/presence', () => {
  it('rejects an invalid status', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    const res = await withCookie(request(buildApp()).post('/doctor/presence').send({ status: 'MAYBE' }));
    expect(res.status).toBe(400);
    expect(mockSetPresenceBySelf).not.toHaveBeenCalled();
  });

  it('lets a doctor mark themselves out for today', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockSetPresenceBySelf.mockResolvedValue({ presence: 'OUT' });

    const res = await withCookie(request(buildApp()).post('/doctor/presence').send({ status: 'OUT' }));

    expect(res.status).toBe(200);
    expect(mockSetPresenceBySelf).toHaveBeenCalledWith('staff-1', 'OUT');
    expect(res.body.presence).toBe('OUT');
  });

  it('is blocked for a non-doctor session, same as the rest of this router', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await withCookie(request(buildApp()).post('/doctor/presence').send({ status: 'OUT' }));
    expect(res.status).toBe(403);
    expect(mockSetPresenceBySelf).not.toHaveBeenCalled();
  });
});

describe('GET /doctor/appointments/today', () => {
  it("returns today's confirmed appointments for the doctor's own clinic+department", async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockListAppointmentsToday.mockResolvedValue([{ id: 'appt-1', patientName: 'Jane Wanjiru', patientCode: 'ACI-1042' }]);

    const res = await withCookie(request(buildApp()).get('/doctor/appointments/today'));

    expect(res.status).toBe(200);
    expect(mockListAppointmentsToday).toHaveBeenCalledWith('clinic-1', 'dept-1');
    expect(res.body.appointments).toHaveLength(1);
  });

  it('is blocked for a non-doctor session, same as the rest of this router', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await withCookie(request(buildApp()).get('/doctor/appointments/today'));
    expect(res.status).toBe(403);
    expect(mockListAppointmentsToday).not.toHaveBeenCalled();
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

  it('rejects a missing PIN — signing is not optional', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    const res = await withCookie(
      request(buildApp()).post('/doctor/encounters/enc-1/consult').send({ diagnosis: 'Flu', prescription: 'Paracetamol 500mg' }),
    );
    expect(res.status).toBe(400);
    expect(mockSubmitConsult).not.toHaveBeenCalled();
  });

  it('submits the consultation, including the signing PIN, and moves the encounter to READY_FOR_CHECKOUT', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockSubmitConsult.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT' });

    const res = await withCookie(
      request(buildApp())
        .post('/doctor/encounters/enc-1/consult')
        .send({ diagnosis: 'Flu', prescription: 'Paracetamol 500mg', pin: '1234' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('READY_FOR_CHECKOUT');
    expect(mockSubmitConsult).toHaveBeenCalledWith(
      expect.objectContaining({
        encounterId: 'enc-1',
        clinicId: 'clinic-1',
        departmentId: 'dept-1',
        staffId: 'staff-1',
        pin: '1234',
      }),
    );
  });

  it('returns 401 when the signing PIN is wrong, without the frontend losing anything but the PIN field', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockSubmitConsult.mockRejectedValue(new InvalidPinError());

    const res = await withCookie(
      request(buildApp())
        .post('/doctor/encounters/enc-1/consult')
        .send({ diagnosis: 'Flu', prescription: 'Paracetamol 500mg', pin: 'wrong' }),
    );

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect PIN. Please try again.');
  });
});
