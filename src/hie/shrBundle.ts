import type * as fhir4 from 'fhir/r4';
import { AllergyRecord, toAllergyIntolerance, toConditions, toEncounter, toLabResources, toMedicationRequests, VisitRecord } from '../fhir/mappers';

/**
 * One visit as the FHIR "collection" Bundle the Shared Health Record takes
 * (POST /shr/bundles). Built from ACISI's own FHIR mappers, then pointed at
 * the national identifiers:
 * - Patient/<ACISI id>      -> Patient/<Client Registry ID>
 * - Organization/<clinic>   -> Organization/<Facility Registry code>
 * - Practitioner/<staff id> -> Practitioner/<PUID> (or just the name, for
 *   staff who haven't verified their registration)
 * The Encounter references DHA's visit (EpisodeOfCare) and every other
 * resource references the Encounter, as DHA requires. No Patient resource is
 * sent: the Client Registry already holds the demographics.
 */

export interface ShrBundleInput {
  bundleId: string;
  visit: VisitRecord;
  patientId: string;
  crId: string;
  facilityId: string;
  /** DHA's visit id from the consent. */
  episodeOfCareId: string;
  /** ACISI staff id -> PUID, for staff with a verified registration. */
  puids: Map<string, string>;
  /** Staff id -> name, for staff without a PUID. */
  staffNames: Map<string, string>;
  /** Allergies recorded at this clinic for the patient. */
  allergies: AllergyRecord[];
}

const NORMAL: fhir4.Coding = { system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'N', display: 'Normal' };

type Json = unknown;

/** Rewrites every { reference: "Type/id" } in a resource to the national identifiers. */
function rewriteReferences(value: Json, input: ShrBundleInput): Json {
  if (Array.isArray(value)) return value.map((v) => rewriteReferences(v, input));
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, Json>;
  if (typeof obj.reference === 'string') {
    const [type, id] = obj.reference.split('/');
    if (type === 'Patient' && id === input.patientId) return { ...obj, reference: `Patient/${input.crId}` };
    if (type === 'Organization' && id === input.visit.clinicId) return { ...obj, reference: `Organization/${input.facilityId}` };
    if (type === 'Practitioner' && id) {
      const puid = input.puids.get(id);
      if (puid) return { ...obj, reference: `Practitioner/${puid}` };
      const rest = { ...obj };
      delete rest.reference;
      return { ...rest, display: input.staffNames.get(id) ?? 'Clinician' };
    }
  }
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = rewriteReferences(v, input);
  return out;
}

const withLabel = <T extends fhir4.Resource>(r: T): T => ({ ...r, meta: { ...(r.meta ?? {}), security: [NORMAL] } });

export function buildShrBundle(input: ShrBundleInput): fhir4.Bundle & { id: string } {
  const { visit, patientId } = input;
  const encounterRef = { reference: `Encounter/${visit.id}` };
  const encounter: fhir4.Encounter = {
    ...toEncounter(visit, patientId),
    episodeOfCare: [{ reference: `EpisodeOfCare/${input.episodeOfCareId}` }],
  };
  const allergies = input.allergies
    .filter((a) => !a.removedAt)
    .map((a) => ({ ...toAllergyIntolerance(a, patientId), encounter: encounterRef }) as fhir4.AllergyIntolerance);
  const resources: fhir4.FhirResource[] = [
    encounter,
    ...toConditions(visit, patientId),
    ...toMedicationRequests(visit, patientId),
    ...toLabResources(visit, patientId),
    ...allergies,
  ].map((r) => withLabel(rewriteReferences(r, input) as fhir4.FhirResource));
  return {
    resourceType: 'Bundle',
    id: input.bundleId,
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: resources.map((resource) => ({ resource })),
  };
}
