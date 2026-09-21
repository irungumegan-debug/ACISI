import { UssdStateHandler } from '../types';
import { findActiveStaffByCode, verifyStaffPin } from '../../services/staffService';
import { MAX_STAFF_PIN_ATTEMPTS } from '../../config/constants';

const STAFF_MENU_TEXT = 'CON ACISI Staff Menu\n1. Look up patient history';

/**
 * Staff and doctors authenticate with their staffCode, never their phone
 * number — the caller's phone is only used for the USSD session transport,
 * not identity. Looks up the staff row and stashes it in session.data so
 * staffEnterPin doesn't have to look it up again.
 */
export const staffEnterCode: UssdStateHandler = async (session, input) => {
  const staffCode = input.trim().toUpperCase();
  const staff = await findActiveStaffByCode(staffCode);

  if (!staff) {
    return { response: 'END That staff ID was not recognized.', continueSession: false };
  }

  session.data.pendingStaffCode = staffCode;
  return { response: 'CON Enter your PIN:', continueSession: true, nextState: 'STAFF_ENTER_PIN' };
};

export const staffEnterPin: UssdStateHandler = async (session, input) => {
  const staffCode = session.data.pendingStaffCode as string | undefined;
  const staff = staffCode ? await findActiveStaffByCode(staffCode) : null;

  if (!staff) {
    return { response: 'END Session expired. Please dial in again.', continueSession: false };
  }

  const isValid = await verifyStaffPin(staff, input.trim());
  if (isValid) {
    session.data.staffId = staff.id;
    session.data.clinicId = staff.clinicId;
    return { response: STAFF_MENU_TEXT, continueSession: true, nextState: 'STAFF_MENU' };
  }

  const attempts = ((session.data.pinAttempts as number) ?? 0) + 1;
  session.data.pinAttempts = attempts;

  if (attempts >= MAX_STAFF_PIN_ATTEMPTS) {
    return { response: 'END Too many incorrect PIN attempts. Please try again later.', continueSession: false };
  }

  return { response: `CON Incorrect PIN. Enter your PIN (${MAX_STAFF_PIN_ATTEMPTS - attempts} attempts left):`, continueSession: true };
};

export const staffMenu: UssdStateHandler = async (_session, input) => {
  if (input === '1') {
    return { response: 'CON Enter patient phone number:', continueSession: true, nextState: 'STAFF_HISTORY_ENTER_PHONE' };
  }

  return { response: `CON Invalid choice.\n${STAFF_MENU_TEXT.replace('CON ', '')}`, continueSession: true };
};
