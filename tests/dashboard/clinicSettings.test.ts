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

jest.mock('../../src/db/prisma', () => ({
  prisma: { clinic: { findUnique: jest.fn() } },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { regenerateInviteCode } from '../../src/services/clinicService';
import { prisma } from '../../src/db/prisma';
import { clinicSettingsRouter } from '../../src/dashboard/clinicSettings';

const mockLoadSession = loadDashboardSession as jest.Mock;
const mockRegenerate = regenerateInviteCode as jest.Mock;
const mockFindClinic = prisma.clinic.findUnique as jest.Mock;

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
