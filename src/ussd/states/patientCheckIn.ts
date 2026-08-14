import { Sex } from '@prisma/client';
import { UssdStateHandler } from '../types';
import { findClinicByUssdCode } from '../../services/clinicService';
import { findPatientByPhone, registerPatient } from '../../services/patientService';
import { initiateCheckIn } from '../../services/checkInService';
import { env } from '../../config/env';
import { CONSENT_PROMPT_TEXT } from '../../config/constants';
import { logger } from '../../utils/logger';

const CURRENT_YEAR = new Date().getFullYear();

function confirmPrompt(clinicName: string): string {
  return `CON Check in at ${clinicName} for KES ${env.CHECKIN_FEE_AMOUNT_KES}?\n1. Confirm\n2. Cancel`;
}

export const checkinEnterClinicCode: UssdStateHandler = async (session, input) => {
  const clinic = await findClinicByUssdCode(input.trim());
  if (!clinic) {
    return { response: 'CON Clinic code not found. Enter your clinic code:', continueSession: true };
  }

  session.data.clinicId = clinic.id;
  session.data.clinicName = clinic.name;

  const patient = await findPatientByPhone(session.phoneNumberE164);
  if (patient) {
    session.data.patientId = patient.id;
    return { response: confirmPrompt(clinic.name), continueSession: true, nextState: 'CHECKIN_CONFIRM' };
  }

  return { response: `CON ${CONSENT_PROMPT_TEXT}\n1. Yes, I agree\n2. No`, continueSession: true, nextState: 'CHECKIN_CONSENT' };
};

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

  const clinicName = session.data.clinicName as string;

  try {
    const patient = await registerPatient({
      phoneNumberE164: session.phoneNumberE164,
      firstName: session.data.firstName as string,
      lastName: session.data.lastName as string,
      dateOfBirth: new Date(Date.UTC(session.data.birthYear as number, 0, 1)),
      sex,
      consentChannel: 'USSD',
    });
    session.data.patientId = patient.id;
  } catch (err) {
    logger.error({ err, sessionId: session.sessionId }, 'Failed to register new patient during check-in');
    return { response: 'END Something went wrong registering you. Please try again shortly.', continueSession: false };
  }

  return { response: confirmPrompt(clinicName), continueSession: true, nextState: 'CHECKIN_CONFIRM' };
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
