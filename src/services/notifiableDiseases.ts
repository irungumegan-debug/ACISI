/**
 * Notifiable (IDSR priority) diseases and the ICD-11 codes that detect them.
 *
 * SOURCE (checked 14 Nov 2026, from copies the owner downloaded from nphi.go.ke):
 * - Kenya IDSR Technical Guidelines, 3rd edition (MOH, May 2022):
 *   Table 5 "Disease, conditions or events requiring immediate reporting";
 *   section 2.1: every immediately reportable disease is also reported in the
 *   weekly summary (MOH 505); section 2.3: case-based report (form MOH 502)
 *   to the next level, the Sub-County Disease Surveillance Coordinator
 *   (SCDSC), within 24 hours; Annex 2H / Figure 16: the MOH 505
 *   "IDSR Weekly Epidemic Monitoring Form" (2020 edition): its rows, under 5
 *   and 5 and over, cases and deaths; epidemiological week Monday to Sunday.
 * - Older documents (MOH DDSR chart and the "Kenya's IDSR Priority Diseases"
 *   booklet, 2012 revision) were read too; where they differ, the 3rd edition
 *   is followed (e.g. rabies, typhoid and dysentery are now immediate).
 *
 * `form505Row` is the row of the MOH 505 form the disease is counted in;
 * immediately reportable diseases with no row of their own go under
 * "Others (specify)".
 *
 * ICD-11 stems were checked against WHO's ICD-11 MMS 2025-01 file in
 * src/assets/icd11 (tests/services/notifiableDiseases.test.ts fails if a stem
 * is not a real code). A code matches a stem when it equals it or is a
 * subcode ("1F40.Z" matches "1F40"; "1D01.00" matches "1D01.0"). Conditions with no stems are not
 * diagnoses a doctor codes (events, deaths, clusters): ACISI can't count
 * them, and the weekly summary says "count by hand".
 */

export type NotifiableReporting = 'IMMEDIATE' | 'WEEKLY';

export interface NotifiableDisease {
  id: string;
  /** As written in the MOH guidelines (Table 5) or on the MOH 505 form. */
  name: string;
  /** IMMEDIATE: report within 24 hours, and count weekly. WEEKLY: weekly form only. */
  reporting: NotifiableReporting;
  /** Row on the MOH 505 weekly form. */
  form505Row: string;
  /** Empty: not detectable from a diagnosis code; counted by hand. */
  icd11: string[];
  /** Shown to doctors, e.g. what ACISI can't detect. */
  note?: string;
}

/** Date the list was checked against the MOH documents above. */
export const NOTIFIABLE_LIST_CONFIRMED: string | null = '2026-11-14';
export const NOTIFIABLE_LIST_SOURCE =
  'Kenya IDSR Technical Guidelines, 3rd edition (MOH, 2022): Table 5 and the MOH 505 weekly form';

const OTHERS = 'Others (specify)';

/** In MOH 505 row order, then the immediately reportable diseases that go under "Others". */
export const NOTIFIABLE_DISEASES: NotifiableDisease[] = [
  { id: 'aefi', name: 'Adverse Events Following Immunization (AEFI)', reporting: 'IMMEDIATE', form505Row: 'AEFI', icd11: [] },
  {
    id: 'acute-jaundice',
    name: 'Acute jaundice',
    reporting: 'IMMEDIATE',
    form505Row: 'Acute Jaundice',
    icd11: ['ME10.1'],
    note: 'ACISI detects the code "Unspecified jaundice" (ME10.1). Report any acute jaundice that meets the case definition, however it is coded.',
  },
  { id: 'acute-malnutrition', name: 'Acute malnutrition', reporting: 'WEEKLY', form505Row: 'Acute Malnutrition', icd11: ['5B51', '5B52'] },
  {
    id: 'afp',
    name: 'Poliomyelitis (Acute Flaccid Paralysis) (AFP)',
    reporting: 'IMMEDIATE',
    form505Row: 'AFP (Poliomyelitis)',
    icd11: ['1C81'],
    note: 'ACISI detects acute poliomyelitis (1C81). Any child under 15 with sudden floppy weakness not due to trauma is a suspected case: report it however it is coded.',
  },
  { id: 'anthrax', name: 'Anthrax', reporting: 'IMMEDIATE', form505Row: 'Anthrax', icd11: ['1B97'] },
  { id: 'cholera', name: 'Cholera', reporting: 'IMMEDIATE', form505Row: 'Cholera', icd11: ['1A00'] },
  { id: 'dengue', name: 'Dengue fever', reporting: 'IMMEDIATE', form505Row: 'Dengue', icd11: ['1D20', '1D21', '1D22', '1D2Z'] },
  { id: 'dysentery', name: 'Diarrhea with blood (Shigellosis)', reporting: 'IMMEDIATE', form505Row: 'Dysentery (Bacillary)', icd11: ['1A02'] },
  { id: 'guinea-worm', name: 'Dracunculiasis (Guinea Worm disease)', reporting: 'IMMEDIATE', form505Row: 'Guinea Worm Disease', icd11: ['1F64'] },
  { id: 'measles', name: 'Measles', reporting: 'IMMEDIATE', form505Row: 'Measles', icd11: ['1F03'] },
  {
    id: 'malaria',
    name: 'Suspected malaria',
    reporting: 'WEEKLY',
    form505Row: 'Suspected Malaria',
    icd11: ['1F40', '1F41', '1F42', '1F43', '1F44', '1F45', '1F4Z'],
    note: 'ACISI counts malaria diagnoses (codes 1F40 to 1F4Z), clinical and confirmed.',
  },
  { id: 'malaria-deaths', name: 'Deaths due to malaria', reporting: 'WEEKLY', form505Row: 'Deaths due to Malaria', icd11: [] },
  { id: 'maternal-death', name: 'Maternal death', reporting: 'IMMEDIATE', form505Row: 'Maternal deaths', icd11: [] },
  {
    id: 'meningococcal-meningitis',
    name: 'Bacterial meningitis (meningococcal)',
    reporting: 'IMMEDIATE',
    form505Row: 'Meningococcal Meningitis',
    icd11: ['1C1C.0'],
  },
  { id: 'neonatal-deaths', name: 'Neonatal deaths', reporting: 'WEEKLY', form505Row: 'Neonatal deaths', icd11: [] },
  { id: 'neonatal-tetanus', name: 'Neonatal tetanus', reporting: 'IMMEDIATE', form505Row: 'Neonatal Tetanus', icd11: ['1C15'] },
  { id: 'plague', name: 'Plague', reporting: 'IMMEDIATE', form505Row: 'Plague', icd11: ['1B93'] },
  { id: 'rabies', name: 'Rabies (Human)', reporting: 'IMMEDIATE', form505Row: 'Rabies', icd11: ['1C82'] },
  { id: 'rvf', name: 'Rift Valley fever (RVF)', reporting: 'IMMEDIATE', form505Row: 'Rift Valley Fever', icd11: ['1D44'] },
  { id: 'sari', name: 'SARIs (Severe Acute Respiratory Infections)', reporting: 'IMMEDIATE', form505Row: 'SARI (Cluster ≥3 cases)', icd11: [] },
  {
    id: 'tb-mdr-xdr',
    name: 'Suspected MDR/XDR TB',
    reporting: 'WEEKLY',
    form505Row: 'Suspected MDR/XDR TB',
    icd11: ['MG52.00', 'MG52.02'],
    note: 'ACISI detects the codes for multi-drug and extensively drug-resistant TB (MG52.00, MG52.02).',
  },
  { id: 'typhoid', name: 'Typhoid fever', reporting: 'IMMEDIATE', form505Row: 'Typhoid', icd11: ['1A07'] },
  {
    id: 'vhf',
    name: 'Acute hemorrhagic fever syndrome (Ebola, Marburg, Lassa fever, Crimean-Congo)',
    reporting: 'IMMEDIATE',
    form505Row: 'VHF',
    icd11: ['1D60', '1D61.2', '1D49'],
  },
  { id: 'yellow-fever', name: 'Yellow fever', reporting: 'IMMEDIATE', form505Row: 'Yellow Fever', icd11: ['1D47'] },
  // Immediately reportable (Table 5) with no row of their own on MOH 505.
  {
    id: 'bacterial-meningitis-other',
    name: 'Bacterial meningitis (other than meningococcal)',
    reporting: 'IMMEDIATE',
    form505Row: OTHERS,
    icd11: ['1D01.0', '1B53', '1B54'],
  },
  { id: 'chikungunya', name: 'Chikungunya', reporting: 'IMMEDIATE', form505Row: OTHERS, icd11: ['1D40'] },
  { id: 'influenza-new-subtype', name: 'Influenza due to new subtype', reporting: 'IMMEDIATE', form505Row: OTHERS, icd11: ['1E31'] },
  { id: 'mers', name: 'Middle East Respiratory Syndrome Coronavirus (MERS-CoV)', reporting: 'IMMEDIATE', form505Row: OTHERS, icd11: ['1D64'] },
  { id: 'sars-covid', name: 'SARS (e.g. COVID-19)', reporting: 'IMMEDIATE', form505Row: OTHERS, icd11: ['1D65', 'RA01'] },
  { id: 'smallpox', name: 'Smallpox', reporting: 'IMMEDIATE', form505Row: OTHERS, icd11: ['1E70'] },
  { id: 'zika', name: 'Zika virus disease', reporting: 'IMMEDIATE', form505Row: OTHERS, icd11: ['1D48'] },
  {
    id: 'pheic',
    name: 'Any public health event of international concern (infectious, zoonotic, food borne, chemical, radio nuclear or due to an unknown condition)',
    reporting: 'IMMEDIATE',
    form505Row: OTHERS,
    icd11: [],
  },
];

/**
 * ICD-11 subcodes: "1F40" -> "1F40.Z" (a dot is added); "1D01.0" ->
 * "1D01.00" (after the dot, characters are added). Codes are uppercase.
 */
function matchesStem(code: string, stem: string): boolean {
  return stem.includes('.') ? code.startsWith(stem) : code === stem || code.startsWith(`${stem}.`);
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
