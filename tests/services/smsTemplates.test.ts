import {
  buildCheckInFeeSms,
  appendIfNoExtraPart,
  buildPaymentReceiptSms,
  buildWalkInInviteSms,
  formatKes,
  PRIVACY_NOTICE_SMS_LINE,
  SINGLE_SMS_MAX_CHARS,
  smsPartCount,
} from '../../src/services/smsTemplates';

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
    ).toBe('Sunrise Family Clinic: Received KES 1,500 on 03/10/2026 via M-Pesa QAB12CD34E, Cash. Thank you. Privacy: acisi.co.ke/privacy');
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

describe('smsPartCount', () => {
  it('counts GSM-7 messages: 160 in one SMS, 153 per part after that', () => {
    expect(smsPartCount('a'.repeat(160))).toBe(1);
    expect(smsPartCount('a'.repeat(161))).toBe(2);
    expect(smsPartCount('a'.repeat(306))).toBe(2);
    expect(smsPartCount('a'.repeat(307))).toBe(3);
  });

  it('counts GSM-7 extension characters as two', () => {
    expect(smsPartCount('a'.repeat(159) + '[')).toBe(2);
    expect(smsPartCount('a'.repeat(158) + '€')).toBe(1);
  });

  it('switches to UCS-2 for any character outside GSM-7: 70 in one SMS, 67 per part', () => {
    expect(smsPartCount('µ' + 'a'.repeat(69))).toBe(1);
    expect(smsPartCount('µ' + 'a'.repeat(70))).toBe(2);
    expect(smsPartCount('µ' + 'a'.repeat(133))).toBe(2);
    expect(smsPartCount('µ' + 'a'.repeat(134))).toBe(3);
  });
});

describe('privacy line on receipts and visit summaries', () => {
  it('is only added when the part count stays the same', () => {
    expect(appendIfNoExtraPart('a'.repeat(131), ' ', PRIVACY_NOTICE_SMS_LINE)).toHaveLength(160);
    expect(appendIfNoExtraPart('a'.repeat(132), ' ', PRIVACY_NOTICE_SMS_LINE)).toBe('a'.repeat(132));
  });

  it('is left off a receipt that is already near one SMS, without shortening anything else', () => {
    const input = {
      clinicName: 'St. Mary Mother of Mercy Community Health Centre and Maternity Wing',
      totalPaidKes: 12500,
      date: '03/10/2026',
      payments: [{ method: 'MPESA_STK' as const, reference: 'QAB12CD34E' }],
    };
    const sms = buildPaymentReceiptSms(input);
    expect(sms).not.toContain('Privacy');
    expect(sms).toBe(
      'St. Mary Mother of Mercy Community Health Centre and Maternity Wing: Received KES 12,500 on 03/10/2026 via M-Pesa QAB12CD34E. Thank you.',
    );
    expect(sms.length).toBeLessThanOrEqual(SINGLE_SMS_MAX_CHARS);
  });

  it('every receipt stays one SMS with or without it', () => {
    for (const clinicName of ['A', 'Sunrise Family Clinic', 'x'.repeat(90)]) {
      const sms = buildPaymentReceiptSms({ clinicName, totalPaidKes: 1500, date: '03/10/2026', payments: [{ method: 'CASH', reference: null }] });
      expect(smsPartCount(sms)).toBe(1);
    }
  });

});

describe('buildCheckInFeeSms (shortened 2026-10-30)', () => {
  it('paid: clinic and payment confirmed, two lines, one SMS', () => {
    expect(buildCheckInFeeSms({ clinicName: 'Sunrise Family Clinic', amountKes: 100, paid: true })).toBe(
      'ACISI: Check-in confirmed at Sunrise Family Clinic.\nPayment confirmed: KES 100.',
    );
  });

  it('not paid: short, points to the profile, one SMS', () => {
    expect(buildCheckInFeeSms({ clinicName: 'Sunrise Family Clinic', amountKes: 100, paid: false })).toBe(
      'ACISI: Check-in at Sunrise Family Clinic: payment not received.\nPay from your ACISI profile.',
    );
  });

  it('never runs past one SMS, however long the clinic name', () => {
    for (const paid of [true, false]) {
      const sms = buildCheckInFeeSms({ clinicName: 'Very Long Clinic Name '.repeat(10), amountKes: 1200, paid });
      expect(smsPartCount(sms)).toBe(1);
      expect(sms.split('\n')).toHaveLength(2);
    }
  });
});
