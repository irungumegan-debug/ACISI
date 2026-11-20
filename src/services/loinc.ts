/**
 * LOINC codes for lab tests (international standard for lab observations,
 * free to use: loinc.org). Each code is "digits-checkdigit"; the check digit
 * (mod 10, LOINC's published algorithm) catches typing mistakes.
 */

export const LOINC_PATTERN = /^\d{1,7}-\d$/;

/** LOINC's mod-10 check digit for the number part of a code. */
export function loincCheckDigit(numberPart: string): number {
  const digits = numberPart.split('').map(Number);
  // Counting from the right: odd positions (1st, 3rd...) form one number, doubled.
  const odd = digits.filter((_, i) => (digits.length - i) % 2 === 1).join('');
  const even = digits.filter((_, i) => (digits.length - i) % 2 === 0).join('');
  const combined = even + String(Number(odd || '0') * 2);
  const sum = combined.split('').reduce((s, d) => s + Number(d), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidLoinc(code: string): boolean {
  if (!LOINC_PATTERN.test(code)) return false;
  const [num, check] = code.split('-') as [string, string];
  return loincCheckDigit(num) === Number(check);
}

/** Common primary-care tests, for suggestions when a clinic adds or edits a lab test. */
export const LOINC_SUGGESTIONS: { code: string; name: string; keywords: string[] }[] = [
  { code: '718-7', name: 'Hemoglobin [Mass/volume] in Blood', keywords: ['hb', 'haemoglobin', 'hemoglobin'] },
  { code: '58410-2', name: 'CBC panel - Blood by Automated count', keywords: ['cbc', 'full blood count', 'fbc', 'complete blood count', 'haemogram'] },
  { code: '6690-2', name: 'Leukocytes [#/volume] in Blood by Automated count', keywords: ['wbc', 'white cell', 'leukocyte'] },
  { code: '777-3', name: 'Platelets [#/volume] in Blood by Automated count', keywords: ['platelet', 'plt'] },
  { code: '4537-7', name: 'Erythrocyte sedimentation rate by Westergren method', keywords: ['esr', 'sedimentation'] },
  { code: '32700-7', name: 'Microscopic observation [Identifier] in Blood by Malaria smear', keywords: ['malaria', 'bs', 'blood slide', 'mps', 'smear'] },
  { code: '2339-0', name: 'Glucose [Mass/volume] in Blood', keywords: ['rbs', 'random blood sugar', 'glucose', 'sugar'] },
  { code: '2345-7', name: 'Glucose [Mass/volume] in Serum or Plasma', keywords: ['glucose', 'sugar', 'serum glucose'] },
  { code: '1558-6', name: 'Fasting glucose [Mass/volume] in Serum or Plasma', keywords: ['fbs', 'fasting', 'fasting blood sugar'] },
  { code: '4548-4', name: 'Hemoglobin A1c/Hemoglobin.total in Blood', keywords: ['hba1c', 'a1c', 'glycated'] },
  { code: '2160-0', name: 'Creatinine [Mass/volume] in Serum or Plasma', keywords: ['creatinine', 'renal', 'kidney'] },
  { code: '3094-0', name: 'Urea nitrogen [Mass/volume] in Serum or Plasma', keywords: ['urea', 'bun'] },
  { code: '2951-2', name: 'Sodium [Moles/volume] in Serum or Plasma', keywords: ['sodium', 'na', 'electrolytes'] },
  { code: '2823-3', name: 'Potassium [Moles/volume] in Serum or Plasma', keywords: ['potassium', 'k', 'electrolytes'] },
  { code: '2093-3', name: 'Cholesterol [Mass/volume] in Serum or Plasma', keywords: ['cholesterol', 'lipid'] },
  { code: '2571-8', name: 'Triglyceride [Mass/volume] in Serum or Plasma', keywords: ['triglyceride', 'lipid'] },
  { code: '1742-6', name: 'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma', keywords: ['alt', 'sgpt', 'liver'] },
  { code: '1920-8', name: 'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma', keywords: ['ast', 'sgot', 'liver'] },
  { code: '1975-2', name: 'Bilirubin.total [Mass/volume] in Serum or Plasma', keywords: ['bilirubin', 'liver', 'jaundice'] },
  { code: '24356-8', name: 'Urinalysis complete panel - Urine', keywords: ['urinalysis', 'urine', 'ua'] },
  { code: '2106-3', name: 'Choriogonadotropin (pregnancy test) [Presence] in Urine', keywords: ['pregnancy', 'hcg', 'pdt', 'upt'] },
  { code: '3016-3', name: 'Thyrotropin [Units/volume] in Serum or Plasma', keywords: ['tsh', 'thyroid'] },
  { code: '883-9', name: 'ABO group [Type] in Blood', keywords: ['blood group', 'abo', 'grouping'] },
  { code: '10331-7', name: 'Rh [Type] in Blood', keywords: ['rhesus', 'rh'] },
];

/** Suggestions for a test name: keyword matches first. */
export function suggestLoinc(testName: string, limit = 5): { code: string; name: string }[] {
  const q = testName.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const words = new Set(q.split(/\s+/).filter(Boolean));
  const scored = LOINC_SUGGESTIONS.map((s) => ({
    s,
    score: s.keywords.reduce((n, k) => n + (k.includes(' ') ? (q.includes(k) ? 2 : 0) : words.has(k) ? 1 : 0), 0) + (s.name.toLowerCase().includes(q.trim()) && q.trim().length > 3 ? 1 : 0),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ s }) => ({ code: s.code, name: s.name }));
}
