import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));
jest.mock('../../src/services/clinicPatientService', () => ({
  ...jest.requireActual('../../src/services/clinicPatientService'),
  addPatient: jest.fn(),
  lookupPatients: jest.fn(),
  linkExistingPatient: jest.fn(),
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { addPatient, lookupPatients, PatientRegistryError } from '../../src/services/clinicPatientService';
import { registryRouter } from '../../src/dashboard/registry';

const RECEPTIONIST = { staffId: 'staff-1', staffCode: 'ACI-STF-TEST', staffName: 'R', role: 'RECEPTIONIST', clinicId: 'clinic-A', clinicName: 'Sunrise' };
const VALID = {
  fullName: 'Jane Wanjiru',
  phone: '0712345678',
  dateOfBirth: '1990-03-15',
  sex: 'FEMALE',
  registrationConsent: true,
  privacyNoticeExplained: true,
};

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/registry', registryRouter);
  return a;
}
const withCookie = (r: request.Test) => r.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

beforeEach(() => {
  jest.clearAllMocks();
  (loadDashboardSession as jest.Mock).mockResolvedValue(RECEPTIONIST);
  (addPatient as jest.Mock).mockResolvedValue({ patient: { id: 'p', name: 'Jane Wanjiru', patientCode: 'ACS-12345' }, sms: 'sent' });
});

it('refuses doctors on the server', async () => {
  (loadDashboardSession as jest.Mock).mockResolvedValue({ ...RECEPTIONIST, role: 'DOCTOR' });
  expect((await withCookie(request(app()).post('/registry/patients').send(VALID))).status).toBe(403);
  expect((await withCookie(request(app()).get('/registry/lookup?q=0712345678'))).status).toBe(403);
  expect(addPatient).not.toHaveBeenCalled();
});

it('adds a patient for the logged-in clinic only (clinic id comes from the session, never the body)', async () => {
  const res = await withCookie(request(app()).post('/registry/patients').send({ ...VALID, clinicId: 'clinic-EVIL' }));
  expect(res.status).toBe(201);
  expect(addPatient).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-A', staffId: 'staff-1' }));
});

it.each([
  ['no date of birth', { ...VALID, dateOfBirth: '' }],
  ['no sex', { ...VALID, sex: undefined }],
  ['no name', { ...VALID, fullName: '' }],
])('rejects %s', async (_l, body) => {
  expect((await withCookie(request(app()).post('/registry/patients').send(body))).status).toBe(400);
  expect(addPatient).not.toHaveBeenCalled();
});

it('passes the existing patients on a shared phone back to the screen', async () => {
  (addPatient as jest.Mock).mockRejectedValue(new PatientRegistryError('exists', 409, { reason: 'phone_has_patients', existing: [{ id: 'p1' }] }));
  const res = await withCookie(request(app()).post('/registry/patients').send(VALID));
  expect(res.status).toBe(409);
  expect(res.body).toEqual({ error: 'exists', reason: 'phone_has_patients', existing: [{ id: 'p1' }] });
});

it('looks up by phone or ACISI ID', async () => {
  (lookupPatients as jest.Mock).mockResolvedValue({ patients: [] });
  const res = await withCookie(request(app()).get('/registry/lookup?q=ACS-12345'));
  expect(res.status).toBe(200);
  expect(lookupPatients).toHaveBeenCalledWith('ACS-12345', 'clinic-A', 'staff-1');
});

describe('bulk import and invitations are admin-only', () => {
  it.each(['RECEPTIONIST', 'CLINICIAN', 'DOCTOR'])('refuses %s', async (role) => {
    (loadDashboardSession as jest.Mock).mockResolvedValue({ ...RECEPTIONIST, role });
    for (const req of [
      request(app()).post('/registry/import/preview').attach('file', Buffer.from('Name,Phone\n'), 'list.csv'),
      request(app()).post('/registry/import/abc/confirm').send({ clinicConfirmsBasis: true }),
      request(app()).get('/registry/invitations'),
      request(app()).post('/registry/invitations/send').send({}),
    ]) {
      expect((await withCookie(req)).status).toBe(403);
    }
  });

  it('rejects a file over 5 MB', async () => {
    (loadDashboardSession as jest.Mock).mockResolvedValue({ ...RECEPTIONIST, role: 'ADMIN' });
    const res = await withCookie(request(app()).post('/registry/import/preview').attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'big.csv'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too big/);
  });
});
