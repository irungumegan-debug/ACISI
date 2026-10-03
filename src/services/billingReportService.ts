import { prisma } from '../db/prisma';
import { kenyaDayRange } from '../utils/kenyaTime';

export interface DailySummary {
  date: string;
  totals: { cashKes: number; cardKes: number; mobileMoneyKes: number; totalKes: number };
  paymentCount: number;
  voidedCount: number;
  paidVisitCount: number;
  outstanding: {
    encounterId: string;
    checkInId: string;
    patientName: string;
    patientCode: string;
    visitedAt: Date;
    visitStatus: string;
    billStatus: 'NO_BILL' | 'UNPAID' | 'PARTLY_PAID';
    totalKes: number | null;
    paidKes: number;
    balanceKes: number | null;
  }[];
}

/**
 * A clinic's money for one Kenyan calendar day: what came in by method
 * (completed, non-voided payments only), how many visits were fully paid,
 * and which of that day's seen patients still owe something (or have no bill).
 */
export async function getDailySummary(clinicId: string, isoDate: string): Promise<DailySummary> {
  const { start, end } = kenyaDayRange(isoDate);

  const [byMethod, voidedCount, paidVisitCount, seenVisits] = await Promise.all([
    prisma.payment.groupBy({
      by: ['method'],
      where: { clinicId, status: 'SUCCEEDED', completedAt: { gte: start, lt: end } },
      _sum: { amountKes: true },
      _count: { _all: true },
    }),
    prisma.payment.count({ where: { clinicId, status: 'VOIDED', voidedAt: { gte: start, lt: end } } }),
    prisma.bill.count({ where: { clinicId, status: 'PAID', paidAt: { gte: start, lt: end } } }),
    prisma.encounter.findMany({
      where: { clinicId, createdAt: { gte: start, lt: end }, status: { in: ['READY_FOR_CHECKOUT', 'DONE'] } },
      orderBy: { createdAt: 'asc' },
      include: { patient: { select: { firstName: true, lastName: true, patientCode: true } }, bill: true },
    }),
  ]);

  const sum = (methods: string[]) =>
    byMethod.filter((r) => methods.includes(r.method)).reduce((total, r) => total + (r._sum.amountKes ?? 0), 0);
  const cashKes = sum(['CASH']);
  const cardKes = sum(['CARD']);
  const mobileMoneyKes = sum(['MPESA_STK', 'MPESA_MANUAL']);

  return {
    date: isoDate,
    totals: { cashKes, cardKes, mobileMoneyKes, totalKes: cashKes + cardKes + mobileMoneyKes },
    paymentCount: byMethod.reduce((n, r) => n + r._count._all, 0),
    voidedCount,
    paidVisitCount,
    outstanding: seenVisits
      .filter((e) => e.bill?.status !== 'PAID')
      .map((e) => ({
        encounterId: e.id,
        checkInId: e.checkInId,
        patientName: `${e.patient.firstName} ${e.patient.lastName}`.trim(),
        patientCode: e.patient.patientCode,
        visitedAt: e.createdAt,
        visitStatus: e.status,
        billStatus: (e.bill?.status ?? 'NO_BILL') as 'NO_BILL' | 'UNPAID' | 'PARTLY_PAID',
        totalKes: e.bill?.totalKes ?? null,
        paidKes: e.bill?.paidKes ?? 0,
        balanceKes: e.bill ? e.bill.totalKes - e.bill.paidKes : null,
      })),
  };
}
