import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { Clinic, Prisma, Staff, StaffRole } from '@prisma/client';
import { recordAuditEvent } from './auditService';
import { generateStaffCode } from '../utils/idCodes';
import { env } from '../config/env';
import { findClinicByInviteCode } from './clinicService';

const MAX_CODE_GENERATION_ATTEMPTS = 10;

/** Either the top-level Prisma client or a $transaction callback's client — lets callers generate a code inside their own transaction. */
type Db = typeof prisma | Prisma.TransactionClient;

/** Generates a staffCode guaranteed not to collide with an existing one. */
export async function generateUniqueStaffCode(db: Db = prisma): Promise<string> {
  for (let i = 0; i < MAX_CODE_GENERATION_ATTEMPTS; i++) {
    const code = generateStaffCode();
    const existing = await db.staff.findUnique({ where: { staffCode: code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique staff code after several attempts');
}

const SIGNUP_ROLES: StaffRole[] = ['RECEPTIONIST', 'CLINICIAN', 'DOCTOR'];

interface RegisterStaffInput {
  name: string;
  phoneNumberE164: string;
  pin: string;
  inviteCode: string;
  role: StaffRole;
}

export class InvalidInviteCodeError extends Error {
  constructor() {
    super('That clinic invite code was not recognized');
    this.name = 'InvalidInviteCodeError';
  }
}

/**
 * Self-service signup for a doctor or front-desk staff member joining an
 * existing clinic — never ADMIN, which is only created via
 * clinicService.registerClinic (the clinic self-registration flow).
 */
export async function registerStaffViaInviteCode(input: RegisterStaffInput): Promise<Staff> {
  if (!SIGNUP_ROLES.includes(input.role)) {
    throw new Error(`Role must be one of ${SIGNUP_ROLES.join(', ')}`);
  }

  const clinic = await findClinicByInviteCode(input.inviteCode);
  if (!clinic || !clinic.isActive) {
    throw new InvalidInviteCodeError();
  }

  const staffCode = await generateUniqueStaffCode();
  const pinHash = await hashPin(input.pin);

  const staff = await prisma.staff.create({
    data: {
      clinicId: clinic.id,
      staffCode,
      phoneNumber: input.phoneNumberE164,
      name: input.name,
      pinHash,
      role: input.role,
    },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staff.id,
    staffId: staff.id,
    action: 'STAFF_REGISTERED',
    entityType: 'Staff',
    entityId: staff.id,
    metadata: { clinicId: clinic.id, role: input.role },
  });

  return staff;
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
