import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { CONSENT_VERSION, ONE_TIME_CODE_MAX_ATTEMPTS, ONE_TIME_CODE_TTL_SECONDS } from '../config/constants';
import { generateOtpCode } from '../utils/idCodes';
import { kenyaDayRange, kenyaToday } from '../utils/kenyaTime';
import { toSmsSafe } from './smsTemplates';
import { recordAuditEvent } from './auditService';
import { sendPatientSms } from './smsService';

/**
 * Who may see a patient's records from OTHER clinics (C4/C5).
 *
 * - Standing consent: the patient ticked "allow clinics to share my records"
 *   (at signup, or later in their Account tab) and hasn't switched it off.
 *   Any ACISI clinic they visit then sees those records automatically: ACISI
 *   acting as controller on the patient's own authorisation.
 * - Otherwise, front desk can press "Request records": the patient gets a
 *   one-time code (on their web profile, and by SMS when it works), reads it
 *   to the front desk, and that clinic gets access until the end of that
 *   day in Kenya.
 *
 * A clinic's own visits are always visible to it; this is only about other
 * clinics'. Every view of other clinics' records is audit-logged with which
 * of the two it was by.
 */

export type CrossClinicBasis = 'STANDING_CONSENT' | 'SHARING_CODE';

export class RecordSharingError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 429 = 400,
  ) {
    super(message);
    this.name = 'RecordSharingError';
  }
}

/** The patient's current standing choice: the latest CROSS_CLINIC_RECORD_SHARING row. */
export async function hasStandingSharingConsent(patientId: string): Promise<boolean> {
  const latest = await prisma.consent.findFirst({
    where: { patientId, type: 'CROSS_CLINIC_RECORD_SHARING' },
    orderBy: { createdAt: 'desc' },
  });
  return latest?.granted ?? false;
}

/** How (if at all) this clinic may see this patient's records from other clinics right now. */
export async function crossClinicAccessBasis(patientId: string, clinicId: string, now: Date = new Date()): Promise<CrossClinicBasis | null> {
  if (await hasStandingSharingConsent(patientId)) return 'STANDING_CONSENT';
  const access = await prisma.recordAccessRequest.findFirst({
    where: { patientId, clinicId, usedAt: { not: null }, revokedAt: null, accessUntil: { gt: now } },
    select: { id: true },
  });
  return access ? 'SHARING_CODE' : null;
}

/** End of the current day in Kenya (the moment code access runs out). */
export function endOfKenyaDay(now: Date = new Date()): Date {
  return kenyaDayRange(kenyaToday(now)).end;
}

async function newCode(): Promise<{ code: string; codeHash: string }> {
  const code = generateOtpCode();
  return { code, codeHash: await bcrypt.hash(code, 10) };
}

/**
 * Front desk pressing "Request records" for a patient this clinic has seen.
 * Creates the request and, when SMS works, texts the patient a code. The
 * patient can always get a code on their web profile instead. Any earlier
 * open request from this clinic for this patient is replaced.
 */
export async function requestRecords(input: { patientId: string; clinicId: string; staffId: string }): Promise<{ requestId: string; sms: string }> {
  const patient = await prisma.patient.findFirst({
    where: {
      id: input.patientId,
      deletedAt: null,
      OR: [{ checkIns: { some: { clinicId: input.clinicId } } }, { encounters: { some: { clinicId: input.clinicId } } }],
    },
    select: { id: true, phoneNumber: true, smsOptOut: true, deletedAt: true },
  });
  if (!patient) throw new RecordSharingError('Patient not found', 404);

  const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: input.clinicId }, select: { name: true } });
  const now = new Date();
  const { code, codeHash } = await newCode();

  // Only one open request per patient per clinic: close earlier unused ones.
  await prisma.recordAccessRequest.updateMany({
    where: { patientId: patient.id, clinicId: input.clinicId, usedAt: null, codeExpiresAt: { gt: now } },
    data: { codeExpiresAt: now },
  });
  const request = await prisma.recordAccessRequest.create({
    data: {
      patientId: patient.id,
      clinicId: input.clinicId,
      requestedByStaffId: input.staffId,
      codeHash,
      codeExpiresAt: new Date(now.getTime() + ONE_TIME_CODE_TTL_SECONDS * 1000),
    },
  });

  // Asked for in person at the desk, so it goes even to patients who don't
  // want clinic SMS. No health information in it.
  const message =
    `ACISI: ${toSmsSafe(clinic.name) || 'A clinic'} asks to see your records from other clinics. ` +
    `If you agree, give the front desk this code: ${code}. Valid ${Math.round(ONE_TIME_CODE_TTL_SECONDS / 60)} minutes.`;
  const sms = await sendPatientSms(patient, message, { purpose: 'RECORD_ACCESS_CODE', essential: true });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'RECORD_ACCESS_REQUESTED',
    entityType: 'RecordAccessRequest',
    entityId: request.id,
    metadata: { patientId: patient.id, smsOutcome: sms },
  });

  return { requestId: request.id, sms };
}

/** Requests waiting for the patient today (shown on their profile with a "Show my code" button). */
export async function listOpenRequestsForPatient(patientId: string, now: Date = new Date()) {
  const { start } = kenyaDayRange(kenyaToday(now));
  const requests = await prisma.recordAccessRequest.findMany({
    where: { patientId, usedAt: null, createdAt: { gte: start } },
    orderBy: { createdAt: 'desc' },
  });
  // Newest request per clinic only.
  const seen = new Set<string>();
  const open = requests.filter((r) => (seen.has(r.clinicId) ? false : (seen.add(r.clinicId), true)));
  const clinics = await prisma.clinic.findMany({ where: { id: { in: open.map((r) => r.clinicId) } }, select: { id: true, name: true } });
  const nameOf = new Map(clinics.map((c) => [c.id, c.name]));
  return open.map((r) => ({ requestId: r.id, clinicName: nameOf.get(r.clinicId) ?? 'A clinic', requestedAt: r.createdAt }));
}

/**
 * The patient tapping "Show my code" for a request: a fresh code, valid
 * ONE_TIME_CODE_TTL_SECONDS, shown once. Replaces any code sent by SMS for
 * this request. Only for the patient's own request made today.
 */
export async function showCodeToPatient(patientId: string, requestId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: Date; clinicName: string }> {
  const { start } = kenyaDayRange(kenyaToday(now));
  const request = await prisma.recordAccessRequest.findFirst({
    where: { id: requestId, patientId, usedAt: null, createdAt: { gte: start } },
  });
  if (!request) throw new RecordSharingError('This request is no longer open. Ask the front desk to request your records again.', 404);
  // Works whether or not the Account switch is on: reading a one-off code to
  // the desk is itself the patient's decision for that clinic, that day.

  const { code, codeHash } = await newCode();
  const expiresAt = new Date(now.getTime() + ONE_TIME_CODE_TTL_SECONDS * 1000);
  await prisma.recordAccessRequest.update({ where: { id: request.id }, data: { codeHash, codeExpiresAt: expiresAt, attempts: 0 } });
  const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: request.clinicId }, select: { name: true } });

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patientId,
    clinicId: request.clinicId,
    action: 'RECORD_ACCESS_CODE_SHOWN',
    entityType: 'RecordAccessRequest',
    entityId: request.id,
  });

  return { code, expiresAt, clinicName: clinic.name };
}

/**
 * Front desk entering the code the patient read out. Right code: this
 * clinic sees the patient's other-clinic records until the end of the day,
 * recorded as a consent decision. Wrong code: counted; after
 * ONE_TIME_CODE_MAX_ATTEMPTS the code stops working.
 */
export async function enterRecordAccessCode(input: { patientId: string; clinicId: string; staffId: string; code: string }): Promise<{ accessUntil: Date }> {
  const now = new Date();
  const request = await prisma.recordAccessRequest.findFirst({
    where: { patientId: input.patientId, clinicId: input.clinicId, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const usable = request && request.codeExpiresAt > now && request.attempts < ONE_TIME_CODE_MAX_ATTEMPTS;
  const matches = usable ? await bcrypt.compare(input.code.trim(), request.codeHash) : false;

  if (!request || !usable || !matches) {
    if (request && usable) {
      await prisma.recordAccessRequest.update({ where: { id: request.id }, data: { attempts: { increment: 1 } } });
    }
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: input.staffId,
      staffId: input.staffId,
      clinicId: input.clinicId,
      action: 'RECORD_ACCESS_CODE_FAILED',
      entityType: 'RecordAccessRequest',
      entityId: request?.id,
      metadata: { patientId: input.patientId, outcome: !request ? 'NO_REQUEST' : !usable ? 'EXPIRED_OR_USED_UP' : 'WRONG_CODE' },
    });
    throw new RecordSharingError(
      !request || !usable ? 'This code has expired. Ask the patient to show a new code on their ACISI profile.' : 'That code is not right. Check it with the patient.',
      400,
    );
  }

  const accessUntil = endOfKenyaDay(now);
  const claimed = await prisma.recordAccessRequest.updateMany({
    where: { id: request.id, usedAt: null },
    data: { usedAt: now, usedByStaffId: input.staffId, accessUntil },
  });
  if (claimed.count === 0) throw new RecordSharingError('This code has already been used.', 409);

  await prisma.consent.create({
    data: {
      patientId: input.patientId,
      type: 'CLINIC_RECORD_ACCESS',
      granted: true,
      channel: 'SHARING_CODE',
      version: CONSENT_VERSION,
      clinicId: input.clinicId,
      staffId: input.staffId,
    },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'RECORD_ACCESS_GRANTED_BY_CODE',
    entityType: 'RecordAccessRequest',
    entityId: request.id,
    metadata: { patientId: input.patientId, accessUntil: accessUntil.toISOString() },
  });
  return { accessUntil };
}

/**
 * The Account-tab switch. Every change is a new consent row (date, time,
 * source "PORTAL_ACCOUNT"), never an edit. Switching off also ends any code
 * access still running today.
 */
export async function setStandingSharing(patientId: string, allow: boolean): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.consent.create({
      data: { patientId, type: 'CROSS_CLINIC_RECORD_SHARING', granted: allow, channel: 'PORTAL_ACCOUNT', version: CONSENT_VERSION },
    });
    if (!allow) {
      await tx.recordAccessRequest.updateMany({
        where: { patientId, usedAt: { not: null }, revokedAt: null, accessUntil: { gt: now } },
        data: { revokedAt: now },
      });
    }
  });
  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patientId,
    action: allow ? 'CROSS_CLINIC_SHARING_TURNED_ON' : 'CROSS_CLINIC_SHARING_TURNED_OFF',
    entityType: 'Patient',
    entityId: patientId,
    metadata: { source: 'PORTAL_ACCOUNT' },
  });
}

/** What the patient's Account tab shows: the switch, clinics with access today, and every decision with date, time and source. */
export async function getSharingOverview(patientId: string, now: Date = new Date()) {
  const [allow, decisions, access] = await Promise.all([
    hasStandingSharingConsent(patientId),
    prisma.consent.findMany({
      where: { patientId, type: { in: ['CROSS_CLINIC_RECORD_SHARING', 'CLINIC_RECORD_ACCESS'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.recordAccessRequest.findMany({
      where: { patientId, usedAt: { not: null }, revokedAt: null, accessUntil: { gt: now } },
    }),
  ]);
  const clinicIds = [...new Set([...decisions.map((d) => d.clinicId), ...access.map((a) => a.clinicId)].filter(Boolean) as string[])];
  const clinics = await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } });
  const nameOf = new Map(clinics.map((c) => [c.id, c.name]));
  return {
    allowSharing: allow,
    accessToday: access.map((a) => ({ clinicName: nameOf.get(a.clinicId) ?? 'A clinic', until: a.accessUntil })),
    decisions: decisions.map((d) => ({
      at: d.createdAt,
      kind: d.type === 'CLINIC_RECORD_ACCESS' ? 'ONE_DAY_CODE' : d.granted ? 'ALLOWED' : 'NOT_ALLOWED',
      source: d.channel,
      clinicName: d.clinicId ? (nameOf.get(d.clinicId) ?? null) : null,
    })),
    openRequests: await listOpenRequestsForPatient(patientId, now),
  };
}
