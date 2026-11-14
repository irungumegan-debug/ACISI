import fs from 'node:fs';
import path from 'node:path';

/**
 * ICD-11 for Mortality and Morbidity Statistics (MMS), release 2025-01,
 * chapters 01-25: WHO's official codes and titles, unmodified
 * (src/assets/icd11/, built by scripts/buildIcd11Data.py from WHO's Simple
 * Tabulation). ICD-11 (c) World Health Organization, CC BY-ND 3.0 IGO.
 *
 * Loaded once, searched in memory (about 17,000 entries).
 */

export const ICD11_SYSTEM = 'http://id.who.int/icd/release/11/mms';
export const ICD11_RELEASE = '2025-01';
export const MAX_DIAGNOSIS_CODES = 5;

export interface Icd11Entry {
  code: string;
  title: string;
}

interface Raw {
  c: string;
  t: string;
  ch: string;
  leaf: boolean;
}

let cache: { list: (Raw & { lower: string; codeLower: string })[]; byCode: Map<string, Raw> } | null = null;

function data() {
  if (cache) return cache;
  const file = path.join(__dirname, '../assets/icd11/icd11-mms-2025-01.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { codes: Raw[] };
  const list = json.codes.map((r) => ({ ...r, lower: r.t.toLowerCase(), codeLower: r.c.toLowerCase() }));
  cache = { list, byCode: new Map(json.codes.map((r) => [r.c, r])) };
  return cache;
}

/** The official title for a code, or null if it isn't an ICD-11 MMS diagnosis code. */
export function lookupIcd11(code: string): Icd11Entry | null {
  const r = data().byCode.get(code.trim().toUpperCase());
  return r ? { code: r.c, title: r.t } : null;
}

/**
 * Search by code ("1F40", "ba00") or by words in the title ("falciparum
 * malaria"): every word must appear. Best matches first: exact code, code
 * prefix, title starting with the query, then the rest (newborn and
 * "factors influencing health" codes last); the most specific (leaf) codes
 * before broader ones at the same rank.
 */
export function searchIcd11(query: string, limit = 20): Icd11Entry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const scored: { r: Raw; score: number }[] = [];
  for (const r of data().list) {
    let score: number;
    if (r.codeLower === q) score = 0;
    else if (r.codeLower.startsWith(q)) score = 1;
    else if (words.every((w) => r.lower.includes(w))) {
      if (r.lower === q) score = 2; // "asthma" -> Asthma
      else if (r.lower.startsWith(`${q},`)) score = 3; // "Pneumonia, organism unspecified"
      else if (r.lower.startsWith(q)) score = 4;
      else if (words.some((w) => r.lower.startsWith(w))) score = 5;
      else score = 6;
    } else continue;
    // For word searches, newborn conditions (chapter 19) and "factors influencing
    // health" such as exposure or screening (chapter 24) come after ordinary
    // diagnoses, so "falciparum malaria" doesn't open on the congenital form.
    const niche = score >= 2 && (r.ch === '19' || r.ch === '24') ? 5 : 0;
    scored.push({ r, score: (score + niche) * 2 + (r.leaf ? 0 : 1) });
  }
  scored.sort((a, b) => a.score - b.score || a.r.t.length - b.r.t.length || a.r.c.localeCompare(b.r.c));
  return scored.slice(0, limit).map(({ r }) => ({ code: r.c, title: r.t }));
}

/** Validates the doctor's chosen codes and returns them with WHO's titles. */
export function resolveDiagnosisCodes(codes: string[]): Icd11Entry[] {
  const unique = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) throw new Error('Choose at least one ICD-11 diagnosis');
  if (unique.length > MAX_DIAGNOSIS_CODES) throw new Error(`Choose at most ${MAX_DIAGNOSIS_CODES} ICD-11 diagnoses`);
  return unique.map((c) => {
    const e = lookupIcd11(c);
    if (!e) throw new Error(`${c} is not an ICD-11 diagnosis code`);
    return e;
  });
}

/** The stored JSON back to a list (empty for visits recorded before ICD-11 coding). */
export function parseDiagnosisCodes(stored: string | null | undefined): Icd11Entry[] {
  if (!stored) return [];
  try {
    const v = JSON.parse(stored) as unknown;
    return Array.isArray(v) ? v.filter((x): x is Icd11Entry => typeof x?.code === 'string' && typeof x?.title === 'string') : [];
  } catch {
    return [];
  }
}
