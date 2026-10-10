/** Mirrors src/services/departmentService.ts so the form can suggest the same codes the server would. */
export const CODE_PATTERN = /^[A-Z0-9]{1,6}$/;

export const SUGGESTED_DEPARTMENTS = ['General', 'Dental', 'Orthodontics', 'Gynecology', 'Paediatrics', 'Laboratory', 'Pharmacy', 'Eye Clinic'];

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function nameKey(raw: string): string {
  return cleanName(raw).toLowerCase();
}

export function suggestCode(name: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((c) => c.toUpperCase()));
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  let base = words.length >= 2 ? words.map((w) => w[0]).join('').slice(0, 4) : (words[0] ?? '').slice(0, 3);
  if (base.length < 2) base = (words.join('') + 'DEP').slice(0, 3);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = base.slice(0, 6 - String(n).length) + n;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}
