import { ProblemStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { lookupIcd11 } from './icd11Service';
import { crossClinicAccessBasis } from './recordSharingService';

/**
 * The patient's problem list: conditions that matter beyond one visit
 * (hypertension, diabetes, asthma, HIV...), coded with ICD-11. Doctors add
 * problems, mark them resolved or active again, edit the note, or mark one
 * entered in error. Nothing is deleted and every change is kept, so the
 * history of each problem can be read back. Sharing between clinics: the
 * same rule as allergies (own clinic always; others on the patient's
 * sharing consent or a records code used today).
 */

export const PROBLEM_NOTE_MAX = 300;

export class ProblemListError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ProblemListError';
  }
}

export interface ProblemView {
  id: string;
  icd11Code: string;
  title: string;
  note: string | null;
  status: ProblemStatus;
  onsetDate: string | null;
  recordedAt: Date;
  isOwnClinic: boolean;
  history: { action: string; status: ProblemStatus; at: Date; byName: string }[];
}

const ACTION_LABEL: Record<string, string> = {
  ADDED: 'Added',
  RESOLVED: 'Marked resolved',
  REACTIVATED: 'Marked active again',
  NOTE_CHANGED: 'Note changed',
  ENTERED_IN_ERROR: 'Marked entered in error',
};

export async function listProblemsForClinic(patientId: string, clinicId: string): Promise<{ problems: ProblemView[]; hiddenElsewhere: boolean }> {
  const rows = await prisma.patientProblem.findMany({ where: { patientId }, orderBy: { recordedAt: 'desc' }, include: { changes: { orderBy: { at: 'asc' } } } });
  const others = rows.some((r) => r.clinicId !== clinicId);
  const shared = others && (await crossClinicAccessBasis(patientId, clinicId)) !== null;
  const visible = shared ? rows : rows.filter((r) => r.clinicId === clinicId);
  const staff = await prisma.staff.findMany({ where: { id: { in: [...new Set(visible.flatMap((r) => r.changes.map((c) => c.staffId)))] } }, select: { id: true, name: true } });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const order: Record<ProblemStatus, number> = { ACTIVE: 0, RESOLVED: 1, ENTERED_IN_ERROR: 2 };
  return {
    problems: visible
      .map((r) => ({
        id: r.id,
        icd11Code: r.icd11Code,
        title: r.problemTitle,
        note: r.problemNote,
        status: r.status,
        onsetDate: r.onsetDate ? r.onsetDate.toISOString().slice(0, 10) : null,
        recordedAt: r.recordedAt,
        isOwnClinic: r.clinicId === clinicId,
        history: r.changes.map((c) => ({ action: ACTION_LABEL[c.action] ?? c.action, status: c.status, at: c.at, byName: names.get(c.staffId) ?? 'Clinician' })),
      }))
      .sort((a, b) => order[a.status] - order[b.status]),
    hiddenElsewhere: visible.length < rows.length,
  };
}

function cleanNote(note: string | null | undefined): string | null {
  const t = note?.trim().replace(/\s+/g, ' ') ?? '';
  if (!t) return null;
  if (t.length > PROBLEM_NOTE_MAX) throw new ProblemListError(`Keep the note under ${PROBLEM_NOTE_MAX} characters`);
  return t;
}

async function audit(action: string, input: { clinicId: string; staffId: string; patientId: string }, problemId: string) {
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action,
    entityType: 'PatientProblem',
    entityId: problemId,
    metadata: { patientId: input.patientId },
  });
}

export async function addProblem(input: { patientId: string; clinicId: string; staffId: string; icd11Code: string; note?: string | null; onsetDate?: string | null }) {
  const entry = lookupIcd11(input.icd11Code);
  if (!entry) throw new ProblemListError('Choose the condition from the ICD-11 list');
  const onset = input.onsetDate ? new Date(`${input.onsetDate}T00:00:00Z`) : null;
  if (onset && (Number.isNaN(onset.getTime()) || onset.getTime() > Date.now())) throw new ProblemListError('The onset date cannot be in the future');
  const duplicate = await prisma.patientProblem.findFirst({ where: { patientId: input.patientId, icd11Code: entry.code, status: 'ACTIVE' } });
  if (duplicate) throw new ProblemListError('This problem is already on the list as active', 409);
  const row = await prisma.patientProblem.create({
    data: {
      patientId: input.patientId,
      clinicId: input.clinicId,
      icd11Code: entry.code,
      problemTitle: entry.title,
      problemNote: cleanNote(input.note),
      onsetDate: onset,
      recordedByStaffId: input.staffId,
      changes: { create: { clinicId: input.clinicId, staffId: input.staffId, action: 'ADDED', status: 'ACTIVE' } },
    },
  });
  await audit('PROBLEM_ADDED', input, row.id);
  return listProblemsForClinic(input.patientId, input.clinicId);
}

/** Resolve, make active again, mark entered in error, or change the note. Any clinic that can see the problem may update it. */
export async function updateProblem(input: {
  problemId: string;
  patientId: string;
  clinicId: string;
  staffId: string;
  change: { status: ProblemStatus } | { note: string | null };
}) {
  const { problems } = await listProblemsForClinic(input.patientId, input.clinicId);
  const current = problems.find((p) => p.id === input.problemId);
  if (!current) throw new ProblemListError('Problem not found', 404);
  if (current.status === 'ENTERED_IN_ERROR') throw new ProblemListError('A problem entered in error cannot be changed', 409);
  let action: string;
  let data: { status?: ProblemStatus; problemNote?: string | null };
  if ('status' in input.change) {
    if (input.change.status === current.status) throw new ProblemListError('Nothing to change');
    action = input.change.status === 'RESOLVED' ? 'RESOLVED' : input.change.status === 'ACTIVE' ? 'REACTIVATED' : 'ENTERED_IN_ERROR';
    data = { status: input.change.status };
  } else {
    action = 'NOTE_CHANGED';
    data = { problemNote: cleanNote(input.change.note) };
  }
  const newStatus = data.status ?? current.status;
  await prisma.patientProblem.update({
    where: { id: current.id },
    data: { ...data, changes: { create: { clinicId: input.clinicId, staffId: input.staffId, action, status: newStatus } } },
  });
  await audit(`PROBLEM_${action}`, input, current.id);
  return listProblemsForClinic(input.patientId, input.clinicId);
}
