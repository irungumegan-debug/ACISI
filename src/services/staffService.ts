import bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import { prisma } from '../db/prisma';
import { Clinic, Prisma, Staff, StaffRole, StaffPresenceOverride } from '@prisma/client';
import { recordAuditEvent } from './auditService';
import { generateStaffCode, generateTemporaryPin } from '../utils/idCodes';
import { env } from '../config/env';
import { findClinicByInviteCode } from './clinicService';
import { findActiveDepartment } from './departmentService';

const PIN_PATTERN = /^\d{4,6}$/;

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
  /** Required when role is DOCTOR — which department they're joining. Ignored for other roles. */
  departmentId?: string;
}

export class InvalidInviteCodeError extends Error {
  constructor() {
    super('That clinic invite code was not recognized');
    this.name = 'InvalidInviteCodeError';
  }
}

export class InvalidDepartmentError extends Error {
  constructor() {
    super('Please choose a valid department for this clinic');
    this.name = 'InvalidDepartmentError';
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

  if (input.role === 'DOCTOR') {
    if (!input.departmentId || !(await findActiveDepartment(input.departmentId, clinic.id))) {
      throw new InvalidDepartmentError();
    }
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
      departmentId: input.role === 'DOCTOR' ? input.departmentId : undefined,
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

/** Same as findActiveStaffByCode, but by internal id — for callers (e.g. a logged-in session) that already have the id, not the code. */
export async function findActiveStaffById(staffId: string): Promise<Staff | null> {
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
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

/** Pure PIN check, no audit side effect — callers record their own accountability event for whatever this comparison means to them (a login attempt, a doctor signing a consultation, etc). */
export async function comparePin(staff: Staff, pin: string): Promise<boolean> {
  return bcrypt.compare(pin, staff.pinHash);
}

export async function verifyStaffPin(staff: Staff, pin: string): Promise<boolean> {
  const isValid = await comparePin(staff, pin);

  // A successful login is the automatic "in today" signal for a doctor —
  // see getDoctorPresenceStatus. Not meaningful for other roles, so scoped
  // to DOCTOR to avoid polluting front-desk/admin rows with a field that's
  // never read for them.
  if (isValid && staff.role === 'DOCTOR') {
    await prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
  }

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

export class InvalidPinFormatError extends Error {
  constructor() {
    super('PIN must be 4-6 digits');
    this.name = 'InvalidPinFormatError';
  }
}

/**
 * The shared low-level mechanic behind every PIN reset path (the console
 * recovery script, the admin dashboard) — just hashes and sets pinHash. No
 * authorization or audit logging here: those differ meaningfully by
 * caller (who's allowed to reset whose PIN, and what that means for the
 * accountability trail), so each caller owns its own check and its own
 * recordAuditEvent call, same as the rest of this codebase's convention.
 */
async function setPin(staffId: string, newPin: string): Promise<Staff> {
  if (!PIN_PATTERN.test(newPin)) {
    throw new InvalidPinFormatError();
  }
  const pinHash = await hashPin(newPin);
  return prisma.staff.update({ where: { id: staffId }, data: { pinHash } });
}

export class StaffNotFoundError extends Error {
  constructor() {
    super('Staff member not found');
    this.name = 'StaffNotFoundError';
  }
}

/**
 * Console-only recovery path (scripts/resetStaffPin.ts) — whoever can run
 * this already has full production access, so there's no clinic scoping to
 * enforce here, unlike the admin-dashboard path below. Still leaves its own
 * audit trail, distinct from a dashboard-initiated reset, since the two are
 * very different trust contexts worth telling apart later.
 */
export async function resetStaffPinViaConsole(staffCode: string, newPin: string): Promise<Staff> {
  const staff = await prisma.staff.findUnique({ where: { staffCode: staffCode.trim().toUpperCase() } });
  if (!staff) {
    throw new StaffNotFoundError();
  }

  const updated = await setPin(staff.id, newPin);

  await recordAuditEvent({
    actorType: 'SYSTEM',
    action: 'STAFF_PIN_RESET_VIA_CONSOLE',
    entityType: 'Staff',
    entityId: staff.id,
  });

  return updated;
}

export type DoctorPresenceStatus = 'IN' | 'OUT' | 'NOT_IN_YET';

interface PresenceFields {
  lastLoginAt: Date | null;
  presenceOverride: StaffPresenceOverride | null;
  presenceOverrideAt: Date | null;
}

/**
 * Same-day-only presence: whichever of lastLoginAt / presenceOverrideAt is
 * more recent AND falls on today decides the answer. A signal from a
 * previous day (a stale override nobody cleared, yesterday's login) is
 * ignored entirely — this is a live "are they here right now" read, never a
 * schedule or a history. Neither signal today means NOT_IN_YET, the same
 * bucket a doctor who's off sick or not yet arrived falls into.
 */
export function getDoctorPresenceStatus(staff: PresenceFields, now: Date = new Date()): DoctorPresenceStatus {
  const startOfToday = dayjs(now).startOf('day').toDate();

  const loginToday = staff.lastLoginAt && staff.lastLoginAt >= startOfToday ? staff.lastLoginAt : null;
  const overrideToday =
    staff.presenceOverride && staff.presenceOverrideAt && staff.presenceOverrideAt >= startOfToday
      ? staff.presenceOverrideAt
      : null;

  if (overrideToday && (!loginToday || overrideToday > loginToday)) {
    return staff.presenceOverride === 'IN' ? 'IN' : 'OUT';
  }

  return loginToday ? 'IN' : 'NOT_IN_YET';
}

export interface ClinicStaffListItem {
  id: string;
  staffCode: string;
  name: string;
  role: StaffRole;
  departmentName: string | null;
  isActive: boolean;
  /** null for non-doctor roles — presence is a doctor-only concept. */
  presence: DoctorPresenceStatus | null;
}

/** For the clinic admin's staff-management view — scoped to their own clinic, same as every other admin-facing list in this codebase. */
export async function listClinicStaff(clinicId: string): Promise<ClinicStaffListItem[]> {
  const staff = await prisma.staff.findMany({
    where: { clinicId },
    orderBy: { name: 'asc' },
    include: { department: { select: { name: true } } },
  });

  return staff.map((s) => ({
    id: s.id,
    staffCode: s.staffCode,
    name: s.name,
    role: s.role,
    departmentName: s.department?.name ?? null,
    isActive: s.isActive,
    presence: s.role === 'DOCTOR' ? getDoctorPresenceStatus(s) : null,
  }));
}

export class StaffIsNotADoctorError extends Error {
  constructor() {
    super('Presence only applies to doctors');
    this.name = 'StaffIsNotADoctorError';
  }
}

const PRESENCE_STATUSES: StaffPresenceOverride[] = ['IN', 'OUT'];

/** A doctor setting their own presence for today — self-service, no clinic-scoping check needed since it always targets the caller's own row. */
export async function setDoctorPresenceBySelf(
  doctorStaffId: string,
  status: StaffPresenceOverride,
): Promise<{ presence: DoctorPresenceStatus }> {
  if (!PRESENCE_STATUSES.includes(status)) {
    throw new Error(`status must be one of ${PRESENCE_STATUSES.join(', ')}`);
  }

  const now = new Date();
  await prisma.staff.update({
    where: { id: doctorStaffId },
    data: { presenceOverride: status, presenceOverrideAt: now },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: doctorStaffId,
    staffId: doctorStaffId,
    action: 'DOCTOR_PRESENCE_SET',
    entityType: 'Staff',
    entityId: doctorStaffId,
    metadata: { status },
  });

  return { presence: status };
}

interface SetDoctorPresenceByAdminInput {
  clinicId: string;
  staffId: string;
  requestedByStaffId: string;
  status: StaffPresenceOverride;
}

/**
 * A clinic admin setting presence on behalf of one of their own doctors —
 * same clinic-scoping and StaffNotFoundError-covers-both pattern as
 * resetStaffPinByAdmin. Records a distinct audit action from the
 * self-service path since the two are different trust contexts.
 */
export async function setDoctorPresenceByAdmin(
  input: SetDoctorPresenceByAdminInput,
): Promise<{ staffCode: string; name: string; presence: DoctorPresenceStatus }> {
  if (!PRESENCE_STATUSES.includes(input.status)) {
    throw new Error(`status must be one of ${PRESENCE_STATUSES.join(', ')}`);
  }

  const staff = await prisma.staff.findFirst({ where: { id: input.staffId, clinicId: input.clinicId } });
  if (!staff) {
    throw new StaffNotFoundError();
  }
  if (staff.role !== 'DOCTOR') {
    throw new StaffIsNotADoctorError();
  }

  const now = new Date();
  await prisma.staff.update({
    where: { id: staff.id },
    data: { presenceOverride: input.status, presenceOverrideAt: now },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.requestedByStaffId,
    staffId: input.requestedByStaffId,
    action: 'DOCTOR_PRESENCE_SET_BY_ADMIN',
    entityType: 'Staff',
    entityId: staff.id,
    metadata: { targetStaffId: staff.id, targetStaffCode: staff.staffCode, status: input.status },
  });

  return { staffCode: staff.staffCode, name: staff.name, presence: input.status };
}

interface ResetStaffPinByAdminInput {
  clinicId: string;
  staffId: string;
  requestedByStaffId: string;
  /** If omitted, a random temporary PIN is generated. */
  newPin?: string;
}

/**
 * A clinic admin resetting one of their own staff/doctors' PINs. Scoped to
 * the admin's own clinic — StaffNotFoundError (never a distinct
 * "wrong clinic" error) covers both a bad id and an attempt to reach
 * another clinic's staff, same not-found-vs-forbidden pattern used
 * elsewhere. Returns the new PIN in plaintext exactly once, for the caller
 * to show the admin — it's never stored or logged anywhere in that form.
 */
export async function resetStaffPinByAdmin(input: ResetStaffPinByAdminInput): Promise<{ staffCode: string; name: string; newPin: string }> {
  const staff = await prisma.staff.findFirst({ where: { id: input.staffId, clinicId: input.clinicId } });
  if (!staff) {
    throw new StaffNotFoundError();
  }

  const newPin = input.newPin ?? generateTemporaryPin();
  await setPin(staff.id, newPin);

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.requestedByStaffId,
    staffId: input.requestedByStaffId,
    action: 'STAFF_PIN_RESET',
    entityType: 'Staff',
    entityId: staff.id,
    metadata: { resetStaffId: staff.id, resetStaffCode: staff.staffCode },
  });

  return { staffCode: staff.staffCode, name: staff.name, newPin };
}
