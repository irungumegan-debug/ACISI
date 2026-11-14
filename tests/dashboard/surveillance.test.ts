import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/notifiableDiseaseService', () => ({
  ...jest.requireActual('../../src/services/notifiableDiseaseService'),
  listNotifiableCases: jest.fn(async () => [{ id: 'case-1', diseaseName: 'Cholera', patientName: 'Test Patient' }]),
  countUnreportedImmediate: jest.fn(async () => 2),
  markCaseReported: jest.fn(async () => undefined),
  weeklySummary: jest.fn(async (_clinicId: string, week: string) => ({
    clinicName: 'Sunrise',
    county: 'Nairobi',
    weekStart: week,
    weekEnd: '2026-11-15',
    rows: [{ diseaseId: 'cholera', name: 'Cholera', reporting: 'IMMEDIATE', under5: 0, fiveAndOver: 1, ageUnknown: 0, total: 1 }],
    totalCases: 1,
    listConfirmed: null,
  })),
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { surveillanceRouter } from '../../src/dashboard/surveillance';
import { markCaseReported, NotifiableCaseNotFoundError, weeklySummary } from '../../src/services/notifiableDiseaseService';
import { recordAuditEvent } from '../../src/services/auditService';

const mockLoadSession = loadDashboardSession as jest.Mock;
const base = { staffId: 'staff-1', staffCode: 'ACI-STF-DEMO', staffName: 'Dr. A', clinicId: 'clinic-1', clinicName: 'Sunrise', departmentId: null };
const as = (role: string) => mockLoadSession.mockResolvedValue({ ...base, role });

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/surveillance', surveillanceRouter);
  return a;
}
const get = (path: string) => request(app()).get(path).set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
const post = (path: string, body: object) => request(app()).post(path).set('Cookie', `${SESSION_COOKIE_NAME}=tok`).send(body);

beforeEach(() => jest.clearAllMocks());

describe('who can see notifiable disease cases (names a patient and a diagnosis)', () => {
  it.each(['RECEPTIONIST', 'CLINICIAN', 'ADMIN', 'LAB_TECHNICIAN'])('%s cannot list cases, see the badge or mark reported', async (role) => {
    as(role);
    expect((await get('/surveillance/cases')).status).toBe(403);
    expect((await get('/surveillance/unreported-count')).status).toBe(403);
    expect((await post('/surveillance/cases/case-1/reported', {})).status).toBe(403);
    expect(markCaseReported).not.toHaveBeenCalled();
  });

  it('a doctor lists cases (own clinic) and marks one reported with a note', async () => {
    as('DOCTOR');
    const list = await get('/surveillance/cases');
    expect(list.status).toBe(200);
    expect(list.body.cases[0].diseaseName).toBe('Cholera');
    expect(list.body.listConfirmed).toBeNull();
    expect((await get('/surveillance/unreported-count')).body).toEqual({ count: 2 });
    const r = await post('/surveillance/cases/case-1/reported', { note: 'Called SCDSC' });
    expect(r.status).toBe(200);
    expect(markCaseReported).toHaveBeenCalledWith({ caseId: 'case-1', clinicId: 'clinic-1', staffId: 'staff-1', note: 'Called SCDSC' });
  });

  it('another clinic\'s case is 404', async () => {
    as('DOCTOR');
    (markCaseReported as jest.Mock).mockRejectedValueOnce(new NotifiableCaseNotFoundError());
    expect((await post('/surveillance/cases/other/reported', {})).status).toBe(404);
  });

  it('no session: 401', async () => {
    mockLoadSession.mockResolvedValue(null);
    expect((await get('/surveillance/cases')).status).toBe(401);
  });
});

describe('weekly summary (counts only)', () => {
  it.each(['DOCTOR', 'ADMIN'])('%s gets the weekly counts and CSV (download audit-logged)', async (role) => {
    as(role);
    const s = await get('/surveillance/weekly?week=2026-11-09');
    expect(s.status).toBe(200);
    expect(JSON.stringify(s.body)).not.toContain('Test Patient');
    const csv = await get('/surveillance/weekly.csv?week=2026-11-09');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('idsr-weekly-2026-11-09.csv');
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'IDSR_WEEKLY_SUMMARY_DOWNLOADED', metadata: { week: '2026-11-09' } }));
  });

  it.each(['RECEPTIONIST', 'CLINICIAN', 'LAB_TECHNICIAN'])('%s cannot', async (role) => {
    as(role);
    expect((await get('/surveillance/weekly')).status).toBe(403);
    expect((await get('/surveillance/weekly.csv')).status).toBe(403);
  });

  it('defaults to the last full week; a non-Monday is refused', async () => {
    as('ADMIN');
    expect((await get('/surveillance/weekly')).status).toBe(200);
    expect(weeklySummary).toHaveBeenCalledWith('clinic-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect((await get('/surveillance/weekly?week=2026-11-10')).status).toBe(400);
  });
});
