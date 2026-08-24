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

export function subscribeCheckInPaid(clinicId: string, listener: (event: CheckInPaidEvent) => void): () => void {
  emitter.on(channel(clinicId), listener);
  return () => emitter.off(channel(clinicId), listener);
}
