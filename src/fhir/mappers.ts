import type * as fhir4 from 'fhir/r4';
import type { LabResultFlag, PatientIdType, Sex } from '@prisma/client';

/**
 * ACISI records as HL7 FHIR R4 resources, for exchange with the Kenya Health
 * Information Exchange. Plain FHIR R4 core resources; the identifier systems
 * below are ACISI's own until DHA confirms the national ones (Client Registry
 * / national ID, KMHFL facility codes) and any Kenyan profiles.
 *
 * Diagnoses, prescriptions and lab tests are sent as text (`code.text`) until
 * coded terminologies (ICD-11, LOINC) are added.
 */

export const FHIR_BASE_PATH = '/fhir/r4';

/** Identifier systems. To be replaced with the national ones DHA specifies. */
export const SYSTEMS = {
  patientCode: 'https://acisi.co.ke/fhir/sid/patient-code',
  nationalId: 'https://acisi.co.ke/fhir/sid/kenya-national-id',
  passport: 'https://acisi.co.ke/fhir/sid/passport',
  birthCertificate: 'https://acisi.co.ke/fhir/sid/kenya-birth-certificate',
  alienId: 'https://acisi.co.ke/fhir/sid/kenya-alien-id',
  clinic: 'https://acisi.co.ke/fhir/sid/clinic',
  staffCode: 'https://acisi.co.ke/fhir/sid/staff-code',
} as const;

const ID_SYSTEM: Record<PatientIdType, string> = {
  NATIONAL_ID: SYSTEMS.nationalId,
  PASSPORT: SYSTEMS.passport,
  BIRTH_CERTIFICATE: SYSTEMS.birthCertificate,
  ALIEN_ID: SYSTEMS.alienId,
};

const GENDER: Record<Sex, fhir4.Patient['gender']> = { MALE: 'male', FEMALE: 'female', OTHER: 'other', UNKNOWN: 'unknown' };

/** FHIR date (YYYY-MM-DD) from a stored date-of-birth (UTC midnight). */
function fhirDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface PatientRecord {
  id: string;
  patientCode: string;
  firstName: string;
  lastName: string;
  sex: Sex;
  dateOfBirth: Date | null;
  phoneNumber: string;
  email: string | null;
  idType: PatientIdType | null;
  idNumber: string | null;
  nextOfKinName: string | null;
  nextOfKinPhone: string | null;
  deletedAt: Date | null;
}

export function toPatient(p: PatientRecord): fhir4.Patient {
  const identifier: fhir4.Identifier[] = [{ use: 'usual', system: SYSTEMS.patientCode, value: p.patientCode }];
  if (p.idType && p.idNumber) identifier.push({ use: 'official', system: ID_SYSTEM[p.idType], value: p.idNumber });
  const telecom: fhir4.ContactPoint[] = [{ system: 'phone', value: p.phoneNumber, use: 'mobile' }];
  if (p.email) telecom.push({ system: 'email', value: p.email });
  return {
    resourceType: 'Patient',
    id: p.id,
    active: p.deletedAt === null,
    identifier,
    name: [{ use: 'official', family: p.lastName, given: [p.firstName], text: `${p.firstName} ${p.lastName}`.trim() }],
    gender: GENDER[p.sex],
    ...(p.dateOfBirth ? { birthDate: fhirDate(p.dateOfBirth) } : {}),
    telecom,
    ...(p.nextOfKinName
      ? {
          contact: [
            {
              relationship: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0131', code: 'N', display: 'Next-of-Kin' }] }],
              name: { text: p.nextOfKinName },
              ...(p.nextOfKinPhone ? { telecom: [{ system: 'phone', value: p.nextOfKinPhone }] } : {}),
            },
          ],
        }
      : {}),
  };
}

export function toOrganization(c: { id: string; name: string; county: string | null }): fhir4.Organization {
  return {
    resourceType: 'Organization',
    id: c.id,
    identifier: [{ system: SYSTEMS.clinic, value: c.id }],
    active: true,
    type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/organization-type', code: 'prov', display: 'Healthcare Provider' }] }],
    name: c.name,
    ...(c.county ? { address: [{ text: c.county, country: 'KE' }] } : {}),
  };
}

export function toPractitioner(s: { id: string; name: string; staffCode: string }): fhir4.Practitioner {
  return {
    resourceType: 'Practitioner',
    id: s.id,
    identifier: [{ system: SYSTEMS.staffCode, value: s.staffCode }],
    name: [{ text: s.name }],
  };
}

const ENCOUNTER_STATUS: Record<string, fhir4.Encounter['status']> = {
  WAITING: 'arrived',
  IN_CONSULTATION: 'in-progress',
  AWAITING_LAB: 'in-progress',
  READY_FOR_CHECKOUT: 'in-progress',
  DONE: 'finished',
};

const ref = (type: string, id: string): fhir4.Reference => ({ reference: `${type}/${id}` });

export interface VisitRecord {
  id: string;
  status: string;
  createdAt: Date;
  checkedOutAt: Date | null;
  consultedAt: Date | null;
  visitReason: string | null;
  diagnosis: string | null;
  prescription: string | null;
  clinicId: string;
  departmentName: string;
  doctor: { id: string; name: string; staffCode: string } | null;
  labOrders: {
    id: string;
    status: 'REQUESTED' | 'IN_PROGRESS' | 'RESULTS_READY';
    requestedAt: Date;
    requestedBy: { id: string; name: string; staffCode: string };
    noteForLab: string | null;
    completedAt: Date | null;
    items: { id: string; testName: string; resultValue: string | null; resultUnit: string | null; resultFlag: LabResultFlag | null; resultComment: string | null }[];
  }[];
}

export function toEncounter(v: VisitRecord, patientId: string): fhir4.Encounter {
  return {
    resourceType: 'Encounter',
    id: v.id,
    status: ENCOUNTER_STATUS[v.status] ?? 'unknown',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    serviceType: { text: v.departmentName },
    subject: ref('Patient', patientId),
    serviceProvider: ref('Organization', v.clinicId),
    ...(v.doctor ? { participant: [{ individual: ref('Practitioner', v.doctor.id) }] } : {}),
    period: { start: v.createdAt.toISOString(), ...(v.checkedOutAt ? { end: v.checkedOutAt.toISOString() } : {}) },
    ...(v.visitReason ? { reasonCode: [{ text: v.visitReason }] } : {}),
  };
}

export function toCondition(v: VisitRecord, patientId: string): fhir4.Condition | null {
  if (!v.diagnosis) return null;
  return {
    resourceType: 'Condition',
    id: `${v.id}-dx`,
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
    verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis' }] }],
    code: { text: v.diagnosis },
    subject: ref('Patient', patientId),
    encounter: ref('Encounter', v.id),
    ...(v.consultedAt ? { recordedDate: v.consultedAt.toISOString() } : {}),
    ...(v.doctor ? { recorder: ref('Practitioner', v.doctor.id) } : {}),
  };
}

export function toMedicationRequest(v: VisitRecord, patientId: string): fhir4.MedicationRequest | null {
  if (!v.prescription) return null;
  return {
    resourceType: 'MedicationRequest',
    id: `${v.id}-rx`,
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: { text: v.prescription },
    subject: ref('Patient', patientId),
    encounter: ref('Encounter', v.id),
    ...(v.consultedAt ? { authoredOn: v.consultedAt.toISOString() } : {}),
    ...(v.doctor ? { requester: ref('Practitioner', v.doctor.id) } : {}),
    dosageInstruction: [{ text: v.prescription }],
  };
}

const INTERPRETATION: Record<LabResultFlag, fhir4.Coding> = {
  NORMAL: { system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'N', display: 'Normal' },
  ABNORMAL: { system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'A', display: 'Abnormal' },
  CRITICAL: { system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'AA', display: 'Critical abnormal' },
};

const LAB_CATEGORY: fhir4.CodeableConcept = {
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }],
};

/** One ServiceRequest per test requested, and one Observation per signed result. */
export function toLabResources(v: VisitRecord, patientId: string): (fhir4.ServiceRequest | fhir4.Observation)[] {
  const out: (fhir4.ServiceRequest | fhir4.Observation)[] = [];
  for (const order of v.labOrders) {
    for (const item of order.items) {
      out.push({
        resourceType: 'ServiceRequest',
        id: item.id,
        status: order.status === 'RESULTS_READY' ? 'completed' : 'active',
        intent: 'order',
        category: [{ coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }] }],
        code: { text: item.testName },
        subject: ref('Patient', patientId),
        encounter: ref('Encounter', v.id),
        authoredOn: order.requestedAt.toISOString(),
        requester: ref('Practitioner', order.requestedBy.id),
        ...(order.noteForLab ? { note: [{ text: order.noteForLab }] } : {}),
      });
      if (order.status === 'RESULTS_READY' && (item.resultValue || item.resultFlag)) {
        out.push({
          resourceType: 'Observation',
          id: `${item.id}-result`,
          status: 'final',
          category: [LAB_CATEGORY],
          code: { text: item.testName },
          subject: ref('Patient', patientId),
          encounter: ref('Encounter', v.id),
          basedOn: [ref('ServiceRequest', item.id)],
          ...(order.completedAt ? { issued: order.completedAt.toISOString(), effectiveDateTime: order.completedAt.toISOString() } : {}),
          ...(item.resultValue ? { valueString: [item.resultValue, item.resultUnit].filter(Boolean).join(' ') } : {}),
          ...(item.resultFlag ? { interpretation: [{ coding: [INTERPRETATION[item.resultFlag]] }] } : {}),
          ...(item.resultComment ? { note: [{ text: item.resultComment }] } : {}),
        });
      }
    }
  }
  return out;
}

export interface AllergyRecord {
  id: string;
  category: 'MEDICATION' | 'FOOD' | 'ENVIRONMENT' | 'OTHER';
  substance: string;
  reaction: string | null;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'UNKNOWN';
  recordedAt: Date;
  recordedBy: { id: string; name: string; staffCode: string };
  removedAt: Date | null;
}

const ALLERGY_CATEGORY: Record<AllergyRecord['category'], fhir4.AllergyIntolerance['category']> = {
  MEDICATION: ['medication'],
  FOOD: ['food'],
  ENVIRONMENT: ['environment'],
  OTHER: undefined,
};
const REACTION_SEVERITY: Record<AllergyRecord['severity'], 'mild' | 'moderate' | 'severe' | undefined> = {
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
  UNKNOWN: undefined,
};

/** An allergy as AllergyIntolerance; a removed one is "entered-in-error" with clinical status inactive. */
export function toAllergyIntolerance(a: AllergyRecord, patientId: string): fhir4.AllergyIntolerance {
  const category = ALLERGY_CATEGORY[a.category];
  const severity = REACTION_SEVERITY[a.severity];
  return {
    resourceType: 'AllergyIntolerance',
    id: a.id,
    clinicalStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: a.removedAt ? 'inactive' : 'active' }],
    },
    verificationStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: a.removedAt ? 'entered-in-error' : 'confirmed' }],
    },
    ...(category ? { category } : {}),
    ...(a.severity === 'SEVERE' ? { criticality: 'high' as const } : {}),
    code: { text: a.substance },
    patient: ref('Patient', patientId),
    recordedDate: a.recordedAt.toISOString(),
    recorder: ref('Practitioner', a.recordedBy.id),
    ...(a.reaction || severity
      ? { reaction: [{ manifestation: [{ text: a.reaction ?? 'Not recorded' }], ...(severity ? { severity } : {}) }] }
      : {}),
  };
}

/** A patient's record as a FHIR R4 "searchset" Bundle (the result of Patient/$everything). */
export function patientEverythingBundle(input: {
  baseUrl: string;
  patient: PatientRecord;
  clinics: { id: string; name: string; county: string | null }[];
  visits: VisitRecord[];
  allergies?: AllergyRecord[];
  now?: Date;
}): fhir4.Bundle {
  const { baseUrl, patient, visits } = input;
  const practitioners = new Map<string, { id: string; name: string; staffCode: string }>();
  for (const v of visits) {
    if (v.doctor) practitioners.set(v.doctor.id, v.doctor);
    for (const o of v.labOrders) practitioners.set(o.requestedBy.id, o.requestedBy);
  }
  for (const a of input.allergies ?? []) practitioners.set(a.recordedBy.id, a.recordedBy);
  const resources: fhir4.FhirResource[] = [
    toPatient(patient),
    ...input.clinics.map(toOrganization),
    ...[...practitioners.values()].map(toPractitioner),
    ...(input.allergies ?? []).map((a) => toAllergyIntolerance(a, patient.id)),
  ];
  for (const v of visits) {
    resources.push(toEncounter(v, patient.id));
    const dx = toCondition(v, patient.id);
    if (dx) resources.push(dx);
    const rx = toMedicationRequest(v, patient.id);
    if (rx) resources.push(rx);
    resources.push(...toLabResources(v, patient.id));
  }
  return {
    resourceType: 'Bundle',
    id: `everything-${patient.id}`,
    meta: { lastUpdated: (input.now ?? new Date()).toISOString() },
    type: 'searchset',
    total: resources.length,
    link: [{ relation: 'self', url: `${baseUrl}${FHIR_BASE_PATH}/Patient/${patient.id}/$everything` }],
    entry: resources.map((r) => ({ fullUrl: `${baseUrl}${FHIR_BASE_PATH}/${r.resourceType}/${r.id}`, resource: r, search: { mode: 'match' } })),
  };
}

/** What this server supports (GET /fhir/r4/metadata). */
export function capabilityStatement(baseUrl: string, version: string): fhir4.CapabilityStatement {
  // Only what is actually served: Patient read and $everything. The other
  // resource types are returned inside the $everything Bundle.
  const inBundle = (type: fhir4.CapabilityStatementRestResource['type']): fhir4.CapabilityStatementRestResource => ({
    type,
    documentation: 'Returned within Patient/$everything',
  });
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: '2026-11-14',
    publisher: 'ACISI Healthcare',
    kind: 'instance',
    software: { name: 'ACISI', version },
    implementation: { description: 'ACISI clinic records (Kenya)', url: `${baseUrl}${FHIR_BASE_PATH}` },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json'],
    rest: [
      {
        mode: 'server',
        documentation: 'Access requires an authenticated ACISI clinic staff session; each clinic sees only its own records.',
        security: { description: 'Session cookie for authorised clinic staff. System-to-system authentication for the Kenya HIE to follow DHA specification.' },
        resource: [
          {
            type: 'Patient',
            interaction: [{ code: 'read' }],
            operation: [{ name: 'everything', definition: 'http://hl7.org/fhir/OperationDefinition/Patient-everything' }],
          },
          inBundle('AllergyIntolerance'),
          inBundle('Encounter'),
          inBundle('Condition'),
          inBundle('MedicationRequest'),
          inBundle('ServiceRequest'),
          inBundle('Observation'),
          inBundle('Organization'),
          inBundle('Practitioner'),
        ],
      },
    ],
  };
}
