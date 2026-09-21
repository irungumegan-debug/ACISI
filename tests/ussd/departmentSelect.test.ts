import { UssdSessionContext } from '../../src/ussd/types';

jest.mock('../../src/services/departmentService', () => ({ listActiveDepartments: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({
  findPatientByPhone: jest.fn(),
  registerPatient: jest.fn(),
}));
// proceedToPatientLookup (via patientCheckIn.ts) also pulls in checkInService,
// which otherwise loads the real BullMQ queues in jobs/queue.ts and attempts
// a real Redis connection — mock it out same as the other USSD state tests.
jest.mock('../../src/services/checkInService', () => ({ initiateCheckIn: jest.fn() }));

import { listActiveDepartments } from '../../src/services/departmentService';
import { findPatientByPhone } from '../../src/services/patientService';
import { buildDepartmentSelectionPrompt, checkinSelectDepartment } from '../../src/ussd/states/departmentSelect';

const mockListDepartments = listActiveDepartments as jest.Mock;
const mockFindPatient = findPatientByPhone as jest.Mock;

const DEPARTMENTS = [
  { id: 'dept-1', name: 'General' },
  { id: 'dept-2', name: 'Dental' },
];

function freshSession(): UssdSessionContext {
  return {
    sessionId: 'session-1',
    state: 'CHECKIN_SELECT_DEPARTMENT',
    phoneNumberE164: '+254712345678',
    data: { clinicId: 'clinic-1', clinicName: 'Sunrise Family Clinic' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('buildDepartmentSelectionPrompt', () => {
  it('numbers each department', () => {
    const prompt = buildDepartmentSelectionPrompt(DEPARTMENTS);
    expect(prompt).toContain('1. General');
    expect(prompt).toContain('2. Dental');
  });
});

describe('checkinSelectDepartment', () => {
  it('ends the session if the clinic has no departments', async () => {
    mockListDepartments.mockResolvedValue([]);
    const result = await checkinSelectDepartment(freshSession(), '1');
    expect(result.continueSession).toBe(false);
  });

  it('re-prompts on an invalid choice', async () => {
    mockListDepartments.mockResolvedValue(DEPARTMENTS);
    const result = await checkinSelectDepartment(freshSession(), '9');
    expect(result.nextState).toBeUndefined();
    expect(result.response).toContain('Invalid choice');
  });

  it('stores the chosen department and proceeds to patient lookup', async () => {
    mockListDepartments.mockResolvedValue(DEPARTMENTS);
    mockFindPatient.mockResolvedValue(null);

    const session = freshSession();
    const result = await checkinSelectDepartment(session, '2');

    expect(session.data.departmentId).toBe('dept-2');
    expect(session.data.departmentName).toBe('Dental');
    expect(result.nextState).toBe('CHECKIN_CONSENT');
  });

  it('routes a returning patient straight to confirmation', async () => {
    mockListDepartments.mockResolvedValue(DEPARTMENTS);
    mockFindPatient.mockResolvedValue({ id: 'patient-1' });

    const session = freshSession();
    const result = await checkinSelectDepartment(session, '1');

    expect(session.data.patientId).toBe('patient-1');
    expect(result.nextState).toBe('CHECKIN_CONFIRM');
  });
});
