/** Placeholder written over every M-Pesa phone number tied to a deleted patient. */
export const REDACTED = 'REDACTED';

/**
 * Daraja callbacks carry the payer's phone number as a CallbackMetadata item
 * ({ Name: 'PhoneNumber', Value: 2547... }); other shapes may use a plain
 * PhoneNumber/MSISDN key. Returns a copy with every one of those replaced,
 * leaving the receipt number, amount and result codes intact for
 * reconciliation.
 */
export function redactPhoneNumbers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPhoneNumbers);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    out[k] = /^(phonenumber|msisdn)$/i.test(k) ? REDACTED : redactPhoneNumbers(v);
  }
  if (source.Name === 'PhoneNumber' && 'Value' in source) {
    out.Value = REDACTED;
  }
  return out;
}
