import { Encounter, EncounterStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { getScopedHistory, ScopedHistoryEntry } from './patientService';
import { comparePin, findActiveStaffById } from './staffService';
import { emailConfigured } from '../config/email';
import { enqueueVisitSummaryEmail, enqueueVisitSummarySms } from '../jobs/queue';
import { logger } from '../utils/logger';

export type CheckoutDeliveryMethod = 'sms' | 'sms_and_email';

export interface DoctorQueueItem {
  encounterId: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  phoneNumber: string;
  status: EncounterStatus;
  waitingSince: Date;
}

/**
 * A doctor's queue is scoped to their own clinic AND their own department —
 * never another department's or another clinic's patients, and never a
 * general lookup. Only WAITING/IN_CONSULTATION show up here; once a
 * consultation is submitted the encounter moves to READY_FOR_CHECKOUT and
 * drops off (it's front desk's queue from there).
 *
 * Further narrowed to this doctor's own assigned patients (see
 * doctorAssignmentService) — this is a real filter, not just a display
 * grouping, since the whole point of assignment is that each doctor works
 * their own queue rather than the whole department's. Unassigned encounters
 * (assignedDoctorId null — the department had no active doctors at
 * check-in time) still show up for every doctor in the department, same as
 * behavior before assignment existed.
 */
export async function getDoctorQueue(clinicId: string, departmentId: string, staffId: string): Promise<DoctorQueueItem[]> {
  const encounters = await prisma.encounter.findMany({
    where: {
      clinicId,
      status: { in: ['WAITING', 'IN_CONSULTATION'] },
      checkIn: { departmentId },
      OR: [{ assignedDoctorId: staffId }, { assignedDoctorId: null }],
    },
    include: { patient: true },
    orderBy: { createdAt: 'asc' },
  });

  return encounters.map((e) => ({
    encounterId: e.id,
    patientId: e.patientId,
    patientName: `${e.patient.firstName} ${e.patient.lastName}`,
    patientCode: e.patient.patientCode,
    phoneNumber: e.patient.phoneNumber,
    status: e.status,
    waitingSince: e.createdAt,
  }));
}

/** Thrown whenever an encounter doesn't belong to the requesting doctor's own clinic+department — never distinguished from "doesn't exist" in the HTTP response, so a doctor can't probe for other clinics' patient IDs. */
export class EncounterNotAccessibleError extends Error {
  constructor() {
    super('Patient not found in your queue');
    this.name = 'EncounterNotAccessibleError';
  }
}

export interface EncounterDetail {
  encounterId: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  phoneNumber: string;
  status: EncounterStatus;
  history: ScopedHistoryEntry[];
  /** True when the patient has encounters at other clinics that exist but aren't shown, because they haven't consented to cross-clinic sharing. */
  hasHiddenHistoryElsewhere: boolean;
}

async function assertEncounterInDoctorQueue(encounterId: string, clinicId: string, departmentId: string, staffId: string): Promise<Encounter> {
  const encounter = await prisma.encounter.findFirst({
    where: {
      id: encounterId,
      clinicId,
      checkIn: { departmentId },
      OR: [{ assignedDoctorId: staffId }, { assignedDoctorId: null }],
    },
  });
  if (!encounter) {
    throw new EncounterNotAccessibleError();
  }
  return encounter;
}

/**
 * Opening a patient from the doctor's queue: moves WAITING -> IN_CONSULTATION,
 * logs the access (every history view gets an audit row, per the Data
 * Protection Act posture elsewhere in this codebase), and assembles their
 * visit history — this clinic's own encounters always visible, other
 * clinics' encounters only if the patient consented to cross-clinic sharing,
 * otherwise just a flag that hidden history exists.
 */
export async function getEncounterForDoctor(
  encounterId: string,
  clinicId: string,
  departmentId: string,
  viewingStaffId: string,
): Promise<EncounterDetail> {
  const encounter = await assertEncounterInDoctorQueue(encounterId, clinicId, departmentId, viewingStaffId);

  const currentStatus: EncounterStatus = encounter.status === 'WAITING' ? 'IN_CONSULTATION' : encounter.status;
  if (encounter.status === 'WAITING') {
    await prisma.encounter.update({ where: { id: encounter.id }, data: { status: 'IN_CONSULTATION' } });
  }

  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: encounter.patientId } });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: viewingStaffId,
    staffId: viewingStaffId,
    action: 'PATIENT_HISTORY_VIEWED',
    entityType: 'Patient',
    entityId: encounter.patientId,
    metadata: { viewedByClinicId: clinicId, channel: 'DOCTOR_DASHBOARD', encounterId: encounter.id },
  });

  const { history, hasHiddenHistoryElsewhere } = await getScopedHistory(encounter.patientId, clinicId, encounter.id);

  return {
    encounterId: encounter.id,
    patientId: patient.id,
    patientCode: patient.patientCode,
    patientName: `${patient.firstName} ${patient.lastName}`,
    phoneNumber: patient.phoneNumber,
    status: currentStatus,
    history,
    hasHiddenHistoryElsewhere,
  };
}

export class EncounterNotConsultableError extends Error {
  constructor() {
    super('This patient is not currently awaiting consultation');
    this.name = 'EncounterNotConsultableError';
  }
}

export class InvalidPinError extends Error {
  constructor() {
    super('Incorrect PIN. Please try again.');
    this.name = 'InvalidPinError';
  }
}

interface SubmitConsultationInput {
  encounterId: string;
  clinicId: string;
  departmentId: string;
  staffId: string;
  diagnosis: string;
  prescription: string;
  /**
   * The doctor's own PIN, re-entered as the actual act of signing — the
   * same mechanism as login (staffService.comparePin), just triggered here
   * too. This is the real gate: nothing below is persisted unless this
   * matches, so consultedAt (set only on success) doubles as the signing
   * timestamp with no separate column needed.
   */
  pin: string;
}

/**
 * Submitting the consultation form is the doctor's signing moment, not a
 * separate step bolted on afterward: it moves the encounter to
 * READY_FOR_CHECKOUT only once their re-entered PIN is confirmed. Never
 * marks the visit done or sends the SMS itself — that stays a front-desk
 * action (encounterService.checkoutEncounter).
 */
export async function submitConsultation(input: SubmitConsultationInput): Promise<Encounter> {
  const encounter = await assertEncounterInDoctorQueue(input.encounterId, input.clinicId, input.departmentId, input.staffId);

  if (encounter.status !== 'WAITING' && encounter.status !== 'IN_CONSULTATION') {
    throw new EncounterNotConsultableError();
  }

  const staff = await findActiveStaffById(input.staffId);
  const pinValid = staff ? await comparePin(staff, input.pin) : false;

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: pinValid ? 'CONSULTATION_SIGNED' : 'CONSULTATION_SIGN_FAILED',
    entityType: 'Encounter',
    entityId: encounter.id,
  });

  if (!pinValid) {
    throw new InvalidPinError();
  }

  const updated = await prisma.encounter.update({
    where: { id: encounter.id },
    data: {
      status: 'READY_FOR_CHECKOUT',
      diagnosis: input.diagnosis,
      prescription: input.prescription,
      consultedByStaffId: input.staffId,
      consultedAt: new Date(),
    },
  });

  return updated;
}

export class EncounterNotReadyForCheckoutError extends Error {
  constructor() {
    super('This visit is not ready for checkout yet');
    this.name = 'EncounterNotReadyForCheckoutError';
  }
}

/**
 * Front-desk-only action: completes the visit and triggers the visit
 * summary. Deliberately separate from the doctor's consultation submission
 * — a doctor finishing a consult never checks a patient out or sends
 * anything by itself.
 *
 * The SMS summary is unconditional — it fires exactly as it always has,
 * regardless of deliveryMethod. Email is strictly additive: only enqueued
 * when staff explicitly asked for it AND the patient actually has an email
 * on file (re-checked here, not just trusted from the request, in case it
 * changed since the checkout screen loaded) AND email delivery is
 * configured at all. None of that ever gates or affects the SMS send.
 */
export async function checkoutEncounter(
  encounterId: string,
  clinicId: string,
  staffId: string,
  deliveryMethod: CheckoutDeliveryMethod = 'sms',
): Promise<Encounter> {
  const encounter = await prisma.encounter.findFirst({
    where: { id: encounterId, clinicId },
    include: { patient: { select: { email: true } } },
  });
  if (!encounter) {
    throw new Error('Visit not found');
  }
  if (encounter.status !== 'READY_FOR_CHECKOUT') {
    throw new EncounterNotReadyForCheckoutError();
  }

  const updated = await prisma.encounter.update({
    where: { id: encounter.id },
    data: { status: 'DONE', checkedOutByStaffId: staffId, checkedOutAt: new Date() },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'ENCOUNTER_CHECKED_OUT',
    entityType: 'Encounter',
    entityId: encounter.id,
    metadata: { deliveryMethod },
  });

  await enqueueVisitSummarySms({ encounterId: encounter.id });

  if (deliveryMethod === 'sms_and_email') {
    if (encounter.patient.email && emailConfigured) {
      await enqueueVisitSummaryEmail({ encounterId: encounter.id });
    } else {
      logger.warn(
        { encounterId: encounter.id, hasEmail: !!encounter.patient.email, emailConfigured },
        'Email delivery requested at checkout but skipped — no patient email on file, or email is not configured',
      );
    }
  }

  return updated;
}
