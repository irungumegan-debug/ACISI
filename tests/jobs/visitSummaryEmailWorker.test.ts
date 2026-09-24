type JobProcessor = (job: { data: { encounterId: string } }) => Promise<void>;

let capturedProcessor: JobProcessor | null = null;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: JobProcessor) => {
    capturedProcessor = processor;
    return { close: jest.fn() };
  }),
}));

jest.mock('../../src/db/prisma', () => ({
  prisma: { encounter: { findUnique: jest.fn() } },
}));

let mockEmailConfigured = true;
let mockEmailClient: { emails: { send: jest.Mock } } | null = { emails: { send: jest.fn() } };
jest.mock('../../src/config/email', () => ({
  get emailConfigured() {
    return mockEmailConfigured;
  },
  get emailClient() {
    return mockEmailClient;
  },
  emailFromHeader: 'ACISI <noreply@example.com>',
}));

jest.mock('../../src/services/visitRecordDocument', () => ({
  buildVisitRecordDataFromEncounter: jest.fn().mockReturnValue({ patientName: 'Jane Wanjiru' }),
  renderVisitRecordPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
}));

import { prisma } from '../../src/db/prisma';
import { startVisitSummaryEmailWorker } from '../../src/jobs/workers/visitSummaryEmailWorker';

const mockFindUnique = prisma.encounter.findUnique as jest.Mock;

const SIGNED_ENCOUNTER = {
  id: 'enc-1',
  createdAt: new Date('2026-01-15'),
  diagnosis: 'Flu',
  prescription: 'Paracetamol',
  consultedAt: new Date('2026-01-15'),
  patient: { firstName: 'Jane', lastName: 'Wanjiru', patientCode: 'ACI-1042', email: 'jane@example.com' },
  clinic: { name: 'Sunrise Family Clinic', county: 'Nairobi' },
  checkIn: { department: { name: 'General' } },
  consultedByStaff: { name: 'Dr. Amani Wambui', role: 'DOCTOR' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmailConfigured = true;
  mockEmailClient = { emails: { send: jest.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }) } };
  capturedProcessor = null;
  startVisitSummaryEmailWorker();
});

describe('visitSummaryEmailWorker', () => {
  it('skips entirely when email delivery is not configured, without ever querying the database', async () => {
    mockEmailConfigured = false;
    mockEmailClient = null;

    await capturedProcessor!({ data: { encounterId: 'enc-1' } });

    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('skips when the encounter no longer exists', async () => {
    mockFindUnique.mockResolvedValue(null);

    await capturedProcessor!({ data: { encounterId: 'enc-1' } });

    expect(mockEmailClient!.emails.send).not.toHaveBeenCalled();
  });

  it('skips sending when the patient has no email on file (defensive re-check)', async () => {
    mockFindUnique.mockResolvedValue({ ...SIGNED_ENCOUNTER, patient: { ...SIGNED_ENCOUNTER.patient, email: null } });

    await capturedProcessor!({ data: { encounterId: 'enc-1' } });

    expect(mockEmailClient!.emails.send).not.toHaveBeenCalled();
  });

  it("sends the PDF as an attachment to the patient's email", async () => {
    mockFindUnique.mockResolvedValue(SIGNED_ENCOUNTER);

    await capturedProcessor!({ data: { encounterId: 'enc-1' } });

    expect(mockEmailClient!.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'ACISI <noreply@example.com>',
        to: ['jane@example.com'],
        subject: expect.stringContaining('Sunrise Family Clinic'),
        attachments: [expect.objectContaining({ filename: expect.stringContaining('.pdf'), content: expect.any(Buffer) })],
      }),
    );
  });

  it('throws (so BullMQ retries) when Resend reports an error', async () => {
    mockFindUnique.mockResolvedValue(SIGNED_ENCOUNTER);
    mockEmailClient!.emails.send.mockResolvedValue({ data: null, error: { message: 'Domain not verified', name: 'validation_error' } });

    await expect(capturedProcessor!({ data: { encounterId: 'enc-1' } })).rejects.toThrow('Domain not verified');
  });
});
