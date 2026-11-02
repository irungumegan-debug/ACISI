import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));

jest.mock('../../src/services/clinicService', () => ({
  regenerateInviteCode: jest.fn(),
}));

jest.mock('../../src/services/staffService', () => ({
  listClinicStaff: jest.fn(),
  resetStaffPinByAdmin: jest.fn(),
  deactivateStaffByAdmin: jest.fn(),
  StaffDeactivationError: class StaffDeactivationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'StaffDeactivationError';
    }
  },
  StaffNotFoundError: class StaffNotFoundError extends Error {
    constructor() {
      super('Staff member not found');
      this.name = 'StaffNotFoundError';
    }
  },
  InvalidPinFormatError: class InvalidPinFormatError extends Error {
    constructor() {
      super('PIN must be 4-6 digits');
      this.name = 'InvalidPinFormatError';
    }
  },
}));

jest.mock('../../src/db/prisma', () => ({
  prisma: { clinic: { findUnique: jest.fn() } },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { regenerateInviteCode } from '../../src/services/clinicService';
import {
  deactivateStaffByAdmin,
  listClinicStaff,
  resetStaffPinByAdmin,
  StaffDeactivationError,
  StaffNotFoundError,
  InvalidPinFormatError,
} from '../../src/services/staffService';
import { prisma } from '../../src/db/prisma';
import { clinicSettingsRouter } from '../../src/dashboard/clinicSettings';

const mockLoadSession = loadDashboardSession as jest.Mock;
const mockRegenerate = regenerateInviteCode as jest.Mock;
const mockFindClinic = prisma.clinic.findUnique as jest.Mock;
const mockListStaff = listClinicStaff as jest.Mock;
const mockResetPin = resetStaffPinByAdmin as jest.Mock;

const ADMIN_SESSION = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-ADMN',
  staffName: 'Clinic Admin',
  role: 'ADMIN',
  clinicId: 'clinic-1',
  clinicName: 'Sunrise Family Clinic',
};

const RECEPTIONIST_SESSION = { ...ADMIN_SESSION, role: 'RECEPTIONIST' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/clinic', clinicSettingsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /clinic/invite-code', () => {
  it('rejects a non-admin staff member', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await request(buildApp()).get('/clinic/invite-code').set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
    expect(res.status).toBe(403);
  });

  it('returns the invite code for an admin', async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockFindClinic.mockResolvedValue({ inviteCode: 'SUNRISE-7F2K' });

    const res = await request(buildApp()).get('/clinic/invite-code').set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

    expect(res.status).toBe(200);
    expect(res.body.inviteCode).toBe('SUNRISE-7F2K');
  });
});

describe('POST /clinic/invite-code/regenerate', () => {
  it('regenerates and returns a new invite code for an admin', async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockRegenerate.mockResolvedValue('SUNRISE-9Z1Q');

    const res = await request(buildApp()).post('/clinic/invite-code/regenerate').set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

    expect(res.status).toBe(200);
    expect(res.body.inviteCode).toBe('SUNRISE-9Z1Q');
    expect(mockRegenerate).toHaveBeenCalledWith('clinic-1', 'staff-1');
  });

  it('rejects a non-admin staff member', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await request(buildApp()).post('/clinic/invite-code/regenerate').set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
    expect(res.status).toBe(403);
    expect(mockRegenerate).not.toHaveBeenCalled();
  });
});

describe('GET /clinic/staff', () => {
  it('rejects a non-admin staff member — not even their own PIN, per the spec', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await request(buildApp()).get('/clinic/staff').set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
    expect(res.status).toBe(403);
    expect(mockListStaff).not.toHaveBeenCalled();
  });

  it("returns the admin's own clinic's staff list", async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockListStaff.mockResolvedValue([{ id: 's1', staffCode: 'ACI-STF-A', name: 'Dr. A', role: 'DOCTOR', departmentName: 'General', isActive: true }]);

    const res = await request(buildApp()).get('/clinic/staff').set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

    expect(res.status).toBe(200);
    expect(mockListStaff).toHaveBeenCalledWith('clinic-1');
    expect(res.body.staff).toHaveLength(1);
  });
});

describe('POST /clinic/staff/:id/reset-pin', () => {
  it('rejects a non-admin staff member', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await request(buildApp()).post('/clinic/staff/s1/reset-pin').set('Cookie', `${SESSION_COOKIE_NAME}=tok`).send({});
    expect(res.status).toBe(403);
    expect(mockResetPin).not.toHaveBeenCalled();
  });

  it('returns 404 for a staff id outside the admin\'s own clinic — same as a bad id', async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockResetPin.mockRejectedValue(new StaffNotFoundError());

    const res = await request(buildApp()).post('/clinic/staff/s-other-clinic/reset-pin').set('Cookie', `${SESSION_COOKIE_NAME}=tok`).send({});

    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed admin-supplied PIN', async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockResetPin.mockRejectedValue(new InvalidPinFormatError('Your PIN must be exactly 6 digits.'));

    const res = await request(buildApp())
      .post('/clinic/staff/s1/reset-pin')
      .set('Cookie', `${SESSION_COOKIE_NAME}=tok`)
      .send({ newPin: 'abc' });

    expect(res.status).toBe(400);
  });

  it('resets the PIN, scoped to the admin\'s own clinic, and returns the new PIN once', async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockResetPin.mockResolvedValue({ staffCode: 'ACI-STF-A', name: 'Dr. A', newPin: '482917' });

    const res = await request(buildApp()).post('/clinic/staff/s1/reset-pin').set('Cookie', `${SESSION_COOKIE_NAME}=tok`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ staffCode: 'ACI-STF-A', name: 'Dr. A', newPin: '482917' });
    expect(mockResetPin).toHaveBeenCalledWith({ clinicId: 'clinic-1', staffId: 's1', requestedByStaffId: 'staff-1', newPin: undefined });
  });

  it("passes through an admin-supplied PIN instead of leaving it to auto-generate", async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockResetPin.mockResolvedValue({ staffCode: 'ACI-STF-A', name: 'Dr. A', newPin: '135790' });

    await request(buildApp()).post('/clinic/staff/s1/reset-pin').set('Cookie', `${SESSION_COOKIE_NAME}=tok`).send({ newPin: '135790' });

    expect(mockResetPin).toHaveBeenCalledWith(
      expect.objectContaining({ newPin: '135790' }),
    );
  });
});

describe('POST /clinic/staff/:id/deactivate', () => {
  const mockDeactivate = deactivateStaffByAdmin as jest.Mock;
  const post = (id: string) => request(buildApp()).post(`/clinic/staff/${id}/deactivate`).set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

  it('is admin-only', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    expect((await post('doc-1')).status).toBe(403);
    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it("deactivates within the admin's own clinic, as the admin", async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockDeactivate.mockResolvedValue({ id: 'doc-1', isActive: false });
    const res = await post('doc-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'doc-1', isActive: false });
    expect(mockDeactivate).toHaveBeenCalledWith({ clinicId: 'clinic-1', staffId: 'doc-1', requestedByStaffId: 'staff-1' });
  });

  it('answers 409 with the reason for yourself / the last admin, and 404 for someone not in the clinic', async () => {
    mockLoadSession.mockResolvedValue(ADMIN_SESSION);
    mockDeactivate.mockRejectedValueOnce(new StaffDeactivationError("You can't deactivate your own account."));
    const self = await post('staff-1');
    expect(self.status).toBe(409);
    expect(self.body.error).toMatch(/own account/);

    mockDeactivate.mockRejectedValueOnce(new StaffNotFoundError());
    expect((await post('elsewhere')).status).toBe(404);
  });
});
