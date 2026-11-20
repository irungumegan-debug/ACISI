import { ageInMonths, assessVitals, bmi, vitalInputProblems } from '../../src/services/vitalAssessment';

const adult = 40 * 12;
const levels = (w: { field: string; level: string }[]) => w.map((x) => `${x.field}:${x.level}`);

it('BMI from weight and height', () => {
  expect(bmi(70, 175)).toBe(22.9);
  expect(bmi(70, null)).toBeNull();
});

it('rejects impossible numbers and BP the wrong way round', () => {
  expect(vitalInputProblems({})).toEqual(['Enter at least one measurement']);
  expect(vitalInputProblems({ temperatureC: 3.7 })[0]).toMatch(/between 30 and 45/);
  expect(vitalInputProblems({ systolic: 80, diastolic: 120 })).toContain('Diastolic BP must be lower than systolic');
  expect(vitalInputProblems({ systolic: 120 })).toContain('Enter both numbers of the blood pressure');
  expect(vitalInputProblems({ systolic: 120, diastolic: 80, pulse: 72 })).toEqual([]);
});

it('adult warnings: raised and severely raised BP, fever, low oxygen, BMI', () => {
  expect(levels(assessVitals({ systolic: 150, diastolic: 95 }, adult))).toEqual(['systolic:warning']);
  expect(levels(assessVitals({ systolic: 190, diastolic: 100 }, adult))).toEqual(['systolic:danger']);
  expect(levels(assessVitals({ temperatureC: 38.5 }, adult))).toEqual(['temperatureC:warning']);
  expect(levels(assessVitals({ oxygenSaturation: 88 }, adult))).toEqual(['oxygenSaturation:danger']);
  expect(levels(assessVitals({ weightKg: 100, heightCm: 170 }, adult))).toEqual(['bmi:warning']);
  expect(assessVitals({ systolic: 118, diastolic: 76, pulse: 72, temperatureC: 36.8, oxygenSaturation: 98, weightKg: 68, heightCm: 172 }, adult)).toEqual([]);
});

it('children: WHO IMCI fast breathing, MUAC cut-offs, no adult BP or BMI labels', () => {
  expect(levels(assessVitals({ respiratoryRate: 52 }, 6))).toEqual(['respiratoryRate:warning']); // 2-11 months: 50+
  expect(assessVitals({ respiratoryRate: 45 }, 6)).toEqual([]);
  expect(levels(assessVitals({ respiratoryRate: 42 }, 30))).toEqual(['respiratoryRate:warning']); // 12-59 months: 40+
  expect(levels(assessVitals({ muacCm: 11.2 }, 24))).toEqual(['muacCm:danger']);
  expect(levels(assessVitals({ muacCm: 12.0 }, 24))).toEqual(['muacCm:warning']);
  expect(assessVitals({ muacCm: 13 }, 24)).toEqual([]);
  expect(assessVitals({ systolic: 150, diastolic: 95, weightKg: 30, heightCm: 120 }, 10 * 12)).toEqual([]);
  expect(levels(assessVitals({ temperatureC: 37.6 }, 1))).toEqual(['temperatureC:warning']); // young infant
});

it('age in whole months', () => {
  expect(ageInMonths(new Date('2024-05-20T00:00:00Z'), new Date('2026-05-19T00:00:00Z'))).toBe(23);
  expect(ageInMonths(new Date('2024-05-20T00:00:00Z'), new Date('2026-05-20T00:00:00Z'))).toBe(24);
  expect(ageInMonths(null)).toBeNull();
});
