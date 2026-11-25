import { recordAuditEvent } from '../services/auditService';
import { hieRequest } from './client';
import { clinicFacilityId, HieSetupError, patientAtClinic, patientCrView } from './registryService';

/**
 * SHA claims, phase 1: eligibility (owner, 25 Nov 2026). Front desk checks,
 * at check-in, whether a patient is covered by the Social Health Authority and
 * which outpatient benefits and interventions they can be billed for at this
 * clinic. Read-only: nothing is claimed or sent to SHA here.
 *
 * DHA eClaims API (https://hie-docs.dha.go.ke/docs/claims), same AfyaConnect
 * middleware and service-account token as the registries (src/hie/client.ts).
 * The chain, per DHA's "Eligibility Process":
 *   1. GET /patients/eligibility          covered? which schemes? (stop if not)
 *   2. GET /patients/benefits             parent benefits, e.g. SHA-19
 *   3. GET /patients/sub-benefits         e.g. SHA-19-SC-13, filtered to outpatient
 *   4. GET /patients/benefits/interventions  the unit that gets claimed
 * Always by the patient's Client Registry ID (DHA: "Use the CR ID by default").
 *
 * DHA documents field names but not every value (e.g. the exact coverage
 * status words), so statuses are passed through as DHA sends them, and
 * "covered" is decided conservatively. To confirm in DHA's sandbox.
 * Audit events carry IDs and outcomes only, never names or scheme details.
 */

// ---------- DHA response shapes (fields ACISI uses) ----------

interface DhaScheme {
  schemeId?: number;
  schemeName?: string;
  memberType?: string;
  coverage?: { status?: string; startDate?: string; endDate?: string; reason?: string; message?: string; possibleSolution?: string };
  policy?: { number?: string; startDate?: string; endDate?: string };
}

interface DhaEligibility {
  memberCrNumber?: string;
  fullName?: string;
  isAlive?: boolean;
  whitelistedForOTP?: boolean;
  facilityBiometricsEnforced?: boolean;
  schemes?: DhaScheme[];
  statusCode?: string;
  statusDesc?: string;
}

interface DhaPage<T> {
  results?: T[];
  count?: number;
}

interface DhaBenefit {
  parentBenefit?: string;
  parentBenefitCode?: string;
}

interface DhaSubBenefit {
  code?: string;
  name?: string;
  accessPoint?: string;
  active?: boolean;
  parentBenefitCode?: string;
}

interface DhaIntervention {
  code?: string;
  name?: string;
  accessPoint?: string;
  active?: boolean;
  paymentMechanism?: string;
  needsPreauth?: boolean;
  needsManualPreauthApproval?: boolean;
  requiresSurgicalPreauth?: boolean;
  requiresRadiologyPreauth?: boolean;
  requiresOpticalPreauth?: boolean;
  requiresOncologyPreauth?: boolean;
  requiresRenalPreauth?: boolean;
  kephLevelTarriff?: number;
  overallTariff?: number;
  applicableDocumentTypes?: string[];
  applicableGender?: string;
  lowerAgeLimit?: number;
  upperAgeLimit?: number;
}

// ---------- What ACISI shows ----------

export interface ShaSchemeView {
  name: string;
  memberType: string | null;
  coverageStatus: string;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  /** DHA's explanation when cover isn't active, and what the patient can do. */
  reason: string | null;
  possibleSolution: string | null;
}

export interface ShaEligibilityView {
  /** At least one scheme's cover is active and the patient is alive. */
  covered: boolean;
  deceased: boolean;
  /** POMSF / TSC / USALAMA (public officers): balances and household cover work differently. */
  publicOfficerScheme: boolean;
  /** Consent for SHA visits: biometrics required at this facility, unless the patient is OTP-whitelisted. */
  consent: { biometricsEnforced: boolean; otpAllowed: boolean };
  schemes: ShaSchemeView[];
  statusDesc: string | null;
  checkedAt: string;
}

export interface ShaInterventionView {
  code: string;
  name: string;
  paymentMechanism: string | null;
  /** Tariff for this facility's KEPH level when DHA gives one, else the overall tariff (KES). */
  tariff: number | null;
  needsPreauth: boolean;
  /** needsManualPreauthApproval: elective preauth, reviewed by SHA staff. */
  preauthReviewedBySha: boolean;
  /** Which special preauth form applies, if any. */
  preauthForm: 'surgical' | 'radiology' | 'optical' | 'oncology' | 'renal' | null;
  documents: string[];
}

/** DHA's coverage status words aren't documented; only these count as covered until DHA's sandbox shows otherwise. */
const ACTIVE_STATUSES = new Set(['active', 'eligible', 'covered']);
const PUBLIC_OFFICER_SCHEMES = ['POMSF', 'TSC', 'USALAMA'];
/** Outpatient. DHA's example access point for consultations is "OP". */
const OUTPATIENT = 'OP';
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,40}$/i;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function schemeIsActive(s: DhaScheme): boolean {
  return ACTIVE_STATUSES.has((s.coverage?.status ?? '').trim().toLowerCase());
}

/** POMSF has suffixed variants (POMSF-047, POMSF-SHA): match as a prefix, never exactly (DHA). */
export function isPublicOfficerScheme(name: string | undefined): boolean {
  const n = (name ?? '').trim().toUpperCase();
  return PUBLIC_OFFICER_SCHEMES.some((p) => n === p || n.startsWith(`${p}-`));
}

export function toEligibilityView(d: DhaEligibility, now = new Date()): ShaEligibilityView {
  const schemes = (d.schemes ?? []).map(
    (s): ShaSchemeView => ({
      name: text(s.schemeName) ?? 'Unnamed scheme',
      memberType: text(s.memberType),
      coverageStatus: text(s.coverage?.status) ?? 'Unknown',
      active: schemeIsActive(s),
      validFrom: text(s.coverage?.startDate),
      validTo: text(s.coverage?.endDate),
      reason: text(s.coverage?.reason) ?? text(s.coverage?.message),
      possibleSolution: text(s.coverage?.possibleSolution),
    }),
  );
  const deceased = d.isAlive === false;
  return {
    covered: !deceased && schemes.some((s) => s.active),
    deceased,
    publicOfficerScheme: (d.schemes ?? []).some((s) => isPublicOfficerScheme(s.schemeName)),
    consent: { biometricsEnforced: d.facilityBiometricsEnforced === true, otpAllowed: d.facilityBiometricsEnforced !== true || d.whitelistedForOTP === true },
    schemes,
    statusDesc: text(d.statusDesc),
    checkedAt: now.toISOString(),
  };
}

function preauthForm(i: DhaIntervention): ShaInterventionView['preauthForm'] {
  if (i.requiresSurgicalPreauth) return 'surgical';
  if (i.requiresRadiologyPreauth) return 'radiology';
  if (i.requiresOpticalPreauth) return 'optical';
  if (i.requiresOncologyPreauth) return 'oncology';
  if (i.requiresRenalPreauth) return 'renal';
  return null;
}

export function toInterventionView(i: DhaIntervention): ShaInterventionView | null {
  const code = text(i.code);
  if (!code || i.active === false) return null;
  const tariff = typeof i.kephLevelTarriff === 'number' && i.kephLevelTarriff > 0 ? i.kephLevelTarriff : typeof i.overallTariff === 'number' ? i.overallTariff : null;
  return {
    code,
    name: text(i.name) ?? code,
    paymentMechanism: text(i.paymentMechanism),
    tariff,
    needsPreauth: i.needsPreauth === true,
    preauthReviewedBySha: i.needsManualPreauthApproval === true,
    preauthForm: preauthForm(i),
    documents: (i.applicableDocumentTypes ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
  };
}

function isOutpatient(accessPoint: string | undefined): boolean {
  // No access point given: keep it (DHA doesn't always fill it in).
  if (!accessPoint) return true;
  return accessPoint.split(/[\s,/]+/).some((a) => a.toUpperCase() === OUTPATIENT);
}

// ---------- Context: who, where, which CR ID ----------

interface Ctx {
  patientId: string;
  clinicId: string;
  staffId: string;
}

async function context(input: Ctx): Promise<{ crId: string; facilityId: string }> {
  const patient = await patientAtClinic(input.patientId, input.clinicId);
  const { crId } = patientCrView(patient);
  if (!crId) throw new HieSetupError('Look the patient up in the national Client Registry first (patient page → National HIE).');
  const facilityId = await clinicFacilityId(input.clinicId);
  if (!facilityId) throw new HieSetupError("Your clinic admin must first set the clinic's facility code (Settings → National HIE).");
  return { crId, facilityId };
}

function audit(input: Ctx, action: string, metadata: Record<string, unknown>) {
  return recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action,
    entityType: 'Patient',
    entityId: input.patientId,
    metadata,
  });
}

// ---------- The four steps ----------

/** Step 1: is the patient covered by SHA today? */
export async function checkShaEligibility(input: Ctx): Promise<ShaEligibilityView> {
  const { crId, facilityId } = await context(input);
  try {
    const data = await hieRequest<DhaEligibility>({
      method: 'GET',
      path: '/patients/eligibility',
      query: { identification_type: 'ClientRegistry ID', identification_number: crId },
      facilityId,
    });
    const view = toEligibilityView(data);
    await audit(input, 'SHA_ELIGIBILITY_CHECKED', { covered: view.covered, deceased: view.deceased, schemes: view.schemes.length });
    return view;
  } catch (err) {
    await audit(input, 'SHA_ELIGIBILITY_CHECKED', { error: (err as { kind?: string }).kind ?? 'error' });
    throw err;
  }
}

/** Step 2: the parent benefit packages the patient is entitled to at this clinic. */
export async function listShaBenefits(input: Ctx): Promise<{ code: string; name: string }[]> {
  const { crId, facilityId } = await context(input);
  const data = await hieRequest<DhaPage<DhaBenefit>>({ method: 'GET', path: '/patients/benefits', query: { patient_id: crId }, facilityId });
  const seen = new Set<string>();
  return (data.results ?? []).flatMap((b) => {
    const code = text(b.parentBenefitCode);
    if (!code || seen.has(code)) return [];
    seen.add(code);
    return [{ code, name: text(b.parentBenefit) ?? code }];
  });
}

/** Step 3: outpatient sub-benefits under one benefit. */
export async function listShaSubBenefits(input: Ctx & { benefitCode: string }): Promise<{ code: string; name: string }[]> {
  if (!CODE_RE.test(input.benefitCode)) throw new HieSetupError('That benefit code is not valid.');
  const { crId, facilityId } = await context(input);
  const data = await hieRequest<DhaPage<DhaSubBenefit>>({
    method: 'GET',
    path: '/patients/sub-benefits',
    query: { patient_id: crId, parent_benefit_code: input.benefitCode },
    facilityId,
  });
  return (data.results ?? []).flatMap((s) => {
    const code = text(s.code);
    if (!code || s.active === false || !isOutpatient(s.accessPoint)) return [];
    return [{ code, name: text(s.name) ?? code }];
  });
}

/** Step 4: outpatient interventions under one sub-benefit: what can be claimed, at what tariff, and whether it needs preauthorisation. */
export async function listShaInterventions(input: Ctx & { subBenefitCode: string; search?: string }): Promise<ShaInterventionView[]> {
  if (!CODE_RE.test(input.subBenefitCode)) throw new HieSetupError('That sub-benefit code is not valid.');
  const { crId, facilityId } = await context(input);
  const search = input.search?.trim().slice(0, 60) || undefined;
  const data = await hieRequest<DhaPage<DhaIntervention>>({
    method: 'GET',
    path: '/patients/benefits/interventions',
    query: { patient_id: crId, sub_benefit_code: input.subBenefitCode, access_point: OUTPATIENT, search, page_size: '50' },
    facilityId,
  });
  return (data.results ?? []).flatMap((i) => {
    if (!isOutpatient(i.accessPoint)) return [];
    const v = toInterventionView(i);
    return v ? [v] : [];
  });
}
