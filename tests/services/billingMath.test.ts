import {
  assertWithinBalance,
  BillingError,
  computeBillTotals,
  computeCashPayment,
  deriveBillStatus,
  normaliseMpesaCode,
} from '../../src/services/billingMath';

describe('computeBillTotals', () => {
  it('adds up the lines', () => {
    expect(computeBillTotals([{ amountKes: 500 }, { amountKes: 800 }, { amountKes: 200 }], 0, null)).toEqual({
      subtotalKes: 1500,
      discountKes: 0,
      totalKes: 1500,
    });
  });

  it('takes the discount off the subtotal', () => {
    expect(computeBillTotals([{ amountKes: 500 }, { amountKes: 800 }], 300, 'Staff family')).toEqual({
      subtotalKes: 1300,
      discountKes: 300,
      totalKes: 1000,
    });
  });

  it('allows a full waiver with a reason', () => {
    expect(computeBillTotals([{ amountKes: 500 }], 500, 'Hardship').totalKes).toBe(0);
  });

  it('requires a reason for any discount', () => {
    expect(() => computeBillTotals([{ amountKes: 500 }], 100, null)).toThrow('reason');
    expect(() => computeBillTotals([{ amountKes: 500 }], 100, '   ')).toThrow('reason');
  });

  it('refuses a discount bigger than the subtotal', () => {
    expect(() => computeBillTotals([{ amountKes: 500 }], 501, 'Too much')).toThrow(BillingError);
  });

  it('refuses an empty bill', () => {
    expect(() => computeBillTotals([], 0, null)).toThrow('at least one item');
  });

  it.each([[12.5], [-1], [Number.NaN], [20_000_000]])('refuses a non-whole or out-of-range amount (%p)', (amount) => {
    expect(() => computeBillTotals([{ amountKes: amount }], 0, null)).toThrow(BillingError);
  });
});

describe('deriveBillStatus', () => {
  it.each([
    [1500, 0, 'UNPAID'],
    [1500, 1000, 'PARTLY_PAID'],
    [1500, 1500, 'PAID'],
    [0, 0, 'PAID'],
  ])('total %i, paid %i -> %s', (total, paid, status) => {
    expect(deriveBillStatus(total, paid)).toBe(status);
  });
});

describe('computeCashPayment', () => {
  it('gives change when the patient hands over more than the balance', () => {
    expect(computeCashPayment(1300, 2000)).toEqual({ appliedKes: 1300, changeKes: 700 });
  });

  it('applies exact cash with no change', () => {
    expect(computeCashPayment(1300, 1300)).toEqual({ appliedKes: 1300, changeKes: 0 });
  });

  it('applies part payment when less than the balance is handed over', () => {
    expect(computeCashPayment(1300, 1000)).toEqual({ appliedKes: 1000, changeKes: 0 });
  });

  it('refuses cash on a fully paid bill, and zero or decimal cash', () => {
    expect(() => computeCashPayment(0, 500)).toThrow('already fully paid');
    expect(() => computeCashPayment(1300, 0)).toThrow(BillingError);
    expect(() => computeCashPayment(1300, 99.5)).toThrow(BillingError);
  });
});

describe('assertWithinBalance', () => {
  it('allows up to the balance and no more', () => {
    expect(() => assertWithinBalance(500, 500)).not.toThrow();
    expect(() => assertWithinBalance(501, 500)).toThrow('more than the balance');
    expect(() => assertWithinBalance(0, 500)).toThrow(BillingError);
  });
});

describe('normaliseMpesaCode', () => {
  it('upper-cases and strips spaces', () => {
    expect(normaliseMpesaCode(' qab12 cd34e ')).toBe('QAB12CD34E');
  });

  it.each(['QAB12CD34', 'QAB12CD34EX', 'ABCDEFGHIJ', '1234567890', 'QAB12-CD34'])('rejects %s', (code) => {
    expect(() => normaliseMpesaCode(code)).toThrow('valid M-Pesa code');
  });
});
