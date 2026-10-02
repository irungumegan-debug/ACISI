import { redis } from '../config/redis';
import { DASHBOARD_SESSION_TTL_SECONDS, OWNER_SESSION_TTL_SECONDS } from '../config/constants';

const KEY_PREFIX = 'session:revoked_before:';

/**
 * Who a revocation applies to. A staff session is checked against both its
 * own staff subject and its clinic's, so deactivating a clinic logs out
 * every one of its staff in one write.
 */
export type RevocationSubject =
  | `staff:${string}`
  | `clinic:${string}`
  | `patient:${string}`
  | `owner:${string}`;

/** Long enough to outlive any session issued before the revocation. */
const MARKER_TTL_SECONDS = Math.max(DASHBOARD_SESSION_TTL_SECONDS, OWNER_SESSION_TTL_SECONDS);

/**
 * Invalidates every session for `subject` issued up to now, without having
 * to know their tokens: sessions carry an issuedAt, and any session issued
 * at or before this marker is treated as expired by the session loaders.
 * A login after the marker (e.g. a reactivated staff member) is unaffected.
 */
export async function revokeSessionsFor(subject: RevocationSubject): Promise<void> {
  await redis.set(`${KEY_PREFIX}${subject}`, String(Date.now()), 'EX', MARKER_TTL_SECONDS);
}

/**
 * Whether a session issued at `issuedAt` has been revoked for any of
 * `subjects`. A session with no issuedAt predates this mechanism and is
 * treated as issued at time 0 — i.e. revoked if any marker exists.
 */
export async function isSessionRevoked(subjects: RevocationSubject[], issuedAt: number | undefined): Promise<boolean> {
  for (const subject of subjects) {
    const revokedBefore = await redis.get(`${KEY_PREFIX}${subject}`);
    if (revokedBefore !== null && (issuedAt ?? 0) <= Number(revokedBefore)) {
      return true;
    }
  }
  return false;
}
