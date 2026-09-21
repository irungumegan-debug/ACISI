import { Clinic } from '@prisma/client';
import { prisma } from '../db/prisma';
import { generateClinicInviteCode, generateUssdCode } from '../utils/idCodes';
import { generateUniqueStaffCode, hashPin } from './staffService';
import { recordAuditEvent } from './auditService';

const MAX_CODE_GENERATION_ATTEMPTS = 10;

export interface ClinicListItem {
  id: string;
  name: string;
}

/**
 * All active clinics, ordered for the USSD selection menu. Fetched in full
 * and paginated in-memory by the caller — fine at MVP scale (dozens of
 * clinics); revisit with DB-level pagination if that grows into the hundreds.
 */
export async function listActiveClinics(): Promise<ClinicListItem[]> {
  return prisma.clinic.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

export async function findClinicByInviteCode(inviteCode: string): Promise<Clinic | null> {
  return prisma.clinic.findUnique({ where: { inviteCode: inviteCode.trim().toUpperCase() } });
}

async function generateUniqueInviteCode(clinicName: string): Promise<string> {
  for (let i = 0; i < MAX_CODE_GENERATION_ATTEMPTS; i++) {
    const code = generateClinicInviteCode(clinicName);
    const existing = await prisma.clinic.findUnique({ where: { inviteCode: code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique clinic invite code after several attempts');
}

async function generateUniqueUssdCode(): Promise<string> {
  for (let i = 0; i < MAX_CODE_GENERATION_ATTEMPTS; i++) {
    const code = generateUssdCode();
    const existing = await prisma.clinic.findUnique({ where: { ussdCode: code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique USSD code after several attempts');
}

interface RegisterClinicInput {
  name: string;
  county?: string;
  adminName: string;
  adminPhoneNumberE164: string;
  adminPin: string;
}

interface RegisterClinicResult {
  clinic: Clinic;
  adminStaffId: string;
  adminStaffCode: string;
}

/**
 * Brand-new clinic self-registration: creates the Clinic, its persistent
 * invite code, and its first admin Staff row (with their own staffCode + PIN)
 * in one transaction. Every doctor/staff signup after this attaches to the
 * clinic via the returned invite code — see staffService.registerStaffViaInviteCode.
 */
export async function registerClinic(input: RegisterClinicInput): Promise<RegisterClinicResult> {
  const [inviteCode, ussdCode, staffCode, pinHash] = await Promise.all([
    generateUniqueInviteCode(input.name),
    generateUniqueUssdCode(),
    generateUniqueStaffCode(),
    hashPin(input.adminPin),
  ]);

  const { clinic, adminStaff } = await prisma.$transaction(async (tx) => {
    const clinic = await tx.clinic.create({
      data: { name: input.name, county: input.county, ussdCode, inviteCode },
    });

    // Every clinic needs at least one department for check-ins to route to —
    // a brand-new clinic has no way to configure one before its first
    // check-in, so seed a sensible default. The admin can add more later.
    await tx.department.create({ data: { clinicId: clinic.id, name: 'General' } });

    const adminStaff = await tx.staff.create({
      data: {
        clinicId: clinic.id,
        staffCode,
        phoneNumber: input.adminPhoneNumberE164,
        name: input.adminName,
        pinHash,
        role: 'ADMIN',
      },
    });

    return { clinic, adminStaff };
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: adminStaff.id,
    staffId: adminStaff.id,
    action: 'CLINIC_REGISTERED',
    entityType: 'Clinic',
    entityId: clinic.id,
  });

  return { clinic, adminStaffId: adminStaff.id, adminStaffCode: adminStaff.staffCode };
}

/** Admin-only: rotates a clinic's invite code. Staff who already joined are unaffected — only future signups need the new code. */
export async function regenerateInviteCode(clinicId: string, requestedByStaffId: string): Promise<string> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic) {
    throw new Error('Clinic not found');
  }

  const inviteCode = await generateUniqueInviteCode(clinic.name);
  await prisma.clinic.update({ where: { id: clinicId }, data: { inviteCode } });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: requestedByStaffId,
    staffId: requestedByStaffId,
    action: 'CLINIC_INVITE_CODE_REGENERATED',
    entityType: 'Clinic',
    entityId: clinicId,
  });

  return inviteCode;
}
