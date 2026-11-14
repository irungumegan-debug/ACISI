import { prisma } from '../db/prisma';
import { ageInYears } from './labService';
import { parseDiagnosisCodes } from './icd11Service';
import { EVENT_TYPES, eventsBetween } from './publicHealthEventService';

/**
 * Routine reports (monthly, quarterly, annual): what the clinic did in a
 * period, and the IDSR monthly reportable diseases.
 *
 * The disease list follows the Kenya IDSR Technical Guidelines, 3rd edition
 * (MOH, 2022), section 2.3.6 and its table "Diseases and conditions requiring
 * Monthly reporting": total cases per period; leprosy and tuberculosis are
 * quarterly. Each is mapped to WHO ICD-11 codes (checked against the bundled
 * file by tests/services/routineReports.test.ts). A code matches a stem or
 * its subcodes. Conditions a diagnosis code can't show (road traffic
 * injuries, severity) are said so on the report.
 */

export type ReportPeriod = 'MONTH' | 'QUARTER' | 'YEAR';

export interface MonthlyDisease {
  id: string;
  /** As written in the guidelines' monthly table. */
  name: string;
  /** Quarterly in the guidelines (leprosy, tuberculosis). */
  quarterly?: boolean;
  icd11: string[];
  /** Count a patient only the first time they get this diagnosis at this clinic. */
  newCasesOnly?: boolean;
  /** Only patients younger than this. Unknown age is counted, under "age unknown". */
  underAgeYears?: number;
  /** The visit must also carry one of these codes (e.g. dehydration with diarrhoea). */
  alsoNeeds?: string[];
  /** Empty icd11 and this set: count by hand. */
  note?: string;
}

const DIARRHOEA = ['ME05.1', '1A40', '1A21', '1A22', '1A06'];

export const MONTHLY_DISEASES: MonthlyDisease[] = [
  { id: 'viral-hepatitis', name: 'Acute and chronic viral hepatitis', icd11: ['1E50', '1E51'] },
  { id: 'diabetes-new', name: 'Diabetes mellitus (New cases)', icd11: ['5A10', '5A11', '5A13', '5A14'], newCasesOnly: true },
  {
    id: 'diarrhoea-dehydration-u5',
    name: 'Diarrhea with severe dehydration in children under 5 years of age',
    icd11: DIARRHOEA,
    alsoNeeds: ['5C70.0'],
    underAgeYears: 5,
    note: 'ACISI counts diarrhoea coded together with dehydration (5C70.0); it can’t tell how severe the dehydration was.',
  },
  { id: 'cancer-breast', name: 'Cancer (Breast)', icd11: ['2C60', '2C61', '2C62', '2C63', '2C64', '2C6Y', '2C6Z'] },
  { id: 'cancer-prostate', name: 'Cancer (Prostate)', icd11: ['2C82'] },
  { id: 'cancer-cervical', name: 'Cancer (Cervical)', icd11: ['2C77'] },
  { id: 'cancer-oesophageal', name: 'Cancer (Esophageal)', icd11: ['2B70'] },
  { id: 'hiv-new', name: 'HIV/AIDS (New Cases)', icd11: ['1C60', '1C61', '1C62'], newCasesOnly: true },
  { id: 'hypertension-new', name: 'Hypertension (New cases)', icd11: ['BA00', 'BA01', 'BA02', 'BA03', 'BA04'], newCasesOnly: true },
  { id: 'rta-injuries', name: 'Injuries (Road Traffic Accidents)', icd11: [], note: 'A diagnosis code doesn’t say how an injury happened: count road traffic injuries by hand.' },
  { id: 'leishmaniasis', name: 'Leishmaniasis', icd11: ['1F54'] },
  { id: 'leprosy', name: 'Leprosy (quarterly)', quarterly: true, icd11: ['1B20'] },
  { id: 'lymphatic-filariasis', name: 'Lymphatic Filariasis', icd11: ['1F66.3'] },
  { id: 'malaria', name: 'Malaria', icd11: ['1F40', '1F41', '1F42', '1F43', '1F44', '1F45', '1F4Z'] },
  { id: 'malnutrition-u5', name: 'Malnutrition in children under 5 years', icd11: ['5B50', '5B51', '5B52'], underAgeYears: 5 },
  { id: 'epilepsy', name: 'Epilepsy', icd11: ['8A60', '8A61', '8A62', '8A6Z'] },
  { id: 'onchocerciasis', name: 'Onchocerciasis', icd11: ['1F6A'] },
  {
    id: 'pneumonia-u5',
    name: 'Severe pneumonia in children under 5 years of age',
    icd11: ['CA40'],
    underAgeYears: 5,
    note: 'ACISI counts all pneumonia in children under 5; it can’t tell which cases were severe.',
  },
  {
    id: 'sti',
    name: 'Sexually transmitted infections (STIs)',
    icd11: ['1A60', '1A61', '1A62', '1A63', '1A6Z', '1A70', '1A71', '1A72', '1A73', '1A7Z', '1A80', '1A81', '1A8Y', '1A8Z', '1A90', '1A91', '1A92', '1A93', '1A94', '1A95', '1A9Y', '1A9Z'],
  },
  { id: 'schistosomiasis', name: 'Schistosomiasis', icd11: ['1F86'] },
  { id: 'trachoma', name: 'Trachoma', icd11: ['1C23'] },
  { id: 'trypanosomiasis', name: 'Trypanosomiasis', icd11: ['1F51'] },
  { id: 'tuberculosis', name: 'Tuberculosis (quarterly)', quarterly: true, icd11: ['1B10', '1B11', '1B12', '1B13', '1B1Y', '1B1Z'] },
];

/** Same rule as notifiable diseases: equal, or a subcode ("1F40.Z" of "1F40", "1D01.00" of "1D01.0"). */
export function codeMatches(code: string, stem: string): boolean {
  return stem.includes('.') ? code.startsWith(stem) : code === stem || code.startsWith(`${stem}.`);
}
const anyMatch = (codes: string[], stems: string[]) => codes.some((c) => stems.some((s) => codeMatches(c, s)));

// ---- Periods (Kenya time, UTC+3, no daylight saving) ------------------

const KENYA_MS = 3 * 60 * 60 * 1000;

export interface PeriodBounds {
  period: ReportPeriod;
  /** e.g. "2026-11", "2026-Q4", "2026". */
  value: string;
  label: string;
  /** Kenya dates, inclusive start / exclusive end. */
  startDate: string;
  endDate: string;
  from: Date;
  to: Date;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export class InvalidPeriodError extends Error {}

export function parsePeriod(period: string, value: string): PeriodBounds {
  let y: number;
  let startMonth: number;
  let months: number;
  let label: string;
  if (period === 'MONTH' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    y = Number(value.slice(0, 4));
    startMonth = Number(value.slice(5)) - 1;
    months = 1;
    label = `${MONTHS[startMonth]} ${y}`;
  } else if (period === 'QUARTER' && /^\d{4}-Q[1-4]$/.test(value)) {
    y = Number(value.slice(0, 4));
    const q = Number(value.slice(6));
    startMonth = (q - 1) * 3;
    months = 3;
    label = `Q${q} ${y} (${MONTHS[startMonth]}–${MONTHS[startMonth + 2]})`;
  } else if (period === 'YEAR' && /^\d{4}$/.test(value)) {
    y = Number(value);
    startMonth = 0;
    months = 12;
    label = String(y);
  } else {
    throw new InvalidPeriodError('Choose a month (YYYY-MM), a quarter (YYYY-Q1 to Q4) or a year (YYYY)');
  }
  if (y < 2020 || y > 2100) throw new InvalidPeriodError('Choose a year between 2020 and 2100');
  const start = new Date(Date.UTC(y, startMonth, 1));
  const end = new Date(Date.UTC(y, startMonth + months, 1));
  return {
    period: period as ReportPeriod,
    value,
    label,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    from: new Date(start.getTime() - KENYA_MS),
    to: new Date(end.getTime() - KENYA_MS),
  };
}

/** The last complete month in Kenya time, e.g. "2026-10" on 14 Nov 2026. */
export function lastFullMonth(now: Date = new Date()): string {
  const k = new Date(now.getTime() + KENYA_MS);
  const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

// ---- The report --------------------------------------------------------

export interface CountRow {
  label: string;
  count: number;
}

export interface DiseaseRow {
  id: string;
  name: string;
  quarterly: boolean;
  countedByAcisi: boolean;
  note: string | null;
  under5: number;
  fiveAndOver: number;
  ageUnknown: number;
  total: number;
}

export interface RoutineReport {
  clinicName: string;
  county: string | null;
  period: ReportPeriod;
  value: string;
  label: string;
  startDate: string;
  endDate: string;
  visits: { total: number; completed: number; walkIn: number; remote: number };
  patients: { seen: number; newToClinic: number; returning: number };
  bySex: CountRow[];
  byAge: CountRow[];
  byDepartment: CountRow[];
  topDiagnoses: { code: string; title: string; count: number }[];
  /** Visits signed before ICD-11 coding (text diagnosis only), not in the disease counts. */
  visitsWithoutCodes: number;
  lab: { ordersRequested: number; testsDone: number; abnormal: number; critical: number };
  prescriptions: { visitsWithPrescription: number; medicineLines: number; topMedicines: CountRow[] };
  notifiable: { immediate: number; weekly: number; byDisease: CountRow[] };
  events: { total: number; cases: number; deaths: number; byType: CountRow[] };
  monthlyDiseases: DiseaseRow[];
}

const AGE_BANDS: [string, number, number][] = [
  ['Under 5', 0, 5],
  ['5–17', 5, 18],
  ['18–59', 18, 60],
  ['60 and over', 60, 1000],
];

const SEX_LABEL: Record<string, string> = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other', UNKNOWN: 'Not recorded' };

function tally(values: string[]): CountRow[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function buildRoutineReport(clinicId: string, p: PeriodBounds): Promise<RoutineReport> {
  const [clinic, encounters, notifiable, events] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true, county: true } }),
    prisma.encounter.findMany({
      where: { clinicId, createdAt: { gte: p.from, lt: p.to } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        patientId: true,
        status: true,
        createdAt: true,
        consultedAt: true,
        diagnosisCodes: true,
        prescription: true,
        patient: { select: { dateOfBirth: true, sex: true } },
        checkIn: { select: { source: true, department: { select: { name: true } } } },
        labOrders: { select: { items: { select: { resultValue: true, resultFlag: true } } } },
        prescriptionItems: { select: { drugName: true } },
      },
    }),
    prisma.notifiableDiseaseCase.findMany({ where: { clinicId, diagnosedAt: { gte: p.from, lt: p.to } }, select: { diseaseName: true, reporting: true } }),
    eventsBetween(clinicId, p.startDate, p.endDate),
  ]);

  const patientIds = [...new Set(encounters.map((e) => e.patientId))];
  // Earlier visits at this clinic: who is new, and which diagnoses each patient already had.
  const earlier = patientIds.length
    ? await prisma.encounter.findMany({
        where: { clinicId, patientId: { in: patientIds }, createdAt: { lt: p.from } },
        select: { patientId: true, diagnosisCodes: true },
      })
    : [];
  const seenBefore = new Set(earlier.map((e) => e.patientId));
  const hadBefore = new Map<string, string[]>();
  for (const e of earlier) hadBefore.set(e.patientId, [...(hadBefore.get(e.patientId) ?? []), ...parseDiagnosisCodes(e.diagnosisCodes).map((c) => c.code)]);

  // Each patient once per period for the people counts.
  const firstVisit = new Map<string, (typeof encounters)[number]>();
  for (const e of encounters) if (!firstVisit.has(e.patientId)) firstVisit.set(e.patientId, e);
  const people = [...firstVisit.values()];

  const ageBand = (dob: Date | null, at: Date) => {
    const a = ageInYears(dob, at);
    return a === null ? 'Not recorded' : AGE_BANDS.find(([, lo, hi]) => a >= lo && a < hi)![0];
  };

  // Diagnoses and the monthly diseases.
  const diagCount = new Map<string, { title: string; count: number }>();
  let visitsWithoutCodes = 0;
  const rows: DiseaseRow[] = MONTHLY_DISEASES.map((d) => ({
    id: d.id,
    name: d.name,
    quarterly: Boolean(d.quarterly),
    countedByAcisi: d.icd11.length > 0,
    note: d.note ?? null,
    under5: 0,
    fiveAndOver: 0,
    ageUnknown: 0,
    total: 0,
  }));
  const counted = new Map<string, Set<string>>(); // disease id -> patients already counted as new this period
  for (const e of encounters) {
    const codes = parseDiagnosisCodes(e.diagnosisCodes);
    if (codes.length === 0) {
      if (e.consultedAt) visitsWithoutCodes++;
      continue;
    }
    for (const c of codes) diagCount.set(c.code, { title: c.title, count: (diagCount.get(c.code)?.count ?? 0) + 1 });
    const list = codes.map((c) => c.code);
    const age = ageInYears(e.patient.dateOfBirth, e.createdAt);
    MONTHLY_DISEASES.forEach((d, i) => {
      if (d.icd11.length === 0 || !anyMatch(list, d.icd11)) return;
      if (d.alsoNeeds && !anyMatch(list, d.alsoNeeds)) return;
      if (d.underAgeYears !== undefined && age !== null && age >= d.underAgeYears) return;
      if (d.newCasesOnly) {
        if (anyMatch(hadBefore.get(e.patientId) ?? [], d.icd11)) return; // diagnosed here before this period
        const done = counted.get(d.id) ?? new Set<string>();
        if (done.has(e.patientId)) return; // already counted this period
        done.add(e.patientId);
        counted.set(d.id, done);
      }
      const row = rows[i]!;
      if (age === null) row.ageUnknown++;
      else if (age < 5) row.under5++;
      else row.fiveAndOver++;
      row.total++;
    });
  }

  const labItems = encounters.flatMap((e) => e.labOrders.flatMap((o) => o.items));
  const rxLines = encounters.flatMap((e) => e.prescriptionItems.map((i) => i.drugName));

  return {
    clinicName: clinic?.name ?? '',
    county: clinic?.county ?? null,
    period: p.period,
    value: p.value,
    label: p.label,
    startDate: p.startDate,
    endDate: p.endDate,
    visits: {
      total: encounters.length,
      completed: encounters.filter((e) => e.status === 'DONE').length,
      walkIn: encounters.filter((e) => e.checkIn.source === 'WALK_IN').length,
      remote: encounters.filter((e) => e.checkIn.source !== 'WALK_IN').length,
    },
    patients: { seen: people.length, newToClinic: people.filter((e) => !seenBefore.has(e.patientId)).length, returning: people.filter((e) => seenBefore.has(e.patientId)).length },
    bySex: tally(people.map((e) => SEX_LABEL[e.patient.sex] ?? e.patient.sex)),
    byAge: tally(people.map((e) => ageBand(e.patient.dateOfBirth, e.createdAt))),
    byDepartment: tally(encounters.map((e) => e.checkIn.department.name)),
    topDiagnoses: [...diagCount.entries()]
      .map(([code, v]) => ({ code, title: v.title, count: v.count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 10),
    visitsWithoutCodes,
    lab: {
      ordersRequested: encounters.reduce((n, e) => n + e.labOrders.length, 0),
      testsDone: labItems.filter((i) => i.resultValue !== null || i.resultFlag !== null).length,
      abnormal: labItems.filter((i) => i.resultFlag === 'ABNORMAL').length,
      critical: labItems.filter((i) => i.resultFlag === 'CRITICAL').length,
    },
    prescriptions: {
      visitsWithPrescription: encounters.filter((e) => e.prescription).length,
      medicineLines: rxLines.length,
      topMedicines: tally(rxLines).slice(0, 10),
    },
    notifiable: {
      immediate: notifiable.filter((n) => n.reporting === 'IMMEDIATE').length,
      weekly: notifiable.filter((n) => n.reporting === 'WEEKLY').length,
      byDisease: tally(notifiable.map((n) => n.diseaseName)),
    },
    events: {
      total: events.length,
      cases: events.reduce((n, e) => n + e.casesCount, 0),
      deaths: events.reduce((n, e) => n + e.deathsCount, 0),
      byType: tally(events.map((e) => EVENT_TYPES[e.type].label)),
    },
    monthlyDiseases: rows,
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function routineReportCsv(r: RoutineReport): string {
  const L: (string | number)[][] = [
    ['ACISI routine report'],
    ['Clinic', r.clinicName],
    ['County', r.county ?? ''],
    ['Period', `${r.label} (${r.startDate} to ${r.endDate}, end exclusive)`],
    [],
    ['VISITS'],
    ['Visits', r.visits.total],
    ['Completed (checked out)', r.visits.completed],
    ['Walk-in', r.visits.walkIn],
    ['Checked in remotely', r.visits.remote],
    ['Patients seen', r.patients.seen],
    ['New to this clinic', r.patients.newToClinic],
    ['Returning', r.patients.returning],
    [],
    ['PATIENTS BY SEX'],
    ...r.bySex.map((x) => [x.label, x.count]),
    [],
    ['PATIENTS BY AGE'],
    ...r.byAge.map((x) => [x.label, x.count]),
    [],
    ['VISITS BY DEPARTMENT'],
    ...r.byDepartment.map((x) => [x.label, x.count]),
    [],
    ['TOP DIAGNOSES (ICD-11)'],
    ['Code', 'Title', 'Visits'],
    ...r.topDiagnoses.map((d) => [d.code, d.title, d.count]),
    ['Visits signed before ICD-11 coding (not counted above)', r.visitsWithoutCodes],
    [],
    ['IDSR MONTHLY REPORTABLE DISEASES (Kenya IDSR Technical Guidelines, 3rd edition)'],
    ['Disease', 'Cases under 5', 'Cases 5 and over', 'Age unknown', 'Total cases', 'Note'],
    ...r.monthlyDiseases.map((d) => (d.countedByAcisi ? [d.name, d.under5, d.fiveAndOver, d.ageUnknown, d.total, d.note ?? ''] : [d.name, 'count by hand', '', '', '', d.note ?? ''])),
    ['Deaths are not recorded on visits; see public health events below.'],
    [],
    ['LABORATORY'],
    ['Lab requests', r.lab.ordersRequested],
    ['Tests with results', r.lab.testsDone],
    ['Abnormal', r.lab.abnormal],
    ['Critical', r.lab.critical],
    [],
    ['PRESCRIPTIONS'],
    ['Visits with a prescription', r.prescriptions.visitsWithPrescription],
    ['Medicine lines', r.prescriptions.medicineLines],
    ...r.prescriptions.topMedicines.map((x) => [x.label, x.count]),
    [],
    ['NOTIFIABLE DISEASES'],
    ['Immediately reportable cases', r.notifiable.immediate],
    ['Weekly reportable cases', r.notifiable.weekly],
    ...r.notifiable.byDisease.map((x) => [x.label, x.count]),
    [],
    ['PUBLIC HEALTH EVENTS'],
    ['Events', r.events.total],
    ['People affected', r.events.cases],
    ['Deaths', r.events.deaths],
    ...r.events.byType.map((x) => [x.label, x.count]),
  ];
  return `${L.map((l) => l.map(csvCell).join(',')).join('\n')}\n`;
}
