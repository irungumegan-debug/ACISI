import bcrypt from 'bcrypt';
import { PlatformOwner } from '@prisma/client';
import { prisma } from '../db/prisma';
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
export async function createOrResetOwner(input: {
  email: string;
  name: string;
  password: string;
}): Promise<{ owner: PlatformOwner; created: boolean }> {
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
    metadata: { channel: 'CONSOLE_SCRIPT' },
  });

  return { owner, created: !existing };
}
