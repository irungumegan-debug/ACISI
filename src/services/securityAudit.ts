import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { recordAuditEvent } from './auditService';
import type { LockoutSubject } from './pinLockout';

/**
 * Security events for the audit log (DHA Audit Trail Specification):
 * logout, sessions ended by the server (inactivity, revoked), account
 * lockout and access denied. IDs and reasons only, never names, phone
 * numbers or emails. A failure to write one of these is logged and never
 * breaks the request it belongs to.
 */

type SessionKind = 'staff' | 'patient' | 'owner';

export interface SessionWho {
  staffId?: string;
  clinicId?: string;
  patientId?: string;
  ownerId?: string;
}

const ACTION_PREFIX: Record<SessionKind, string> = { staff: 'STAFF', patient: 'PATIENT', owner: 'OWNER' };

function actor(kind: SessionKind, who: SessionWho) {
  if (kind === 'staff') return { actorType: 'STAFF' as const, actorId: who.staffId, staffId: who.staffId, entityType: 'Staff', entityId: who.staffId, clinicId: who.clinicId ?? null };
  if (kind === 'patient') return { actorType: 'PATIENT' as const, actorId: who.patientId, entityType: 'Patient', entityId: who.patientId, clinicId: null };
  return { actorType: 'OWNER' as const, actorId: who.ownerId, entityType: 'PlatformOwner', entityId: who.ownerId, clinicId: null };
}

async function safely(what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    logger.warn({ err, what }, 'Could not write security audit event');
  }
}

/** Logout pressed: STAFF_LOGOUT, PATIENT_LOGOUT or OWNER_LOGOUT. */
export function auditLogout(kind: SessionKind, who: SessionWho): Promise<void> {
  return safely('logout', () => recordAuditEvent({ ...actor(kind, who), action: `${ACTION_PREFIX[kind]}_LOGOUT` }));
}

/** The server ended a session: after the inactivity logoff, or revoked (account or clinic deactivated, PIN or password reset, account deleted). */
export function auditSessionEnded(kind: SessionKind, who: SessionWho, reason: 'idle' | 'revoked'): Promise<void> {
  return safely('session_ended', () =>
    recordAuditEvent({ ...actor(kind, who), action: `${ACTION_PREFIX[kind]}_SESSION_ENDED`, metadata: { reason } }),
  );
}

/** Too many wrong PINs, passwords or codes: the account is locked for PIN_LOCKOUT.lockMinutes. */
export function auditAccountLocked(subject: LockoutSubject): Promise<void> {
  return safely('account_locked', async () => {
    const [kind, ...rest] = subject.split(':');
    const id = rest.join(':');
    if (kind === 'staff' || (kind === 'mfa' && rest[0] === 'staff')) {
      const staffId = kind === 'mfa' ? rest.slice(1).join(':') : id;
      await recordAuditEvent({ actorType: 'STAFF', actorId: staffId, staffId, action: 'ACCOUNT_LOCKED', entityType: 'Staff', entityId: staffId, metadata: { by: kind === 'mfa' ? 'code' : 'pin' } });
    } else if (kind === 'patient') {
      await recordAuditEvent({ actorType: 'PATIENT', actorId: id, action: 'ACCOUNT_LOCKED', entityType: 'Patient', entityId: id, clinicId: null, metadata: { by: 'pin' } });
    } else if (kind === 'owner') {
      // The subject holds an email: look up the id instead, never store the email.
      const owner = await prisma.platformOwner.findUnique({ where: { email: id }, select: { id: true } });
      await recordAuditEvent({ actorType: 'OWNER', actorId: owner?.id, action: 'ACCOUNT_LOCKED', entityType: 'PlatformOwner', entityId: owner?.id, clinicId: null, metadata: { by: 'password', knownAccount: Boolean(owner) } });
    } else {
      // An ID that matches no account: record that it happened, not what was typed.
      await recordAuditEvent({ actorType: 'SYSTEM', action: 'ACCOUNT_LOCKED', entityType: 'Login', clinicId: null, metadata: { by: 'pin', knownAccount: false, area: rest[0] === 'staff' ? 'staff' : 'patient' } });
    }
  });
}

/**
 * Records ACCESS_DENIED whenever a logged-in person gets a 403 (their role or
 * clinic does not allow what they asked for). Path pattern only (e.g.
 * /api/staff/lab/orders/:id), never query strings or bodies. Mounted once in app.ts.
 */
export function auditAccessDenied(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    if (res.statusCode !== 403) return;
    const r = req as Request & {
      dashboardSession?: { staffId: string; clinicId: string; role: string };
      patientSession?: { patientId: string };
      ownerSession?: { ownerId: string };
    };
    const route = `${req.baseUrl}${typeof req.route?.path === 'string' ? req.route.path : ''}` || 'unknown';
    const metadata = { method: req.method, route };
    if (r.dashboardSession) {
      const s = r.dashboardSession;
      void safely('access_denied', () => recordAuditEvent({ actorType: 'STAFF', actorId: s.staffId, staffId: s.staffId, clinicId: s.clinicId, action: 'ACCESS_DENIED', entityType: 'Request', metadata: { ...metadata, role: s.role } }));
    } else if (r.patientSession) {
      const s = r.patientSession;
      void safely('access_denied', () => recordAuditEvent({ actorType: 'PATIENT', actorId: s.patientId, clinicId: null, action: 'ACCESS_DENIED', entityType: 'Request', metadata }));
    } else if (r.ownerSession) {
      const s = r.ownerSession;
      void safely('access_denied', () => recordAuditEvent({ actorType: 'OWNER', actorId: s.ownerId, clinicId: null, action: 'ACCESS_DENIED', entityType: 'Request', metadata }));
    }
  });
  next();
}
