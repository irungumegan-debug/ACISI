export interface StaffSession {
  staffId: string;
  staffName: string;
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

export type ConsultationStatus = 'WAITING' | 'IN_CONSULTATION' | 'DONE';

export interface Department {
  id: string;
  name: string;
}

export interface TodayQueueItem {
  encounterId: string;
  patientId: string;
  patientName: string;
  phoneNumber: string;
  departmentId: string | null;
  departmentName: string;
  channel: string;
  consultationStatus: ConsultationStatus;
  checkInTime: string;
  prescription: string | null;
  notes: string | null;
}

export interface CheckoutInput {
  notes?: string;
  prescription?: string;
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
  login(phoneNumber: string, pin: string) {
    return request<{ staffName: string; clinicName: string; role: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, pin }),
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

  getTodayQueue(departmentId?: string) {
    const qs = departmentId ? `?department=${encodeURIComponent(departmentId)}` : '';
    return request<{ queue: TodayQueueItem[] }>(`/checkins/today${qs}`);
  },

  getDepartments() {
    return request<{ departments: Department[] }>('/departments');
  },

  startConsultation(encounterId: string) {
    return request<{ encounterId: string; consultationStatus: ConsultationStatus }>(
      `/checkins/${encounterId}/start`,
      { method: 'POST' },
    );
  },

  checkout(encounterId: string, input: CheckoutInput) {
    return request<{ encounterId: string; consultationStatus: ConsultationStatus }>(
      `/checkins/${encounterId}/checkout`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },
};

export { ApiError };
