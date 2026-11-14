import fs from 'node:fs';
import path from 'node:path';

/**
 * Kenya ePrescription terminology from the Digital Health Agency's FHIR
 * guide (ke.fhir.eprescription 0.1.0, CC-BY-4.0): Generic Products
 * (medicines, from the Pharmacy and Poisons Board), routes, units and
 * additional instructions, codes and names unmodified.
 * src/assets/dha/, built by scripts/buildDhaTerminology.py.
 */

interface Entry {
  c: string;
  d: string;
}

interface Data {
  source: string;
  products: Entry[];
  productsSystem: string;
  routes: Entry[];
  routesSystem: string;
  units: Entry[];
  unitsSystem: string;
  instructions: Entry[];
  instructionsSystem: string;
}

let cache: (Data & { byCode: Map<string, Map<string, string>>; productList: (Entry & { lower: string })[] }) | null = null;

function data() {
  if (cache) return cache;
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/dha/erx-terminology-0.1.0.json'), 'utf8')) as Data;
  const byCode = new Map<string, Map<string, string>>();
  for (const k of ['products', 'routes', 'units', 'instructions'] as const) byCode.set(k, new Map(json[k].map((e) => [e.c, e.d])));
  cache = { ...json, byCode, productList: json.products.map((p) => ({ ...p, lower: p.d.toLowerCase() })) };
  return cache;
}

export type DhaKind = 'products' | 'routes' | 'units' | 'instructions';

export function dhaDisplay(kind: DhaKind, code: string): string | null {
  return data().byCode.get(kind)?.get(code) ?? null;
}

export function dhaSystem(kind: DhaKind): string {
  return data()[`${kind}System`];
}

/** Every code and name of a small DHA code system (e.g. the 25 instructions). */
export function dhaTerminologyList(kind: 'routes' | 'instructions'): { code: string; name: string }[] {
  return data()[kind].map((e) => ({ code: e.c, name: e.d }));
}

export const DHA_ERX_SOURCE = (): string => data().source;

/**
 * Medicine search by words ("amox 500", "paracetamol syrup"): every word must
 * appear. Names starting with the first word first, then shorter names.
 */
export function searchProducts(query: string, limit = 20): { code: string; name: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.join('').length < 2) return [];
  const hits: { e: Entry & { lower: string }; starts: boolean }[] = [];
  for (const e of data().productList) {
    if (words.every((w) => e.lower.includes(w))) hits.push({ e, starts: e.lower.startsWith(words[0]!) });
  }
  hits.sort((a, b) => Number(b.starts) - Number(a.starts) || a.e.d.length - b.e.d.length || a.e.d.localeCompare(b.e.d));
  return hits.slice(0, limit).map(({ e }) => ({ code: e.c, name: e.d }));
}

/** "Amoxicillin 500 mg/Clavulanic acid 125 mg Oral Tablet" -> ["Amoxicillin", "Clavulanic acid"]. */
export function ingredientsOf(productName: string): string[] {
  return productName
    .split('/')
    .map((part) => part.replace(/\s*\d.*$/, '').trim())
    .filter(Boolean);
}

/** Route suggested by the product's dose form ("... Oral Tablet" -> Oral). */
const FORM_ROUTE: [RegExp, string][] = [
  [/\bnebuli[sz]/i, 'RT10039'],
  [/\binhal/i, 'RT10007'],
  [/\bsublingual/i, 'RT10030'],
  [/\bintravenous/i, 'RT10036'],
  [/\bintramuscular/i, 'RT10013'],
  [/\bsubcutaneous/i, 'RT10029'],
  [/\bintradermal/i, 'RT10012'],
  [/\bophthalmic/i, 'RT10024'],
  [/\botic\b/i, 'RT10026'],
  [/\bnasal/i, 'RT10023'],
  [/\brectal/i, 'RT10028'],
  [/\bvaginal/i, 'RT10035'],
  [/\btransdermal/i, 'RT10032'],
  [/\btopical/i, 'RT10031'],
  [/\binjection/i, 'RT10008'],
  [/\boral\b/i, 'RT10025'],
];

/** Dose unit suggested by the product's form. */
const FORM_UNIT: [RegExp, string][] = [
  [/\btablet/i, 'UM10415'],
  [/\bcapsule/i, 'UM10032'],
  [/\b(syrup|suspension|oral solution|elixir)/i, 'UM10245'],
  [/\bdrops?\b/i, 'UM10066'],
  [/\binhaler/i, 'UM10366'],
  [/\b(cream|ointment|gel|lotion)\b/i, 'UM10009'],
  [/\bsuppositor/i, 'UM10405'],
  [/\bpatch/i, 'UM10338'],
  [/\bspray/i, 'UM10386'],
  [/\b(injection|intravenous|intramuscular|subcutaneous)/i, 'UM10245'],
];

export function suggestedRoute(productName: string): string | null {
  return FORM_ROUTE.find(([re]) => re.test(productName))?.[1] ?? null;
}

export function suggestedDoseUnit(productName: string): string | null {
  return FORM_UNIT.find(([re]) => re.test(productName))?.[1] ?? null;
}
