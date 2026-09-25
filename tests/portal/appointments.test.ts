import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/portal/session', () => ({
  ...jest.requireActual('../../src/portal/session'),
  loadPatientSession: jest.fn(),
}));

jest.mock('../../src/services/appointmentService', () => ({
  requestAppointment: jest.fn(),
  listOwnAppointments: jest.fn(),
  cancelOwnAppointment: jest.fn(),
  AppointmentNotFoundError: class AppointmentNotFoundError extends Error {
    constructor() {
      super('Appointment not found');
      this.name = 'AppointmentNotFoundError';
    }
  },
  AppointmentNotActionableError: class AppointmentNotActionableError extends Error {
    constructor() {
      super('This appointment has already been cancelled or completed');
      this.name = 'AppointmentNotActionableError';
    }
  },
  PastScheduledTimeError: class PastScheduledTimeError extends Error {
    constructor() {
      super('Please choose a date and time in the future');
      this.name = 'PastScheduledTimeError';
    }
  },
}));

jest.mock('../../src/db/prisma', () => ({
  prisma: {
    clinic: { findUnique: jest.fn() },
    department: { findFirst: jest.fn() },
  },
}));

import { loadPatientSession, PATIENT_SESSION_COOKIE_NAME } from '../../src/portal/session';
import { prisma } from '../../src/db/prisma';
import {
  AppointmentNotActionableError,
  AppointmentNotFoundError,
  PastScheduledTimeError,
  cancelOwnAppointment,
  listOwnAppointments,
  requestAppointment,
} from '../../src/services/appointmentService';
import { portalAppointmentsRouter } from '../../src/portal/appointments';

const mockLoadSession = loadPatientSession as jest.Mock;
const mockFindUniqueClinic = prisma.clinic.findUnique as jest.Mock;
const mockFindFirstDepartment = prisma.department.findFirst as jest.Mock;
const mockRequestAppointment = requestAppointment as jest.Mock;
const mockListOwn = listOwnAppointments as jest.Mock;
const mockCancelOwn = cancelOwnAppointment as jest.Mock;

const SESSION = { patientId: 'patient-1', patientCode: 'ACI-7F2K', firstName: 'Jane' };
const FUTURE_ISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/appointments', portalAppointmentsRouter);
  return app;
}

function withCookie(req: request.Test) {
  return req.set('Cookie', `${PATIENT_SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadSession.mockResolvedValue(SESSION);
  mockFindUniqueClinic.mockResolvedValue({ id: 'clinic-A', isActive: true });
  mockFindFirstDepartment.mockResolvedValue({ id: 'dept-1', clinicId: 'clinic-A', isActive: true });
});

describe('POST /appointments', () => {
  it('rejects a request missing required fields', async () => {
    const res = await withCookie(request(buildApp()).post('/appointments').send({ clinicId: 'clinic-A' }));
    expect(res.status).toBe(400);
    expect(mockRequestAppointment).not.toHaveBeenCalled();
  });

  it('rejects an unparseable scheduledFor', async () => {
    const res = await withCookie(
      request(buildApp()).post('/appointments').send({ clinicId: 'clinic-A', departmentId: 'dept-1', scheduledFor: 'not-a-date' }),
    );
    expect(res.status).toBe(400);
    expect(mockRequestAppointment).not.toHaveBeenCalled();
  });

  it('returns 404 for an inactive/unknown clinic', async () => {
    mockFindUniqueClinic.mockResolvedValue(null);
    const res = await withCookie(
      request(buildApp()).post('/appointments').send({ clinicId: 'clinic-A', departmentId: 'dept-1', scheduledFor: FUTURE_ISO }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for a department outside the given clinic', async () => {
    mockFindFirstDepartment.mockResolvedValue(null);
    const res = await withCookie(
      request(buildApp()).post('/appointments').send({ clinicId: 'clinic-A', departmentId: 'dept-1', scheduledFor: FUTURE_ISO }),
    );
    expect(res.status).toBe(400);
  });

  it('books the appointment for a valid clinic/department/future time', async () => {
    mockRequestAppointment.mockResolvedValue({ id: 'appt-1', status: 'REQUESTED' });

    const res = await withCookie(
      request(buildApp()).post('/appointments').send({ clinicId: 'clinic-A', departmentId: 'dept-1', scheduledFor: FUTURE_ISO }),
    );

    expect(res.status).toBe(201);
    expect(mockRequestAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient-1', clinicId: 'clinic-A', departmentId: 'dept-1' }),
    );
    expect(res.body).toEqual({ appointmentId: 'appt-1', status: 'REQUESTED' });
  });

  it('rejects a past scheduledFor at the service level', async () => {
    mockRequestAppointment.mockRejectedValue(new PastScheduledTimeError());

    const res = await withCookie(
      request(buildApp())
        .post('/appointments')
        .send({ clinicId: 'clinic-A', departmentId: 'dept-1', scheduledFor: new Date(Date.now() - 1000).toISOString() }),
    );

    expect(res.status).toBe(400);
  });
});

describe('GET /appointments', () => {
  it("returns only the logged-in patient's own appointments", async () => {
    mockListOwn.mockResolvedValue([{ id: 'appt-1', clinicName: 'Sunrise', departmentName: 'General', scheduledFor: FUTURE_ISO, status: 'REQUESTED' }]);

    const res = await withCookie(request(buildApp()).get('/appointments'));

    expect(res.status).toBe(200);
    expect(mockListOwn).toHaveBeenCalledWith('patient-1');
    expect(res.body.appointments).toHaveLength(1);
  });
});

describe('POST /appointments/:id/cancel', () => {
  it("returns 404 for someone else's appointment or a bad id", async () => {
    mockCancelOwn.mockRejectedValue(new AppointmentNotFoundError());
    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/cancel'));
    expect(res.status).toBe(404);
  });

  it('returns 409 for an already cancelled/completed appointment', async () => {
    mockCancelOwn.mockRejectedValue(new AppointmentNotActionableError());
    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/cancel'));
    expect(res.status).toBe(409);
  });

  it("cancels the patient's own open appointment", async () => {
    mockCancelOwn.mockResolvedValue({ id: 'appt-1', status: 'CANCELLED' });
    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/cancel'));
    expect(res.status).toBe(200);
    expect(mockCancelOwn).toHaveBeenCalledWith('patient-1', 'appt-1');
  });
});
