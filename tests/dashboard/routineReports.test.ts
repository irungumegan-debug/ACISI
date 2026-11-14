import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/routineReportService', () => {
  const actual = jest.requireActual('../../src/services/routineReportService');
  return {
    ...actual,
    buildRoutineReport: jest.fn(async (_clinicId: string, p: { label: string }) => ({ clinicName: 'Sunrise', label: p.label, monthlyDiseases: [] })),
    routineReportCsv: jest.fn(() => 'ACISI routine report\n'),
  };
});

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { routineReportsRouter } from '../../src/dashboard/routineReports';
import { buildRoutineReport } from '../../src/services/routineReportService';
import { recordAuditEvent } from '../../src/services/auditService';

const mockLoadSession = loadDashboardSession as jest.Mock;
const base = { staffId: 'staff-1', staffCode: 'ACI-STF-DEMO', staffName: 'Dr. A', clinicId: 'clinic-1', clinicName: 'Sunrise', departmentId: null };
const as = (role: string) => mockLoadSession.mockResolvedValue({ ...base, role });
function app() {
  const a = express();
  a.use(cookieParser());
  a.use('/routine-reports', routineReportsRouter);
  return a;
}
const get = (path: string) => request(app()).get(path).set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

beforeEach(() => jest.clearAllMocks());

describe('routine reports', () => {
  it.each(['RECEPTIONIST', 'CLINICIAN', 'LAB_TECHNICIAN'])('%s cannot see them', async (role) => {
    as(role);
    expect((await get('/routine-reports?period=MONTH&value=2026-10')).status).toBe(403);
    expect((await get('/routine-reports/csv?period=MONTH&value=2026-10')).status).toBe(403);
    expect(buildRoutineReport).not.toHaveBeenCalled();
  });

  it('no session: 401', async () => {
    mockLoadSession.mockResolvedValue(null);
    expect((await get('/routine-reports')).status).toBe(401);
  });

  it.each(['DOCTOR', 'ADMIN'])('%s gets their own clinic\'s report, and the CSV download is audit-logged', async (role) => {
    as(role);
    const r = await get('/routine-reports?period=QUARTER&value=2026-Q3');
    expect(r.status).toBe(200);
    expect(r.body.label).toBe('Q3 2026 (July–September)');
    expect(buildRoutineReport).toHaveBeenCalledWith('clinic-1', expect.objectContaining({ startDate: '2026-07-01', endDate: '2026-10-01' }));
    const csv = await get('/routine-reports/csv?period=YEAR&value=2026');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('acisi-year-report-2026.csv');
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROUTINE_REPORT_DOWNLOADED', metadata: { period: 'YEAR', value: '2026' } }));
  });

  it('defaults to last month; a bad period is 400', async () => {
    as('ADMIN');
    expect((await get('/routine-reports')).status).toBe(200);
    expect(buildRoutineReport).toHaveBeenCalledWith('clinic-1', expect.objectContaining({ period: 'MONTH' }));
    expect((await get('/routine-reports?period=MONTH&value=2026-13')).status).toBe(400);
    expect((await get('/routine-reports/csv?period=WEEK&value=2026')).status).toBe(400);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
