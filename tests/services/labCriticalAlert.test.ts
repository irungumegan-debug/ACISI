/** Decision support for lab results: a critical result alerts the requesting doctor, without patient details. */
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/smsService', () => ({ sendSms: jest.fn(async () => 'sent') }));
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    labOrder: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'lo-1',
        clinicId: 'c1',
        encounterId: 'enc-1',
        clinic: { name: 'Sunrise Clinic' },
        requestedByStaff: { id: 'doc-1', phoneNumber: '+254700000001', isActive: true },
      })),
    },
  },
}));

import { sendSms } from '../../src/services/smsService';
import { recordAuditEvent } from '../../src/services/auditService';
import { alertDoctorOfCriticalResult } from '../../src/services/labService';

it('texts the requesting doctor (no name, test or result) and logs it', async () => {
  await alertDoctorOfCriticalResult('lo-1', 2);
  const [to, text, purpose, clinicId] = (sendSms as jest.Mock).mock.calls[0];
  expect(to).toBe('+254700000001');
  expect(text).toMatch(/CRITICAL lab result is ready for one of your patients at Sunrise Clinic/);
  expect(purpose).toBe('LAB_CRITICAL_RESULT_ALERT');
  expect(clinicId).toBe('c1');
  expect((recordAuditEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ action: 'LAB_CRITICAL_RESULT_ALERT', metadata: { criticalCount: 2, doctorSmsSent: true } });
});

it('never throws, even if the SMS service fails', async () => {
  (sendSms as jest.Mock).mockRejectedValueOnce(new Error('down'));
  await expect(alertDoctorOfCriticalResult('lo-1', 1)).resolves.toBeUndefined();
});
