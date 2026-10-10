export interface StaffSession {
  staffId: string;
  staffCode: string;
  staffName: string;
  role: string;
  clinicId: string;
  clinicName: string;
}

export type DoctorPresenceStatus = 'IN' | 'OUT' | 'NOT_IN_YET';

export interface AdminDepartment {
  id: string;
  name: string;
  code: string;
  consultationFeeKes: number | null;
  isActive: boolean;
  visitCount: number;
  doctorCount: number;
  upcomingAppointmentCount: number;
  canDelete: boolean;
}

export interface DepartmentChange {
  name?: string;
  code?: string;
  consultationFeeKes?: number | null;
  isActive?: boolean;
}

export interface ClinicStaffListItem {
  id: string;
  staffCode: string;
  name: string;
  role: string;
  departmentName: string | null;
  /** Every department a doctor works in (empty for other roles). */
  departments: { id: string; name: string }[];
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

export type PatientIdType = 'NATIONAL_ID' | 'PASSPORT' | 'BIRTH_CERTIFICATE' | 'ALIEN_ID';

/** Optional ID document and next of kin, as edited in forms ('' = not entered). */
export interface PatientIdentity {
  idType: PatientIdType | '';
  idNumber: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
}

/** As stored (null = not on file). */
export interface PatientIdentityRecord {
  idType: PatientIdType | null;
  idNumber: string | null;
  nextOfKinName: string | null;
  nextOfKinPhone: string | null;
}

export interface PatientDetail extends PatientIdentityRecord {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string | null;
  sex: string;
  smsOptOut: boolean;
  history: VisitHistoryEntry[];
  hasHiddenHistoryElsewhere: boolean;
}

export type CheckInStatus = 'PENDING_PAYMENT' | 'PAID' | 'FAILED' | 'CANCELLED' | 'NO_FEE' | 'NEEDS_REVIEW';
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
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  amountKes: number;
  checkInStatus: CheckInStatus;
  source: CheckInSource;
  /** Who checked the patient in at the front desk (walk-ins); null for remote check-ins. */
  checkedInByName: string | null;
  encounterStatus: EncounterStatus | null;
  assignedDoctorId: string | null;
  assignedDoctorName: string | null;
  /** Clinic checkout bill status (null until a bill is made). */
  billStatus: BillStatus | null;
  billBalanceKes: number | null;
  paidAt: string | null;
  createdAt: string;
}

export interface DoctorOption {
  id: string;
  name: string;
  waitingCount: number;
  inConsultation: boolean;
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
  patient: {
    id: string;
    name: string;
    patientCode: string;
    lastVisitAt: string | null;
    /** Only whether they're on file — the details aren't shown at lookup. */
    hasIdOnFile: boolean;
    hasNextOfKinOnFile: boolean;
  } | null;
  /** The Privacy Notice box is needed: a new patient, their first walk-in at this clinic, or a new notice version. */
  privacyNoticeAckRequired: boolean;
}

export type Sex = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';

export interface WalkInRequest {
  phone: string;
  departmentId: string;
  reasonForVisit: string;
  smsConsent: boolean;
  smsOptOut?: boolean;
  /** "Patient has been told how their data is used and where to read the Privacy Notice." */
  privacyNoticeExplained: boolean;
  /** Optional; empty fields leave what's on file alone. */
  identity?: PatientIdentity;
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

export type BillStatus = 'UNPAID' | 'PARTLY_PAID' | 'PAID';
export type BillItemKind = 'CONSULTATION' | 'LAB' | 'MEDICATION' | 'OTHER';
export type PaymentMethod = 'CASH' | 'CARD' | 'MPESA_STK' | 'MPESA_MANUAL';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'VOIDED';

export interface BillItem {
  kind: BillItemKind;
  description: string;
  amountKes: number;
}

export interface CheckoutPayment {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountKes: number;
  cashTenderedKes: number | null;
  changeKes: number | null;
  reference: string | null;
  mpesaReceiptNumber: string | null;
  phoneNumber: string | null;
  resultDesc: string | null;
  takenByName: string;
  createdAt: string;
  completedAt: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
}

export interface CheckoutView {
  encounterId: string;
  checkInId: string;
  visitStatus: EncounterStatus;
  /** A demo clinic: M-Pesa requests are simulated (recorded at once, nothing charged) and no SMS is sent. */
  isDemo: boolean;
  patient: { id: string; name: string; patientCode: string; phoneNumber: string; smsOptOut: boolean };
  departmentName: string;
  /** What the doctor prescribed (never the diagnosis) and who signed it. */
  prescription: string | null;
  prescribedBy: string | null;
  /** The visit's department; its own fee (if set) pre-fills the consultation line. */
  department: { id: string; name: string; consultationFeeKes: number | null };
  settings: {
    acceptsCash: boolean;
    acceptsCard: boolean;
    acceptsMobileMoney: boolean;
    mobileMoneyType: 'TILL' | 'PAYBILL' | null;
    mobileMoneyNumber: string | null;
    defaultConsultationFeeKes: number;
    stkAvailable: boolean;
  };
  bill: null | {
    id: string;
    billNumber: string;
    items: BillItem[];
    subtotalKes: number;
    discountKes: number;
    discountReason: string | null;
    totalKes: number;
    paidKes: number;
    balanceKes: number;
    status: BillStatus;
    paidAt: string | null;
    receiptSmsSentAt: string | null;
    createdAt: string;
  };
  payments: CheckoutPayment[];
}

export type PaymentRequest =
  | { method: 'CASH'; tenderedKes: number; idempotencyKey: string }
  | { method: 'CARD'; amountKes: number; reference: string; idempotencyKey: string }
  | { method: 'MPESA_MANUAL'; amountKes: number; mpesaCode: string; idempotencyKey: string };

export interface PaymentSettings {
  acceptsCash: boolean;
  acceptsCard: boolean;
  acceptsMobileMoney: boolean;
  mobileMoneyType: 'TILL' | 'PAYBILL' | null;
  mobileMoneyNumber: string | null;
  paybillAccountFormat: string | null;
  defaultConsultationFeeKes: number;
}

export interface DailySummary {
  date: string;
  totals: { cashKes: number; cardKes: number; mobileMoneyKes: number; totalKes: number };
  paymentCount: number;
  voidedCount: number;
  paidVisitCount: number;
  byDepartment: { departmentId: string; name: string; code: string; totalKes: number; paymentCount: number }[];
  departmentCount: number;
  outstanding: {
    encounterId: string;
    checkInId: string;
    patientName: string;
    patientCode: string;
    visitedAt: string;
    visitStatus: EncounterStatus;
    billStatus: 'NO_BILL' | 'UNPAID' | 'PARTLY_PAID';
    totalKes: number | null;
    paidKes: number;
    balanceKes: number | null;
  }[];
}

/** One key per payment attempt, so a double click or retry can't record it twice. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
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
  getCheckout(encounterId: string) {
    return request<CheckoutView>(`/billing/visits/${encodeURIComponent(encounterId)}`);
  },
  saveBill(encounterId: string, body: { items: BillItem[]; discountKes: number; discountReason: string | null }) {
    return request<CheckoutView>(`/billing/visits/${encodeURIComponent(encounterId)}/bill`, { method: 'PUT', body: JSON.stringify(body) });
  },
  recordPayment(billId: string, body: PaymentRequest) {
    return request<{ paymentId: string; changeKes: number | null; billStatus: BillStatus }>(`/billing/bills/${encodeURIComponent(billId)}/payments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  requestMpesa(billId: string, body: { amountKes: number; phone?: string; idempotencyKey: string }) {
    return request<{ paymentId: string; status: PaymentStatus; resultDesc: string | null }>(
      `/billing/bills/${encodeURIComponent(billId)}/mpesa-request`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
  voidPayment(paymentId: string, reason: string) {
    return request<{ billStatus: BillStatus; paidKes: number }>(`/billing/payments/${encodeURIComponent(paymentId)}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
  getDailySummary(date: string) {
    return request<DailySummary>(`/billing/reports/daily?date=${encodeURIComponent(date)}`);
  },
  getAdminDepartments() {
    return request<{ departments: AdminDepartment[] }>('/clinic/departments');
  },

  suggestDepartmentCode(name: string) {
    return request<{ code: string }>(`/clinic/departments/suggest-code?name=${encodeURIComponent(name)}`);
  },

  createDepartment(body: { name: string; code?: string; consultationFeeKes?: number | null }) {
    return request<{ id: string }>('/clinic/departments', { method: 'POST', body: JSON.stringify(body) });
  },

  updateDepartment(id: string, change: DepartmentChange) {
    return request<{ id: string }>(`/clinic/departments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(change) });
  },

  deleteDepartment(id: string) {
    return request<null>(`/clinic/departments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  setDoctorDepartments(staffId: string, departmentIds: string[]) {
    return request<{ departments: { id: string; name: string }[] }>(`/clinic/staff/${encodeURIComponent(staffId)}/departments`, {
      method: 'PUT',
      body: JSON.stringify({ departmentIds }),
    });
  },

  getPaymentSettings() {
    return request<PaymentSettings & { stkConfigured: boolean; stkMode: string }>('/clinic/payment-settings');
  },
  savePaymentSettings(body: PaymentSettings) {
    return request<{ ok: true }>('/clinic/payment-settings', { method: 'PUT', body: JSON.stringify(body) });
  },
  /** Saves the ID document and next of kin; fields sent empty are cleared. */
  updatePatientDetails(patientId: string, identity: PatientIdentity) {
    return request<PatientIdentityRecord>(`/patients/${encodeURIComponent(patientId)}/details`, {
      method: 'PATCH',
      body: JSON.stringify(identity),
    });
  },
  setSmsPreference(patientId: string, smsOptOut: boolean) {
    return request<{ smsOptOut: boolean }>(`/patients/${encodeURIComponent(patientId)}/sms-preference`, {
      method: 'PATCH',
      body: JSON.stringify({ smsOptOut }),
    });
  },
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

  /** Whether this staff member must accept the current Terms of Service before using the console. */
  getLegalStatus() {
    return request<{ termsAcceptanceRequired: boolean }>('/legal');
  },
  acceptTerms() {
    return request<{ termsAcceptanceRequired: boolean }>('/legal/accept', { method: 'POST', body: JSON.stringify({ accept: true }) });
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

  /** Manual confirmation of the check-in fee, with the M-Pesa code from the patient's SMS. */
  confirmCheckInPaid(checkInId: string, mpesaCode: string) {
    return request<{ checkInId: string; status: CheckInStatus }>(`/checkins/${encodeURIComponent(checkInId)}/confirm-payment`, {
      method: 'POST',
      body: JSON.stringify({ mpesaCode }),
    });
  },

  getDoctorOptions(checkInId: string) {
    return request<{ currentDoctorId: string | null; doctors: DoctorOption[] }>(`/checkins/${encodeURIComponent(checkInId)}/doctor-options`);
  },

  changeDoctor(checkInId: string, doctorId: string) {
    return request<{ changed: boolean; doctorName: string }>(`/checkins/${encodeURIComponent(checkInId)}/doctor`, {
      method: 'POST',
      body: JSON.stringify({ doctorId }),
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
