/**
 * Resolving a check-in's M-Pesa fee from every source — Daraja's callback,
 * the status query (portal polling and the once-a-minute sweep) and staff
 * entering the M-Pesa code — against a small in-memory check-in table whose
 * conditional update behaves like the real one, so races play out for real:
 * whichever answer lands first wins and every later one changes nothing.
 */
type Row = Record<string, unknown> & { id: string; status: string; createdAt: Date };

const db = {
  checkIns: new Map<string, Row>(),
  encounters: [] as Record<string, unknown>[],
  transactions: [] as Record<string, unknown>[],
};

function matchesStatus(row: Row, status: unknown): boolean {
  if (status === undefined) return true;
  if (typeof status === 'string') return row.status === status;
  return (status as { in: string[] }).in.includes(row.status);
}

function matchesCreatedAt(row: Row, createdAt?: { gte?: Date; lte?: Date; lt?: Date }): boolean {
  if (!createdAt) return true;
  const t = row.createdAt.getTime();
  return (
    (!createdAt.gte || t >= createdAt.gte.getTime()) &&
    (!createdAt.lte || t <= createdAt.lte.getTime()) &&
    (!createdAt.lt || t < createdAt.lt.getTime())
  );
}

const copy = (row: Row | undefined) => (row ? { ...row } : null);

jest.mock('../../src/db/prisma', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    checkIn: {
      findUnique: jest.fn(async ({ where }) => {
        const rows = [...db.checkIns.values()];
        if (where.id) return copy(db.checkIns.get(where.id));
        if (where.mpesaCheckoutRequestId)
          return copy(rows.find((r) => r.mpesaCheckoutRequestId === where.mpesaCheckoutRequestId));
        return null;
      }),
      findFirst: jest.fn(async ({ where }) => {
        const rows = [...db.checkIns.values()];
        if (where.manualMpesaCode)
          return copy(
            rows.find((r) => r.manualMpesaCode === where.manualMpesaCode && r.id !== where.id?.not),
          );
        return copy(rows.find((r) => r.id === where.id && r.clinicId === where.clinicId));
      }),
      findMany: jest.fn(async ({ where }) =>
        [...db.checkIns.values()]
          .filter((r) => matchesStatus(r, where.status) && matchesCreatedAt(r, where.createdAt))
          .filter((r) => !where.mpesaCheckoutRequestId || r.mpesaCheckoutRequestId)
          .map((r) => ({ ...r })),
      ),
      // The real thing: `UPDATE … WHERE id = ? AND status IN (…)` — atomic.
      updateMany: jest.fn(async ({ where, data }) => {
        const row = db.checkIns.get(where.id);
        if (!row || !matchesStatus(row, where.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }) => ({
        ...db.checkIns.get(where.id),
        patient: { firstName: 'Jane', lastName: 'Wanjiru' },
      })),
    },
    encounter: { create: jest.fn(async ({ data }) => db.encounters.push(data)) },
    mpesaTransaction: {
      create: jest.fn(async ({ data }) => db.transactions.push(data)),
      findUnique: jest.fn(
        async ({ where }) =>
          db.transactions.find((t) => t.mpesaReceiptNumber === where.mpesaReceiptNumber) ?? null,
      ),
    },
    payment: { findUnique: jest.fn(async () => null) },
    $executeRaw: jest.fn(async () => 1),
    // Rolls back on error, like a real transaction.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = new Map([...db.checkIns].map(([id, r]) => [id, { ...r }]));
      const [encounters, transactions] = [db.encounters.length, db.transactions.length];
      try {
        return await fn(prisma);
      } catch (err) {
        db.checkIns = snapshot;
        db.encounters.length = encounters;
        db.transactions.length = transactions;
        throw err;
      }
    }),
  };
  return { prisma };
});

jest.mock('../../src/config/redis', () => ({ redis: { set: jest.fn() } }));
jest.mock('../../src/mpesa/verify', () => ({ queryStkPushStatus: jest.fn() }));
jest.mock('../../src/mpesa/stkPush', () => ({ initiateStkPush: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/realtimeEvents', () => ({
  publishCheckInPaid: jest.fn(),
  publishCheckInFailed: jest.fn(),
}));
jest.mock('../../src/jobs/queue', () => ({ enqueueSmsReceipt: jest.fn() }));
jest.mock('../../src/services/doctorAssignmentService', () => ({ assignDoctorForCheckIn: jest.fn() }));
jest.mock('../../src/services/appointmentService', () => ({
  findArrivalMatch: jest.fn(),
  getAppointmentForArrival: jest.fn(),
  markAppointmentCompleted: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  ...jest.requireActual('../../src/utils/logger'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { redis } from '../../src/config/redis';
import { queryStkPushStatus } from '../../src/mpesa/verify';
import { recordAuditEvent } from '../../src/services/auditService';
import { publishCheckInFailed, publishCheckInPaid } from '../../src/services/realtimeEvents';
import { enqueueSmsReceipt } from '../../src/jobs/queue';
import { assignDoctorForCheckIn } from '../../src/services/doctorAssignmentService';
import { logger } from '../../src/utils/logger';
import {
  applyPaymentResult,
  CheckInNotPendingError,
  confirmCheckInPaidManually,
  InvalidMpesaCodeError,
  queryCheckInPayment,
  sweepPendingCheckInPayments,
} from '../../src/services/checkInService';

const mockQuery = queryStkPushStatus as jest.Mock;
const mockRedisSet = redis.set as jest.Mock;
const mockLogInfo = logger.info as jest.Mock;

const PHONE = '254712345678';
const RECEIPT = 'QKL98MN76P';
const NOW = new Date('2026-10-10T09:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function addCheckIn(overrides: Partial<Row> = {}): Row {
  const id = overrides.id ?? 'ci-1';
  const row: Row = {
    id,
    patientId: 'patient-1',
    clinicId: 'clinic-A',
    departmentId: 'dept-1',
    status: 'PENDING_PAYMENT',
    amountKes: 50,
    mpesaCheckoutRequestId: `ws_CO_${id}`,
    mpesaMerchantRequestId: `mr-${id}`,
    manualMpesaCode: null,
    createdAt: minutesAgo(2),
    ...overrides,
  };
  db.checkIns.set(id, row);
  return row;
}

/** What Daraja's callback carries (parsed) — including the phone number and receipt that must never be logged. */
function callback(checkInId: string, resultCode: number) {
  return {
    merchantRequestId: `mr-${checkInId}`,
    checkoutRequestId: `ws_CO_${checkInId}`,
    resultCode,
    resultDesc:
      resultCode === 0 ? 'The service request is processed successfully.' : 'Request cancelled by user',
    ...(resultCode === 0 ? { amountKes: 50, mpesaReceiptNumber: RECEIPT, phoneNumber: PHONE } : {}),
  };
}

function queryAnswers(resultCode: string) {
  mockQuery.mockResolvedValue({
    resultCode,
    resultDesc: 'from Safaricom',
    merchantRequestId: 'mr-ci-1',
    checkoutRequestId: 'ws_CO_ci-1',
  });
}

const status = (id = 'ci-1') => db.checkIns.get(id)!.status;
const paymentLogLines = () =>
  mockLogInfo.mock.calls.filter((c) => c[1] === 'Check-in payment').map((c) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  db.checkIns = new Map();
  db.encounters = [];
  db.transactions = [];
  mockRedisSet.mockResolvedValue('OK');
  (assignDoctorForCheckIn as jest.Mock).mockResolvedValue('doc-1');
});

afterEach(() => {
  // The logging rule, checked after every test: only these four fields, and
  // never a phone number or an M-Pesa receipt/transaction code.
  for (const [fields] of mockLogInfo.mock.calls) {
    expect(Object.keys(fields).sort()).toEqual(['checkInId', 'resultCode', 'source', 'status']);
  }
  const everything = JSON.stringify([
    mockLogInfo.mock.calls,
    (logger.warn as jest.Mock).mock.calls,
    (logger.error as jest.Mock).mock.calls,
  ]);
  expect(everything).not.toMatch(new RegExp(`${PHONE}|${RECEIPT}|QAB12CD34E`));
});

describe('callback missing, status query says paid', () => {
  it('marks the check-in PAID from the query alone and starts the visit', async () => {
    addCheckIn();
    queryAnswers('0');

    await expect(queryCheckInPayment('ci-1')).resolves.toBe('PAID');

    expect(mockQuery).toHaveBeenCalledWith('ws_CO_ci-1');
    expect(status()).toBe('PAID');
    expect(db.encounters).toEqual([
      { patientId: 'patient-1', clinicId: 'clinic-A', checkInId: 'ci-1', assignedDoctorId: 'doc-1' },
    ]);
    expect(db.transactions).toHaveLength(1);
    expect(db.transactions[0]).toMatchObject({ checkInId: 'ci-1', resultCode: 0 });
    expect(publishCheckInPaid).toHaveBeenCalledTimes(1);
    expect(enqueueSmsReceipt).toHaveBeenCalledWith({
      checkInId: 'ci-1',
      patientId: 'patient-1',
      succeeded: true,
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CHECK_IN_PAID',
        metadata: expect.objectContaining({ source: 'query' }),
      }),
    );
    expect(paymentLogLines()).toEqual([
      { checkInId: 'ci-1', source: 'query', resultCode: 0, status: 'PAID' },
    ]);
  });

  it('marks it FAILED on a definite failure such as 1032 (cancelled by the patient)', async () => {
    addCheckIn();
    queryAnswers('1032');

    await expect(queryCheckInPayment('ci-1')).resolves.toBe('FAILED');

    expect(status()).toBe('FAILED');
    expect(db.encounters).toHaveLength(0);
    expect(publishCheckInFailed).toHaveBeenCalledWith({ checkInId: 'ci-1', clinicId: 'clinic-A' });
    expect(paymentLogLines()).toEqual([
      { checkInId: 'ci-1', source: 'query', resultCode: 1032, status: 'FAILED' },
    ]);
  });
});

describe('callback and query both arriving', () => {
  it('callback first: the later query is a no-op (and needs no call to Safaricom)', async () => {
    addCheckIn();
    queryAnswers('0');

    await applyPaymentResult(callback('ci-1', 0), { raw: true }, 'callback');
    await expect(queryCheckInPayment('ci-1')).resolves.toBe('PAID');

    expect(mockQuery).not.toHaveBeenCalled();
    expect(db.encounters).toHaveLength(1);
    expect(db.transactions).toHaveLength(1);
    expect(enqueueSmsReceipt).toHaveBeenCalledTimes(1);
  });

  it('query first: the late callback changes nothing, but still gets its one log line', async () => {
    addCheckIn();
    queryAnswers('0');

    await queryCheckInPayment('ci-1');
    await expect(applyPaymentResult(callback('ci-1', 0), { raw: true }, 'callback')).resolves.toEqual({
      checkInId: 'ci-1',
      status: 'PAID',
    });

    expect(db.encounters).toHaveLength(1);
    expect(db.transactions).toHaveLength(1);
    expect(publishCheckInPaid).toHaveBeenCalledTimes(1);
    expect(enqueueSmsReceipt).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(paymentLogLines()).toEqual([
      { checkInId: 'ci-1', source: 'query', resultCode: 0, status: 'PAID' },
      { checkInId: 'ci-1', source: 'callback', resultCode: 0, status: 'PAID' },
    ]);
  });

  it('at the same moment: exactly one of them takes effect', async () => {
    addCheckIn();
    queryAnswers('0');

    await Promise.all([
      applyPaymentResult(callback('ci-1', 0), { raw: true }, 'callback'),
      applyPaymentResult(callback('ci-1', 0), {}, 'query'),
    ]);

    expect(status()).toBe('PAID');
    expect(db.encounters).toHaveLength(1);
    expect(db.transactions).toHaveLength(1);
    expect(enqueueSmsReceipt).toHaveBeenCalledTimes(1);
  });

  it('first answer wins even when they disagree', async () => {
    addCheckIn();
    queryAnswers('1032');

    await queryCheckInPayment('ci-1');
    await applyPaymentResult(callback('ci-1', 0), {}, 'callback');

    expect(status()).toBe('FAILED');
    expect(db.encounters).toHaveLength(0);
  });

  it('logs a callback for an unknown check-in with no id or status', async () => {
    await expect(applyPaymentResult(callback('ci-unknown', 0), {}, 'callback')).resolves.toBeNull();
    expect(paymentLogLines()).toEqual([{ checkInId: null, source: 'callback', resultCode: 0, status: null }]);
  });
});

describe('query says still processing', () => {
  it('leaves the check-in pending when Daraja answers the query with an error ("The transaction is being processed")', async () => {
    addCheckIn();
    mockQuery.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 500'), { isAxiosError: true }),
    );

    await expect(queryCheckInPayment('ci-1')).resolves.toBe('PENDING_PAYMENT');

    expect(status()).toBe('PENDING_PAYMENT');
    expect(db.transactions).toHaveLength(0);
    expect(paymentLogLines()).toEqual([
      { checkInId: 'ci-1', source: 'query', resultCode: null, status: 'PENDING_PAYMENT' },
    ]);
  });

  it('leaves it pending on a result code that is not a definite outcome', async () => {
    addCheckIn();
    queryAnswers('4999');

    await expect(queryCheckInPayment('ci-1')).resolves.toBe('PENDING_PAYMENT');

    expect(status()).toBe('PENDING_PAYMENT');
    expect(paymentLogLines()).toEqual([
      { checkInId: 'ci-1', source: 'query', resultCode: 4999, status: 'PENDING_PAYMENT' },
    ]);
  });

  it('asks Safaricom at most once per 10 seconds per check-in, however often it is polled', async () => {
    addCheckIn();
    queryAnswers('4999');
    mockRedisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await queryCheckInPayment('ci-1');
    await queryCheckInPayment('ci-1');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockRedisSet).toHaveBeenCalledWith('mpesa:checkin-query:ci-1', '1', 'EX', 10, 'NX');
  });
});

describe('the once-a-minute sweep and the 60-minute timeout', () => {
  it('queries check-ins pending 1–60 minutes and moves ones pending over 60 minutes to NEEDS_REVIEW (not FAILED)', async () => {
    addCheckIn({ id: 'ci-new', createdAt: minutesAgo(0.5) });
    addCheckIn({ id: 'ci-10min', createdAt: minutesAgo(10) });
    addCheckIn({ id: 'ci-61min', createdAt: minutesAgo(61) });
    addCheckIn({ id: 'ci-paid', status: 'PAID', createdAt: minutesAgo(90) });
    mockQuery.mockRejectedValue(new Error('still processing'));

    await expect(sweepPendingCheckInPayments(NOW)).resolves.toEqual({ queried: 1, needsReview: 1 });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith('ws_CO_ci-10min');
    expect(status('ci-new')).toBe('PENDING_PAYMENT');
    expect(status('ci-10min')).toBe('PENDING_PAYMENT');
    expect(status('ci-61min')).toBe('NEEDS_REVIEW');
    expect(status('ci-paid')).toBe('PAID');
    // Shows up straight away on open staff dashboards.
    expect(publishCheckInFailed).toHaveBeenCalledWith({ checkInId: 'ci-61min', clinicId: 'clinic-A' });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CHECK_IN_PAYMENT_NEEDS_REVIEW', entityId: 'ci-61min' }),
    );
    expect(paymentLogLines()).toContainEqual({
      checkInId: 'ci-61min',
      source: 'query',
      resultCode: null,
      status: 'NEEDS_REVIEW',
    });
  });

  it('settles a pending check-in the query has an answer for', async () => {
    addCheckIn({ createdAt: minutesAgo(5) });
    queryAnswers('0');

    await sweepPendingCheckInPayments(NOW);

    expect(status()).toBe('PAID');
  });

  it('a late definite answer from M-Pesa still resolves a NEEDS_REVIEW check-in', async () => {
    addCheckIn({ status: 'NEEDS_REVIEW', createdAt: minutesAgo(75) });

    await applyPaymentResult(callback('ci-1', 0), {}, 'callback');

    expect(status()).toBe('PAID');
    expect(db.encounters).toHaveLength(1);
  });
});

describe('staff confirming the fee with the M-Pesa code', () => {
  it('stores the code, who confirmed it and when, starts the visit, and audits it', async () => {
    addCheckIn({ status: 'NEEDS_REVIEW', createdAt: minutesAgo(70) });

    const result = await confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1', ' qab12cd34e ');

    expect(result.status).toBe('PAID');
    const row = db.checkIns.get('ci-1')!;
    expect(row).toMatchObject({
      status: 'PAID',
      manualMpesaCode: 'QAB12CD34E',
      paymentConfirmedByStaffId: 'staff-1',
    });
    expect(row.paymentConfirmedAt).toBeInstanceOf(Date);
    expect(db.encounters).toHaveLength(1);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CHECK_IN_PAID_MANUALLY',
        actorType: 'STAFF',
        staffId: 'staff-1',
        entityId: 'ci-1',
        metadata: expect.objectContaining({ confirmedByStaffId: 'staff-1', previousStatus: 'NEEDS_REVIEW' }),
      }),
    );
    expect(paymentLogLines()).toEqual([
      { checkInId: 'ci-1', source: 'staff', resultCode: null, status: 'PAID' },
    ]);
  });

  it('works for a FAILED or still-pending check-in too', async () => {
    addCheckIn({ id: 'ci-failed', status: 'FAILED', mpesaCheckoutRequestId: null });
    addCheckIn({ id: 'ci-pending' });

    await confirmCheckInPaidManually('ci-failed', 'clinic-A', 'staff-1', 'QAB12CD34E');
    await confirmCheckInPaidManually('ci-pending', 'clinic-A', 'staff-1', 'QAB12CD34F');

    expect(status('ci-failed')).toBe('PAID');
    expect(status('ci-pending')).toBe('PAID');
  });

  it('refuses a code that does not look like an M-Pesa code, before touching anything', async () => {
    addCheckIn();
    await expect(confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1', 'HELLO')).rejects.toMatchObject({
      status: 400,
    });
    expect(status()).toBe('PENDING_PAYMENT');
  });

  it('refuses a code already used for another payment, leaving the check-in as it was', async () => {
    addCheckIn({ id: 'ci-other', status: 'PAID', manualMpesaCode: 'QAB12CD34E' });
    addCheckIn();

    const attempt = confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1', 'QAB12CD34E');

    await expect(attempt).rejects.toBeInstanceOf(InvalidMpesaCodeError);
    await expect(attempt).rejects.toMatchObject({ status: 409 });
    expect(status()).toBe('PENDING_PAYMENT');
    expect(db.checkIns.get('ci-1')!.manualMpesaCode).toBeNull();
    expect(db.encounters).toHaveLength(0);
  });

  it('refuses a code M-Pesa already reported for a check-in fee', async () => {
    db.transactions.push({ checkInId: 'ci-other', mpesaReceiptNumber: 'QAB12CD34E' });
    addCheckIn();
    await expect(
      confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1', 'QAB12CD34E'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('loses cleanly to M-Pesa: once the callback has marked it PAID, staff get "already paid" and nothing is stored', async () => {
    addCheckIn();
    await applyPaymentResult(callback('ci-1', 0), {}, 'callback');

    await expect(
      confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1', 'QAB12CD34E'),
    ).rejects.toBeInstanceOf(CheckInNotPendingError);

    expect(db.checkIns.get('ci-1')!.manualMpesaCode).toBeNull();
    expect(db.encounters).toHaveLength(1);
  });

  it('wins cleanly too: a callback after staff confirmed is a no-op', async () => {
    addCheckIn();
    await confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1', 'QAB12CD34E');

    await applyPaymentResult(callback('ci-1', 0), {}, 'callback');

    expect(db.encounters).toHaveLength(1);
    expect(db.transactions).toHaveLength(0);
    expect(enqueueSmsReceipt).toHaveBeenCalledTimes(1);
  });

  it("is scoped to the staff member's own clinic", async () => {
    addCheckIn({ clinicId: 'clinic-B' });
    await expect(confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1', 'QAB12CD34E')).rejects.toThrow(
      'Check-in not found',
    );
  });
});
