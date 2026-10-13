import crypto from 'node:crypto';
import dayjs from 'dayjs';
import { Patient, Prisma, Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { CONSENT_VERSION } from '../config/constants';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { recordAuditEvent } from './auditService';
import { DuplicatePatientError, findPatientsByPhone, registerPatient } from './patientService';
import { findActiveDepartment } from './departmentService';
import { assignDoctorForCheckIn } from './doctorAssignmentService';
import { findArrivalMatch, markAppointmentCompleted } from './appointmentService';
import { publishWalkInCheckedIn } from './realtimeEvents';
import { buildQueueJoinSms } from './smsTemplates';
import { sendSms } from './smsSender';
import { lookupPatients, PatientMatch, PatientRegistryError } from './clinicPatientService';
import { recordLegalAcceptances, walkInNeedsPrivacyAck } from './legalService';
import { PatientIdentityError, PatientIdentityInput, preparePatientIdentity } from './patientIdentity';
import { parseDateOfBirth, splitFullName } from '../utils/patientInput';

export { splitFullName };

const PRIVACY_NOTICE_REQUIRED_MESSAGE =
  'Tell the patient how their data is used and where to read the Privacy Notice, then tick the box to confirm';

/**
 * Front-desk check-in for a patient who arrives without having checked in
 * remotely. Deliberately separate from checkInService.initiateCheckIn (the
 * remote, fee-charging path), which this never calls or changes: a walk-in
 * is never charged the ACISI check-in fee and never gets an M-Pesa prompt.
 * Instead the visit starts straight away — the same Encounter (WAITING,
 * assigned to a doctor) a remote check-in gets once paid — so from there
 * the patient flows through the doctor and checkout like anyone else.
 */

/** A walk-in problem the front desk can act on; carries the HTTP status the route should use. */
export class WalkInError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = 'WalkInError';
  }
}

/** Normalizes any accepted Kenyan format (07…, 01…, 2547…, +2547…) to +254…, or throws a WalkInError. */
export function normalizeWalkInPhone(raw: string): string {
  try {
    return toE164(raw);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      throw new WalkInError('Enter a valid Kenyan phone number, e.g. 0712 345 678', 400);
    }
    throw err;
  }
}

export interface WalkInPatientMatch extends PatientMatch {
  /**
   * Whether an ID document / next of kin is already on file. Only yes/no:
   * a lookup can find a patient this clinic has never seen, so the details
   * themselves are never shown here.
   */
  hasIdOnFile: boolean;
  hasNextOfKinOnFile: boolean;
  /**
   * Whether the front desk must confirm the patient was told about the
   * Privacy Notice: at their first walk-in at this clinic, or when the
   * notice's version has changed.
   */
  privacyNoticeAckRequired: boolean;
}

export interface WalkInLookupResult {
  query: string;
  kind: 'phone' | 'patientCode';
  /** Set when the search was a phone number — what a new patient would be registered under. */
  phoneNumber: string | null;
  /** Everyone found. A phone can hold several patients (a parent and children); staff pick one. */
  patients: WalkInPatientMatch[];
}

/** Step 1 of the walk-in flow: find the patient(s) by phone number or ACISI ID. */
export async function lookupWalkInPatient(rawQuery: string, clinicId: string, staffId: string): Promise<WalkInLookupResult> {
  let found;
  try {
    found = await lookupPatients(rawQuery, clinicId, staffId);
  } catch (err) {
    if (err instanceof PatientRegistryError) throw new WalkInError(err.message, err.status);
    throw err;
  }
  const details = await prisma.patient.findMany({
    where: { id: { in: found.patients.map((p) => p.id) } },
    select: { id: true, idNumber: true, nextOfKinName: true, nextOfKinPhone: true },
  });
  const byId = new Map(details.map((d) => [d.id, d]));
  const patients: WalkInPatientMatch[] = [];
  for (const p of found.patients) {
    const d = byId.get(p.id);
    patients.push({
      ...p,
      hasIdOnFile: Boolean(d?.idNumber),
      hasNextOfKinOnFile: Boolean(d?.nextOfKinName || d?.nextOfKinPhone),
      privacyNoticeAckRequired: await walkInNeedsPrivacyAck(p.id, clinicId),
    });
  }
  return { query: found.query, kind: found.kind, phoneNumber: found.phoneNumber, patients };
}

export interface NewWalkInPatientDetails {
  fullName: string;
  /** YYYY-MM-DD. Wins over `age` if both are given. */
  dateOfBirth?: string;
  /** Whole years; stored as 1 January of the birth year, the same convention USSD registration uses. */
  age?: number;
  sex?: Sex;
  /** The patient agreed to ACISI creating a health record for them — required to register anyone. */
  registrationConsent: boolean;
}

export interface WalkInCheckInInput {
  clinicId: string;
  staffId: string;
  /**
   * The patient staff picked from the lookup (the normal path, required
   * when several patients share a phone). When absent, `phone` is used to
   * find the only patient on it, or to register `newPatient`.
   */
  patientId?: string;
  /** Staff confirmed the patient's name and date of birth with them. Required with `patientId`. */
  identityConfirmed?: boolean;
  phone?: string;
  departmentId: string;
  reasonForVisit: string;
  /** Only used when no patient exists for `phone`; an existing record is always reused, never overwritten. */
  newPatient?: NewWalkInPatientDetails;
  /** "Patient agreed to receive SMS from the clinic" — recorded as consent; off unless staff tick it. */
  smsConsent: boolean;
  /**
   * "Patient does not want SMS" — no receipts, visit summaries or invites.
   * Can't be combined with smsConsent. Ticking smsConsent for someone who
   * previously opted out clears the opt-out (they've changed their mind).
   */
  smsOptOut?: boolean;
  /**
   * "Patient has been told how their data is used and where to read the
   * Privacy Notice." Required for a new patient, at a patient's first
   * walk-in at this clinic, and again when the notice's version changes;
   * recorded against the staff member who ticked it.
   */
  privacyNoticeExplained?: boolean;
  /**
   * Optional ID document and next of kin. Only what's entered is saved — an
   * empty field never wipes what's already on file.
   */
  identity?: PatientIdentityInput;
}

export type WalkInSmsOutcome = 'sent' | 'failed' | 'not_requested';

export interface WalkInCheckInResult {
  checkInId: string;
  encounterId: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  isNewPatient: boolean;
  departmentName: string;
  /** 1-based place among patients waiting in this department, in arrival order. */
  queuePosition: number;
  sms: WalkInSmsOutcome;
}

/** Resolves the optional age / date of birth into the stored date of birth, or throws a WalkInError. */
export function resolveDateOfBirth(details: Pick<NewWalkInPatientDetails, 'dateOfBirth' | 'age'>, now = new Date()): Date | undefined {
  if (details.dateOfBirth) {
    const dob = parseDateOfBirth(details.dateOfBirth, now);
    if (!dob) throw new WalkInError('Enter a valid date of birth', 400);
    return dob;
  }
  if (details.age !== undefined) {
    return new Date(Date.UTC(now.getUTCFullYear() - details.age, 0, 1));
  }
  return undefined;
}

async function findOrCreatePatient(
  phoneNumber: string,
  details: NewWalkInPatientDetails | undefined,
  privacyNoticeExplained: boolean,
): Promise<{ patient: Patient; isNew: boolean }> {
  const onPhone = await findPatientsByPhone(phoneNumber);
  if (onPhone.length > 1) {
    throw new WalkInError('Several patients share this phone number. Search again and pick the right person.', 409);
  }
  const existing = onPhone[0];
  if (existing) return { patient: existing, isNew: false };

  if (!details) {
    throw new WalkInError('No patient found with that phone number. Fill in the new patient details.', 400);
  }
  const { firstName, lastName } = splitFullName(details.fullName);
  if (firstName.length < 2) {
    throw new WalkInError("Enter the patient's full name", 400);
  }
  if (!details.registrationConsent) {
    throw new WalkInError('The patient must agree to ACISI creating a record before they can be registered', 400);
  }
  // Checked before registering, so a refused check-in never leaves a new patient behind.
  if (!privacyNoticeExplained) {
    throw new WalkInError(PRIVACY_NOTICE_REQUIRED_MESSAGE, 400);
  }

  try {
    const patient = await registerPatient({
      phoneNumberE164: phoneNumber,
      firstName,
      lastName,
      dateOfBirth: resolveDateOfBirth(details),
      dateOfBirthEstimated: !details.dateOfBirth && details.age !== undefined,
      sex: details.sex ?? 'UNKNOWN',
      consentChannel: 'STAFF_ASSISTED',
    });
    return { patient, isNew: true };
  } catch (err) {
    // Another check-in registered this person a moment ago: reuse that
    // record rather than failing or creating a second patient.
    if (err instanceof DuplicatePatientError) return { patient: err.existing, isNew: false };
    throw err;
  }
}

/**
 * Sends the walk-in "you are number N in the queue" SMS, once, unless the
 * patient doesn't want SMS. Someone already first in line won't also get a
 * "you're next" SMS. Never throws: a failed SMS must not undo the check-in.
 */
async function sendQueueJoinSms(
  patient: Pick<Patient, 'id' | 'phoneNumber'>,
  encounterId: string,
  clinic: { id: string; name: string },
  queuePosition: number,
  staffId: string,
): Promise<WalkInSmsOutcome> {
  const now = new Date();
  const claimed = await prisma.encounter.updateMany({
    where: { id: encounterId, queueJoinSmsAt: null },
    data: { queueJoinSmsAt: now, ...(queuePosition <= 1 ? { queueNextSmsAt: now } : {}) },
  });
  if (claimed.count === 0) return 'not_requested';
  const ok = await sendSms(patient.phoneNumber, buildQueueJoinSms(clinic.name, queuePosition), { purpose: 'queue-join', patientId: patient.id });
  if (ok) {
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      clinicId: clinic.id,
      patientId: patient.id,
      action: 'QUEUE_JOIN_SMS_SENT',
      entityType: 'Encounter',
      entityId: encounterId,
    });
  }
  return ok ? 'sent' : 'failed';
}

/**
 * Checks a walk-in patient in: finds the patient by phone or registers them
 * (never a duplicate), then — in one transaction — creates the CheckIn
 * (source WALK_IN, status NO_FEE, KES 0, recording which staff member did
 * it) and the WAITING Encounter with the reason for visit, assigned to a
 * doctor exactly like a paid remote check-in. If the patient agreed to SMS,
 * the consent is recorded and the invite sent afterwards.
 */
export async function checkInWalkIn(input: WalkInCheckInInput): Promise<WalkInCheckInResult> {
  if (!input.patientId && !input.phone) throw new WalkInError('Find the patient first', 400);
  if (input.patientId && !input.identityConfirmed) {
    throw new WalkInError("Confirm the patient's name and date of birth with them before adding them to the queue", 400);
  }
  if (input.smsConsent && input.smsOptOut) {
    throw new WalkInError('Choose either "agreed to receive SMS" or "does not want SMS", not both', 400);
  }
  const reasonForVisit = input.reasonForVisit.trim();
  if (!reasonForVisit) throw new WalkInError('Enter the reason for the visit', 400);
  // Validated before anything is written, so a mistyped ID never leaves a half-done check-in.
  let identityUpdate: ReturnType<typeof preparePatientIdentity> = {};
  try {
    identityUpdate = input.identity ? preparePatientIdentity(input.identity, 'fillIn') : {};
  } catch (err) {
    if (err instanceof PatientIdentityError) throw new WalkInError(err.message, 400);
    throw err;
  }

  const [clinic, department] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: input.clinicId }, select: { name: true, isActive: true } }),
    findActiveDepartment(input.departmentId, input.clinicId),
  ]);
  if (!clinic || !clinic.isActive) throw new WalkInError('Clinic not found', 404);
  if (!department) throw new WalkInError('Choose a department', 400);

  const privacyNoticeExplained = Boolean(input.privacyNoticeExplained);
  let resolved: { patient: Patient; isNew: boolean };
  if (input.patientId) {
    const picked = await prisma.patient.findFirst({ where: { id: input.patientId, deletedAt: null } });
    if (!picked) throw new WalkInError('Patient not found', 404);
    resolved = { patient: picked, isNew: false };
  } else {
    resolved = await findOrCreatePatient(normalizeWalkInPhone(input.phone as string), input.newPatient, privacyNoticeExplained);
  }
  const { patient, isNew } = resolved;
  const privacyNoticeAckRequired = isNew || (await walkInNeedsPrivacyAck(patient.id, input.clinicId));
  if (privacyNoticeAckRequired && !privacyNoticeExplained) {
    throw new WalkInError(PRIVACY_NOTICE_REQUIRED_MESSAGE, 400);
  }
  const assignedDoctorId = await assignDoctorForCheckIn(input.clinicId, department.id);
  const appointment = await findArrivalMatch(patient.id, input.clinicId, department.id);

  const { checkInId, encounterId, encounterCreatedAt } = await prisma.$transaction(async (tx) => {
    // Serializes check-ins for this patient at this clinic, so a double
    // submit (or two receptionists at once) can't put them in the queue twice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walk-in:${input.clinicId}:${patient.id}`}))`;

    const openVisit = await tx.encounter.findFirst({
      where: { patientId: patient.id, clinicId: input.clinicId, status: { in: ['WAITING', 'IN_CONSULTATION', 'READY_FOR_CHECKOUT'] } },
    });
    if (openVisit) {
      throw new WalkInError(`${patient.firstName} is already in today's queue at this clinic`, 409);
    }
    const awaitingPayment = await tx.checkIn.findFirst({
      where: {
        patientId: patient.id,
        clinicId: input.clinicId,
        status: { in: ['PENDING_PAYMENT', 'FAILED', 'NEEDS_REVIEW'] },
        createdAt: { gte: dayjs().startOf('day').toDate() },
      },
    });
    if (awaitingPayment) {
      throw new WalkInError(
        `${patient.firstName} already checked in remotely today and their payment hasn't gone through. Use "Confirm payment" on the queue instead.`,
        409,
      );
    }

    const checkIn = await tx.checkIn.create({
      data: {
        patientId: patient.id,
        clinicId: input.clinicId,
        departmentId: department.id,
        staffId: input.staffId,
        source: 'WALK_IN',
        status: 'NO_FEE',
        amountKes: new Prisma.Decimal(0),
        // Required and unique on CheckIn (it's the remote flow's replay
        // guard); a walk-in has no USSD session, so give it its own key.
        ussdSessionId: `WALKIN-${crypto.randomUUID()}`,
        appointmentId: appointment?.id ?? null,
      },
    });
    const encounter = await tx.encounter.create({
      data: {
        patientId: patient.id,
        clinicId: input.clinicId,
        checkInId: checkIn.id,
        assignedDoctorId,
        visitReason: reasonForVisit,
      },
    });
    await tx.clinicPatient.upsert({
      where: { clinicId_patientId: { clinicId: input.clinicId, patientId: patient.id } },
      create: { clinicId: input.clinicId, patientId: patient.id, source: 'VISIT', addedByStaffId: input.staffId },
      update: {},
    });
    if (input.smsOptOut || (input.smsConsent && patient.smsOptOut)) {
      await tx.patient.update({
        where: { id: patient.id },
        data: { smsOptOut: Boolean(input.smsOptOut), smsOptOutUpdatedAt: new Date() },
      });
    }
    if (input.smsConsent) {
      await tx.consent.create({
        data: { patientId: patient.id, type: 'SMS_CLINIC_MESSAGES', granted: true, channel: 'STAFF_ASSISTED', version: CONSENT_VERSION },
      });
    }
    if (Object.keys(identityUpdate).length > 0) {
      await tx.patient.update({ where: { id: patient.id }, data: identityUpdate });
    }
    if (privacyNoticeAckRequired) {
      await recordLegalAcceptances(
        ['PRIVACY_NOTICE'],
        'WALK_IN_CHECKIN',
        { patientId: patient.id, staffId: input.staffId, clinicId: input.clinicId, checkInId: checkIn.id },
        tx,
      );
    }
    return { checkInId: checkIn.id, encounterId: encounter.id, encounterCreatedAt: encounter.createdAt };
  });

  if (appointment) await markAppointmentCompleted(appointment.id);

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    patientId: patient.id,
    action: 'WALK_IN_CHECKED_IN',
    entityType: 'CheckIn',
    entityId: checkInId,
    metadata: {
      patientId: patient.id,
      newPatient: isNew,
      departmentId: department.id,
      smsConsent: input.smsConsent,
      smsOptOut: Boolean(input.smsOptOut),
      appointmentId: appointment?.id ?? null,
      // Which details were added — never the values themselves.
      identityFieldsUpdated: Object.keys(identityUpdate),
    },
  });

  publishWalkInCheckedIn({ checkInId, clinicId: input.clinicId });

  const queuePosition = await prisma.encounter.count({
    where: {
      clinicId: input.clinicId,
      status: 'WAITING',
      checkIn: { departmentId: department.id },
      createdAt: { lte: encounterCreatedAt },
    },
  });

  // The patient's SMS preference after this check-in (ticking either box updates it above).
  const wantsSms = input.smsOptOut ? false : input.smsConsent ? true : !patient.smsOptOut;
  const position = Math.max(queuePosition, 1);
  const sms: WalkInSmsOutcome = wantsSms
    ? await sendQueueJoinSms(patient, encounterId, { id: input.clinicId, name: clinic.name }, position, input.staffId)
    : 'not_requested';

  return {
    checkInId,
    encounterId,
    patientId: patient.id,
    patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    patientCode: patient.patientCode,
    isNewPatient: isNew,
    departmentName: department.name,
    queuePosition: position,
    sms,
  };
}

/** Today's check-ins at a clinic, split by how the patient arrived. Cancelled check-ins aren't counted. */
export async function getTodayCheckInCounts(clinicId: string): Promise<{ walkIn: number; remote: number }> {
  const rows = await prisma.checkIn.groupBy({
    by: ['source'],
    where: { clinicId, createdAt: { gte: dayjs().startOf('day').toDate() }, status: { not: 'CANCELLED' } },
    _count: { _all: true },
  });
  const count = (source: 'WALK_IN' | 'REMOTE') => rows.find((r) => r.source === source)?._count._all ?? 0;
  return { walkIn: count('WALK_IN'), remote: count('REMOTE') };
}
