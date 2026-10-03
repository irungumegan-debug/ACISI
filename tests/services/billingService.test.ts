import { createFakeBillingDb } from '../helpers/fakeBillingDb';

let mockDb: ReturnType<typeof createFakeBillingDb>;
jest.mock('../../src/db/prisma', () => ({
  get prisma() {
    return mockDb.db;
  },
}));
jest.mock('../../src/config/africastalking', () => ({ smsClient: { send: jest.fn() } }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/mpesa/clinicStk', () => ({
  clinicStkConfigured: jest.fn(() => true),
  sendClinicStkPush: jest.fn(),
}));
jest.mock('../../src/jobs/queue', () => ({ scheduleClinicStkStatusCheck: jest.fn() }));

import { smsClient } from '../../src/config/africastalking';
import { sendClinicStkPush } from '../../src/mpesa/clinicStk';
import { scheduleClinicStkStatusCheck } from '../../src/jobs/queue';
import {
  applyClinicStkResult,
  buildAccountReference,
  markStkTimedOut,
  recordPayment,
  requestStkPayment,
  saveBill,
  sendPaidReceiptSms,
  STK_TIMEOUT_MS,
  voidPayment,
} from '../../src/services/billingService';

const mockSend = smsClient.send as jest.Mock;
const mockPush = sendClinicStkPush as jest.Mock;

let keySeq = 0;
const key = () => `idem-key-${++keySeq}`;
const base = { clinicId: 'clinic-A', staffId: 'staff-1' };

async function billFor(totalItems: number[], opts: { smsOptOut?: boolean; discountKes?: number } = {}) {
  const visit = mockDb.addVisit({ smsOptOut: opts.smsOptOut });
  const bill = await saveBill({
    ...base,
    encounterId: visit.id,
    items: totalItems.map((amountKes, i) => ({ kind: i === 0 ? 'CONSULTATION' : 'OTHER', description: `Line ${i + 1}`, amountKes })),
    discountKes: opts.discountKes ?? 0,
    discountReason: opts.discountKes ? 'Regular patient' : null,
  });
  return { visit, bill };
}

const billNow = (id: string) => mockDb.bills.find((b) => b.id === id)!;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createFakeBillingDb();
  mockDb.acceptAll();
  mockPush.mockImplementation(async () => ({ checkoutRequestId: `ws_CO_${++keySeq}`, merchantRequestId: 'mr-1' }));
});

describe('saveBill', () => {
  it('saves lines, discount and total against the visit', async () => {
    const { bill } = await billFor([500, 800, 200], { discountKes: 300 });
    expect(bill).toMatchObject({ subtotalKes: 1500, discountKes: 300, discountReason: 'Regular patient', totalKes: 1200, status: 'UNPAID' });
    expect(mockDb.items.filter((i) => i.billId === bill.id)).toHaveLength(3);
  });

  it('replaces lines when the bill is edited', async () => {
    const { visit, bill } = await billFor([500, 800]);
    const edited = await saveBill({ ...base, encounterId: visit.id, items: [{ kind: 'CONSULTATION', description: 'Consult', amountKes: 700 }], discountKes: 0 });
    expect(edited.id).toBe(bill.id);
    expect(edited.totalKes).toBe(700);
    expect(mockDb.items.filter((i) => i.billId === bill.id)).toHaveLength(1);
  });

  it('only bills a visit the doctor has finished', async () => {
    const visit = mockDb.addVisit({ status: 'WITH_DOCTOR' });
    await expect(
      saveBill({ ...base, encounterId: visit.id, items: [{ kind: 'CONSULTATION', description: 'Consult', amountKes: 500 }], discountKes: 0 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses another clinic’s visit', async () => {
    const visit = mockDb.addVisit();
    await expect(
      saveBill({ ...base, clinicId: 'clinic-B', encounterId: visit.id, items: [{ kind: 'OTHER', description: 'x', amountKes: 1 }], discountKes: 0 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('won’t drop the total below what has been paid', async () => {
    const { visit, bill } = await billFor([1000]);
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 600 });
    await expect(
      saveBill({ ...base, encounterId: visit.id, items: [{ kind: 'CONSULTATION', description: 'Consult', amountKes: 500 }], discountKes: 0 }),
    ).rejects.toThrow('already paid');
  });
});

describe('recordPayment: cash, card, manual M-Pesa and splits', () => {
  it('records cash with change and marks the bill paid', async () => {
    const { bill } = await billFor([1300]);
    const result = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 2000 });
    expect(result.changeKes).toBe(700);
    expect(result.payment).toMatchObject({ amountKes: 1300, cashTenderedKes: 2000, status: 'SUCCEEDED', takenByStaffId: 'staff-1' });
    expect(result.bill).toMatchObject({ paidKes: 1300, status: 'PAID' });
  });

  it('takes split payments until the bill is covered: Unpaid -> Partly paid -> Paid', async () => {
    const { bill } = await billFor([2000]);
    expect(billNow(bill.id).status).toBe('UNPAID');

    const cash = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 500 });
    expect(cash.bill).toMatchObject({ status: 'PARTLY_PAID', paidKes: 500 });

    const card = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CARD', amountKes: 700, reference: '4242' });
    expect(card.bill).toMatchObject({ status: 'PARTLY_PAID', paidKes: 1200 });

    const mpesa = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'MPESA_MANUAL', amountKes: 800, mpesaCode: 'qab12cd34e' });
    expect(mpesa.payment.mpesaReceiptNumber).toBe('QAB12CD34E');
    expect(mpesa.bill).toMatchObject({ status: 'PAID', paidKes: 2000 });
    expect(mpesa.bill.paidAt).toBeInstanceOf(Date);
  });

  it('refuses card or M-Pesa amounts over the balance, and anything once paid', async () => {
    const { bill } = await billFor([1000]);
    await expect(recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CARD', amountKes: 1001, reference: '4242' })).rejects.toThrow(
      'more than the balance',
    );
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1000 });
    await expect(recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 100 })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a card payment without a reference', async () => {
    const { bill } = await billFor([1000]);
    await expect(recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CARD', amountKes: 500, reference: '12' })).rejects.toThrow('reference');
  });

  it('refuses a method the clinic has switched off', async () => {
    mockDb.settings[0]!.acceptsCard = false;
    const { bill } = await billFor([1000]);
    await expect(recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CARD', amountKes: 500, reference: '4242' })).rejects.toThrow(
      'does not accept',
    );
  });

  it('a repeated submit (same idempotency key) records the payment only once', async () => {
    const { bill } = await billFor([1000]);
    const k = key();
    const first = await recordPayment({ ...base, billId: bill.id, idempotencyKey: k, method: 'CASH', tenderedKes: 400 });
    const second = await recordPayment({ ...base, billId: bill.id, idempotencyKey: k, method: 'CASH', tenderedKes: 400 });
    expect(second.payment.id).toBe(first.payment.id);
    expect(mockDb.payments).toHaveLength(1);
    expect(billNow(bill.id).paidKes).toBe(400);
  });
});

describe('duplicate M-Pesa codes', () => {
  it('rejects a code already used on another clinic payment', async () => {
    const a = await billFor([1000]);
    const b = await billFor([1000]);
    await recordPayment({ ...base, billId: a.bill.id, idempotencyKey: key(), method: 'MPESA_MANUAL', amountKes: 1000, mpesaCode: 'QAB12CD34E' });
    await expect(
      recordPayment({ ...base, billId: b.bill.id, idempotencyKey: key(), method: 'MPESA_MANUAL', amountKes: 1000, mpesaCode: 'qab12cd34e' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already been used') });
  });

  it('rejects a code already recorded as an ACISI check-in fee receipt', async () => {
    mockDb.mpesaTransactions.push({ mpesaReceiptNumber: 'QFE55XY12Z' });
    const { bill } = await billFor([1000]);
    await expect(
      recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'MPESA_MANUAL', amountKes: 1000, mpesaCode: 'QFE55XY12Z' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a badly formatted code before touching the bill', async () => {
    const { bill } = await billFor([1000]);
    await expect(
      recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'MPESA_MANUAL', amountKes: 1000, mpesaCode: 'NOTACODE' }),
    ).rejects.toThrow('valid M-Pesa code');
    expect(mockDb.payments).toHaveLength(0);
  });

  it('a voided payment releases its code so it can be entered on the right bill', async () => {
    const wrong = await billFor([1000]);
    const right = await billFor([1000]);
    const first = await recordPayment({ ...base, billId: wrong.bill.id, idempotencyKey: key(), method: 'MPESA_MANUAL', amountKes: 1000, mpesaCode: 'QAB12CD34E' });
    await voidPayment({ ...base, paymentId: first.payment.id, reason: 'Entered on wrong patient' });
    const second = await recordPayment({ ...base, billId: right.bill.id, idempotencyKey: key(), method: 'MPESA_MANUAL', amountKes: 1000, mpesaCode: 'QAB12CD34E' });
    expect(second.bill.status).toBe('PAID');
    expect(mockDb.payments.find((p) => p.id === first.payment.id)).toMatchObject({ mpesaReceiptNumber: null, voidedMpesaReceiptNumber: 'QAB12CD34E' });
  });
});

describe('STK push into the clinic till/paybill', () => {
  async function requestFor(amountKes: number, billId: string) {
    return requestStkPayment({ ...base, billId, idempotencyKey: key(), amountKes });
  }

  it('creates a waiting payment, sends the prompt and schedules a status check', async () => {
    const { bill } = await billFor([1500]);
    const { payment } = await requestFor(1500, bill.id);
    expect(payment).toMatchObject({ status: 'PENDING', method: 'MPESA_STK', amountKes: 1500, phoneNumber: '+254712345678' });
    expect(payment.mpesaCheckoutRequestId).toMatch(/^ws_CO_/);
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ amountKes: 1500, accountReference: 'ACI-7F2K', mobileMoneyType: 'PAYBILL' }));
    expect(scheduleClinicStkStatusCheck).toHaveBeenCalledWith({ paymentId: payment.id });
    expect(billNow(bill.id).status).toBe('UNPAID'); // nothing paid until M-Pesa confirms
  });

  it('success callback marks the payment and bill paid and sends one receipt', async () => {
    const { bill } = await billFor([1500]);
    const { payment } = await requestFor(1500, bill.id);
    const ok = { checkoutRequestId: payment.mpesaCheckoutRequestId!, resultCode: 0, resultDesc: 'Success', mpesaReceiptNumber: 'qkl98mn76p' };
    await expect(applyClinicStkResult(ok)).resolves.toBe(true);
    expect(mockDb.payments[0]).toMatchObject({ status: 'SUCCEEDED', mpesaReceiptNumber: 'QKL98MN76P' });
    expect(billNow(bill.id)).toMatchObject({ status: 'PAID', paidKes: 1500 });

    await applyClinicStkResult(ok); // Daraja retries the callback
    expect(billNow(bill.id).paidKes).toBe(1500);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1032, 'CANCELLED'],
    [1037, 'TIMED_OUT'],
    [2001, 'FAILED'],
  ])('result code %i marks the payment %s and leaves the bill unpaid', async (resultCode, status) => {
    const { bill } = await billFor([1500]);
    const { payment } = await requestFor(1500, bill.id);
    await applyClinicStkResult({ checkoutRequestId: payment.mpesaCheckoutRequestId!, resultCode, resultDesc: 'nope' });
    expect(mockDb.payments[0]!.status).toBe(status);
    expect(billNow(bill.id)).toMatchObject({ status: 'UNPAID', paidKes: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('a retry after failure sends a fresh prompt', async () => {
    const { bill } = await billFor([1500]);
    const first = await requestFor(1500, bill.id);
    await applyClinicStkResult({ checkoutRequestId: first.payment.mpesaCheckoutRequestId!, resultCode: 1032, resultDesc: 'Cancelled' });
    const retry = await requestFor(1500, bill.id);
    expect(retry.payment.id).not.toBe(first.payment.id);
    expect(retry.payment.status).toBe('PENDING');
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('a waiting prompt blocks other payments so the patient can’t be charged twice', async () => {
    const { bill } = await billFor([1500]);
    await requestFor(1500, bill.id);
    await expect(requestFor(1500, bill.id)).rejects.toMatchObject({ status: 409 });
    await expect(recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1500 })).rejects.toMatchObject({ status: 409 });
  });

  it('a prompt older than the timeout no longer blocks, and is marked timed out', async () => {
    const { bill } = await billFor([1500]);
    const { payment } = await requestFor(1500, bill.id);
    mockDb.payments[0]!.createdAt = new Date(Date.now() - STK_TIMEOUT_MS - 1000);
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1500 });
    expect(mockDb.payments.find((p) => p.id === payment.id)!.status).toBe('TIMED_OUT');
  });

  it('a late success after a time-out still counts, because the money arrived', async () => {
    const { bill } = await billFor([1500]);
    const { payment } = await requestFor(1500, bill.id);
    await markStkTimedOut(payment.id);
    expect(mockDb.payments[0]!.status).toBe('TIMED_OUT');
    await applyClinicStkResult({ checkoutRequestId: payment.mpesaCheckoutRequestId!, resultCode: 0, resultDesc: 'Success', mpesaReceiptNumber: 'QKL98MN76P' });
    expect(mockDb.payments[0]!.status).toBe('SUCCEEDED');
    expect(billNow(bill.id).status).toBe('PAID');
  });

  it('a late failure after a time-out changes nothing', async () => {
    const { bill } = await billFor([1500]);
    const { payment } = await requestFor(1500, bill.id);
    await markStkTimedOut(payment.id);
    await applyClinicStkResult({ checkoutRequestId: payment.mpesaCheckoutRequestId!, resultCode: 1032, resultDesc: 'Cancelled' });
    expect(mockDb.payments[0]!.status).toBe('TIMED_OUT');
  });

  it('marks the request failed if M-Pesa can’t be reached', async () => {
    mockPush.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { bill } = await billFor([1500]);
    const { payment } = await requestFor(1500, bill.id);
    expect(payment.status).toBe('FAILED');
    expect(scheduleClinicStkStatusCheck).not.toHaveBeenCalled();
  });

  it('ignores callbacks for unknown checkout requests', async () => {
    await expect(applyClinicStkResult({ checkoutRequestId: 'ws_CO_unknown', resultCode: 0, resultDesc: 'x' })).resolves.toBe(false);
  });

  it('splits with cash: prompt for the balance after a cash part payment', async () => {
    const { bill } = await billFor([2000]);
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 500 });
    await expect(requestFor(1600, bill.id)).rejects.toThrow('more than the balance');
    const { payment } = await requestFor(1500, bill.id);
    await applyClinicStkResult({ checkoutRequestId: payment.mpesaCheckoutRequestId!, resultCode: 0, resultDesc: 'ok', mpesaReceiptNumber: 'QKL98MN76P' });
    expect(billNow(bill.id)).toMatchObject({ status: 'PAID', paidKes: 2000 });
  });
});

describe('buildAccountReference', () => {
  it('fills the template and keeps within 12 characters', () => {
    expect(buildAccountReference('{patientCode}', { patientCode: 'ACI-7F2K', billNumber: 'B-XY12Z9' })).toBe('ACI-7F2K');
    expect(buildAccountReference('{billNumber}', { patientCode: 'ACI-7F2K', billNumber: 'B-XY12Z9' })).toBe('B-XY12Z9');
    expect(buildAccountReference('{patientCode}{billNumber}', { patientCode: 'ACI-7F2K', billNumber: 'B-XY12Z9' })).toHaveLength(12);
    expect(buildAccountReference(null, { patientCode: 'ACI-7F2K', billNumber: 'B-XY12Z9' })).toBe('B-XY12Z9');
  });
});

describe('voidPayment', () => {
  it('voids with a reason, keeps the row, and recalculates the bill', async () => {
    const { bill } = await billFor([1000]);
    const { payment } = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1000 });
    expect(billNow(bill.id).status).toBe('PAID');

    const after = await voidPayment({ ...base, staffId: 'admin-1', paymentId: payment.id, reason: 'Wrong patient' });
    expect(after).toMatchObject({ status: 'UNPAID', paidKes: 0, paidAt: null });
    expect(mockDb.payments).toHaveLength(1);
    expect(mockDb.payments[0]).toMatchObject({ status: 'VOIDED', voidedByStaffId: 'admin-1', voidReason: 'Wrong patient' });
    expect(mockDb.payments[0]!.voidedAt).toBeInstanceOf(Date);
  });

  it('requires a reason', async () => {
    const { bill } = await billFor([1000]);
    const { payment } = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1000 });
    await expect(voidPayment({ ...base, paymentId: payment.id, reason: ' ' })).rejects.toThrow('reason');
    expect(mockDb.payments[0]!.status).toBe('SUCCEEDED');
  });

  it('won’t void twice, a waiting prompt, or another clinic’s payment', async () => {
    const { bill } = await billFor([1000]);
    const { payment } = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 500 });
    await expect(voidPayment({ ...base, clinicId: 'clinic-B', paymentId: payment.id, reason: 'Mistake' })).rejects.toMatchObject({ status: 404 });
    await voidPayment({ ...base, paymentId: payment.id, reason: 'Mistake' });
    await expect(voidPayment({ ...base, paymentId: payment.id, reason: 'Mistake' })).rejects.toMatchObject({ status: 409 });

    const stk = await requestStkPayment({ ...base, billId: bill.id, idempotencyKey: key(), amountKes: 500 });
    await expect(voidPayment({ ...base, paymentId: stk.payment.id, reason: 'Mistake' })).rejects.toMatchObject({ status: 409 });
  });

  it('a partly paid bill goes back to partly paid when one of its payments is voided', async () => {
    const { bill } = await billFor([1000]);
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 300 });
    const card = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CARD', amountKes: 700, reference: '4242' });
    expect((await voidPayment({ ...base, paymentId: card.payment.id, reason: 'Card declined later' })).status).toBe('PARTLY_PAID');
  });
});

describe('receipt SMS', () => {
  it('sends one receipt when the bill becomes fully paid, not on part payments', async () => {
    const { bill } = await billFor([1500]);
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 500 });
    expect(mockSend).not.toHaveBeenCalled();
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'MPESA_MANUAL', amountKes: 1000, mpesaCode: 'QAB12CD34E' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { to, message } = mockSend.mock.calls[0][0];
    expect(to).toEqual(['+254712345678']);
    expect(message).toContain('Sunrise Family Clinic');
    expect(message).toContain('KES 1,500');
    expect(message).toContain('QAB12CD34E');
    expect(message).toContain('Cash');
    expect(message.length).toBeLessThanOrEqual(160);
    expect(billNow(bill.id).receiptSmsSentAt).toBeInstanceOf(Date);
  });

  it('respects the patient’s "Don’t send SMS" choice', async () => {
    const { bill } = await billFor([1500], { smsOptOut: true });
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1500 });
    expect(billNow(bill.id).status).toBe('PAID');
    expect(mockSend).not.toHaveBeenCalled();
    await expect(sendPaidReceiptSms(bill.id)).resolves.toBe('opted_out');
  });

  it('never sends a second receipt for the same bill (even after a void and re-payment)', async () => {
    const { bill } = await billFor([1000]);
    const { payment } = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1000 });
    await voidPayment({ ...base, paymentId: payment.id, reason: 'Recount' });
    await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1000 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    await expect(sendPaidReceiptSms(bill.id)).resolves.toBe('already_sent');
  });

  it('a failed SMS doesn’t undo the payment', async () => {
    mockSend.mockRejectedValueOnce(new Error('AT down'));
    const { bill } = await billFor([1000]);
    const result = await recordPayment({ ...base, billId: bill.id, idempotencyKey: key(), method: 'CASH', tenderedKes: 1000 });
    expect(result.bill.status).toBe('PAID');
  });

  it('sends nothing for a fully waived KES 0 bill', async () => {
    const visit = mockDb.addVisit();
    const bill = await saveBill({ ...base, encounterId: visit.id, items: [{ kind: 'CONSULTATION', description: 'Consult', amountKes: 500 }], discountKes: 500, discountReason: 'Waived' });
    expect(bill.status).toBe('PAID');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
