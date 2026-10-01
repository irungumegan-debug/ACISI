import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const mockRedisStore = new Map<string, string>();

jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      mockRedisStore.set(key, value);
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      const next = Number(mockRedisStore.get(key) ?? 0) + 1;
      mockRedisStore.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => 1),
    del: jest.fn(async (key: string) => {
      mockRedisStore.delete(key);
      return 1;
    }),
  },
}));

jest.mock('../../src/portal/session', () => ({
  ...jest.requireActual('../../src/portal/session'),
  loadPatientSession: jest.fn(),
}));
jest.mock('../../src/services/patientService', () => ({ verifyPatientPin: jest.fn() }));
jest.mock('../../src/services/otpService', () => ({}));
jest.mock('../../src/services/patientDeletionService', () => ({
  ...jest.requireActual('../../src/services/patientDeletionService'),
  deletePatientAccount: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => ({ prisma: { patient: { findFirst: jest.fn() } } }));

import { loadPatientSession, PATIENT_SESSION_COOKIE_NAME } from '../../src/portal/session';
import { verifyPatientPin } from '../../src/services/patientService';
import { deletePatientAccount } from '../../src/services/patientDeletionService';
import { prisma } from '../../src/db/prisma';
import { portalAuthRouter } from '../../src/portal/auth';
import { LOGIN_RATE_LIMIT_MAX_ATTEMPTS } from '../../src/config/constants';

const mockVerifyPin = verifyPatientPin as jest.Mock;
const PATIENT = { id: 'p-1', patientCode: 'ACI-7F2K', pinHash: 'hash', deletedAt: null };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/patients', portalAuthRouter);
  return app;
}

function asPatient(req: request.Test) {
  return req.set('Cookie', `${PATIENT_SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisStore.clear();
  (loadPatientSession as jest.Mock).mockResolvedValue({ patientId: 'p-1', patientCode: 'ACI-7F2K', firstName: 'Jane' });
  (prisma.patient.findFirst as jest.Mock).mockResolvedValue(PATIENT);
});

describe('POST /patients/account/delete', () => {
  it('requires a logged-in patient', async () => {
    (loadPatientSession as jest.Mock).mockResolvedValue(null);
    const res = await request(buildApp()).post('/patients/account/delete').send({ pin: '1234' });
    expect(res.status).toBe(401);
    expect(deletePatientAccount).not.toHaveBeenCalled();
  });

  it('refuses a wrong PIN', async () => {
    mockVerifyPin.mockResolvedValue(false);
    const res = await asPatient(request(buildApp()).post('/patients/account/delete').send({ pin: '0000' }));
    expect(res.status).toBe(401);
    expect(deletePatientAccount).not.toHaveBeenCalled();
  });

  it('deletes the logged-in patient (never another one) and clears the cookie', async () => {
    mockVerifyPin.mockResolvedValue(true);
    const res = await asPatient(request(buildApp()).post('/patients/account/delete').send({ pin: '1234', patientId: 'p-other' }));
    expect(res.status).toBe(204);
    expect(deletePatientAccount).toHaveBeenCalledWith('p-1', { type: 'PATIENT' });
    expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toContain(`${PATIENT_SESSION_COOKIE_NAME}=;`);
  });

  it('stops accepting PIN guesses after too many failures', async () => {
    mockVerifyPin.mockResolvedValue(false);
    const app = buildApp();
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await asPatient(request(app).post('/patients/account/delete').send({ pin: '0000' }));
    }
    mockVerifyPin.mockResolvedValue(true);
    const res = await asPatient(request(app).post('/patients/account/delete').send({ pin: '1234' }));
    expect(res.status).toBe(429);
    expect(deletePatientAccount).not.toHaveBeenCalled();
  });
});
