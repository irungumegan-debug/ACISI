import { redis } from '../config/redis';
import { IDLE_LOGOFF_SECONDS } from '../config/constants';

/**
 * Automatic logoff after inactivity (DHA: automatic logoff). A session stays
 * usable only while its "active" marker exists; the marker lasts
 * IDLE_LOGOFF_SECONDS and is renewed by real use: any change the person
 * makes (non-GET request) or the browser's activity ping, which the console
 * and portal send only when someone actually types, clicks or scrolls.
 * Background reads (the live queue, payment status polls) don't renew it,
 * so a screen left open logs itself off.
 */
export type IdleSessionKind = 'staff' | 'patient';

function key(kind: IdleSessionKind, token: string): string {
  return `idle:${kind}:${token}`;
}

export async function markSessionActive(kind: IdleSessionKind, token: string): Promise<void> {
  await redis.set(key(kind, token), '1', 'EX', IDLE_LOGOFF_SECONDS);
}

export async function isSessionIdle(kind: IdleSessionKind, token: string): Promise<boolean> {
  return (await redis.get(key(kind, token))) === null;
}

export async function clearSessionActivity(kind: IdleSessionKind, token: string): Promise<void> {
  await redis.del(key(kind, token));
}
