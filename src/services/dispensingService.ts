import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { dhaDisplay } from './dhaTerminology';
import { formatPrescriptionLine, rowToLine } from './prescriptionService';

/**
 * Dispensing at checkout: for each prescribed medicine, front desk records
 * whether the clinic gave it (and how much) or the patient will buy it
 * elsewhere. Recorded once per medicine; a mistake is corrected by recording
 * again (the latest answer counts, and every change is audit-logged).
 * Sent as FHIR MedicationDispense.
 */

export class DispensingError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'DispensingError';
  }
}

export interface DispenseLine {
  id: string;
  text: string;
  prescribedQuantity: number | null;
  unit: string | null;
  dispenseStatus: 'DISPENSED' | 'NOT_DISPENSED' | null;
  dispensedQuantity: number | null;
  dispensedAt: Date | null;
}

export async function listDispensing(encounterId: string, clinicId: string): Promise<DispenseLine[]> {
  const encounter = await prisma.encounter.findFirst({ where: { id: encounterId, clinicId }, select: { id: true } });
  if (!encounter) throw new DispensingError('Visit not found', 404);
  const items = await prisma.prescriptionItem.findMany({ where: { encounterId }, orderBy: { position: 'asc' } });
  return items.map((i) => {
    const unitCode = i.quantityUnit ?? i.doseUnit;
    return {
      id: i.id,
      text: formatPrescriptionLine(rowToLine(i)),
      prescribedQuantity: i.quantity,
      unit: dhaDisplay('units', unitCode) ?? unitCode,
      dispenseStatus: (i.dispenseStatus as DispenseLine['dispenseStatus']) ?? null,
      dispensedQuantity: i.dispensedQuantity,
      dispensedAt: i.dispensedAt,
    };
  });
}

export async function recordDispensing(input: {
  encounterId: string;
  itemId: string;
  clinicId: string;
  staffId: string;
  status: 'DISPENSED' | 'NOT_DISPENSED';
  quantity?: number | null;
}): Promise<DispenseLine[]> {
  const item = await prisma.prescriptionItem.findFirst({ where: { id: input.itemId, encounterId: input.encounterId, encounter: { clinicId: input.clinicId } } });
  if (!item) throw new DispensingError('Medicine not found on this visit', 404);
  let quantity: number | null = null;
  if (input.status === 'DISPENSED') {
    quantity = input.quantity ?? item.quantity ?? null;
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) throw new DispensingError('Enter how much was given');
  }
  await prisma.prescriptionItem.update({
    where: { id: item.id },
    data: { dispenseStatus: input.status, dispensedQuantity: quantity, dispensedAt: new Date(), dispensedByStaffId: input.staffId },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: input.status === 'DISPENSED' ? 'MEDICINE_DISPENSED' : 'MEDICINE_NOT_DISPENSED',
    entityType: 'PrescriptionItem',
    entityId: item.id,
    metadata: { encounterId: input.encounterId, corrected: item.dispenseStatus !== null },
  });
  return listDispensing(input.encounterId, input.clinicId);
}
