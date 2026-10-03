type JobProcessor = (job: { data: { encounterId: string } }) => Promise<void>;

let capturedProcessor: JobProcessor | null = null;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: JobProcessor) => {
    capturedProcessor = processor;
    return { close: jest.fn() };
  }),
}));
jest.mock('../../src/db/prisma', () => ({ prisma: { encounter: { findUnique: jest.fn() } } }));
jest.mock('../../src/config/africastalking', () => ({ smsClient: { send: jest.fn() } }));

import { prisma } from '../../src/db/prisma';
import { smsClient } from '../../src/config/africastalking';
import { startVisitSummarySmsWorker } from '../../src/jobs/workers/visitSummarySmsWorker';

const ENCOUNTER = {
  id: 'enc-1',
  prescription: 'Paracetamol',
  patient: { phoneNumber: '+254712345678', deletedAt: null, smsOptOut: false },
  clinic: { name: 'Sunrise Family Clinic' },
  checkIn: { department: { name: 'General' } },
};

beforeEach(() => {
  jest.clearAllMocks();
  startVisitSummarySmsWorker();
});

describe('visit summary SMS worker', () => {
  it('sends the summary normally', async () => {
    (prisma.encounter.findUnique as jest.Mock).mockResolvedValue(ENCOUNTER);
    await capturedProcessor!({ data: { encounterId: 'enc-1' } });
    expect(smsClient.send).toHaveBeenCalledTimes(1);
  });

  it('respects "Don’t send SMS"', async () => {
    (prisma.encounter.findUnique as jest.Mock).mockResolvedValue({ ...ENCOUNTER, patient: { ...ENCOUNTER.patient, smsOptOut: true } });
    await capturedProcessor!({ data: { encounterId: 'enc-1' } });
    expect(smsClient.send).not.toHaveBeenCalled();
  });
});
