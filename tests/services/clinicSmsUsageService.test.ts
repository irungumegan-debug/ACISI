jest.mock('../../src/db/prisma', () => ({ prisma: { clinicSmsMessage: { groupBy: jest.fn() } } }));

import { prisma } from '../../src/db/prisma';
import { CLINIC_PLANS, SMS_OVERAGE_KES } from '../../src/config/constants';
import { getSmsUsage, kenyaMonth, kenyaMonthRange, overage } from '../../src/services/clinicSmsUsageService';

const groupBy = prisma.clinicSmsMessage.groupBy as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('SMS count per clinic (C24)', () => {
  it('plans: Starter 500, Clinic 1,500, Clinic Plus 4,000; extra SMS KES 2', () => {
    expect([
      CLINIC_PLANS.STARTER.smsAllowance,
      CLINIC_PLANS.CLINIC.smsAllowance,
      CLINIC_PLANS.CLINIC_PLUS.smsAllowance,
    ]).toEqual([500, 1500, 4000]);
    expect(SMS_OVERAGE_KES).toBe(2);
  });

  it('months follow Kenya time, not UTC', () => {
    // 31 Oct 22:30 UTC is already 1 Nov 01:30 in Nairobi.
    expect(kenyaMonth(new Date('2026-10-31T22:30:00Z'))).toBe('2026-11');
    expect(kenyaMonth(new Date('2026-10-31T20:59:00Z'))).toBe('2026-10');
    expect(kenyaMonth(new Date('2026-01-15T10:00:00Z'), -1)).toBe('2025-12');
  });

  it('a month runs from 00:00 Kenya time on the 1st to 00:00 on the next 1st', () => {
    expect(kenyaMonthRange('2026-10')).toEqual({
      start: new Date('2026-09-30T21:00:00Z'),
      end: new Date('2026-10-31T21:00:00Z'),
    });
    expect(kenyaMonthRange('2026-12').end).toEqual(new Date('2026-12-31T21:00:00Z'));
  });

  it('counts reset each month: each month only counts SMS sent within it', async () => {
    groupBy
      .mockResolvedValueOnce([{ clinicId: 'c1', _count: { _all: 600 }, _sum: { parts: 620 } }])
      .mockResolvedValueOnce([]);
    const oct = await getSmsUsage([{ id: 'c1', smsMonthlyAllowance: 500 }], '2026-10');
    const nov = await getSmsUsage([{ id: 'c1', smsMonthlyAllowance: 500 }], '2026-11');
    expect(groupBy.mock.calls[1][0].where.sentAt).toEqual({
      gte: new Date('2026-10-31T21:00:00Z'),
      lt: new Date('2026-11-30T21:00:00Z'),
    });
    expect(oct.get('c1')).toEqual({
      month: '2026-10',
      messages: 600,
      sms: 620,
      allowance: 500,
      over: 120,
      extraChargeKes: 240,
    });
    expect(nov.get('c1')).toEqual({
      month: '2026-11',
      messages: 0,
      sms: 0,
      allowance: 500,
      over: 0,
      extraChargeKes: 0,
    });
  });

  it('over-allowance figures', () => {
    expect(overage(500, 500)).toEqual({ over: 0, extraChargeKes: 0 });
    expect(overage(120, 500)).toEqual({ over: 0, extraChargeKes: 0 });
    expect(overage(620, 500)).toEqual({ over: 120, extraChargeKes: 240 });
    expect(overage(1600, 1500)).toEqual({ over: 100, extraChargeKes: 200 });
    expect(overage(750, 700)).toEqual({ over: 50, extraChargeKes: 100 }); // custom allowance
  });
});
