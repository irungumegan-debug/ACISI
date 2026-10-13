import { ClinicPatientSource, Patient, Prisma, Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { looksLikePatientCode } from '../utils/idCodes';
import { formatDateOfBirth, nameKey, parseDateOfBirth, splitFullName } from '../utils/patientInput';
import { recordAuditEvent } from './auditService';
import { DuplicatePatientError, findPatientByCode, findPatientsByPhone, registerPatient } from './patientService';
import { recordLegalAcceptances } from './legalService';
import { buildRegistrationSms } from './smsTemplates';
import { sendSms } from './smsSender';

/**
 * A clinic's own patient list: "Add patient", phone / ACISI ID lookup, and
 * the link (ClinicPatient) that gives a clinic access to a patient it added
 * before their first visit. A link gives access to the patient's details
 * and to records *this* clinic created — never to other clinics' records,
 * which need the patient's approval (recordAccessService).
 */

/** A problem the front desk can act on; carries the HTTP status the route should use. */
export class PatientRegistryError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
    /** Extra JSON for the client, e.g. the existing patients on a phone number. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PatientRegistryError';
  }
}

/** Prisma filter: patients this clinic may open — linked, or ever checked in / seen here. */
export function clinicCanSeePatientWhere(clinicId: string): Prisma.PatientWhereInput {
  return {
    OR: [{ clinicLinks: { some: { clinicId } } }, { checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }],
  };
}

/** Creates the clinic–patient link if it doesn't exist yet. Never downgrades or changes an existing link. */
export async function ensureClinicLink(
  clinicId: string,
  patientId: string,
  source: ClinicPatientSource,
  addedByStaffId?: string,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  await db.clinicPatient.upsert({
    where: { clinicId_patientId: { clinicId, patientId } },
    create: { clinicId, patientId, source, addedByStaffId },
    update: {},
  });
}

export interface PatientMatch {
  id: string;
  name: string;
  patientCode: string;
  sex: Sex;
  /**
   * Full date of birth (YYYY-MM-DD) only for a patient already linked to
   * this clinic. A lookup by phone can find someone this clinic has never
   * seen; for them only the birth year is shown, and staff ask the patient
   * for the full date.
   */
  dateOfBirth: string | null;
  birthYear: number | null;
  /** Only the year is known (the date was worked out from an age). */
  dateOfBirthEstimated: boolean;
  linkedToClinic: boolean;
  /** Most recent visit at *this* clinic only — never another clinic's history. */
  lastVisitAt: Date | null;
}

export interface PatientLookupResult {
  /** What was searched, normalised: the E.164 number, or the ACISI ID. */
  query: string;
  kind: 'phone' | 'patientCode';
  /** The phone to register a new patient under, when the search was a phone number. */
  phoneNumber: string | null;
  patients: PatientMatch[];
}

function toMatch(p: Patient, linkedIds: Set<string>, lastVisits: Map<string, Date>): PatientMatch {
  const linked = linkedIds.has(p.id);
  return {
    id: p.id,
    name: `${p.firstName} ${p.lastName}`.trim(),
    patientCode: p.patientCode,
    sex: p.sex,
    dateOfBirth: linked && p.dateOfBirth ? formatDateOfBirth(p.dateOfBirth) : null,
    birthYear: p.dateOfBirth ? p.dateOfBirth.getUTCFullYear() : null,
    dateOfBirthEstimated: p.dateOfBirthEstimated,
    linkedToClinic: linked,
    lastVisitAt: lastVisits.get(p.id) ?? null,
  };
}

/**
 * Finds the patient(s) for a phone number (any Kenyan format) or an ACISI
 * ID. A phone can hold several patients, so this always returns a list.
 * Every patient shown is written to the audit log.
 */
export async function lookupPatients(rawQuery: string, clinicId: string, staffId: string): Promise<PatientLookupResult> {
  const trimmed = rawQuery.trim();
  let patients: Patient[];
  let result: Omit<PatientLookupResult, 'patients'>;

  if (looksLikePatientCode(trimmed)) {
    const code = trimmed.toUpperCase();
    const found = await findPatientByCode(code);
    patients = found ? [found] : [];
    result = { query: code, kind: 'patientCode', phoneNumber: null };
  } else {
    let phoneNumber: string;
    try {
      phoneNumber = toE164(trimmed);
    } catch (err) {
      if (err instanceof InvalidPhoneNumberError) {
        throw new PatientRegistryError('Enter a valid Kenyan phone number (e.g. 0712 345 678) or an ACISI ID (e.g. ACS-48217)', 400);
      }
      throw err;
    }
    patients = await findPatientsByPhone(phoneNumber);
    result = { query: phoneNumber, kind: 'phone', phoneNumber };
  }

  if (patients.length === 0) return { ...result, patients: [] };

  const ids = patients.map((p) => p.id);
  const [links, visits] = await Promise.all([
    prisma.patient.findMany({ where: { id: { in: ids }, ...clinicCanSeePatientWhere(clinicId) }, select: { id: true } }),
    prisma.encounter.groupBy({ by: ['patientId'], where: { patientId: { in: ids }, clinicId }, _max: { createdAt: true } }),
  ]);
  const linkedIds = new Set(links.map((l) => l.id));
  const lastVisits = new Map(visits.filter((v) => v._max.createdAt).map((v) => [v.patientId, v._max.createdAt as Date]));

  for (const p of patients) {
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      clinicId,
      patientId: p.id,
      action: 'PATIENT_LOOKED_UP',
      entityType: 'Patient',
      entityId: p.id,
      metadata: { by: result.kind },
    });
  }

  return { ...result, patients: patients.map((p) => toMatch(p, linkedIds, lastVisits)) };
}

export type RegistrationSmsOutcome = 'sent' | 'failed' | 'opted_out';

/**
 * Sends the one registration SMS for this clinic and marks the link as
 * invited. Skipped (and never retried automatically) for a patient who
 * doesn't want SMS. Never throws.
 */
export async function sendRegistrationSms(
  patient: Pick<Patient, 'id' | 'phoneNumber' | 'smsOptOut'>,
  clinic: { id: string; name: string },
  actor: { staffId?: string },
): Promise<RegistrationSmsOutcome> {
  if (patient.smsOptOut) return 'opted_out';
  const ok = await sendSms(patient.phoneNumber, buildRegistrationSms(clinic.name, { replyStop: env.SMS_REPLY_STOP_ENABLED }), {
    purpose: 'registration',
    patientId: patient.id,
  });
  if (!ok) return 'failed';
  await prisma.clinicPatient.updateMany({ where: { clinicId: clinic.id, patientId: patient.id }, data: { invitedAt: new Date() } });
  await recordAuditEvent({
    actorType: actor.staffId ? 'STAFF' : 'SYSTEM',
    actorId: actor.staffId,
    staffId: actor.staffId,
    clinicId: clinic.id,
    patientId: patient.id,
    action: 'REGISTRATION_SMS_SENT',
    entityType: 'Patient',
    entityId: patient.id,
  });
  return 'sent';
}

export interface AddPatientInput {
  clinicId: string;
  staffId: string;
  fullName: string;
  phone: string;
  /** YYYY-MM-DD. Required: it's what the patient confirms at their first portal login. */
  dateOfBirth: string;
  sex: Sex;
  /** The patient agreed to ACISI keeping a record for them — required to register anyone. */
  registrationConsent: boolean;
  /** Staff told the patient how their data is used and where to read the Privacy Notice. */
  privacyNoticeExplained: boolean;
  /** "Patient does not want SMS": no registration SMS, no queue updates. */
  smsOptOut?: boolean;
  /**
   * Staff have seen the other patients already on this phone number and
   * confirm this is a different person (e.g. a child on a parent's phone).
   */
  confirmedNewPersonOnPhone?: boolean;
  /** Skip the registration SMS (the walk-in flow sends its own queue SMS instead). */
  skipRegistrationSms?: boolean;
}

export interface AddPatientResult {
  patient: { id: string; name: string; patientCode: string };
  sms: RegistrationSmsOutcome;
}

/**
 * "Add patient": registers a new patient and links them to this clinic.
 * Before creating, checks the phone number: the exact same person (same
 * name and date of birth) is refused as a duplicate; other people on the
 * number are returned for staff to look at, and creation only goes ahead
 * once staff confirm this is someone different.
 */
export async function addPatient(input: AddPatientInput): Promise<AddPatientResult> {
  let phoneNumber: string;
  try {
    phoneNumber = toE164(input.phone);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) throw new PatientRegistryError('Enter a valid Kenyan phone number, e.g. 0712 345 678', 400);
    throw err;
  }
  const { firstName, lastName } = splitFullName(input.fullName);
  if (firstName.length < 2 || !lastName) throw new PatientRegistryError("Enter the patient's full name (first and last name)", 400);
  const dateOfBirth = parseDateOfBirth(input.dateOfBirth);
  if (!dateOfBirth) throw new PatientRegistryError('Enter a valid date of birth', 400);
  if (!input.registrationConsent) {
    throw new PatientRegistryError('The patient must agree to ACISI keeping a record for them before they can be added', 400);
  }
  if (!input.privacyNoticeExplained) {
    throw new PatientRegistryError('Tell the patient how their data is used and where to read the Privacy Notice, then tick the box to confirm', 400);
  }

  const clinic = await prisma.clinic.findUnique({ where: { id: input.clinicId }, select: { id: true, name: true, isActive: true } });
  if (!clinic || !clinic.isActive) throw new PatientRegistryError('Clinic not found', 404);

  const onPhone = await findPatientsByPhone(phoneNumber);
  const key = nameKey(firstName, lastName);
  const sameDob = (p: Patient) => p.dateOfBirth && formatDateOfBirth(p.dateOfBirth) === formatDateOfBirth(dateOfBirth);
  const duplicate = onPhone.find((p) => nameKey(p.firstName, p.lastName) === key && (sameDob(p) || !p.dateOfBirth));
  if (duplicate) {
    throw new PatientRegistryError(
      `${duplicate.firstName} ${duplicate.lastName} is already registered on this phone number (${duplicate.patientCode})`,
      409,
      { reason: 'duplicate', existing: (await lookupPatients(phoneNumber, input.clinicId, input.staffId)).patients },
    );
  }
  if (onPhone.length > 0 && !input.confirmedNewPersonOnPhone) {
    throw new PatientRegistryError('This phone number already has patients registered on it. Check they are not the same person.', 409, {
      reason: 'phone_has_patients',
      existing: (await lookupPatients(phoneNumber, input.clinicId, input.staffId)).patients,
    });
  }

  let patient: Patient;
  try {
    patient = await registerPatient({
      phoneNumberE164: phoneNumber,
      firstName,
      lastName,
      dateOfBirth,
      sex: input.sex,
      consentChannel: 'STAFF_ASSISTED',
      clinicLink: { clinicId: input.clinicId, source: 'ADDED', addedByStaffId: input.staffId },
    });
  } catch (err) {
    // Someone added the same person a moment ago (double click, two desks).
    if (err instanceof DuplicatePatientError) {
      throw new PatientRegistryError(`${err.existing.firstName} ${err.existing.lastName} is already registered on this phone number (${err.existing.patientCode})`, 409, {
        reason: 'duplicate',
        existing: (await lookupPatients(phoneNumber, input.clinicId, input.staffId)).patients,
      });
    }
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await recordLegalAcceptances(
      ['PRIVACY_NOTICE'],
      'CLINIC_ADDED_PATIENT',
      { patientId: patient.id, staffId: input.staffId, clinicId: input.clinicId },
      tx,
    );
    if (input.smsOptOut) {
      await tx.patient.update({ where: { id: patient.id }, data: { smsOptOut: true, smsOptOutUpdatedAt: new Date() } });
    }
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    patientId: patient.id,
    action: 'PATIENT_ADDED_BY_CLINIC',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: { sharedPhone: onPhone.length > 0, smsOptOut: Boolean(input.smsOptOut) },
  });

  const sms = input.skipRegistrationSms
    ? 'opted_out'
    : await sendRegistrationSms({ ...patient, smsOptOut: Boolean(input.smsOptOut) }, clinic, { staffId: input.staffId });

  return { patient: { id: patient.id, name: `${firstName} ${lastName}`, patientCode: patient.patientCode }, sms };
}

/**
 * Links an existing patient (found by phone or ACISI ID) to this clinic —
 * e.g. someone already registered at another ACISI clinic. Gives this clinic
 * their details only; their records at other clinics stay hidden until the
 * patient approves a "Request past records".
 */
export async function linkExistingPatient(clinicId: string, staffId: string, patientId: string): Promise<{ id: string; name: string; patientCode: string }> {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null } });
  if (!patient) throw new PatientRegistryError('Patient not found', 404);
  await ensureClinicLink(clinicId, patient.id, 'ADDED', staffId);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    patientId: patient.id,
    action: 'PATIENT_LINKED_TO_CLINIC',
    entityType: 'Patient',
    entityId: patient.id,
  });
  return { id: patient.id, name: `${patient.firstName} ${patient.lastName}`.trim(), patientCode: patient.patientCode };
}
