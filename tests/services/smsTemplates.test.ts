import { buildWalkInInviteSms, SINGLE_SMS_MAX_CHARS } from '../../src/services/smsTemplates';

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
