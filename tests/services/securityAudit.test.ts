jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({ prisma: { platformOwner: { findUnique: jest.fn() } } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());

import express from 'express';
import request from 'supertest';
import { recordAuditEvent } from '../../src/services/auditService';
import { prisma } from '../../src/db/prisma';
import { auditAccessDenied, auditAccountLocked, auditLogout, auditSessionEnded } from '../../src/services/securityAudit';
import { recordWrongPin } from '../../src/services/pinLockout';
import { PIN_LOCKOUT } from '../../src/config/constants';

const audit = recordAuditEvent as jest.Mock;
const lastCall = () => audit.mock.calls[audit.mock.calls.length - 1][0];

beforeEach(() => audit.mockReset());

describe('logout and session end', () => {
  it('records STAFF_LOGOUT with the staff member and clinic', async () => {
    await auditLogout('staff', { staffId: 's1', clinicId: 'c1' });
    expect(lastCall()).toMatchObject({ actorType: 'STAFF', actorId: 's1', staffId: 's1', clinicId: 'c1', action: 'STAFF_LOGOUT' });
  });

  it('records PATIENT_LOGOUT and OWNER_LOGOUT', async () => {
    await auditLogout('patient', { patientId: 'p1' });
    expect(lastCall()).toMatchObject({ actorType: 'PATIENT', actorId: 'p1', action: 'PATIENT_LOGOUT' });
    await auditLogout('owner', { ownerId: 'o1' });
    expect(lastCall()).toMatchObject({ actorType: 'OWNER', actorId: 'o1', action: 'OWNER_LOGOUT' });
  });

  it('records the inactivity logoff and revoked sessions with the reason', async () => {
    await auditSessionEnded('staff', { staffId: 's1', clinicId: 'c1' }, 'idle');
    expect(lastCall()).toMatchObject({ action: 'STAFF_SESSION_ENDED', metadata: { reason: 'idle' } });
    await auditSessionEnded('patient', { patientId: 'p1' }, 'revoked');
    expect(lastCall()).toMatchObject({ action: 'PATIENT_SESSION_ENDED', metadata: { reason: 'revoked' } });
  });

  it('never breaks the request when the audit write fails', async () => {
    audit.mockRejectedValueOnce(new Error('db down'));
    await expect(auditLogout('staff', { staffId: 's1' })).resolves.toBeUndefined();
  });
});

describe('account lockout', () => {
  it('staff PIN and staff code lockouts name the staff member', async () => {
    await auditAccountLocked('staff:s1');
    expect(lastCall()).toMatchObject({ actorType: 'STAFF', staffId: 's1', action: 'ACCOUNT_LOCKED', metadata: { by: 'pin' } });
    await auditAccountLocked('mfa:staff:s2');
    expect(lastCall()).toMatchObject({ staffId: 's2', metadata: { by: 'code' } });
  });

  it('owner lockout stores the owner id, never the email', async () => {
    (prisma.platformOwner.findUnique as jest.Mock).mockResolvedValue({ id: 'o1' });
    await auditAccountLocked('owner:boss@example.com');
    expect(lastCall()).toMatchObject({ actorType: 'OWNER', actorId: 'o1', action: 'ACCOUNT_LOCKED' });
    expect(JSON.stringify(lastCall())).not.toContain('boss@example.com');
  });

  it('an unknown ID is recorded without what was typed', async () => {
    await auditAccountLocked('unknown:staff:ZZ99');
    expect(lastCall()).toMatchObject({ actorType: 'SYSTEM', action: 'ACCOUNT_LOCKED', metadata: { knownAccount: false, area: 'staff' } });
    expect(JSON.stringify(lastCall())).not.toContain('ZZ99');
  });

  it('recordWrongPin writes ACCOUNT_LOCKED once, on the attempt that locks', async () => {
    for (let i = 1; i < PIN_LOCKOUT.maxAttempts; i++) expect(await recordWrongPin('patient:p9')).toBe(false);
    expect(audit).not.toHaveBeenCalled();
    expect(await recordWrongPin('patient:p9')).toBe(true);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(lastCall()).toMatchObject({ actorType: 'PATIENT', actorId: 'p9', action: 'ACCOUNT_LOCKED' });
  });
});

describe('access denied', () => {
  function appWith(session: Record<string, unknown> | null, status: number) {
    const app = express();
    app.use(auditAccessDenied);
    const router = express.Router();
    router.get('/orders/:id', (req, res) => {
      if (session) Object.assign(req, session);
      res.status(status).json({});
    });
    app.use('/api/staff/lab', router);
    return app;
  }
  const flush = () => new Promise((r) => setImmediate(r));

  it('records ACCESS_DENIED for a logged-in staff member who gets 403, with the route pattern only', async () => {
    await request(appWith({ dashboardSession: { staffId: 's1', clinicId: 'c1', role: 'FRONT_DESK' } }, 403)).get('/api/staff/lab/orders/abc123?q=secret');
    await flush();
    expect(lastCall()).toMatchObject({
      actorType: 'STAFF',
      staffId: 's1',
      clinicId: 'c1',
      action: 'ACCESS_DENIED',
      metadata: { method: 'GET', route: '/api/staff/lab/orders/:id', role: 'FRONT_DESK' },
    });
    expect(JSON.stringify(lastCall())).not.toMatch(/abc123|secret/);
  });

  it('records it for patients and the owner too', async () => {
    await request(appWith({ patientSession: { patientId: 'p1' } }, 403)).get('/api/staff/lab/orders/x');
    await flush();
    expect(lastCall()).toMatchObject({ actorType: 'PATIENT', actorId: 'p1', action: 'ACCESS_DENIED' });
    await request(appWith({ ownerSession: { ownerId: 'o1' } }, 403)).get('/api/staff/lab/orders/x');
    await flush();
    expect(lastCall()).toMatchObject({ actorType: 'OWNER', actorId: 'o1', action: 'ACCESS_DENIED' });
  });

  it('records nothing for allowed requests or when nobody is logged in', async () => {
    await request(appWith({ dashboardSession: { staffId: 's1', clinicId: 'c1', role: 'ADMIN' } }, 200)).get('/api/staff/lab/orders/x');
    await request(appWith(null, 403)).get('/api/staff/lab/orders/x');
    await flush();
    expect(audit).not.toHaveBeenCalled();
  });
});
