import { ENTER_SENTINEL, UssdStateHandler } from '../types';

const MENU_TEXT = 'Welcome to ACISI\n1. Check in as a patient\n2. Clinic staff login';

export const mainMenu: UssdStateHandler = async (_session, input) => {
  if (input === ENTER_SENTINEL) {
    return { response: `CON ${MENU_TEXT}`, continueSession: true };
  }

  if (input === '1') {
    return { response: 'CON Enter your clinic code:', continueSession: true, nextState: 'CHECKIN_ENTER_CLINIC_CODE' };
  }

  if (input === '2') {
    return { response: 'CON Enter your 4-digit staff PIN:', continueSession: true, nextState: 'STAFF_ENTER_PIN' };
  }

  return { response: `CON Invalid choice.\n${MENU_TEXT}`, continueSession: true };
};
