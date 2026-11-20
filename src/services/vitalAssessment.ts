/**
 * Vital signs: BMI, plausibility ranges, and warnings for readings outside
 * the usual ranges, adjusted for age (clinical decision support). Thresholds
 * follow widely used WHO guidance: WHO BMI categories for adults, WHO IMCI
 * fast-breathing cut-offs and MUAC cut-offs for children 6-59 months, and
 * common adult triage ranges for BP, pulse, temperature and oxygen. They
 * prompt the clinician to look again; they never decide anything.
 */

export interface VitalValues {
  systolic?: number | null;
  diastolic?: number | null;
  pulse?: number | null;
  respiratoryRate?: number | null;
  temperatureC?: number | null;
  oxygenSaturation?: number | null;
  weightKg?: number | null;
  heightCm?: number | null;
  muacCm?: number | null;
}

export type VitalField = keyof VitalValues | 'bmi';

export interface VitalWarning {
  field: VitalField;
  level: 'danger' | 'warning';
  message: string;
}

/** Accepted ranges (anything outside is almost certainly a typing mistake). */
export const VITAL_LIMITS: Record<keyof VitalValues, { min: number; max: number; label: string; unit: string; integer: boolean }> = {
  systolic: { min: 50, max: 300, label: 'Systolic BP', unit: 'mmHg', integer: true },
  diastolic: { min: 20, max: 200, label: 'Diastolic BP', unit: 'mmHg', integer: true },
  pulse: { min: 20, max: 250, label: 'Pulse', unit: '/min', integer: true },
  respiratoryRate: { min: 4, max: 100, label: 'Breathing rate', unit: '/min', integer: true },
  temperatureC: { min: 30, max: 45, label: 'Temperature', unit: '°C', integer: false },
  oxygenSaturation: { min: 50, max: 100, label: 'Oxygen saturation', unit: '%', integer: true },
  weightKg: { min: 0.3, max: 400, label: 'Weight', unit: 'kg', integer: false },
  heightCm: { min: 20, max: 250, label: 'Height', unit: 'cm', integer: false },
  muacCm: { min: 5, max: 60, label: 'MUAC', unit: 'cm', integer: false },
};

/** Problems with the numbers themselves (out of range, BP the wrong way round). Empty = fine. */
export function vitalInputProblems(v: VitalValues): string[] {
  const problems: string[] = [];
  for (const [key, lim] of Object.entries(VITAL_LIMITS) as [keyof VitalValues, (typeof VITAL_LIMITS)[keyof VitalValues]][]) {
    const value = v[key];
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value) || value < lim.min || value > lim.max) problems.push(`${lim.label} must be between ${lim.min} and ${lim.max} ${lim.unit}`);
    else if (lim.integer && !Number.isInteger(value)) problems.push(`${lim.label} is a whole number`);
  }
  if ((v.systolic == null) !== (v.diastolic == null)) problems.push('Enter both numbers of the blood pressure');
  if (v.systolic != null && v.diastolic != null && v.diastolic >= v.systolic) problems.push('Diastolic BP must be lower than systolic');
  const hasAny = (Object.keys(VITAL_LIMITS) as (keyof VitalValues)[]).some((k) => v[k] != null);
  if (!hasAny) problems.push('Enter at least one measurement');
  return problems;
}

/** BMI (kg/m²), one decimal, or null without both weight and height. */
export function bmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/** Whole months between a date of birth and a moment. */
export function ageInMonths(dateOfBirth: Date | null, at: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  let months = (at.getUTCFullYear() - dateOfBirth.getUTCFullYear()) * 12 + (at.getUTCMonth() - dateOfBirth.getUTCMonth());
  if (at.getUTCDate() < dateOfBirth.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Warnings for one set of readings. `ageMonths` null (date of birth unknown)
 * means adult ranges are used, with no child-specific checks.
 */
export function assessVitals(v: VitalValues, ageMonths: number | null): VitalWarning[] {
  const out: VitalWarning[] = [];
  const add = (field: VitalField, level: VitalWarning['level'], message: string) => out.push({ field, level, message });
  const isChild = ageMonths !== null && ageMonths < 18 * 12;
  const under5 = ageMonths !== null && ageMonths < 60;

  // Blood pressure (adult categories; children need age and height charts).
  if (v.systolic != null && v.diastolic != null) {
    if (!isChild) {
      if (v.systolic >= 180 || v.diastolic >= 120) add('systolic', 'danger', `BP ${v.systolic}/${v.diastolic}: severely raised. Check for hypertensive emergency.`);
      else if (v.systolic >= 140 || v.diastolic >= 90) add('systolic', 'warning', `BP ${v.systolic}/${v.diastolic}: raised (140/90 or above).`);
    }
    if (v.systolic < 90 && !isChild) add('systolic', 'danger', `BP ${v.systolic}/${v.diastolic}: low. Check for shock.`);
    if (isChild && ageMonths! >= 12 && ageMonths! <= 120 && v.systolic < 70 + 2 * Math.floor(ageMonths! / 12)) {
      add('systolic', 'danger', `Systolic BP ${v.systolic}: low for the child's age. Check for shock.`);
    }
  }

  // Temperature.
  if (v.temperatureC != null) {
    if (v.temperatureC < 35) add('temperatureC', 'danger', `Temperature ${v.temperatureC} °C: hypothermia.`);
    else if (v.temperatureC >= 40) add('temperatureC', 'danger', `Temperature ${v.temperatureC} °C: very high fever.`);
    else if (v.temperatureC >= 38 || (ageMonths !== null && ageMonths < 2 && v.temperatureC >= 37.5)) add('temperatureC', 'warning', `Temperature ${v.temperatureC} °C: fever.`);
  }

  // Oxygen.
  if (v.oxygenSaturation != null) {
    if (v.oxygenSaturation < 90) add('oxygenSaturation', 'danger', `Oxygen ${v.oxygenSaturation}%: low. Consider oxygen and urgent review.`);
    else if (v.oxygenSaturation < 94) add('oxygenSaturation', 'warning', `Oxygen ${v.oxygenSaturation}%: below normal.`);
  }

  // Breathing rate: WHO IMCI fast breathing for under-5s, adult ranges otherwise.
  if (v.respiratoryRate != null) {
    const rr = v.respiratoryRate;
    if (under5) {
      const limit = ageMonths! < 2 ? 60 : ageMonths! < 12 ? 50 : 40;
      if (rr >= limit) add('respiratoryRate', 'warning', `Breathing rate ${rr}/min: fast breathing for age (${limit} or more, WHO IMCI).`);
    } else if (!isChild) {
      if (rr >= 30 || rr < 10) add('respiratoryRate', 'danger', `Breathing rate ${rr}/min: outside the safe range.`);
      else if (rr > 24) add('respiratoryRate', 'warning', `Breathing rate ${rr}/min: raised.`);
    }
  }

  // Pulse.
  if (v.pulse != null) {
    const p = v.pulse;
    const high = ageMonths === null || !isChild ? 120 : ageMonths < 12 ? 160 : ageMonths < 60 ? 140 : 120;
    const low = ageMonths === null || !isChild ? 50 : ageMonths < 12 ? 100 : ageMonths < 60 ? 80 : 60;
    if (p > high + 20 || p < low - 10) add('pulse', 'danger', `Pulse ${p}/min: well outside the range for age.`);
    else if (p > high || p < low) add('pulse', 'warning', `Pulse ${p}/min: outside the usual range for age.`);
  }

  // MUAC, children 6-59 months (WHO cut-offs).
  if (v.muacCm != null && ageMonths !== null && ageMonths >= 6 && ageMonths < 60) {
    if (v.muacCm < 11.5) add('muacCm', 'danger', `MUAC ${v.muacCm} cm: severe acute malnutrition (below 11.5 cm).`);
    else if (v.muacCm < 12.5) add('muacCm', 'warning', `MUAC ${v.muacCm} cm: moderate acute malnutrition (11.5 to 12.4 cm).`);
  }

  // BMI, adults (WHO categories).
  const b = bmi(v.weightKg, v.heightCm);
  if (b !== null && (ageMonths === null || ageMonths >= 18 * 12)) {
    if (b < 16) add('bmi', 'danger', `BMI ${b}: severely underweight.`);
    else if (b < 18.5) add('bmi', 'warning', `BMI ${b}: underweight.`);
    else if (b >= 30) add('bmi', 'warning', `BMI ${b}: obesity.`);
    else if (b >= 25) add('bmi', 'warning', `BMI ${b}: overweight.`);
  }

  return out;
}
