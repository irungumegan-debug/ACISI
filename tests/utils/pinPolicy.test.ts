import { looksLikeDate, pinPolicyError } from '../../src/utils/pinPolicy';
import { generateTemporaryPin } from '../../src/utils/idCodes';

describe('pinPolicyError', () => {
  it.each(['730194', '258036', '135790', '904172'])('accepts a strong 6-digit PIN (%s)', (pin) => {
    expect(pinPolicyError(pin)).toBeNull();
  });

  it.each(['1234', '12345', '1234567', '12a456', '', ' 730194'])('requires exactly 6 digits (%j)', (pin) => {
    expect(pinPolicyError(pin)).toBe('Your PIN must be exactly 6 digits.');
  });

  it.each(['000000', '111111', '121212', '123123', '909090'])('refuses repeated patterns (%s)', (pin) => {
    expect(pinPolicyError(pin)).toMatch(/repeated or sequential/);
  });

  it.each(['123456', '234567', '654321', '987654', '890123', '210987'])('refuses sequences (%s)', (pin) => {
    expect(pinPolicyError(pin)).toMatch(/repeated or sequential/);
  });

  // 15 March 1990 written every common way, plus a leap day
  it.each(['150390', '031590', '900315', '031990', '199003', '290200'])('refuses dates like birthdays (%s)', (pin) => {
    expect(pinPolicyError(pin)).toMatch(/looks like a date/);
  });

  it("refuses the last six digits of the account's phone number", () => {
    expect(pinPolicyError('904172', { phoneNumber: '+254712904172' })).toMatch(/phone number/);
    expect(pinPolicyError('904172', { phoneNumber: '+254712000111' })).toBeNull();
  });
});

describe('looksLikeDate', () => {
  it('does not flag impossible dates', () => {
    expect(looksLikeDate('730194')).toBe(false); // no 73rd day/month, no year 7301
    expect(looksLikeDate('310490')).toBe(false); // 31 April doesn't exist
    expect(looksLikeDate('300290')).toBe(false); // nor 30 February
  });
});

describe('generateTemporaryPin', () => {
  it('only ever produces PINs that pass the rules', () => {
    for (let i = 0; i < 500; i++) {
      expect(pinPolicyError(generateTemporaryPin())).toBeNull();
    }
  });
});
