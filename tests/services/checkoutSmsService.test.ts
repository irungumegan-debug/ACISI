jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findUniqueOrThrow: jest.fn() },
    bill: { updateMany: jest.fn() },
  },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/smsService', () => ({ sendPatientSms: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { sendPatientSms } from '../../src/services/smsService';
import { sendCheckoutSms } from '../../src/services/checkoutSmsService';
import { CLINIC_COUNTED_SMS_PURPOSES } from '../../src/config/constants';

const mockFind = prisma.encounter.findUniqueOrThrow as jest.Mock;
const mockBillUpdate = prisma.bill.updateMany as jest.Mock;
const mockSend = sendPatientSms as jest.Mock;
const mockAudit = recordAuditEvent as jest.Mock;

/**
 * What the database would return. The real query selects only these fields:
 * the diagnosis and department are not fetched at all; they are added here
 * to prove that even if they were present, they could never reach the SMS.
 */
function visit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enc-1',
    clinicId: 'clinic-A',
    createdAt: new Date('2026-10-03T07:00:00Z'),
    prescription: 'Amoxicillin 500mg 3x daily 5 days',
    diagnosis: 'Malaria (SECRET-DIAGNOSIS)',
    department: { name: 'SECRET-DEPARTMENT' },
    clinic: { name: 'Sunrise Family Clinic' },
    patient: { id: 'p-1', phoneNumber: '+254712345678', smsOptOut: false, deletedAt: null },
    bill: {
      id: 'bill-1',
      status: 'PAID',
      totalKes: 1500,
      paidKes: 1500,
      payments: [{ method: 'MPESA_MANUAL', mpesaReceiptNumber: 'QAB12CD34E', reference: null }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue('sent');
});

describe('sendCheckoutSms', () => {
  it('sends ONE SMS with clinic, date, amount, method and prescription, never the diagnosis or department', async () => {
    mockFind.mockResolvedValue(visit());

    await expect(sendCheckoutSms('enc-1')).resolves.toBe('sent');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [patient, message, options] = mockSend.mock.calls[0];
    expect(patient.phoneNumber).toBe('+254712345678');
    expect(message).toContain('Sunrise Family Clinic');
    expect(message).toContain('03/10/2026');
    expect(message).toContain('KES 1,500');
    expect(message).toContain('M-Pesa QAB12CD34E');
    expect(message).toContain('Prescription: Amoxicillin 500mg 3x daily 5 days');
    expect(message).not.toContain('SECRET-DIAGNOSIS');
    expect(message).not.toContain('Malaria');
    expect(message).not.toContain('SECRET-DEPARTMENT');
    expect(message.length).toBeLessThanOrEqual(160);
    expect(options).toEqual({ purpose: 'CHECKOUT_SUMMARY', clinicId: 'clinic-A' });
  });

  it('does not even fetch the diagnosis or department from the database', async () => {
    mockFind.mockResolvedValue(visit());
    await sendCheckoutSms('enc-1');
    const { select } = mockFind.mock.calls[0][0];
    expect(select.diagnosis).toBeUndefined();
    expect(select.checkIn).toBeUndefined();
    expect(select.department).toBeUndefined();
  });

  it('respects "does not want SMS": nothing is sent and the skip is logged', async () => {
    mockFind.mockResolvedValue(visit({ patient: { id: 'p-1', phoneNumber: '+254712345678', smsOptOut: true, deletedAt: null } }));

    await expect(sendCheckoutSms('enc-1')).resolves.toBe('opted_out');
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'CHECKOUT_SMS_SKIPPED_OPT_OUT', entityId: 'enc-1' }));
  });

  it('a fully paid bill counts as receipted, so no second receipt SMS follows', async () => {
    mockFind.mockResolvedValue(visit());
    await sendCheckoutSms('enc-1');
    expect(mockBillUpdate).toHaveBeenCalledWith({ where: { id: 'bill-1', receiptSmsSentAt: null }, data: { receiptSmsSentAt: expect.any(Date) } });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'CHECKOUT_SMS_SENT', entityId: 'enc-1' }));
  });

  it('a part-paid bill is not marked receipted: paying the rest later still sends a receipt', async () => {
    mockFind.mockResolvedValue(
      visit({ bill: { id: 'bill-1', status: 'PARTLY_PAID', totalKes: 2000, paidKes: 500, payments: [{ method: 'CASH', mpesaReceiptNumber: null, reference: null }] } }),
    );
    await sendCheckoutSms('enc-1');
    expect(mockSend.mock.calls[0][1]).toContain('Paid KES 500 by Cash. Balance KES 1,500.');
    expect(mockBillUpdate).not.toHaveBeenCalled();
  });

  it('works without a bill', async () => {
    mockFind.mockResolvedValue(visit({ bill: null }));
    await sendCheckoutSms('enc-1');
    expect(mockSend.mock.calls[0][1]).toContain('No payment recorded.');
  });

  it('never throws: a failed SMS must not undo the checkout', async () => {
    mockFind.mockResolvedValue(visit());
    mockSend.mockResolvedValue('failed');
    await expect(sendCheckoutSms('enc-1')).resolves.toBe('failed');
    expect(mockBillUpdate).not.toHaveBeenCalled();

    mockFind.mockRejectedValue(new Error('db down'));
    await expect(sendCheckoutSms('enc-1')).resolves.toBe('failed');
  });

  it("counts against the clinic's SMS allowance (sent on the clinic's behalf)", () => {
    expect(CLINIC_COUNTED_SMS_PURPOSES).toContain('CHECKOUT_SUMMARY');
  });
});
