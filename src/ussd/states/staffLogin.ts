import { UssdStateHandler } from '../types';
import { findActiveStaffByPhone, verifyStaffPin } from '../../services/staffService';
import { MAX_STAFF_PIN_ATTEMPTS } from '../../config/constants';

const STAFF_MENU_TEXT = 'CON ACISI Staff Menu\n1. Look up patient history';

export const staffEnterPin: UssdStateHandler = async (session, input) => {
  const staff = await findActiveStaffByPhone(session.phoneNumberE164);
  if (!staff) {
    return { response: 'END This phone number is not registered as clinic staff.', continueSession: false };
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

  return { response: `CON Incorrect PIN. Enter your 4-digit staff PIN (${MAX_STAFF_PIN_ATTEMPTS - attempts} attempts left):`, continueSession: true };
};

export const staffMenu: UssdStateHandler = async (_session, input) => {
  if (input === '1') {
    return { response: 'CON Enter patient phone number:', continueSession: true, nextState: 'STAFF_HISTORY_ENTER_PHONE' };
  }

  return { response: `CON Invalid choice.\n${STAFF_MENU_TEXT.replace('CON ', '')}`, continueSession: true };
};
