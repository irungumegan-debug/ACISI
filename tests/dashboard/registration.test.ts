import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/staffService', () => ({
  registerStaffViaInviteCode: jest.fn(),
  InvalidInviteCodeError: class InvalidInviteCodeError extends Error {
    constructor() {
      super('That clinic invite code was not recognized');
      this.name = 'InvalidInviteCodeError';
    }
  },
}));

import { registerStaffViaInviteCode, InvalidInviteCodeError } from '../../src/services/staffService';
import { staffRegistrationRouter } from '../../src/dashboard/registration';

const mockRegisterStaff = registerStaffViaInviteCode as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/register', staffRegistrationRouter);
  return app;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('POST /register (staff/doctor signup)', () => {
  it('rejects an unrecognized role', async () => {
    const res = await request(buildApp()).post('/register').send({
      name: 'Anne Otieno',
      phoneNumber: '0712345678',
      inviteCode: 'SUNRISE-7F2K',
      pin: '1234',
      role: 'ADMIN',
    });
    expect(res.status).toBe(400);
    expect(mockRegisterStaff).not.toHaveBeenCalled();
  });

  it('creates a staff account and returns the generated staff code', async () => {
    mockRegisterStaff.mockResolvedValue({ staffCode: 'ACI-STF-1002' });

    const res = await request(buildApp()).post('/register').send({
      name: 'Anne Otieno',
      phoneNumber: '0712345678',
      inviteCode: 'SUNRISE-7F2K',
      pin: '1234',
      role: 'RECEPTIONIST',
    });

    expect(res.status).toBe(201);
    expect(res.body.staffCode).toBe('ACI-STF-1002');
  });

  it('rejects an invalid clinic invite code with a clear error', async () => {
    mockRegisterStaff.mockRejectedValue(new InvalidInviteCodeError());

    const res = await request(buildApp()).post('/register').send({
      name: 'Anne Otieno',
      phoneNumber: '0712345678',
      inviteCode: 'BOGUS-0000',
      pin: '1234',
      role: 'DOCTOR',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not recognized');
  });

  it('returns 409 on a duplicate phone number', async () => {
    mockRegisterStaff.mockRejectedValue({ code: 'P2002' });

    const res = await request(buildApp()).post('/register').send({
      name: 'Anne Otieno',
      phoneNumber: '0712345678',
      inviteCode: 'SUNRISE-7F2K',
      pin: '1234',
      role: 'DOCTOR',
    });

    expect(res.status).toBe(409);
  });
});
