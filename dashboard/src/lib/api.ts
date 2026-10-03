export interface StaffSession {
  staffId: string;
  staffCode: string;
  staffName: string;
  role: string;
  clinicId: string;
  clinicName: string;
}

export type DoctorPresenceStatus = 'IN' | 'OUT' | 'NOT_IN_YET';

export interface ClinicStaffListItem {
  id: string;
  staffCode: string;
  name: string;
  role: string;
  departmentName: string | null;
  isActive: boolean;
  presence: DoctorPresenceStatus | null;
}

export interface PatientListItem {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

export interface VisitHistoryEntry {
  encounterId: string;
  clinicName: string;
  visitedAt: string;
  diagnosis: string | null;
  prescription: string | null;
  isOwnClinic: boolean;
}

export interface PatientDetail {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string | null;
  sex: string;
  history: VisitHistoryEntry[];
  hasHiddenHistoryElsewhere: boolean;
}

export type CheckInStatus = 'PENDING_PAYMENT' | 'PAID' | 'FAILED' | 'CANCELLED' | 'NO_FEE';
export type CheckInSource = 'REMOTE' | 'WALK_IN';
export type EncounterStatus = 'WAITING' | 'IN_CONSULTATION' | 'READY_FOR_CHECKOUT' | 'DONE';

export interface QueueItem {
  checkInId: string;
  encounterId: string | null;
  patientId: string;
  patientName: string;
  patientCode: string;
  phoneNumber: string;
  patientEmail: string | null;
  departmentName: string;
  amountKes: number;
  checkInStatus: CheckInStatus;
  source: CheckInSource;
  /** Who checked the patient in at the front desk (walk-ins); null for remote check-ins. */
  checkedInByName: string | null;
  encounterStatus: EncounterStatus | null;
  assignedDoctorName: string | null;
  paidAt: string | null;
  createdAt: string;
}

export type CheckoutDeliveryMethod = 'sms' | 'sms_and_email';

export interface DoctorQueueItem {
  encounterId: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  phoneNumber: string;
  status: EncounterStatus;
  waitingSince: string;
}

export type AppointmentStatus = 'REQUESTED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export interface ClinicAppointmentItem {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  phoneNumber: string;
  departmentName: string;
  scheduledFor: string;
  status: AppointmentStatus;
}

export interface DoctorAppointmentItem {
  id: string;
  patientName: string;
  patientCode: string;
  scheduledFor: string;
}

export interface HistoryEntry {
  encounterId: string;
  clinicName: string;
  visitedAt: string;
  diagnosis: string | null;
  prescription: string | null;
  isOwnClinic: boolean;
}

export interface EncounterDetail {
  encounterId: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  phoneNumber: string;
  status: EncounterStatus;
  history: HistoryEntry[];
  hasHiddenHistoryElsewhere: boolean;
}

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface WalkInLookup {
  phoneNumber: string;
  patient: { id: string; name: string; patientCode: string; lastVisitAt: string | null } | null;
}

export type Sex = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';

export interface WalkInRequest {
  phone: string;
  departmentId: string;
  reasonForVisit: string;
  smsConsent: boolean;
  newPatient?: {
    fullName: string;
    dateOfBirth?: string;
    age?: number;
    sex?: Sex;
    registrationConsent: boolean;
  };
}

export interface WalkInResult {
  checkInId: string;
  patientName: string;
  patientCode: string;
  isNewPatient: boolean;
  departmentName: string;
  queuePosition: number;
  sms: 'sent' | 'failed' | 'not_requested';
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/staff${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? 'Request failed', res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  /** Active departments at a clinic — the same public list the patient check-in form uses. */
  async getDepartments(clinicId: string): Promise<{ departments: DepartmentOption[] }> {
    const res = await fetch(`/api/clinics/${encodeURIComponent(clinicId)}/departments`, { credentials: 'include' });
    if (!res.ok) throw new ApiError('Could not load departments', res.status);
    return res.json() as Promise<{ departments: DepartmentOption[] }>;
  },
  lookupWalkIn(phone: string) {
    return request<WalkInLookup>(`/walk-in/lookup?phone=${encodeURIComponent(phone)}`);
  },
  checkInWalkIn(body: WalkInRequest) {
    return request<WalkInResult>('/walk-in', { method: 'POST', body: JSON.stringify(body) });
  },
  getTodayCheckInCounts() {
    return request<{ walkIn: number; remote: number }>('/walk-in/stats/today');
  },
  login(staffCode: string, pin: string) {
    return request<{ staffName: string; clinicName: string; role: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ staffCode, pin }),
    });
  },

  logout() {
    return request<void>('/auth/logout', { method: 'POST' });
  },

  me() {
    return request<StaffSession>('/auth/me');
  },

  searchPatients(query: string) {
    return request<{ patients: PatientListItem[] }>(`/patients?q=${encodeURIComponent(query)}`);
  },

  getPatient(id: string) {
    return request<PatientDetail>(`/patients/${id}`);
  },

  getTodayCheckIns() {
    return request<{ checkIns: QueueItem[]; emailDeliveryAvailable: boolean }>('/checkins/today');
  },

  getInviteCode() {
    return request<{ inviteCode: string }>('/clinic/invite-code');
  },

  regenerateInviteCode() {
    return request<{ inviteCode: string }>('/clinic/invite-code/regenerate', { method: 'POST' });
  },

  getClinicStaff() {
    return request<{ staff: ClinicStaffListItem[] }>('/clinic/staff');
  },

  resetStaffPin(staffId: string, newPin?: string) {
    return request<{ staffCode: string; name: string; newPin: string }>(`/clinic/staff/${staffId}/reset-pin`, {
      method: 'POST',
      body: JSON.stringify({ newPin }),
    });
  },

  setStaffPresence(staffId: string, status: 'IN' | 'OUT') {
    return request<{ staffCode: string; name: string; presence: DoctorPresenceStatus }>(`/clinic/staff/${staffId}/presence`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },

  confirmCheckInPaid(checkInId: string) {
    return request<{ checkInId: string; status: CheckInStatus }>(`/checkins/${checkInId}/confirm-payment`, {
      method: 'POST',
    });
  },

  checkoutCheckIn(checkInId: string, deliveryMethod: CheckoutDeliveryMethod = 'sms') {
    return request<{ encounterId: string; status: EncounterStatus }>(`/checkins/${checkInId}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ deliveryMethod }),
    });
  },

  getDoctorQueue() {
    return request<{ queue: DoctorQueueItem[]; presence: DoctorPresenceStatus }>('/doctor/queue');
  },

  getDoctorAppointmentsToday() {
    return request<{ appointments: DoctorAppointmentItem[] }>('/doctor/appointments/today');
  },

  getClinicAppointments() {
    return request<{ appointments: ClinicAppointmentItem[] }>('/appointments');
  },

  confirmAppointment(appointmentId: string) {
    return request<{ appointmentId: string; status: AppointmentStatus }>(`/appointments/${appointmentId}/confirm`, {
      method: 'POST',
    });
  },

  cancelAppointment(appointmentId: string) {
    return request<{ appointmentId: string; status: AppointmentStatus }>(`/appointments/${appointmentId}/cancel`, {
      method: 'POST',
    });
  },

  arriveAppointment(appointmentId: string) {
    return request<{ checkInId: string; status: CheckInStatus }>(`/appointments/${appointmentId}/arrive`, {
      method: 'POST',
    });
  },

  setOwnPresence(status: 'IN' | 'OUT') {
    return request<{ presence: DoctorPresenceStatus }>('/doctor/presence', {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },

  getDoctorEncounter(encounterId: string) {
    return request<EncounterDetail>(`/doctor/encounters/${encounterId}`);
  },

  submitConsultation(encounterId: string, diagnosis: string, prescription: string, pin: string) {
    return request<{ encounterId: string; status: EncounterStatus }>(`/doctor/encounters/${encounterId}/consult`, {
      method: 'POST',
      body: JSON.stringify({ diagnosis, prescription, pin }),
    });
  },
};

export { ApiError };

/**
 * Subscribes to the live check-in queue. Returns an unsubscribe function.
 * EventSource carries cookies for same-origin requests automatically, so no
 * extra auth wiring is needed here — the browser just needs to already have
 * the session cookie from a successful login. The event payload only
 * carries the bare minimum (a new arrival happened); callers refetch the
 * full queue for the current department/status/prescription data rather
 * than trying to merge a partial payload into it.
 */
export function subscribeToQueue(onCheckInPaid: () => void): () => void {
  const source = new EventSource('/api/staff/events');
  source.onmessage = () => {
    onCheckInPaid();
  };
  return () => source.close();
}
