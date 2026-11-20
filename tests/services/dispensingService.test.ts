/** Dispensing at checkout: given (with quantity) or buying elsewhere; correctable; FHIR MedicationDispense. */
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
const item: Record<string, unknown> = {
  id: 'rx-1', encounterId: 'enc-1', position: 0, productCode: 'GE10177', drugName: 'Paracetamol 500 mg Oral Tablet', doseValue: 2, doseUnit: 'TAB', route: 'PO', frequency: 'TDS',
  durationDays: 5, quantity: 30, quantityUnit: 'TAB', instructionCodes: null, instructions: null, dispenseStatus: null, dispensedQuantity: null, dispensedAt: null,
};
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findFirst: jest.fn(async () => ({ id: 'enc-1' })) },
    prescriptionItem: {
      findMany: jest.fn(async () => [item]),
      findFirst: jest.fn(async ({ where }) => (where.id === 'rx-1' ? { ...item } : null)),
      update: jest.fn(async ({ data }) => Object.assign(item, data)),
    },
  },
}));

import { recordAuditEvent } from '../../src/services/auditService';
import { recordDispensing } from '../../src/services/dispensingService';
import { toMedicationDispenses, VisitRecord } from '../../src/fhir/mappers';

const base = { encounterId: 'enc-1', itemId: 'rx-1', clinicId: 'c1', staffId: 's1' };

it('given: defaults to the prescribed quantity; buying elsewhere has none; recording again corrects it', async () => {
  let lines = await recordDispensing({ ...base, status: 'DISPENSED' });
  expect(lines[0]).toMatchObject({ dispenseStatus: 'DISPENSED', dispensedQuantity: 30 });
  lines = await recordDispensing({ ...base, status: 'NOT_DISPENSED' });
  expect(lines[0]).toMatchObject({ dispenseStatus: 'NOT_DISPENSED', dispensedQuantity: null });
  expect((recordAuditEvent as jest.Mock).mock.calls[1][0]).toMatchObject({ action: 'MEDICINE_NOT_DISPENSED', metadata: { corrected: true } });
  await expect(recordDispensing({ ...base, status: 'DISPENSED', quantity: -1 })).rejects.toThrow(/how much/);
  await expect(recordDispensing({ ...base, itemId: 'nope', status: 'DISPENSED' })).rejects.toThrow(/not found/);
});

it('FHIR MedicationDispense: completed with quantity, or declined; linked to the prescription and the visit', () => {
  const visit = { id: 'enc-1', prescriptionItems: [{ ...item, dispenseStatus: 'DISPENSED', dispensedQuantity: 20, dispensedAt: new Date('2026-11-21T10:00:00Z') }] } as unknown as VisitRecord;
  expect(toMedicationDispenses(visit, 'p1')[0]).toMatchObject({
    resourceType: 'MedicationDispense',
    status: 'completed',
    authorizingPrescription: [{ reference: 'MedicationRequest/rx-1' }],
    context: { reference: 'Encounter/enc-1' },
    quantity: { value: 20, code: 'TAB' },
  });
  const declined = { id: 'enc-1', prescriptionItems: [{ ...item, dispenseStatus: 'NOT_DISPENSED' }] } as unknown as VisitRecord;
  expect(toMedicationDispenses(declined, 'p1')[0]).toMatchObject({ status: 'declined' });
});
