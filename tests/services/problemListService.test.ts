/** Problem list: ICD-11 coded, no duplicates, every change kept, sharing rule like allergies. */
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/recordSharingService', () => ({ crossClinicAccessBasis: jest.fn(async () => null) }));
type Row = { id: string; patientId: string; clinicId: string; icd11Code: string; problemTitle: string; problemNote: string | null; status: string; onsetDate: Date | null; recordedAt: Date; changes: { action: string; status: string; at: Date; staffId: string }[] };
const rows: Row[] = [];
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    staff: { findMany: jest.fn(async () => [{ id: 'doc-1', name: 'Dr A' }]) },
    patientProblem: {
      findMany: jest.fn(async () => rows),
      findFirst: jest.fn(async ({ where }) => rows.find((r) => r.patientId === where.patientId && r.icd11Code === where.icd11Code && r.status === where.status) ?? null),
      create: jest.fn(async ({ data }) => {
        const { changes, ...rest } = data;
        const row = { id: `pr-${rows.length + 1}`, recordedAt: new Date(), status: 'ACTIVE', ...rest, changes: [{ ...changes.create, at: new Date() }] };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const r = rows.find((x) => x.id === where.id)!;
        const { changes, ...rest } = data;
        Object.assign(r, rest);
        r.changes.push({ ...changes.create, at: new Date() });
        return r;
      }),
    },
  },
}));

import { crossClinicAccessBasis } from '../../src/services/recordSharingService';
import { addProblem, listProblemsForClinic, updateProblem } from '../../src/services/problemListService';

const base = { patientId: 'p1', clinicId: 'c1', staffId: 'doc-1' };
beforeEach(() => {
  rows.length = 0;
  jest.clearAllMocks();
});

it('adds an ICD-11 coded problem with the WHO title; refuses unknown codes and an active duplicate', async () => {
  const { problems } = await addProblem({ ...base, icd11Code: 'ba00', note: 'On amlodipine', onsetDate: '2024-03-01' });
  expect(problems[0]).toMatchObject({ icd11Code: 'BA00', title: 'Essential hypertension', note: 'On amlodipine', status: 'ACTIVE', onsetDate: '2024-03-01' });
  await expect(addProblem({ ...base, icd11Code: 'BA00' })).rejects.toThrow(/already on the list/);
  await expect(addProblem({ ...base, icd11Code: 'ZZZZ' })).rejects.toThrow(/ICD-11 list/);
});

it('resolve, active again, note change and entered in error are all kept in the history', async () => {
  await addProblem({ ...base, icd11Code: 'BA00' });
  await updateProblem({ ...base, problemId: 'pr-1', change: { status: 'RESOLVED' } });
  await updateProblem({ ...base, problemId: 'pr-1', change: { status: 'ACTIVE' } });
  await updateProblem({ ...base, problemId: 'pr-1', change: { note: 'Controlled' } });
  const { problems } = await updateProblem({ ...base, problemId: 'pr-1', change: { status: 'ENTERED_IN_ERROR' } });
  expect(problems[0]!.history.map((h) => h.action)).toEqual(['Added', 'Marked resolved', 'Marked active again', 'Note changed', 'Marked entered in error']);
  await expect(updateProblem({ ...base, problemId: 'pr-1', change: { status: 'ACTIVE' } })).rejects.toThrow(/cannot be changed/);
});

it('another clinic sees the problem only with the patient’s sharing consent', async () => {
  await addProblem({ ...base, icd11Code: 'BA00' });
  expect(await listProblemsForClinic('p1', 'c2')).toEqual({ problems: [], hiddenElsewhere: true });
  (crossClinicAccessBasis as jest.Mock).mockResolvedValueOnce('STANDING_CONSENT');
  expect((await listProblemsForClinic('p1', 'c2')).problems).toHaveLength(1);
});
