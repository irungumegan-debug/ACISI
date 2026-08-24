import dayjs from 'dayjs';

interface VisitHistoryEntry {
  clinicName: string;
  visitedAt: Date;
}

/** Shared by the staff history lookup and the patient's own "My Records" view. */
export function formatVisitHistoryLines(history: VisitHistoryEntry[]): string[] {
  return history.map((h, i) => `${i + 1}. ${h.clinicName} - ${dayjs(h.visitedAt).format('DD MMM YYYY')}`);
}
