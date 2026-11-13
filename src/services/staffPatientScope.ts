import { Prisma, StaffRole } from '@prisma/client';
import { doctorQueueFilter } from './doctorScope';
import { getDoctorDepartmentIds } from './departmentService';

export interface StaffScopeSession {
  clinicId: string;
  role: StaffRole | string;
  staffId: string;
}

/**
 * Which patients a staff member may see. Front desk: anyone with a check-in
 * or visit at this clinic. A doctor: only patients currently in their own
 * queue (doctorQueueFilter). Any other role: nobody. Enforced on the
 * server for every patient-facing read (patient search and page, files).
 */
export async function staffPatientScopeWhere(session: StaffScopeSession): Promise<Prisma.PatientWhereInput> {
  const { clinicId, role, staffId } = session;
  if (role === 'DOCTOR') {
    const departmentIds = await getDoctorDepartmentIds(staffId);
    return { encounters: { some: doctorQueueFilter(clinicId, departmentIds, staffId) } };
  }
  if (role === 'RECEPTIONIST' || role === 'CLINICIAN' || role === 'ADMIN') {
    return { OR: [{ checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }] };
  }
  // No match for any patient.
  return { id: { in: [] } };
}
