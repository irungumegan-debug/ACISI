type JobProcessor = (job: { data: { checkInId: string; patientId: string; succeeded: boolean } }) => Promise<void>;

let capturedProcessor: JobProcessor | null = null;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: JobProcessor) => {
    capturedProcessor = processor;
    return { close: jest.fn() };
  }),
}));
jest.mock('../../src/db/prisma', () => ({ prisma: { checkIn: { findUnique: jest.fn() } } }));
jest.mock('../../src/services/smsService', () => ({ sendPatientSms: jest.fn(async () => 'sent') }));

import { prisma } from '../../src/db/prisma';
import { sendPatientSms } from '../../src/services/smsService';
import { startSmsReceiptWorker } from '../../src/jobs/workers/smsReceiptWorker';

const CHECK_IN = {
  id: 'ci-1',
  amountKes: 100,
  patient: { phoneNumber: '+254712345678', deletedAt: null, smsOptOut: true },
  clinic: { name: 'Sunrise Family Clinic' },
};

beforeEach(() => {
  jest.clearAllMocks();
  startSmsReceiptWorker();
});

describe('check-in fee SMS (C13)', () => {
  it('is a non-essential message, so "does not want SMS" applies', async () => {
    (prisma.checkIn.findUnique as jest.Mock).mockResolvedValue(CHECK_IN);
    (sendPatientSms as jest.Mock).mockResolvedValue('opted_out');
    await capturedProcessor!({ data: { checkInId: 'ci-1', patientId: 'p1', succeeded: true } });
    const [patient, , options] = (sendPatientSms as jest.Mock).mock.calls[0];
    expect(patient).toBe(CHECK_IN.patient);
    expect(options.essential).toBeFalsy();
  });

  it('a provider failure makes the job fail so the queue retries it', async () => {
    (prisma.checkIn.findUnique as jest.Mock).mockResolvedValue({ ...CHECK_IN, patient: { ...CHECK_IN.patient, smsOptOut: false } });
    (sendPatientSms as jest.Mock).mockResolvedValue('failed');
    await expect(capturedProcessor!({ data: { checkInId: 'ci-1', patientId: 'p1', succeeded: true } })).rejects.toThrow();
  });
});
