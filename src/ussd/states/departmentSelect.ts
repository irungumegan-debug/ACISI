import { UssdStateHandler } from '../types';
import { DepartmentListItem, listActiveDepartments } from '../../services/departmentService';
import { proceedToPatientLookup } from './patientCheckIn';

/** Renders the department list as a full "CON ..." USSD response. Small lists (a handful per clinic), so no pagination needed unlike clinic selection. */
export function buildDepartmentSelectionPrompt(departments: DepartmentListItem[]): string {
  const lines = departments.map((d, i) => `${i + 1}. ${d.name}`);
  return `CON Select department:\n${lines.join('\n')}`;
}

export const checkinSelectDepartment: UssdStateHandler = async (session, input) => {
  const clinicId = session.data.clinicId as string;
  const departments = await listActiveDepartments(clinicId);

  if (departments.length === 0) {
    return { response: 'END This clinic has no departments configured yet. Please speak to reception.', continueSession: false };
  }

  const choice = Number(input);
  const selected = Number.isInteger(choice) ? departments[choice - 1] : undefined;

  if (!selected) {
    return {
      response: `CON Invalid choice.\n${buildDepartmentSelectionPrompt(departments).replace('CON ', '')}`,
      continueSession: true,
    };
  }

  session.data.departmentId = selected.id;
  session.data.departmentName = selected.name;

  return proceedToPatientLookup(session, {
    id: clinicId,
    name: session.data.clinicName as string,
  });
};
