import { currentDemoKey } from './demoLink';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
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
    throw new ApiError(body.error ?? 'Something went wrong. Please try again.', res.status);
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
}

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
  /** Public clinic list; a demo link's key (see lib/demoLink.ts) adds that demo clinic first. */
  listClinics() {
    const demoKey = currentDemoKey();
    return request<{ clinics: ClinicListItem[] }>(demoKey ? `/clinics?demo=${encodeURIComponent(demoKey)}` : '/clinics');
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
  registerPatient(input: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
    dateOfBirth?: string;
    pin: string;
    crossClinicConsent: boolean;
    email?: string;
    /** "I accept the Terms of Service and have read the Privacy Notice" — required by the server. */
    acceptLegal: boolean;
  }) {
    return request<PatientSession>('/patients/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  patientLogin(identifier: string, pin: string) {
    return request<PatientSession>('/patients/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, pin }),
    });
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

  forgotPatientPin(identifier: string) {
    return request<{ message: string }>('/patients/forgot-pin', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    });
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

  resetPatientPin(identifier: string, code: string, newPin: string) {
    return request<{ message: string }>('/patients/reset-pin', {
      method: 'POST',
      body: JSON.stringify({ identifier, code, newPin }),
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
