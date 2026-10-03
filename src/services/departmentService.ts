import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';

/**
 * Clinic-defined departments. Each clinic sets its own at registration and
 * in Settings: a name (unique per clinic, case-insensitive), a short code
 * (unique per clinic, for future USSD use), an optional consultation fee,
 * and active/inactive. Departments that have been used are deactivated,
 * never deleted, so history keeps pointing at them.
 */

export const DEPARTMENT_NAME_MAX = 60;
export const MAX_DEPARTMENTS_PER_CLINIC = 50;
export const MAX_DEPARTMENT_FEE_KES = 1_000_000;
const CODE_PATTERN = /^[A-Z0-9]{2,6}$/;

export class DepartmentError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'DepartmentError';
  }
}

export interface DepartmentListItem {
  id: string;
  name: string;
  code: string;
  consultationFeeKes: number | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

// --- Names and codes ------------------------------------------------------------

/** "  orthodontics   (braces) " -> "orthodontics   (braces)" trimmed with single spaces. */
export function cleanDepartmentName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function departmentNameKey(name: string): string {
  return cleanDepartmentName(name).toLowerCase();
}

export function normaliseDepartmentCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/**
 * Suggests a short code from a name: initials for several words
 * ("Oral Surgery" -> "OS", "General Dentistry" -> "GD"), the first three
 * letters for one word ("Braces" -> "BRA", "Invisalign" -> "INV"), then a
 * number if it's already taken ("GEN2").
 */
export function suggestDepartmentCode(name: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((c) => c.toUpperCase()));
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  let base: string;
  if (words.length >= 2) base = words.map((w) => w[0]).join('').slice(0, 4);
  else base = (words[0] ?? '').slice(0, 3);
  if (base.length < 2) base = (words.join('') + 'DEP').slice(0, 3);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = base.slice(0, 6 - String(n).length) + n;
    if (!used.has(candidate)) return candidate;
  }
  throw new DepartmentError('Could not suggest a short code. Please type one.');
}

function assertValidName(name: string): void {
  if (name.length < 2) throw new DepartmentError('Department names need at least 2 characters');
  if (name.length > DEPARTMENT_NAME_MAX) throw new DepartmentError(`Department names can be at most ${DEPARTMENT_NAME_MAX} characters`);
}

function assertValidCode(code: string): void {
  if (!CODE_PATTERN.test(code)) throw new DepartmentError('Short codes are 2–6 capital letters or numbers, e.g. GEN or BRC');
}

function assertValidFee(fee: number | null | undefined): void {
  if (fee === null || fee === undefined) return;
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > MAX_DEPARTMENT_FEE_KES) {
    throw new DepartmentError('The consultation fee must be a whole number of KES');
  }
}

/** Turns Postgres unique-constraint clashes (a race between two admins) into a friendly 409. */
function rethrowUnique(err: unknown): never {
  if ((err as { code?: string })?.code === 'P2002') {
    throw new DepartmentError('That name or short code is already used by another department at this clinic.', 409);
  }
  throw err;
}

// --- Reading ------------------------------------------------------------------

/** Active departments for check-in, walk-in, booking, USSD and doctor signup. */
export async function listActiveDepartments(clinicId: string): Promise<DepartmentListItem[]> {
  return prisma.department.findMany({
    where: { clinicId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true, consultationFeeKes: true },
  });
}

export async function findActiveDepartment(departmentId: string, clinicId: string): Promise<DepartmentListItem | null> {
  return prisma.department.findFirst({
    where: { id: departmentId, clinicId, isActive: true },
    select: { id: true, name: true, code: true, consultationFeeKes: true },
  });
}

export interface AdminDepartmentItem extends DepartmentListItem {
  isActive: boolean;
  visitCount: number;
  doctorCount: number;
  upcomingAppointmentCount: number;
  /** Never used anywhere — the only case where it can be deleted rather than deactivated. */
  canDelete: boolean;
}

/** Every department (active and not) for the admin's Settings page, with how much each is used. */
export async function listDepartmentsForAdmin(clinicId: string): Promise<AdminDepartmentItem[]> {
  const now = new Date();
  const departments = await prisma.department.findMany({
    where: { clinicId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { checkIns: true, doctors: true, appointments: true, staff: true } },
      appointments: { where: { scheduledFor: { gte: now }, status: { in: ['REQUESTED', 'CONFIRMED'] } }, select: { id: true } },
    },
  });
  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    consultationFeeKes: d.consultationFeeKes,
    isActive: d.isActive,
    visitCount: d._count.checkIns,
    doctorCount: d._count.doctors,
    upcomingAppointmentCount: d.appointments.length,
    canDelete: d._count.checkIns === 0 && d._count.appointments === 0 && d._count.doctors === 0 && d._count.staff === 0,
  }));
}

// --- Registration ---------------------------------------------------------------

export interface NewDepartmentInput {
  name: string;
  code?: string | null;
  consultationFeeKes?: number | null;
}

/**
 * Validates the department list a clinic registers with and fills in any
 * missing codes: at least one, names unique (ignoring case), codes unique.
 */
export function prepareDepartmentList(inputs: NewDepartmentInput[]): { name: string; nameKey: string; code: string; consultationFeeKes: number | null }[] {
  if (inputs.length === 0) throw new DepartmentError('Add at least one department');
  if (inputs.length > MAX_DEPARTMENTS_PER_CLINIC) throw new DepartmentError(`A clinic can have at most ${MAX_DEPARTMENTS_PER_CLINIC} departments`);

  const names = new Set<string>();
  const codes = new Set<string>();
  // Codes the admin typed are reserved first, so a suggestion never takes one.
  for (const input of inputs) {
    if (input.code?.trim()) {
      const code = normaliseDepartmentCode(input.code);
      assertValidCode(code);
      if (codes.has(code)) throw new DepartmentError(`The short code ${code} is used twice. Each department needs its own.`);
      codes.add(code);
    }
  }
  return inputs.map((input) => {
    const name = cleanDepartmentName(input.name);
    assertValidName(name);
    const nameKey = departmentNameKey(name);
    if (names.has(nameKey)) throw new DepartmentError(`"${name}" is listed twice. Each department needs a different name.`);
    names.add(nameKey);
    assertValidFee(input.consultationFeeKes);
    let code = input.code?.trim() ? normaliseDepartmentCode(input.code) : '';
    if (!code) {
      code = suggestDepartmentCode(name, codes);
      codes.add(code);
    }
    return { name, nameKey, code, consultationFeeKes: input.consultationFeeKes ?? null };
  });
}

// --- Settings: add, edit, (de)activate, delete ------------------------------------

export async function createDepartment(input: NewDepartmentInput & { clinicId: string; staffId: string }): Promise<DepartmentListItem> {
  const existing = await prisma.department.findMany({ where: { clinicId: input.clinicId }, select: { nameKey: true, code: true } });
  if (existing.length >= MAX_DEPARTMENTS_PER_CLINIC) {
    throw new DepartmentError(`A clinic can have at most ${MAX_DEPARTMENTS_PER_CLINIC} departments`);
  }
  const name = cleanDepartmentName(input.name);
  assertValidName(name);
  const nameKey = departmentNameKey(name);
  if (existing.some((d) => d.nameKey === nameKey)) {
    throw new DepartmentError(`There is already a department called "${name}". Reactivate it instead of adding it again.`, 409);
  }
  assertValidFee(input.consultationFeeKes);
  let code = input.code?.trim() ? normaliseDepartmentCode(input.code) : suggestDepartmentCode(name, existing.map((d) => d.code));
  assertValidCode(code);
  if (existing.some((d) => d.code === code)) throw new DepartmentError(`The short code ${code} is already used by another department.`, 409);
  code = normaliseDepartmentCode(code);

  const created = await prisma.department
    .create({ data: { clinicId: input.clinicId, name, nameKey, code, consultationFeeKes: input.consultationFeeKes ?? null } })
    .catch(rethrowUnique);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'DEPARTMENT_CREATED',
    entityType: 'Department',
    entityId: created.id,
    metadata: { name, code, consultationFeeKes: created.consultationFeeKes },
  });
  return { id: created.id, name: created.name, code: created.code, consultationFeeKes: created.consultationFeeKes };
}

export interface DepartmentPatch {
  name?: string;
  code?: string;
  consultationFeeKes?: number | null;
  isActive?: boolean;
}

export async function updateDepartment(input: {
  departmentId: string;
  clinicId: string;
  staffId: string;
  patch: DepartmentPatch;
}): Promise<DepartmentListItem & { isActive: boolean }> {
  const department = await prisma.department.findFirst({ where: { id: input.departmentId, clinicId: input.clinicId } });
  if (!department) throw new DepartmentError('Department not found', 404);
  const { patch } = input;
  const data: Prisma.DepartmentUpdateInput = {};

  if (patch.name !== undefined) {
    const name = cleanDepartmentName(patch.name);
    assertValidName(name);
    const nameKey = departmentNameKey(name);
    const clash = await prisma.department.findFirst({ where: { clinicId: input.clinicId, nameKey, NOT: { id: department.id } } });
    if (clash) throw new DepartmentError(`There is already a department called "${clash.name}".`, 409);
    data.name = name;
    data.nameKey = nameKey;
  }
  if (patch.code !== undefined) {
    const code = normaliseDepartmentCode(patch.code);
    assertValidCode(code);
    const clash = await prisma.department.findFirst({ where: { clinicId: input.clinicId, code, NOT: { id: department.id } } });
    if (clash) throw new DepartmentError(`The short code ${code} is already used by ${clash.name}.`, 409);
    data.code = code;
  }
  if (patch.consultationFeeKes !== undefined) {
    assertValidFee(patch.consultationFeeKes);
    data.consultationFeeKes = patch.consultationFeeKes;
  }
  if (patch.isActive === false && department.isActive) {
    const otherActive = await prisma.department.count({ where: { clinicId: input.clinicId, isActive: true, NOT: { id: department.id } } });
    if (otherActive === 0) {
      throw new DepartmentError('A clinic needs at least one active department, so this one can’t be deactivated.', 409);
    }
    data.isActive = false;
  }
  if (patch.isActive === true) data.isActive = true;

  const updated = await prisma.department.update({ where: { id: department.id }, data }).catch(rethrowUnique);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: patch.isActive === false ? 'DEPARTMENT_DEACTIVATED' : patch.isActive === true ? 'DEPARTMENT_REACTIVATED' : 'DEPARTMENT_UPDATED',
    entityType: 'Department',
    entityId: department.id,
    metadata: { before: { name: department.name, code: department.code, consultationFeeKes: department.consultationFeeKes, isActive: department.isActive }, patch },
  });
  return { id: updated.id, name: updated.name, code: updated.code, consultationFeeKes: updated.consultationFeeKes, isActive: updated.isActive };
}

/** Only a department that has never been used can be deleted; anything with history is deactivated instead. */
export async function deleteDepartment(input: { departmentId: string; clinicId: string; staffId: string }): Promise<void> {
  const [department] = await listDepartmentsForAdmin(input.clinicId).then((all) => all.filter((d) => d.id === input.departmentId));
  if (!department) throw new DepartmentError('Department not found', 404);
  if (!department.canDelete) {
    throw new DepartmentError('This department has visits, appointments or doctors, so it can only be deactivated — that keeps its history.', 409);
  }
  if (department.isActive) {
    const otherActive = await prisma.department.count({ where: { clinicId: input.clinicId, isActive: true, NOT: { id: department.id } } });
    if (otherActive === 0) throw new DepartmentError('A clinic needs at least one active department.', 409);
  }
  await prisma.department.delete({ where: { id: department.id } });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'DEPARTMENT_DELETED',
    entityType: 'Department',
    entityId: department.id,
    metadata: { name: department.name, code: department.code },
  });
}

// --- Doctors ------------------------------------------------------------------

/** The departments a doctor works in — read fresh on every request so an admin's change applies immediately. */
export async function getDoctorDepartmentIds(staffId: string, db: Db = prisma): Promise<string[]> {
  const links = await db.staffDepartment.findMany({ where: { staffId }, select: { departmentId: true } });
  return links.map((l) => l.departmentId);
}

/** Admin: sets the departments a doctor works in (at least one, all active, all at this clinic). */
export async function setDoctorDepartments(input: {
  doctorId: string;
  clinicId: string;
  departmentIds: string[];
  staffId: string;
}): Promise<{ id: string; name: string }[]> {
  const ids = [...new Set(input.departmentIds)];
  if (ids.length === 0) throw new DepartmentError('A doctor needs at least one department');
  const doctor = await prisma.staff.findFirst({ where: { id: input.doctorId, clinicId: input.clinicId, role: 'DOCTOR' } });
  if (!doctor) throw new DepartmentError('Doctor not found', 404);
  const departments = await prisma.department.findMany({
    where: { id: { in: ids }, clinicId: input.clinicId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (departments.length !== ids.length) throw new DepartmentError('Choose active departments from this clinic');

  const before = await getDoctorDepartmentIds(doctor.id);
  await prisma.$transaction(async (tx) => {
    await tx.staffDepartment.deleteMany({ where: { staffId: doctor.id, departmentId: { notIn: ids } } });
    await tx.staffDepartment.createMany({ data: ids.map((departmentId) => ({ staffId: doctor.id, departmentId })), skipDuplicates: true });
    // Keep the doctor's "home" department one they actually still work in.
    if (!doctor.departmentId || !ids.includes(doctor.departmentId)) {
      await tx.staff.update({ where: { id: doctor.id }, data: { departmentId: ids[0] } });
    }
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'DOCTOR_DEPARTMENTS_SET',
    entityType: 'Staff',
    entityId: doctor.id,
    metadata: { before, after: ids },
  });
  return departments;
}
