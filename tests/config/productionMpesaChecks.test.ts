import { MIN_LIVE_CHECKIN_FEE_KES, parseEnv } from '../../src/config/env';

/** Made-up numbers only: never ACISI's real shortcode or till. */
const LIVE = {
  ...process.env,
  MPESA_ENV: 'production',
  MPESA_SHORTCODE: '7654321',
  MPESA_TILL_NUMBER: '5123456',
  MPESA_CALLBACK_URL: 'https://example.co.ke/api/mpesa/callback',
  CHECKIN_FEE_AMOUNT_KES: '100',
};

const problemsWith = (overrides: Record<string, string | undefined>) => {
  const source: NodeJS.ProcessEnv = { ...LIVE, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete source[k];
  try {
    parseEnv(source);
    return '';
  } catch (err) {
    return (err as Error).message;
  }
};

describe('a live server (MPESA_ENV=production) refuses to start unless M-Pesa is set up for Buy Goods', () => {
  it('starts with a till, a live shortcode, an https callback and a real fee', () => {
    const env = parseEnv(LIVE);
    expect(env).toMatchObject({
      MPESA_ENV: 'production',
      MPESA_TILL_NUMBER: '5123456',
      CHECKIN_FEE_AMOUNT_KES: 100,
    });
  });

  it.each([
    [
      'no till: it can never fall back to Paybill',
      { MPESA_TILL_NUMBER: undefined },
      /MPESA_TILL_NUMBER: required when MPESA_ENV=production/,
    ],
    ['an empty till counts as no till', { MPESA_TILL_NUMBER: ' ' }, /MPESA_TILL_NUMBER: required/],
    [
      'the till typed into MPESA_SHORTCODE as well',
      { MPESA_SHORTCODE: '5123456' },
      /must not be the same as MPESA_SHORTCODE/,
    ],
    ["Safaricom's sandbox shortcode", { MPESA_SHORTCODE: '174379' }, /sandbox test shortcode/],
    [
      'a plain-http callback',
      { MPESA_CALLBACK_URL: 'http://example.co.ke/api/mpesa/callback' },
      /must start with https:\/\//,
    ],
    ['a test fee of KES 1', { CHECKIN_FEE_AMOUNT_KES: '1' }, /CHECKIN_FEE_AMOUNT_KES: must be at least 50/],
  ])('refuses: %s', (_label, overrides, message) => {
    expect(problemsWith(overrides)).toMatch(message);
  });

  it('the fee minimum is KES 50; exactly 50 is allowed', () => {
    expect(MIN_LIVE_CHECKIN_FEE_KES).toBe(50);
    expect(problemsWith({ CHECKIN_FEE_AMOUNT_KES: '50' })).toBe('');
    expect(problemsWith({ CHECKIN_FEE_AMOUNT_KES: '49' })).toMatch(/at least 50/);
  });

  it('lists every problem at once, naming settings but never their values', () => {
    const message = problemsWith({
      MPESA_TILL_NUMBER: undefined,
      MPESA_SHORTCODE: '174379',
      CHECKIN_FEE_AMOUNT_KES: '1',
    });
    expect(message.match(/^ {2}- /gm)).toHaveLength(3);
    expect(message).not.toMatch(/174379|7654321|5123456/);
  });

  it('sandbox is unchanged: no till needed, test fees allowed', () => {
    expect(
      problemsWith({
        MPESA_ENV: 'sandbox',
        MPESA_TILL_NUMBER: undefined,
        MPESA_SHORTCODE: '174379',
        CHECKIN_FEE_AMOUNT_KES: '1',
      }),
    ).toBe('');
  });
});
