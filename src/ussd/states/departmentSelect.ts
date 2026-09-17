import { UssdSessionContext, UssdStateHandler, UssdStateResult } from '../types';
import { DepartmentListItem, listActiveDepartments } from '../../services/departmentService';
import { DEPARTMENTS_PER_PAGE } from '../../config/constants';
import { proceedToPatientLookup } from './patientCheckIn';

/** Renders one page of the department list as a full "CON ..." USSD response. */
export function buildDepartmentSelectionPrompt(departments: DepartmentListItem[], page: number): string {
  const totalPages = Math.max(Math.ceil(departments.length / DEPARTMENTS_PER_PAGE), 1);
  const start = page * DEPARTMENTS_PER_PAGE;
  const pageDepartments = departments.slice(start, start + DEPARTMENTS_PER_PAGE);

  const lines = pageDepartments.map((department, i) => `${i + 1}. ${department.name}`);
  if (totalPages > 1) {
    lines.push('0. Next page');
  }

  const header = totalPages > 1 ? `Select a department (page ${page + 1}/${totalPages}):` : 'Select a department:';
  return `CON ${header}\n${lines.join('\n')}`;
}

/**
 * Entry point called once a clinic has been chosen
 * (src/ussd/states/clinicSelect.ts). Mirrors how MAIN_MENU kicks off clinic
 * selection: fetch once, reset pagination, render page 0.
 */
export async function beginDepartmentSelection(session: UssdSessionContext): Promise<UssdStateResult> {
  const departments = await listActiveDepartments();
  if (departments.length === 0) {
    return { response: 'END No departments are available right now. Please try again later.', continueSession: false };
  }

  session.data.departmentPage = 0;
  return {
    response: buildDepartmentSelectionPrompt(departments, 0),
    continueSession: true,
    nextState: 'CHECKIN_SELECT_DEPARTMENT',
  };
}

export const checkinSelectDepartment: UssdStateHandler = async (session, input) => {
  const departments = await listActiveDepartments();

  if (departments.length === 0) {
    return { response: 'END No departments are available right now. Please try again later.', continueSession: false };
  }

  const totalPages = Math.max(Math.ceil(departments.length / DEPARTMENTS_PER_PAGE), 1);
  const currentPage = ((session.data.departmentPage as number) ?? 0) % totalPages;

  if (input === '0') {
    if (totalPages <= 1) {
      return {
        response: `CON Invalid choice.\n${buildDepartmentSelectionPrompt(departments, currentPage).replace('CON ', '')}`,
        continueSession: true,
      };
    }
    const nextPage = (currentPage + 1) % totalPages;
    session.data.departmentPage = nextPage;
    return { response: buildDepartmentSelectionPrompt(departments, nextPage), continueSession: true };
  }

  const start = currentPage * DEPARTMENTS_PER_PAGE;
  const pageDepartments = departments.slice(start, start + DEPARTMENTS_PER_PAGE);
  const choice = Number(input);
  const selected = Number.isInteger(choice) ? pageDepartments[choice - 1] : undefined;

  if (selected) {
    session.data.departmentId = selected.id;
    session.data.departmentName = selected.name;
    return proceedToPatientLookup(session);
  }

  return {
    response: `CON Invalid choice.\n${buildDepartmentSelectionPrompt(departments, currentPage).replace('CON ', '')}`,
    continueSession: true,
  };
};
