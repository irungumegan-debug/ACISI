import dayjs from 'dayjs';
import { ConsultationStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { enqueueVisitSummarySms } from '../jobs/queue';

export class EncounterNotFoundError extends Error {
  constructor(encounterId: string) {
    super(`No encounter "${encounterId}" found for this clinic`);
    this.name = 'EncounterNotFoundError';
  }
}

export class InvalidConsultationTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConsultationTransitionError';
  }
}

interface StaffActor {
  staffId: string;
  clinicId: string;
}

export interface QueueItem {
  encounterId: string;
  patientId: string;
  patientName: string;
  phoneNumber: string;
  departmentId: string | null;
  departmentName: string;
  channel: string;
  consultationStatus: ConsultationStatus;
  checkInTime: Date;
  prescription: string | null;
  notes: string | null;
}

/**
 * Today's queue for a clinic, scoped by clinicId (never a global query) —
 * same authorization posture as the rest of the dashboard: a clinic only
 * ever sees its own check-ins. Encounter is the anchor (not CheckIn)
 * because it's what carries the consultation workflow.
 */
export async function listTodayQueue(clinicId: string, departmentId?: string): Promise<QueueItem[]> {
  const startOfToday = dayjs().startOf('day').toDate();

  const encounters = await prisma.encounter.findMany({
    where: {
      clinicId,
      createdAt: { gte: startOfToday },
      ...(departmentId ? { checkIn: { departmentId } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      patient: { select: { firstName: true, lastName: true, phoneNumber: true } },
      checkIn: { select: { departmentId: true, channel: true, paidAt: true, department: { select: { name: true } } } },
    },
  });

  return encounters.map((e) => ({
    encounterId: e.id,
    patientId: e.patientId,
    patientName: `${e.patient.firstName} ${e.patient.lastName}`,
    phoneNumber: e.patient.phoneNumber,
    departmentId: e.checkIn.departmentId,
    departmentName: e.checkIn.department?.name ?? 'General',
    channel: e.checkIn.channel,
    consultationStatus: e.consultationStatus,
    checkInTime: e.checkIn.paidAt ?? e.createdAt,
    prescription: e.prescription,
    notes: e.notes,
  }));
}

async function loadClinicScopedEncounter(encounterId: string, clinicId: string) {
  const encounter = await prisma.encounter.findFirst({ where: { id: encounterId, clinicId } });
  if (!encounter) {
    throw new EncounterNotFoundError(encounterId);
  }
  return encounter;
}

export async function startConsultation(encounterId: string, actor: StaffActor) {
  const encounter = await loadClinicScopedEncounter(encounterId, actor.clinicId);

  if (encounter.consultationStatus !== 'WAITING') {
    throw new InvalidConsultationTransitionError(
      `Cannot start a consultation that is already ${encounter.consultationStatus}`,
    );
  }

  const updated = await prisma.encounter.update({
    where: { id: encounter.id },
    data: { consultationStatus: 'IN_CONSULTATION', consultationStartedAt: new Date() },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: actor.staffId,
    staffId: actor.staffId,
    action: 'CONSULTATION_STARTED',
    entityType: 'Encounter',
    entityId: encounter.id,
  });

  return updated;
}

interface CheckoutInput {
  notes?: string;
  prescription?: string;
}

/**
 * Completes a consultation: saves notes/prescription to the visit record,
 * marks it DONE, and enqueues the checkout SMS. Callable from WAITING too
 * (not just IN_CONSULTATION) — staff sometimes check a patient out without
 * having pressed "Start consultation" first, and there's no clinical reason
 * to block that.
 */
export async function completeConsultation(encounterId: string, actor: StaffActor, input: CheckoutInput) {
  const encounter = await loadClinicScopedEncounter(encounterId, actor.clinicId);

  if (encounter.consultationStatus === 'DONE') {
    throw new InvalidConsultationTransitionError('This consultation has already been completed');
  }

  const updated = await prisma.encounter.update({
    where: { id: encounter.id },
    data: {
      consultationStatus: 'DONE',
      completedAt: new Date(),
      notes: input.notes,
      prescription: input.prescription,
    },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: actor.staffId,
    staffId: actor.staffId,
    action: 'CONSULTATION_COMPLETED',
    entityType: 'Encounter',
    entityId: encounter.id,
  });

  await enqueueVisitSummarySms({ encounterId: updated.id });

  return updated;
}
