import { UssdStateHandler } from '../types';
import { ClinicListItem, listActiveClinics } from '../../services/clinicService';
import { CLINICS_PER_PAGE } from '../../config/constants';
import { proceedToPatientLookup } from './patientCheckIn';

/** Renders one page of the clinic list as a full "CON ..." USSD response. */
export function buildClinicSelectionPrompt(clinics: ClinicListItem[], page: number): string {
  const totalPages = Math.max(Math.ceil(clinics.length / CLINICS_PER_PAGE), 1);
  const start = page * CLINICS_PER_PAGE;
  const pageClinics = clinics.slice(start, start + CLINICS_PER_PAGE);

  const lines = pageClinics.map((clinic, i) => `${i + 1}. ${clinic.name}`);
  if (totalPages > 1) {
    lines.push('0. Next page');
  }

  const header = totalPages > 1 ? `Select your clinic (page ${page + 1}/${totalPages}):` : 'Select your clinic:';
  return `CON ${header}\n${lines.join('\n')}`;
}

export const checkinSelectClinic: UssdStateHandler = async (session, input) => {
  const clinics = await listActiveClinics();

  if (clinics.length === 0) {
    return { response: 'END No clinics are available right now. Please try again later.', continueSession: false };
  }

  const totalPages = Math.max(Math.ceil(clinics.length / CLINICS_PER_PAGE), 1);
  const currentPage = ((session.data.clinicPage as number) ?? 0) % totalPages;

  if (input === '0') {
    if (totalPages <= 1) {
      return {
        response: `CON Invalid choice.\n${buildClinicSelectionPrompt(clinics, currentPage).replace('CON ', '')}`,
        continueSession: true,
      };
    }
    const nextPage = (currentPage + 1) % totalPages;
    session.data.clinicPage = nextPage;
    return { response: buildClinicSelectionPrompt(clinics, nextPage), continueSession: true };
  }

  const start = currentPage * CLINICS_PER_PAGE;
  const pageClinics = clinics.slice(start, start + CLINICS_PER_PAGE);
  const choice = Number(input);
  const selected = Number.isInteger(choice) ? pageClinics[choice - 1] : undefined;

  if (selected) {
    return proceedToPatientLookup(session, selected);
  }

  return {
    response: `CON Invalid choice.\n${buildClinicSelectionPrompt(clinics, currentPage).replace('CON ', '')}`,
    continueSession: true,
  };
};
