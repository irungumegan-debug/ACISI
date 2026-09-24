import bcrypt from 'bcrypt';
import { Patient, Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { generatePatientCode } from '../utils/idCodes';
import { CONSENT_VERSION, HISTORY_ENCOUNTER_LIMIT } from '../config/constants';
import { env } from '../config/env';

const MAX_CODE_GENERATION_ATTEMPTS = 10;

export async function findPatientByPhone(phoneNumberE164: string): Promise<Patient | null> {
  return prisma.patient.findUnique({ where: { phoneNumber: phoneNumberE164 } });
}

export async function findPatientByCode(patientCode: string): Promise<Patient | null> {
  return prisma.patient.findUnique({ where: { patientCode } });
}

/** Looks a patient up by phone number or patientCode, whichever the identifier looks like. */
export async function findPatientByPhoneOrCode(identifier: string): Promise<Patient | null> {
  const trimmed = identifier.trim();
  if (/^ACI-/i.test(trimmed)) {
    return findPatientByCode(trimmed.toUpperCase());
  }
  return prisma.patient.findUnique({ where: { phoneNumber: trimmed } }).catch(() => null);
}

async function generateUniquePatientCode(): Promise<string> {
  for (let i = 0; i < MAX_CODE_GENERATION_ATTEMPTS; i++) {
    const code = generatePatientCode();
    const existing = await prisma.patient.findUnique({ where: { patientCode: code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique patient code after several attempts');
}

interface RegisterPatientInput {
  phoneNumberE164: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  sex: Sex;
  consentChannel: string;
  /** Whether this patient consents to cross-clinic record sharing. Defaults to false (not shared) unless explicitly granted. */
  crossClinicConsent: boolean;
  /**
   * A patient registered via USSD check-in hasn't chosen a PIN yet — they set
   * one later via the "forgot PIN" SMS flow. A patient registering through
   * the web portal sets one immediately.
   */
  pin?: string;
  /**
   * Optional, web-portal-only (USSD has no practical way to collect one).
   * Used solely for the staff-initiated visit-summary email at checkout —
   * never for login, never for any other notification.
   */
  email?: string;
}

/**
 * Creates a Patient, their patientCode, and their initial
 * CROSS_CLINIC_RECORD_SHARING consent grant in one transaction. Only call
 * this after consent has already been captured from the user — never create
 * a Patient row speculatively.
 */
export async function registerPatient(input: RegisterPatientInput): Promise<Patient> {
  const patientCode = await generateUniquePatientCode();
  const pinHash = input.pin ? await bcrypt.hash(input.pin, env.STAFF_PIN_SALT_ROUNDS) : null;

  const patient = await prisma.$transaction(async (tx) => {
    const created = await tx.patient.create({
      data: {
        patientCode,
        phoneNumber: input.phoneNumberE164,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        sex: input.sex,
        email: input.email,
        pinHash,
      },
    });

    // Callers only reach registerPatient after the caller-side flow (USSD's
    // CHECKIN_CONSENT, the portal signup form) already gated on this — it's
    // required to have a record at all, so it's always granted by the time
    // we get here. Recorded anyway so there's a full consent audit trail,
    // not just an unlogged in-flow gate.
    await tx.consent.create({
      data: {
        patientId: created.id,
        type: 'PLATFORM_REGISTRATION',
        granted: true,
        channel: input.consentChannel,
        version: CONSENT_VERSION,
      },
    });

    await tx.consent.create({
      data: {
        patientId: created.id,
        type: 'CROSS_CLINIC_RECORD_SHARING',
        granted: input.crossClinicConsent,
        channel: input.consentChannel,
        version: CONSENT_VERSION,
      },
    });

    return created;
  });

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patient.id,
    action: 'PATIENT_REGISTERED',
    entityType: 'Patient',
    entityId: patient.id,
  });

  return patient;
}

export async function verifyPatientPin(patient: Patient, pin: string): Promise<boolean> {
  if (!patient.pinHash) return false;
  const isValid = await bcrypt.compare(pin, patient.pinHash);
  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patient.id,
    action: isValid ? 'PATIENT_LOGIN_SUCCESS' : 'PATIENT_LOGIN_FAILED',
    entityType: 'Patient',
    entityId: patient.id,
  });
  return isValid;
}

export async function setPatientPin(patientId: string, pin: string): Promise<void> {
  const pinHash = await bcrypt.hash(pin, env.STAFF_PIN_SALT_ROUNDS);
  await prisma.patient.update({ where: { id: patientId }, data: { pinHash } });
}

export async function hasActiveDataSharingConsent(patientId: string): Promise<boolean> {
  const latest = await prisma.consent.findFirst({
    where: { patientId, type: 'CROSS_CLINIC_RECORD_SHARING' },
    orderBy: { createdAt: 'desc' },
  });
  return latest?.granted ?? false;
}

interface PortableHistoryEntry {
  clinicName: string;
  visitedAt: Date;
}

/**
 * Returns the patient's recent cross-clinic visit history — the "instant
 * context on a new patient" feature. Callers must have already confirmed
 * hasActiveDataSharingConsent() and must record their own audit event for
 * *why* they're viewing it (who's asking), since that's caller-specific.
 * Deliberately lightweight (clinic + date only, no clinical content) since
 * this is the shape shown to a *third party* (staff at another clinic) —
 * see getOwnVisitHistory for the patient's own full-detail portal view.
 */
export async function getPortableHistory(patientId: string): Promise<PortableHistoryEntry[]> {
  const encounters = await prisma.encounter.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_ENCOUNTER_LIMIT,
    include: { clinic: { select: { name: true } } },
  });

  return encounters.map((e) => ({ clinicName: e.clinic.name, visitedAt: e.createdAt }));
}

export interface OwnVisitHistoryEntry {
  encounterId: string;
  clinicName: string;
  departmentName: string;
  visitedAt: Date;
  diagnosis: string | null;
  prescription: string | null;
}

/**
 * Full visit history for the patient portal's own "My records" page —
 * every clinic they've visited, with the full diagnosis/prescription text
 * from each visit. This is the patient looking at their own data, so unlike
 * getPortableHistory (shared with a *third party's* consent-gated,
 * clinic-name-only view), there's no consent check and no reason to
 * withhold clinical content: a patient always sees everything about their
 * own visits, in full.
 */
export async function getOwnVisitHistory(patientId: string): Promise<OwnVisitHistoryEntry[]> {
  const encounters = await prisma.encounter.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_ENCOUNTER_LIMIT,
    include: { clinic: { select: { name: true } }, checkIn: { include: { department: { select: { name: true } } } } },
  });

  return encounters.map((e) => ({
    encounterId: e.id,
    clinicName: e.clinic.name,
    departmentName: e.checkIn.department.name,
    visitedAt: e.createdAt,
    diagnosis: e.diagnosis,
    prescription: e.prescription,
  }));
}

export interface ScopedHistoryEntry {
  encounterId: string;
  clinicName: string;
  visitedAt: Date;
  diagnosis: string | null;
  prescription: string | null;
  isOwnClinic: boolean;
}

export interface ScopedHistory {
  history: ScopedHistoryEntry[];
  /** True when the patient has encounters at other clinics that exist but aren't shown, because they haven't consented to cross-clinic sharing. */
  hasHiddenHistoryElsewhere: boolean;
}

/**
 * The one place that decides what visit history a *third party* (staff at a
 * clinic, a doctor) gets to see for a given patient: this clinic's own
 * encounters are always visible (it's the clinic's own data about its own
 * patient, not cross-clinic sharing), other clinics' encounters only if the
 * patient has an active CROSS_CLINIC_RECORD_SHARING consent — otherwise the
 * caller just learns that hidden history exists, never its contents.
 * Excludes `excludeEncounterId` so a caller can pass "the encounter I'm
 * already looking at" and get the *other* history around it.
 */
export async function getScopedHistory(
  patientId: string,
  viewingClinicId: string,
  excludeEncounterId?: string,
): Promise<ScopedHistory> {
  const encounters = await prisma.encounter.findMany({
    where: { patientId, id: excludeEncounterId ? { not: excludeEncounterId } : undefined },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_ENCOUNTER_LIMIT,
    include: { clinic: { select: { name: true } } },
  });

  const ownClinicEntries = encounters.filter((e) => e.clinicId === viewingClinicId);
  const otherClinicEntries = encounters.filter((e) => e.clinicId !== viewingClinicId);
  const hasConsent = otherClinicEntries.length > 0 ? await hasActiveDataSharingConsent(patientId) : true;

  const visible = hasConsent ? [...ownClinicEntries, ...otherClinicEntries] : ownClinicEntries;
  visible.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    history: visible.map((e) => ({
      encounterId: e.id,
      clinicName: e.clinic.name,
      visitedAt: e.createdAt,
      diagnosis: e.diagnosis,
      prescription: e.prescription,
      isOwnClinic: e.clinicId === viewingClinicId,
    })),
    hasHiddenHistoryElsewhere: !hasConsent && otherClinicEntries.length > 0,
  };
}
