import { base32Decode, base32Encode, generateTotpSecret, matchTotp, otpauthUrl, totpCodeForStep, totpStep } from '../../src/utils/totp';

// RFC 6238 appendix B test secret (SHA-1): ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

it('matches the RFC 6238 test vectors (last 6 digits)', () => {
  expect(totpCodeForStep(RFC_SECRET, totpStep(59_000))).toBe('287082');
  expect(totpCodeForStep(RFC_SECRET, totpStep(1_111_111_109_000))).toBe('081804');
  expect(totpCodeForStep(RFC_SECRET, totpStep(1_234_567_890_000))).toBe('005924');
  expect(totpCodeForStep(RFC_SECRET, totpStep(2_000_000_000_000))).toBe('279037');
});

it('base32 round-trips and secrets are 160-bit', () => {
  const secret = generateTotpSecret();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  expect(base32Decode(secret)).toHaveLength(20);
  expect(base32Decode(base32Encode(Buffer.from('hello')))).toEqual(Buffer.from('hello'));
});

it('accepts one step either side for clock drift, nothing further', () => {
  const now = 1_700_000_000_000;
  const step = totpStep(now);
  expect(matchTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step), now)).toBe(step);
  expect(matchTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step - 1), now)).toBe(step - 1);
  expect(matchTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step + 1), now)).toBe(step + 1);
  expect(matchTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step - 3), now)).toBeNull();
  expect(matchTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
});

it('builds the otpauth link apps read', () => {
  expect(otpauthUrl('ABC', 'ACI-STF-DOC1')).toBe('otpauth://totp/ACISI%3AACI-STF-DOC1?secret=ABC&issuer=ACISI&algorithm=SHA1&digits=6&period=30');
});
