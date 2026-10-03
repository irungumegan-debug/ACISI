/**
 * Pure money arithmetic for clinic bills. Every amount is a whole number of
 * KES held in a JS integer — there is no floating-point money anywhere in
 * billing, and every input is checked to be a safe non-negative integer.
 */

/** Upper bound for any single amount, to keep totals well inside safe integers. */
export const MAX_AMOUNT_KES = 10_000_000;

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export function assertKes(amount: number, label: string, { min = 0 }: { min?: number } = {}): void {
  if (!Number.isSafeInteger(amount) || amount < min || amount > MAX_AMOUNT_KES) {
    throw new BillingError(`${label} must be a whole number of KES${min > 0 ? ` of at least ${min}` : ''}`);
  }
}

export interface BillLineInput {
  amountKes: number;
}

/** Subtotal of the lines, minus the discount. A discount needs a reason and can't exceed the subtotal. */
export function computeBillTotals(
  items: BillLineInput[],
  discountKes: number,
  discountReason: string | null | undefined,
): { subtotalKes: number; discountKes: number; totalKes: number } {
  if (items.length === 0) throw new BillingError('Add at least one item to the bill');
  items.forEach((item, i) => assertKes(item.amountKes, `Item ${i + 1} amount`));
  assertKes(discountKes, 'Discount');

  const subtotalKes = items.reduce((sum, item) => sum + item.amountKes, 0);
  assertKes(subtotalKes, 'Bill subtotal');
  if (discountKes > subtotalKes) throw new BillingError('The discount cannot be more than the bill subtotal');
  if (discountKes > 0 && !discountReason?.trim()) throw new BillingError('Give a reason for the discount');

  return { subtotalKes, discountKes, totalKes: subtotalKes - discountKes };
}

export type BillStatusValue = 'UNPAID' | 'PARTLY_PAID' | 'PAID';

/** Unpaid until something is paid; Paid once the total is covered (a KES 0 bill is Paid). */
export function deriveBillStatus(totalKes: number, paidKes: number): BillStatusValue {
  if (paidKes >= totalKes) return 'PAID';
  return paidKes > 0 ? 'PARTLY_PAID' : 'UNPAID';
}

/**
 * Cash: the patient hands over `tenderedKes`; only up to the balance is put
 * towards the bill and the rest is change. E.g. balance 1,300, tendered 2,000
 * -> applied 1,300, change 700.
 */
export function computeCashPayment(balanceKes: number, tenderedKes: number): { appliedKes: number; changeKes: number } {
  assertKes(tenderedKes, 'Amount received', { min: 1 });
  if (balanceKes <= 0) throw new BillingError('This bill is already fully paid', 409);
  const appliedKes = Math.min(balanceKes, tenderedKes);
  return { appliedKes, changeKes: tenderedKes - appliedKes };
}

/** A card or M-Pesa amount must be at least 1 and no more than what's still owed. */
export function assertWithinBalance(amountKes: number, balanceKes: number): void {
  assertKes(amountKes, 'Amount', { min: 1 });
  if (balanceKes <= 0) throw new BillingError('This bill is already fully paid', 409);
  if (amountKes > balanceKes) {
    throw new BillingError(`That's more than the balance of KES ${balanceKes}`);
  }
}

/**
 * M-Pesa transaction codes are 10 letters/digits, e.g. "QAB12CD34E" (always
 * containing both). Returns the normalised (upper-case, no spaces) code, or
 * throws if it doesn't look like one.
 */
export function normaliseMpesaCode(raw: string): string {
  const code = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(code) || !/[A-Z]/.test(code) || !/[0-9]/.test(code)) {
    throw new BillingError('Enter a valid M-Pesa code: 10 letters and numbers, e.g. QAB12CD34E');
  }
  return code;
}
