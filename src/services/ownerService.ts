import bcrypt from 'bcrypt';
import { PlatformOwner } from '@prisma/client';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { OWNER_PASSWORD_MIN_LENGTH } from '../config/constants';
import { recordAuditEvent } from './auditService';
import { revokeSessionsFor } from './sessionRevocation';

/**
 * Higher than the staff PIN cost: there's one owner login, rarely, and it
 * guards every record on the platform.
 */
const OWNER_PASSWORD_SALT_ROUNDS = 12;

/**
 * Compared against when no owner matches the email, so a wrong email takes
 * as long as a wrong password and response timing can't reveal which
 * emails have an owner account.
 */
let dummyPasswordHash: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= bcrypt.hash('not-a-real-password', OWNER_PASSWORD_SALT_ROUNDS);
  return dummyPasswordHash;
}

export class InvalidOwnerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOwnerInputError';
  }
}

export function normalizeOwnerEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns the owner only if both the email and password match an active account. */
export async function authenticateOwner(email: string, password: string): Promise<PlatformOwner | null> {
  const owner = await prisma.platformOwner.findUnique({ where: { email: normalizeOwnerEmail(email) } });
  const isValid = await bcrypt.compare(password, owner?.passwordHash ?? (await getDummyPasswordHash()));

  if (owner) {
    await recordAuditEvent({
      actorType: 'OWNER',
      actorId: owner.id,
      action: isValid && owner.isActive ? 'OWNER_LOGIN_SUCCESS' : 'OWNER_LOGIN_FAILED',
      entityType: 'PlatformOwner',
      entityId: owner.id,
    });
  }

  if (!owner || !owner.isActive || !isValid) return null;

  await prisma.platformOwner.update({ where: { id: owner.id }, data: { lastLoginAt: new Date() } });
  return owner;
}

/**
 * Creates the owner account, or — if one already exists for this email —
 * resets its password, reactivates it, and logs out every existing owner
 * session. Only ever called from scripts/createOwner.ts on the server
 * console; there is deliberately no HTTP route that creates an owner.
 */
export async function createOrResetOwner(
  input: {
    email: string;
    name: string;
    password: string;
  },
  channel: 'CONSOLE_SCRIPT' | 'ENV_BOOTSTRAP' = 'CONSOLE_SCRIPT',
): Promise<{ owner: PlatformOwner; created: boolean }> {
  const email = normalizeOwnerEmail(input.email);
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InvalidOwnerInputError('That does not look like a valid email address.');
  }
  if (!name) {
    throw new InvalidOwnerInputError('A name is required.');
  }
  if (input.password.length < OWNER_PASSWORD_MIN_LENGTH) {
    throw new InvalidOwnerInputError(`The password must be at least ${OWNER_PASSWORD_MIN_LENGTH} characters.`);
  }

  const passwordHash = await bcrypt.hash(input.password, OWNER_PASSWORD_SALT_ROUNDS);
  const existing = await prisma.platformOwner.findUnique({ where: { email } });

  const owner = existing
    ? await prisma.platformOwner.update({ where: { id: existing.id }, data: { name, passwordHash, isActive: true } })
    : await prisma.platformOwner.create({ data: { email, name, passwordHash } });

  if (existing) {
    await revokeSessionsFor(`owner:${owner.id}`);
  }

  await recordAuditEvent({
    actorType: 'SYSTEM',
    action: existing ? 'OWNER_PASSWORD_RESET' : 'OWNER_CREATED',
    entityType: 'PlatformOwner',
    entityId: owner.id,
    metadata: { channel },
  });

  return { owner, created: !existing };
}

export interface OwnerBootstrapConfig {
  email?: string;
  name?: string;
  password?: string;
}

/**
 * Creates the owner account from environment variables (OWNER_EMAIL,
 * OWNER_NAME, OWNER_PASSWORD) at server startup — the no-shell alternative
 * to scripts/createOwner.ts, for hosts like Railway where setting a variable
 * is easier than opening a console.
 *
 * Create-only by design: if an owner already exists for that email, nothing
 * changes, so a forgotten OWNER_PASSWORD left in the environment can never
 * silently reset the password on a later deploy (use the console script to
 * reset it). Only a bcrypt hash of the password is stored; neither the
 * password nor anything derived from it is logged. Never throws — a bad
 * config is logged and the server carries on without it.
 */
export async function ensureOwnerFromEnv(config: OwnerBootstrapConfig): Promise<void> {
  const provided = { OWNER_EMAIL: config.email, OWNER_NAME: config.name, OWNER_PASSWORD: config.password };
  const missing = Object.entries(provided)
    .filter(([, v]) => !v?.trim())
    .map(([k]) => k);
  if (missing.length === 3) return;
  if (missing.length > 0) {
    logger.warn({ missing }, 'Owner bootstrap skipped: set all of OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD');
    return;
  }

  const email = normalizeOwnerEmail(config.email as string);
  try {
    const existing = await prisma.platformOwner.findUnique({ where: { email } });
    if (existing) {
      logger.info(
        { email },
        'Owner account already exists; OWNER_PASSWORD was ignored. You can now delete OWNER_PASSWORD from your environment.',
      );
      return;
    }

    await createOrResetOwner(
      { email, name: config.name as string, password: config.password as string },
      'ENV_BOOTSTRAP',
    );
    logger.info(
      { email },
      'Owner account created from environment variables. Sign in at /owner, then delete OWNER_PASSWORD from your environment.',
    );
  } catch (err) {
    if (err instanceof InvalidOwnerInputError) {
      logger.error({ reason: err.message }, 'Owner bootstrap failed: fix the OWNER_* environment variables');
      return;
    }
    // Another instance starting at the same moment may have just created it.
    if ((err as { code?: string })?.code === 'P2002') return;
    logger.error({ err }, 'Owner bootstrap failed');
  }
}
