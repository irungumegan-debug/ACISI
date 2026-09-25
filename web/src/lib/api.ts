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

  registerClinic(input: { name: string; county?: string; adminName: string; adminPhoneNumber: string; adminPin: string }) {
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

  patientMe() {
    return request<PatientSession>('/patients/me');
  },

  forgotPatientPin(identifier: string) {
    return request<{ message: string }>('/patients/forgot-pin', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    });
  },

  resetPatientPin(identifier: string, code: string, newPin: string) {
    return request<{ message: string }>('/patients/reset-pin', {
      method: 'POST',
      body: JSON.stringify({ identifier, code, newPin }),
    });
  },

  patientCheckIn(clinicId: string, departmentId: string) {
    return request<{ checkInId: string; status: string }>('/patients/checkin', {
      method: 'POST',
      body: JSON.stringify({ clinicId, departmentId }),
    });
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
