import crypto from 'node:crypto';
import { PatientIdType } from '@prisma/client';
import { prisma } from '../db/prisma';
import { redis } from '../config/redis';
import { encryptionKey, encryptValue, decryptValue } from '../utils/fieldCrypto';
import { recordAuditEvent } from '../services/auditService';
import { HieError } from './client';
import {
  clientMatchesPatient,
  CLIENT_REGISTRY_ID_TYPE,
  HieClient,
  HieFacility,
  HieRegulator,
  lookupClient,
  lookupPractitioner,
  searchFacilities,
} from './registries';

/**
 * What ACISI keeps from the HIE registries, and who may do what:
 * - Clinic admin: finds the clinic in the Facility Registry and saves its FR code.
 * - Doctors and clinical officers: verify their own registration number in the
 *   Health Worker Registry, which gives the practitioner ID (PUID).
 * - Front desk: looks a patient up in the Client Registry by their ID
 *   document; a clear match saves the CR ID, anything else is shown to
 *   staff to compare first.
 * Every lookup is audit-logged (IDs only, never names or ID numbers).
 */

export class HieSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HieSetupError';
  }
}

// ---------- Facility ----------

export async function findFacilities(q: { name?: string; identifier?: string; identifierType?: Parameters<typeof searchFacilities>[0]['identifierType'] }): Promise<HieFacility[]> {
  return searchFacilities(q);
}

export async function setClinicFacility(input: { clinicId: string; staffId: string; frCode: string }): Promise<HieFacility> {
  const frCode = input.frCode.trim().toUpperCase();
  // Look it up again by FR code: the browser's choice is never trusted as is.
  const found = (await searchFacilities({ identifier: frCode, identifierType: 'fr-code' })).find((f) => f.frCode.toUpperCase() === frCode);
  if (!found) throw new HieError('not_found', 'That facility code was not found in the national Facility Registry.');
  await prisma.clinic.update({
    where: { id: input.clinicId },
    data: { hieFacilityId: found.frCode, hieFacilityName: found.officialName, hieFacilityVerifiedAt: new Date() },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'HIE_FACILITY_SET',
    entityType: 'Clinic',
    entityId: input.clinicId,
    metadata: { frCode: found.frCode },
  });
  return found;
}

async function clinicFacilityId(clinicId: string): Promise<string | null> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { hieFacilityId: true } });
  return clinic?.hieFacilityId ?? null;
}

// ---------- Practitioner ----------

export const PRACTITIONER_ROLES: readonly string[] = ['DOCTOR', 'CLINICIAN'];

export async function verifyOwnPractitionerRecord(input: { staffId: string; clinicId: string; regulator: HieRegulator; registrationNumber: string }) {
  const registrationNumber = input.registrationNumber.trim().toUpperCase();
  if (!/^[A-Z0-9/-]{2,30}$/.test(registrationNumber)) throw new HieSetupError('Enter the registration number as it appears on your certificate (letters and numbers).');
  const found = await lookupPractitioner({ regulator: input.regulator, registrationNumber, facilityId: await clinicFacilityId(input.clinicId) });
  const updated = await prisma.staff.update({
    where: { id: input.staffId },
    data: {
      hieRegulator: input.regulator,
      hieRegistrationNumber: registrationNumber,
      hiePractitionerId: found.practitionerId,
      hieRegisteredName: found.registeredName,
      hieLicenceEnd: found.licenceEnd,
      hieVerifiedAt: new Date(),
    },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'HIE_PRACTITIONER_VERIFIED',
    entityType: 'Staff',
    entityId: input.staffId,
    metadata: { regulator: input.regulator, practitionerId: found.practitionerId, licensed: licenceCurrent(found.licenceEnd), active: found.active },
  });
  return practitionerView(updated);
}

function licenceCurrent(end: Date | null, now = new Date()): boolean | null {
  return end ? end.getTime() >= now.getTime() : null;
}

export function practitionerView(staff: {
  hieRegulator: string | null;
  hieRegistrationNumber: string | null;
  hiePractitionerId: string | null;
  hieRegisteredName: string | null;
  hieLicenceEnd: Date | null;
  hieVerifiedAt: Date | null;
}) {
  return {
    regulator: staff.hieRegulator,
    registrationNumber: staff.hieRegistrationNumber,
    practitionerId: staff.hiePractitionerId,
    registeredName: staff.hieRegisteredName,
    licenceEnd: staff.hieLicenceEnd,
    licenceCurrent: licenceCurrent(staff.hieLicenceEnd),
    verifiedAt: staff.hieVerifiedAt,
  };
}

// ---------- Client Registry ----------

const PENDING_TTL_SECONDS = 10 * 60;
const pendingKey = (clinicId: string, patientId: string, staffId: string) => `hie:cr-pending:${clinicId}:${patientId}:${staffId}`;

/** Keyed hash of the ID document a CR ID was found with (keyed, because national ID numbers are easy to guess). */
export function crSourceHash(idType: PatientIdType, idNumber: string): string {
  return crypto.createHmac('sha256', encryptionKey() ?? 'acisi-dev-no-key').update(`hie-cr:${idType}:${idNumber}`).digest('hex');
}

/** The patient's CR ID, only while it still belongs to their current ID document. */
export function patientCrView(patient: { idType: PatientIdType | null; idNumber: string | null; hieCrId: string | null; hieCrSourceHash: string | null; hieCrVerifiedAt: Date | null }) {
  const valid = Boolean(
    patient.hieCrId && patient.idType && patient.idNumber && patient.hieCrSourceHash === crSourceHash(patient.idType, patient.idNumber),
  );
  return {
    crId: valid ? patient.hieCrId : null,
    verifiedAt: valid ? patient.hieCrVerifiedAt : null,
    canLookUp: Boolean(patient.idType && patient.idNumber && CLIENT_REGISTRY_ID_TYPE[patient.idType]),
  };
}

export type ClientLookupResult =
  | { result: 'saved'; crId: string }
  | { result: 'check'; registry: Pick<HieClient, 'firstName' | 'middleName' | 'lastName' | 'dateOfBirth' | 'sex'> };

async function patientAtClinic(patientId: string, clinicId: string) {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null, OR: [{ checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }] },
  });
  if (!patient) throw new HieError('not_found', 'Patient not found');
  return patient;
}

async function saveCrId(patientId: string, crId: string, sourceHash: string) {
  await prisma.patient.update({ where: { id: patientId }, data: { hieCrId: crId, hieCrSourceHash: sourceHash, hieCrVerifiedAt: new Date() } });
}

export async function lookUpPatientInClientRegistry(input: { patientId: string; clinicId: string; staffId: string }): Promise<ClientLookupResult> {
  const patient = await patientAtClinic(input.patientId, input.clinicId);
  if (!patient.idType || !patient.idNumber) throw new HieSetupError("Add the patient's ID document first (national ID, alien ID or birth certificate).");
  const facilityId = await clinicFacilityId(input.clinicId);
  if (!facilityId) throw new HieSetupError("Your clinic admin must first set the clinic's facility code (Settings → National HIE).");

  const audit = (result: string) =>
    recordAuditEvent({
      actorType: 'STAFF',
      actorId: input.staffId,
      staffId: input.staffId,
      clinicId: input.clinicId,
      action: 'HIE_CLIENT_REGISTRY_LOOKUP',
      entityType: 'Patient',
      entityId: patient.id,
      metadata: { result, idType: patient.idType },
    });

  let client: HieClient;
  try {
    client = await lookupClient({ idType: patient.idType, idNumber: patient.idNumber, facilityId });
  } catch (err) {
    if (err instanceof HieError) await audit(err.kind);
    throw err;
  }
  const sourceHash = crSourceHash(patient.idType, patient.idNumber);
  if (clientMatchesPatient(client, patient)) {
    await saveCrId(patient.id, client.crId, sourceHash);
    await audit('saved');
    return { result: 'saved', crId: client.crId };
  }
  await redis.set(pendingKey(input.clinicId, patient.id, input.staffId), encryptValue(JSON.stringify({ crId: client.crId, sourceHash })), 'EX', PENDING_TTL_SECONDS);
  await audit('needs_check');
  const { firstName, middleName, lastName, dateOfBirth, sex } = client;
  return { result: 'check', registry: { firstName, middleName, lastName, dateOfBirth, sex } };
}

/** Staff compared the registry's details with the patient in front of them and confirmed it's the same person. */
export async function confirmPatientClientRegistryMatch(input: { patientId: string; clinicId: string; staffId: string }): Promise<{ crId: string }> {
  const patient = await patientAtClinic(input.patientId, input.clinicId);
  const raw = await redis.get(pendingKey(input.clinicId, patient.id, input.staffId));
  if (!raw) throw new HieSetupError('That lookup has expired. Look the patient up again.');
  const pending = JSON.parse(decryptValue(raw)) as { crId: string; sourceHash: string };
  if (!patient.idType || !patient.idNumber || crSourceHash(patient.idType, patient.idNumber) !== pending.sourceHash) {
    throw new HieSetupError("The patient's ID document changed since the lookup. Look them up again.");
  }
  await saveCrId(patient.id, pending.crId, pending.sourceHash);
  await redis.del(pendingKey(input.clinicId, patient.id, input.staffId));
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'HIE_CLIENT_REGISTRY_CONFIRMED',
    entityType: 'Patient',
    entityId: patient.id,
  });
  return { crId: pending.crId };
}
