import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { parseDiagnosisCodes } from '../services/icd11Service';
import { ProblemRecord, VisitRecord } from './mappers';

/**
 * Loads visits (encounters) with everything the FHIR mappers need, oldest
 * first. Used by the FHIR interface ($everything) and by the HIE Shared
 * Health Record sender.
 */
export async function loadVisitRecords(where: Prisma.EncounterWhereInput) {
  const encounters = await prisma.encounter.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      clinic: { select: { id: true, name: true, county: true } },
      checkIn: { select: { department: { select: { name: true } } } },
      consultedByStaff: { select: { id: true, name: true, staffCode: true } },
      assignedDoctor: { select: { id: true, name: true, staffCode: true } },
      prescriptionItems: { orderBy: { position: 'asc' } },
      labOrders: {
        orderBy: { requestedAt: 'asc' },
        include: { items: { orderBy: { position: 'asc' } }, requestedByStaff: { select: { id: true, name: true, staffCode: true } } },
      },
      serviceOrders: { orderBy: { requestedAt: 'asc' } },
      vitalSigns: { orderBy: { recordedAt: 'asc' } },
    },
  });
  const orderStaffIds = [...new Set(encounters.flatMap((e) => e.serviceOrders.map((o) => o.requestedByStaffId)))];
  const orderStaff = new Map(
    (orderStaffIds.length ? await prisma.staff.findMany({ where: { id: { in: orderStaffIds } }, select: { id: true, name: true, staffCode: true } }) : []).map((s) => [s.id, s]),
  );
  return encounters.map((e) => {
    const visit: VisitRecord = {
      id: e.id,
      status: e.status,
      createdAt: e.createdAt,
      checkedOutAt: e.checkedOutAt,
      consultedAt: e.consultedAt,
      visitReason: e.visitReason,
      diagnosis: e.diagnosis,
      diagnosisCodes: parseDiagnosisCodes(e.diagnosisCodes),
      prescription: e.prescription,
      prescriptionItems: e.prescriptionItems,
      clinicId: e.clinicId,
      departmentName: e.checkIn.department.name,
      doctor: e.consultedByStaff ?? e.assignedDoctor,
      labOrders: e.labOrders.map((o) => ({
        id: o.id,
        status: o.status,
        requestedAt: o.requestedAt,
        requestedBy: o.requestedByStaff,
        noteForLab: o.noteForLab,
        completedAt: o.completedAt,
        items: o.items,
      })),
      vitalSigns: e.vitalSigns,
      serviceOrders: e.serviceOrders.map((o) => ({
        id: o.id,
        category: o.category,
        description: o.orderDescription,
        note: o.orderNote,
        urgent: o.urgent,
        status: o.status,
        requestedAt: o.requestedAt,
        requestedBy: orderStaff.get(o.requestedByStaffId) ?? { id: o.requestedByStaffId, name: 'Clinician', staffCode: '' },
      })),
    };
    return { visit, clinic: e.clinic };
  });
}

/** Problem-list entries recorded at this clinic, for FHIR. */
export async function loadProblemRecords(patientId: string, clinicId: string): Promise<ProblemRecord[]> {
  const rows = await prisma.patientProblem.findMany({ where: { patientId, clinicId }, orderBy: { recordedAt: 'asc' } });
  const staff = rows.length ? await prisma.staff.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordedByStaffId))] } }, select: { id: true, name: true, staffCode: true } }) : [];
  const byId = new Map(staff.map((s) => [s.id, s]));
  return rows.map((r) => ({
    id: r.id,
    icd11Code: r.icd11Code,
    title: r.problemTitle,
    note: r.problemNote,
    status: r.status,
    onsetDate: r.onsetDate,
    recordedAt: r.recordedAt,
    recordedBy: byId.get(r.recordedByStaffId) ?? { id: r.recordedByStaffId, name: 'Clinician', staffCode: '' },
  }));
}
