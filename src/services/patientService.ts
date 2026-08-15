import { Patient, Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { CONSENT_VERSION, HISTORY_ENCOUNTER_LIMIT } from '../config/constants';

export async function findPatientByPhone(phoneNumberE164: string): Promise<Patient | null> {
  return prisma.patient.findUnique({ where: { phoneNumber: phoneNumberE164 } });
}

interface RegisterPatientInput {
  phoneNumberE164: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  sex: Sex;
  consentChannel: string;
}

/**
 * Creates a Patient and their initial CROSS_CLINIC_RECORD_SHARING consent
 * grant in one transaction. Only call this after consent has already been
 * captured from the user — never create a Patient row speculatively.
 */
export async function registerPatient(input: RegisterPatientInput): Promise<Patient> {
  const patient = await prisma.$transaction(async (tx) => {
    const created = await tx.patient.create({
      data: {
        phoneNumber: input.phoneNumberE164,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        sex: input.sex,
      },
    });

    await tx.consent.create({
      data: {
        patientId: created.id,
        type: 'CROSS_CLINIC_RECORD_SHARING',
        granted: true,
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
