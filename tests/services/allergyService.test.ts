jest.mock('../../src/db/prisma', () => ({
  prisma: { patientAllergy: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() } },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/recordSharingService', () => ({ crossClinicAccessBasis: jest.fn(async () => null) }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { crossClinicAccessBasis } from '../../src/services/recordSharingService';
import { listAllergiesForClinic, recordAllergy, removeAllergy } from '../../src/services/allergyService';

const db = prisma.patientAllergy as unknown as Record<string, jest.Mock>;
const row = (over: Record<string, unknown> = {}) => ({
  id: 'a-1',
  patientId: 'p-1',
  clinicId: 'c-1',
  category: 'MEDICATION',
  substance: 'Penicillin',
  reaction: 'Rash',
  severity: 'SEVERE',
  recordedAt: new Date('2026-11-14T08:00:00Z'),
  removedAt: null,
  removedReason: null,
  clinic: { name: 'Sunrise' },
  recordedByStaff: { name: 'Dr A' },
  removedByStaff: null,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

it('records an allergy, tidies the text, and audits IDs only (never the substance)', async () => {
  db.create!.mockImplementation(async ({ data }) => row(data));
  const a = await recordAllergy({ patientId: 'p-1', clinicId: 'c-1', staffId: 'doc-1', category: 'MEDICATION', substance: '  Penicillin   V ', reaction: '', severity: 'SEVERE' });
  expect(db.create!.mock.calls[0][0].data).toMatchObject({ substance: 'Penicillin V', reaction: null, recordedByStaffId: 'doc-1' });
  expect(a.isOwnClinic).toBe(true);
  const audit = (recordAuditEvent as jest.Mock).mock.calls[0][0];
  expect(audit).toMatchObject({ action: 'ALLERGY_RECORDED', metadata: { patientId: 'p-1', category: 'MEDICATION', severity: 'SEVERE' } });
  expect(JSON.stringify(audit)).not.toContain('Penicillin');
});

it('needs a substance', async () => {
  await expect(recordAllergy({ patientId: 'p-1', clinicId: 'c-1', staffId: 'd', category: 'FOOD', substance: '  ', severity: 'MILD' })).rejects.toMatchObject({ status: 400 });
  expect(db.create).not.toHaveBeenCalled();
});

it("removing keeps the record (with who, when, why) and only works on this clinic's own allergies", async () => {
  db.findFirst!.mockResolvedValue(row());
  db.update!.mockImplementation(async ({ data }) => row({ ...data, removedByStaff: { name: 'Dr B' } }));
  const a = await removeAllergy({ allergyId: 'a-1', patientId: 'p-1', clinicId: 'c-1', staffId: 'doc-2', reason: 'Recorded in error' });
  expect(db.findFirst!.mock.calls[0][0].where).toEqual({ id: 'a-1', patientId: 'p-1', clinicId: 'c-1', removedAt: null });
  expect(db.update!.mock.calls[0][0].data).toMatchObject({ removedByStaffId: 'doc-2', removedReason: 'Recorded in error' });
  expect(a.removedReason).toBe('Recorded in error');
  expect(prisma.patientAllergy).not.toHaveProperty('delete');
  await expect(removeAllergy({ allergyId: 'a-1', patientId: 'p-1', clinicId: 'c-1', staffId: 'd', reason: '' })).rejects.toMatchObject({ status: 400 });
});

it("other clinics' allergies are shown only on a sharing basis", async () => {
  db.findMany!.mockResolvedValue([row(), row({ id: 'a-2', clinicId: 'c-2', clinic: { name: 'Other' } })]);
  const hidden = await listAllergiesForClinic('p-1', 'c-1');
  expect(hidden.allergies.map((a) => a.id)).toEqual(['a-1']);
  expect(hidden.hiddenElsewhere).toBe(true);
  (crossClinicAccessBasis as jest.Mock).mockResolvedValue('STANDING_CONSENT');
  const shared = await listAllergiesForClinic('p-1', 'c-1');
  expect(shared.allergies.map((a) => a.id)).toEqual(['a-1', 'a-2']);
  expect(shared.hiddenElsewhere).toBe(false);
});
