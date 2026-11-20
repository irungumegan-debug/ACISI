import { listServiceOrders, ServiceOrderView } from './serviceOrderService';
import { listProblemsForClinic, ProblemView } from './problemListService';

import { queueVisitForShr } from '../hie/shrService';
import { Encounter, EncounterStatus } from '@prisma/client';
import { doctorQueueFilter } from './doctorScope';
import { prisma } from '../db/prisma';
import { NotifiableAlert, notifyNotifiableCases, recordNotifiableCases } from './notifiableDiseaseService';
import {
  assertOverridesGiven,
  checkPrescriptionAllergies,
  formatPrescriptionText,
  listMedications,
  MedicationView,
  ResolvedPrescriptionItem,
  toPrescriptionRows,
} from './prescriptionService';
import { recordAuditEvent } from './auditService';
import { verifySigningPin } from './signingPin';
import type { Icd11Entry } from './icd11Service';
import { getLabOrdersForEncounter, LabOrderView } from './labService';
import { AllergyView, listAllergiesForClinic } from './allergyService';

async function allergiesFor(patientId: string, clinicId: string): Promise<{ allergies: AllergyView[]; allergiesHiddenElsewhere: boolean }> {
  const { allergies, hiddenElsewhere } = await listAllergiesForClinic(patientId, clinicId);
  return { allergies, allergiesHiddenElsewhere: hiddenElsewhere };
}
import { getScopedHistory, ScopedHistoryEntry } from './patientService';
import { emailConfigured } from '../config/email';
import { enqueueHieShrSend, enqueueVisitSummaryEmail } from '../jobs/queue';
import { logger } from '../utils/logger';
import { sendCheckoutSms } from './checkoutSmsService';

export type CheckoutDeliveryMethod = 'sms' | 'sms_and_email';

export interface DoctorQueueItem {
  encounterId: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  phoneNumber: string;
  status: EncounterStatus;
  waitingSince: Date;
  /** True when this visit came back from the lab with signed results. */
  backFromLab: boolean;
  /** How many of this visit's signed lab results the lab flagged critical (decision support: review first). */
  criticalResults: number;
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
export { doctorQueueFilter } from './doctorScope';

export async function getDoctorQueue(clinicId: string, departmentIds: string[], staffId: string): Promise<DoctorQueueItem[]> {
  const encounters = await prisma.encounter.findMany({
    where: doctorQueueFilter(clinicId, departmentIds, staffId),
    include: { patient: true, labOrders: { where: { status: 'RESULTS_READY' }, select: { id: true, items: { where: { resultFlag: 'CRITICAL' }, select: { id: true } } } } },
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
    backFromLab: (e.labOrders?.length ?? 0) > 0,
    criticalResults: (e.labOrders ?? []).reduce((n, o) => n + (o.items?.length ?? 0), 0),
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
  /** This visit's lab requests, with results once the lab has signed them. */
  labOrders: LabOrderView[];
  /** The patient's allergies (current and removed), same sharing rule as visit history. */
  allergies: AllergyView[];
  /** True when other clinics recorded allergies that aren't shown (no sharing consent). */
  allergiesHiddenElsewhere: boolean;
  /** Medicines prescribed in the visits shown in `history` (same sharing rule), newest first; `active` = course not finished. */
  medications: MedicationView[];
  /** This visit's radiology, therapy and other orders. */
  serviceOrders: ServiceOrderView[];
  /** The patient's problem list (same sharing rule as allergies). */
  problems: ProblemView[];
  problemsHiddenElsewhere: boolean;
  /** The patient's family history note. */
  familyHistory: string | null;
}

export async function assertEncounterInDoctorQueue(encounterId: string, clinicId: string, departmentIds: string[], staffId: string): Promise<Encounter> {
  // Only a visit still in the queue: once signed it is front desk's, and a
  // doctor sees it again only as history of a patient back in their queue.
  const encounter = await prisma.encounter.findFirst({
    where: { id: encounterId, ...doctorQueueFilter(clinicId, departmentIds, staffId) },
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
  departmentIds: string[],
  viewingStaffId: string,
): Promise<EncounterDetail> {
  const encounter = await assertEncounterInDoctorQueue(encounterId, clinicId, departmentIds, viewingStaffId);

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

  const { history, hasHiddenHistoryElsewhere } = await getScopedHistory(
    encounter.patientId,
    clinicId,
    { includeDiagnosis: true, viewer: { staffId: viewingStaffId, channel: 'DOCTOR_DASHBOARD' } },
    encounter.id,
  );

  return {
    encounterId: encounter.id,
    patientId: patient.id,
    patientCode: patient.patientCode,
    patientName: `${patient.firstName} ${patient.lastName}`,
    phoneNumber: patient.phoneNumber,
    status: currentStatus,
    history,
    hasHiddenHistoryElsewhere,
    labOrders: await getLabOrdersForEncounter(encounter.id),
    ...(await allergiesFor(encounter.patientId, clinicId)),
    medications: await listMedications(history.map((h) => h.encounterId)),
    serviceOrders: await listServiceOrders(encounter.id),
    ...(await problemsFor(encounter.patientId, clinicId)),
    familyHistory: patient.familyHistory,
  };
}

export class EncounterNotConsultableError extends Error {
  constructor() {
    super('This patient is not currently awaiting consultation');
    this.name = 'EncounterNotConsultableError';
  }
}

export { InvalidPinError, PinLockedOutError } from './signingPin';

interface SubmitConsultationInput {
  encounterId: string;
  clinicId: string;
  /** The departments the signing doctor works in. */
  departmentIds: string[];
  staffId: string;
  /** ICD-11 codes with WHO's titles (validated by the caller). */
  diagnosisCodes: Icd11Entry[];
  /** The doctor's own notes (may be empty). */
  diagnosis: string;
  /** One line per medicine, already checked by resolvePrescriptionItems. */
  prescriptionItems: ResolvedPrescriptionItem[];
  /** General advice for the patient, added after the medicine lines (optional). */
  prescriptionAdvice?: string | null;
  /** Plan / follow-up for the patient (optional). */
  carePlan?: string | null;
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
export async function submitConsultation(input: SubmitConsultationInput): Promise<Encounter & { notifiable: NotifiableAlert[] }> {
  const encounter = await assertEncounterInDoctorQueue(input.encounterId, input.clinicId, input.departmentIds, input.staffId);

  if (encounter.status !== 'WAITING' && encounter.status !== 'IN_CONSULTATION') {
    throw new EncounterNotConsultableError();
  }

  // Allergy check before the PIN: a clashing medicine needs the doctor's
  // reason (the screen asks for it; this is the server-side guarantee).
  const conflicts = await checkPrescriptionAllergies(encounter.patientId, input.clinicId, input.prescriptionItems);
  assertOverridesGiven(input.prescriptionItems, conflicts);

  // Same per-account wrong-PIN counter as login (see verifySigningPin).
  await verifySigningPin({
    staffId: input.staffId,
    pin: input.pin,
    okAction: 'CONSULTATION_SIGNED',
    failedAction: 'CONSULTATION_SIGN_FAILED',
    entityType: 'Encounter',
    entityId: encounter.id,
  });

  const consultedAt = new Date();
  // The visit and any notifiable-disease cases are saved together.
  const { updated, notifiable } = await prisma.$transaction(async (tx) => {
    const updated = await tx.encounter.update({
      where: { id: encounter.id },
      data: {
        status: 'READY_FOR_CHECKOUT',
        diagnosis: input.diagnosis || null,
        diagnosisCodes: JSON.stringify(input.diagnosisCodes),
        prescription: formatPrescriptionText(input.prescriptionItems, input.prescriptionAdvice),
        carePlan: input.carePlan?.trim() || null,
        consultedByStaffId: input.staffId,
        consultedAt,
      },
    });
    await tx.prescriptionItem.createMany({ data: toPrescriptionRows(updated.id, input.prescriptionItems, conflicts) });
    const notifiable = await recordNotifiableCases(tx, {
      encounterId: updated.id,
      patientId: updated.patientId,
      clinicId: input.clinicId,
      staffId: input.staffId,
      codes: input.diagnosisCodes.map((c) => c.code),
      diagnosedAt: consultedAt,
    });
    return { updated, notifiable };
  });

  if (conflicts.length > 0) {
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: input.staffId,
      staffId: input.staffId,
      clinicId: input.clinicId,
      action: 'PRESCRIPTION_ALLERGY_OVERRIDDEN',
      entityType: 'Encounter',
      entityId: updated.id,
      metadata: { lines: [...new Set(conflicts.map((c) => c.index))].length, allergyIds: [...new Set(conflicts.map((c) => c.allergyId))] },
    });
  }

  // Audit and the 24-hour SMS alert run after the save and never undo it.
  void notifyNotifiableCases({ clinicId: input.clinicId, staffId: input.staffId, encounterId: updated.id, alerts: notifiable });

  return Object.assign(updated, { notifiable });
}

export class EncounterNotReadyForCheckoutError extends Error {
  constructor() {
    super('This visit is not ready for checkout yet');
    this.name = 'EncounterNotReadyForCheckoutError';
  }
}

/**
 * Front-desk-only action: completes the visit. Deliberately separate from
 * the doctor's consultation submission — a doctor finishing a consult never
 * checks a patient out or sends anything by itself.
 *
 * Sends the patient ONE SMS (checkoutSmsService): the receipt and a visit
 * summary together (clinic, date, amount and method, prescription; never
 * the diagnosis or department), unless they don't want SMS.
 * 'sms_and_email' also emails the PDF, only when the patient has an email
 * on file (re-checked here) AND email delivery is configured at all.
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

  // Conditional, so two clicks (or two front-desk screens) can't both check
  // the visit out, and the checkout SMS below goes exactly once.
  const moved = await prisma.encounter.updateMany({
    where: { id: encounter.id, status: 'READY_FOR_CHECKOUT' },
    data: { status: 'DONE', checkedOutByStaffId: staffId, checkedOutAt: new Date() },
  });
  if (moved.count === 0) {
    throw new EncounterNotReadyForCheckoutError();
  }
  const updated = await prisma.encounter.findUniqueOrThrow({ where: { id: encounter.id } });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'ENCOUNTER_CHECKED_OUT',
    entityType: 'Encounter',
    entityId: encounter.id,
    metadata: { deliveryMethod },
  });

  // National Shared Health Record: only if the patient consented for this
  // visit; queued (with retries) and never blocks or undoes the checkout.
  await queueVisitForShr(encounter.id, enqueueHieShrSend);

  // One SMS: receipt + visit summary (never the diagnosis or department).
  await sendCheckoutSms(encounter.id);

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

/** The patient's problem list as this clinic may see it. */
async function problemsFor(patientId: string, clinicId: string): Promise<{ problems: ProblemView[]; problemsHiddenElsewhere: boolean }> {
  const { problems, hiddenElsewhere } = await listProblemsForClinic(patientId, clinicId);
  return { problems, problemsHiddenElsewhere: hiddenElsewhere };
}
