import { UssdStateHandler } from '../types';
import { InvalidPhoneNumberError, toE164 } from '../../utils/phone';
import { clinicHasRecordAccess, findPatientsByPhone, getPortableHistory } from '../../services/patientService';
import { recordAuditEvent } from '../../services/auditService';
import { formatVisitHistoryLines } from '../formatting';

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

  const patients = await findPatientsByPhone(patientPhone);
  if (patients.length === 0) {
    return { response: 'END No ACISI record found for that number.', continueSession: false };
  }
  if (patients.length > 1) {
    return { response: 'END Several patients share this number. Look them up on the ACISI console instead.', continueSession: false };
  }
  const patient = patients[0] as (typeof patients)[number];

  const hasConsent = await clinicHasRecordAccess(patient.id, session.data.clinicId as string);
  if (!hasConsent) {
    return {
      response: 'END This patient has not approved your clinic seeing their records. Use "Request past records" on the ACISI console.',
      continueSession: false,
    };
  }

  const history = await getPortableHistory(patient.id);

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: session.data.staffId as string,
    staffId: session.data.staffId as string,
    clinicId: session.data.clinicId as string,
    patientId: patient.id,
    action: 'PATIENT_HISTORY_VIEWED',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: { viewedByClinicId: session.data.clinicId },
  });

  if (history.length === 0) {
    return { response: `END ${patient.firstName} ${patient.lastName} — no prior visits on record.`, continueSession: false };
  }

  const lines = formatVisitHistoryLines(history);

  return {
    response: `END ${patient.firstName} ${patient.lastName} — recent visits:\n${lines.join('\n')}`,
    continueSession: false,
  };
};
