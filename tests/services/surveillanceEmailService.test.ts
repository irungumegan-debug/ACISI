/** Emailed reports to the Sub-County surveillance coordinator: weekly once on Mondays, immediate notices, never patient details. */
const send = jest.fn(async () => ({ error: null }));
jest.mock('../../src/config/email', () => ({ emailClient: { emails: { send } }, emailConfigured: true, emailFromHeader: 'ACISI <a@acisi.co.ke>' }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn(async () => undefined) }));
jest.mock('../../src/services/notifiableDiseaseService', () => ({
  lastFullWeekStart: jest.fn(() => '2026-11-09'),
  weeklySummary: jest.fn(async () => ({ weekStart: '2026-11-09', weekEnd: '2026-11-15' })),
  weeklySummaryCsv: jest.fn(() => 'Disease,Under 5,5 and over\nCholera,0,1\n'),
}));
const clinics = [{ id: 'c1', name: 'Sunrise Clinic', county: 'Nairobi', surveillanceEmail: 'scdsc@example.org', surveillanceWeeklySentFor: null as string | null }];
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    clinic: {
      findUnique: jest.fn(async () => clinics[0]),
      findMany: jest.fn(async () => clinics.filter((c) => c.surveillanceWeeklySentFor !== '2026-11-09')),
      update: jest.fn(async ({ data }) => Object.assign(clinics[0]!, data)),
    },
  },
}));

import { emailImmediateNotice, isMondayMorningOrLater, sendWeeklySurveillanceEmails, validSurveillanceEmail } from '../../src/services/surveillanceEmailService';

beforeEach(() => {
  send.mockClear();
  clinics[0]!.surveillanceWeeklySentFor = null;
});

const mondayNineKenya = new Date('2026-11-16T06:00:00Z');

it('weekly: Monday from 08:00 Kenya time, CSV attached, once per week', async () => {
  expect(isMondayMorningOrLater(new Date('2026-11-16T04:30:00Z'))).toBe(false); // 07:30 Kenya
  expect(await sendWeeklySurveillanceEmails(new Date('2026-11-17T06:00:00Z'))).toEqual({ sent: 0, failed: 0 }); // Tuesday
  expect(await sendWeeklySurveillanceEmails(mondayNineKenya)).toEqual({ sent: 1, failed: 0 });
  const mail = (send.mock.calls[0] as unknown[])[0] as { to: string[]; subject: string; attachments: { filename: string; content: Buffer }[] };
  expect(mail.to).toEqual(['scdsc@example.org']);
  expect(mail.subject).toMatch(/MOH 505.*Sunrise Clinic.*2026-11-09/);
  expect(mail.attachments[0]!.content.toString()).toContain('Cholera,0,1');
  expect(await sendWeeklySurveillanceEmails(mondayNineKenya)).toEqual({ sent: 0, failed: 0 });
});

it('immediate: disease names and the clinic, an IHR note, no patient details', async () => {
  await emailImmediateNotice({ clinicId: 'c1', kind: 'case', items: [{ name: 'Cholera', ihr: 'ASSESS' }], at: mondayNineKenya, entityType: 'Encounter', entityId: 'enc-1' });
  const mail = (send.mock.calls[0] as unknown[])[0] as { subject: string; text: string };
  expect(mail.subject).toBe('IMMEDIATE: Cholera at Sunrise Clinic');
  expect(mail.text).toMatch(/Cholera \(IHR disease/);
  expect(mail.text).toMatch(/Patient details are not included/);
});

it('validates the address', () => {
  expect(validSurveillanceEmail('scdsc@health.go.ke')).toBe(true);
  expect(validSurveillanceEmail('not an email')).toBe(false);
});
