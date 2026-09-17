import { UssdSessionContext } from '../../src/ussd/types';

jest.mock('../../src/services/departmentService', () => ({ listActiveDepartments: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({
  findPatientByPhone: jest.fn(),
  registerPatient: jest.fn(),
}));
jest.mock('../../src/services/checkInService', () => ({ initiateCheckIn: jest.fn() }));

import { listActiveDepartments } from '../../src/services/departmentService';
import { findPatientByPhone } from '../../src/services/patientService';
import {
  beginDepartmentSelection,
  buildDepartmentSelectionPrompt,
  checkinSelectDepartment,
} from '../../src/ussd/states/departmentSelect';

const mockListDepartments = listActiveDepartments as jest.Mock;
const mockFindPatient = findPatientByPhone as jest.Mock;

const ONE_PAGE_DEPARTMENTS = [
  { id: 'd1', name: 'General' },
  { id: 'd2', name: 'Dental' },
];

const TWO_PAGE_DEPARTMENTS = [
  { id: 'd1', name: 'Department A' },
  { id: 'd2', name: 'Department B' },
  { id: 'd3', name: 'Department C' },
  { id: 'd4', name: 'Department D' },
  { id: 'd5', name: 'Department E' },
  { id: 'd6', name: 'Department F' },
  { id: 'd7', name: 'Department G' },
];

function freshSession(): UssdSessionContext {
  return {
    sessionId: 'session-1',
    state: 'CHECKIN_SELECT_DEPARTMENT',
    phoneNumberE164: '+254712345678',
    data: { clinicId: 'clinic-1', clinicName: 'Sunrise Clinic' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('buildDepartmentSelectionPrompt', () => {
  it('renders a single page with no pagination controls', () => {
    const prompt = buildDepartmentSelectionPrompt(ONE_PAGE_DEPARTMENTS, 0);
    expect(prompt).toContain('1. General');
    expect(prompt).toContain('2. Dental');
    expect(prompt).not.toContain('Next page');
  });

  it('renders "0. Next page" and a page indicator when there is more than one page', () => {
    const prompt = buildDepartmentSelectionPrompt(TWO_PAGE_DEPARTMENTS, 0);
    expect(prompt).toContain('page 1/2');
    expect(prompt).toContain('0. Next page');
    expect(prompt).toContain('5. Department E');
    expect(prompt).not.toContain('Department F');
  });
});

describe('beginDepartmentSelection', () => {
  it('resets pagination and renders the first page', async () => {
    mockListDepartments.mockResolvedValue(ONE_PAGE_DEPARTMENTS);
    const session = freshSession();
    session.data.departmentPage = 3;

    const result = await beginDepartmentSelection(session);

    expect(session.data.departmentPage).toBe(0);
    expect(result.nextState).toBe('CHECKIN_SELECT_DEPARTMENT');
    expect(result.response).toContain('1. General');
  });

  it('ends the session gracefully when no departments are active', async () => {
    mockListDepartments.mockResolvedValue([]);
    const result = await beginDepartmentSelection(freshSession());
    expect(result.continueSession).toBe(false);
    expect(result.response).toContain('No departments are available');
  });
});

describe('checkinSelectDepartment', () => {
  it('advances to the next page on "0"', async () => {
    mockListDepartments.mockResolvedValue(TWO_PAGE_DEPARTMENTS);
    const session = freshSession();
    session.data.departmentPage = 0;

    const result = await checkinSelectDepartment(session, '0');

    expect(session.data.departmentPage).toBe(1);
    expect(result.nextState).toBeUndefined();
    expect(result.response).toContain('page 2/2');
  });

  it('routes a valid selection into the patient lookup flow, storing the department on session data', async () => {
    mockListDepartments.mockResolvedValue(ONE_PAGE_DEPARTMENTS);
    mockFindPatient.mockResolvedValue(null);

    const session = freshSession();
    const result = await checkinSelectDepartment(session, '2');

    expect(session.data.departmentId).toBe('d2');
    expect(session.data.departmentName).toBe('Dental');
    expect(result.nextState).toBe('CHECKIN_CONSENT');
  });

  it('re-prompts on an out-of-range choice', async () => {
    mockListDepartments.mockResolvedValue(ONE_PAGE_DEPARTMENTS);

    const result = await checkinSelectDepartment(freshSession(), '9');

    expect(result.nextState).toBeUndefined();
    expect(result.response).toContain('Invalid choice');
  });
});
