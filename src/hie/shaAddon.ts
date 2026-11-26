import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { HieError, hieConfigured } from './client';

/**
 * SHA claims is an optional add-on, not part of ACISI's core. It runs for
 * a clinic only when BOTH switches are on:
 *
 *  1. SHA_ENABLED=true on the server (off by default; with it off the
 *     /api/staff/sha routes are not even mounted), and
 *  2. the clinic's own switch (Clinic.shaAddonEnabled, off by default),
 *     which only the ACISI owner can turn on, from the owner site.
 *
 * Every SHA service function calls requireShaAddon before it reads or sends
 * anything, so no patient data goes to SHA while either switch is off.
 *
 * Built from DHA's published API docs (hie-docs.dha.go.ke/docs/claims)
 * without sandbox access: expect rework when it is switched on.
 */

export const SHA_ADDON_OFF_MESSAGE = 'The SHA add-on is switched off for this clinic.';

/** Is the SHA add-on on for this clinic (server switch and the clinic's own)? */
export async function shaAddonOn(clinicId: string): Promise<boolean> {
  if (!env.SHA_ENABLED) return false;
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { shaAddonEnabled: true } });
  return clinic?.shaAddonEnabled === true;
}

/** Throws unless the add-on is on for this clinic. Call before any SHA work. */
export async function requireShaAddon(clinicId: string): Promise<void> {
  if (!(await shaAddonOn(clinicId))) throw new HieError('not_configured', SHA_ADDON_OFF_MESSAGE);
}

/** What the console needs to decide whether to show SHA panels at all. */
export async function shaAddonStatus(clinicId: string): Promise<{ enabled: boolean; connected: boolean }> {
  const enabled = await shaAddonOn(clinicId);
  return { enabled, connected: enabled && hieConfigured() };
}
