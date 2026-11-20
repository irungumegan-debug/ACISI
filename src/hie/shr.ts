import { allStrings, hieRequest } from './client';

/**
 * DHA Shared Health Record (SHR) calls, as documented at
 * hie-docs.dha.go.ke/docs/sharedHealthRecord (Sep 2026). Field names are
 * DHA's. Answers are read defensively; check against DHA's development
 * environment once ACISI has credentials.
 */

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Visits at this facility that still hold an open consent for the patient (their visit ids). */
export async function listOpenVisits(input: { crId: string; facilityId: string }): Promise<string[]> {
  const data = await hieRequest<unknown>({
    method: 'GET',
    path: '/shr/open-visits',
    query: { patient_id: input.crId, facility_id: input.facilityId },
    facilityId: input.facilityId,
  });
  const visits = Array.isArray(data) ? data : ((data as { visits?: unknown[] } | null)?.visits ?? []);
  return visits
    .map((v) => (typeof v === 'string' ? v : s((v as { visit_id?: unknown; id?: unknown }).visit_id) ?? s((v as { id?: unknown }).id)))
    .filter((v): v is string => Boolean(v));
}

export interface ConsentStarted {
  consentId: string | null;
  otpRecord: string | null;
  status: string | null;
  /** Emergency consents are approved at once and carry these. */
  visitId: string | null;
  consentToken: string | null;
}

function readConsent(data: unknown): ConsentStarted {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    consentId: s(d.consent_id),
    otpRecord: s(d.otp_record),
    status: s(d.consent_status),
    visitId: s(d.visit_id),
    consentToken: s(d.consent_token),
  };
}

export async function requestConsent(input: {
  crId: string;
  facilityId: string;
  practitionerId: string | null;
  requestedBy: string;
  emergency?: { incapacityReason: string };
}): Promise<ConsentStarted> {
  const data = await hieRequest<unknown>({
    method: 'POST',
    path: '/shr/consents',
    facilityId: input.facilityId,
    body: {
      cr_id: input.crId,
      facility_id: input.facilityId,
      requested_by: input.requestedBy,
      visit_type: 'OP',
      ...(input.practitionerId ? { practitioner_id: input.practitionerId } : {}),
      ...(input.emergency ? { emergency: 1, incapacity_reason: input.emergency.incapacityReason } : {}),
    },
  });
  return readConsent(data);
}

export async function resendConsentOtp(input: { consentId: string; facilityId: string }): Promise<string | null> {
  const data = await hieRequest<unknown>({ method: 'POST', path: `/shr/consents/${encodeURIComponent(input.consentId)}/resend-otp`, facilityId: input.facilityId });
  return readConsent(data).otpRecord;
}

export interface ConsentDecision {
  consentToken: string | null;
  visitId: string | null;
  status: string | null;
  /** Set when the call completed an OTP-gated visit closure. */
  endDate: string | null;
}

/** Approve with the patient's code, refuse, or complete an OTP-gated closure. */
export async function decideConsent(input: {
  consentId: string;
  facilityId: string;
  otpRecord?: string;
  otp?: string;
  reject?: { reason: string };
}): Promise<ConsentDecision> {
  const data = await hieRequest<unknown>({
    method: 'POST',
    path: `/shr/consents/${encodeURIComponent(input.consentId)}/verify`,
    facilityId: input.facilityId,
    body: {
      ...(input.otpRecord ? { otp_record: input.otpRecord } : {}),
      ...(input.otp ? { otp: input.otp } : {}),
      ...(input.reject ? { consent_decision: 'Reject', rejection_reason: input.reject.reason } : { consent_decision: 'Approve' }),
    },
  });
  const d = (data ?? {}) as Record<string, unknown>;
  return { consentToken: s(d.consent_token), visitId: s(d.visit_id), status: s(d.consent_status), endDate: s(d.end_date) };
}

/** A fresh consent token for a visit that is still open. */
export async function refreshVisitToken(input: { visitId: string; facilityId: string }): Promise<string | null> {
  const data = await hieRequest<unknown>({ method: 'POST', path: `/shr/visits/${encodeURIComponent(input.visitId)}/refresh`, facilityId: input.facilityId });
  const d = (data ?? {}) as Record<string, unknown>;
  return s(d.consent_token) ?? allStrings(d).find((x) => /^ey[\w-]+\.[\w-]+/.test(x)) ?? null;
}

/** Closes the visit. DHA usually texts the patient a code first (otpRecord); otherwise it's closed at once (endDate). */
export async function closeVisit(input: { visitId: string; facilityId: string }): Promise<{ otpRecord: string | null; endDate: string | null }> {
  const data = await hieRequest<unknown>({ method: 'POST', path: `/shr/visits/${encodeURIComponent(input.visitId)}/close`, facilityId: input.facilityId });
  const d = (data ?? {}) as Record<string, unknown>;
  return { otpRecord: s(d.otp_record), endDate: s(d.end_date) };
}

export async function submitBundle(input: { bundle: { id: string }; facilityId: string }): Promise<{ mediatorId: string | null }> {
  const data = await hieRequest<unknown>({ method: 'POST', path: '/shr/bundles', facilityId: input.facilityId, body: input.bundle });
  return { mediatorId: s((data as { mediator_id?: unknown } | null)?.mediator_id) };
}

/** Resource types ACISI shows from the national record. */
export const READ_RESOURCES = ['Encounter', 'Condition', 'MedicationRequest', 'AllergyIntolerance', 'Observation', 'Immunization'] as const;

export async function fetchPatientRecords(input: {
  crId: string;
  practitionerId: string;
  facilityId: string;
  consentToken: string;
  pageToken?: string;
}): Promise<unknown> {
  return hieRequest<unknown>({
    method: 'GET',
    path: '/shr/patient-records',
    facilityId: input.facilityId,
    query: { cr_id: input.crId, practitioner_id: input.practitionerId, resources: READ_RESOURCES.join(','), page_token: input.pageToken },
    headers: { 'X-Consent-Token': input.consentToken },
  });
}
