/**
 * Shared rule for every Terms/Privacy checkbox: whether the form may be
 * submitted yet. `required` is null while we're still asking the server
 * whether the box applies — never submit then, so a slow network can't skip
 * the box. Pure, so tests/web/legal.test.ts covers it. (The server enforces
 * the same rule; this keeps the button honest.)
 */
export function legalBoxSatisfied(required: boolean | null, ticked: boolean): boolean {
  if (required === null) return false;
  return !required || ticked;
}

export const PRIVACY_PATH = '/privacy';
export const TERMS_PATH = '/terms';
