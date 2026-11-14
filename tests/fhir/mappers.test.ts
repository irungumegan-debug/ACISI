import { capabilityStatement, patientEverythingBundle, SYSTEMS, toPatient, VisitRecord } from '../../src/fhir/mappers';

const PATIENT = {
  id: 'p-1',
  patientCode: 'ACI-AV01',
  firstName: 'Grace',
  lastName: 'Wairimu',
  sex: 'FEMALE' as const,
  dateOfBirth: new Date('1991-03-02T00:00:00Z'),
  phoneNumber: '+254700555201',
  email: null,
  idType: 'NATIONAL_ID' as const,
  idNumber: '12345678',
  nextOfKinName: 'Peter Wairimu',
  nextOfKinPhone: '+254711000111',
  deletedAt: null,
};
const DOCTOR = { id: 'doc-1', name: 'Dr. Kiprono', staffCode: 'ACI-STF-AVGP' };
const VISIT: VisitRecord = {
  id: 'enc-1',
  status: 'DONE',
  createdAt: new Date('2026-11-13T07:00:00Z'),
  checkedOutAt: new Date('2026-11-13T09:00:00Z'),
  consultedAt: new Date('2026-11-13T08:30:00Z'),
  visitReason: 'Fever for 3 days',
  diagnosis: 'Malaria (P. falciparum)',
  prescription: 'Artemether-lumefantrine 80/480 twice daily for 3 days',
  clinicId: 'c-1',
  departmentName: 'General Consultation',
  doctor: DOCTOR,
  labOrders: [
    {
      id: 'lo-1',
      status: 'RESULTS_READY',
      requestedAt: new Date('2026-11-13T07:30:00Z'),
      requestedBy: DOCTOR,
      noteForLab: 'Fasting',
      completedAt: new Date('2026-11-13T08:00:00Z'),
      items: [
        { id: 'li-1', testName: 'Malaria RDT', resultValue: 'Positive', resultUnit: null, resultFlag: 'ABNORMAL', resultComment: null },
        { id: 'li-2', testName: 'Haemoglobin', resultValue: '10.2', resultUnit: 'g/dL', resultFlag: 'CRITICAL', resultComment: 'Repeat' },
      ],
    },
  ],
};

it('maps the patient with the ACISI ID, national ID, gender, birth date and next of kin', () => {
  const p = toPatient(PATIENT);
  expect(p.identifier).toEqual([
    { use: 'usual', system: SYSTEMS.patientCode, value: 'ACI-AV01' },
    { use: 'official', system: SYSTEMS.nationalId, value: '12345678' },
  ]);
  expect(p).toMatchObject({ resourceType: 'Patient', gender: 'female', birthDate: '1991-03-02', active: true });
  expect(p.contact?.[0]).toMatchObject({ name: { text: 'Peter Wairimu' }, telecom: [{ system: 'phone', value: '+254711000111' }] });
});

it("builds Patient/$everything: patient, clinic, doctor, visit, diagnosis, prescription, lab requests and results, all linked", () => {
  const b = patientEverythingBundle({ baseUrl: 'https://acisi.co.ke', patient: PATIENT, clinics: [{ id: 'c-1', name: 'Avyora', county: 'Nairobi' }], visits: [VISIT], now: new Date('2026-11-14T00:00:00Z') });
  expect(b).toMatchObject({ resourceType: 'Bundle', type: 'searchset' });
  const types = b.entry!.map((e) => e.resource!.resourceType);
  expect(types).toEqual(['Patient', 'Organization', 'Practitioner', 'Encounter', 'Condition', 'MedicationRequest', 'ServiceRequest', 'Observation', 'ServiceRequest', 'Observation']);
  expect(b.total).toBe(10);
  // Every reference points at a resource in the bundle.
  const ids = new Set(b.entry!.map((e) => `${e.resource!.resourceType}/${e.resource!.id}`));
  const refs = JSON.stringify(b).match(/"reference":"([^"]+)"/g)!.map((r) => r.slice(13, -1));
  for (const r of refs) expect(ids.has(r)).toBe(true);
  const obs = b.entry!.filter((e) => e.resource!.resourceType === 'Observation').map((e) => e.resource as unknown as { valueString?: string; interpretation?: { coding: { code: string }[] }[] });
  expect(obs[1]).toMatchObject({ valueString: '10.2 g/dL', interpretation: [{ coding: [{ code: 'AA' }] }] });
  expect(b.entry![4]!.resource).toMatchObject({ resourceType: 'Condition', code: { text: 'Malaria (P. falciparum)' } });
});

it('does not send results that are not signed yet', () => {
  const pending = { ...VISIT, labOrders: [{ ...VISIT.labOrders[0]!, status: 'IN_PROGRESS' as const, completedAt: null }] };
  const b = patientEverythingBundle({ baseUrl: '', patient: PATIENT, clinics: [], visits: [pending] });
  expect(b.entry!.some((e) => e.resource!.resourceType === 'Observation')).toBe(false);
  expect(b.entry!.filter((e) => e.resource!.resourceType === 'ServiceRequest').every((e) => (e.resource as unknown as { status: string }).status === 'active')).toBe(true);
});

it('the CapabilityStatement claims FHIR 4.0.1 and only what is served', () => {
  const c = capabilityStatement('https://acisi.co.ke', '0.1.0');
  expect(c.fhirVersion).toBe('4.0.1');
  const patient = c.rest![0]!.resource!.find((r) => r.type === 'Patient')!;
  expect(patient.interaction).toEqual([{ code: 'read' }]);
  expect(patient.operation![0]!.name).toBe('everything');
  for (const r of c.rest![0]!.resource!.filter((x) => x.type !== 'Patient')) expect(r.interaction).toBeUndefined();
});

it('maps allergies to AllergyIntolerance; a removed one is entered-in-error and inactive', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toAllergyIntolerance } = require('../../src/fhir/mappers') as typeof import('../../src/fhir/mappers');
  const base = { id: 'al-1', category: 'MEDICATION' as const, substance: 'Penicillin', reaction: 'Rash', severity: 'SEVERE' as const, recordedAt: new Date('2026-11-14T08:00:00Z'), recordedBy: DOCTOR, removedAt: null };
  expect(toAllergyIntolerance(base, 'p-1')).toMatchObject({
    resourceType: 'AllergyIntolerance',
    clinicalStatus: { coding: [{ code: 'active' }] },
    verificationStatus: { coding: [{ code: 'confirmed' }] },
    category: ['medication'],
    criticality: 'high',
    code: { text: 'Penicillin' },
    reaction: [{ manifestation: [{ text: 'Rash' }], severity: 'severe' }],
  });
  expect(toAllergyIntolerance({ ...base, removedAt: new Date() }, 'p-1')).toMatchObject({
    clinicalStatus: { coding: [{ code: 'inactive' }] },
    verificationStatus: { coding: [{ code: 'entered-in-error' }] },
  });
});
