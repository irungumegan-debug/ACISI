import { buildPaymentReceiptSms, buildVisitSummarySms, buildWalkInInviteSms, formatKes, SINGLE_SMS_MAX_CHARS } from '../../src/services/smsTemplates';

describe('buildWalkInInviteSms', () => {
  it('uses the agreed wording and the patient check-in page', () => {
    expect(buildWalkInInviteSms('Sunrise Family Clinic')).toBe(
      'Welcome to Sunrise Family Clinic. Next time, skip the queue: check in from home at acisi.co.ke/patient',
    );
  });

  it('shortens a long clinic name instead of splitting into two SMS', () => {
    const sms = buildWalkInInviteSms('The Very Long Name Of A Community Health Centre And Maternity Wing Serving Nairobi County And Surrounds');
    expect(sms.length).toBeLessThanOrEqual(SINGLE_SMS_MAX_CHARS);
    expect(sms).toMatch(/^Welcome to The Very Long Name.*\.\.\.\. Next time, skip the queue: check in from home at acisi\.co\.ke\/patient$/);
  });

  it('keeps to plain characters so the SMS is not forced into the 70-character mode', () => {
    const sms = buildWalkInInviteSms('St. Mary’s Clinic – Nyeri 🏥');
    expect(sms).toMatch(/^[\x20-\x7E]+$/);
    expect(sms).toContain("St. Mary's Clinic - Nyeri.");
  });
});

describe('formatKes', () => {
  it.each([
    [0, '0'],
    [500, '500'],
    [1500, '1,500'],
    [1234567, '1,234,567'],
  ])('%i -> %s', (n, s) => expect(formatKes(n)).toBe(s));
});

describe('buildPaymentReceiptSms', () => {
  it('names the clinic, date, total, methods and M-Pesa reference', () => {
    expect(
      buildPaymentReceiptSms({
        clinicName: 'Sunrise Family Clinic',
        totalPaidKes: 1500,
        date: '03/10/2026',
        payments: [
          { method: 'MPESA_STK', reference: 'QAB12CD34E' },
          { method: 'CASH', reference: null },
        ],
      }),
    ).toBe('Sunrise Family Clinic: Received KES 1,500 on 03/10/2026 via M-Pesa QAB12CD34E, Cash. Thank you.');
  });

  it('always fits one SMS, even with a long clinic name and many references', () => {
    const message = buildPaymentReceiptSms({
      clinicName: 'St. Bartholomew Community Health and Maternity Centre of Greater Nairobi',
      totalPaidKes: 1234567,
      date: '03/10/2026',
      payments: ['QAB12CD34E', 'QAB12CD34F', 'QAB12CD34G', 'QAB12CD34H'].map((reference) => ({ method: 'MPESA_MANUAL' as const, reference })),
    });
    expect(message.length).toBeLessThanOrEqual(SINGLE_SMS_MAX_CHARS);
    expect(message).toContain('KES 1,234,567');
    expect(message).toContain('M-Pesa');
  });
});

describe('buildVisitSummarySms', () => {
  it('has the clinic name, date and medicines with how to take them', () => {
    expect(
      buildVisitSummarySms({
        clinicName: 'Sunrise Family Clinic',
        date: '05/10/2026',
        prescription: 'Amoxicillin 500mg, 1 capsule 3 times a day for 5 days',
      }),
    ).toBe(
      'Sunrise Family Clinic\nVisit: 05/10/2026\nMedicines: Amoxicillin 500mg, 1 capsule 3 times a day for 5 days\nThank you for visiting.',
    );
  });

  it('says "None" when nothing was prescribed', () => {
    expect(buildVisitSummarySms({ clinicName: 'Sunrise', date: '05/10/2026', prescription: '  ' })).toContain('Medicines: None');
  });

  it('keeps the prescription exactly as written, even if it runs past one SMS', () => {
    const prescription = 'Levothyroxine 50µg once daily before breakfast. '.repeat(4).trim();
    expect(buildVisitSummarySms({ clinicName: 'Sunrise', date: '05/10/2026', prescription })).toContain(prescription);
  });
});
