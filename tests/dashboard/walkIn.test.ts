import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));
jest.mock('../../src/services/walkInService', () => ({
  ...jest.requireActual('../../src/services/walkInService'),
  lookupWalkInPatient: jest.fn(),
  checkInWalkIn: jest.fn(),
  getTodayCheckInCounts: jest.fn(),
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { checkInWalkIn, getTodayCheckInCounts, lookupWalkInPatient, WalkInError } from '../../src/services/walkInService';
import { walkInRouter } from '../../src/dashboard/walkIn';

const mockCheckIn = checkInWalkIn as jest.Mock;

const RECEPTIONIST = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-TEST',
  staffName: 'Test Receptionist',
  role: 'RECEPTIONIST',
  clinicId: 'clinic-A',
  clinicName: 'Sunrise',
  departmentId: null,
};

const VALID = { phone: '0712345678', departmentId: 'dept-1', reasonForVisit: 'Fever', smsConsent: false };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/walk-in', walkInRouter);
  return app;
}

const withCookie = (req: request.Test) => req.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

beforeEach(() => {
  jest.clearAllMocks();
  (loadDashboardSession as jest.Mock).mockResolvedValue(RECEPTIONIST);
  mockCheckIn.mockResolvedValue({ checkInId: 'ci-1', queuePosition: 2, sms: 'not_requested' });
});

describe('walk-in routes: who can use them', () => {
  it('refuses a request with no staff session', async () => {
    (loadDashboardSession as jest.Mock).mockResolvedValue(null);
    expect((await withCookie(request(buildApp()).post('/walk-in').send(VALID))).status).toBe(401);
  });

  it('refuses doctors on the server, not just in the UI', async () => {
    (loadDashboardSession as jest.Mock).mockResolvedValue({ ...RECEPTIONIST, role: 'DOCTOR', departmentId: 'dept-1' });
    for (const req of [
      request(buildApp()).post('/walk-in').send(VALID),
      request(buildApp()).get('/walk-in/lookup?phone=0712345678'),
      request(buildApp()).get('/walk-in/stats/today'),
    ]) {
      expect((await withCookie(req)).status).toBe(403);
    }
    expect(mockCheckIn).not.toHaveBeenCalled();
  });

  it.each(['RECEPTIONIST', 'CLINICIAN', 'ADMIN'])('allows %s', async (role) => {
    (loadDashboardSession as jest.Mock).mockResolvedValue({ ...RECEPTIONIST, role });
    expect((await withCookie(request(buildApp()).post('/walk-in').send(VALID))).status).toBe(201);
  });
});

describe('POST /walk-in validation (server side)', () => {
  it.each([
    ['missing phone', { ...VALID, phone: '' }],
    ['missing department', { ...VALID, departmentId: '' }],
    ['missing reason', { ...VALID, reasonForVisit: ' ' }],
    ['over-long reason', { ...VALID, reasonForVisit: 'x'.repeat(201) }],
    ['bad age', { ...VALID, newPatient: { fullName: 'Jane Wanjiru', age: 400, registrationConsent: true } }],
    ['bad date format', { ...VALID, newPatient: { fullName: 'Jane Wanjiru', dateOfBirth: '01/05/1990', registrationConsent: true } }],
    ['too-short name', { ...VALID, newPatient: { fullName: 'J', registrationConsent: true } }],
    ['bad gender', { ...VALID, newPatient: { fullName: 'Jane Wanjiru', sex: 'ROBOT', registrationConsent: true } }],
    ['non-boolean consent', { ...VALID, smsConsent: 'yes' }],
  ])('rejects %s with 400 before doing anything', async (_label, body) => {
    const res = await withCookie(request(buildApp()).post('/walk-in').send(body));
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect(mockCheckIn).not.toHaveBeenCalled();
  });

  it('passes the session clinic and staff member through, never values from the body', async () => {
    await withCookie(request(buildApp()).post('/walk-in').send({ ...VALID, clinicId: 'other-clinic', staffId: 'someone-else' }));
    expect(mockCheckIn).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-A', staffId: 'staff-1' }));
  });

  it('defaults SMS consent to off', async () => {
    await withCookie(request(buildApp()).post('/walk-in').send({ phone: VALID.phone, departmentId: VALID.departmentId, reasonForVisit: VALID.reasonForVisit }));
    expect(mockCheckIn).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
  });

  it("turns the service's WalkInError into its HTTP status and message", async () => {
    mockCheckIn.mockRejectedValue(new WalkInError('Jane is already in today\'s queue at this clinic', 409));
    const res = await withCookie(request(buildApp()).post('/walk-in').send(VALID));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in today's queue/);
  });
});

describe('GET /walk-in/lookup and /stats/today', () => {
  it('requires a phone number', async () => {
    expect((await withCookie(request(buildApp()).get('/walk-in/lookup'))).status).toBe(400);
    expect(lookupWalkInPatient).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone number with a helpful message', async () => {
    (lookupWalkInPatient as jest.Mock).mockRejectedValue(new WalkInError('Enter a valid Kenyan phone number, e.g. 0712 345 678', 400));
    const res = await withCookie(request(buildApp()).get('/walk-in/lookup?phone=123'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid Kenyan phone/);
  });

  it("returns today's counts for the session's clinic", async () => {
    (getTodayCheckInCounts as jest.Mock).mockResolvedValue({ walkIn: 2, remote: 5 });
    const res = await withCookie(request(buildApp()).get('/walk-in/stats/today'));
    expect(res.body).toEqual({ walkIn: 2, remote: 5 });
    expect(getTodayCheckInCounts).toHaveBeenCalledWith('clinic-A');
  });
});

describe('walk-in route: Privacy Notice checkbox', () => {
  it('passes the box through to the check-in, defaulting to not ticked', async () => {
    await withCookie(request(buildApp()).post('/walk-in').send({ ...VALID, privacyNoticeExplained: true }));
    expect(mockCheckIn).toHaveBeenLastCalledWith(expect.objectContaining({ privacyNoticeExplained: true, staffId: 'staff-1' }));
    await withCookie(request(buildApp()).post('/walk-in').send(VALID));
    expect(mockCheckIn).toHaveBeenLastCalledWith(expect.objectContaining({ privacyNoticeExplained: false }));
  });

  it('returns the refusal when the box is needed and not ticked', async () => {
    mockCheckIn.mockRejectedValue(new WalkInError('Tell the patient how their data is used and where to read the Privacy Notice, then tick the box to confirm', 400));
    const res = await withCookie(request(buildApp()).post('/walk-in').send(VALID));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Privacy Notice');
  });
});
