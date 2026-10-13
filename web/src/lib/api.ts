export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** The whole error body, for errors that carry more than a message. */
    public body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? 'Something went wrong. Please try again.', res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface ClinicListItem {
  id: string;
  name: string;
}

export interface DepartmentListItem {
  id: string;
  name: string;
}

export type PatientIdType = 'NATIONAL_ID' | 'PASSPORT' | 'BIRTH_CERTIFICATE' | 'ALIEN_ID';

/** Optional ID document and next of kin, as edited in forms ('' = not entered). */
export interface PatientIdentity {
  idType: PatientIdType | '';
  idNumber: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
}

export interface PatientSession {
  patientCode: string;
  firstName: string;
  /** Whether they've ticked "I have saved my ACISI ID". Until then the portal shows their ID first. */
  idSaved?: boolean;
}

/** A person on a shared phone, as shown to whoever proved they hold the phone: "Jane W." */
export interface PhonePerson {
  id: string;
  displayName: string;
  hasPin?: boolean;
}

export type PatientLoginResult = PatientSession | { choose: PhonePerson[] };

export type AppointmentStatus = 'REQUESTED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export interface OwnAppointment {
  id: string;
  clinicName: string;
  departmentName: string;
  scheduledFor: string;
  status: AppointmentStatus;
}

export type CheckInStatus = 'PENDING_PAYMENT' | 'PAID' | 'FAILED' | 'CANCELLED' | 'NO_FEE' | 'NEEDS_REVIEW';

export interface CheckInSummary {
  checkInId: string;
  status: CheckInStatus;
  clinicName: string;
  departmentName: string;
  /** 1 = next in line. Null when not known (not paid yet, or already with the doctor). */
  queuePosition: number | null;
}

export interface StaffSessionSummary {
  staffName: string;
  clinicName: string;
  role: 'RECEPTIONIST' | 'CLINICIAN' | 'DOCTOR' | 'ADMIN';
}

export const api = {
  // ---- Clinics ----
  listClinics() {
    return request<{ clinics: ClinicListItem[] }>('/clinics');
  },

  registerClinic(input: {
    name: string;
    county?: string;
    adminName: string;
    adminPhoneNumber: string;
    adminPin: string;
    departments: { name: string; code: string; consultationFeeKes: number | null }[];
    /** "I accept the Terms of Service and have read the Privacy Notice" — required by the server. */
    acceptLegal: boolean;
  }) {
    return request<{ clinicName: string; inviteCode: string; staffCode: string }>('/clinics/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getDepartmentsByClinic(clinicId: string) {
    return request<{ departments: DepartmentListItem[] }>(`/clinics/${encodeURIComponent(clinicId)}/departments`);
  },

  getDepartmentsByInviteCode(inviteCode: string) {
    return request<{ clinicName: string; departments: DepartmentListItem[] }>(
      `/clinics/invite-code/${encodeURIComponent(inviteCode)}/departments`,
    );
  },

  // ---- Staff / doctor ----
  registerStaff(input: {
    name: string;
    phoneNumber: string;
    inviteCode: string;
    pin: string;
    role: 'RECEPTIONIST' | 'DOCTOR';
    departmentId?: string;
  }) {
    return request<{ staffCode: string }>('/staff/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  staffLogin(staffCode: string, pin: string) {
    return request<StaffSessionSummary>('/staff/auth/login', {
      method: 'POST',
      body: JSON.stringify({ staffCode, pin }),
    });
  },

  // ---- Patients ----
  /** Phone number or ACISI ID + PIN. On a shared phone the answer may be "which of these people are you?". */
  patientLogin(identifier: string, pin: string, keepSignedIn: boolean, patientId?: string) {
    return request<PatientLoginResult>('/patients/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, pin, keepSignedIn, ...(patientId ? { patientId } : {}) }),
    });
  },

  /** Texts a one-time code: "login" for a first login or signup, "reset" for a forgotten PIN. */
  requestPatientCode(phone: string, purpose: 'login' | 'reset') {
    return request<{ message: string }>('/patients/otp/request', { method: 'POST', body: JSON.stringify({ phone, purpose }) });
  },
  verifyPatientCode(phone: string, purpose: 'login' | 'reset', code: string) {
    return request<{ flowToken: string; people: PhonePerson[] }>('/patients/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, purpose, code }),
    });
  },
  selectSetupPerson(flowToken: string, patientId: string) {
    return request<void>('/patients/setup/select', { method: 'POST', body: JSON.stringify({ flowToken, patientId }) });
  },
  verifySetupDateOfBirth(flowToken: string, dateOfBirth: string) {
    return request<void>('/patients/setup/verify-dob', { method: 'POST', body: JSON.stringify({ flowToken, dateOfBirth }) });
  },
  setSetupPin(flowToken: string, pin: string, pinConfirm: string, keepSignedIn: boolean) {
    return request<PatientSession>('/patients/setup/set-pin', { method: 'POST', body: JSON.stringify({ flowToken, pin, pinConfirm, keepSignedIn }) });
  },
  registerPatientAfterCode(input: {
    flowToken: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    sex: 'MALE' | 'FEMALE' | 'OTHER';
    pin: string;
    pinConfirm: string;
    email?: string;
    acceptLegal: boolean;
    keepSignedIn: boolean;
  }) {
    return request<PatientSession>('/patients/setup/register', { method: 'POST', body: JSON.stringify(input) });
  },
  /** Which clinics can see the patient's records from other clinics. */
  getRecordAccess() {
    return request<{ clinics: { clinicId: string; clinicName: string; grantedAt: string }[]; allClinicsFromSignup: boolean }>('/patients/record-access');
  },
  revokeClinicAccess(clinicId: string) {
    return request<void>(`/patients/record-access/${encodeURIComponent(clinicId)}/revoke`, { method: 'POST' });
  },
  revokeAllClinicsSharing() {
    return request<void>('/patients/record-access/all-clinics/revoke', { method: 'POST' });
  },
  /** "I have saved my ACISI ID". */
  markPatientIdSaved() {
    return request<void>('/patients/id-saved', { method: 'POST' });
  },

  patientLogout() {
    return request<void>('/patients/logout', { method: 'POST' });
  },

  /** Permanently deletes the logged-in patient's account. Requires their PIN again. */
  deletePatientAccount(pin: string) {
    return request<void>('/patients/account/delete', { method: 'POST', body: JSON.stringify({ pin }) });
  },

  patientMe() {
    return request<PatientSession>('/patients/me');
  },

  forgotStaffPin(staffCode: string) {
    return request<{ message: string }>('/staff/auth/forgot-pin', {
      method: 'POST',
      body: JSON.stringify({ staffCode }),
    });
  },

  resetStaffPin(staffCode: string, code: string, newPin: string) {
    return request<{ message: string }>('/staff/auth/reset-pin', {
      method: 'POST',
      body: JSON.stringify({ staffCode, code, newPin }),
    });
  },

  /** Starts a check-in, or hands back the patient's check-in already in progress at this clinic today (existing: true). */
  patientCheckIn(clinicId: string, departmentId: string, privacyNoticeAcknowledged: boolean, identity?: PatientIdentity) {
    return request<CheckInSummary & { existing: boolean }>('/patients/checkin', {
      method: 'POST',
      body: JSON.stringify({ clinicId, departmentId, privacyNoticeAcknowledged, identity }),
    });
  },

  /** Polled after the M-Pesa prompt is sent, until the check-in is PAID or FAILED. */
  getCheckIn(checkInId: string) {
    return request<CheckInSummary>(`/patients/checkin/${encodeURIComponent(checkInId)}`);
  },

  /** The patient's own ID document and next of kin (null when not on file). */
  getPatientDetails() {
    return request<{ idType: PatientIdType | null; idNumber: string | null; nextOfKinName: string | null; nextOfKinPhone: string | null }>(
      '/patients/details',
    );
  },

  /** Whether checking in at this clinic needs the Privacy Notice checkbox (first check-in there, or a new notice version). */
  getCheckInPrivacyNotice(clinicId: string) {
    return request<{ acknowledgmentRequired: boolean; clinicName: string; version: string }>(
      `/patients/checkin/privacy-notice?clinicId=${encodeURIComponent(clinicId)}`,
    );
  },

  /** Whether the portal must ask the patient to accept the current Terms before anything else. */
  getPatientLegalStatus() {
    return request<{ termsAcceptanceRequired: boolean }>('/patients/legal');
  },

  acceptPatientTerms() {
    return request<{ termsAcceptanceRequired: boolean }>('/patients/legal/accept', { method: 'POST', body: JSON.stringify({ accept: true }) });
  },

  getPatientRecords() {
    return request<{ history: VisitHistoryEntry[] }>('/patients/records');
  },

  bookAppointment(clinicId: string, departmentId: string, scheduledFor: string) {
    return request<{ appointmentId: string; status: AppointmentStatus }>('/patients/appointments', {
      method: 'POST',
      body: JSON.stringify({ clinicId, departmentId, scheduledFor }),
    });
  },

  getMyAppointments() {
    return request<{ appointments: OwnAppointment[] }>('/patients/appointments');
  },

  cancelAppointment(appointmentId: string) {
    return request<{ appointmentId: string; status: AppointmentStatus }>(
      `/patients/appointments/${encodeURIComponent(appointmentId)}/cancel`,
      { method: 'POST' },
    );
  },

  /** Not a fetch — same-origin browser navigation already carries the session cookie, so this just builds the href for a plain download link. */
  recordDownloadUrl(encounterId: string) {
    return `/api/patients/records/${encodeURIComponent(encounterId)}/download`;
  },
};

export interface VisitHistoryEntry {
  encounterId: string;
  clinicName: string;
  departmentName: string;
  visitedAt: string;
  diagnosis: string | null;
  prescription: string | null;
}
