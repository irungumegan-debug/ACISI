import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/clinicService', () => ({
  listActiveClinics: jest.fn(),
  registerClinic: jest.fn(),
}));

import { listActiveClinics, registerClinic } from '../../src/services/clinicService';
import { clinicsRouter } from '../../src/clinics/router';

const mockListClinics = listActiveClinics as jest.Mock;
const mockRegisterClinic = registerClinic as jest.Mock;

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
      adminPin: '1234',
    });

    expect(res.status).toBe(201);
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
      adminPin: '1234',
    });
    expect(res.status).toBe(409);
  });
});
