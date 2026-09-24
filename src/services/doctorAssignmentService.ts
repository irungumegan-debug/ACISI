import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { getDoctorPresenceStatus } from './staffService';

/**
 * Decides which doctor a newly-WAITING check-in is routed to, per the
 * automatic-assignment rule: only consider doctors marked in today (see
 * staffService.getDoctorPresenceStatus) — a doctor who's out, sick, or
 * simply hasn't logged in yet must never receive a new assignment, even if
 * they'd otherwise look "free." Among those present, prefer a free doctor
 * (nobody currently IN_CONSULTATION); if none are free, prefer whoever has
 * the shortest WAITING queue. Ties are broken by staffCode order, since
 * there's no meaningful business rule for picking among equally-loaded
 * doctors.
 *
 * Returns null when the department has no active doctors registered, or has
 * some but none of them are in today — both cases leave the encounter
 * unassigned rather than erroring, so neither an incomplete clinic
 * onboarding nor an empty department on a given day blocks check-ins.
 */
export async function assignDoctorForCheckIn(clinicId: string, departmentId: string): Promise<string | null> {
  const allDoctors = await prisma.staff.findMany({
    where: { clinicId, departmentId, role: 'DOCTOR', isActive: true },
    orderBy: { staffCode: 'asc' },
    select: { id: true, lastLoginAt: true, presenceOverride: true, presenceOverrideAt: true },
  });

  if (allDoctors.length === 0) {
    logger.warn(
      { clinicId, departmentId },
      'No active doctors registered in this department — check-in left unassigned. This usually means clinic onboarding is incomplete.',
    );
    return null;
  }

  const doctors = allDoctors.filter((d) => getDoctorPresenceStatus(d) === 'IN');

  if (doctors.length === 0) {
    logger.warn(
      { clinicId, departmentId },
      'This department has doctors registered, but none are marked in today — check-in left unassigned.',
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
