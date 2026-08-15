import { InvalidPhoneNumberError, toDarajaFormat, toE164 } from '../../src/utils/phone';

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
