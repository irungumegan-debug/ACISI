/* eslint-disable @typescript-eslint/no-explicit-any -- a deliberately loose stand-in for the Prisma client */
/**
 * A tiny in-memory stand-in for the Prisma calls billingService makes, so
 * payment rules (totals, splits, voids, duplicate codes, idempotency) are
 * tested against real state changes rather than hand-fed mock returns.
 * Enforces the same unique constraints as the database (payment
 * idempotencyKey / mpesaReceiptNumber / mpesaCheckoutRequestId), throwing
 * Prisma's P2002 like Postgres would.
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(value);
      if ('not' in cond) return value !== cond.not;
      return true;
    }
    return value === cond;
  });
}

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

export function createFakeBillingDb() {
  const bills: Row[] = [];
  const items: Row[] = [];
  const payments: Row[] = [];
  const mpesaTransactions: Row[] = [];
  /** Check-in fees staff confirmed by hand, with the M-Pesa code they entered. */
  const manualFeeCheckIns: Row[] = [];
  const encounters: Row[] = [];
  const settings: Row[] = [];

  const unique = (rows: Row[], fields: string[], candidate: Row, selfId?: string) => {
    for (const f of fields) {
      if (candidate[f] == null) continue;
      if (rows.some((r) => r.id !== selfId && r[f] === candidate[f])) throw Object.assign(new Error(`Unique constraint failed on ${f}`), { code: 'P2002' });
    }
  };
  const PAYMENT_UNIQUE = ['idempotencyKey', 'mpesaReceiptNumber', 'mpesaCheckoutRequestId'];

  const db: any = {
    $executeRaw: async () => 0,
    $transaction: async (fn: (tx: any) => unknown) => fn(db),
    clinicPaymentSettings: { findUnique: async ({ where }: any) => settings.find((s) => s.clinicId === where.clinicId) ?? null },
    mpesaTransaction: { findUnique: async ({ where }: any) => mpesaTransactions.find((t) => t.mpesaReceiptNumber === where.mpesaReceiptNumber) ?? null },
    checkIn: { findUnique: async ({ where }: any) => manualFeeCheckIns.find((c) => c.manualMpesaCode === where.manualMpesaCode) ?? null },
    encounter: {
      findFirst: async ({ where }: any) => encounters.find((e) => matches(e, where)) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const e = encounters.find((x) => x.id === where.id);
        if (!e) throw new Error('not found');
        return { ...e, patient: e.patient, clinic: e.clinic };
      },
    },
    bill: {
      findUnique: async ({ where, include }: any) => {
        const b = bills.find((x) => (where.id ? x.id === where.id : x.encounterId === where.encounterId));
        if (!b) return null;
        if (!include) return { ...b };
        const encounter = encounters.find((e) => e.id === b.encounterId);
        return {
          ...b,
          clinic: { name: encounter?.clinic.name },
          encounter: { ...encounter, patient: encounter?.patient },
          payments: payments.filter((p) => p.billId === b.id && matches(p, include.payments?.where)),
        };
      },
      findUniqueOrThrow: async (args: any) => {
        const b = await db.bill.findUnique(args);
        if (!b) throw new Error('not found');
        return b;
      },
      findFirst: async ({ where }: any) => {
        const b = bills.find((x) => matches(x, where));
        return b ? { ...b } : null;
      },
      create: async ({ data }: any) => {
        const b = { id: id('bill'), paidKes: 0, status: 'UNPAID', paidAt: null, receiptSmsSentAt: null, createdAt: new Date(), ...data };
        bills.push(b);
        return { ...b };
      },
      update: async ({ where, data }: any) => {
        const b = bills.find((x) => x.id === where.id)!;
        Object.assign(b, data);
        return { ...b };
      },
      updateMany: async ({ where, data }: any) => {
        const rows = bills.filter((x) => matches(x, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    billItem: {
      deleteMany: async ({ where }: any) => {
        for (let i = items.length - 1; i >= 0; i--) if (items[i]!.billId === where.billId) items.splice(i, 1);
        return { count: 0 };
      },
      createMany: async ({ data }: any) => {
        items.push(...data);
        return { count: data.length };
      },
    },
    payment: {
      findUnique: async ({ where }: any) => {
        const [k, v] = Object.entries(where)[0] as [string, unknown];
        const p = payments.find((x) => x[k] === v);
        return p ? { ...p } : null;
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const p = payments.find((x) => x.id === where.id);
        if (!p) throw new Error('not found');
        return { ...p };
      },
      findFirst: async ({ where }: any) => {
        const p = payments.find((x) => matches(x, where));
        return p ? { ...p } : null;
      },
      create: async ({ data }: any) => {
        unique(payments, PAYMENT_UNIQUE, data);
        const p = {
          id: id('pay'),
          createdAt: new Date(),
          cashTenderedKes: null,
          changeKes: null,
          reference: null,
          mpesaReceiptNumber: null,
          mpesaCheckoutRequestId: null,
          completedAt: null,
          ...data,
        };
        payments.push(p);
        return { ...p };
      },
      update: async ({ where, data }: any) => {
        const p = payments.find((x) => x.id === where.id)!;
        unique(payments, PAYMENT_UNIQUE, { ...p, ...data }, p.id);
        Object.assign(p, data);
        return { ...p };
      },
      updateMany: async ({ where, data }: any) => {
        const rows = payments.filter((x) => matches(x, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      aggregate: async ({ where }: any) => ({
        _sum: { amountKes: payments.filter((p) => matches(p, where)).reduce((s, p) => s + p.amountKes, 0) },
      }),
    },
  };

  return {
    db,
    bills,
    items,
    payments,
    mpesaTransactions,
    manualFeeCheckIns,
    encounters,
    settings,
    addVisit(overrides: Partial<{ status: string; smsOptOut: boolean }> = {}) {
      const encounter = {
        id: id('enc'),
        clinicId: 'clinic-A',
        status: overrides.status ?? 'READY_FOR_CHECKOUT',
        patient: { id: 'p-1', phoneNumber: '+254712345678', patientCode: 'ACI-7F2K', smsOptOut: overrides.smsOptOut ?? false, deletedAt: null },
        clinic: { name: 'Sunrise Family Clinic' },
      };
      encounters.push(encounter);
      return encounter;
    },
    acceptAll() {
      settings.push({
        clinicId: 'clinic-A',
        acceptsCash: true,
        acceptsCard: true,
        acceptsMobileMoney: true,
        mobileMoneyType: 'PAYBILL',
        mobileMoneyNumber: '123456',
        paybillAccountFormat: '{patientCode}',
        defaultConsultationFeeKes: 500,
      });
    },
  };
}
