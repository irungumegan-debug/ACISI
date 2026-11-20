import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { parseDiagnosisCodes } from '../services/icd11Service';
import { VisitRecord } from './mappers';

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
    },
  });
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
    };
    return { visit, clinic: e.clinic };
  });
}
