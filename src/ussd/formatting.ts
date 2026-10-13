import dayjs from 'dayjs';

interface VisitHistoryEntry {
  clinicName: string;
  visitedAt: Date;
}

/** Shared by the staff history lookup and the patient's own "My Records" view. */
export function formatVisitHistoryLines(history: VisitHistoryEntry[]): string[] {
  return history.map((h, i) => `${i + 1}. ${h.clinicName} - ${dayjs(h.visitedAt).format('DD MMM YYYY')}`);
}

/** USSD screens are short: at most this many people are listed for a shared phone. */
export const MAX_PEOPLE_IN_MENU = 8;

/** "Who is checking in?\n1. Jane W.\n2. Brian K.\n0. Someone new" */
export function buildPersonMenu(title: string, names: string[], extraLine?: string): string {
  return [title, ...names.map((n, i) => `${i + 1}. ${n}`), ...(extraLine ? [extraLine] : [])].join('\n');
}
