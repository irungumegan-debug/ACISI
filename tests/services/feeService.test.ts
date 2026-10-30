const mockEnv = { FEE_RESTRICTION_ENABLED: true };
jest.mock('../../src/config/env', () => ({ env: mockEnv }));
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    checkIn: { findMany: jest.fn(), update: jest.fn() },
    patient: { findUnique: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { FEE_REMINDER_DAY, FEE_RESTRICTION_DAY } from '../../src/config/constants';
import {
  applyFeeRestrictions,
  getFeeStatus,
  liftRestrictionIfClear,
  listPendingFees,
  owedFeesWhere,
  restrictionMessage,
  settleOutstandingFees,
} from '../../src/services/feeService';

const checkInFindMany = prisma.checkIn.findMany as jest.Mock;
const patientFind = prisma.patient.findUnique as jest.Mock;
const patientUpdateMany = prisma.patient.updateMany as jest.Mock;
const DAY = 24 * 60 * 60 * 1000;
const owed = (id: string, daysAgo: number, amountKes = 100, includesOutstandingKes = 0) => ({
  id,
  patientId: 'p1',
  amountKes,
  includesOutstandingKes,
  createdAt: new Date(Date.now() - daysAgo * DAY),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.FEE_RESTRICTION_ENABLED = true;
  patientUpdateMany.mockResolvedValue({ count: 1 });
});

describe('unpaid ACISI check-in fees (C20)', () => {
  it('settings: reminder from day 7, restriction from day 14', () => {
    expect([FEE_REMINDER_DAY, FEE_RESTRICTION_DAY]).toEqual([7, 14]);
  });

  it('only pay-later check-ins whose payment failed or got no answer, not paid off since, are owed', () => {
    expect(owedFeesWhere('p1')).toEqual({
      patientId: 'p1',
      queuedBeforePaymentAt: { not: null },
      status: { in: ['FAILED', 'NEEDS_REVIEW'] },
      feeSettledAt: null,
    });
  });

  it('counts each fee once, even when a failed check-in had been collecting an older one too', async () => {
    checkInFindMany.mockResolvedValue([owed('old', 10), owed('combined', 2, 200, 100)]);
    patientFind.mockResolvedValue({ feeRestrictedAt: null });
    expect((await getFeeStatus('p1')).owedKes).toBe(200);
  });

  it('day 7: reminder notice; not restricted', async () => {
    checkInFindMany.mockResolvedValue([owed('a', 7)]);
    patientFind.mockResolvedValue({ feeRestrictedAt: null });
    expect(await getFeeStatus('p1')).toMatchObject({ owedKes: 100, daysOwed: 7, reminder: true, restricted: false });
  });

  it('restricted accounts get the agreed message', async () => {
    checkInFindMany.mockResolvedValue([owed('a', 15)]);
    patientFind.mockResolvedValue({ feeRestrictedAt: new Date() });
    const status = await getFeeStatus('p1');
    expect(status.restricted).toBe(true);
    expect(status.restrictionMessage).toBe('Your account is restricted until your unpaid check-in fee of KSh 100 is paid.');
    expect(restrictionMessage(1500)).toContain('KSh 1,500');
  });

  it('day 14: the hourly check restricts the account and logs it', async () => {
    checkInFindMany.mockResolvedValueOnce([{ patientId: 'p1', id: 'a' }]);
    (prisma.patient.findMany as jest.Mock).mockResolvedValue([]);
    const res = await applyFeeRestrictions(new Date());
    expect(res.restricted).toBe(1);
    const where = checkInFindMany.mock.calls[0][0].where;
    expect(Date.now() - where.createdAt.lte.getTime()).toBeGreaterThanOrEqual(FEE_RESTRICTION_DAY * DAY - 1000);
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'FEE_RESTRICTION_APPLIED', entityId: 'p1' }));
  });

  it('never restricts while FEE_RESTRICTION_ENABLED is off (until the Terms cover it)', async () => {
    mockEnv.FEE_RESTRICTION_ENABLED = false;
    (prisma.patient.findMany as jest.Mock).mockResolvedValue([]);
    expect((await applyFeeRestrictions()).restricted).toBe(0);
    checkInFindMany.mockResolvedValue([owed('a', 30)]);
    patientFind.mockResolvedValue({ feeRestrictedAt: new Date() });
    expect((await getFeeStatus('p1')).restricted).toBe(false);
  });

  it('paying lifts the restriction straight away, and it is logged', async () => {
    patientFind.mockResolvedValue({ feeRestrictedAt: new Date() });
    checkInFindMany.mockResolvedValue([]);
    expect(await liftRestrictionIfClear('p1')).toBe(true);
    expect(patientUpdateMany).toHaveBeenCalledWith({ where: { id: 'p1', feeRestrictedAt: { not: null } }, data: { feeRestrictedAt: null } });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'FEE_RESTRICTION_LIFTED', entityId: 'p1' }));
  });

  it('is not lifted while something is still owed', async () => {
    patientFind.mockResolvedValue({ feeRestrictedAt: new Date() });
    checkInFindMany.mockResolvedValue([owed('a', 20)]);
    expect(await liftRestrictionIfClear('p1')).toBe(false);
  });

  it('an "old fee + new fee" payment settles the older owed fees, oldest first', async () => {
    const tx = { checkIn: { findMany: jest.fn(async () => [owed('o1', 20), owed('o2', 10)]), update: jest.fn() } };
    const settled = await settleOutstandingFees(tx as never, { id: 'new', patientId: 'p1', includesOutstandingKes: 200 } as never);
    expect(settled).toEqual(['o1', 'o2']);
    expect(tx.checkIn.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { feeSettledAt: expect.any(Date), feeSettledByCheckInId: 'new' } });
  });

  it('owner list: ACISI ID and amounts only, no names or health data', async () => {
    checkInFindMany.mockResolvedValue([
      { ...owed('a', 3), patient: { patientCode: 'ACI-7F2K', feeRestrictedAt: null } },
      { ...owed('b', 1), patient: { patientCode: 'ACI-7F2K', feeRestrictedAt: null } },
    ]);
    const list = await listPendingFees();
    expect(list.totalKes).toBe(200);
    expect(list.rows).toEqual([{ patientCode: 'ACI-7F2K', owedKes: 200, oldestAt: expect.any(Date), restricted: false, count: 2 }]);
    expect(checkInFindMany.mock.calls[0][0].select.patient.select).toEqual({ patientCode: true, feeRestrictedAt: true });
  });
});
