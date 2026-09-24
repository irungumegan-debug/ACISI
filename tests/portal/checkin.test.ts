import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/portal/session', () => ({
  ...jest.requireActual('../../src/portal/session'),
  loadPatientSession: jest.fn(),
}));

jest.mock('../../src/services/patientService', () => ({ getOwnVisitHistory: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/visitRecordDocument', () => ({
  ...jest.requireActual('../../src/services/visitRecordDocument'),
  renderVisitRecordPdf: jest.fn(),
}));

jest.mock('../../src/db/prisma', () => ({
  prisma: { encounter: { findFirst: jest.fn() } },
}));

import { loadPatientSession, PATIENT_SESSION_COOKIE_NAME } from '../../src/portal/session';
import { getOwnVisitHistory } from '../../src/services/patientService';
import { recordAuditEvent } from '../../src/services/auditService';
import { renderVisitRecordPdf } from '../../src/services/visitRecordDocument';
import { prisma } from '../../src/db/prisma';
import { portalRecordsRouter } from '../../src/portal/checkin';

const mockLoadSession = loadPatientSession as jest.Mock;
const mockGetHistory = getOwnVisitHistory as jest.Mock;
const mockRecordAudit = recordAuditEvent as jest.Mock;
const mockRenderPdf = renderVisitRecordPdf as jest.Mock;
const mockFindFirstEncounter = prisma.encounter.findFirst as jest.Mock;

const SESSION = { patientId: 'patient-1', patientCode: 'ACI-7F2K', firstName: 'Jane' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/records', portalRecordsRouter);
  return app;
}

function withCookie(req: request.Test) {
  return req.set('Cookie', `${PATIENT_SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadSession.mockResolvedValue(SESSION);
});

describe('GET /records', () => {
  it("returns the patient's own full visit history and logs a self-view audit event", async () => {
    mockGetHistory.mockResolvedValue([
      {
        encounterId: 'enc-1',
        clinicName: 'Sunrise Family Clinic',
        departmentName: 'General',
        visitedAt: new Date('2026-01-15'),
        diagnosis: 'Flu',
        prescription: 'Paracetamol',
      },
    ]);

    const res = await withCookie(request(buildApp()).get('/records'));

    expect(res.status).toBe(200);
    expect(mockGetHistory).toHaveBeenCalledWith('patient-1');
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({ diagnosis: 'Flu', prescription: 'Paracetamol' });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_SELF_VIEWED_HISTORY', actorId: 'patient-1' }),
    );
  });

  it('rejects a request with no session', async () => {
    const res = await request(buildApp()).get('/records');
    expect(res.status).toBe(401);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });
});

describe('GET /records/:encounterId/download', () => {
  it("returns 404 for an encounter that doesn't belong to the logged-in patient — never distinguished from a bad ID", async () => {
    mockFindFirstEncounter.mockResolvedValue(null);

    const res = await withCookie(request(buildApp()).get('/records/enc-someone-elses/download'));

    expect(res.status).toBe(404);
    expect(mockFindFirstEncounter).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'enc-someone-elses', patientId: 'patient-1' } }),
    );
    expect(mockRenderPdf).not.toHaveBeenCalled();
  });

  it("streams a PDF for the patient's own encounter, with the full visit detail, letterhead, and signature, and an attachment header", async () => {
    const signedAt = new Date('2026-01-15T09:00:00Z');
    mockFindFirstEncounter.mockResolvedValue({
      id: 'enc-1',
      createdAt: new Date('2026-01-15'),
      diagnosis: 'Flu',
      prescription: 'Paracetamol',
      consultedAt: signedAt,
      patient: { firstName: 'Jane', lastName: 'Wanjiru', patientCode: 'ACI-7F2K' },
      clinic: { name: 'Sunrise Family Clinic', county: 'Nairobi' },
      checkIn: { department: { name: 'General' } },
      consultedByStaff: { name: 'Dr. Amani Wambui', role: 'DOCTOR' },
    });
    mockRenderPdf.mockResolvedValue(Buffer.from('%PDF-1.3 fake pdf content'));

    const res = await withCookie(request(buildApp()).get('/records/enc-1/download'));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(mockRenderPdf).toHaveBeenCalledWith({
      patientName: 'Jane Wanjiru',
      patientCode: 'ACI-7F2K',
      clinicName: 'Sunrise Family Clinic',
      clinicCounty: 'Nairobi',
      departmentName: 'General',
      visitedAt: new Date('2026-01-15'),
      diagnosis: 'Flu',
      prescription: 'Paracetamol',
      signature: { doctorName: 'Dr. Amani Wambui', doctorTitle: 'Doctor', signedAt },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_SELF_DOWNLOADED_RECORD', actorId: 'patient-1', entityId: 'enc-1' }),
    );
  });

  it('passes signature: null for a visit that has not been signed yet, rather than fabricating one', async () => {
    mockFindFirstEncounter.mockResolvedValue({
      id: 'enc-2',
      createdAt: new Date('2026-01-15'),
      diagnosis: null,
      prescription: null,
      consultedAt: null,
      patient: { firstName: 'Jane', lastName: 'Wanjiru', patientCode: 'ACI-7F2K' },
      clinic: { name: 'Sunrise Family Clinic', county: 'Nairobi' },
      checkIn: { department: { name: 'General' } },
      consultedByStaff: null,
    });
    mockRenderPdf.mockResolvedValue(Buffer.from('%PDF-1.3 fake pdf content'));

    await withCookie(request(buildApp()).get('/records/enc-2/download'));

    expect(mockRenderPdf).toHaveBeenCalledWith(expect.objectContaining({ signature: null }));
  });
});
