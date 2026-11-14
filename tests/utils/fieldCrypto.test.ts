import { decryptResult, decryptValue, encryptValue, encryptWritePayload, isEncrypted } from '../../src/utils/fieldCrypto';

describe('field encryption at rest (AES-256-GCM)', () => {
  it('encrypts to an unreadable value and back', () => {
    const stored = encryptValue('Malaria (P. falciparum)');
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain('Malaria');
    expect(decryptValue(stored)).toBe('Malaria (P. falciparum)');
  });

  it('uses a fresh IV each time, so equal values look different', () => {
    expect(encryptValue('same')).not.toBe(encryptValue('same'));
  });

  it('refuses a value that was changed in the database', () => {
    const stored = encryptValue('Hb 9.1 g/dL');
    const raw = Buffer.from(stored.slice(7), 'base64');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => decryptValue('enc:v1:' + raw.toString('base64'))).toThrow();
  });

  it('reads older plaintext as it is, and never double-encrypts', () => {
    expect(decryptValue('plain diagnosis')).toBe('plain diagnosis');
    const once = encryptValue('x');
    expect(encryptValue(once)).toBe(once);
  });

  it('encrypts only health data and ID fields, at any depth of a write', () => {
    const data = encryptWritePayload({
      status: 'READY_FOR_CHECKOUT',
      diagnosis: 'Malaria',
      prescription: { set: 'AL 80/480' },
      patient: { update: { idNumber: '12345678', firstName: 'Jane' } },
      items: { create: [{ resultValue: 'Positive', testName: 'Malaria RDT' }] },
    }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(data.status).toBe('READY_FOR_CHECKOUT');
    expect(isEncrypted(data.diagnosis)).toBe(true);
    expect(isEncrypted(data.prescription.set)).toBe(true);
    expect(isEncrypted(data.patient.update.idNumber)).toBe(true);
    expect(data.patient.update.firstName).toBe('Jane');
    expect(isEncrypted(data.items.create[0].resultValue)).toBe(true);
    expect(data.items.create[0].testName).toBe('Malaria RDT');
    expect(decryptResult(data).diagnosis).toBe('Malaria');
  });

  it('decrypts results anywhere, including nested includes, and leaves dates alone', () => {
    const when = new Date('2026-11-14T00:00:00Z');
    const row = decryptResult({ id: 'e1', createdAt: when, diagnosis: encryptValue('Typhoid'), labOrders: [{ items: [{ resultComment: encryptValue('Widal positive') }] }] });
    expect(row.diagnosis).toBe('Typhoid');
    expect(row.labOrders[0]!.items[0]!.resultComment).toBe('Widal positive');
    expect(row.createdAt).toBe(when);
  });
});

describe('money amounts and other objects pass through untouched (regression: check-ins failed)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Prisma } = require('@prisma/client') as typeof import('@prisma/client');

  it('keeps a Prisma.Decimal a Decimal in a write, at any depth', () => {
    const amount = new Prisma.Decimal(100);
    const data = encryptWritePayload({ amountKes: amount, nested: { create: { amountKes: amount, diagnosis: 'x' } } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(data.amountKes).toBe(amount);
    expect(data.amountKes instanceof Prisma.Decimal).toBe(true);
    expect(data.nested.create.amountKes).toBe(amount);
    expect(isEncrypted(data.nested.create.diagnosis)).toBe(true);
  });

  it('keeps a Decimal in a result untouched', () => {
    const amount = new Prisma.Decimal('250.50');
    const row = decryptResult({ amountKes: amount, diagnosis: encryptValue('Flu') });
    expect(row.amountKes).toBe(amount);
    expect(row.amountKes.toString()).toBe('250.5');
    expect(row.diagnosis).toBe('Flu');
  });
});
