/**
 * Small parsing rules shared by every place staff type in a patient's
 * details (Add patient, walk-in, bulk import).
 */

/** "Jane Wanjiru Mwangi" -> first "Jane", last "Wanjiru Mwangi". A single name is kept as the first name. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Lower-cased, single-spaced full name — for spotting duplicates, never shown. */
export function nameKey(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parses a YYYY-MM-DD date of birth into a UTC midnight Date. Returns null
 * for anything that isn't a real calendar date between 1900 and `now`.
 */
export function parseDateOfBirth(raw: string, now = new Date()): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const dob = new Date(Date.UTC(year, month - 1, day));
  // Round-trip check rejects impossible dates like 2001-02-30.
  const isRealDate = dob.getUTCFullYear() === year && dob.getUTCMonth() === month - 1 && dob.getUTCDate() === day;
  if (!isRealDate || year < 1900 || dob > now) return null;
  return dob;
}

/** A stored date of birth as YYYY-MM-DD (dates are stored at UTC midnight). */
export function formatDateOfBirth(dob: Date): string {
  return dob.toISOString().slice(0, 10);
}
