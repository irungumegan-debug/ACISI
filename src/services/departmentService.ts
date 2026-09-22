import { prisma } from '../db/prisma';

export interface DepartmentListItem {
  id: string;
  name: string;
}

export async function listActiveDepartments(clinicId: string): Promise<DepartmentListItem[]> {
  return prisma.department.findMany({
    where: { clinicId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

export async function findActiveDepartment(departmentId: string, clinicId: string): Promise<DepartmentListItem | null> {
  return prisma.department.findFirst({
    where: { id: departmentId, clinicId, isActive: true },
    select: { id: true, name: true },
  });
}
