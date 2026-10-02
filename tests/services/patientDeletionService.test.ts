jest.mock('../../src/db/prisma', () => {
  const tx = {
    patient: { findUnique: jest.fn(), update: jest.fn() },
    otp: { deleteMany: jest.fn() },
    consent: { create: jest.fn() },
    appointment: { updateMany: jest.fn() },
    mpesaTransaction: { findMany: jest.fn(), update: jest.fn() },
  };
  return { prisma: { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)), __tx: tx } };
});
jest.mock('../../src/config/africastalking', () => ({ smsClient: { send: jest.fn() } }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/sessionRevocation', () => ({ revokeSessionsFor: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { smsClient } from '../../src/config/africastalking';
import { recordAuditEvent } from '../../src/services/auditService';
import { revokeSessionsFor } from '../../src/services/sessionRevocation';
import {
  deletePatientAccount,
  PatientNotFoundError,
  redactPhoneNumbers,
} from '../../src/services/patientDeletionService';

const tx = (prisma as unknown as { __tx: Record<string, Record<string, jest.Mock>> }).__tx;

const PATIENT = {
  id: 'p-1',
  patientCode: 'ACI-7F2K',
  phoneNumber: '+254712345678',
  firstName: 'Jane',
  lastName: 'Wanjiru',
  deletedAt: null,
};

const DARAJA_CALLBACK = {
  Body: {
    stkCallback: {
      ResultCode: 0,
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 200 },
          { Name: 'MpesaReceiptNumber', Value: 'QAB123XYZ' },
          { Name: 'PhoneNumber', Value: 254712345678 },
        ],
      },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  tx.patient!.findUnique!.mockResolvedValue(PATIENT);
  tx.mpesaTransaction!.findMany!.mockResolvedValue([{ id: 'mt-1', rawCallbackPayload: DARAJA_CALLBACK }]);
});

describe('redactPhoneNumbers', () => {
  it('redacts the Daraja PhoneNumber item but keeps the receipt and amount', () => {
    const out = redactPhoneNumbers(DARAJA_CALLBACK) as typeof DARAJA_CALLBACK;
    expect(out.Body.stkCallback.CallbackMetadata.Item).toEqual([
      { Name: 'Amount', Value: 200 },
      { Name: 'MpesaReceiptNumber', Value: 'QAB123XYZ' },
      { Name: 'PhoneNumber', Value: 'REDACTED' },
    ]);
  });

  it('redacts plain PhoneNumber/MSISDN keys at any depth', () => {
    expect(redactPhoneNumbers({ a: { PhoneNumber: '1', MSISDN: '2', keep: 3 } })).toEqual({
      a: { PhoneNumber: 'REDACTED', MSISDN: 'REDACTED', keep: 3 },
    });
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(DARAJA_CALLBACK));
    redactPhoneNumbers(DARAJA_CALLBACK);
    expect(DARAJA_CALLBACK).toEqual(copy);
  });
});

describe('deletePatientAccount', () => {
  it('wipes every identifying field and frees the phone number', async () => {
    await deletePatientAccount('p-1', { type: 'PATIENT' });

    expect(tx.patient!.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({
        firstName: 'Deleted',
        lastName: 'patient',
        phoneNumber: 'deleted-p-1',
        email: null,
        dateOfBirth: null,
        sex: 'UNKNOWN',
        county: null,
        pinHash: null,
        deletedAt: expect.any(Date),
        deletedByType: 'PATIENT',
      }),
    });
  });

  it('withdraws sharing consent, cancels open appointments and clears OTPs', async () => {
    await deletePatientAccount('p-1', { type: 'PATIENT' });

    expect(tx.consent!.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ patientId: 'p-1', type: 'CROSS_CLINIC_RECORD_SHARING', granted: false }),
    });
    expect(tx.appointment!.updateMany).toHaveBeenCalledWith({
      where: { patientId: 'p-1', status: { in: ['REQUESTED', 'CONFIRMED'] } },
      data: expect.objectContaining({ status: 'CANCELLED', cancelledByType: 'PATIENT' }),
    });
    expect(tx.otp!.deleteMany).toHaveBeenCalledWith({ where: { patientId: 'p-1' } });
  });

  it('redacts phone numbers from M-Pesa records', async () => {
    await deletePatientAccount('p-1', { type: 'PATIENT' });
    const call = tx.mpesaTransaction!.update!.mock.calls[0]![0];
    expect(call.data.phoneNumber).toBe('REDACTED');
    expect(JSON.stringify(call.data.rawCallbackPayload)).not.toContain('254712345678');
    expect(JSON.stringify(call.data.rawCallbackPayload)).toContain('QAB123XYZ');
  });

  it('logs the patient out everywhere, audits, and confirms by SMS to the original number', async () => {
    await deletePatientAccount('p-1', { type: 'OWNER', ownerId: 'owner-1' });

    expect(revokeSessionsFor).toHaveBeenCalledWith('patient:p-1');
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'OWNER', actorId: 'owner-1', action: 'PATIENT_ACCOUNT_DELETED', entityId: 'p-1' }),
    );
    expect(smsClient.send).toHaveBeenCalledWith(expect.objectContaining({ to: ['+254712345678'] }));
  });

  it('still succeeds if the confirmation SMS fails', async () => {
    (smsClient.send as jest.Mock).mockRejectedValueOnce(new Error('AT down'));
    await expect(deletePatientAccount('p-1', { type: 'PATIENT' })).resolves.toBeUndefined();
  });

  it('refuses an already-deleted or missing patient', async () => {
    tx.patient!.findUnique!.mockResolvedValueOnce({ ...PATIENT, deletedAt: new Date() });
    await expect(deletePatientAccount('p-1', { type: 'PATIENT' })).rejects.toBeInstanceOf(PatientNotFoundError);
    tx.patient!.findUnique!.mockResolvedValueOnce(null);
    await expect(deletePatientAccount('p-1', { type: 'PATIENT' })).rejects.toBeInstanceOf(PatientNotFoundError);
    expect(tx.patient!.update).not.toHaveBeenCalled();
  });
});
