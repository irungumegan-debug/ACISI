import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { Clinic, Staff } from '@prisma/client';
import { recordAuditEvent } from './auditService';

export async function findActiveStaffByPhone(phoneNumberE164: string): Promise<Staff | null> {
  const staff = await prisma.staff.findUnique({ where: { phoneNumber: phoneNumberE164 } });
  if (!staff || !staff.isActive) return null;
  return staff;
}

/** Same as findActiveStaffByPhone, but also loads the clinic — for the dashboard login, which needs the clinic name for the session/UI. */
export async function findActiveStaffWithClinicByPhone(
  phoneNumberE164: string,
): Promise<(Staff & { clinic: Clinic }) | null> {
  const staff = await prisma.staff.findUnique({
    where: { phoneNumber: phoneNumberE164 },
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
