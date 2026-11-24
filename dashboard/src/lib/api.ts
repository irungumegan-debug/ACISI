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
  email: string | null;
  role: string;
  departmentName: string | null;
  /** Every department a doctor works in (empty for other roles). */
  departments: { id: string; name: string }[];
  isActive: boolean;
  /** True once they have set up an authenticator app for multi-factor login. */
  authenticatorSetUp: boolean;
  presence: DoctorPresenceStatus | null;
}

export interface PatientListItem {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

/** A WHO ICD-11 MMS code and its official title. */
export interface Icd11Code {
  code: string;
  title: string;
}

export type NotifiableReporting = 'IMMEDIATE' | 'WEEKLY';

/** A notifiable disease matched when a doctor signs a visit. */
export interface NotifiableAlert {
  diseaseId: string;
  name: string;
  reporting: NotifiableReporting;
  icd11Code: string;
  note?: string;
  /** International Health Regulations flag. */
  ihr?: 'ALWAYS' | 'ASSESS';
}

export const IHR_TEXT = {
  ALWAYS: 'IHR: always notifiable internationally. Report immediately; the Sub-County passes it to the national IHR focal point.',
  ASSESS: 'IHR: may be an event of international concern. Report immediately; the Sub-County assesses it for the national IHR focal point.',
} as const;

export interface NotifiableCase {
  id: string;
  diseaseName: string;
  reporting: NotifiableReporting;
  icd11Code: string;
  diagnosedAt: string;
  diagnosedBy: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  age: number | null;
  sex: string;
  reportedAt: string | null;
  reportedBy: string | null;
  reportNote: string | null;
  ihr?: 'ALWAYS' | 'ASSESS' | null;
}

export interface HealthEvent {
  id: string;
  type: string;
  typeLabel: string;
  immediate: boolean;
  detectedOn: string;
  casesCount: number;
  casesUnder5: number;
  deathsCount: number;
  deathsUnder5: number;
  eventDescription: string;
  eventPlace: string | null;
  recordedBy: string;
  recordedAt: string;
  reportedAt: string | null;
  reportedBy: string | null;
  reportNote: string | null;
}

export interface CountRow {
  label: string;
  count: number;
}

export interface RoutineReport {
  clinicName: string;
  county: string | null;
  period: 'MONTH' | 'QUARTER' | 'YEAR';
  value: string;
  label: string;
  startDate: string;
  endDate: string;
  visits: { total: number; completed: number; walkIn: number; remote: number };
  patients: { seen: number; newToClinic: number; returning: number };
  bySex: CountRow[];
  byAge: CountRow[];
  byDepartment: CountRow[];
  topDiagnoses: { code: string; title: string; count: number }[];
  visitsWithoutCodes: number;
  lab: { ordersRequested: number; testsDone: number; abnormal: number; critical: number };
  prescriptions: { visitsWithPrescription: number; medicineLines: number; topMedicines: CountRow[] };
  notifiable: { immediate: number; weekly: number; byDisease: CountRow[] };
  events: { total: number; cases: number; deaths: number; byType: CountRow[] };
  monthlyDiseases: {
    id: string;
    name: string;
    quarterly: boolean;
    countedByAcisi: boolean;
    note: string | null;
    under5: number;
    fiveAndOver: number;
    ageUnknown: number;
    total: number;
  }[];
}

export interface WeeklySurveillance {
  clinicName: string;
  county: string | null;
  weekStart: string;
  weekEnd: string;
  rows: {
    diseaseId: string;
    name: string;
    reporting: NotifiableReporting;
    /** The MOH 505 row it is counted in. */
    form505Row: string;
    /** False: nothing in ACISI feeds this row; count by hand. */
    countedByAcisi: boolean;
    /** DIAGNOSES: ICD-11 codes; EVENTS: public health events staff recorded. */
    source: 'DIAGNOSES' | 'EVENTS';
    under5: number;
    fiveAndOver: number;
    ageUnknown: number;
    total: number;
    /** From recorded events only. */
    deathsUnder5: number;
    deathsFiveAndOver: number;
  }[];
  totalCases: number;
  /** Date the disease list was checked against the MOH documents, or null while it is a draft. */
  listConfirmed: string | null;
  listSource: string;
}

export interface VisitHistoryEntry {
  encounterId: string;
  clinicName: string;
  visitedAt: string;
  /** Only ever sent to doctors; null for front desk. */
  diagnosis: string | null;
  /** ICD-11 coded diagnoses: doctors only (empty for front desk and for older visits). */
  diagnosisCodes?: Icd11Code[];
  prescription: string | null;
  /** Who handled the visit. */
  doctorName: string | null;
  isOwnClinic: boolean;
  /** Signed lab results: doctors only. */
  labResults?: LabResult[];
}

export type LabResultFlag = 'NORMAL' | 'ABNORMAL' | 'CRITICAL';

export interface LabResult {
  testName: string;
  value: string | null;
  unit: string | null;
  flag: LabResultFlag | null;
  comment: string | null;
  signedByName: string | null;
  signedAt: string | null;
}

export type LabOrderStatus = 'REQUESTED' | 'IN_PROGRESS' | 'RESULTS_READY';

export interface LabOrderItemView {
  id: string;
  testName: string;
  resultValue: string | null;
  resultUnit: string | null;
  resultFlag: LabResultFlag | null;
  resultComment: string | null;
}

export interface LabOrderView {
  id: string;
  status: LabOrderStatus;
  requestedAt: string;
  requestedByName: string;
  noteForLab: string | null;
  completedAt: string | null;
  completedByName: string | null;
  patientNotifiedAt: string | null;
  items: LabOrderItemView[];
  files: { id: string; categoryLabel: string; mimeType: string; uploadedAt: string }[];
}

export interface LabOrderDetailForLab extends LabOrderView {
  patientId: string;
  patientName: string;
  patientCode: string;
  age: number | null;
  sex: string;
}

export interface LabQueueItem {
  labOrderId: string;
  status: LabOrderStatus;
  requestedAt: string;
  requestedByName: string;
  patientName: string;
  patientCode: string;
  age: number | null;
  sex: string;
  testNames: string[];
}

export interface LabTestItem {
  id: string;
  name: string;
  priceKes: number;
  isActive: boolean;
  loincCode?: string | null;
}

export interface LabResultInput {
  itemId: string;
  value: string | null;
  unit: string | null;
  flag: LabResultFlag | null;
  comment: string | null;
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

/** The patient's national Client Registry ID (DHA HIE), only while it matches their current ID document. */
export interface PatientHie {
  crId: string | null;
  verifiedAt: string | null;
  /** They have an ID document the Client Registry can search (not a passport). */
  canLookUp: boolean;
}

export interface HieFacility {
  frCode: string;
  officialName: string;
  facilityType: string | null;
  kephLevel: string | null;
  county: string | null;
  subCounty: string | null;
  licenceStatus: string | null;
  registrationNumber: string | null;
}

export interface HiePractitioner {
  regulator: string | null;
  registrationNumber: string | null;
  practitionerId: string | null;
  registeredName: string | null;
  licenceEnd: string | null;
  licenceCurrent: boolean | null;
  verifiedAt: string | null;
}

export interface HieStatus {
  connected: boolean;
  facility: { frCode: string; name: string | null; verifiedAt: string | null } | null;
  practitioner: HiePractitioner | null;
}

export type ClientRegistryLookup =
  | { result: 'saved'; crId: string }
  | { result: 'check'; registry: { firstName: string | null; middleName: string | null; lastName: string | null; dateOfBirth: string | null; sex: 'MALE' | 'FEMALE' | null } };

export interface DispenseLine {
  id: string;
  text: string;
  prescribedQuantity: number | null;
  unit: string | null;
  dispenseStatus: 'DISPENSED' | 'NOT_DISPENSED' | null;
  dispensedQuantity: number | null;
  dispensedAt: string | null;
}

export interface QualityMeasure {
  id: string;
  name: string;
  definition: string;
  kind: 'percent' | 'minutes';
  numerator: number | null;
  denominator: number | null;
  value: number | null;
}

export interface ProblemItem {
  id: string;
  icd11Code: string;
  title: string;
  note: string | null;
  status: 'ACTIVE' | 'RESOLVED' | 'ENTERED_IN_ERROR';
  onsetDate: string | null;
  recordedAt: string;
  isOwnClinic: boolean;
  history: { action: string; status: string; at: string; byName: string }[];
}

export interface VitalSignsSet {
  id: string;
  encounterId: string;
  recordedAt: string;
  recordedByName: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  respiratoryRate: number | null;
  temperatureC: number | null;
  oxygenSaturation: number | null;
  weightKg: number | null;
  heightCm: number | null;
  muacCm: number | null;
  bmi: number | null;
  warnings: { field: string; level: 'danger' | 'warning'; message: string }[];
}

export type ServiceOrderCategory = 'RADIOLOGY' | 'PHYSIOTHERAPY' | 'OCCUPATIONAL_THERAPY' | 'NUTRITION' | 'SOCIAL_WORK' | 'COUNSELLING';

export interface ServiceOrderItem {
  id: string;
  category: ServiceOrderCategory;
  categoryLabel: string;
  description: string;
  note: string | null;
  urgent: boolean;
  status: 'REQUESTED' | 'DONE' | 'CANCELLED';
  requestedAt: string;
  requestedByName: string;
  closedAt: string | null;
}

export interface HieVisitInfo {
  consentStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  emergency: boolean;
  canRead: boolean;
  sendStatus: 'NOT_SENT' | 'SENDING' | 'SENT' | 'FAILED';
  sentAt: string | null;
  closeStatus: 'OPEN' | 'CODE_SENT' | 'CLOSED';
  closedAt: string | null;
}

export interface HieVisitState {
  connected: boolean;
  facilitySet: boolean;
  patientLinked: boolean;
  visit: HieVisitInfo | null;
}

export interface NationalRecordItem {
  kind: 'Visit' | 'Diagnosis' | 'Medicine' | 'Allergy' | 'Result' | 'Immunisation';
  date: string | null;
  title: string;
  detail: string | null;
  facility: string | null;
}

export interface PatientDetail extends PatientIdentityRecord {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string | null;
  sex: string;
  smsOptOut: boolean;
  hie: PatientHie;
  history: VisitHistoryEntry[];
  hasHiddenHistoryElsewhere: boolean;
  /** How this clinic may see other clinics' visits right now, or null (own visits only). */
  crossClinicBasis?: 'STANDING_CONSENT' | 'SHARING_CODE' | null;
}

export type CheckInStatus = 'PENDING_PAYMENT' | 'PAID' | 'FAILED' | 'CANCELLED' | 'NO_FEE' | 'NEEDS_REVIEW';
export type CheckInSource = 'REMOTE' | 'WALK_IN';
export type EncounterStatus = 'WAITING' | 'IN_CONSULTATION' | 'AWAITING_LAB' | 'READY_FOR_CHECKOUT' | 'DONE';

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
  /** Pay later: in the queue while ACISI's fee is confirmed in the background. */
  queuedBeforePayment?: boolean;
  source: CheckInSource;
  /** Who checked the patient in at the front desk (walk-ins); null for remote check-ins. */
  checkedInByName: string | null;
  encounterStatus: EncounterStatus | null;
  /** Back with the doctor after the lab signed the results. */
  backFromLab?: boolean;
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
  /** Came back from the lab with signed results. */
  backFromLab?: boolean;
  /** Signed results the lab flagged critical. */
  criticalResults?: number;
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
  /** Only ever sent to doctors; null for front desk. */
  diagnosis: string | null;
  /** ICD-11 coded diagnoses: doctors only (empty for front desk and for older visits). */
  diagnosisCodes?: Icd11Code[];
  prescription: string | null;
  /** Who handled the visit. */
  doctorName: string | null;
  isOwnClinic: boolean;  /** Signed lab results: doctors only. */
  labResults?: LabResult[];
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
  /** How this clinic may see other clinics' visits right now, or null (own visits only). */
  crossClinicBasis?: 'STANDING_CONSENT' | 'SHARING_CODE' | null;
  /** This visit's lab requests (results once signed). Doctor view only. */
  labOrders?: LabOrderView[];
  /** Current and removed allergies (same sharing rule as visit history). */
  allergies?: AllergyItem[];
  allergiesHiddenElsewhere?: boolean;
  /** Medicines from the visits shown in `history`, newest first. Doctor view only. */
  medications?: MedicationItem[];
  /** This visit's radiology, therapy and other orders. */
  serviceOrders?: ServiceOrderItem[];
  problems?: ProblemItem[];
  problemsHiddenElsewhere?: boolean;
  familyHistory?: string | null;
}

export interface MedicationItem {
  id: string;
  encounterId: string;
  productCode: string | null;
  drugName: string;
  text: string;
  prescribedAt: string;
  endsOn: string | null;
  active: boolean;
  clinicName: string;
  prescribedBy: string | null;
  allergyOverrideReason: string | null;
}

/** One medicine line as sent when signing (codes are DHA's). */
export interface PrescriptionLine {
  productCode: string | null;
  drugName: string | null;
  doseValue: number;
  doseUnit: string;
  route: string;
  frequency: string;
  durationDays: number | null;
  quantity: number | null;
  quantityUnit: string | null;
  instructionCodes: string[];
  instructions: string | null;
  allergyOverrideReason: string | null;
}

export interface AllergyConflict {
  index: number;
  drugName: string;
  allergyId: string;
  allergySubstance: string;
  reason: string;
}

export interface PrescriptionOptions {
  routes: { code: string; name: string }[];
  doseUnits: { code: string; name: string; one: string }[];
  frequencies: { code: string; name: string; perDay: number | null }[];
  instructions: { code: string; name: string }[];
}

export interface MedicineHit {
  code: string;
  name: string;
  suggestedRoute: string | null;
  suggestedDoseUnit: string | null;
}

export type AllergyCategory = 'MEDICATION' | 'FOOD' | 'ENVIRONMENT' | 'OTHER';
export type AllergySeverity = 'MILD' | 'MODERATE' | 'SEVERE' | 'UNKNOWN';

export interface AllergyItem {
  id: string;
  category: AllergyCategory;
  substance: string;
  reaction: string | null;
  severity: AllergySeverity;
  recordedAt: string;
  recordedByName: string;
  clinicName: string;
  isOwnClinic: boolean;
  removedAt: string | null;
  removedByName: string | null;
  removedReason: string | null;
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
    email?: string;
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
  patient: { id: string; name: string; patientCode: string; phoneNumber: string; smsOptOut: boolean };
  departmentName: string;
  /** This visit's prescription, read-only, for billing medicines. */
  prescription: string | null;
  /** Lab tests requested in this visit, with prices, for the bill. Never results. */
  labCharges?: { testName: string; priceKes: number }[];
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

export interface LegalStatus {
  termsAcceptanceRequired: boolean;
  termsRequired?: boolean;
  confidentialityRequired?: boolean;
  /** The public page with the full undertaking. */
  confidentialityUrl?: string;
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

/** For multipart uploads: no JSON Content-Type, the browser sets the boundary. */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api/staff${path}`, { method: 'POST', credentials: 'include', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? 'Request failed', res.status);
  }
  return res.json() as Promise<T>;
}

export type FileCategory = 'XRAY' | 'CT_SCAN' | 'MRI' | 'ULTRASOUND' | 'LAB_REPORT' | 'PREVIOUS_RECORDS' | 'OTHER';

export interface PatientFileItem {
  id: string;
  category: FileCategory;
  categoryLabel: string;
  documentDate: string;
  note: string | null;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  patientUploaded: boolean;
  fromThisClinic: boolean;
  uploadedAt: string;
}

/**
 * Admins and doctors who set up an authenticator app (Settings): after the
 * PIN, a 6-digit code from the app ('authenticator'), or a code by SMS
 * ('sms') when that is switched on and no app is set up.
 */
export interface LoginCodeChallenge {
  mfaRequired: true;
  challengeId: string;
  method: 'authenticator' | 'sms';
  /** sms only, e.g. "••• 678" */
  phoneHint?: string;
}

/** Settings → Multi-factor login for the logged-in person. available: switched on for their role. */
export interface MfaStatus {
  available: boolean;
  setUp: boolean;
  setUpAt: string | null;
}

/** qrCodeSvg is generated by the server (the qrcode library), not user content. */
export interface MfaSetupStart {
  setupId: string;
  qrCodeSvg: string;
  secret: string;
  accountName: string;
}

export const api = {
  listPatientFiles(patientId: string) {
    return request<{ files: PatientFileItem[]; hiddenCount: number }>(`/files/patient/${encodeURIComponent(patientId)}`);
  },
  uploadPatientFile(patientId: string, file: File, meta: { category: FileCategory; documentDate: string; note: string }) {
    const form = new FormData();
    form.append('category', meta.category);
    form.append('documentDate', meta.documentDate);
    if (meta.note.trim()) form.append('note', meta.note.trim());
    form.append('file', file);
    return upload<PatientFileItem>(`/files/patient/${encodeURIComponent(patientId)}`, form);
  },
  /** Photos of a paper file, combined by the server into one PDF under "Previous records". */
  uploadPatientPhotos(patientId: string, photos: File[], meta: { documentDate: string; note: string }) {
    const form = new FormData();
    form.append('documentDate', meta.documentDate);
    if (meta.note.trim()) form.append('note', meta.note.trim());
    for (const p of photos) form.append('photos', p);
    return upload<PatientFileItem>(`/files/patient/${encodeURIComponent(patientId)}/photos`, form);
  },
  /** Opens through the logged-in route; the server checks access every time. */
  patientFileUrl(fileId: string) {
    return `/api/staff/files/${encodeURIComponent(fileId)}`;
  },
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
  addProblem(encounterId: string, p: { icd11Code: string; note?: string; onsetDate?: string }) {
    return request<{ problems: ProblemItem[]; hiddenElsewhere: boolean }>(`/doctor/encounters/${encodeURIComponent(encounterId)}/problems`, { method: 'POST', body: JSON.stringify(p) });
  },
  updateProblem(encounterId: string, problemId: string, change: { status: ProblemItem['status'] } | { note: string | null }) {
    return request<{ problems: ProblemItem[]; hiddenElsewhere: boolean }>(`/doctor/encounters/${encodeURIComponent(encounterId)}/problems/${encodeURIComponent(problemId)}`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    });
  },
  setFamilyHistory(encounterId: string, text: string | null) {
    return request<{ familyHistory: string | null }>(`/doctor/encounters/${encodeURIComponent(encounterId)}/family-history`, { method: 'PUT', body: JSON.stringify({ text }) });
  },
  getDispensing(encounterId: string) {
    return request<{ items: DispenseLine[] }>(`/dispensing/encounters/${encodeURIComponent(encounterId)}`);
  },
  recordDispensing(encounterId: string, itemId: string, status: 'DISPENSED' | 'NOT_DISPENSED', quantity?: number | null) {
    return request<{ items: DispenseLine[] }>(`/dispensing/encounters/${encodeURIComponent(encounterId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'POST',
      body: JSON.stringify({ status, quantity }),
    });
  },
  getVitalSigns(encounterId: string) {
    return request<{ thisVisit: VitalSignsSet[]; history: VitalSignsSet[] }>(`/vitals/encounters/${encodeURIComponent(encounterId)}`);
  },
  recordVitalSigns(encounterId: string, values: Record<string, number | null>) {
    return request<{ thisVisit: VitalSignsSet[]; history: VitalSignsSet[] }>(`/vitals/encounters/${encodeURIComponent(encounterId)}`, { method: 'POST', body: JSON.stringify(values) });
  },
  addServiceOrder(encounterId: string, order: { category: ServiceOrderCategory; description: string; note?: string; urgent?: boolean }) {
    return request<{ orders: ServiceOrderItem[] }>(`/doctor/encounters/${encodeURIComponent(encounterId)}/orders`, { method: 'POST', body: JSON.stringify(order) });
  },
  cancelServiceOrder(encounterId: string, orderId: string) {
    return request<{ orders: ServiceOrderItem[] }>(`/doctor/encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' });
  },
  getVisitServiceOrders(encounterId: string) {
    return request<{ orders: ServiceOrderItem[] }>(`/service-orders/encounters/${encodeURIComponent(encounterId)}`);
  },
  closeVisitServiceOrder(encounterId: string, orderId: string, outcome: 'DONE' | 'CANCELLED') {
    return request<{ orders: ServiceOrderItem[] }>(`/service-orders/encounters/${encodeURIComponent(encounterId)}/${encodeURIComponent(orderId)}/close`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    });
  },

  getHieVisit(encounterId: string) {
    return request<HieVisitState>(`/hie/visits/${encodeURIComponent(encounterId)}`);
  },
  hieVisitAction(encounterId: string, action: 'consent' | 'consent/resend' | 'consent/confirm' | 'consent/refuse' | 'send' | 'close' | 'close/confirm', body?: object) {
    return request<HieVisitInfo | { ok: true }>(`/hie/visits/${encodeURIComponent(encounterId)}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
  },
  getNationalRecord(encounterId: string) {
    return request<{ items: NationalRecordItem[] }>(`/hie/visits/${encodeURIComponent(encounterId)}/national-record`);
  },

  getSurveillanceEmail() {
    return request<{ email: string | null; lastWeekSent: string | null; emailAvailable: boolean }>('/clinic/surveillance-email');
  },
  setSurveillanceEmail(email: string | null) {
    return request<{ email: string | null; emailAvailable: boolean }>('/clinic/surveillance-email', { method: 'PUT', body: JSON.stringify({ email }) });
  },

  getHieStatus() {
    return request<HieStatus>('/hie/status');
  },

  searchHieFacilities(q: { name?: string; identifier?: string; identifierType?: string }) {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return request<{ facilities: HieFacility[] }>(`/hie/facilities?${params.toString()}`);
  },

  setHieFacility(frCode: string) {
    return request<{ frCode: string; name: string }>('/hie/facility', { method: 'PUT', body: JSON.stringify({ frCode }) });
  },

  verifyMyPractitionerRecord(regulator: string, registrationNumber: string) {
    return request<HiePractitioner>('/hie/me/practitioner', { method: 'PUT', body: JSON.stringify({ regulator, registrationNumber }) });
  },

  lookUpPatientInClientRegistry(patientId: string) {
    return request<ClientRegistryLookup>(`/hie/patients/${encodeURIComponent(patientId)}/client-registry`, { method: 'POST' });
  },

  confirmClientRegistryMatch(patientId: string) {
    return request<{ crId: string }>(`/hie/patients/${encodeURIComponent(patientId)}/client-registry/confirm`, { method: 'POST' });
  },

  updatePatientDetails(patientId: string, identity: PatientIdentity) {
    return request<PatientIdentityRecord & { hie: PatientHie }>(`/patients/${encodeURIComponent(patientId)}/details`, {
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
  /** Either logged in, or (admins and doctors with multi-factor login) a code is needed: then call verifyLoginCode. */
  login(staffCode: string, pin: string) {
    return request<{ staffName: string; clinicName: string; role: string } | LoginCodeChallenge>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ staffCode, pin }),
    });
  },

  verifyLoginCode(challengeId: string, code: string, rememberDevice: boolean) {
    return request<{ staffName: string; clinicName: string; role: string }>('/auth/login/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId, code, rememberDevice }),
    });
  },

  logout() {
    return request<void>('/auth/logout', { method: 'POST' });
  },

  getMfaStatus() {
    return request<MfaStatus>('/auth/mfa');
  },

  startMfaSetup() {
    return request<MfaSetupStart>('/auth/mfa/setup', { method: 'POST' });
  },

  confirmMfaSetup(setupId: string, code: string) {
    return request<{ setUp: true }>('/auth/mfa/setup/confirm', { method: 'POST', body: JSON.stringify({ setupId, code }) });
  },

  /** Real activity (typing, clicking): keeps the session from the inactivity logoff. */
  pingActivity() {
    return request<void>('/auth/activity', { method: 'POST' });
  },

  me() {
    return request<StaffSession>('/auth/me');
  },

  /** Whether this staff member must accept the current Terms of Service before using the console. */
  getLegalStatus() {
    return request<LegalStatus>('/legal');
  },
  acceptTerms(acceptConfidentiality: boolean) {
    return request<{ termsAcceptanceRequired: boolean }>('/legal/accept', {
      method: 'POST',
      body: JSON.stringify({ accept: true, acceptConfidentiality }),
    });
  },

  searchPatients(query: string) {
    return request<{ patients: PatientListItem[] }>(`/patients?q=${encodeURIComponent(query)}`);
  },

  getPatient(id: string) {
    return request<PatientDetail>(`/patients/${id}`);
  },

  findPendingSignups(phone: string) {
    return request<{ phoneNumber: string; signups: { pendingId: string; name: string; signedUpAt: string }[] }>(
      `/phone-verification/pending-signups?phone=${encodeURIComponent(phone)}`,
    );
  },

  completePendingSignup(pendingId: string) {
    return request<{ patientCode: string; setupCode: { code: string; expiresAt: string } | null }>(`/phone-verification/pending-signups/${encodeURIComponent(pendingId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ phoneConfirmedInPerson: true }),
    });
  },

  issueSetupCode(patientId: string) {
    return request<{ code: string; expiresAt: string; patientCode: string }>(
      `/phone-verification/patients/${encodeURIComponent(patientId)}/setup-code`,
      { method: 'POST', body: JSON.stringify({ phoneConfirmedInPerson: true }) },
    );
  },

  requestRecords(patientId: string) {
    return request<{ smsSent: boolean }>(`/patients/${encodeURIComponent(patientId)}/record-requests`, { method: 'POST' });
  },

  verifyRecordsCode(patientId: string, code: string) {
    return request<{ accessUntil: string }>(`/patients/${encodeURIComponent(patientId)}/record-requests/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  /** Opens in a new tab for printing; the session cookie goes with it (same origin). */
  visitRecordUrl(patientId: string, encounterId: string) {
    return `/api/staff/patients/${encodeURIComponent(patientId)}/visits/${encodeURIComponent(encounterId)}/record`;
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

  resetStaffAuthenticator(staffId: string) {
    return request<{ staffCode: string; name: string }>(`/clinic/staff/${encodeURIComponent(staffId)}/reset-authenticator`, { method: 'POST' });
  },

  makeStaffAdmin(staffId: string) {
    return request<{ id: string; role: 'ADMIN' }>(`/clinic/staff/${encodeURIComponent(staffId)}/make-admin`, { method: 'POST' });
  },

  deactivateStaff(staffId: string) {
    return request<{ id: string; isActive: false }>(`/clinic/staff/${encodeURIComponent(staffId)}/deactivate`, { method: 'POST' });
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

  recordAllergy(encounterId: string, body: { category: AllergyCategory; substance: string; reaction: string; severity: AllergySeverity }) {
    return request<AllergyItem>(`/doctor/encounters/${encodeURIComponent(encounterId)}/allergies`, { method: 'POST', body: JSON.stringify(body) });
  },

  removeAllergy(encounterId: string, allergyId: string, reason: string) {
    return request<AllergyItem>(`/doctor/encounters/${encodeURIComponent(encounterId)}/allergies/${encodeURIComponent(allergyId)}/remove`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  getDoctorLabTests() {
    return request<{ tests: LabTestItem[] }>('/doctor/lab-tests');
  },

  requestLabTests(encounterId: string, body: { labTestIds: string[]; noteForLab: string; pin: string }) {
    return request<{ labOrderId: string }>(`/doctor/encounters/${encodeURIComponent(encounterId)}/lab-orders`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getLabQueue() {
    return request<{ queue: LabQueueItem[] }>('/lab/queue');
  },

  openLabOrder(labOrderId: string) {
    return request<LabOrderDetailForLab>(`/lab/orders/${encodeURIComponent(labOrderId)}`);
  },

  saveLabResults(labOrderId: string, results: LabResultInput[]) {
    return request<void>(`/lab/orders/${encodeURIComponent(labOrderId)}/results`, { method: 'PUT', body: JSON.stringify({ results }) });
  },

  completeLabOrder(labOrderId: string, pin: string) {
    return request<{ sms: 'sent' | 'opted_out' | 'failed' | 'not_sent_yet' }>(`/lab/orders/${encodeURIComponent(labOrderId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  uploadLabFile(labOrderId: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    return upload<PatientFileItem>(`/lab/orders/${encodeURIComponent(labOrderId)}/files`, form);
  },

  labFileUrl(labOrderId: string, fileId: string) {
    return `/api/staff/lab/orders/${encodeURIComponent(labOrderId)}/files/${encodeURIComponent(fileId)}`;
  },

  listLabTestsForAdmin() {
    return request<{ tests: LabTestItem[] }>('/lab-tests');
  },

  createLabTest(body: { name: string; priceKes: number }) {
    return request<LabTestItem>('/lab-tests', { method: 'POST', body: JSON.stringify(body) });
  },

  loincSuggestions(name: string) {
    return request<{ suggestions: { code: string; name: string }[] }>(`/lab-tests/loinc-suggestions?name=${encodeURIComponent(name)}`);
  },

  updateLabTest(labTestId: string, body: { name?: string; priceKes?: number; isActive?: boolean; loincCode?: string | null }) {
    return request<LabTestItem>(`/lab-tests/${encodeURIComponent(labTestId)}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  submitConsultation(
    encounterId: string,
    body: { diagnosisCodes: string[]; diagnosis: string; prescriptionItems: PrescriptionLine[]; prescriptionAdvice: string; carePlan?: string; pin: string },
  ) {
    return request<{ encounterId: string; status: EncounterStatus; notifiable?: NotifiableAlert[] }>(`/doctor/encounters/${encounterId}/consult`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** DHA's Kenya medicines list (Generic Products). */
  searchMedicines(q: string) {
    return request<{ results: MedicineHit[] }>(`/doctor/medicines?q=${encodeURIComponent(q)}`);
  },

  prescriptionOptions() {
    return request<PrescriptionOptions>('/doctor/prescription-options');
  },

  /** Live allergy check while writing the prescription (repeated by the server at signing). */
  checkPrescription(encounterId: string, items: { productCode: string | null; drugName: string | null }[]) {
    return request<{ allergyConflicts: AllergyConflict[] }>(`/doctor/encounters/${encounterId}/prescription-check`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  },

  /** Disease surveillance (IDSR): case list, doctors only. */
  listNotifiableCases() {
    return request<{ cases: NotifiableCase[]; listConfirmed: string | null; listSource: string }>('/surveillance/cases');
  },

  unreportedNotifiableCount() {
    return request<{ count: number }>('/surveillance/unreported-count');
  },

  markNotifiableReported(caseId: string, note: string) {
    return request<{ ok: true }>(`/surveillance/cases/${encodeURIComponent(caseId)}/reported`, {
      method: 'POST',
      body: JSON.stringify({ note: note || null }),
    });
  },

  /** Weekly counts (doctors and admins). `week` is a Monday, YYYY-MM-DD; empty = last full week. */
  /** Public health events (counts only). */
  listHealthEvents() {
    return request<{ events: HealthEvent[]; types: { code: string; label: string; immediate: boolean }[] }>('/surveillance/events');
  },

  recordHealthEvent(body: {
    type: string;
    detectedOn: string;
    casesCount: number;
    casesUnder5: number;
    deathsCount: number;
    deathsUnder5: number;
    eventDescription: string;
    eventPlace: string | null;
  }) {
    return request<{ id: string; immediate: boolean }>('/surveillance/events', { method: 'POST', body: JSON.stringify(body) });
  },

  markHealthEventReported(id: string, note: string) {
    return request<{ ok: true }>(`/surveillance/events/${encodeURIComponent(id)}/reported`, { method: 'POST', body: JSON.stringify({ note: note || null }) });
  },

  /** Routine report: period MONTH (YYYY-MM), QUARTER (YYYY-Q1..Q4) or YEAR (YYYY). */
  routineReport(period: string, value: string) {
    return request<RoutineReport>(`/routine-reports?period=${period}&value=${encodeURIComponent(value)}`);
  },

  qualityMeasures(period: string, value: string) {
    return request<{ label: string; startDate: string; endDate: string; measures: QualityMeasure[] }>(`/routine-reports/quality?period=${period}&value=${encodeURIComponent(value)}`);
  },

  qualityMeasuresCsvUrl(period: string, value: string) {
    return `/api/staff/routine-reports/quality/csv?period=${period}&value=${encodeURIComponent(value)}`;
  },

  routineReportCsvUrl(period: string, value: string) {
    return `/api/staff/routine-reports/csv?period=${period}&value=${encodeURIComponent(value)}`;
  },

  weeklySurveillance(week?: string) {
    return request<WeeklySurveillance>(`/surveillance/weekly${week ? `?week=${week}` : ''}`);
  },

  weeklySurveillanceCsvUrl(week: string) {
    return `/api/staff/surveillance/weekly.csv?week=${week}`;
  },

  /** WHO ICD-11 search for the consultation form. */
  searchIcd11(q: string) {
    return request<{ results: Icd11Code[]; release: string }>(`/doctor/icd11?q=${encodeURIComponent(q)}`);
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
