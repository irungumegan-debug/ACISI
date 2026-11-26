import { ShaVisit } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from '../services/auditService';
import { HieError, hieConfigured, hieRequest } from './client';
import { HieSetupError, patientCrView } from './registryService';
import { checkShaEligibility } from './shaEligibility';
import { requireShaAddon } from './shaAddon';

/**
 * SHA claims, start visit (owner, 25 Nov 2026; after phase 1, eligibility).
 * Front desk opens the visit with SHA while the patient is at the clinic:
 *
 *   1. GET  /patients/contacts   the patient's SHA contacts, masked (+254714***898);
 *                                the patient says which phone gets the code
 *   2. POST /claims/otp          SHA texts the patient a code for the chosen services
 *   3. POST /claims/visit        with the code: SHA creates the visit's (virtual)
 *                                claim and returns authorization_code, the consent
 *                                token for every later claim step (diagnoses,
 *                                billing lines, preauths)
 *
 * DHA eClaims and Consent Services API (hie-docs.dha.go.ke: "Start Visit
 * Consent Process", "Send OTP", "Create new virtual claim"). OTP path only:
 * the fingerprint path needs DHA's biometrics hardware at the clinic, so a
 * clinic where SHA enforces biometrics (and the patient isn't OTP-whitelisted)
 * is told so. Outpatient only (owner, 24 Nov). The treating doctor is attached
 * when their registration was verified in DHA's Health Worker Registry; else
 * it is added at a later claim step (DHA: one doctor needed, at any step).
 *
 * The consent token is stored encrypted (fieldCrypto) and never shown.
 * Audit events carry ids and outcomes only, never codes, phone numbers or names.
 */

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,40}$/i;
export const MAX_SHA_SERVICES = 10;
export const SHA_CODE_RESEND_SECONDS = 60;
export const SHA_CODE_MAX_SENDS = 5;
const REGULATORS = new Set(['KMPDC', 'COC', 'NCK', 'PPB']);

interface DhaContact {
  id?: number;
  contactType?: string;
  contactValue?: string;
  active?: boolean;
  isConfirmed?: boolean;
}

interface DhaVirtualClaim {
  claim_id?: number | string;
  id?: number | string;
  visit_number?: string;
  authorization_code?: string;
  claim_auth_status?: string;
  workflow_state?: string;
}

export interface ShaContactView {
  id: number;
  type: string;
  /** As DHA sends it: already masked. */
  masked: string;
  confirmed: boolean;
}

export interface ShaVisitView {
  status: ShaVisit['status'];
  interventionCodes: string[];
  codeSentAt: Date;
  canResendAt: Date;
  claimId: string | null;
  visitNumber: string | null;
  claimStatus: string | null;
  doctorAttached: boolean;
  startedAt: Date | null;
}

function text(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function shaVisitView(v: ShaVisit | null): ShaVisitView | null {
  if (!v) return null;
  return {
    status: v.status,
    interventionCodes: v.interventionCodes,
    codeSentAt: v.codeSentAt,
    canResendAt: new Date(v.codeSentAt.getTime() + SHA_CODE_RESEND_SECONDS * 1000),
    claimId: v.shaClaimId,
    visitNumber: v.shaVisitNumber,
    claimStatus: v.shaClaimStatus ?? v.shaWorkflowState,
    doctorAttached: v.doctorAttached,
    startedAt: v.startedAt,
  };
}

async function context(encounterId: string, clinicId: string) {
  // Add-on switch first: nothing is read or sent for SHA while it is off.
  await requireShaAddon(clinicId);
  const encounter = await prisma.encounter.findFirst({
    where: { id: encounterId, clinicId },
    include: {
      patient: true,
      clinic: { select: { hieFacilityId: true } },
      shaVisit: true,
      assignedDoctor: { select: { hieRegulator: true, hieRegistrationNumber: true, hieVerifiedAt: true, hieLicenceEnd: true } },
      consultedByStaff: { select: { hieRegulator: true, hieRegistrationNumber: true, hieVerifiedAt: true, hieLicenceEnd: true } },
    },
  });
  if (!encounter) throw new HieError('not_found', 'Visit not found');
  return encounter;
}

type Ctx = Awaited<ReturnType<typeof context>>;

function requireLinked(ctx: Ctx): { facilityId: string; crId: string } {
  if (!hieConfigured()) throw new HieError('not_configured', "ACISI isn't connected to the national Health Information Exchange yet.");
  const facilityId = ctx.clinic.hieFacilityId;
  if (!facilityId) throw new HieSetupError("Your clinic admin must first set the clinic's facility code (Settings → National HIE).");
  const crId = patientCrView(ctx.patient).crId;
  if (!crId) throw new HieSetupError('Look the patient up in the national Client Registry first (patient page → National HIE).');
  return { facilityId, crId };
}

function audit(ctx: Ctx, staffId: string, action: string, metadata: Record<string, unknown> = {}) {
  return recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId: ctx.clinicId,
    action,
    entityType: 'Encounter',
    entityId: ctx.id,
    metadata: { patientId: ctx.patientId, ...metadata },
  });
}

/** The doctor to put on the claim: only one whose registration DHA confirmed and whose licence is current. */
export function claimDoctor(ctx: Pick<Ctx, 'assignedDoctor' | 'consultedByStaff'>, now = new Date()) {
  for (const d of [ctx.consultedByStaff, ctx.assignedDoctor]) {
    if (!d?.hieVerifiedAt || !d.hieRegistrationNumber || !d.hieRegulator || !REGULATORS.has(d.hieRegulator)) continue;
    if (d.hieLicenceEnd && d.hieLicenceEnd < now) continue;
    return {
      practitioner_identification_type: 'registration_number',
      practitioner_identification_number: d.hieRegistrationNumber,
      practitioner_regulation_body: d.hieRegulator,
    };
  }
  return null;
}

export function cleanServiceCodes(codes: unknown): string[] {
  if (!Array.isArray(codes)) throw new HieSetupError('Choose the SHA services for this visit.');
  const out = [...new Set(codes.map((c) => (typeof c === 'string' ? c.trim().toUpperCase() : '')))];
  if (out.length === 0) throw new HieSetupError('Choose the SHA services for this visit.');
  if (out.length > MAX_SHA_SERVICES) throw new HieSetupError(`Choose at most ${MAX_SHA_SERVICES} services.`);
  if (out.some((c) => !CODE_RE.test(c))) throw new HieSetupError('One of the service codes is not valid.');
  return out;
}

function assertOpen(ctx: Ctx) {
  if (ctx.status === 'DONE') throw new HieSetupError('This visit is finished.');
  if (ctx.shaVisit?.status === 'STARTED') throw new HieSetupError('This visit is already started with SHA.');
}

export async function getShaVisit(encounterId: string, clinicId: string) {
  const ctx = await context(encounterId, clinicId);
  return {
    patientId: ctx.patientId,
    connected: hieConfigured(),
    facilitySet: Boolean(ctx.clinic.hieFacilityId),
    patientLinked: Boolean(patientCrView(ctx.patient).crId),
    visit: shaVisitView(ctx.shaVisit),
  };
}

/** Step 1: the phones SHA can text the code to (masked by DHA). */
export async function listShaContacts(input: { encounterId: string; clinicId: string; staffId: string }): Promise<ShaContactView[]> {
  const ctx = await context(input.encounterId, input.clinicId);
  const { facilityId, crId } = requireLinked(ctx);
  const data = await hieRequest<{ results?: DhaContact[] }>({ method: 'GET', path: '/patients/contacts', query: { patient_id: crId }, facilityId });
  return (data.results ?? []).flatMap((c) => {
    const masked = text(c.contactValue);
    if (typeof c.id !== 'number' || !masked || c.active === false) return [];
    return [{ id: c.id, type: text(c.contactType) ?? 'Phone', masked, confirmed: c.isConfirmed === true }];
  });
}

/** Step 2: check cover, then SHA texts the patient a code for these services. Also used to send the code again. */
export async function sendShaVisitCode(input: {
  encounterId: string;
  clinicId: string;
  staffId: string;
  interventionCodes: unknown;
  contactId?: number;
  now?: Date;
}): Promise<ShaVisitView> {
  const now = input.now ?? new Date();
  const ctx = await context(input.encounterId, input.clinicId);
  assertOpen(ctx);
  const { facilityId, crId } = requireLinked(ctx);
  const codes = cleanServiceCodes(input.interventionCodes);
  const prev = ctx.shaVisit;
  if (prev) {
    const wait = Math.ceil((prev.codeSentAt.getTime() + SHA_CODE_RESEND_SECONDS * 1000 - now.getTime()) / 1000);
    if (wait > 0) throw new HieSetupError(`Wait ${wait} seconds before sending another code.`);
    if (prev.codeSendCount >= SHA_CODE_MAX_SENDS) throw new HieSetupError('Too many codes sent for this visit. Check the patient’s phone number with SHA, or bill the visit as cash.');
  }

  // DHA: start visit comes after eligibility. Stop here if SHA won't cover it, or wants a fingerprint.
  const cover = await checkShaEligibility({ patientId: ctx.patientId, clinicId: input.clinicId, staffId: input.staffId });
  if (cover.deceased) throw new HieSetupError('SHA records this person as deceased. Check the patient’s identity; do not bill SHA.');
  if (!cover.covered) throw new HieSetupError('The patient is not covered by SHA today, so the visit cannot be started with SHA.');
  if (!cover.consent.otpAllowed) {
    throw new HieSetupError('SHA requires a fingerprint to start visits at this clinic, and ACISI cannot take fingerprints yet. Ask SHA to allow SMS codes for this patient, or bill the visit as cash.');
  }

  try {
    await hieRequest({
      method: 'POST',
      path: '/claims/otp',
      body: { patient_id: crId, intervention_codes: codes, ...(input.contactId !== undefined ? { contact_id: input.contactId } : {}) },
      facilityId,
    });
  } catch (err) {
    await audit(ctx, input.staffId, 'SHA_VISIT_CODE_SENT', { error: (err as { kind?: string }).kind ?? 'error' });
    if (err instanceof HieError && err.kind === 'invalid') {
      throw new HieSetupError('SHA could not send a code for these services. Check the chosen services and the patient’s phone, then try again.');
    }
    throw err;
  }

  const data = { interventionCodes: codes, contactId: input.contactId ?? null, codeSentAt: now };
  const v = await prisma.shaVisit.upsert({
    where: { encounterId: ctx.id },
    create: { encounterId: ctx.id, clinicId: input.clinicId, patientId: ctx.patientId, requestedByStaffId: input.staffId, ...data },
    update: { ...data, status: 'CODE_SENT', codeSendCount: { increment: 1 } },
  });
  await audit(ctx, input.staffId, 'SHA_VISIT_CODE_SENT', { services: codes.length, sends: v.codeSendCount });
  return shaVisitView(v)!;
}

/** Step 3: the patient reads out the code; SHA opens the visit and its claim. */
export async function startShaVisit(input: { encounterId: string; clinicId: string; staffId: string; code: string }): Promise<ShaVisitView> {
  const ctx = await context(input.encounterId, input.clinicId);
  assertOpen(ctx);
  const { facilityId, crId } = requireLinked(ctx);
  const pending = ctx.shaVisit;
  if (!pending) throw new HieSetupError('Send the patient an SHA code first.');
  if (!/^\d{4,8}$/.test(input.code)) throw new HieSetupError('Enter the code from the SMS (numbers only).');
  const doctor = claimDoctor(ctx);

  let claim: DhaVirtualClaim;
  try {
    claim = await hieRequest<DhaVirtualClaim>({
      method: 'POST',
      path: '/claims/visit',
      body: { patient_id: crId, service_type: 'OUTPATIENT', intervention_codes: pending.interventionCodes, otp: input.code, ...(doctor ?? {}) },
      facilityId,
    });
  } catch (err) {
    await audit(ctx, input.staffId, 'SHA_VISIT_STARTED', { error: (err as { kind?: string }).kind ?? 'error' });
    if (err instanceof HieError && err.kind === 'invalid') {
      throw new HieSetupError('SHA did not accept that code. Check it with the patient, or send a new code if it has expired.');
    }
    throw err;
  }

  const claimId = text(claim.claim_id) ?? text(claim.id);
  const token = text(claim.authorization_code);
  if (!claimId || !token) throw new HieError('unavailable', 'SHA did not confirm the visit. Try again in a minute.');
  const v = await prisma.shaVisit.update({
    where: { encounterId: ctx.id },
    data: {
      status: 'STARTED',
      shaClaimId: claimId,
      shaVisitNumber: text(claim.visit_number),
      shaConsentToken: token,
      shaClaimStatus: text(claim.claim_auth_status),
      shaWorkflowState: text(claim.workflow_state),
      doctorAttached: Boolean(doctor),
      startedAt: new Date(),
      startedByStaffId: input.staffId,
    },
  });
  await audit(ctx, input.staffId, 'SHA_VISIT_STARTED', { claimId, doctorAttached: Boolean(doctor) });
  return shaVisitView(v)!;
}
