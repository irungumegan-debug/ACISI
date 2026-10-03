import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/clinicService', () => ({
  listActiveClinics: jest.fn(),
  registerClinic: jest.fn(),
  findClinicByInviteCode: jest.fn(),
}));

jest.mock('../../src/services/departmentService', () => ({
  ...jest.requireActual('../../src/services/departmentService'),
  listActiveDepartments: jest.fn(),
}));

import { findClinicByInviteCode, listActiveClinics, registerClinic } from '../../src/services/clinicService';
import { listActiveDepartments } from '../../src/services/departmentService';
import { clinicsRouter } from '../../src/clinics/router';

const mockListClinics = listActiveClinics as jest.Mock;
const mockRegisterClinic = registerClinic as jest.Mock;
const mockFindClinicByInviteCode = findClinicByInviteCode as jest.Mock;
const mockListDepartments = listActiveDepartments as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/clinics', clinicsRouter);
  return app;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /clinics', () => {
  it('returns the active clinic list', async () => {
    mockListClinics.mockResolvedValue([{ id: 'c1', name: 'Sunrise Family Clinic' }]);
    const res = await request(buildApp()).get('/clinics');
    expect(res.status).toBe(200);
    expect(res.body.clinics).toHaveLength(1);
  });
});

describe('GET /clinics/:id/departments', () => {
  it("returns the clinic's active departments", async () => {
    mockListDepartments.mockResolvedValue([{ id: 'dept-1', name: 'General' }]);
    const res = await request(buildApp()).get('/clinics/clinic-1/departments');
    expect(res.status).toBe(200);
    expect(res.body.departments).toHaveLength(1);
    expect(mockListDepartments).toHaveBeenCalledWith('clinic-1');
  });
});

describe('GET /clinics/invite-code/:code/departments', () => {
  it('returns 404 for an unrecognized invite code', async () => {
    mockFindClinicByInviteCode.mockResolvedValue(null);
    const res = await request(buildApp()).get('/clinics/invite-code/BOGUS-0000/departments');
    expect(res.status).toBe(404);
  });

  it('returns the clinic name and departments for a valid invite code', async () => {
    mockFindClinicByInviteCode.mockResolvedValue({ id: 'clinic-1', name: 'Sunrise Family Clinic', isActive: true });
    mockListDepartments.mockResolvedValue([{ id: 'dept-1', name: 'General' }]);

    const res = await request(buildApp()).get('/clinics/invite-code/SUNRISE-7F2K/departments');

    expect(res.status).toBe(200);
    expect(res.body.clinicName).toBe('Sunrise Family Clinic');
    expect(res.body.departments).toHaveLength(1);
  });
});

describe('POST /clinics/register', () => {
  it('rejects an invalid PIN', async () => {
    const res = await request(buildApp()).post('/clinics/register').send({
      name: 'Sunrise Family Clinic',
      adminName: 'Jane Wanjiru',
      adminPhoneNumber: '0712345678',
      adminPin: '12',
    });
    expect(res.status).toBe(400);
  });

  it('registers a new clinic and returns its invite code and admin staff code', async () => {
    mockRegisterClinic.mockResolvedValue({
      clinic: { name: 'Sunrise Family Clinic', inviteCode: 'SUNRISE-7F2K' },
      adminStaffId: 'staff-1',
      adminStaffCode: 'ACI-STF-1001',
    });

    const res = await request(buildApp()).post('/clinics/register').send({
      name: 'Sunrise Family Clinic',
      county: 'Nairobi',
      adminName: 'Jane Wanjiru',
      adminPhoneNumber: '0712345678',
      adminPin: '730194',
      departments: [{ name: 'General' }, { name: 'Braces', code: 'brc', consultationFeeKes: 2000 }, { name: 'Invisalign' }],
    });

    expect(res.status).toBe(201);
    expect(mockRegisterClinic).toHaveBeenCalledWith(
      expect.objectContaining({
        departments: [
          { name: 'General', nameKey: 'general', code: 'GEN', consultationFeeKes: null },
          { name: 'Braces', nameKey: 'braces', code: 'BRC', consultationFeeKes: 2000 },
          { name: 'Invisalign', nameKey: 'invisalign', code: 'INV', consultationFeeKes: null },
        ],
      }),
    );
    expect(res.body).toEqual({
      clinicName: 'Sunrise Family Clinic',
      inviteCode: 'SUNRISE-7F2K',
      staffCode: 'ACI-STF-1001',
    });
  });

  it('returns 409 on a duplicate registration', async () => {
    mockRegisterClinic.mockRejectedValue({ code: 'P2002' });
    const res = await request(buildApp()).post('/clinics/register').send({
      name: 'Sunrise Family Clinic',
      adminName: 'Jane Wanjiru',
      adminPhoneNumber: '0712345678',
      adminPin: '730194',
      departments: [{ name: 'General' }],
    });
    expect(res.status).toBe(409);
  });

  const VALID = { name: 'Bright Smile Dental', adminName: 'Lisa Jane', adminPhoneNumber: '0712345678', adminPin: '730194' };

  it('requires at least one department', async () => {
    for (const body of [VALID, { ...VALID, departments: [] }]) {
      const res = await request(buildApp()).post('/clinics/register').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Add at least one department');
    }
    expect(mockRegisterClinic).not.toHaveBeenCalled();
  });

  it('rejects duplicate department names, ignoring case and spaces', async () => {
    const res = await request(buildApp())
      .post('/clinics/register')
      .send({ ...VALID, departments: [{ name: 'Braces' }, { name: '  braces ' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('listed twice');
    expect(mockRegisterClinic).not.toHaveBeenCalled();
  });

  it('rejects duplicate or invalid short codes', async () => {
    const dup = await request(buildApp())
      .post('/clinics/register')
      .send({ ...VALID, departments: [{ name: 'General', code: 'GEN' }, { name: 'Gynecology', code: 'gen' }] });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toContain('GEN');
    const bad = await request(buildApp())
      .post('/clinics/register')
      .send({ ...VALID, departments: [{ name: 'General', code: 'G' }] });
    expect(bad.status).toBe(400);
    expect(mockRegisterClinic).not.toHaveBeenCalled();
  });
});
