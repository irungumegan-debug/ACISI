/**
 * Notifiable (IDSR priority) diseases and the ICD-11 codes that trigger them.
 *
 * STATUS: DRAFT. Built from widely published IDSR priority diseases; NOT yet
 * checked line by line against the Ministry of Health / NPHI "IDSR Standard
 * Case Definitions" chart (Kenya IDSR Technical Guidelines, 3rd edition),
 * which could not be downloaded when this was written. Confirm every name and
 * its reporting group (immediate or weekly) against that chart, then set
 * NOTIFIABLE_LIST_CONFIRMED to the date it was checked. The console shows
 * "draft list" until then.
 *
 * ICD-11 stems were checked against WHO's ICD-11 MMS 2025-01 file bundled
 * in src/assets/icd11 (tests/services/notifiableDiseases.test.ts fails if a
 * stem is not a real code). A diagnosis matches a stem when its code equals
 * the stem or is a subcode of it ("1F40.Z" matches "1F40").
 */

export type NotifiableReporting = 'IMMEDIATE' | 'WEEKLY';

export interface NotifiableDisease {
  id: string;
  name: string;
  reporting: NotifiableReporting;
  icd11: string[];
}

/** Date the list was checked against the official chart (YYYY-MM-DD), or null while it is a draft. */
export const NOTIFIABLE_LIST_CONFIRMED: string | null = null;

export const NOTIFIABLE_DISEASES: NotifiableDisease[] = [
  // Report immediately (within 24 hours) to the Sub-County.
  { id: 'polio', name: 'Acute flaccid paralysis / poliomyelitis', reporting: 'IMMEDIATE', icd11: ['1C81'] },
  { id: 'anthrax', name: 'Anthrax', reporting: 'IMMEDIATE', icd11: ['1B97'] },
  { id: 'cholera', name: 'Cholera', reporting: 'IMMEDIATE', icd11: ['1A00'] },
  { id: 'plague', name: 'Plague', reporting: 'IMMEDIATE', icd11: ['1B93'] },
  { id: 'rabies', name: 'Rabies', reporting: 'IMMEDIATE', icd11: ['1C82'] },
  { id: 'yellow-fever', name: 'Yellow fever', reporting: 'IMMEDIATE', icd11: ['1D47'] },
  {
    id: 'vhf',
    name: 'Viral haemorrhagic fever (Ebola, Marburg, Crimean-Congo, Lassa)',
    reporting: 'IMMEDIATE',
    icd11: ['1D60', '1D49', '1D61.2'],
  },
  { id: 'rift-valley-fever', name: 'Rift Valley fever', reporting: 'IMMEDIATE', icd11: ['1D44'] },
  { id: 'measles', name: 'Measles', reporting: 'IMMEDIATE', icd11: ['1F03'] },
  { id: 'meningococcal', name: 'Meningococcal meningitis', reporting: 'IMMEDIATE', icd11: ['1C1C'] },
  { id: 'neonatal-tetanus', name: 'Neonatal tetanus', reporting: 'IMMEDIATE', icd11: ['1C15'] },
  { id: 'diphtheria', name: 'Diphtheria', reporting: 'IMMEDIATE', icd11: ['1C17'] },
  { id: 'guinea-worm', name: 'Guinea worm disease (dracunculiasis)', reporting: 'IMMEDIATE', icd11: ['1F64'] },
  { id: 'smallpox', name: 'Smallpox', reporting: 'IMMEDIATE', icd11: ['1E70'] },
  { id: 'mpox', name: 'Mpox', reporting: 'IMMEDIATE', icd11: ['1E71'] },
  { id: 'novel-influenza', name: 'Influenza due to a new subtype (zoonotic or pandemic)', reporting: 'IMMEDIATE', icd11: ['1E31'] },
  { id: 'sars', name: 'Severe acute respiratory syndrome (SARS)', reporting: 'IMMEDIATE', icd11: ['1D65'] },
  { id: 'mers', name: 'Middle East respiratory syndrome (MERS)', reporting: 'IMMEDIATE', icd11: ['1D64'] },
  { id: 'covid-19', name: 'COVID-19', reporting: 'IMMEDIATE', icd11: ['RA01'] },
  { id: 'chikungunya', name: 'Chikungunya', reporting: 'IMMEDIATE', icd11: ['1D40'] },
  { id: 'dengue', name: 'Dengue fever', reporting: 'IMMEDIATE', icd11: ['1D20', '1D21', '1D22', '1D2Z'] },
  // Counted in the weekly summary.
  { id: 'malaria', name: 'Malaria', reporting: 'WEEKLY', icd11: ['1F40', '1F41', '1F42', '1F43', '1F44', '1F45', '1F4Z'] },
  { id: 'typhoid', name: 'Typhoid fever', reporting: 'WEEKLY', icd11: ['1A07'] },
  { id: 'dysentery', name: 'Dysentery (Shigella)', reporting: 'WEEKLY', icd11: ['1A02'] },
];

function matchesStem(code: string, stem: string): boolean {
  return code === stem || code.startsWith(`${stem}.`);
}

/** The notifiable diseases a list of ICD-11 codes matches, each once, with the first matching code. */
export function matchNotifiable(codes: string[]): { disease: NotifiableDisease; code: string }[] {
  const out: { disease: NotifiableDisease; code: string }[] = [];
  for (const disease of NOTIFIABLE_DISEASES) {
    const code = codes.find((c) => disease.icd11.some((stem) => matchesStem(c, stem)));
    if (code) out.push({ disease, code });
  }
  return out;
}
