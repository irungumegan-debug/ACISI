import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { clearLockout, isLockedOut, lockoutMessage, LockoutSubject, recordWrongPin } from '../services/pinLockout';
import {
  findActiveStaffWithClinicByCode,
  verifyStaffPin,
} from '../services/staffService';
import {
  createDashboardSession,
  dashboardSessionTtlSeconds,
  destroyDashboardSession,
  loadDashboardSession,
  DashboardSession,
  SESSION_COOKIE_NAME,
} from './session';
import { markSessionActive } from '../services/idleTimeout';
import { logger } from '../utils/logger';
import { Clinic, Staff } from '@prisma/client';
import { recordAuditEvent } from '../services/auditService';
import { prisma } from '../db/prisma';
import {
  isTrustedDevice,
  confirmAppSetup,
  MfaError,
  mfaRequiredFor,
  rememberDevice,
  startAppSetup,
  startLoginChallenge,
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_DAYS,
  verifyLoginCode,
} from '../services/staffMfaService';

export interface AuthenticatedRequest extends Request {
  dashboardSession: DashboardSession;
}


const loginSchema = z.object({
  staffCode: z.string().min(1),
  pin: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Staff ID and PIN are required' });
    return;
  }

  const staffCode = parsed.data.staffCode.trim().toUpperCase();
  const staff = await findActiveStaffWithClinicByCode(staffCode);
  // Counted per account (one staff ID is one account), so a lockout holds
  // however the request is made.
  const subject: LockoutSubject = staff ? `staff:${staff.id}` : `unknown:staff:${staffCode}`;

  if (await isLockedOut(subject)) {
    res.status(429).json({ error: lockoutMessage() });
    return;
  }

  const isValid = staff ? await verifyStaffPin(staff, parsed.data.pin) : false;

  if (!staff || !isValid) {
    const nowLocked = await recordWrongPin(subject);
    res.status(nowLocked ? 429 : 401).json({ error: nowLocked ? lockoutMessage() : 'Invalid staff ID or PIN' });
    return;
  }

  await clearLockout(subject);

  // Admins and doctors who set up an authenticator app (Settings → Multi-factor
  // login): the app code as well, unless this device was remembered.
  if (mfaRequiredFor(staff.role) && !(await isTrustedDevice(staff.id, req.cookies?.[TRUSTED_DEVICE_COOKIE] as string | undefined))) {
    try {
      const challenge = await startLoginChallenge(staff);
      if (challenge) {
        res.json(challenge);
        return;
      }
    } catch (err) {
      if (err instanceof MfaError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  await issueStaffSession(staff, req, res);
});

/** Creates the console session and its cookie, and answers the login request. */
async function issueStaffSession(staff: Staff & { clinic: Clinic }, req: Request, res: Response): Promise<void> {
  const token = await createDashboardSession({
    staffId: staff.id,
    staffCode: staff.staffCode,
    staffName: staff.name,
    role: staff.role,
    clinicId: staff.clinicId,
    clinicName: staff.clinic.name,
    departmentId: staff.departmentId,
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // req.secure (not env.NODE_ENV, which Railway never sets to
    // 'production') reflects whether this request actually arrived over
    // HTTPS, via the trust proxy setting in app.ts honoring
    // X-Forwarded-Proto from the platform's TLS-terminating edge proxy.
    secure: req.secure,
    sameSite: 'lax',
    maxAge: dashboardSessionTtlSeconds(staff.role) * 1000,
  });

  res.json({ staffName: staff.name, clinicName: staff.clinic.name, role: staff.role });
}

const verifyCodeSchema = z.object({
  challengeId: z.string().min(1).max(100),
  code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits'),
  rememberDevice: z.boolean().optional(),
});

/** Second step of an admin's or doctor's login: the 6-digit code from the authenticator app (or SMS). */
authRouter.post('/login/verify', async (req, res) => {
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code' });
    return;
  }
  let who: { staffId: string; staffCode: string; method: string };
  try {
    who = await verifyLoginCode(parsed.data.challengeId, parsed.data.code);
  } catch (err) {
    if (err instanceof MfaError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
  const staff = await findActiveStaffWithClinicByCode(who.staffCode);
  if (!staff || staff.id !== who.staffId) {
    res.status(401).json({ error: 'Log in again' });
    return;
  }
  if (await isLockedOut(`staff:${staff.id}`)) {
    res.status(429).json({ error: lockoutMessage() });
    return;
  }
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staff.id,
    staffId: staff.id,
    clinicId: staff.clinicId,
    action: 'STAFF_LOGIN_CODE_VERIFIED',
    entityType: 'Staff',
    entityId: staff.id,
    metadata: { rememberDevice: parsed.data.rememberDevice === true, method: who.method },
  });
  if (parsed.data.rememberDevice) {
    res.cookie(TRUSTED_DEVICE_COOKIE, await rememberDevice(staff.id), {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'lax',
      maxAge: TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000,
    });
  }
  await issueStaffSession(staff, req, res);
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await destroyDashboardSession(token);
  }
  res.clearCookie(SESSION_COOKIE_NAME);
  res.status(204).send();
});

/**
 * The console pings this when someone actually types, clicks or scrolls
 * (at most once a minute), keeping the session from the inactivity logoff.
 */
authRouter.post('/activity', requireStaffSession, (_req, res) => {
  res.status(204).send();
});

authRouter.get('/me', requireStaffSession, (req, res) => {
  res.json((req as AuthenticatedRequest).dashboardSession);
});

/**
 * Settings → Multi-factor login, for the logged-in person themselves
 * (admins and doctors). `available` is false until STAFF_MFA_ENABLED=true
 * on the server, and for other roles.
 */
authRouter.get('/mfa', requireStaffSession, async (req, res) => {
  const { staffId, role } = (req as AuthenticatedRequest).dashboardSession;
  const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { totpEnabledAt: true } });
  res.json({ available: mfaRequiredFor(role), setUp: Boolean(staff?.totpEnabledAt), setUpAt: staff?.totpEnabledAt?.toISOString() ?? null });
});

authRouter.post('/mfa/setup', requireStaffSession, async (req, res) => {
  const { staffId, staffCode, clinicId, role } = (req as AuthenticatedRequest).dashboardSession;
  if (!mfaRequiredFor(role)) {
    res.status(403).json({ error: 'Multi-factor login is not switched on for your role' });
    return;
  }
  res.json(await startAppSetup({ id: staffId, staffCode, clinicId }));
});

const confirmSetupSchema = z.object({
  setupId: z.string().min(1).max(100),
  code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits'),
});

authRouter.post('/mfa/setup/confirm', requireStaffSession, async (req, res) => {
  const { staffId, role } = (req as AuthenticatedRequest).dashboardSession;
  if (!mfaRequiredFor(role)) {
    res.status(403).json({ error: 'Multi-factor login is not switched on for your role' });
    return;
  }
  const parsed = confirmSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code' });
    return;
  }
  try {
    await confirmAppSetup(staffId, parsed.data.setupId, parsed.data.code);
  } catch (err) {
    if (err instanceof MfaError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
  res.json({ setUp: true });
});

/**
 * Staff and doctors don't reset their own PIN (owner's decision, 23 Nov
 * 2026): their clinic admin does it in Settings → Staff → Reset PIN, and
 * another admin at the clinic (or ACISI, with the reset-staff-pin server
 * script) resets an admin's. These two endpoints stay only to tell older
 * pages where to go; no code is sent or accepted.
 */
export const STAFF_PIN_RESET_BY_ADMIN_MESSAGE =
  'Staff PINs are reset by your clinic admin: ask them to open Settings → Staff and tap "Reset PIN" next to your name. ' +
  'If you are the clinic admin, ask another admin at your clinic, or contact ACISI support.';

authRouter.post('/forgot-pin', (_req, res) => {
  res.json({ message: STAFF_PIN_RESET_BY_ADMIN_MESSAGE });
});

authRouter.post('/reset-pin', (_req, res) => {
  res.status(410).json({ error: STAFF_PIN_RESET_BY_ADMIN_MESSAGE });
});

export async function requireStaffSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const session = await loadDashboardSession(token);
    if (!session) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }
    (req as AuthenticatedRequest).dashboardSession = session;
    // A change made by the person counts as activity; background reads don't.
    if (req.method !== 'GET') await markSessionActive('staff', token);
    next();
  } catch (err) {
    logger.error({ err }, 'Failed to validate dashboard session');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Front-desk work (queue, walk-ins, billing, checkout, patient details,
 * appointments, phone verification): receptionists, clinicians and clinic
 * admins only. Written as an allow-list so any other role (doctors, lab
 * technicians, and any role added later) is refused by default.
 */
export const FRONT_DESK_ROLES: readonly string[] = ['RECEPTIONIST', 'CLINICIAN', 'ADMIN'];

export function isFrontDeskRole(role: string): boolean {
  return FRONT_DESK_ROLES.includes(role);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const { role } = (req as AuthenticatedRequest).dashboardSession;
  if (role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
