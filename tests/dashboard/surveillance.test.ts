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
    rows: [{ diseaseId: 'cholera', name: 'Cholera', reporting: 'IMMEDIATE', form505Row: 'Cholera', countedByAcisi: true, under5: 0, fiveAndOver: 1, ageUnknown: 0, total: 1 }],
    totalCases: 1,
    listConfirmed: null,
    listSource: 'MOH',
  })),
}));

jest.mock('../../src/services/publicHealthEventService', () => ({
  ...jest.requireActual('../../src/services/publicHealthEventService'),
  listPublicHealthEvents: jest.fn(async () => [{ id: 'ev-1', typeLabel: 'AEFI' }]),
  recordPublicHealthEvent: jest.fn(async (input: { type: string }) => ({ id: 'ev-2', type: input.type })),
  markEventReported: jest.fn(async () => undefined),
  countUnreportedEvents: jest.fn(async () => 1),
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { surveillanceRouter } from '../../src/dashboard/surveillance';
import { markCaseReported, NotifiableCaseNotFoundError, weeklySummary } from '../../src/services/notifiableDiseaseService';
import { recordAuditEvent } from '../../src/services/auditService';
import { EventNotFoundError, InvalidEventError, markEventReported, recordPublicHealthEvent } from '../../src/services/publicHealthEventService';

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
  it.each(['RECEPTIONIST', 'CLINICIAN', 'ADMIN', 'LAB_TECHNICIAN'])('%s cannot list cases or mark them reported', async (role) => {
    as(role);
    expect((await get('/surveillance/cases')).status).toBe(403);
    expect((await post('/surveillance/cases/case-1/reported', {})).status).toBe(403);
    expect(markCaseReported).not.toHaveBeenCalled();
  });

  it('a doctor lists cases (own clinic) and marks one reported with a note', async () => {
    as('DOCTOR');
    const list = await get('/surveillance/cases');
    expect(list.status).toBe(200);
    expect(list.body.cases[0].diseaseName).toBe('Cholera');
    expect(list.body.listConfirmed).toBe('2026-11-14');
    expect(list.body.listSource).toContain('3rd edition');
    expect((await get('/surveillance/unreported-count')).body).toEqual({ count: 3 }); // 2 cases + 1 event
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

describe('badge', () => {
  it('admins count unreported events only (no cases: those name a patient)', async () => {
    as('ADMIN');
    expect((await get('/surveillance/unreported-count')).body).toEqual({ count: 1 });
  });
  it.each(['RECEPTIONIST', 'CLINICIAN', 'LAB_TECHNICIAN'])('%s: 403', async (role) => {
    as(role);
    expect((await get('/surveillance/unreported-count')).status).toBe(403);
  });
});

describe('public health events', () => {
  const body = { type: 'ILLNESS_CLUSTER', detectedOn: '2026-11-13', casesCount: 5, casesUnder5: 1, eventDescription: 'Diarrhoea after a funeral meal' };

  it.each(['RECEPTIONIST', 'CLINICIAN', 'LAB_TECHNICIAN'])('%s cannot list, record or mark reported', async (role) => {
    as(role);
    expect((await get('/surveillance/events')).status).toBe(403);
    expect((await post('/surveillance/events', body)).status).toBe(403);
    expect((await post('/surveillance/events/ev-1/reported', {})).status).toBe(403);
    expect(recordPublicHealthEvent).not.toHaveBeenCalled();
  });

  it.each(['DOCTOR', 'ADMIN'])('%s lists (with the types), records and marks reported, in their own clinic', async (role) => {
    as(role);
    const list = await get('/surveillance/events');
    expect(list.status).toBe(200);
    expect(list.body.types).toEqual(expect.arrayContaining([{ code: 'AEFI', label: expect.any(String), immediate: true }]));
    const r = await post('/surveillance/events', { ...body, clinicId: 'other-clinic' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: 'ev-2', immediate: true });
    expect(recordPublicHealthEvent).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-1', staffId: 'staff-1', casesCount: 5 }));
    expect((await post('/surveillance/events/ev-1/reported', { note: 'SCDSC' })).status).toBe(200);
    expect(markEventReported).toHaveBeenCalledWith({ eventId: 'ev-1', clinicId: 'clinic-1', staffId: 'staff-1', note: 'SCDSC' });
  });

  it('bad input is 400; service refusals are 400; unknown event is 404', async () => {
    as('DOCTOR');
    expect((await post('/surveillance/events', { ...body, casesCount: 0 })).status).toBe(400);
    expect((await post('/surveillance/events', { ...body, type: 'NOPE' })).status).toBe(400);
    (recordPublicHealthEvent as jest.Mock).mockRejectedValueOnce(new InvalidEventError('The date can’t be in the future'));
    const r = await post('/surveillance/events', body);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('future');
    (markEventReported as jest.Mock).mockRejectedValueOnce(new EventNotFoundError());
    expect((await post('/surveillance/events/x/reported', {})).status).toBe(404);
  });
});
