import { ENTER_SENTINEL, UssdSessionContext, UssdStateHandler, UssdStateName, UssdStateResult } from './types';
import { mainMenu } from './states/mainMenu';
import {
  checkinConfirm,
  checkinConsent,
  checkinEnterClinicCode,
  checkinNewPatientDob,
  checkinNewPatientName,
  checkinNewPatientSex,
} from './states/patientCheckIn';
import { staffEnterPin, staffMenu } from './states/staffLogin';
import { staffHistoryEnterPhone } from './states/patientHistory';

const registry: Record<UssdStateName, UssdStateHandler> = {
  MAIN_MENU: mainMenu,
  CHECKIN_ENTER_CLINIC_CODE: checkinEnterClinicCode,
  CHECKIN_CONSENT: checkinConsent,
  CHECKIN_NEW_PATIENT_NAME: checkinNewPatientName,
  CHECKIN_NEW_PATIENT_DOB: checkinNewPatientDob,
  CHECKIN_NEW_PATIENT_SEX: checkinNewPatientSex,
  CHECKIN_CONFIRM: checkinConfirm,
  STAFF_ENTER_PIN: staffEnterPin,
  STAFF_MENU: staffMenu,
  STAFF_HISTORY_ENTER_PHONE: staffHistoryEnterPhone,
};

/** Runs one state transition and applies the resulting state change to the session in place. */
export async function dispatch(session: UssdSessionContext, input: string): Promise<UssdStateResult> {
  const handler = registry[session.state];
  const result = await handler(session, input);
  session.state = result.nextState ?? session.state;
  return result;
}

/**
 * Splits Africa's Talking' accumulated "text" field into individual keystrokes.
 * AT sends "" on the very first request of a session, and "1*482*1" style
 * strings thereafter.
 */
export function splitUssdText(text: string): string[] {
  return text === '' ? [] : text.split('*');
}

/**
 * Rebuilds a session's state by silently replaying every input up to (but
 * not including) the most recent one. Used only when Redis has no cached
 * session for a sessionId that Africa's Talking is still mid-conversation
 * with — i.e. the session survived on the telco side but our server
 * restarted or the cache entry was evicted/dropped.
 *
 * This is safe to call because every state handler with an external side
 * effect (creating a Patient, triggering an STK push) is itself idempotent
 * per session — see registerPatient/initiateCheckIn — so replaying a prefix
 * of inputs can re-derive context (clinicId, patientId) without repeating
 * those effects.
 */
export async function replaySession(session: UssdSessionContext, priorTokens: string[]): Promise<void> {
  for (const token of priorTokens) {
    const result = await dispatch(session, token);
    if (!result.continueSession) {
      // A middle token ended the session on replay, which should never happen
      // in a well-formed flow. Reset to MAIN_MENU rather than get stuck.
      session.state = 'MAIN_MENU';
      session.data = {};
    }
  }
}

export { ENTER_SENTINEL };
