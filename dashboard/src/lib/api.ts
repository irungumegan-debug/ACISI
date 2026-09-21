export interface StaffSession {
  staffId: string;
  staffCode: string;
  staffName: string;
  role: string;
  clinicId: string;
  clinicName: string;
}

export interface PatientListItem {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

export interface VisitHistoryEntry {
  clinicName: string;
  visitedAt: string;
}

export interface PatientDetail {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string | null;
  sex: string;
  history: VisitHistoryEntry[];
}

export type CheckInStatus = 'PENDING_PAYMENT' | 'PAID' | 'FAILED' | 'CANCELLED';
export type EncounterStatus = 'WAITING' | 'IN_CONSULTATION' | 'READY_FOR_CHECKOUT' | 'DONE';

export interface QueueItem {
  checkInId: string;
  encounterId: string | null;
  patientId: string;
  patientName: string;
  patientCode: string;
  phoneNumber: string;
  departmentName: string;
  amountKes: number;
  checkInStatus: CheckInStatus;
  encounterStatus: EncounterStatus | null;
  paidAt: string | null;
  createdAt: string;
}

export interface DoctorQueueItem {
  encounterId: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  phoneNumber: string;
  status: EncounterStatus;
  waitingSince: string;
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
    return request<{ checkIns: QueueItem[] }>('/checkins/today');
  },

  getInviteCode() {
    return request<{ inviteCode: string }>('/clinic/invite-code');
  },

  regenerateInviteCode() {
    return request<{ inviteCode: string }>('/clinic/invite-code/regenerate', { method: 'POST' });
  },

  confirmCheckInPaid(checkInId: string) {
    return request<{ checkInId: string; status: CheckInStatus }>(`/checkins/${checkInId}/confirm-payment`, {
      method: 'POST',
    });
  },

  checkoutCheckIn(checkInId: string) {
    return request<{ encounterId: string; status: EncounterStatus }>(`/checkins/${checkInId}/checkout`, {
      method: 'POST',
    });
  },

  getDoctorQueue() {
    return request<{ queue: DoctorQueueItem[] }>('/doctor/queue');
  },

  getDoctorEncounter(encounterId: string) {
    return request<EncounterDetail>(`/doctor/encounters/${encounterId}`);
  },

  submitConsultation(encounterId: string, diagnosis: string, prescription: string) {
    return request<{ encounterId: string; status: EncounterStatus }>(`/doctor/encounters/${encounterId}/consult`, {
      method: 'POST',
      body: JSON.stringify({ diagnosis, prescription }),
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
