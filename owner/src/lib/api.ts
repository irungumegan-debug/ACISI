export interface OwnerSession {
  ownerId: string;
  email: string;
  name: string;
}

export interface Overview {
  clinics: { active: number; total: number };
  staff: { active: number; total: number };
  patients: { active: number; deleted: number };
  visits: { total: number; last30Days: number };
  upcomingAppointments: number;
  revenueKes: { total: number; last30Days: number };
}

export interface ClinicListItem {
  id: string;
  name: string;
  county: string | null;
  ussdCode: string;
  isActive: boolean;
  createdAt: string;
  staffCount: number;
  visitCount: number;
}

export interface StaffListItem {
  id: string;
  staffCode: string;
  name: string;
  role: string;
  phoneNumber: string;
  clinicId?: string;
  clinicName?: string;
  departmentName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export type EncounterStatus = 'WAITING' | 'IN_CONSULTATION' | 'READY_FOR_CHECKOUT' | 'DONE';

export interface ClinicDetail {
  id: string;
  name: string;
  county: string | null;
  ussdCode: string;
  inviteCode: string;
  isActive: boolean;
  createdAt: string;
  visitCount: number;
  appointmentCount: number;
  revenueKes: number;
  departments: { id: string; name: string; isActive: boolean }[];
  staff: StaffListItem[];
  recentVisits: {
    encounterId: string;
    patientId: string;
    patientName: string;
    patientCode: string;
    patientDeleted: boolean;
    departmentName: string;
    status: EncounterStatus;
    visitedAt: string;
  }[];
}

export type PatientStatusFilter = 'active' | 'deleted' | 'all';

export interface PatientListItem {
  id: string;
  patientCode: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  createdAt: string;
  deletedAt: string | null;
  visitCount: number;
}

export interface ActivityEntry {
  id: string;
  actorType: 'PATIENT' | 'STAFF' | 'SYSTEM' | 'OWNER';
  actorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface PatientDetail {
  id: string;
  patientCode: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  email: string | null;
  dateOfBirth: string | null;
  sex: string;
  county: string | null;
  hasPin: boolean;
  createdAt: string;
  deletedAt: string | null;
  deletedByType: 'PATIENT' | 'OWNER' | null;
  crossClinicSharing: boolean;
  consents: { id: string; type: string; granted: boolean; channel: string; version: string; createdAt: string }[];
  visits: {
    encounterId: string;
    clinicId: string;
    clinicName: string;
    departmentName: string;
    status: EncounterStatus;
    assignedDoctorName: string | null;
    consultedByName: string | null;
    visitReason: string | null;
    diagnosis: string | null;
    prescription: string | null;
    amountKes: number;
    paymentStatus: string;
    mpesaReceiptNumber: string | null;
    visitedAt: string;
    checkedOutAt: string | null;
  }[];
  appointments: {
    id: string;
    clinicName: string;
    departmentName: string;
    scheduledFor: string;
    status: string;
    createdAt: string;
  }[];
  accessLog: ActivityEntry[];
}

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
  const res = await fetch(`/api/owner${path}`, {
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

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

export const api = {
  login(email: string, password: string) {
    return request<{ name: string; email: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  logout() {
    return request<void>('/auth/logout', { method: 'POST' });
  },
  me() {
    return request<OwnerSession>('/auth/me');
  },
  overview() {
    return request<Overview>('/overview');
  },
  clinics(q?: string) {
    return request<{ clinics: ClinicListItem[] }>(`/clinics${qs({ q })}`);
  },
  clinic(id: string) {
    return request<ClinicDetail>(`/clinics/${encodeURIComponent(id)}`);
  },
  setClinicActive(id: string, active: boolean) {
    return request<{ id: string; isActive: boolean }>(
      `/clinics/${encodeURIComponent(id)}/${active ? 'reactivate' : 'deactivate'}`,
      { method: 'POST' },
    );
  },
  staff(q?: string) {
    return request<{ staff: StaffListItem[] }>(`/staff${qs({ q })}`);
  },
  setStaffActive(id: string, active: boolean) {
    return request<{ id: string; isActive: boolean }>(
      `/staff/${encodeURIComponent(id)}/${active ? 'reactivate' : 'deactivate'}`,
      { method: 'POST' },
    );
  },
  patients(q: string, status: PatientStatusFilter) {
    return request<{ patients: PatientListItem[] }>(`/patients${qs({ q, status })}`);
  },
  patient(id: string) {
    return request<PatientDetail>(`/patients/${encodeURIComponent(id)}`);
  },
  deletePatient(id: string, confirmPatientCode: string) {
    return request<void>(`/patients/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      body: JSON.stringify({ confirmPatientCode }),
    });
  },
  activity(params: { actorType?: string; before?: string }) {
    return request<{ entries: ActivityEntry[]; hasMore: boolean }>(`/activity${qs(params)}`);
  },
};
