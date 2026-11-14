import type * as fhir4 from 'fhir/r4';
import type { LabResultFlag, PatientIdType, Sex } from '@prisma/client';
import { dhaDisplay, dhaSystem } from '../services/dhaTerminology';
import { formatPrescriptionLine, FREQUENCIES, FrequencyCode, rowToLine } from '../services/prescriptionService';

/**
 * ACISI records as HL7 FHIR R4 resources, for exchange with the Kenya Health
 * Information Exchange. Plain FHIR R4 core resources; the identifier systems
 * below are ACISI's own until DHA confirms the national ones (Client Registry
 * / national ID, KMHFL facility codes) and any Kenyan profiles.
 *
 * Diagnoses are coded with ICD-11 MMS (WHO); prescriptions and lab tests are
 * sent as text (`code.text`) until coded terminologies for them are added.
 */

export const FHIR_BASE_PATH = '/fhir/r4';

/** WHO ICD-11 for Mortality and Morbidity Statistics. */
export const ICD11_MMS_SYSTEM = 'http://id.who.int/icd/release/11/mms';

/** Identifier systems. To be replaced with the national ones DHA specifies. */
export const SYSTEMS = {
  patientCode: 'https://acisi.co.ke/fhir/sid/patient-code',
  nationalId: 'https://acisi.co.ke/fhir/sid/kenya-national-id',
  passport: 'https://acisi.co.ke/fhir/sid/passport',
  birthCertificate: 'https://acisi.co.ke/fhir/sid/kenya-birth-certificate',
  alienId: 'https://acisi.co.ke/fhir/sid/kenya-alien-id',
  clinic: 'https://acisi.co.ke/fhir/sid/clinic',
  staffCode: 'https://acisi.co.ke/fhir/sid/staff-code',
  prescriptionItem: 'https://acisi.co.ke/fhir/sid/prescription-item',
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
  /** ICD-11 MMS codes with WHO titles. */
  diagnosisCodes: { code: string; title: string }[];
  prescription: string | null;
  /** Structured prescription lines (empty for visits before structured prescribing). */
  prescriptionItems: {
    id: string;
    productCode: string | null;
    drugName: string;
    doseValue: number;
    doseUnit: string;
    route: string;
    frequency: string;
    durationDays: number | null;
    quantity: number | null;
    quantityUnit: string | null;
    instructionCodes: string | null;
    instructions: string | null;
  }[];
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

/**
 * One Condition per ICD-11 code (coded with the WHO ICD-11 MMS system), or,
 * for visits recorded before ICD-11 coding, one text-only Condition.
 * The doctor's notes go in Condition.note.
 */
export function toConditions(v: VisitRecord, patientId: string): fhir4.Condition[] {
  const common = (id: string, code: fhir4.CodeableConcept): fhir4.Condition => ({
    resourceType: 'Condition',
    id,
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
    verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis' }] }],
    code,
    subject: ref('Patient', patientId),
    encounter: ref('Encounter', v.id),
    ...(v.consultedAt ? { recordedDate: v.consultedAt.toISOString() } : {}),
    ...(v.doctor ? { recorder: ref('Practitioner', v.doctor.id) } : {}),
    ...(v.diagnosis ? { note: [{ text: v.diagnosis }] } : {}),
  });
  if (v.diagnosisCodes.length > 0) {
    return v.diagnosisCodes.map((d, i) =>
      common(`${v.id}-dx${i + 1}`, { coding: [{ system: ICD11_MMS_SYSTEM, code: d.code, display: d.title }], text: d.title }),
    );
  }
  if (!v.diagnosis) return [];
  const textOnly = common(`${v.id}-dx`, { text: v.diagnosis });
  delete textOnly.note; // the text is already the code; no need to repeat it
  return [textOnly];
}

/**
 * One MedicationRequest per prescribed medicine, following the shape of
 * DHA's Kenya ePrescription guide: medicine coded with DHA's Generic
 * Products list, route and dose units with DHA codes, structured timing,
 * DHA additional-instruction codes and the quantity to dispense. Visits
 * from before structured prescribing are sent as one text-only request.
 */
export function toMedicationRequests(v: VisitRecord, patientId: string): fhir4.MedicationRequest[] {
  const common = {
    resourceType: 'MedicationRequest' as const,
    status: (v.status === 'DONE' ? 'completed' : 'active') as fhir4.MedicationRequest['status'],
    intent: 'order' as const,
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/medicationrequest-category', code: 'outpatient', display: 'Outpatient' }] }],
    subject: ref('Patient', patientId),
    encounter: ref('Encounter', v.id),
    ...(v.consultedAt ? { authoredOn: v.consultedAt.toISOString() } : {}),
    ...(v.doctor ? { requester: ref('Practitioner', v.doctor.id) } : {}),
  };
  if (v.prescriptionItems.length === 0) {
    if (!v.prescription) return [];
    return [{ ...common, id: `${v.id}-rx`, medicationCodeableConcept: { text: v.prescription }, dosageInstruction: [{ text: v.prescription }] }];
  }
  return v.prescriptionItems.map((i) => {
    const line = rowToLine(i);
    const freq = FREQUENCIES[i.frequency as FrequencyCode];
    const unitCode = (code: string) => ({ system: dhaSystem('units'), code, unit: dhaDisplay('units', code) ?? code });
    const repeat: fhir4.TimingRepeat = {
      ...(freq?.fhir ? { frequency: freq.fhir.frequency, period: freq.fhir.period, periodUnit: freq.fhir.periodUnit as fhir4.TimingRepeat['periodUnit'] } : {}),
      ...(i.frequency === 'STAT' ? { count: 1 } : {}),
      ...(i.durationDays ? { boundsDuration: { value: i.durationDays, unit: 'd', system: 'http://unitsofmeasure.org', code: 'd' } } : {}),
    };
    const additional = (i.instructionCodes ? i.instructionCodes.split(',') : []).map((code) => ({
      coding: [{ system: dhaSystem('instructions'), code, display: dhaDisplay('instructions', code) ?? code }],
    }));
    return {
      ...common,
      id: i.id,
      identifier: [{ system: SYSTEMS.prescriptionItem, value: i.id }],
      medicationCodeableConcept: i.productCode
        ? { coding: [{ system: dhaSystem('products'), code: i.productCode, display: i.drugName }], text: i.drugName }
        : { text: i.drugName },
      ...(i.instructions ? { note: [{ text: i.instructions }] } : {}),
      dosageInstruction: [
        {
          text: formatPrescriptionLine(line),
          ...(additional.length ? { additionalInstruction: additional } : {}),
          timing: { repeat, ...(freq?.fhir?.code ? { code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation', code: freq.fhir.code }] } } : {}) },
          ...(i.frequency === 'PRN' ? { asNeededBoolean: true } : {}),
          route: { coding: [{ system: dhaSystem('routes'), code: i.route, display: dhaDisplay('routes', i.route) ?? i.route }] },
          doseAndRate: [{ doseQuantity: { value: i.doseValue, ...unitCode(i.doseUnit) } }],
        },
      ],
      ...(i.quantity
        ? { dispenseRequest: { quantity: { value: i.quantity, ...unitCode(i.quantityUnit ?? i.doseUnit) }, ...(i.durationDays ? { expectedSupplyDuration: { value: i.durationDays, unit: 'd', system: 'http://unitsofmeasure.org', code: 'd' } } : {}) } }
        : {}),
    };
  });
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
    resources.push(...toConditions(v, patient.id));
    resources.push(...toMedicationRequests(v, patient.id));
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
