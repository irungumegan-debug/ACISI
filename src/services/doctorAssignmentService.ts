import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

/**
 * Decides which doctor a newly-WAITING check-in is routed to, per the
 * automatic-assignment rule: prefer a free doctor (nobody currently
 * IN_CONSULTATION); if none are free, prefer whoever has the shortest
 * WAITING queue. Ties are broken by staffCode order, since there's no
 * meaningful business rule for picking among equally-loaded doctors.
 *
 * Returns null when the department has no active doctors registered — the
 * caller leaves the encounter unassigned rather than erroring, so a clinic
 * mid-onboarding doesn't block check-ins. That's logged here as a warning
 * since it usually means a clinic hasn't finished setting up its doctors.
 */
export async function assignDoctorForCheckIn(clinicId: string, departmentId: string): Promise<string | null> {
  const doctors = await prisma.staff.findMany({
    where: { clinicId, departmentId, role: 'DOCTOR', isActive: true },
    orderBy: { staffCode: 'asc' },
    select: { id: true },
  });

  if (doctors.length === 0) {
    logger.warn(
      { clinicId, departmentId },
      'No active doctors registered in this department — check-in left unassigned. This usually means clinic onboarding is incomplete.',
    );
    return null;
  }

  if (doctors.length === 1) {
    return doctors[0]!.id;
  }

  const doctorIds = doctors.map((d) => d.id);
  const activeEncounters = await prisma.encounter.findMany({
    where: { assignedDoctorId: { in: doctorIds }, status: { in: ['WAITING', 'IN_CONSULTATION'] } },
    select: { assignedDoctorId: true, status: true },
  });

  const inConsultationCount = new Map<string, number>(doctorIds.map((id) => [id, 0]));
  const waitingCount = new Map<string, number>(doctorIds.map((id) => [id, 0]));
  for (const encounter of activeEncounters) {
    if (!encounter.assignedDoctorId) continue;
    const counts = encounter.status === 'IN_CONSULTATION' ? inConsultationCount : waitingCount;
    counts.set(encounter.assignedDoctorId, (counts.get(encounter.assignedDoctorId) ?? 0) + 1);
  }

  const freeDoctor = doctors.find((d) => inConsultationCount.get(d.id) === 0);
  if (freeDoctor) {
    return freeDoctor.id;
  }

  return doctors.reduce((leastBusy, candidate) =>
    (waitingCount.get(candidate.id) ?? 0) < (waitingCount.get(leastBusy.id) ?? 0) ? candidate : leastBusy,
  ).id;
}
