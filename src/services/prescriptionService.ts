import { z } from 'zod';
import { prisma } from '../db/prisma';
import { AllergyConflict, findAllergyConflicts } from './medicines';
import { listAllergiesForClinic } from './allergyService';
import { dhaDisplay, ingredientsOf } from './dhaTerminology';

/**
 * Structured prescriptions, shaped after DHA's Kenya ePrescription FHIR
 * guide: each medicine is a line with a DHA Generic Products code (or a
 * typed name for a medicine not on the list), a dose (number + DHA unit), a
 * DHA route, how often, for how long, the quantity to dispense and DHA's
 * coded instructions. The visit's `prescription` text is generated from the
 * lines, so the checkout SMS, the visit record, the portal and billing keep
 * reading one text.
 */

export const FREQUENCIES = {
  OD: { label: 'once a day', perDay: 1, fhir: { frequency: 1, period: 1, periodUnit: 'd', code: 'QD' } },
  BD: { label: 'twice a day', perDay: 2, fhir: { frequency: 2, period: 1, periodUnit: 'd', code: 'BID' } },
  TDS: { label: '3 times a day', perDay: 3, fhir: { frequency: 3, period: 1, periodUnit: 'd', code: 'TID' } },
  QID: { label: '4 times a day', perDay: 4, fhir: { frequency: 4, period: 1, periodUnit: 'd', code: 'QID' } },
  NOCTE: { label: 'at night', perDay: 1, fhir: { frequency: 1, period: 1, periodUnit: 'd', code: null } },
  PRN: { label: 'when needed', perDay: null, fhir: null },
  STAT: { label: 'once, now', perDay: null, fhir: { frequency: 1, period: 1, periodUnit: 'd', code: null } },
  WEEKLY: { label: 'once a week', perDay: null, fhir: { frequency: 1, period: 1, periodUnit: 'wk', code: 'WK' } },
} as const;
export type FrequencyCode = keyof typeof FREQUENCIES;

/** DHA Route of Administration codes offered in the form (labels are DHA's). */
export const ROUTES = [
  'RT10025', // Oral
  'RT10030', // Sublingual
  'RT10031', // Topical
  'RT10024', // Ophthalmic
  'RT10026', // Otic
  'RT10023', // Nasal
  'RT10007', // Inhalation
  'RT10039', // Nebuliser
  'RT10028', // Rectal
  'RT10035', // Vaginal
  'RT10013', // Intramuscular
  'RT10036', // Intravenous
  'RT10029', // Subcutaneous
  'RT10012', // Intradermal
  'RT10032', // Transdermal
  'RT10008', // Injection
  'RT10021', // Miscellaneous
] as const;

/** DHA Unit of Measure codes offered for a dose, with how the line reads. */
export const DOSE_UNITS = {
  UM10415: { one: 'tablet', many: 'tablets' }, // tab
  UM10032: { one: 'capsule', many: 'capsules' }, // cap
  UM10245: { one: 'ml', many: 'ml' },
  UM10216: { one: 'mg', many: 'mg' },
  UM10106: { one: 'g', many: 'g' },
  UM10180: { one: 'mcg', many: 'mcg' },
  UM10451: { one: 'IU', many: 'IU' },
  UM10066: { one: 'drop', many: 'drops' },
  UM10366: { one: 'puff', many: 'puffs' },
  UM10009: { one: 'application', many: 'applications' },
  UM10373: { one: 'sachet', many: 'sachets' },
  UM10405: { one: 'suppository', many: 'suppositories' },
  UM10338: { one: 'patch', many: 'patches' },
  UM10386: { one: 'spray', many: 'sprays' },
  UM10475: { one: 'vial', many: 'vials' },
  UM10007: { one: 'ampoule', many: 'ampoules' },
  UM10064: { one: 'dose', many: 'doses' },
} as const;
export type DoseUnitCode = keyof typeof DOSE_UNITS;
const DOSE_UNIT_CODES = Object.keys(DOSE_UNITS) as [DoseUnitCode, ...DoseUnitCode[]];

export const MAX_PRESCRIPTION_ITEMS = 15;

const text = (max: number) => z.string().trim().max(max);

export const prescriptionItemSchema = z.object({
  /** DHA Generic Products code; the name then comes from DHA's list, not the browser. */
  productCode: z.string().trim().max(20).nullish(),
  /** Only used when no productCode: a medicine not on DHA's list. */
  drugName: text(120).nullish(),
  doseValue: z.number().positive().max(100000),
  doseUnit: z.enum(DOSE_UNIT_CODES),
  route: z.enum(ROUTES),
  frequency: z.enum(Object.keys(FREQUENCIES) as [FrequencyCode, ...FrequencyCode[]]),
  durationDays: z.number().int().min(1).max(365).nullish(),
  quantity: z.number().positive().max(100000).nullish(),
  quantityUnit: z.enum(DOSE_UNIT_CODES).nullish(),
  instructionCodes: z.array(z.string().max(60)).max(5).nullish(),
  instructions: text(300).nullish(),
  /** Required (server-checked) when the line clashes with a recorded allergy. */
  allergyOverrideReason: text(300).nullish(),
});
export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;

export const prescriptionItemsSchema = z.array(prescriptionItemSchema).min(1).max(MAX_PRESCRIPTION_ITEMS);

/** A line with its name resolved from DHA's list and every code checked. */
export interface ResolvedPrescriptionItem {
  productCode: string | null;
  drugName: string;
  doseValue: number;
  doseUnit: DoseUnitCode;
  route: string;
  frequency: FrequencyCode;
  durationDays: number | null;
  quantity: number | null;
  quantityUnit: DoseUnitCode | null;
  instructionCodes: string[];
  instructions: string | null;
  allergyOverrideReason: string | null;
}

export class InvalidPrescriptionError extends Error {}

/** Resolves names from DHA's list and checks every code; throws InvalidPrescriptionError. */
export function resolvePrescriptionItems(items: PrescriptionItemInput[]): ResolvedPrescriptionItem[] {
  return items.map((i, n) => {
    const line = `Medicine ${n + 1}`;
    let drugName: string;
    let productCode: string | null = null;
    if (i.productCode) {
      const name = dhaDisplay('products', i.productCode);
      if (!name) throw new InvalidPrescriptionError(`${line}: ${i.productCode} is not on the DHA medicines list`);
      productCode = i.productCode;
      drugName = name;
    } else {
      if (!i.drugName || i.drugName.length < 2) throw new InvalidPrescriptionError(`${line}: choose a medicine or type its name`);
      drugName = i.drugName;
    }
    const instructionCodes = [...new Set(i.instructionCodes ?? [])];
    for (const c of instructionCodes) {
      if (!dhaDisplay('instructions', c)) throw new InvalidPrescriptionError(`${line}: unknown instruction ${c}`);
    }
    return {
      productCode,
      drugName,
      doseValue: i.doseValue,
      doseUnit: i.doseUnit,
      route: i.route,
      frequency: i.frequency,
      durationDays: i.durationDays ?? null,
      quantity: i.quantity ?? null,
      quantityUnit: i.quantity ? (i.quantityUnit ?? i.doseUnit) : null,
      instructionCodes,
      instructions: i.instructions || null,
      allergyOverrideReason: i.allergyOverrideReason || null,
    };
  });
}

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3))));

function unitWord(code: string, value: number): string {
  const u = DOSE_UNITS[code as DoseUnitCode];
  return u ? (value === 1 ? u.one : u.many) : code;
}

type LineFields = Pick<
  ResolvedPrescriptionItem,
  'drugName' | 'doseValue' | 'doseUnit' | 'route' | 'frequency' | 'durationDays' | 'quantity' | 'quantityUnit' | 'instructionCodes' | 'instructions'
>;

/** "Amoxicillin 500 mg Oral Capsule: 1 capsule 3 times a day for 5 days (15 capsules). Take with or after food." */
export function formatPrescriptionLine(i: LineFields): string {
  const route = i.route === 'RT10025' ? '' : ` (${dhaDisplay('routes', i.route) ?? i.route})`;
  const freq = FREQUENCIES[i.frequency as FrequencyCode]?.label ?? i.frequency;
  const duration = i.durationDays ? ` for ${i.durationDays} day${i.durationDays === 1 ? '' : 's'}` : '';
  const qty = i.quantity ? ` (${num(i.quantity)} ${unitWord(i.quantityUnit ?? i.doseUnit, i.quantity)})` : '';
  const notes = [...i.instructionCodes.map((c) => dhaDisplay('instructions', c) ?? c), ...(i.instructions ? [i.instructions] : [])]
    .map((t) => t.replace(/\.?$/, '.'))
    .join(' ');
  return `${i.drugName}${route}: ${num(i.doseValue)} ${unitWord(i.doseUnit, i.doseValue)} ${freq}${duration}${qty}.${notes ? ` ${notes}` : ''}`;
}

/** The visit's prescription text: one line per medicine, then any general advice. */
export function formatPrescriptionText(items: LineFields[], advice?: string | null): string {
  const lines = items.map(formatPrescriptionLine);
  if (advice?.trim()) lines.push(advice.trim());
  return lines.join('\n');
}

/** Suggested quantity to dispense (dose x times a day x days), for countable units only. */
export function suggestedQuantity(i: Pick<ResolvedPrescriptionItem, 'doseValue' | 'doseUnit' | 'frequency' | 'durationDays'>): number | null {
  const perDay = FREQUENCIES[i.frequency].perDay;
  if (!perDay || !i.durationDays) return i.frequency === 'STAT' ? i.doseValue : null;
  return Math.ceil(i.doseValue * perDay * i.durationDays);
}

export class AllergyOverrideRequiredError extends Error {
  constructor(public conflicts: AllergyConflict[]) {
    super('A medicine clashes with a recorded allergy: change it, or give your reason to prescribe it anyway');
  }
}

/** Current medicine-relevant allergies the doctor can see: the same ones the consultation page shows. */
export async function allergiesToCheck(patientId: string, clinicId: string): Promise<{ id: string; substance: string }[]> {
  const { allergies } = await listAllergiesForClinic(patientId, clinicId);
  return allergies
    .filter((a) => !a.removedAt && a.category !== 'FOOD' && a.category !== 'ENVIRONMENT')
    .map((a) => ({ id: a.id, substance: a.substance }));
}

export function linesForCheck(items: { drugName: string }[]) {
  return items.map((i) => ({ name: i.drugName, ingredients: ingredientsOf(i.drugName) }));
}

/** Clashes between prescription lines and the patient's recorded allergies. */
export async function checkPrescriptionAllergies(patientId: string, clinicId: string, items: { drugName: string }[]): Promise<AllergyConflict[]> {
  return findAllergyConflicts(linesForCheck(items), await allergiesToCheck(patientId, clinicId));
}

/** Every clashing line must carry a reason; throws AllergyOverrideRequiredError listing those that don't. */
export function assertOverridesGiven(items: { allergyOverrideReason: string | null }[], conflicts: AllergyConflict[]): void {
  const missing = conflicts.filter((c) => !items[c.index]?.allergyOverrideReason?.trim());
  if (missing.length > 0) throw new AllergyOverrideRequiredError(missing);
}

/** Rows to save for a visit (an override reason is kept only on lines that clash). */
export function toPrescriptionRows(encounterId: string, items: ResolvedPrescriptionItem[], conflicts: AllergyConflict[]) {
  const clashing = new Set(conflicts.map((c) => c.index));
  return items.map((i, position) => ({
    encounterId,
    position,
    productCode: i.productCode,
    drugName: i.drugName,
    doseValue: i.doseValue,
    doseUnit: i.doseUnit,
    route: i.route,
    frequency: i.frequency,
    durationDays: i.durationDays,
    quantity: i.quantity,
    quantityUnit: i.quantityUnit,
    instructionCodes: i.instructionCodes.length ? i.instructionCodes.join(',') : null,
    instructions: i.instructions,
    allergyOverrideReason: clashing.has(position) ? i.allergyOverrideReason : null,
  }));
}

export interface MedicationView {
  id: string;
  encounterId: string;
  productCode: string | null;
  drugName: string;
  /** Readable line, as on the prescription. */
  text: string;
  prescribedAt: Date;
  /** Last day of the course (null when no duration was given). */
  endsOn: Date | null;
  /** Still within the prescribed course. */
  active: boolean;
  clinicName: string;
  prescribedBy: string | null;
  /** Set when it was prescribed despite a recorded allergy. */
  allergyOverrideReason: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

/** Saved line back to the fields the text needs. */
export function rowToLine(r: {
  drugName: string;
  doseValue: number;
  doseUnit: string;
  route: string;
  frequency: string;
  durationDays: number | null;
  quantity: number | null;
  quantityUnit: string | null;
  instructionCodes: string | null;
  instructions: string | null;
}): LineFields {
  return {
    ...r,
    doseUnit: r.doseUnit as DoseUnitCode,
    frequency: r.frequency as FrequencyCode,
    quantityUnit: r.quantityUnit as DoseUnitCode | null,
    instructionCodes: r.instructionCodes ? r.instructionCodes.split(',') : [],
  };
}

/**
 * Medicines prescribed in the given visits (callers pass only visits the
 * viewer may see), newest first. A course is active until its last day; a
 * line with no duration counts as active for 30 days ("when needed" and
 * long-term medicines), a single "once, now" dose for 1 day.
 */
export async function listMedications(encounterIds: string[], now: Date = new Date()): Promise<MedicationView[]> {
  if (encounterIds.length === 0) return [];
  const rows = await prisma.prescriptionItem.findMany({
    where: { encounterId: { in: encounterIds } },
    orderBy: [{ createdAt: 'desc' }, { position: 'asc' }],
    include: {
      encounter: {
        select: { consultedAt: true, createdAt: true, clinic: { select: { name: true } }, consultedByStaff: { select: { name: true } } },
      },
    },
  });
  return rows.map((r) => {
    const prescribedAt = r.encounter.consultedAt ?? r.encounter.createdAt;
    const days = r.durationDays ?? (r.frequency === 'STAT' ? 1 : 30);
    const lastDay = new Date(prescribedAt.getTime() + days * DAY);
    return {
      id: r.id,
      encounterId: r.encounterId,
      productCode: r.productCode,
      drugName: r.drugName,
      text: formatPrescriptionLine(rowToLine(r)),
      prescribedAt,
      endsOn: r.durationDays ? lastDay : null,
      active: lastDay.getTime() > now.getTime(),
      clinicName: r.encounter.clinic.name,
      prescribedBy: r.encounter.consultedByStaff?.name ?? null,
      allergyOverrideReason: r.allergyOverrideReason,
    };
  });
}
