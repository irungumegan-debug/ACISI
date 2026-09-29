import { EventEmitter } from 'node:events';

export interface CheckInPaidEvent {
  checkInId: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  amountKes: number;
  paidAt: string;
}

/**
 * In-process pub/sub for "a check-in just got paid," scoped by clinicId.
 * Fine for a single server instance (our current deploy target). If this
 * ever runs on more than one instance, this needs to move to Redis pub/sub
 * so events reach dashboard clients connected to a different instance —
 * not needed yet, so not built yet.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function channel(clinicId: string): string {
  return `checkin-paid:${clinicId}`;
}

export function publishCheckInPaid(event: CheckInPaidEvent): void {
  emitter.emit(channel(event.clinicId), event);
}

export interface CheckInFailedEvent {
  checkInId: string;
  clinicId: string;
}

/**
 * Same live-queue channel as publishCheckInPaid, fired instead when a
 * check-in's M-Pesa STK push fails (never even started, or resolved
 * unsuccessfully) rather than succeeds. The dashboard's subscription
 * doesn't distinguish payload shape — any event on this channel just means
 * "refetch the queue" — so without this, a check-in that fails while a
 * staff member already has the queue open would never appear until they
 * manually reload the page, even though the row is created and visible on
 * a fresh load the whole time.
 */
export function publishCheckInFailed(event: CheckInFailedEvent): void {
  emitter.emit(channel(event.clinicId), event);
}

export function subscribeCheckInPaid(clinicId: string, listener: (event: CheckInPaidEvent) => void): () => void {
  emitter.on(channel(clinicId), listener);
  return () => emitter.off(channel(clinicId), listener);
}

export interface PresenceChangedEvent {
  clinicId: string;
  staffId: string;
  presence: 'IN' | 'OUT' | 'NOT_IN_YET';
}

/** Separate channel from checkin-paid, but delivered down the same SSE stream (src/dashboard/events.ts) — the dashboard's existing "any message means refetch" pattern doesn't care which channel fired. */
function presenceChannel(clinicId: string): string {
  return `presence-changed:${clinicId}`;
}

export function publishPresenceChanged(event: PresenceChangedEvent): void {
  emitter.emit(presenceChannel(event.clinicId), event);
}

export function subscribePresenceChanged(clinicId: string, listener: (event: PresenceChangedEvent) => void): () => void {
  emitter.on(presenceChannel(clinicId), listener);
  return () => emitter.off(presenceChannel(clinicId), listener);
}
