import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));

jest.mock('../../src/services/appointmentService', () => ({
  listClinicAppointments: jest.fn(),
  confirmAppointment: jest.fn(),
  cancelAppointmentByStaff: jest.fn(),
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
}));

jest.mock('../../src/services/checkInService', () => ({ checkInPatientForAppointment: jest.fn() }));
jest.mock('../../src/services/staffService', () => ({ findActiveStaffById: jest.fn() }));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import {
  AppointmentNotActionableError,
  AppointmentNotFoundError,
  cancelAppointmentByStaff,
  confirmAppointment,
  listClinicAppointments,
} from '../../src/services/appointmentService';
import { checkInPatientForAppointment } from '../../src/services/checkInService';
import { findActiveStaffById } from '../../src/services/staffService';
import { appointmentsRouter } from '../../src/dashboard/appointments';

const mockLoadSession = loadDashboardSession as jest.Mock;
const mockFindStaffById = findActiveStaffById as jest.Mock;
const mockListClinic = listClinicAppointments as jest.Mock;
const mockConfirm = confirmAppointment as jest.Mock;
const mockCancel = cancelAppointmentByStaff as jest.Mock;
const mockCheckInForAppointment = checkInPatientForAppointment as jest.Mock;

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
  app.use('/appointments', appointmentsRouter);
  return app;
}

function withCookie(req: request.Test) {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadSession.mockResolvedValue(SESSION);
  mockFindStaffById.mockResolvedValue({ id: 'staff-1', isActive: true });
});

describe('GET /appointments', () => {
  it("lists the staff member's own clinic appointments", async () => {
    mockListClinic.mockResolvedValue([{ id: 'appt-1', patientName: 'Jane Wanjiru', status: 'REQUESTED' }]);

    const res = await withCookie(request(buildApp()).get('/appointments'));

    expect(res.status).toBe(200);
    expect(mockListClinic).toHaveBeenCalledWith('clinic-1');
    expect(res.body.appointments).toHaveLength(1);
  });

  it('rejects a request with no staff session', async () => {
    mockLoadSession.mockResolvedValue(null);
    const res = await request(buildApp()).get('/appointments');
    expect(res.status).toBe(401);
    expect(mockListClinic).not.toHaveBeenCalled();
  });
});

describe('POST /appointments/:id/confirm', () => {
  it('confirms and returns the updated status', async () => {
    mockConfirm.mockResolvedValue({ id: 'appt-1', status: 'CONFIRMED' });

    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/confirm'));

    expect(res.status).toBe(200);
    expect(mockConfirm).toHaveBeenCalledWith({ clinicId: 'clinic-1', appointmentId: 'appt-1', staffId: 'staff-1' });
    expect(res.body.status).toBe('CONFIRMED');
  });

  it('returns 404 for a bad id or cross-clinic attempt', async () => {
    mockConfirm.mockRejectedValue(new AppointmentNotFoundError());
    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/confirm'));
    expect(res.status).toBe(404);
  });

  it('returns 409 for an appointment that is not REQUESTED', async () => {
    mockConfirm.mockRejectedValue(new AppointmentNotActionableError());
    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/confirm'));
    expect(res.status).toBe(409);
  });
});

describe('POST /appointments/:id/cancel', () => {
  it('cancels and returns the updated status', async () => {
    mockCancel.mockResolvedValue({ id: 'appt-1', status: 'CANCELLED' });

    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/cancel'));

    expect(res.status).toBe(200);
    expect(mockCancel).toHaveBeenCalledWith({ clinicId: 'clinic-1', appointmentId: 'appt-1', staffId: 'staff-1' });
  });

  it('returns 409 for an already-decided appointment', async () => {
    mockCancel.mockRejectedValue(new AppointmentNotActionableError());
    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/cancel'));
    expect(res.status).toBe(409);
  });
});

describe('POST /appointments/:id/arrive', () => {
  it('checks the patient in and returns the new CheckIn', async () => {
    mockCheckInForAppointment.mockResolvedValue({ checkIn: { id: 'ci-1', status: 'PENDING_PAYMENT' } });

    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/arrive'));

    expect(res.status).toBe(201);
    expect(mockCheckInForAppointment).toHaveBeenCalledWith('appt-1', 'clinic-1', 'staff-1');
    expect(res.body).toEqual({ checkInId: 'ci-1', status: 'PENDING_PAYMENT' });
  });

  it('returns 404 for a bad id or cross-clinic attempt', async () => {
    mockCheckInForAppointment.mockRejectedValue(new AppointmentNotFoundError());
    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/arrive'));
    expect(res.status).toBe(404);
  });

  it('returns 409 when the appointment is already cancelled or completed', async () => {
    mockCheckInForAppointment.mockRejectedValue(new AppointmentNotActionableError());
    const res = await withCookie(request(buildApp()).post('/appointments/appt-1/arrive'));
    expect(res.status).toBe(409);
  });
});
