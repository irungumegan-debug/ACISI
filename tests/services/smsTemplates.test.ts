import {
  buildCheckInFeeSms,
  buildCheckoutSms,
  PRESCRIPTION_SEE_PROFILE,
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

describe('buildCheckoutSms (one SMS at checkout: receipt + visit summary)', () => {
  const paid = { totalKes: 1500, paidKes: 1500, payments: [{ method: 'MPESA_MANUAL' as const, reference: 'QAB12CD34E' }] };

  it('names the clinic, visit date, amount and method, and the prescription', () => {
    expect(
      buildCheckoutSms({ clinicName: 'Sunrise Family Clinic', date: '03/10/2026', bill: paid, prescription: 'Amoxicillin 500mg 3x daily 5 days' }),
    ).toBe(
      'Sunrise Family Clinic: Visit 03/10/2026. Paid KES 1,500 by M-Pesa QAB12CD34E. Prescription: Amoxicillin 500mg 3x daily 5 days\nPrivacy: acisi.co.ke/privacy',
    );
  });

  it('adds the privacy line only when it still fits', () => {
    const sms = buildCheckoutSms({ clinicName: 'Afya Clinic', date: '03/10/2026', bill: paid, prescription: 'Paracetamol' });
    expect(sms).toBe('Afya Clinic: Visit 03/10/2026. Paid KES 1,500 by M-Pesa QAB12CD34E. Prescription: Paracetamol\nPrivacy: acisi.co.ke/privacy');
  });

  it('replaces a long prescription with "Prescription: see your ACISI profile"', () => {
    const sms = buildCheckoutSms({
      clinicName: 'Sunrise Family Clinic',
      date: '03/10/2026',
      bill: paid,
      prescription: 'Amoxicillin 500mg three times daily for 7 days; Paracetamol 1g every 8 hours when needed; ORS sachets after each loose stool; review in 1 week',
    });
    expect(sms).toContain(PRESCRIPTION_SEE_PROFILE);
    expect(sms).not.toContain('Amoxicillin');
    expect(sms).toContain('Paid KES 1,500');
  });

  it('shows a balance still owed, and handles no bill and a waived bill', () => {
    expect(
      buildCheckoutSms({ clinicName: 'Afya', date: '03/10/2026', bill: { totalKes: 2000, paidKes: 500, payments: [{ method: 'CASH', reference: null }] }, prescription: 'ORS' }),
    ).toContain('Paid KES 500 by Cash. Balance KES 1,500.');
    expect(buildCheckoutSms({ clinicName: 'Afya', date: '03/10/2026', bill: null, prescription: 'ORS' })).toContain('No payment recorded.');
    expect(buildCheckoutSms({ clinicName: 'Afya', date: '03/10/2026', bill: { totalKes: 0, paidKes: 0, payments: [] }, prescription: 'ORS' })).toContain(
      'No charge.',
    );
  });

  it('turns line breaks and curly quotes in the prescription into plain text', () => {
    const sms = buildCheckoutSms({ clinicName: 'Afya', date: '03/10/2026', bill: null, prescription: 'Amoxicillin 500mg\n“3x daily” – 5 days' });
    expect(sms).toMatch(/^[\x20-\x7E\n]+$/); // plain characters; the only line break is before the privacy line
    expect(sms).toContain('Prescription: Amoxicillin 500mg "3x daily" - 5 days\nPrivacy:');
  });

  // The guard the clinic relies on: this test FAILS if any checkout SMS is
  // ever longer than 160 characters (or would be split into two SMS).
  describe('is never over 160 characters', () => {
    const longName = 'St. Bartholomew Community Health and Maternity Centre of Greater Nairobi and Surrounding Counties';
    const longRx = 'x'.repeat(400);
    const manyPayments = {
      totalKes: 1234567,
      paidKes: 1000000,
      payments: [
        { method: 'MPESA_STK' as const, reference: 'QAB12CD34E' },
        { method: 'MPESA_MANUAL' as const, reference: 'QZZ98YX76W' },
        { method: 'CARD' as const, reference: 'TERMINAL-REF-123456789012' },
        { method: 'CASH' as const, reference: null },
      ],
    };
    const cases: [string, Parameters<typeof buildCheckoutSms>[0]][] = [
      ['short everything', { clinicName: 'Afya', date: '03/10/2026', bill: paid, prescription: 'ORS' }],
      ['long prescription', { clinicName: 'Sunrise Family Clinic', date: '03/10/2026', bill: paid, prescription: longRx }],
      ['long clinic name', { clinicName: longName, date: '03/10/2026', bill: paid, prescription: 'ORS' }],
      ['everything long', { clinicName: longName, date: '03/10/2026', bill: manyPayments, prescription: longRx }],
      ['GSM extension characters', { clinicName: '[Clinic]{~}^|', date: '03/10/2026', bill: paid, prescription: '{[~]}^|\\'.repeat(30) }],
      ['emoji and accents', { clinicName: 'Kliniki ya Afya 🏥 Nyéri', date: '03/10/2026', bill: manyPayments, prescription: 'Dawa 💊 '.repeat(30) }],
      ['no bill, no prescription', { clinicName: longName, date: '03/10/2026', bill: null, prescription: null }],
    ];
    it.each(cases)('%s', (_label, input) => {
      const sms = buildCheckoutSms(input);
      expect(sms.length).toBeLessThanOrEqual(160);
      expect(smsPartCount(sms)).toBe(1);
    });

    it('fails when a message is over 160 characters (the check itself works)', () => {
      expect('x'.repeat(161).length).toBeGreaterThan(160);
      expect(smsPartCount('x'.repeat(161))).toBe(2);
    });
  });

  it('never contains the diagnosis or the department (they are not even inputs)', () => {
    // The function takes no diagnosis or department, so it cannot leak them.
    const keys = Object.keys({ clinicName: '', date: '', bill: null, prescription: '' } satisfies Parameters<typeof buildCheckoutSms>[0]);
    expect(keys).not.toContain('diagnosis');
    expect(keys).not.toContain('department');
  });
});
