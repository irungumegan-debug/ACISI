import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { Clinic, Staff } from '@prisma/client';
import { recordAuditEvent } from './auditService';
import { generateStaffCode } from '../utils/idCodes';
import { env } from '../config/env';

const MAX_CODE_GENERATION_ATTEMPTS = 10;

/** Generates a staffCode guaranteed not to collide with an existing one. */
export async function generateUniqueStaffCode(): Promise<string> {
  for (let i = 0; i < MAX_CODE_GENERATION_ATTEMPTS; i++) {
    const code = generateStaffCode();
    const existing = await prisma.staff.findUnique({ where: { staffCode: code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique staff code after several attempts');
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, env.STAFF_PIN_SALT_ROUNDS);
}

export async function findActiveStaffByCode(staffCode: string): Promise<Staff | null> {
  const staff = await prisma.staff.findUnique({ where: { staffCode } });
  if (!staff || !staff.isActive) return null;
  return staff;
}

/** Same as findActiveStaffByCode, but also loads the clinic — for the dashboard/USSD login, which needs the clinic name for the session/UI. */
export async function findActiveStaffWithClinicByCode(
  staffCode: string,
): Promise<(Staff & { clinic: Clinic }) | null> {
  const staff = await prisma.staff.findUnique({
    where: { staffCode },
    include: { clinic: true },
  });
  if (!staff || !staff.isActive || !staff.clinic.isActive) return null;
  return staff;
}

export async function verifyStaffPin(staff: Staff, pin: string): Promise<boolean> {
  const isValid = await bcrypt.compare(pin, staff.pinHash);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staff.id,
    staffId: staff.id,
    action: isValid ? 'STAFF_LOGIN_SUCCESS' : 'STAFF_LOGIN_FAILED',
    entityType: 'Staff',
    entityId: staff.id,
  });
  return isValid;
}
