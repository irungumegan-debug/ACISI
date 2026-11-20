import { PatientIdType } from '@prisma/client';
import { allStrings, HieError, hieRequest } from './client';

/**
 * DHA HIE Registries API (Facility, Health Worker and Client Registry), as
 * documented at hie-docs.dha.go.ke (Sep 2026). DHA's example answers use
 * placeholder values, so identifiers are picked out defensively and the
 * mapping is checked again in DHA's development environment once ACISI has
 * credentials (see docs/compliance/HIE-integration-plan.md).
 *
 * Data minimisation: the Client Registry answer carries far more than ACISI
 * needs (income, employer, KRA PIN, dependants...). Only the CR ID, names,
 * date of birth and sex are kept from it; the rest is dropped here.
 */

// ---------- Facility Registry ----------

export type FacilityIdentifierType = 'fr-code' | 'mfl' | 'registration-number' | 'license-number' | 'fid';
export const FACILITY_IDENTIFIER_TYPES: readonly FacilityIdentifierType[] = ['fr-code', 'mfl', 'registration-number', 'license-number', 'fid'];

export interface HieFacility {
  frCode: string;
  officialName: string;
  facilityType: string | null;
  kephLevel: string | null;
  county: string | null;
  subCounty: string | null;
  licenceStatus: string | null;
  registrationNumber: string | null;
}

interface RawFacility {
  frCode?: string;
  fidCode?: string;
  officialName?: string;
  facilityType?: string;
  kephLevel?: string;
  facilityLicenseStatus?: string;
  registrationNumber?: string;
  address?: { county?: string; subCounty?: string };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function facilityList(data: unknown): RawFacility[] {
  if (Array.isArray(data)) return data as RawFacility[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['data', 'results', 'facilities', 'entry', 'message']) {
      if (Array.isArray(d[k])) return d[k] as RawFacility[];
    }
    if (d.frCode || d.officialName) return [d as RawFacility];
  }
  return [];
}

export function mapFacility(raw: RawFacility): HieFacility | null {
  const frCode = str(raw.frCode) ?? str(raw.fidCode);
  const officialName = str(raw.officialName);
  if (!frCode || !officialName) return null;
  return {
    frCode,
    officialName,
    facilityType: str(raw.facilityType),
    kephLevel: str(raw.kephLevel),
    county: str(raw.address?.county),
    subCounty: str(raw.address?.subCounty),
    licenceStatus: str(raw.facilityLicenseStatus),
    registrationNumber: str(raw.registrationNumber),
  };
}

export async function searchFacilities(q: { name?: string; identifier?: string; identifierType?: FacilityIdentifierType }): Promise<HieFacility[]> {
  const data = await hieRequest<unknown>({
    method: 'GET',
    path: '/facilities/search',
    query: { name: q.name, identifier: q.identifier, 'identifier-type': q.identifier ? q.identifierType : undefined },
  });
  return facilityList(data)
    .map(mapFacility)
    .filter((f): f is HieFacility => f !== null)
    .slice(0, 20);
}

// ---------- Health Worker Registry ----------

export const HIE_REGULATORS = ['KMPDC', 'COC', 'NCK', 'PPB'] as const;
export type HieRegulator = (typeof HIE_REGULATORS)[number];
export const REGULATOR_LABEL: Record<HieRegulator, string> = {
  KMPDC: 'Kenya Medical Practitioners and Dentists Council',
  COC: 'Clinical Officers Council',
  NCK: 'Nursing Council of Kenya',
  PPB: 'Pharmacy and Poisons Board',
};

export interface HiePractitioner {
  practitionerId: string;
  registeredName: string | null;
  licenceEnd: Date | null;
  active: boolean;
}

const PUID_PATTERN = /^PUID-[\w-]+$/;

export function mapPractitioner(data: unknown): HiePractitioner | null {
  const message = (data as { message?: Record<string, unknown> } | null)?.message ?? (data as Record<string, unknown> | null);
  if (!message || typeof message !== 'object') return null;
  const practitionerId = allStrings(message).find((s) => PUID_PATTERN.test(s));
  if (!practitionerId) return null;
  const membership = (message.membership ?? {}) as { full_name?: string; first_name?: string; last_name?: string; is_active?: number | boolean };
  const licences = Array.isArray(message.licenses) ? (message.licenses as { license_end?: string }[]) : [];
  const ends = licences.map((l) => (l.license_end ? new Date(l.license_end) : null)).filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  const licenceEnd = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
  const name = str(membership.full_name) ?? ([str(membership.first_name), str(membership.last_name)].filter(Boolean).join(' ') || null);
  return { practitionerId, registeredName: name, licenceEnd, active: membership.is_active === undefined ? true : Boolean(membership.is_active) };
}

export async function lookupPractitioner(input: { regulator: HieRegulator; registrationNumber: string; facilityId?: string | null }): Promise<HiePractitioner> {
  const data = await hieRequest<unknown>({
    method: 'GET',
    path: '/professionals',
    query: { identification_number: input.registrationNumber, identification_type: 'registration_number', regulator: input.regulator },
    facilityId: input.facilityId,
  });
  const mapped = mapPractitioner(data);
  if (!mapped) throw new HieError('not_found', 'No practitioner with that registration number was found in the national Health Worker Registry.');
  return mapped;
}

// ---------- Client Registry ----------

/** ACISI's ID document types -> the Client Registry's identification_type. Passports aren't searchable there. */
export const CLIENT_REGISTRY_ID_TYPE: Record<PatientIdType, string | null> = {
  NATIONAL_ID: 'National ID',
  BIRTH_CERTIFICATE: 'Birth Certificate',
  ALIEN_ID: 'Alien ID',
  PASSPORT: null,
};

export interface HieClient {
  crId: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  /** YYYY-MM-DD */
  dateOfBirth: string | null;
  sex: 'MALE' | 'FEMALE' | null;
}

const CR_PATTERN = /^CR[\d-]{6,}$/i;

export function mapClient(data: unknown): HieClient | null {
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  let crId = str(raw.id) && CR_PATTERN.test(String(raw.id)) ? String(raw.id) : null;
  if (!crId && Array.isArray(raw.other_identifications)) {
    const other = (raw.other_identifications as { identification_type?: string; identification_number?: string }[]).find(
      (o) => /client\s*registry|cr\s*id/i.test(o.identification_type ?? '') && str(o.identification_number),
    );
    crId = other ? other.identification_number!.trim() : null;
  }
  if (!crId) return null;
  const dob = str(raw.date_of_birth);
  const gender = (str(raw.gender) ?? '').toLowerCase();
  return {
    crId,
    firstName: str(raw.first_name),
    middleName: str(raw.middle_name),
    lastName: str(raw.last_name),
    dateOfBirth: dob && /^\d{4}-\d{2}-\d{2}/.test(dob) ? dob.slice(0, 10) : null,
    sex: gender.startsWith('m') ? 'MALE' : gender.startsWith('f') ? 'FEMALE' : null,
  };
}

export async function lookupClient(input: { idType: PatientIdType; idNumber: string; facilityId: string }): Promise<HieClient> {
  const identificationType = CLIENT_REGISTRY_ID_TYPE[input.idType];
  if (!identificationType) throw new HieError('invalid', "Passports can't be searched in the national Client Registry. Use a national ID, alien ID or birth certificate.");
  const data = await hieRequest<unknown>({
    method: 'GET',
    path: '/patients',
    query: { identification_number: input.idNumber, identification_type: identificationType },
    facilityId: input.facilityId,
  });
  const mapped = mapClient(data);
  if (!mapped) throw new HieError('not_found', 'No one with that ID was found in the national Client Registry.');
  return mapped;
}

// ---------- Matching ----------

const nameTokens = (...parts: (string | null | undefined)[]) =>
  new Set(
    parts
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );

/**
 * Does the registry record look like this patient? Both of ACISI's names
 * must appear among the registry's names (any order, middle names ignored),
 * and the dates of birth must agree when both are known. Anything else is
 * shown to staff to compare before the CR ID is saved.
 */
export function clientMatchesPatient(client: HieClient, patient: { firstName: string; lastName: string; dateOfBirth: Date | null }): boolean {
  const registry = nameTokens(client.firstName, client.middleName, client.lastName);
  const ours = [...nameTokens(patient.firstName), ...nameTokens(patient.lastName)];
  if (ours.length === 0 || !ours.every((t) => registry.has(t))) return false;
  if (client.dateOfBirth && patient.dateOfBirth) {
    return client.dateOfBirth === patient.dateOfBirth.toISOString().slice(0, 10);
  }
  return true;
}
