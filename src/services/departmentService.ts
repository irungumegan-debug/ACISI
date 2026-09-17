import { prisma } from '../db/prisma';

export interface DepartmentListItem {
  id: string;
  name: string;
}

/**
 * All active departments, ordered for the USSD/web check-in selection menu.
 * Same "fetch in full, paginate in-memory" approach as listActiveClinics —
 * fine at MVP scale, and it's the same canonical list both channels and the
 * staff dashboard's queue filter read from.
 */
export async function listActiveDepartments(): Promise<DepartmentListItem[]> {
  return prisma.department.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/** Used by the patient portal's web check-in to validate a departmentId before it's stored on a CheckIn. */
export async function getActiveDepartmentById(id: string): Promise<DepartmentListItem | null> {
  return prisma.department.findFirst({ where: { id, isActive: true }, select: { id: true, name: true } });
}
