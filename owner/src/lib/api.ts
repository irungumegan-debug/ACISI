export interface OwnerSession {
  ownerId: string;
  email: string;
  name: string;
}

export interface Overview {
  clinics: { active: number; total: number };
  staff: { active: number; total: number };
  doctors: { active: number };
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
  doctorCount: number;
  /** Active non-doctor staff (front desk, clinicians, admins). */
  staffCount: number;
  visitCount: number;
  visitsLast30Days: number;
  revenueKes: number;
  revenueLast30DaysKes: number;
}

export interface StaffListItem {
  id: string;
  staffCode: string;
  name: string;
  role: string;
  phoneNumber: string;
  departmentName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** Visits this person consulted on, as a doctor. */
  consultationCount: number;
}

export interface ClinicDetail {
  id: string;
  name: string;
  county: string | null;
  ussdCode: string;
  inviteCode: string;
  isActive: boolean;
  createdAt: string;
  visitCount: number;
  visitsLast30Days: number;
  upcomingAppointments: number;
  revenueKes: number;
  revenueLast30DaysKes: number;
  departments: { id: string; name: string; isActive: boolean }[];
  staff: StaffListItem[];
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
  setStaffActive(id: string, active: boolean) {
    return request<{ id: string; isActive: boolean }>(
      `/staff/${encodeURIComponent(id)}/${active ? 'reactivate' : 'deactivate'}`,
      { method: 'POST' },
    );
  },
  /** Deletes a patient account by its patient ID. Returns nothing about the patient. */
  deletePatient(patientCode: string) {
    return request<void>('/patients/delete', { method: 'POST', body: JSON.stringify({ patientCode }) });
  },
  activity(params: { actorType?: string; before?: string }) {
    return request<{ entries: ActivityEntry[]; hasMore: boolean }>(`/activity${qs(params)}`);
  },
};
