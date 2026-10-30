import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { OWNER_SESSION_TTL_SECONDS } from '../config/constants';
import { clearLockout, isLockedOut, lockoutMessage, recordWrongPin } from '../services/pinLockout';
import { authenticateOwner, normalizeOwnerEmail } from '../services/ownerService';
import { createOwnerSession, destroyOwnerSession, loadOwnerSession, OwnerSession, OWNER_SESSION_COOKIE_NAME } from './session';
import { logger } from '../utils/logger';

export interface AuthenticatedOwnerRequest extends Request {
  ownerSession: OwnerSession;
}

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const ownerAuthRouter = Router();

ownerAuthRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const email = normalizeOwnerEmail(parsed.data.email);
  if (await isLockedOut(`owner:${email}`)) {
    res.status(429).json({ error: lockoutMessage('passwords') });
    return;
  }

  const owner = await authenticateOwner(email, parsed.data.password);
  if (!owner) {
    const nowLocked = await recordWrongPin(`owner:${email}`);
    res.status(nowLocked ? 429 : 401).json({ error: nowLocked ? lockoutMessage('passwords') : 'Invalid email or password' });
    return;
  }

  await clearLockout(`owner:${email}`);

  const token = await createOwnerSession({ ownerId: owner.id, email: owner.email, name: owner.name });

  res.cookie(OWNER_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // See src/dashboard/auth.ts for why this is req.secure, not NODE_ENV.
    secure: req.secure,
    // Strict, unlike the staff/patient cookies: nothing ever links into the
    // owner site from elsewhere, so there's no cross-site navigation to keep
    // logged in, and it shuts out cross-site request forgery entirely.
    sameSite: 'strict',
    maxAge: OWNER_SESSION_TTL_SECONDS * 1000,
  });

  res.json({ name: owner.name, email: owner.email });
});

ownerAuthRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[OWNER_SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await destroyOwnerSession(token);
  }
  res.clearCookie(OWNER_SESSION_COOKIE_NAME);
  res.status(204).send();
});

ownerAuthRouter.get('/me', requireOwnerSession, (req, res) => {
  const { ownerId, email, name } = (req as AuthenticatedOwnerRequest).ownerSession;
  res.json({ ownerId, email, name });
});

export async function requireOwnerSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[OWNER_SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const session = await loadOwnerSession(token);
    if (!session) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }
    (req as AuthenticatedOwnerRequest).ownerSession = session;
    next();
  } catch (err) {
    logger.error({ err }, 'Failed to validate owner session');
    res.status(500).json({ error: 'Internal server error' });
  }
}
