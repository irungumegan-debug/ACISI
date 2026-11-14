/**
 * Common primary-care medicines, for the prescription picker and the allergy
 * warning. Doctors can also type any medicine not listed here: the warning
 * then works by name only.
 *
 * Each medicine lists the drug groups it belongs to. An allergy warns for
 * the same medicine, its brand names, and other medicines in the same group
 * (e.g. a penicillin allergy warns for amoxicillin and co-amoxiclav). Known
 * limits, stated in the console: cross-reactivity between different groups
 * (e.g. penicillins and cephalosporins) is not checked, and medicines not on
 * this list are matched by name only. The doctor's judgement decides.
 */

export type DrugGroup =
  | 'penicillins'
  | 'cephalosporins'
  | 'macrolides'
  | 'fluoroquinolones'
  | 'tetracyclines'
  | 'sulfonamides'
  | 'nitroimidazoles'
  | 'aminoglycosides'
  | 'nsaids'
  | 'opioids'
  | 'ace-inhibitors'
  | 'aromatic-anticonvulsants'
  | 'artemisinins';

export interface Medicine {
  id: string;
  /** Generic name, as shown to doctors. */
  name: string;
  /** Other names doctors or patients use (brands, abbreviations). */
  aka?: string[];
  groups: DrugGroup[];
}

/** Words an allergy may be recorded under that mean a whole group. */
const GROUP_WORDS: Record<string, DrugGroup> = {
  penicillin: 'penicillins',
  penicillins: 'penicillins',
  cephalosporin: 'cephalosporins',
  cephalosporins: 'cephalosporins',
  macrolide: 'macrolides',
  macrolides: 'macrolides',
  quinolone: 'fluoroquinolones',
  quinolones: 'fluoroquinolones',
  fluoroquinolone: 'fluoroquinolones',
  fluoroquinolones: 'fluoroquinolones',
  tetracyclines: 'tetracyclines',
  sulfa: 'sulfonamides',
  sulpha: 'sulfonamides',
  sulfonamide: 'sulfonamides',
  sulfonamides: 'sulfonamides',
  sulphonamide: 'sulfonamides',
  sulphonamides: 'sulfonamides',
  aminoglycoside: 'aminoglycosides',
  aminoglycosides: 'aminoglycosides',
  nsaid: 'nsaids',
  nsaids: 'nsaids',
  opioid: 'opioids',
  opioids: 'opioids',
  opiate: 'opioids',
  opiates: 'opioids',
  'ace inhibitor': 'ace-inhibitors',
  'ace inhibitors': 'ace-inhibitors',
};

export const GROUP_LABEL: Record<DrugGroup, string> = {
  penicillins: 'penicillins',
  cephalosporins: 'cephalosporins',
  macrolides: 'macrolides',
  fluoroquinolones: 'fluoroquinolones',
  tetracyclines: 'tetracyclines',
  sulfonamides: 'sulfonamides (sulfa drugs)',
  nitroimidazoles: 'nitroimidazoles',
  aminoglycosides: 'aminoglycosides',
  nsaids: 'NSAIDs',
  opioids: 'opioids',
  'ace-inhibitors': 'ACE inhibitors',
  'aromatic-anticonvulsants': 'aromatic anticonvulsants',
  artemisinins: 'artemisinins',
};

export const MEDICINES: Medicine[] = [
  // Penicillins
  { id: 'amoxicillin', name: 'Amoxicillin', aka: ['Amoxil'], groups: ['penicillins'] },
  { id: 'co-amoxiclav', name: 'Amoxicillin + clavulanic acid (co-amoxiclav)', aka: ['Augmentin', 'co-amoxiclav'], groups: ['penicillins'] },
  { id: 'ampicillin', name: 'Ampicillin', groups: ['penicillins'] },
  { id: 'benzylpenicillin', name: 'Benzylpenicillin (penicillin G)', aka: ['crystalline penicillin', 'penicillin G', 'X-pen'], groups: ['penicillins'] },
  { id: 'benzathine-benzylpenicillin', name: 'Benzathine benzylpenicillin', aka: ['benzathine penicillin'], groups: ['penicillins'] },
  { id: 'phenoxymethylpenicillin', name: 'Phenoxymethylpenicillin (penicillin V)', aka: ['penicillin V', 'pen V'], groups: ['penicillins'] },
  { id: 'cloxacillin', name: 'Cloxacillin', groups: ['penicillins'] },
  { id: 'flucloxacillin', name: 'Flucloxacillin', groups: ['penicillins'] },
  // Cephalosporins
  { id: 'cefalexin', name: 'Cefalexin', aka: ['cephalexin'], groups: ['cephalosporins'] },
  { id: 'cefadroxil', name: 'Cefadroxil', groups: ['cephalosporins'] },
  { id: 'cefuroxime', name: 'Cefuroxime', aka: ['Zinnat'], groups: ['cephalosporins'] },
  { id: 'cefixime', name: 'Cefixime', groups: ['cephalosporins'] },
  { id: 'ceftriaxone', name: 'Ceftriaxone', aka: ['Rocephin'], groups: ['cephalosporins'] },
  { id: 'cefotaxime', name: 'Cefotaxime', groups: ['cephalosporins'] },
  // Macrolides
  { id: 'azithromycin', name: 'Azithromycin', aka: ['Zithromax'], groups: ['macrolides'] },
  { id: 'erythromycin', name: 'Erythromycin', groups: ['macrolides'] },
  { id: 'clarithromycin', name: 'Clarithromycin', groups: ['macrolides'] },
  // Fluoroquinolones
  { id: 'ciprofloxacin', name: 'Ciprofloxacin', aka: ['Cipro'], groups: ['fluoroquinolones'] },
  { id: 'levofloxacin', name: 'Levofloxacin', groups: ['fluoroquinolones'] },
  { id: 'norfloxacin', name: 'Norfloxacin', groups: ['fluoroquinolones'] },
  { id: 'ofloxacin', name: 'Ofloxacin', groups: ['fluoroquinolones'] },
  // Tetracyclines
  { id: 'doxycycline', name: 'Doxycycline', groups: ['tetracyclines'] },
  { id: 'tetracycline', name: 'Tetracycline', groups: ['tetracyclines'] },
  // Sulfonamides
  { id: 'co-trimoxazole', name: 'Sulfamethoxazole + trimethoprim (co-trimoxazole)', aka: ['Septrin', 'Bactrim', 'co-trimoxazole', 'cotrimoxazole'], groups: ['sulfonamides'] },
  { id: 'sulfamethoxazole', name: 'Sulfamethoxazole', groups: ['sulfonamides'] },
  { id: 'sulfadoxine-pyrimethamine', name: 'Sulfadoxine + pyrimethamine (SP)', aka: ['Fansidar', 'SP'], groups: ['sulfonamides'] },
  { id: 'sulfadoxine', name: 'Sulfadoxine', groups: ['sulfonamides'] },
  { id: 'sulfasalazine', name: 'Sulfasalazine', groups: ['sulfonamides'] },
  // Nitroimidazoles
  { id: 'metronidazole', name: 'Metronidazole', aka: ['Flagyl'], groups: ['nitroimidazoles'] },
  { id: 'tinidazole', name: 'Tinidazole', groups: ['nitroimidazoles'] },
  // Aminoglycosides
  { id: 'gentamicin', name: 'Gentamicin', groups: ['aminoglycosides'] },
  // Other anti-infectives
  { id: 'nitrofurantoin', name: 'Nitrofurantoin', groups: [] },
  { id: 'fluconazole', name: 'Fluconazole', groups: [] },
  { id: 'clotrimazole', name: 'Clotrimazole', groups: [] },
  { id: 'nystatin', name: 'Nystatin', groups: [] },
  { id: 'griseofulvin', name: 'Griseofulvin', groups: [] },
  { id: 'aciclovir', name: 'Aciclovir', aka: ['acyclovir'], groups: [] },
  { id: 'albendazole', name: 'Albendazole', groups: [] },
  { id: 'mebendazole', name: 'Mebendazole', groups: [] },
  { id: 'tld', name: 'Tenofovir + lamivudine + dolutegravir (TLD)', aka: ['TLD'], groups: [] },
  // Antimalarials
  { id: 'artemether-lumefantrine', name: 'Artemether + lumefantrine (AL)', aka: ['Coartem', 'AL'], groups: ['artemisinins'] },
  { id: 'artesunate', name: 'Artesunate', groups: ['artemisinins'] },
  { id: 'artemether', name: 'Artemether', groups: ['artemisinins'] },
  { id: 'dihydroartemisinin', name: 'Dihydroartemisinin', groups: ['artemisinins'] },
  { id: 'dihydroartemisinin-piperaquine', name: 'Dihydroartemisinin + piperaquine (DHA-PPQ)', aka: ['DHA-PPQ', 'Duo-Cotecxin'], groups: ['artemisinins'] },
  { id: 'quinine', name: 'Quinine', groups: [] },
  // Pain and fever
  { id: 'paracetamol', name: 'Paracetamol', aka: ['acetaminophen', 'Panadol', 'Calpol'], groups: [] },
  { id: 'ibuprofen', name: 'Ibuprofen', aka: ['Brufen'], groups: ['nsaids'] },
  { id: 'diclofenac', name: 'Diclofenac', aka: ['Voltaren', 'Cataflam'], groups: ['nsaids'] },
  { id: 'aspirin', name: 'Aspirin (acetylsalicylic acid)', aka: ['acetylsalicylic acid', 'acetyl salicylic acid'], groups: ['nsaids'] },
  { id: 'naproxen', name: 'Naproxen', groups: ['nsaids'] },
  { id: 'mefenamic-acid', name: 'Mefenamic acid', aka: ['Ponstan'], groups: ['nsaids'] },
  { id: 'indometacin', name: 'Indometacin', aka: ['indomethacin'], groups: ['nsaids'] },
  { id: 'meloxicam', name: 'Meloxicam', groups: ['nsaids'] },
  { id: 'tramadol', name: 'Tramadol', groups: ['opioids'] },
  { id: 'codeine', name: 'Codeine', groups: ['opioids'] },
  { id: 'morphine', name: 'Morphine', groups: ['opioids'] },
  // Heart and blood pressure
  { id: 'amlodipine', name: 'Amlodipine', groups: [] },
  { id: 'nifedipine', name: 'Nifedipine', groups: [] },
  { id: 'hydrochlorothiazide', name: 'Hydrochlorothiazide', aka: ['HCTZ'], groups: [] },
  { id: 'enalapril', name: 'Enalapril', groups: ['ace-inhibitors'] },
  { id: 'lisinopril', name: 'Lisinopril', groups: ['ace-inhibitors'] },
  { id: 'captopril', name: 'Captopril', groups: ['ace-inhibitors'] },
  { id: 'losartan', name: 'Losartan', groups: [] },
  { id: 'atenolol', name: 'Atenolol', groups: [] },
  { id: 'furosemide', name: 'Furosemide', aka: ['frusemide', 'Lasix'], groups: [] },
  // Diabetes
  { id: 'metformin', name: 'Metformin', groups: [] },
  { id: 'glibenclamide', name: 'Glibenclamide', groups: [] },
  { id: 'gliclazide', name: 'Gliclazide', groups: [] },
  { id: 'insulin', name: 'Insulin', groups: [] },
  // Allergy, stomach, respiratory
  { id: 'chlorphenamine', name: 'Chlorphenamine', aka: ['chlorpheniramine', 'Piriton'], groups: [] },
  { id: 'cetirizine', name: 'Cetirizine', groups: [] },
  { id: 'loratadine', name: 'Loratadine', groups: [] },
  { id: 'promethazine', name: 'Promethazine', groups: [] },
  { id: 'omeprazole', name: 'Omeprazole', groups: [] },
  { id: 'esomeprazole', name: 'Esomeprazole', groups: [] },
  { id: 'hyoscine-butylbromide', name: 'Hyoscine butylbromide', aka: ['Buscopan'], groups: [] },
  { id: 'metoclopramide', name: 'Metoclopramide', aka: ['Plasil'], groups: [] },
  { id: 'ors', name: 'Oral rehydration salts (ORS)', aka: ['ORS'], groups: [] },
  { id: 'zinc', name: 'Zinc sulfate', aka: ['zinc'], groups: [] },
  { id: 'salbutamol', name: 'Salbutamol', aka: ['Ventolin'], groups: [] },
  { id: 'beclometasone', name: 'Beclometasone', aka: ['beclomethasone'], groups: [] },
  { id: 'prednisolone', name: 'Prednisolone', groups: [] },
  { id: 'hydrocortisone', name: 'Hydrocortisone', groups: [] },
  { id: 'dexamethasone', name: 'Dexamethasone', groups: [] },
  // Supplements
  { id: 'ferrous-sulfate', name: 'Ferrous sulfate', aka: ['iron'], groups: [] },
  { id: 'folic-acid', name: 'Folic acid', groups: [] },
  // Anticonvulsants
  { id: 'carbamazepine', name: 'Carbamazepine', aka: ['Tegretol'], groups: ['aromatic-anticonvulsants'] },
  { id: 'phenytoin', name: 'Phenytoin', groups: ['aromatic-anticonvulsants'] },
  { id: 'phenobarbital', name: 'Phenobarbital', aka: ['phenobarbitone'], groups: ['aromatic-anticonvulsants'] },
  { id: 'sodium-valproate', name: 'Sodium valproate', aka: ['valproate', 'Epilim'], groups: [] },
];

/** Lowercase, accents and punctuation out, single spaces. */
export function normalizeDrugText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every name a medicine is known by, normalized (generic, brands, the generic without its brackets). */
function namesOf(m: Medicine): string[] {
  const generic = m.name.replace(/\s*\(.*?\)\s*/g, ' ');
  return [m.name, generic, m.id.replace(/-/g, ' '), ...(m.aka ?? [])].map(normalizeDrugText).filter(Boolean);
}

const BY_NAME = new Map<string, Medicine>();
for (const m of MEDICINES) for (const n of namesOf(m)) if (!BY_NAME.has(n)) BY_NAME.set(n, m);

const FORM_WORDS = new Set(['mg', 'g', 'mcg', 'ml', 'iu', 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules', 'syrup', 'suspension', 'susp', 'injection', 'inj', 'cream', 'ointment', 'drops', 'inhaler', 'iv', 'im', 'po', 'oral']);

/**
 * The listed medicine a typed name refers to (exact name, brand or generic),
 * or null. Strengths and dose forms are ignored ("Amoxicillin 500mg caps").
 */
export function findMedicine(name: string): Medicine | null {
  const n = normalizeDrugText(name);
  const exact = BY_NAME.get(n);
  if (exact) return exact;
  const core = n
    .split(' ')
    .filter((t) => !/\d/.test(t) && !FORM_WORDS.has(t))
    .join(' ');
  return core ? BY_NAME.get(core) ?? null : null;
}

/** Picker search: names starting with the text first, then names containing it. */
export function searchMedicines(query: string, limit = 12): { id: string; name: string }[] {
  const q = normalizeDrugText(query);
  if (q.length < 2) return [];
  const scored: { m: Medicine; score: number }[] = [];
  for (const m of MEDICINES) {
    const names = namesOf(m);
    const score = names.some((n) => n.startsWith(q)) ? 0 : names.some((n) => n.includes(q)) ? 1 : -1;
    if (score >= 0) scored.push({ m, score });
  }
  scored.sort((a, b) => a.score - b.score || a.m.name.localeCompare(b.m.name));
  return scored.slice(0, limit).map(({ m }) => ({ id: m.id, name: m.name }));
}

export interface AllergyConflict {
  /** Position of the prescription line. */
  index: number;
  drugName: string;
  allergyId: string;
  allergySubstance: string;
  /** Why it matched, for the warning text. */
  reason: string;
}

/** What an allergy's substance text refers to: listed medicines and/or whole drug groups. */
function allergenOf(substance: string): { medicines: Medicine[]; groups: DrugGroup[] } {
  const s = normalizeDrugText(substance);
  const medicines = new Set<Medicine>();
  const groups = new Set<DrugGroup>();
  const direct = findMedicine(s);
  if (direct) medicines.add(direct);
  // Group words anywhere in the text ("penicillin", "sulfa drugs", "NSAIDs").
  for (const [word, group] of Object.entries(GROUP_WORDS)) {
    if (new RegExp(`(^| )${word}( |$)`).test(s)) groups.add(group);
  }
  // A listed medicine named inside a longer text ("amoxicillin rash").
  if (!direct) {
    for (const [name, m] of BY_NAME) if (name.length >= 4 && new RegExp(`(^| )${name}( |$)`).test(s)) medicines.add(m);
  }
  for (const m of medicines) for (const g of m.groups) groups.add(g);
  return { medicines: [...medicines], groups: [...groups] };
}

/** A prescription line as the allergy check sees it: its name and its active ingredients. */
export interface LineForAllergyCheck {
  name: string;
  /** e.g. ["Amoxicillin", "Clavulanic acid"]; empty when unknown. */
  ingredients: string[];
}

/**
 * Prescription lines that clash with the patient's recorded allergies: the
 * same medicine or an ingredient of it (any of its names), another medicine
 * in the same drug group, or, for medicines not on the list, the same name.
 * One result per line and allergy.
 */
export function findAllergyConflicts(lines: LineForAllergyCheck[], allergies: { id: string; substance: string }[]): AllergyConflict[] {
  const out: AllergyConflict[] = [];
  const allergens = allergies.map((a) => ({ a, ...allergenOf(a.substance), text: normalizeDrugText(a.substance) }));
  lines.forEach((line, index) => {
    const names = line.ingredients.length > 0 ? line.ingredients : [line.name];
    const drugs = names.map((n) => findMedicine(n)).filter((m): m is Medicine => m !== null);
    const texts = [line.name, ...names].map(normalizeDrugText);
    for (const al of allergens) {
      let reason: string | null = null;
      const same = drugs.find((d) => al.medicines.includes(d));
      if (same) reason = `contains ${same.name.replace(/\s*\(.*?\)/, '')}: recorded allergy to ${al.a.substance}`;
      if (!reason) {
        for (const d of drugs) {
          const shared = d.groups.find((g) => al.groups.includes(g));
          if (shared) {
            reason = `${d.name.replace(/\s*\(.*?\)/, '')} is in the same group (${GROUP_LABEL[shared]}) as ${al.a.substance}`;
            break;
          }
        }
      }
      if (!reason && al.text.length >= 4 && texts.some((t) => t.length >= 4 && (t.includes(al.text) || al.text.includes(t)))) {
        reason = `the name matches the recorded allergy to ${al.a.substance}`;
      }
      if (reason) out.push({ index, drugName: line.name, allergyId: al.a.id, allergySubstance: al.a.substance, reason });
    }
  });
  return out;
}
