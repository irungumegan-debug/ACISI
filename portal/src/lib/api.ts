export interface Clinic {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface CheckinRegistration {
  firstName: string;
  lastName: string;
  birthYear: number;
  sex: 'MALE' | 'FEMALE' | 'OTHER';
  consent: true;
}

export interface CheckinInput {
  clinicId: string;
  departmentId: string;
  phoneNumber: string;
  clientRequestId: string;
  registration?: CheckinRegistration;
}

export type CheckinResponse = { status: 'REGISTRATION_REQUIRED' } | { status: 'PAYMENT_PENDING'; checkInId: string };

export type CheckinStatusResponse =
  | { status: 'PENDING_PAYMENT' | 'FAILED' | 'CANCELLED' }
  | { status: 'PAID'; queuePosition: number | null };

export type VisitStatus = 'WAITING' | 'IN_CONSULTATION' | 'DONE';

export interface Visit {
  encounterId: string;
  clinicName: string;
  departmentName: string;
  visitedAt: string;
  status: VisitStatus;
  notes: string | null;
  prescription: string | null;
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
  const res = await fetch(`/api/portal${path}`, {
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
  getClinics() {
    return request<{ clinics: Clinic[] }>('/clinics');
  },

  getDepartments() {
    return request<{ departments: Department[] }>('/departments');
  },

  getFee() {
    return request<{ checkInFeeKes: number }>('/fee');
  },

  checkin(input: CheckinInput) {
    return request<CheckinResponse>('/checkin', { method: 'POST', body: JSON.stringify(input) });
  },

  getCheckinStatus(checkInId: string) {
    return request<CheckinStatusResponse>(`/checkin/${checkInId}/status`);
  },

  requestOtp(phoneNumber: string) {
    return request<{ message: string }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber }),
    });
  },

  verifyOtp(phoneNumber: string, code: string) {
    return request<{ phoneNumberE164: string }>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, code }),
    });
  },

  me() {
    return request<{ phoneNumberE164: string }>('/auth/me');
  },

  logout() {
    return request<void>('/auth/logout', { method: 'POST' });
  },

  getVisits() {
    return request<{ visits: Visit[] }>('/visits');
  },
};

export { ApiError };
