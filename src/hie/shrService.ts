import crypto from 'node:crypto';
import { HieVisit } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from '../services/auditService';
import { loadProblemRecords, loadVisitRecords } from '../fhir/visitLoader';
import { logger } from '../utils/logger';
import { HieError, hieConfigured } from './client';
import { HieSetupError, patientCrView } from './registryService';
import { buildShrBundle } from './shrBundle';
import * as shr from './shr';
import { summariseNationalRecords, NationalRecordItem } from './shrRecords';

/**
 * A visit's link to DHA's Shared Health Record (SHR):
 *
 * 5. Consent. Staff ask DHA for consent; DHA texts the patient a code, which
 *    the patient reads out (or refuses, which is recorded too). If the
 *    patient already has an open HIE visit at this clinic, its token is
 *    refreshed instead. Doctors can record an emergency consent for a
 *    patient who can't consent (approved at once by DHA).
 * 6. Sending. At checkout the visit (diagnoses, prescriptions, lab requests
 *    and results, allergies) is queued for the SHR, retried if DHA is down.
 * 7. Reading. A doctor sees the patient's records from other facilities,
 *    with the visit's consent token. Nothing read is stored in ACISI.
 * 8. Closing. After the visit is sent, front desk closes the HIE visit; DHA
 *    may text the patient a code to confirm.
 *
 * Nothing here ever blocks the visit itself: if the HIE is down, care and
 * checkout carry on. Every step is audit-logged (ids and statuses only).
 */

export const SHR_SEND_RETRIES = 5;

async function context(encounterId: string, clinicId: string) {
  const encounter = await prisma.encounter.findFirst({
    where: { id: encounterId, clinicId },
    include: {
      patient: true,
      clinic: { select: { hieFacilityId: true } },
      hieVisit: true,
      consultedByStaff: { select: { id: true, hiePractitionerId: true } },
      assignedDoctor: { select: { id: true, hiePractitionerId: true } },
    },
  });
  if (!encounter) throw new HieError('not_found', 'Visit not found');
  return encounter;
}

type Ctx = Awaited<ReturnType<typeof context>>;

function requireLinked(ctx: Ctx): { facilityId: string; crId: string } {
  if (!hieConfigured()) throw new HieError('not_configured', "ACISI isn't connected to the national Health Information Exchange yet.");
  const facilityId = ctx.clinic.hieFacilityId;
  if (!facilityId) throw new HieSetupError("Your clinic admin must first set the clinic's facility code (National HIE page).");
  const crId = patientCrView(ctx.patient).crId;
  if (!crId) throw new HieSetupError('Look the patient up in the national Client Registry first (patient page, ID and next of kin).');
  return { facilityId, crId };
}

async function audit(ctx: { encounterId: string; clinicId: string; patientId: string }, staffId: string | null, action: string, metadata?: Record<string, unknown>) {
  await recordAuditEvent({
    actorType: staffId ? 'STAFF' : 'SYSTEM',
    actorId: staffId ?? undefined,
    staffId: staffId ?? undefined,
    clinicId: ctx.clinicId,
    action,
    entityType: 'Encounter',
    entityId: ctx.encounterId,
    metadata: { patientId: ctx.patientId, ...metadata },
  });
}

/** What the visit pages show. */
export function hieVisitView(v: HieVisit | null) {
  if (!v) return null;
  return {
    consentStatus: v.consentStatus,
    emergency: v.emergency,
    canRead: v.consentStatus === 'APPROVED' && Boolean(v.hieVisitId),
    sendStatus: v.sendStatus,
    sentAt: v.sentAt,
    closeStatus: v.closeStatus,
    closedAt: v.closedAt,
  };
}

export async function getHieVisit(encounterId: string, clinicId: string) {
  const ctx = await context(encounterId, clinicId);
  return {
    connected: hieConfigured(),
    facilitySet: Boolean(ctx.clinic.hieFacilityId),
    patientLinked: Boolean(patientCrView(ctx.patient).crId),
    visit: hieVisitView(ctx.hieVisit),
  };
}

// ---------- 5. Consent ----------

export async function startConsent(input: {
  encounterId: string;
  clinicId: string;
  staffId: string;
  staffRole: string;
  emergencyReason?: string;
}) {
  const ctx = await context(input.encounterId, input.clinicId);
  const { facilityId, crId } = requireLinked(ctx);
  if (ctx.hieVisit?.consentStatus === 'APPROVED') throw new HieSetupError('Consent for this visit is already given.');
  if (ctx.status === 'DONE') throw new HieSetupError('This visit is finished.');
  const ids = { encounterId: ctx.id, clinicId: input.clinicId, patientId: ctx.patientId };
  const me = await prisma.staff.findUnique({ where: { id: input.staffId }, select: { hiePractitionerId: true } });
  const practitionerId = me?.hiePractitionerId ?? ctx.consultedByStaff?.hiePractitionerId ?? ctx.assignedDoctor?.hiePractitionerId ?? null;
  const base = { encounterId: ctx.id, clinicId: input.clinicId, patientId: ctx.patientId, requestedByStaffId: input.staffId };

  // Already consented at this clinic and still open: reuse that visit.
  const open = await shr.listOpenVisits({ crId, facilityId });
  if (open.length > 0) {
    const token = await shr.refreshVisitToken({ visitId: open[0]!, facilityId });
    if (token) {
      const v = await prisma.hieVisit.upsert({
        where: { encounterId: ctx.id },
        create: { ...base, consentStatus: 'APPROVED', hieVisitId: open[0]!, consentToken: token, consentDecidedAt: new Date() },
        update: { consentStatus: 'APPROVED', hieVisitId: open[0]!, consentToken: token, consentDecidedAt: new Date(), consentId: null, otpRecord: null },
      });
      await audit(ids, input.staffId, 'HIE_CONSENT_REUSED_OPEN_VISIT');
      return hieVisitView(v);
    }
  }

  if (input.emergencyReason !== undefined) {
    if (input.staffRole !== 'DOCTOR') throw new HieSetupError('Only a doctor can record an emergency consent.');
    const started = await shr.requestConsent({ crId, facilityId, practitionerId, requestedBy: 'Doctor', emergency: { incapacityReason: input.emergencyReason } });
    if (!started.visitId || !started.consentToken) throw new HieError('unavailable', 'DHA did not approve the emergency consent. Try again.');
    const v = await prisma.hieVisit.upsert({
      where: { encounterId: ctx.id },
      create: { ...base, consentId: started.consentId, consentStatus: 'APPROVED', emergency: true, hieVisitId: started.visitId, consentToken: started.consentToken, consentDecidedAt: new Date() },
      update: { consentId: started.consentId, consentStatus: 'APPROVED', emergency: true, hieVisitId: started.visitId, consentToken: started.consentToken, consentDecidedAt: new Date() },
    });
    await audit(ids, input.staffId, 'HIE_CONSENT_EMERGENCY', { consentId: started.consentId });
    return hieVisitView(v);
  }

  const started = await shr.requestConsent({ crId, facilityId, practitionerId, requestedBy: input.staffRole === 'DOCTOR' ? 'Doctor' : 'Registration Clerk' });
  if (!started.consentId || !started.otpRecord) throw new HieError('unavailable', 'DHA did not start the consent request. Try again.');
  const v = await prisma.hieVisit.upsert({
    where: { encounterId: ctx.id },
    create: { ...base, consentId: started.consentId, otpRecord: started.otpRecord, consentStatus: 'PENDING' },
    update: { consentId: started.consentId, otpRecord: started.otpRecord, consentStatus: 'PENDING', requestedByStaffId: input.staffId },
  });
  await audit(ids, input.staffId, 'HIE_CONSENT_REQUESTED', { consentId: started.consentId });
  return hieVisitView(v);
}

async function pendingConsent(encounterId: string, clinicId: string) {
  const ctx = await context(encounterId, clinicId);
  const { facilityId } = requireLinked(ctx);
  const v = ctx.hieVisit;
  if (!v || v.consentStatus !== 'PENDING' || !v.consentId || !v.otpRecord) throw new HieSetupError('Ask for consent first.');
  return { ctx, v, facilityId, ids: { encounterId: ctx.id, clinicId, patientId: ctx.patientId } };
}

export async function resendConsentCode(input: { encounterId: string; clinicId: string; staffId: string }) {
  const { v, facilityId, ids } = await pendingConsent(input.encounterId, input.clinicId);
  const otpRecord = await shr.resendConsentOtp({ consentId: v.consentId!, facilityId });
  if (!otpRecord) throw new HieError('unavailable', 'DHA did not resend the code. Try again.');
  await prisma.hieVisit.update({ where: { id: v.id }, data: { otpRecord } });
  await audit(ids, input.staffId, 'HIE_CONSENT_CODE_RESENT');
}

export async function confirmConsentCode(input: { encounterId: string; clinicId: string; staffId: string; code: string }) {
  const { v, facilityId, ids } = await pendingConsent(input.encounterId, input.clinicId);
  let decision: shr.ConsentDecision;
  try {
    decision = await shr.decideConsent({ consentId: v.consentId!, facilityId, otpRecord: v.otpRecord!, otp: input.code.trim() });
  } catch (err) {
    if (err instanceof HieError && err.kind === 'invalid') {
      await audit(ids, input.staffId, 'HIE_CONSENT_CODE_WRONG');
      throw new HieError('invalid', 'DHA did not accept that code. Check it with the patient, or send a new one.');
    }
    throw err;
  }
  if (!decision.consentToken || !decision.visitId) throw new HieError('unavailable', 'DHA did not confirm the consent. Try again.');
  const updated = await prisma.hieVisit.update({
    where: { id: v.id },
    data: { consentStatus: 'APPROVED', hieVisitId: decision.visitId, consentToken: decision.consentToken, consentDecidedAt: new Date(), otpRecord: null },
  });
  await audit(ids, input.staffId, 'HIE_CONSENT_APPROVED', { consentId: v.consentId });
  return hieVisitView(updated);
}

/** The patient says no. Recorded with DHA (so there's an audit trail there too); the reason goes to DHA only. */
export async function recordConsentRefusal(input: { encounterId: string; clinicId: string; staffId: string; reason: string }) {
  const { v, facilityId, ids } = await pendingConsent(input.encounterId, input.clinicId);
  await shr.decideConsent({ consentId: v.consentId!, facilityId, reject: { reason: input.reason } });
  const updated = await prisma.hieVisit.update({ where: { id: v.id }, data: { consentStatus: 'REJECTED', consentDecidedAt: new Date(), otpRecord: null } });
  await audit(ids, input.staffId, 'HIE_CONSENT_REFUSED', { consentId: v.consentId });
  return hieVisitView(updated);
}

// ---------- 6. Sending the visit ----------

/** Called at checkout: queue the visit for the SHR if the patient consented. Never throws. */
export async function queueVisitForShr(encounterId: string, enqueue: (encounterId: string) => Promise<void>): Promise<void> {
  try {
    const v = await prisma.hieVisit.findUnique({ where: { encounterId } });
    if (!v || v.consentStatus !== 'APPROVED' || v.sendStatus === 'SENT') return;
    await prisma.hieVisit.update({ where: { id: v.id }, data: { sendStatus: 'SENDING' } });
    await enqueue(encounterId);
  } catch (err) {
    logger.error({ err, encounterId }, 'Could not queue the visit for the Shared Health Record');
  }
}

/** The job: build the bundle and send it. Throws to let the queue retry; marks FAILED on the last attempt. */
export async function sendVisitToShr(encounterId: string, attempt: number, lastAttempt: boolean): Promise<void> {
  const v = await prisma.hieVisit.findUnique({ where: { encounterId } });
  if (!v || v.consentStatus !== 'APPROVED' || !v.hieVisitId || v.sendStatus === 'SENT') return;
  const ids = { encounterId, clinicId: v.clinicId, patientId: v.patientId };
  try {
    const ctx = await context(encounterId, v.clinicId);
    const { facilityId, crId } = requireLinked(ctx);
    const [loaded] = await loadVisitRecords({ id: encounterId });
    if (!loaded) throw new Error('Visit not found');
    const visit = loaded.visit;
    const staffIds = new Set<string>([...(visit.doctor ? [visit.doctor.id] : []), ...visit.labOrders.map((o) => o.requestedBy.id), ...(visit.serviceOrders ?? []).map((o) => o.requestedBy.id)]);
    const allergies = await prisma.patientAllergy.findMany({
      where: { patientId: v.patientId, clinicId: v.clinicId },
      include: { recordedByStaff: { select: { id: true, name: true, staffCode: true } } },
    });
    allergies.forEach((a) => staffIds.add(a.recordedByStaffId));
    const problems = await loadProblemRecords(v.patientId, v.clinicId);
    problems.forEach((p) => staffIds.add(p.recordedBy.id));
    const staff = await prisma.staff.findMany({ where: { id: { in: [...staffIds] } }, select: { id: true, name: true, hiePractitionerId: true } });
    const bundleId = v.bundleId ?? crypto.randomUUID();
    const bundle = buildShrBundle({
      bundleId,
      visit,
      patientId: v.patientId,
      crId,
      facilityId,
      episodeOfCareId: v.hieVisitId,
      puids: new Map(staff.filter((s) => s.hiePractitionerId).map((s) => [s.id, s.hiePractitionerId!])),
      staffNames: new Map(staff.map((s) => [s.id, s.name])),
      allergies: allergies.map((a) => ({ ...a, recordedBy: a.recordedByStaff })),
      problems,
    });
    await prisma.hieVisit.update({ where: { id: v.id }, data: { bundleId, sendAttempts: attempt } });
    await shr.submitBundle({ bundle, facilityId });
    await prisma.hieVisit.update({ where: { id: v.id }, data: { sendStatus: 'SENT', sentAt: new Date() } });
    await audit(ids, null, 'HIE_SHR_VISIT_SENT', { bundleId, resources: bundle.entry?.length ?? 0 });
  } catch (err) {
    if (lastAttempt) {
      await prisma.hieVisit.update({ where: { id: v.id }, data: { sendStatus: 'FAILED' } });
      await audit(ids, null, 'HIE_SHR_VISIT_SEND_FAILED', { kind: err instanceof HieError ? err.kind : 'error' });
    }
    throw err;
  }
}

/** Staff retry after the automatic retries gave up. */
export async function retrySend(input: { encounterId: string; clinicId: string; staffId: string }, enqueue: (encounterId: string) => Promise<void>) {
  const ctx = await context(input.encounterId, input.clinicId);
  const v = ctx.hieVisit;
  if (!v || v.sendStatus !== 'FAILED') throw new HieSetupError('Nothing to resend.');
  await prisma.hieVisit.update({ where: { id: v.id }, data: { sendStatus: 'SENDING' } });
  await enqueue(ctx.id);
  await audit({ encounterId: ctx.id, clinicId: input.clinicId, patientId: ctx.patientId }, input.staffId, 'HIE_SHR_VISIT_RESEND');
}

// ---------- 7. Reading the national record ----------

export async function readNationalRecord(input: { encounterId: string; clinicId: string; staffId: string }): Promise<NationalRecordItem[]> {
  const ctx = await context(input.encounterId, input.clinicId);
  const { facilityId, crId } = requireLinked(ctx);
  const v = ctx.hieVisit;
  if (!v || v.consentStatus !== 'APPROVED' || !v.hieVisitId || !v.consentToken) throw new HieSetupError("The patient hasn't given consent for this visit.");
  const me = await prisma.staff.findUnique({ where: { id: input.staffId }, select: { hiePractitionerId: true } });
  if (!me?.hiePractitionerId) throw new HieSetupError('Verify your registration first (National HIE page): DHA records who reads a patient’s record.');
  const ids = { encounterId: ctx.id, clinicId: input.clinicId, patientId: ctx.patientId };
  const fetchWith = (consentToken: string) => shr.fetchPatientRecords({ crId, practitionerId: me.hiePractitionerId!, facilityId, consentToken });
  let data: unknown;
  try {
    data = await fetchWith(v.consentToken);
  } catch (err) {
    if (!(err instanceof HieError && err.kind === 'unauthorized')) throw err;
    // The visit's consent token expired: refresh it once (the visit is still open).
    const fresh = await shr.refreshVisitToken({ visitId: v.hieVisitId, facilityId });
    if (!fresh) throw err;
    await prisma.hieVisit.update({ where: { id: v.id }, data: { consentToken: fresh } });
    data = await fetchWith(fresh);
  }
  const items = summariseNationalRecords(data, { excludeEncounterId: ctx.id });
  await audit(ids, input.staffId, 'HIE_SHR_RECORDS_VIEWED', { count: items.length });
  return items;
}

// ---------- 8. Closing ----------

export async function startClose(input: { encounterId: string; clinicId: string; staffId: string }) {
  const ctx = await context(input.encounterId, input.clinicId);
  const { facilityId } = requireLinked(ctx);
  const v = ctx.hieVisit;
  if (!v || v.consentStatus !== 'APPROVED' || !v.hieVisitId) throw new HieSetupError('This visit has no open HIE visit.');
  if (v.closeStatus === 'CLOSED') throw new HieSetupError('Already closed.');
  if (v.sendStatus !== 'SENT') throw new HieSetupError('Wait until the visit has been sent to the national record, then close it.');
  const ids = { encounterId: ctx.id, clinicId: input.clinicId, patientId: ctx.patientId };
  const res = await shr.closeVisit({ visitId: v.hieVisitId, facilityId });
  const updated = res.otpRecord
    ? await prisma.hieVisit.update({ where: { id: v.id }, data: { closeStatus: 'CODE_SENT', closeOtpRecord: res.otpRecord } })
    : await prisma.hieVisit.update({ where: { id: v.id }, data: { closeStatus: 'CLOSED', closedAt: new Date(), consentToken: null } });
  await audit(ids, input.staffId, res.otpRecord ? 'HIE_VISIT_CLOSE_CODE_SENT' : 'HIE_VISIT_CLOSED');
  return hieVisitView(updated);
}

export async function confirmCloseCode(input: { encounterId: string; clinicId: string; staffId: string; code: string }) {
  const ctx = await context(input.encounterId, input.clinicId);
  const { facilityId } = requireLinked(ctx);
  const v = ctx.hieVisit;
  if (!v || v.closeStatus !== 'CODE_SENT' || !v.closeOtpRecord || !v.consentId) throw new HieSetupError('Close the visit first.');
  const ids = { encounterId: ctx.id, clinicId: input.clinicId, patientId: ctx.patientId };
  try {
    await shr.decideConsent({ consentId: v.consentId, facilityId, otpRecord: v.closeOtpRecord, otp: input.code.trim() });
  } catch (err) {
    if (err instanceof HieError && err.kind === 'invalid') throw new HieError('invalid', 'DHA did not accept that code. Check it with the patient.');
    throw err;
  }
  const updated = await prisma.hieVisit.update({
    where: { id: v.id },
    data: { closeStatus: 'CLOSED', closedAt: new Date(), closeOtpRecord: null, consentToken: null },
  });
  await audit(ids, input.staffId, 'HIE_VISIT_CLOSED');
  return hieVisitView(updated);
}
