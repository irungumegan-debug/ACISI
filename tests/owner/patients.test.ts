import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/owner/session', () => ({
  ...jest.requireActual('../../src/owner/session'),
  loadOwnerSession: jest.fn(),
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/patientDeletionService', () => ({
  ...jest.requireActual('../../src/services/patientDeletionService'),
  deletePatientAccount: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => ({
  prisma: { patient: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() } },
}));

import { loadOwnerSession, OWNER_SESSION_COOKIE_NAME } from '../../src/owner/session';
import { deletePatientAccount } from '../../src/services/patientDeletionService';
import { prisma } from '../../src/db/prisma';
import { ownerRouter } from '../../src/owner/router';

const mockFindFirst = prisma.patient.findFirst as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/owner', ownerRouter);
  return app;
}

function asOwner(req: request.Test) {
  return req.set('Cookie', `${OWNER_SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
  (loadOwnerSession as jest.Mock).mockResolvedValue({ ownerId: 'owner-1', email: 'o@x.co', name: 'Owner' });
});

describe('the owner site exposes no patient data', () => {
  it.each(['/owner/patients', '/owner/patients/p-1', '/owner/patients?q=jane'])('has no patient list or record route (%s)', async (path) => {
    const res = await asOwner(request(buildApp()).get(path));
    expect(res.status).toBe(404);
    expect(prisma.patient.findMany).not.toHaveBeenCalled();
    expect(prisma.patient.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /owner/patients/delete', () => {
  it('deletes the account with that patient ID, case-insensitively, returning nothing about the patient', async () => {
    mockFindFirst.mockResolvedValue({ id: 'p-1' });
    const res = await asOwner(request(buildApp()).post('/owner/patients/delete').send({ patientCode: ' aci-7f2k ' }));
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(mockFindFirst).toHaveBeenCalledWith({ where: { patientCode: 'ACI-7F2K', deletedAt: null }, select: { id: true } });
    expect(deletePatientAccount).toHaveBeenCalledWith('p-1', { type: 'OWNER', ownerId: 'owner-1' });
  });

  it('returns 404 for an unknown or already-deleted patient ID', async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await asOwner(request(buildApp()).post('/owner/patients/delete').send({ patientCode: 'ACI-NOPE' }));
    expect(res.status).toBe(404);
    expect(deletePatientAccount).not.toHaveBeenCalled();
  });

  it('requires a patient ID', async () => {
    const res = await asOwner(request(buildApp()).post('/owner/patients/delete').send({}));
    expect(res.status).toBe(400);
  });

  it('requires an owner session', async () => {
    (loadOwnerSession as jest.Mock).mockResolvedValue(null);
    const res = await request(buildApp()).post('/owner/patients/delete').set('Cookie', `${OWNER_SESSION_COOKIE_NAME}=tok`).send({ patientCode: 'ACI-7F2K' });
    expect(res.status).toBe(401);
    expect(deletePatientAccount).not.toHaveBeenCalled();
  });
});
