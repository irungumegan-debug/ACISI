/**
 * Kenya is UTC+3 all year (no daylight saving). The server itself runs on
 * UTC (Railway), so "today" for a Kenyan clinic must be computed here rather
 * than with the server's local midnight, which would start the day at 3am.
 */
const KENYA_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date in Kenya as YYYY-MM-DD. */
export function kenyaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + KENYA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whether `value` is a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** The UTC instants bounding a Kenyan calendar day: [start, end). */
export function kenyaDayRange(isoDate: string): { start: Date; end: Date } {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(y, m - 1, d) - KENYA_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** A date formatted DD/MM/YYYY in Kenyan time, e.g. for receipts. */
export function formatKenyaDate(date: Date): string {
  const k = new Date(date.getTime() + KENYA_OFFSET_MS);
  const dd = String(k.getUTCDate()).padStart(2, '0');
  const mm = String(k.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${k.getUTCFullYear()}`;
}
