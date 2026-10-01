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
  prisma: {
    patient: { findMany: jest.fn(), findUnique: jest.fn() },
    auditLog: { findMany: jest.fn() },
    staff: { findMany: jest.fn() },
    platformOwner: { findMany: jest.fn() },
  },
}));

import { loadOwnerSession, OWNER_SESSION_COOKIE_NAME } from '../../src/owner/session';
import { recordAuditEvent } from '../../src/services/auditService';
import { deletePatientAccount } from '../../src/services/patientDeletionService';
import { prisma } from '../../src/db/prisma';
import { ownerRouter } from '../../src/owner/router';

const mockFindUnique = prisma.patient.findUnique as jest.Mock;
const mockFindMany = prisma.patient.findMany as jest.Mock;

const PATIENT = {
  id: 'p-1',
  patientCode: 'ACI-7F2K',
  firstName: 'Jane',
  lastName: 'Wanjiru',
  phoneNumber: '+254712345678',
  email: null,
  dateOfBirth: null,
  sex: 'FEMALE',
  county: null,
  pinHash: 'hash',
  createdAt: new Date(),
  deletedAt: null,
  deletedByType: null,
  consents: [],
  encounters: [],
  appointments: [],
};

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
  (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.staff.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.patient.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.platformOwner.findMany as jest.Mock).mockResolvedValue([]);
});

describe('GET /owner/patients', () => {
  it('searches across every clinic, matching a locally-typed phone number', async () => {
    mockFindMany.mockResolvedValue([]);
    await asOwner(request(buildApp()).get('/owner/patients?q=0712345678'));
    const where = mockFindMany.mock.calls[0]![0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toContainEqual({ phoneNumber: '+254712345678' });
    expect(JSON.stringify(where)).not.toContain('clinicId');
  });
});

describe('GET /owner/patients/:id', () => {
  it('records every view in the audit log', async () => {
    mockFindUnique.mockResolvedValue(PATIENT);
    const res = await asOwner(request(buildApp()).get('/owner/patients/p-1'));
    expect(res.status).toBe(200);
    expect(recordAuditEvent).toHaveBeenCalledWith({
      actorType: 'OWNER',
      actorId: 'owner-1',
      action: 'OWNER_PATIENT_RECORD_VIEWED',
      entityType: 'Patient',
      entityId: 'p-1',
    });
  });

  it('does not log a view of a patient that does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await asOwner(request(buildApp()).get('/owner/patients/nope'));
    expect(res.status).toBe(404);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe('POST /owner/patients/:id/delete', () => {
  it("refuses when the typed patient ID doesn't match", async () => {
    mockFindUnique.mockResolvedValue(PATIENT);
    const res = await asOwner(request(buildApp()).post('/owner/patients/p-1/delete').send({ confirmPatientCode: 'ACI-XXXX' }));
    expect(res.status).toBe(400);
    expect(deletePatientAccount).not.toHaveBeenCalled();
  });

  it('deletes when the typed patient ID matches (case-insensitively)', async () => {
    mockFindUnique.mockResolvedValue(PATIENT);
    const res = await asOwner(request(buildApp()).post('/owner/patients/p-1/delete').send({ confirmPatientCode: 'aci-7f2k' }));
    expect(res.status).toBe(204);
    expect(deletePatientAccount).toHaveBeenCalledWith('p-1', { type: 'OWNER', ownerId: 'owner-1' });
  });

  it('returns 404 for an already-deleted patient', async () => {
    mockFindUnique.mockResolvedValue({ ...PATIENT, deletedAt: new Date() });
    const res = await asOwner(request(buildApp()).post('/owner/patients/p-1/delete').send({ confirmPatientCode: 'ACI-7F2K' }));
    expect(res.status).toBe(404);
    expect(deletePatientAccount).not.toHaveBeenCalled();
  });
});
