import { summariseNationalRecords } from '../../src/hie/shrRecords';

const searchset = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    { resource: { resourceType: 'Encounter', id: 'e-other', period: { start: '2026-10-01T09:00:00Z' }, serviceProvider: { reference: 'Organization/FID-1', display: 'Kathonzweni HC' }, reasonCode: [{ text: 'Cough' }] } },
    { resource: { resourceType: 'Condition', id: 'c1', recordedDate: '2026-10-01', code: { coding: [{ code: 'CA40', display: 'Pneumonia' }] } } },
    { resource: { resourceType: 'MedicationRequest', id: 'm1', authoredOn: '2026-10-01', medicationCodeableConcept: { text: 'Amoxicillin 500 mg' }, dosageInstruction: [{ text: '1 capsule three times a day for 5 days' }] } },
    { resource: { resourceType: 'Observation', id: 'o1', effectiveDateTime: '2026-09-01', code: { text: 'Haemoglobin' }, valueQuantity: { value: 11.2, unit: 'g/dL' } } },
    { resource: { resourceType: 'Condition', id: 'mine', encounter: { reference: 'Encounter/enc-1' }, code: { text: 'This visit' } } },
  ],
};

it('lists the other facilities’ records newest first, without this visit’s own', () => {
  const items = summariseNationalRecords({ data: searchset }, { excludeEncounterId: 'enc-1' });
  expect(items.map((i) => i.kind)).toEqual(['Visit', 'Diagnosis', 'Medicine', 'Result']);
  expect(items[0]).toMatchObject({ kind: 'Visit', detail: 'Cough', facility: 'Kathonzweni HC' });
  expect(items[1]).toMatchObject({ title: 'Pneumonia', detail: 'CA40' });
  expect(items.find((i) => i.kind === 'Result')).toMatchObject({ detail: '11.2 g/dL' });
  expect(items.some((i) => i.title === 'This visit')).toBe(false);
});

it('copes with an empty or odd answer', () => {
  expect(summariseNationalRecords({})).toEqual([]);
  expect(summariseNationalRecords(null)).toEqual([]);
});
