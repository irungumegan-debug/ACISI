import { buildShrBundle } from '../../src/hie/shrBundle';
import { VisitRecord } from '../../src/fhir/mappers';

const VISIT: VisitRecord = {
  id: 'enc-1',
  status: 'DONE',
  createdAt: new Date('2026-11-20T08:00:00Z'),
  checkedOutAt: new Date('2026-11-20T09:00:00Z'),
  consultedAt: new Date('2026-11-20T08:30:00Z'),
  visitReason: 'Fever',
  diagnosis: 'Uncomplicated malaria',
  diagnosisCodes: [{ code: '1F40', title: 'Malaria due to Plasmodium falciparum' }],
  prescription: null,
  prescriptionItems: [],
  clinicId: 'clinic-1',
  departmentName: 'General',
  doctor: { id: 'doc-1', name: 'Dr A', staffCode: 'ACI-STF-1' },
  labOrders: [
    {
      id: 'lo-1',
      status: 'RESULTS_READY',
      requestedAt: new Date('2026-11-20T08:35:00Z'),
      requestedBy: { id: 'doc-2', name: 'Dr B', staffCode: 'ACI-STF-2' },
      noteForLab: null,
      completedAt: new Date('2026-11-20T08:50:00Z'),
      items: [{ id: 'li-1', testName: 'Malaria RDT', resultValue: 'Positive', resultUnit: null, resultFlag: 'ABNORMAL', resultComment: null }],
    },
  ],
};

const bundle = buildShrBundle({
  bundleId: 'b-1',
  visit: VISIT,
  patientId: 'pat-1',
  crId: 'CR123-4',
  facilityId: 'FID-47-1',
  episodeOfCareId: 'visit-9',
  puids: new Map([['doc-1', 'PUID-1']]),
  staffNames: new Map([['doc-2', 'Dr B']]),
  allergies: [
    { id: 'al-1', category: 'MEDICATION', substance: 'Penicillin', reaction: 'Rash', severity: 'SEVERE', recordedAt: new Date(), recordedBy: { id: 'doc-1', name: 'Dr A', staffCode: 'x' }, removedAt: null },
    { id: 'al-2', category: 'FOOD', substance: 'Old', reaction: null, severity: 'MILD', recordedAt: new Date(), recordedBy: { id: 'doc-1', name: 'Dr A', staffCode: 'x' }, removedAt: new Date() },
  ],
});
const json = JSON.stringify(bundle);
const resources = bundle.entry!.map((e) => e.resource!);

it('is a collection bundle with the given id', () => {
  expect(bundle).toMatchObject({ resourceType: 'Bundle', id: 'b-1', type: 'collection' });
});

it('uses the national ids: CR ID, FR code, PUID; never ACISI internal patient or clinic ids', () => {
  expect(json).toContain('Patient/CR123-4');
  expect(json).toContain('Organization/FID-47-1');
  expect(json).toContain('Practitioner/PUID-1');
  expect(json).not.toContain('Patient/pat-1');
  expect(json).not.toContain('Organization/clinic-1');
});

it('a clinician without a PUID is named, not referenced by ACISI id', () => {
  expect(json).not.toContain('Practitioner/doc-2');
  expect(json).toContain('"display":"Dr B"');
});

it('the Encounter references the HIE visit; every other resource references the Encounter', () => {
  const enc = resources.find((r) => r.resourceType === 'Encounter') as unknown as { episodeOfCare: { reference: string }[] };
  expect(enc.episodeOfCare).toEqual([{ reference: 'EpisodeOfCare/visit-9' }]);
  for (const r of resources.filter((x) => x.resourceType !== 'Encounter')) {
    expect((r as unknown as { encounter?: { reference: string } }).encounter).toEqual({ reference: 'Encounter/enc-1' });
  }
});

it('carries the diagnosis (ICD-11), lab request and result, active allergies only; no Patient resource', () => {
  const types = resources.map((r) => r.resourceType).sort();
  expect(types).toEqual(['AllergyIntolerance', 'Condition', 'Encounter', 'Observation', 'ServiceRequest']);
  expect(json).toContain('1F40');
  expect(json).not.toContain('"Old"');
});

it('labels every resource Normal confidentiality', () => {
  for (const r of resources) expect(r.meta?.security?.[0]?.code).toBe('N');
});
