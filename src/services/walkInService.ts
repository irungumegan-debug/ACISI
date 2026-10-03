import crypto from 'node:crypto';
import dayjs from 'dayjs';
import { Patient, Prisma, Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { smsClient } from '../config/africastalking';
import { CONSENT_VERSION } from '../config/constants';
import { logger } from '../utils/logger';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { recordAuditEvent } from './auditService';
import { findPatientByPhone, registerPatient } from './patientService';
import { findActiveDepartment } from './departmentService';
import { assignDoctorForCheckIn } from './doctorAssignmentService';
import { findArrivalMatch, markAppointmentCompleted } from './appointmentService';
import { publishWalkInCheckedIn } from './realtimeEvents';
import { buildWalkInInviteSms } from './smsTemplates';

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

export interface WalkInLookupResult {
  phoneNumber: string;
  patient: {
    id: string;
    name: string;
    patientCode: string;
    /** Most recent visit at *this* clinic only — never another clinic's history. */
    lastVisitAt: Date | null;
  } | null;
}

/** Step 1 of the walk-in flow: is there already a patient with this phone number? */
export async function lookupWalkInPatient(rawPhone: string, clinicId: string, staffId: string): Promise<WalkInLookupResult> {
  const phoneNumber = normalizeWalkInPhone(rawPhone);
  const patient = await findPatientByPhone(phoneNumber);
  if (!patient) return { phoneNumber, patient: null };

  const lastVisit = await prisma.encounter.findFirst({
    where: { patientId: patient.id, clinicId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'WALK_IN_PATIENT_LOOKED_UP',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: { clinicId },
  });

  return {
    phoneNumber,
    patient: {
      id: patient.id,
      name: `${patient.firstName} ${patient.lastName}`.trim(),
      patientCode: patient.patientCode,
      lastVisitAt: lastVisit?.createdAt ?? null,
    },
  };
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
  phone: string;
  departmentId: string;
  reasonForVisit: string;
  /** Only used when no patient exists for `phone`; an existing record is always reused, never overwritten. */
  newPatient?: NewWalkInPatientDetails;
  /** "Patient agreed to receive SMS from the clinic" — off unless staff tick it. */
  smsConsent: boolean;
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

/** "Jane Wanjiru Mwangi" -> first "Jane", last "Wanjiru Mwangi". A single name is kept as the first name. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Resolves the optional age / date of birth into the stored date of birth, or throws a WalkInError. */
export function resolveDateOfBirth(details: Pick<NewWalkInPatientDetails, 'dateOfBirth' | 'age'>, now = new Date()): Date | undefined {
  if (details.dateOfBirth) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(details.dateOfBirth);
    const [year, month, day] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [NaN, NaN, NaN];
    const dob = new Date(Date.UTC(year, month - 1, day));
    // Round-trip check rejects impossible dates like 2001-02-30.
    const isRealDate = dob.getUTCFullYear() === year && dob.getUTCMonth() === month - 1 && dob.getUTCDate() === day;
    if (!match || !isRealDate || year < 1900 || dob > now) {
      throw new WalkInError('Enter a valid date of birth', 400);
    }
    return dob;
  }
  if (details.age !== undefined) {
    return new Date(Date.UTC(now.getUTCFullYear() - details.age, 0, 1));
  }
  return undefined;
}

async function findOrCreatePatient(phoneNumber: string, details: NewWalkInPatientDetails | undefined): Promise<{ patient: Patient; isNew: boolean }> {
  const existing = await findPatientByPhone(phoneNumber);
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

  try {
    const patient = await registerPatient({
      phoneNumberE164: phoneNumber,
      firstName,
      lastName,
      dateOfBirth: resolveDateOfBirth(details),
      sex: details.sex ?? 'UNKNOWN',
      consentChannel: 'STAFF_ASSISTED',
      // Cross-clinic sharing stays off by default; the patient can opt in later.
      crossClinicConsent: false,
    });
    return { patient, isNew: true };
  } catch (err) {
    // Another check-in registered this phone number a moment ago: reuse that
    // record rather than failing or creating a second patient.
    if ((err as { code?: string })?.code === 'P2002') {
      const raced = await findPatientByPhone(phoneNumber);
      if (raced) return { patient: raced, isNew: false };
    }
    throw err;
  }
}

/**
 * Africa's Talking resolves even when it rejects a recipient (bad number,
 * no credit, blacklisted), reporting it per recipient instead. Treat the
 * send as failed unless a recipient was actually accepted.
 */
function smsWasAccepted(response: unknown): boolean {
  const recipients = (response as { SMSMessageData?: { Recipients?: { status?: string; statusCode?: number }[] } })
    ?.SMSMessageData?.Recipients;
  if (!Array.isArray(recipients)) return true;
  return recipients.some((r) => r.status === 'Success' || (r.statusCode !== undefined && r.statusCode >= 100 && r.statusCode <= 102));
}

/**
 * Sends the one-off "check in from home next time" invite. Only ever called
 * after the patient's SMS consent has been recorded. Never throws: a failed
 * SMS must not undo or block the check-in, it's just reported back.
 */
async function sendWalkInInvite(patient: Patient, clinicName: string, staffId: string): Promise<WalkInSmsOutcome> {
  try {
    const response = await smsClient.send({ to: [patient.phoneNumber], message: buildWalkInInviteSms(clinicName) });
    if (!smsWasAccepted(response)) throw new Error('SMS rejected by provider');
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      action: 'WALK_IN_INVITE_SMS_SENT',
      entityType: 'Patient',
      entityId: patient.id,
    });
    return 'sent';
  } catch (err) {
    logger.error({ err, patientId: patient.id }, 'Failed to send walk-in invite SMS');
    return 'failed';
  }
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
  const phoneNumber = normalizeWalkInPhone(input.phone);
  const reasonForVisit = input.reasonForVisit.trim();
  if (!reasonForVisit) throw new WalkInError('Enter the reason for the visit', 400);

  const [clinic, department] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: input.clinicId }, select: { name: true, isActive: true } }),
    findActiveDepartment(input.departmentId, input.clinicId),
  ]);
  if (!clinic || !clinic.isActive) throw new WalkInError('Clinic not found', 404);
  if (!department) throw new WalkInError('Choose a department', 400);

  const { patient, isNew } = await findOrCreatePatient(phoneNumber, input.newPatient);
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
        status: { in: ['PENDING_PAYMENT', 'FAILED'] },
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
    if (input.smsConsent) {
      await tx.consent.create({
        data: { patientId: patient.id, type: 'SMS_CLINIC_MESSAGES', granted: true, channel: 'STAFF_ASSISTED', version: CONSENT_VERSION },
      });
    }
    return { checkInId: checkIn.id, encounterId: encounter.id, encounterCreatedAt: encounter.createdAt };
  });

  if (appointment) await markAppointmentCompleted(appointment.id);

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'WALK_IN_CHECKED_IN',
    entityType: 'CheckIn',
    entityId: checkInId,
    metadata: {
      patientId: patient.id,
      newPatient: isNew,
      departmentId: department.id,
      smsConsent: input.smsConsent,
      appointmentId: appointment?.id ?? null,
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

  const sms: WalkInSmsOutcome = input.smsConsent ? await sendWalkInInvite(patient, clinic.name, input.staffId) : 'not_requested';

  return {
    checkInId,
    encounterId,
    patientId: patient.id,
    patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    patientCode: patient.patientCode,
    isNewPatient: isNew,
    departmentName: department.name,
    queuePosition: Math.max(queuePosition, 1),
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
