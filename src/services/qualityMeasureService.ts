import { prisma } from '../db/prisma';
import { parseDiagnosisCodes } from './icd11Service';
import { codeMatches, PeriodBounds } from './routineReportService';
import { ageInMonths } from './vitalAssessment';

/**
 * Quality-of-care measures for one clinic and period, calculated from what
 * staff record in ACISI (diagnoses, vital signs, lab requests and results,
 * times). Each is a numerator over a denominator with a plain definition;
 * a measure with no eligible visits shows "n/a". Counts only, no patient
 * names. Based on common primary care indicators (WHO "test before treat"
 * for malaria, BP monitoring in hypertension, MUAC screening of children).
 */

export interface QualityMeasure {
  id: string;
  name: string;
  definition: string;
  /** "Higher is better" for every percentage; for times, lower is better. */
  kind: 'percent' | 'minutes';
  numerator: number | null;
  denominator: number | null;
  /** Percent (0-100, one decimal) or median minutes; null when nothing to measure. */
  value: number | null;
}

const HYPERTENSION = ['BA00', 'BA01', 'BA02', 'BA03', 'BA04'];
const MALARIA = ['1F40', '1F41', '1F42', '1F43', '1F44', '1F45'];
const DIABETES = ['5A10', '5A11', '5A12', '5A13', '5A14'];
const MALARIA_TEST = /malaria|mrdt|\brdt\b|\bbs\b|blood\s*slide|\bmps\b/i;
const GLUCOSE_TEST = /glucose|sugar|\brbs\b|\bfbs\b|hba1c/i;

const has = (codes: string[], stems: string[]) => codes.some((c) => stems.some((s) => codeMatches(c, s)));
const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

export async function buildQualityMeasures(clinicId: string, p: PeriodBounds): Promise<{ label: string; startDate: string; endDate: string; measures: QualityMeasure[] }> {
  const encounters = await prisma.encounter.findMany({
    where: { clinicId, createdAt: { gte: p.from, lt: p.to } },
    select: {
      id: true,
      createdAt: true,
      consultedAt: true,
      diagnosisCodes: true,
      patient: { select: { dateOfBirth: true } },
      vitalSigns: { select: { systolic: true, diastolic: true, muacCm: true } },
      labOrders: { select: { requestedAt: true, completedAt: true, status: true, items: { select: { testName: true } } } },
      prescriptionItems: { select: { id: true } },
    },
  });

  const signed = encounters.filter((e) => e.consultedAt);
  const codesOf = (e: (typeof encounters)[number]) => parseDiagnosisCodes(e.diagnosisCodes).map((c) => c.code);
  const tests = (e: (typeof encounters)[number]) => e.labOrders.flatMap((o) => o.items.map((i) => i.testName));

  const coded = signed.filter((e) => codesOf(e).length > 0);
  const withVitals = signed.filter((e) => e.vitalSigns.length > 0);
  const htn = signed.filter((e) => has(codesOf(e), HYPERTENSION));
  const htnBp = htn.filter((e) => e.vitalSigns.some((v) => v.systolic != null && v.diastolic != null));
  const malaria = signed.filter((e) => has(codesOf(e), MALARIA));
  const malariaTested = malaria.filter((e) => tests(e).some((t) => MALARIA_TEST.test(t)));
  const diabetes = signed.filter((e) => has(codesOf(e), DIABETES));
  const diabetesTested = diabetes.filter((e) => tests(e).some((t) => GLUCOSE_TEST.test(t)));
  const children = signed.filter((e) => {
    const m = ageInMonths(e.patient.dateOfBirth, e.createdAt);
    return m !== null && m >= 6 && m < 60;
  });
  const childrenMuac = children.filter((e) => e.vitalSigns.some((v) => v.muacCm != null));
  const waits = signed.map((e) => (e.consultedAt!.getTime() - e.createdAt.getTime()) / 60000).filter((m) => m >= 0 && m < 24 * 60);
  const turnaround = encounters
    .flatMap((e) => e.labOrders)
    .filter((o) => o.status === 'RESULTS_READY' && o.completedAt)
    .map((o) => (o.completedAt!.getTime() - o.requestedAt.getTime()) / 60000)
    .filter((m) => m >= 0 && m < 7 * 24 * 60);

  const percent = (id: string, name: string, definition: string, n: number, d: number): QualityMeasure => ({ id, name, definition, kind: 'percent', numerator: n, denominator: d, value: pct(n, d) });

  return {
    label: p.label,
    startDate: p.startDate,
    endDate: p.endDate,
    measures: [
      percent('coded-diagnosis', 'Visits with a coded diagnosis', 'Signed consultations with at least one ICD-11 diagnosis code.', coded.length, signed.length),
      percent('vitals-recorded', 'Visits with vital signs recorded', 'Signed consultations with at least one set of vital signs.', withVitals.length, signed.length),
      percent('htn-bp', 'Hypertension visits with BP measured', 'Visits with a hypertension diagnosis (ICD-11 BA00-BA04) where blood pressure was recorded.', htnBp.length, htn.length),
      percent('malaria-tested', 'Malaria diagnoses confirmed by a test', 'Visits with a malaria diagnosis (ICD-11 1F40-1F45) that had a malaria test requested (WHO "test before treat").', malariaTested.length, malaria.length),
      percent('diabetes-glucose', 'Diabetes visits with blood sugar tested', 'Visits with a diabetes diagnosis (ICD-11 5A10-5A14) that had a glucose or HbA1c test requested.', diabetesTested.length, diabetes.length),
      percent('child-muac', 'Children 6-59 months screened with MUAC', 'Signed visits of children aged 6 to 59 months where MUAC was measured.', childrenMuac.length, children.length),
      { id: 'wait-time', name: 'Median wait to see the doctor', definition: 'Minutes from check-in to the signed consultation (median).', kind: 'minutes', numerator: null, denominator: waits.length, value: median(waits) },
      { id: 'lab-turnaround', name: 'Median lab turnaround', definition: 'Minutes from the lab request to signed results (median).', kind: 'minutes', numerator: null, denominator: turnaround.length, value: median(turnaround) },
    ],
  };
}

export function qualityMeasuresCsv(clinicName: string, r: Awaited<ReturnType<typeof buildQualityMeasures>>): string {
  const rows: (string | number)[][] = [
    ['ACISI quality measures'],
    ['Clinic', clinicName],
    ['Period', `${r.label} (${r.startDate} to ${r.endDate}, end exclusive)`],
    [],
    ['Measure', 'Numerator', 'Denominator', 'Value', 'Unit', 'Definition'],
    ...r.measures.map((m) => [m.name, m.numerator ?? '', m.denominator ?? '', m.value ?? 'n/a', m.kind === 'percent' ? '%' : 'minutes', m.definition]),
  ];
  return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n') + '\n';
}
