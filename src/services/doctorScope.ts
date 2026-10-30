import { Prisma } from '@prisma/client';

/**
 * The one definition of "currently in this doctor's queue": at their clinic,
 * waiting or in consultation, in one of their departments, and assigned to
 * them or to nobody. Every doctor-facing read of a patient goes through this
 * (queue, visit page, patient search and patient page), so a doctor can
 * never reach a patient outside it.
 */
export function doctorQueueFilter(clinicId: string, departmentIds: string[], staffId: string): Prisma.EncounterWhereInput {
  return {
    clinicId,
    status: { in: ['WAITING', 'IN_CONSULTATION'] },
    checkIn: { departmentId: { in: departmentIds } },
    OR: [{ assignedDoctorId: staffId }, { assignedDoctorId: null }],
  };
}
