import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { CONSENT_VERSION } from '../config/constants';
import { generateOtpCode } from '../utils/idCodes';
import { recordAuditEvent } from './auditService';
import { clinicCanSeePatientWhere } from './clinicPatientService';
import { buildRecordAccessCodeSms } from './smsTemplates';
import { sendSms } from './smsSender';
import { confirmPatientPin, PatientAuthError } from './patientAuthService';
import { clinicHasRecordAccess } from './patientService';

export { clinicHasRecordAccess };

/**
 * Sharing a patient's records from OTHER clinics with one clinic, only
 * with the patient's approval. A clinic always sees what it created itself;
 * everything else stays hidden until the patient approves a "Request past
 * records" — by reading out a 6-digit code sent to their phone (10 minutes,
 * single use, 5 wrong tries), or by typing their own PIN on the front-desk
 * screen. The patient sees and revokes access from the portal. Every
 * request, approval, revocation and view is in the audit log.
 */

export const RECORD_ACCESS_CODE_TTL_SECONDS = 10 * 60;
export const RECORD_ACCESS_MAX_CODE_ATTEMPTS = 5;
/** Each request costs an SMS: at most this many per patient per clinic per hour. */
export const RECORD_ACCESS_MAX_REQUESTS_PER_HOUR = 3;

export class RecordAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 429,
  ) {
    super(message);
    this.name = 'RecordAccessError';
  }
}

async function assertClinicKnowsPatient(clinicId: string, patientId: string): Promise<{ id: string; phoneNumber: string; smsOptOut: boolean; pinHash: string | null }> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null, ...clinicCanSeePatientWhere(clinicId) },
    select: { id: true, phoneNumber: true, smsOptOut: true, pinHash: true },
  });
  if (!patient) throw new RecordAccessError('Patient not found', 404);
  return patient;
}

async function grantAccess(patientId: string, clinicId: string, staffId: string, method: 'SMS_CODE' | 'PATIENT_PIN', requestId: string): Promise<void> {
  await prisma.consent.create({
    data: { patientId, clinicId, type: 'CLINIC_RECORD_ACCESS', granted: true, channel: method, version: CONSENT_VERSION },
  });
  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patientId,
    staffId,
    clinicId,
    patientId,
    action: 'RECORD_ACCESS_APPROVED',
    entityType: 'RecordAccessRequest',
    entityId: requestId,
    metadata: { method },
  });
}

/** What the front desk needs to show the "Request past records" box. */
export async function recordAccessStatus(patientId: string, clinicId: string): Promise<{ pendingUntil: Date | null; patientHasPin: boolean; smsOptOut: boolean }> {
  const [pending, patient] = await Promise.all([
    prisma.recordAccessRequest.findFirst({
      where: { patientId, clinicId, status: 'PENDING', codeHash: { not: null }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.patient.findUnique({ where: { id: patientId }, select: { pinHash: true, smsOptOut: true } }),
  ]);
  return { pendingUntil: pending?.expiresAt ?? null, patientHasPin: Boolean(patient?.pinHash), smsOptOut: Boolean(patient?.smsOptOut) };
}

/**
 * "Request past records": texts the patient a 6-digit code and opens a
 * 10-minute request. Any earlier open request from this clinic is closed.
 */
export async function requestRecordAccess(clinicId: string, staffId: string, patientId: string, now = new Date()): Promise<{ expiresAt: Date }> {
  const patient = await assertClinicKnowsPatient(clinicId, patientId);
  if (patient.smsOptOut) {
    throw new RecordAccessError("This patient doesn't receive SMS. Ask them to type their own ACISI PIN instead.", 409);
  }
  const recent = await prisma.recordAccessRequest.count({
    where: { clinicId, patientId, codeHash: { not: null }, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
  });
  if (recent >= RECORD_ACCESS_MAX_REQUESTS_PER_HOUR) {
    throw new RecordAccessError('Too many codes sent to this patient in the last hour. Try again later, or ask for their PIN.', 429);
  }
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true } });

  await prisma.recordAccessRequest.updateMany({
    where: { clinicId, patientId, status: 'PENDING' },
    data: { status: 'EXPIRED', resolvedAt: now },
  });
  const code = generateOtpCode();
  const expiresAt = new Date(now.getTime() + RECORD_ACCESS_CODE_TTL_SECONDS * 1000);
  const request = await prisma.recordAccessRequest.create({
    data: { clinicId, patientId, requestedByStaffId: staffId, codeHash: await bcrypt.hash(code, 10), expiresAt },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    patientId,
    action: 'RECORD_ACCESS_REQUESTED',
    entityType: 'RecordAccessRequest',
    entityId: request.id,
  });
  const sent = await sendSms(patient.phoneNumber, buildRecordAccessCodeSms(clinic?.name ?? 'A clinic', code), { purpose: 'record-access', patientId });
  if (!sent) {
    await prisma.recordAccessRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED', resolvedAt: now } });
    throw new RecordAccessError("The SMS couldn't be sent. Try again, or ask the patient to type their own PIN.", 409);
  }
  return { expiresAt };
}

/** The receptionist types in the code the patient read out. */
export async function approveRecordAccessWithCode(clinicId: string, staffId: string, patientId: string, code: string, now = new Date()): Promise<void> {
  await assertClinicKnowsPatient(clinicId, patientId);
  const request = await prisma.recordAccessRequest.findFirst({
    where: { clinicId, patientId, status: 'PENDING', codeHash: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  if (!request) throw new RecordAccessError('No code was sent, or it was already used. Send a new code.', 400);
  if (request.expiresAt <= now || request.attempts >= RECORD_ACCESS_MAX_CODE_ATTEMPTS) {
    await prisma.recordAccessRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED', resolvedAt: now } });
    throw new RecordAccessError('That code has expired. Send a new code.', 400);
  }
  const ok = /^\d{6}$/.test(code.trim()) && (await bcrypt.compare(code.trim(), request.codeHash as string));
  if (!ok) {
    const attempts = request.attempts + 1;
    const dead = attempts >= RECORD_ACCESS_MAX_CODE_ATTEMPTS;
    await prisma.recordAccessRequest.update({
      where: { id: request.id },
      data: { attempts, ...(dead ? { status: 'EXPIRED', resolvedAt: now } : {}) },
    });
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      clinicId,
      patientId,
      action: 'RECORD_ACCESS_CODE_WRONG',
      entityType: 'RecordAccessRequest',
      entityId: request.id,
    });
    throw new RecordAccessError(dead ? 'Too many wrong codes. Send a new code.' : 'That code is not right. Check it with the patient.', 400);
  }
  // Conditional, so the same code can't approve twice.
  const used = await prisma.recordAccessRequest.updateMany({
    where: { id: request.id, status: 'PENDING' },
    data: { status: 'APPROVED', approvedBy: 'SMS_CODE', resolvedAt: now },
  });
  if (used.count !== 1) throw new RecordAccessError('That code was already used.', 400);
  await grantAccess(patientId, clinicId, staffId, 'SMS_CODE', request.id);
}

/** No SMS: the patient types their own PIN on the front-desk screen. Same 5-wrong lock as login. */
export async function approveRecordAccessWithPin(clinicId: string, staffId: string, patientId: string, pin: string, now = new Date()): Promise<void> {
  const patient = await assertClinicKnowsPatient(clinicId, patientId);
  if (!patient.pinHash) throw new RecordAccessError("This patient hasn't set a PIN yet. Send them a code by SMS instead.", 409);
  let ok: boolean;
  try {
    ok = await confirmPatientPin(patientId, pin, now);
  } catch (err) {
    if (err instanceof PatientAuthError) throw new RecordAccessError(err.message, 429);
    throw err;
  }
  if (!ok) {
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      clinicId,
      patientId,
      action: 'RECORD_ACCESS_PIN_WRONG',
      entityType: 'Patient',
      entityId: patientId,
    });
    throw new RecordAccessError('Wrong PIN. The patient can try again.', 400);
  }
  const request = await prisma.recordAccessRequest.create({
    data: {
      clinicId,
      patientId,
      requestedByStaffId: staffId,
      expiresAt: now,
      status: 'APPROVED',
      approvedBy: 'PATIENT_PIN',
      resolvedAt: now,
    },
  });
  await grantAccess(patientId, clinicId, staffId, 'PATIENT_PIN', request.id);
}

// --- The patient's side (portal) ---------------------------------------------

export interface ClinicAccessEntry {
  clinicId: string;
  clinicName: string;
  grantedAt: Date;
}

/** Which clinics can currently see the patient's records from other clinics. */
export async function listRecordAccess(patientId: string): Promise<{ clinics: ClinicAccessEntry[]; allClinicsFromSignup: boolean }> {
  const rows = await prisma.consent.findMany({
    where: { patientId, type: 'CLINIC_RECORD_ACCESS' },
    orderBy: { createdAt: 'desc' },
    include: { clinic: { select: { name: true } } },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.clinicId && !latest.has(r.clinicId)) latest.set(r.clinicId, r);
  const clinics = [...latest.values()]
    .filter((r) => r.granted)
    .map((r) => ({ clinicId: r.clinicId as string, clinicName: r.clinic?.name ?? 'Clinic', grantedAt: r.createdAt }));
  const legacy = await prisma.consent.findFirst({ where: { patientId, type: 'CROSS_CLINIC_RECORD_SHARING' }, orderBy: { createdAt: 'desc' } });
  return { clinics, allClinicsFromSignup: Boolean(legacy?.granted) };
}

/** The patient takes one clinic's access away. */
export async function revokeClinicRecordAccess(patientId: string, clinicId: string): Promise<void> {
  await prisma.consent.create({
    data: { patientId, clinicId, type: 'CLINIC_RECORD_ACCESS', granted: false, channel: 'PORTAL', version: CONSENT_VERSION },
  });
  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patientId,
    clinicId,
    patientId,
    action: 'RECORD_ACCESS_REVOKED',
    entityType: 'Consent',
  });
}

/** The patient withdraws the old "share with all clinics" answer given at signup. */
export async function revokeAllClinicsSharing(patientId: string): Promise<void> {
  await prisma.consent.create({
    data: { patientId, type: 'CROSS_CLINIC_RECORD_SHARING', granted: false, channel: 'PORTAL', version: CONSENT_VERSION },
  });
  await recordAuditEvent({ actorType: 'PATIENT', actorId: patientId, patientId, action: 'ALL_CLINICS_SHARING_REVOKED', entityType: 'Consent' });
}
