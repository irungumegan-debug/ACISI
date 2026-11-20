/** Radiology, therapy and other orders: placed before signing, closed once, audited. */
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
const rows: Record<string, unknown>[] = [];
let encounterStatus = 'IN_CONSULTATION';
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findFirst: jest.fn(async () => ({ id: 'enc-1', patientId: 'p1', status: encounterStatus })) },
    staff: { findMany: jest.fn(async () => [{ id: 'doc-1', name: 'Dr A' }]) },
    serviceOrder: {
      create: jest.fn(async ({ data }) => {
        const row = { id: `so-${rows.length + 1}`, status: 'REQUESTED', requestedAt: new Date(), closedAt: null, ...data };
        rows.push(row);
        return row;
      }),
      findMany: jest.fn(async () => rows),
      findFirst: jest.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
      updateMany: jest.fn(async ({ where, data }) => {
        const r = rows.find((x) => x.id === where.id && x.status === where.status);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
  },
}));

import { recordAuditEvent } from '../../src/services/auditService';
import { closeServiceOrder, createServiceOrder } from '../../src/services/serviceOrderService';
import { toServiceOrderRequests, VisitRecord } from '../../src/fhir/mappers';

beforeEach(() => {
  rows.length = 0;
  encounterStatus = 'IN_CONSULTATION';
  jest.clearAllMocks();
});

const base = { encounterId: 'enc-1', clinicId: 'c1', staffId: 'doc-1' };

it('a doctor orders an X-ray; the audit row has the type, not the text', async () => {
  const orders = await createServiceOrder({ ...base, category: 'RADIOLOGY', description: ' Chest X-ray PA ', note: 'Cough 3 weeks', urgent: true });
  expect(orders).toEqual([expect.objectContaining({ categoryLabel: 'Radiology / imaging', description: 'Chest X-ray PA', note: 'Cough 3 weeks', urgent: true, status: 'REQUESTED', requestedByName: 'Dr A' })]);
  const audit = (recordAuditEvent as jest.Mock).mock.calls[0][0];
  expect(audit).toMatchObject({ action: 'SERVICE_ORDER_CREATED', metadata: { category: 'RADIOLOGY' } });
  expect(JSON.stringify(audit)).not.toContain('X-ray');
});

it('needs a description, and only before signing', async () => {
  await expect(createServiceOrder({ ...base, category: 'COUNSELLING', description: '  ' })).rejects.toThrow(/what is ordered/);
  encounterStatus = 'READY_FOR_CHECKOUT';
  await expect(createServiceOrder({ ...base, category: 'COUNSELLING', description: 'HIV counselling' })).rejects.toThrow(/before the consultation is signed/);
});

it('an order is closed once (done or cancelled), never twice', async () => {
  await createServiceOrder({ ...base, category: 'PHYSIOTHERAPY', description: 'Back, 6 sessions' });
  expect((await closeServiceOrder({ ...base, orderId: 'so-1', outcome: 'DONE' }))[0]).toMatchObject({ status: 'DONE' });
  await expect(closeServiceOrder({ ...base, orderId: 'so-1', outcome: 'CANCELLED' })).rejects.toThrow(/already closed/);
});

it('FHIR: a ServiceRequest with a SNOMED CT category, priority and the visit', () => {
  const visit = {
    id: 'enc-1',
    serviceOrders: [
      { id: 'so-1', category: 'NUTRITION', description: 'Diet review', note: null, urgent: false, status: 'DONE', requestedAt: new Date('2026-11-21T08:00:00Z'), requestedBy: { id: 'doc-1', name: 'Dr A', staffCode: 'x' } },
    ],
  } as unknown as VisitRecord;
  expect(toServiceOrderRequests(visit, 'p1')).toEqual([
    expect.objectContaining({
      resourceType: 'ServiceRequest',
      status: 'completed',
      priority: 'routine',
      category: [{ coding: [{ system: 'http://snomed.info/sct', code: '61310001', display: 'Nutrition education' }], text: 'Nutrition / dietetics' }],
      code: { text: 'Diet review' },
      encounter: { reference: 'Encounter/enc-1' },
    }),
  ]);
});

it('FHIR vital signs: LOINC-coded Observations with UCUM units, BP as a panel, BMI worked out', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toVitalSignsObservations } = require('../../src/fhir/mappers') as typeof import('../../src/fhir/mappers');
  const visit = {
    id: 'enc-1',
    vitalSigns: [{ id: 'v1', recordedAt: new Date('2026-11-21T08:00:00Z'), systolic: 120, diastolic: 80, pulse: 72, respiratoryRate: null, temperatureC: 36.8, oxygenSaturation: null, weightKg: 70, heightCm: 175, muacCm: null }],
  } as unknown as VisitRecord;
  const obs = toVitalSignsObservations(visit, 'p1');
  const codes = obs.map((o) => o.code.coding?.[0]?.code);
  expect(codes).toEqual(['85354-9', '8867-4', '8310-5', '29463-7', '8302-2', '39156-5']);
  expect(obs[0]!.component![0]!.valueQuantity).toEqual({ value: 120, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' });
  expect(obs.find((o) => o.id === 'v1-bmi')!.valueQuantity!.value).toBe(22.9);
  expect(obs.every((o) => o.encounter?.reference === 'Encounter/enc-1' && o.category?.[0]?.coding?.[0]?.code === 'vital-signs')).toBe(true);
});
