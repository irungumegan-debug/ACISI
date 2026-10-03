import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { getDoctorPresenceStatus } from './staffService';
import { publishQueueChanged } from './realtimeEvents';

/**
 * Front desk's "Change doctor": moves a still-WAITING patient from the doctor
 * ACISI picked automatically (doctorAssignmentService) to another doctor in
 * the same department who is in today. Never touches a patient who is
 * already with a doctor or further along.
 */

export class ReassignError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 409,
  ) {
    super(message);
    this.name = 'ReassignError';
  }
}

export interface DoctorOption {
  id: string;
  name: string;
  /** Patients currently waiting for this doctor. */
  waitingCount: number;
  /** Whether they're with a patient right now. */
  inConsultation: boolean;
}

async function findWaitingVisit(checkInId: string, clinicId: string) {
  const encounter = await prisma.encounter.findFirst({
    where: { checkInId, clinicId },
    select: { id: true, status: true, assignedDoctorId: true, checkIn: { select: { departmentId: true } } },
  });
  if (!encounter) throw new ReassignError('Visit not found', 404);
  if (encounter.status !== 'WAITING') {
    throw new ReassignError('Only a patient who is still waiting can be moved to another doctor.', 409);
  }
  return encounter;
}

/** The doctors this waiting patient could be moved to: same department, active, in today. */
export async function listDoctorOptions(
  checkInId: string,
  clinicId: string,
): Promise<{ currentDoctorId: string | null; doctors: DoctorOption[] }> {
  const encounter = await findWaitingVisit(checkInId, clinicId);
  const staff = await prisma.staff.findMany({
    where: { clinicId, role: 'DOCTOR', isActive: true, departments: { some: { departmentId: encounter.checkIn.departmentId } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, lastLoginAt: true, presenceOverride: true, presenceOverrideAt: true },
  });
  const present = staff.filter((d) => getDoctorPresenceStatus(d) === 'IN');
  const active = present.length
    ? await prisma.encounter.findMany({
        where: { assignedDoctorId: { in: present.map((d) => d.id) }, status: { in: ['WAITING', 'IN_CONSULTATION'] } },
        select: { assignedDoctorId: true, status: true },
      })
    : [];

  return {
    currentDoctorId: encounter.assignedDoctorId,
    doctors: present.map((d) => ({
      id: d.id,
      name: d.name,
      waitingCount: active.filter((e) => e.assignedDoctorId === d.id && e.status === 'WAITING').length,
      inConsultation: active.some((e) => e.assignedDoctorId === d.id && e.status === 'IN_CONSULTATION'),
    })),
  };
}

/** Moves the waiting patient to `doctorId`. A no-op if they're already with that doctor. */
export async function changeDoctor(input: {
  checkInId: string;
  clinicId: string;
  doctorId: string;
  staffId: string;
}): Promise<{ changed: boolean; doctorName: string }> {
  const encounter = await findWaitingVisit(input.checkInId, input.clinicId);

  const doctor = await prisma.staff.findFirst({
    where: { id: input.doctorId, clinicId: input.clinicId, role: 'DOCTOR', isActive: true },
    select: {
      id: true,
      name: true,
      lastLoginAt: true,
      presenceOverride: true,
      presenceOverrideAt: true,
      departments: { select: { departmentId: true } },
    },
  });
  if (!doctor || !doctor.departments.some((d) => d.departmentId === encounter.checkIn.departmentId)) {
    throw new ReassignError('That doctor is not in this patient’s department.', 409);
  }
  if (getDoctorPresenceStatus(doctor) !== 'IN') {
    throw new ReassignError(`${doctor.name} is not marked in today, so they can’t take new patients.`, 409);
  }
  if (encounter.assignedDoctorId === doctor.id) return { changed: false, doctorName: doctor.name };

  // Only while still WAITING: if the doctor opened the patient a moment ago, nothing moves.
  const moved = await prisma.encounter.updateMany({
    where: { id: encounter.id, status: 'WAITING' },
    data: { assignedDoctorId: doctor.id },
  });
  if (moved.count === 0) {
    throw new ReassignError('This patient has just gone in to see a doctor, so they can’t be moved now.', 409);
  }

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'ENCOUNTER_DOCTOR_CHANGED',
    entityType: 'Encounter',
    entityId: encounter.id,
    metadata: { fromDoctorId: encounter.assignedDoctorId, toDoctorId: doctor.id },
  });
  publishQueueChanged({ checkInId: input.checkInId, clinicId: input.clinicId });
  return { changed: true, doctorName: doctor.name };
}
