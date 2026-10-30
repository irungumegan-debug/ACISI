import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/owner/session', () => ({
  ...jest.requireActual('../../src/owner/session'),
  loadOwnerSession: jest.fn(),
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({
  prisma: { clinic: { findUnique: jest.fn(), update: jest.fn() } },
}));

import { loadOwnerSession, OWNER_SESSION_COOKIE_NAME } from '../../src/owner/session';
import { recordAuditEvent } from '../../src/services/auditService';
import { prisma } from '../../src/db/prisma';
import { ownerRouter } from '../../src/owner/router';

const clinicFind = prisma.clinic.findUnique as jest.Mock;
const clinicUpdate = prisma.clinic.update as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/owner', ownerRouter);
  return app;
}
const asOwner = (r: request.Test) => r.set('Cookie', `${OWNER_SESSION_COOKIE_NAME}=tok`);
const patchPlan = (body: object) => asOwner(request(buildApp()).patch('/owner/clinics/c1/plan').send(body));

beforeEach(() => {
  jest.clearAllMocks();
  (loadOwnerSession as jest.Mock).mockResolvedValue({ ownerId: 'owner-1', email: 'o@x.co', name: 'Owner' });
  clinicFind.mockResolvedValue({ id: 'c1', plan: 'STARTER', smsMonthlyAllowance: 500 });
  clinicUpdate.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
});

describe('owner changes a clinic plan (C24)', () => {
  it("uses the plan's allowance by default, and logs the change", async () => {
    const res = await patchPlan({ plan: 'CLINIC' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'c1', plan: 'CLINIC', planLabel: 'Clinic', smsMonthlyAllowance: 1500 });
    expect(clinicUpdate).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { plan: 'CLINIC', smsMonthlyAllowance: 1500 } });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'OWNER',
        actorId: 'owner-1',
        action: 'OWNER_CLINIC_PLAN_CHANGED',
        entityId: 'c1',
        metadata: { fromPlan: 'STARTER', toPlan: 'CLINIC', fromSmsAllowance: 500, toSmsAllowance: 1500 },
      }),
    );
  });

  it('accepts a custom allowance', async () => {
    const res = await patchPlan({ plan: 'CLINIC_PLUS', smsMonthlyAllowance: 5000 });
    expect(res.body.smsMonthlyAllowance).toBe(5000);
  });

  it.each([{ plan: 'GOLD' }, {}, { plan: 'CLINIC', smsMonthlyAllowance: -1 }, { plan: 'CLINIC', smsMonthlyAllowance: 2.5 }])('refuses %p', async (body) => {
    expect((await patchPlan(body)).status).toBe(400);
    expect(clinicUpdate).not.toHaveBeenCalled();
  });

  it('404 for an unknown clinic', async () => {
    clinicFind.mockResolvedValue(null);
    expect((await patchPlan({ plan: 'CLINIC' })).status).toBe(404);
  });

  it('only the owner can change it', async () => {
    (loadOwnerSession as jest.Mock).mockResolvedValue(null);
    expect((await patchPlan({ plan: 'CLINIC' })).status).toBe(401);
    expect(clinicUpdate).not.toHaveBeenCalled();
  });
});
