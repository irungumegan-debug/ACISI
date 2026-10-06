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
  diagnosis: 'Malaria',
  prescription: 'Paracetamol',
  createdAt: new Date('2026-10-05T09:00:00Z'),
  patient: { phoneNumber: '+254712345678', deletedAt: null, smsOptOut: false },
  clinic: { name: 'Sunrise Family Clinic' },
  checkIn: { department: { name: 'Gynecology' } },
};

beforeEach(() => {
  jest.clearAllMocks();
  startVisitSummarySmsWorker();
});

describe('visit summary SMS worker', () => {
  it('sends the summary normally', async () => {
    (prisma.encounter.findUnique as jest.Mock).mockResolvedValue(ENCOUNTER);
    await capturedProcessor!({ data: { encounterId: 'enc-1' } });
    expect(smsClient.send).toHaveBeenCalledWith({
      to: ['+254712345678'],
      message: 'Sunrise Family Clinic\nVisit: 05/10/2026\nMedicines: Paracetamol\nThank you for visiting.',
    });
  });

  it('never includes the diagnosis or the department', async () => {
    (prisma.encounter.findUnique as jest.Mock).mockResolvedValue(ENCOUNTER);
    await capturedProcessor!({ data: { encounterId: 'enc-1' } });
    const { message } = (smsClient.send as jest.Mock).mock.calls[0][0] as { message: string };
    expect(message).not.toContain('Malaria');
    expect(message).not.toContain('Gynecology');
  });

  it('respects "Don’t send SMS"', async () => {
    (prisma.encounter.findUnique as jest.Mock).mockResolvedValue({ ...ENCOUNTER, patient: { ...ENCOUNTER.patient, smsOptOut: true } });
    await capturedProcessor!({ data: { encounterId: 'enc-1' } });
    expect(smsClient.send).not.toHaveBeenCalled();
  });
});
