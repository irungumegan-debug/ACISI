import { prisma } from '../db/prisma';

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

/** Used by the patient portal's web check-in to validate a clinicId and get its name for the STK push description. */
export async function getActiveClinicById(id: string): Promise<ClinicListItem | null> {
  return prisma.clinic.findFirst({ where: { id, isActive: true }, select: { id: true, name: true } });
}
