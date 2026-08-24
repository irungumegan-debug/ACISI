import { ENTER_SENTINEL, UssdStateHandler } from '../types';
import { listActiveClinics } from '../../services/clinicService';
import { findPatientByPhone, getPortableHistory } from '../../services/patientService';
import { recordAuditEvent } from '../../services/auditService';
import { formatVisitHistoryLines } from '../formatting';
import { buildClinicSelectionPrompt } from './clinicSelect';

const MENU_TEXT = 'Welcome to ACISI\n1. Check in as a patient\n2. Clinic staff login\n3. My Records';

export const mainMenu: UssdStateHandler = async (session, input) => {
  if (input === ENTER_SENTINEL) {
    return { response: `CON ${MENU_TEXT}`, continueSession: true };
  }

  if (input === '1') {
    const clinics = await listActiveClinics();
    if (clinics.length === 0) {
      return { response: 'END No clinics are available right now. Please try again later.', continueSession: false };
    }
    session.data.clinicPage = 0;
    return { response: buildClinicSelectionPrompt(clinics, 0), continueSession: true, nextState: 'CHECKIN_SELECT_CLINIC' };
  }

  if (input === '2') {
    return { response: 'CON Enter your 4-digit staff PIN:', continueSession: true, nextState: 'STAFF_ENTER_PIN' };
  }

  if (input === '3') {
    const patient = await findPatientByPhone(session.phoneNumberE164);
    if (!patient) {
      return {
        response: "END You don't have any ACISI records yet. Check in at a clinic to get started.",
        continueSession: false,
      };
    }

    const history = await getPortableHistory(patient.id);

    await recordAuditEvent({
      actorType: 'PATIENT',
      actorId: patient.id,
      action: 'PATIENT_SELF_VIEWED_HISTORY',
      entityType: 'Patient',
      entityId: patient.id,
    });

    if (history.length === 0) {
      return { response: `END ${patient.firstName}, you have no visits on record yet.`, continueSession: false };
    }

    const lines = formatVisitHistoryLines(history);
    return { response: `END Your recent visits:\n${lines.join('\n')}`, continueSession: false };
  }

  return { response: `CON Invalid choice.\n${MENU_TEXT}`, continueSession: true };
};
