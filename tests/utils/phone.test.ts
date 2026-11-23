import { InvalidPhoneNumberError, isSafaricomNumber, maskPhoneForLog, toDarajaFormat, toE164 } from '../../src/utils/phone';

describe('toE164', () => {
  it('normalizes a local 07 number', () => {
    expect(toE164('0712345678')).toBe('+254712345678');
  });

  it('normalizes a local 01 number', () => {
    expect(toE164('0112345678')).toBe('+254112345678');
  });

  it('normalizes an already-international number with plus', () => {
    expect(toE164('+254712345678')).toBe('+254712345678');
  });

  it('normalizes an international number without plus', () => {
    expect(toE164('254712345678')).toBe('+254712345678');
  });

  it('rejects an invalid number', () => {
    expect(() => toE164('12345')).toThrow(InvalidPhoneNumberError);
  });
});

describe('toDarajaFormat', () => {
  it('strips the leading plus', () => {
    expect(toDarajaFormat('+254712345678')).toBe('254712345678');
  });
});

describe('isSafaricomNumber', () => {
  it.each(['0712345678', '+254722000000', '254740123456', '0745123456', '0748123456', '0757123456', '0768123456', '0799123456', '0110123456', '0115123456'])(
    '%s is Safaricom',
    (n) => expect(isSafaricomNumber(n)).toBe(true),
  );

  it.each(['0733123456', '0750123456', '0744123456', '0747123456', '0762123456', '0772123456', '0785123456', '0100123456', '0116123456', 'not a number'])(
    '%s is not Safaricom',
    (n) => expect(isSafaricomNumber(n)).toBe(false),
  );
});

describe('maskPhoneForLog', () => {
  it('keeps only the country code and the last two digits', () => {
    expect(maskPhoneForLog('+254712345678')).toBe('2547******78');
  });
});
