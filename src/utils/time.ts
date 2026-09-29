import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/** ACISI is Kenya-only; Kenya observes no DST, so this is a fixed UTC+3 year-round. */
export const NAIROBI_TZ = 'Africa/Nairobi';

/** Start of "today" in Africa/Nairobi, as a plain Date for Prisma/JS Date comparisons — independent of the server's own OS timezone. */
export function startOfNairobiDay(date: Date = new Date()): Date {
  return dayjs(date).tz(NAIROBI_TZ).startOf('day').toDate();
}

/**
 * The last millisecond of the Nairobi calendar day *before* the given
 * moment — used right after a Nairobi-midnight cron fires, when `now` is
 * already the first instant of the new day, to evaluate "what did presence
 * look like during the day that just ended" rather than the day that just
 * started.
 */
export function endOfPreviousNairobiDay(date: Date = new Date()): Date {
  return dayjs(startOfNairobiDay(date)).subtract(1, 'millisecond').toDate();
}
