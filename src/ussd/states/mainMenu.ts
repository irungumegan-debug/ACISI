import { Patient } from '@prisma/client';
import { ENTER_SENTINEL, UssdStateHandler, UssdStateResult } from '../types';
import { listActiveClinics } from '../../services/clinicService';
import { findPatientsByPhone, getPortableHistory } from '../../services/patientService';
import { confirmPatientPin, displayName, PatientAuthError } from '../../services/patientAuthService';
import { recordAuditEvent } from '../../services/auditService';
import { buildPersonMenu, formatVisitHistoryLines, MAX_PEOPLE_IN_MENU } from '../formatting';
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
    return { response: 'CON Enter your staff ID (e.g. ACI-STF-7F2K):', continueSession: true, nextState: 'STAFF_ENTER_CODE' };
  }

  if (input === '3') {
    const patients = await findPatientsByPhone(session.phoneNumberE164);
    if (patients.length === 0) {
      return {
        response: "END You don't have any ACISI records yet. Check in at a clinic to get started.",
        continueSession: false,
      };
    }
    if (patients.length === 1) return showOwnRecords(patients[0] as Patient);

    // Shared family phone: each person's records are behind their own PIN.
    const shown = patients.slice(0, MAX_PEOPLE_IN_MENU);
    session.data.personIds = shown.map((p) => p.id);
    session.data.personNames = shown.map(displayName);
    return {
      response: `CON ${buildPersonMenu('Whose records?', session.data.personNames as string[])}`,
      continueSession: true,
      nextState: 'MY_RECORDS_SELECT_PERSON',
    };
  }

  return { response: `CON Invalid choice.\n${MENU_TEXT}`, continueSession: true };
};

async function showOwnRecords(patient: Pick<Patient, 'id' | 'firstName'>): Promise<UssdStateResult> {
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

/** Shared phone, "My Records": which person. */
export const myRecordsSelectPerson: UssdStateHandler = async (session, input) => {
  const ids = (session.data.personIds as string[] | undefined) ?? [];
  const picked = /^\d+$/.test(input) ? ids[Number(input) - 1] : undefined;
  if (!picked) {
    return {
      response: `CON Please choose from the list.\n${buildPersonMenu('Whose records?', session.data.personNames as string[])}`,
      continueSession: true,
    };
  }
  const [patient] = (await findPatientsByPhone(session.phoneNumberE164)).filter((p) => p.id === picked);
  if (!patient?.pinHash) {
    return { response: 'END On a shared phone, records need a PIN. Set one at acisi.co.ke, then try again.', continueSession: false };
  }
  session.data.patientId = picked;
  return { response: 'CON Enter your 6-digit ACISI PIN:', continueSession: true, nextState: 'MY_RECORDS_ENTER_PIN' };
};

/** Shared phone, "My Records": the person's own PIN (same 5-wrong lock as the portal). */
export const myRecordsEnterPin: UssdStateHandler = async (session, input) => {
  const patientId = session.data.patientId as string;
  let ok: boolean;
  try {
    ok = await confirmPatientPin(patientId, input.trim());
  } catch (err) {
    if (err instanceof PatientAuthError) return { response: `END ${err.message}`, continueSession: false };
    throw err;
  }
  if (!ok) return { response: 'END Wrong PIN.', continueSession: false };
  const [patient] = (await findPatientsByPhone(session.phoneNumberE164)).filter((p) => p.id === patientId);
  if (!patient) return { response: 'END Something went wrong. Please try again.', continueSession: false };
  return showOwnRecords(patient);
};
