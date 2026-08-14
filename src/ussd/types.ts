/** Raw webhook payload Africa's Talking POSTs on every USSD keystroke. */
export interface UssdWebhookPayload {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  /** Full accumulated input for the session, "*"-separated, e.g. "1*482*1". */
  text: string;
}

export type UssdStateName =
  | 'MAIN_MENU'
  | 'CHECKIN_ENTER_CLINIC_CODE'
  | 'CHECKIN_CONSENT'
  | 'CHECKIN_NEW_PATIENT_NAME'
  | 'CHECKIN_NEW_PATIENT_DOB'
  | 'CHECKIN_NEW_PATIENT_SEX'
  | 'CHECKIN_CONFIRM'
  | 'STAFF_ENTER_PIN'
  | 'STAFF_MENU'
  | 'STAFF_HISTORY_ENTER_PHONE';

/** Sentinel input passed only when rendering a state's very first prompt in a brand new session. */
export const ENTER_SENTINEL = '';

export interface UssdSessionContext {
  sessionId: string;
  state: UssdStateName;
  phoneNumberE164: string;
  /** Per-flow scratch data accumulated as the user progresses (clinicId, draft patient fields, etc). */
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface UssdStateResult {
  response: string;
  continueSession: boolean;
  /** Defaults to the current state when omitted (i.e. re-prompt on invalid input). */
  nextState?: UssdStateName;
}

export type UssdStateHandler = (
  session: UssdSessionContext,
  input: string,
) => Promise<UssdStateResult>;
