jest.mock('../../src/db/prisma', () => ({
  prisma: {
    payment: { groupBy: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    bill: { count: jest.fn() },
    encounter: { findMany: jest.fn() },
    department: { count: jest.fn() },
  },
}));

import { prisma } from '../../src/db/prisma';
import { getDailySummary } from '../../src/services/billingReportService';

const p = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const pay = (amountKes: number, id: string, name: string, code: string) => ({
  amountKes,
  bill: { encounter: { checkIn: { department: { id, name, code } } } },
});

beforeEach(() => {
  jest.clearAllMocks();
  p.payment!.groupBy!.mockResolvedValue([
    { method: 'CASH', _sum: { amountKes: 3500 }, _count: { _all: 2 } },
    { method: 'MPESA_STK', _sum: { amountKes: 9000 }, _count: { _all: 2 } },
  ]);
  p.payment!.count!.mockResolvedValue(0);
  p.bill!.count!.mockResolvedValue(3);
  p.encounter!.findMany!.mockResolvedValue([]);
  p.department!.count!.mockResolvedValue(3);
});

describe('daily summary by department', () => {
  it("totals the day's money per department, largest first", async () => {
    p.payment!.findMany!.mockResolvedValue([
      pay(1500, 'd-gen', 'General', 'GEN'),
      pay(2000, 'd-brc', 'Braces', 'BRC'),
      pay(7000, 'd-inv', 'Invisalign', 'INV'),
      pay(2000, 'd-gen', 'General', 'GEN'),
    ]);
    const summary = await getDailySummary('clinic-A', '2026-10-03');
    expect(summary.byDepartment).toEqual([
      { departmentId: 'd-inv', name: 'Invisalign', code: 'INV', totalKes: 7000, paymentCount: 1 },
      { departmentId: 'd-gen', name: 'General', code: 'GEN', totalKes: 3500, paymentCount: 2 },
      { departmentId: 'd-brc', name: 'Braces', code: 'BRC', totalKes: 2000, paymentCount: 1 },
    ]);
    expect(summary.departmentCount).toBe(3);
    // the department split adds up to the same total as the method split
    expect(summary.byDepartment.reduce((n, d) => n + d.totalKes, 0)).toBe(summary.totals.totalKes);
    expect(p.payment!.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clinicId: 'clinic-A', status: 'SUCCEEDED' }) }));
  });
});
