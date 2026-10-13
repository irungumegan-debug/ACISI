import { maskNumbers, safeError } from '../../src/utils/logger';
import { InvalidPhoneNumberError } from '../../src/utils/phone';

describe('logs never carry phone numbers, PINs or codes', () => {
  it.each(['+254712345678', '0712 345 678', '0712-345-678', '730194', '482193'])('masks %s', (n) => {
    expect(maskNumbers(`value ${n} here`)).toBe('value [number] here');
  });

  it('keeps short numbers like status codes and counts', () => {
    expect(maskNumbers('HTTP 500 after 3 tries')).toBe('HTTP 500 after 3 tries');
  });

  it('masks the number inside an invalid-phone error, in the message and the stack', () => {
    const logged = JSON.stringify(safeError(new InvalidPhoneNumberError('0712345678')));
    expect(logged).not.toContain('0712345678');
    expect(logged).toContain('[number]');
  });

  it('drops database error messages entirely (they can echo the values being saved), keeping the code', () => {
    const err = Object.assign(new Error('Invalid `prisma.patient.create()` invocation:\n{\n  phoneNumber: "+254712345678",\n  diagnosis: "x"\n}'), {
      name: 'PrismaClientValidationError',
      code: 'P2009',
    });
    const logged = safeError(err);
    expect(logged).toMatchObject({ type: 'PrismaClientValidationError', code: 'P2009' });
    expect(JSON.stringify(logged)).not.toMatch(/254712345678|diagnosis/);
  });
});
