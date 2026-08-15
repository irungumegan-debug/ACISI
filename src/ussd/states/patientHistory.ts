import dayjs from 'dayjs';
import { UssdStateHandler } from '../types';
import { InvalidPhoneNumberError, toE164 } from '../../utils/phone';
import { findPatientByPhone, getPortableHistory, hasActiveDataSharingConsent } from '../../services/patientService';
import { recordAuditEvent } from '../../services/auditService';

export const staffHistoryEnterPhone: UssdStateHandler = async (session, input) => {
  let patientPhone: string;
  try {
    patientPhone = toE164(input.trim());
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      return { response: 'CON Please enter a valid phone number, e.g. 0712345678:', continueSession: true };
    }
    throw err;
  }

  const patient = await findPatientByPhone(patientPhone);
  if (!patient) {
    return { response: 'END No ACISI record found for that number.', continueSession: false };
  }

  const hasConsent = await hasActiveDataSharingConsent(patient.id);
  if (!hasConsent) {
    return { response: 'END This patient has not consented to cross-clinic record sharing.', continueSession: false };
  }

  const history = await getPortableHistory(patient.id);

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: session.data.staffId as string,
    staffId: session.data.staffId as string,
    action: 'PATIENT_HISTORY_VIEWED',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: { viewedByClinicId: session.data.clinicId },
  });

  if (history.length === 0) {
    return { response: `END ${patient.firstName} ${patient.lastName} — no prior visits on record.`, continueSession: false };
  }

  const lines = history.map((h, i) => `${i + 1}. ${h.clinicName} - ${dayjs(h.visitedAt).format('DD MMM YYYY')}`);

  return {
    response: `END ${patient.firstName} ${patient.lastName} — recent visits:\n${lines.join('\n')}`,
    continueSession: false,
  };
};
