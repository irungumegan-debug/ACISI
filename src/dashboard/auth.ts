import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { redis } from '../config/redis';
import { LOGIN_RATE_LIMIT_MAX_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_SECONDS, DASHBOARD_SESSION_TTL_SECONDS } from '../config/constants';
import { findActiveStaffWithClinicByCode, verifyStaffPin } from '../services/staffService';
import {
  createDashboardSession,
  destroyDashboardSession,
  loadDashboardSession,
  DashboardSession,
  SESSION_COOKIE_NAME,
} from './session';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  dashboardSession: DashboardSession;
}

function rateLimitKey(staffCode: string): string {
  return `dashboard:login_attempts:${staffCode}`;
}

async function isRateLimited(staffCode: string): Promise<boolean> {
  const count = await redis.get(rateLimitKey(staffCode));
  return Number(count ?? 0) >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
}

async function recordFailedAttempt(staffCode: string): Promise<void> {
  const k = rateLimitKey(staffCode);
  const count = await redis.incr(k);
  if (count === 1) {
    await redis.expire(k, LOGIN_RATE_LIMIT_WINDOW_SECONDS);
  }
}

async function clearRateLimit(staffCode: string): Promise<void> {
  await redis.del(rateLimitKey(staffCode));
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

  if (await isRateLimited(staffCode)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    return;
  }

  const staff = await findActiveStaffWithClinicByCode(staffCode);
  const isValid = staff ? await verifyStaffPin(staff, parsed.data.pin) : false;

  if (!staff || !isValid) {
    await recordFailedAttempt(staffCode);
    res.status(401).json({ error: 'Invalid staff ID or PIN' });
    return;
  }

  await clearRateLimit(staffCode);

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
    maxAge: DASHBOARD_SESSION_TTL_SECONDS * 1000,
  });

  res.json({ staffName: staff.name, clinicName: staff.clinic.name, role: staff.role });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await destroyDashboardSession(token);
  }
  res.clearCookie(SESSION_COOKIE_NAME);
  res.status(204).send();
});

authRouter.get('/me', requireStaffSession, (req, res) => {
  res.json((req as AuthenticatedRequest).dashboardSession);
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
    next();
  } catch (err) {
    logger.error({ err }, 'Failed to validate dashboard session');
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const { role } = (req as AuthenticatedRequest).dashboardSession;
  if (role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
