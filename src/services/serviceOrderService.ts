import { ServiceOrder, ServiceOrderCategory } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';

/**
 * Doctor's orders besides medicines and lab tests (computerised provider
 * order entry): radiology, physiotherapy, occupational therapy, nutrition,
 * social work and counselling. The doctor places them during the
 * consultation; front desk sees them at checkout and marks each one done
 * (done here, or the patient was referred or booked). Nothing is deleted:
 * a withdrawn order stays, cancelled. Sent as FHIR ServiceRequests.
 */

export const SERVICE_ORDER_CATEGORIES: Record<ServiceOrderCategory, { label: string; snomed: { code: string; display: string } }> = {
  RADIOLOGY: { label: 'Radiology / imaging', snomed: { code: '363679005', display: 'Imaging' } },
  PHYSIOTHERAPY: { label: 'Physiotherapy', snomed: { code: '91251008', display: 'Physical therapy procedure' } },
  OCCUPATIONAL_THERAPY: { label: 'Occupational therapy', snomed: { code: '84478008', display: 'Occupational therapy' } },
  NUTRITION: { label: 'Nutrition / dietetics', snomed: { code: '61310001', display: 'Nutrition education' } },
  SOCIAL_WORK: { label: 'Social work', snomed: { code: '410606002', display: 'Social service procedure' } },
  COUNSELLING: { label: 'Counselling', snomed: { code: '409063005', display: 'Counseling' } },
};

export const SERVICE_ORDER_TEXT_MAX = 200;
export const SERVICE_ORDER_NOTE_MAX = 300;

export class ServiceOrderError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ServiceOrderError';
  }
}

export interface ServiceOrderView {
  id: string;
  category: ServiceOrderCategory;
  categoryLabel: string;
  description: string;
  note: string | null;
  urgent: boolean;
  status: ServiceOrderRow['status'];
  requestedAt: Date;
  requestedByName: string;
  closedAt: Date | null;
}

type ServiceOrderRow = ServiceOrder;

async function staffNames(ids: string[]): Promise<Map<string, string>> {
  const staff = await prisma.staff.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(staff.map((s) => [s.id, s.name]));
}

export async function listServiceOrders(encounterId: string): Promise<ServiceOrderView[]> {
  const rows = await prisma.serviceOrder.findMany({ where: { encounterId }, orderBy: { requestedAt: 'asc' } });
  const names = await staffNames(rows.map((r) => r.requestedByStaffId));
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    categoryLabel: SERVICE_ORDER_CATEGORIES[r.category].label,
    description: r.orderDescription,
    note: r.orderNote,
    urgent: r.urgent,
    status: r.status,
    requestedAt: r.requestedAt,
    requestedByName: names.get(r.requestedByStaffId) ?? 'Doctor',
    closedAt: r.closedAt,
  }));
}

/** Doctor, during the consultation (the visit must still be in their queue, checked by the route). */
export async function createServiceOrder(input: {
  encounterId: string;
  clinicId: string;
  staffId: string;
  category: ServiceOrderCategory;
  description: string;
  note?: string | null;
  urgent?: boolean;
}): Promise<ServiceOrderView[]> {
  const description = input.description.trim();
  const note = input.note?.trim() || null;
  if (!description) throw new ServiceOrderError('Say what is ordered (e.g. "Chest X-ray PA")');
  if (description.length > SERVICE_ORDER_TEXT_MAX) throw new ServiceOrderError(`Keep the order under ${SERVICE_ORDER_TEXT_MAX} characters`);
  if (note && note.length > SERVICE_ORDER_NOTE_MAX) throw new ServiceOrderError(`Keep the note under ${SERVICE_ORDER_NOTE_MAX} characters`);
  const encounter = await prisma.encounter.findFirst({ where: { id: input.encounterId, clinicId: input.clinicId }, select: { id: true, patientId: true, status: true } });
  if (!encounter) throw new ServiceOrderError('Visit not found', 404);
  if (encounter.status !== 'WAITING' && encounter.status !== 'IN_CONSULTATION') throw new ServiceOrderError('Orders are added before the consultation is signed', 409);
  const order = await prisma.serviceOrder.create({
    data: {
      encounterId: encounter.id,
      clinicId: input.clinicId,
      patientId: encounter.patientId,
      category: input.category,
      orderDescription: description,
      orderNote: note,
      urgent: Boolean(input.urgent),
      requestedByStaffId: input.staffId,
    },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'SERVICE_ORDER_CREATED',
    entityType: 'ServiceOrder',
    entityId: order.id,
    metadata: { encounterId: encounter.id, category: input.category, urgent: order.urgent },
  });
  return listServiceOrders(encounter.id);
}

/**
 * Close an order: the doctor withdraws it before signing ('CANCELLED'), or
 * front desk marks it done or not needed after the consultation.
 */
export async function closeServiceOrder(input: {
  orderId: string;
  encounterId: string;
  clinicId: string;
  staffId: string;
  outcome: 'DONE' | 'CANCELLED';
}): Promise<ServiceOrderView[]> {
  const order = await prisma.serviceOrder.findFirst({ where: { id: input.orderId, encounterId: input.encounterId, clinicId: input.clinicId } });
  if (!order) throw new ServiceOrderError('Order not found', 404);
  // Conditional: two screens can't both close it.
  const moved = await prisma.serviceOrder.updateMany({
    where: { id: order.id, status: 'REQUESTED' },
    data: { status: input.outcome, closedByStaffId: input.staffId, closedAt: new Date() },
  });
  if (moved.count === 0) throw new ServiceOrderError('This order is already closed', 409);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: input.outcome === 'DONE' ? 'SERVICE_ORDER_DONE' : 'SERVICE_ORDER_CANCELLED',
    entityType: 'ServiceOrder',
    entityId: order.id,
    metadata: { encounterId: order.encounterId, category: order.category },
  });
  return listServiceOrders(order.encounterId);
}
