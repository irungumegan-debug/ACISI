import { Patient, Sex } from '@prisma/client';
import { UssdSessionContext, UssdStateHandler, UssdStateResult } from '../types';
import { ClinicListItem } from '../../services/clinicService';
import { DuplicatePatientError, findPatientsByPhone, registerPatient } from '../../services/patientService';
import { displayName } from '../../services/patientAuthService';
import { initiateCheckIn } from '../../services/checkInService';
import { env } from '../../config/env';
import { CONSENT_PROMPT_TEXT, CROSS_CLINIC_CONSENT_PROMPT_TEXT } from '../../config/constants';
import { buildPersonMenu, MAX_PEOPLE_IN_MENU } from '../formatting';
import { logger } from '../../utils/logger';

const CURRENT_YEAR = new Date().getFullYear();

function confirmPrompt(clinicName: string): string {
  return `CON Check in at ${clinicName} for KES ${env.CHECKIN_FEE_AMOUNT_KES}?\n1. Confirm\n2. Cancel`;
}

/**
 * Shared tail of the "clinic chosen" step, reached once a clinic has been
 * picked from the selection menu (src/ussd/states/clinicSelect.ts): look the
 * patient up by their session phone number and branch into either the
 * returning-patient confirm prompt or the new-patient consent gate.
 */
export async function proceedToPatientLookup(
  session: UssdSessionContext,
  clinic: ClinicListItem,
): Promise<UssdStateResult> {
  session.data.clinicId = clinic.id;
  session.data.clinicName = clinic.name;

  const patients = await findPatientsByPhone(session.phoneNumberE164);
  if (patients.length === 1) {
    session.data.patientId = (patients[0] as Patient).id;
    return { response: confirmPrompt(clinic.name), continueSession: true, nextState: 'CHECKIN_CONFIRM' };
  }
  if (patients.length > 1) {
    // A shared family phone: ask who is checking in (or someone new).
    const shown = patients.slice(0, MAX_PEOPLE_IN_MENU);
    session.data.personIds = shown.map((p) => p.id);
    session.data.personNames = shown.map(displayName);
    return { response: personPrompt(session), continueSession: true, nextState: 'CHECKIN_SELECT_PERSON' };
  }

  return consentPrompt();
}

function consentPrompt(): UssdStateResult {
  return { response: `CON ${CONSENT_PROMPT_TEXT}\n1. Yes, I agree\n2. No`, continueSession: true, nextState: 'CHECKIN_CONSENT' };
}

function personPrompt(session: UssdSessionContext): string {
  return `CON ${buildPersonMenu('Who is checking in?', session.data.personNames as string[], '0. Someone new')}`;
}

/** Shared phone: "1. Jane W. / 2. Brian K. / 0. Someone new". */
export const checkinSelectPerson: UssdStateHandler = async (session, input) => {
  const ids = (session.data.personIds as string[] | undefined) ?? [];
  if (input === '0') return consentPrompt();
  const picked = ids[Number(input) - 1];
  if (!/^\d+$/.test(input) || !picked) {
    return { response: personPrompt(session).replace('CON ', 'CON Please choose from the list.\n'), continueSession: true };
  }
  session.data.patientId = picked;
  return { response: confirmPrompt(session.data.clinicName as string), continueSession: true, nextState: 'CHECKIN_CONFIRM' };
};

/**
 * Registers the new USSD patient (only the birth year is known, so the
 * date is marked estimated). Idempotent: a replayed session, or the same
 * person registering twice, reuses the existing record.
 */
async function registerUssdPatient(session: UssdSessionContext, crossClinicConsent: boolean): Promise<UssdStateResult> {
  const clinicName = session.data.clinicName as string;
  try {
    const patient = await registerPatient({
      phoneNumberE164: session.phoneNumberE164,
      firstName: session.data.firstName as string,
      lastName: session.data.lastName as string,
      dateOfBirth: new Date(Date.UTC(session.data.birthYear as number, 0, 1)),
      dateOfBirthEstimated: true,
      sex: session.data.sex as Sex,
      consentChannel: 'USSD',
      crossClinicConsent,
    });
    session.data.patientId = patient.id;
  } catch (err) {
    if (err instanceof DuplicatePatientError) {
      session.data.patientId = err.existing.id;
    } else {
      logger.error({ err, sessionId: session.sessionId }, 'Failed to register new patient during check-in');
      return { response: 'END Something went wrong registering you. Please try again shortly.', continueSession: false };
    }
  }
  return { response: confirmPrompt(clinicName), continueSession: true, nextState: 'CHECKIN_CONFIRM' };
}

export const checkinConsent: UssdStateHandler = async (_session, input) => {
  if (input === '1') {
    return { response: 'CON Enter your full name (First Last):', continueSession: true, nextState: 'CHECKIN_NEW_PATIENT_NAME' };
  }
  if (input === '2') {
    return {
      response: 'END Without this we cannot register you on ACISI. Please speak to the clinic reception.',
      continueSession: false,
    };
  }
  return { response: `CON Please choose 1 or 2.\n${CONSENT_PROMPT_TEXT}\n1. Yes, I agree\n2. No`, continueSession: true };
};

export const checkinNewPatientName: UssdStateHandler = async (session, input) => {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { response: 'CON Please enter both first and last name, e.g. Jane Wanjiru:', continueSession: true };
  }

  session.data.firstName = parts[0];
  session.data.lastName = parts.slice(1).join(' ');

  return { response: 'CON Enter your year of birth (e.g. 1990):', continueSession: true, nextState: 'CHECKIN_NEW_PATIENT_DOB' };
};

export const checkinNewPatientDob: UssdStateHandler = async (session, input) => {
  const year = Number(input.trim());
  if (!Number.isInteger(year) || year < 1900 || year > CURRENT_YEAR) {
    return { response: 'CON Please enter a valid 4-digit year of birth:', continueSession: true };
  }

  session.data.birthYear = year;

  return {
    response: 'CON Select sex:\n1. Male\n2. Female\n3. Other / prefer not to say',
    continueSession: true,
    nextState: 'CHECKIN_NEW_PATIENT_SEX',
  };
};

const SEX_BY_CHOICE: Record<string, Sex> = { '1': 'MALE', '2': 'FEMALE', '3': 'OTHER' };

export const checkinNewPatientSex: UssdStateHandler = async (session, input) => {
  const sex = SEX_BY_CHOICE[input];
  if (!sex) {
    return { response: 'CON Please choose 1, 2 or 3.\nSelect sex:\n1. Male\n2. Female\n3. Other / prefer not to say', continueSession: true };
  }

  session.data.sex = sex;

  // The old "share with all clinics" question is no longer asked: each
  // clinic now asks the patient for their approval (a code by SMS) when it
  // needs records from other clinics.
  return registerUssdPatient(session, false);
};

/**
 * No longer reached by new sessions (the question was retired in favour of
 * per-clinic approval). Kept only so a session that was mid-way through it
 * during a deploy finishes cleanly, honouring the answer given.
 */
export const checkinCrossClinicConsent: UssdStateHandler = async (session, input) => {
  if (input !== '1' && input !== '2') {
    return {
      response: `CON Please choose 1 or 2.\n${CROSS_CLINIC_CONSENT_PROMPT_TEXT}\n1. Yes, share with other clinics\n2. No, only this clinic`,
      continueSession: true,
    };
  }

  return registerUssdPatient(session, input === '1');
};

export const checkinConfirm: UssdStateHandler = async (session, input) => {
  const clinicName = session.data.clinicName as string;

  if (input === '2') {
    return { response: 'END Check-in cancelled.', continueSession: false };
  }

  if (input !== '1') {
    return { response: `CON Please choose 1 or 2.\n${confirmPrompt(clinicName).replace('CON ', '')}`, continueSession: true };
  }

  try {
    const { checkIn } = await initiateCheckIn({
      ussdSessionId: session.sessionId,
      patientId: session.data.patientId as string,
      clinicId: session.data.clinicId as string,
      clinicName,
      departmentId: session.data.departmentId as string,
      phoneNumberE164: session.phoneNumberE164,
    });

    if (checkIn.status === 'FAILED') {
      return { response: 'END We could not start the payment request. Please try again shortly.', continueSession: false };
    }

    return {
      response: `END We've sent an M-Pesa prompt to your phone for KES ${env.CHECKIN_FEE_AMOUNT_KES}. Enter your M-Pesa PIN to complete check-in at ${clinicName}.`,
      continueSession: false,
    };
  } catch (err) {
    logger.error({ err, sessionId: session.sessionId }, 'Failed to initiate check-in');
    return { response: 'END We could not start the payment request. Please try again shortly.', continueSession: false };
  }
};
