import { UssdSessionContext } from '../../src/ussd/types';

jest.mock('../../src/services/clinicService', () => ({ listActiveClinics: jest.fn() }));
jest.mock('../../src/services/departmentService', () => ({ listActiveDepartments: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({
  findPatientByPhone: jest.fn(),
  registerPatient: jest.fn(),
}));
jest.mock('../../src/services/checkInService', () => ({ initiateCheckIn: jest.fn() }));

import { listActiveClinics } from '../../src/services/clinicService';
import { listActiveDepartments } from '../../src/services/departmentService';
import { buildClinicSelectionPrompt, checkinSelectClinic } from '../../src/ussd/states/clinicSelect';

const mockListClinics = listActiveClinics as jest.Mock;
const mockListDepartments = listActiveDepartments as jest.Mock;

const ONE_PAGE_CLINICS = [
  { id: 'c1', name: 'Sunrise Family Clinic' },
  { id: 'c2', name: 'Baraka Health Centre' },
];

const TWO_PAGE_CLINICS = [
  { id: 'c1', name: 'Clinic A' },
  { id: 'c2', name: 'Clinic B' },
  { id: 'c3', name: 'Clinic C' },
  { id: 'c4', name: 'Clinic D' },
  { id: 'c5', name: 'Clinic E' },
  { id: 'c6', name: 'Clinic F' },
  { id: 'c7', name: 'Clinic G' },
];

function freshSession(): UssdSessionContext {
  return {
    sessionId: 'session-1',
    state: 'CHECKIN_SELECT_CLINIC',
    phoneNumberE164: '+254712345678',
    data: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('buildClinicSelectionPrompt', () => {
  it('renders a single page with no pagination controls', () => {
    const prompt = buildClinicSelectionPrompt(ONE_PAGE_CLINICS, 0);
    expect(prompt).toContain('1. Sunrise Family Clinic');
    expect(prompt).toContain('2. Baraka Health Centre');
    expect(prompt).not.toContain('Next page');
    expect(prompt).not.toContain('page 1/');
  });

  it('renders "0. Next page" and a page indicator when there is more than one page', () => {
    const prompt = buildClinicSelectionPrompt(TWO_PAGE_CLINICS, 0);
    expect(prompt).toContain('page 1/2');
    expect(prompt).toContain('0. Next page');
    expect(prompt).toContain('5. Clinic E');
    expect(prompt).not.toContain('Clinic F');
  });

  it('renders the second page correctly', () => {
    const prompt = buildClinicSelectionPrompt(TWO_PAGE_CLINICS, 1);
    expect(prompt).toContain('page 2/2');
    expect(prompt).toContain('1. Clinic F');
    expect(prompt).toContain('2. Clinic G');
  });
});

describe('checkinSelectClinic', () => {
  it('ends the session gracefully when no clinics are active', async () => {
    mockListClinics.mockResolvedValue([]);
    const result = await checkinSelectClinic(freshSession(), '1');
    expect(result.continueSession).toBe(false);
    expect(result.response).toContain('No clinics are available');
  });

  it('treats "0" as invalid when there is only one page', async () => {
    mockListClinics.mockResolvedValue(ONE_PAGE_CLINICS);
    const result = await checkinSelectClinic(freshSession(), '0');
    expect(result.nextState).toBeUndefined();
    expect(result.response).toContain('Invalid choice');
  });

  it('advances to the next page on "0" and stores the new page in session data', async () => {
    mockListClinics.mockResolvedValue(TWO_PAGE_CLINICS);
    const session = freshSession();
    session.data.clinicPage = 0;

    const result = await checkinSelectClinic(session, '0');

    expect(session.data.clinicPage).toBe(1);
    expect(result.nextState).toBeUndefined(); // stays in CHECKIN_SELECT_CLINIC
    expect(result.response).toContain('page 2/2');
  });

  it('wraps from the last page back to the first on "0"', async () => {
    mockListClinics.mockResolvedValue(TWO_PAGE_CLINICS);
    const session = freshSession();
    session.data.clinicPage = 1;

    const result = await checkinSelectClinic(session, '0');

    expect(session.data.clinicPage).toBe(0);
    expect(result.response).toContain('page 1/2');
  });

  it('routes a valid selection into department selection', async () => {
    mockListClinics.mockResolvedValue(ONE_PAGE_CLINICS);
    mockListDepartments.mockResolvedValue([{ id: 'd1', name: 'General' }]);

    const session = freshSession();
    const result = await checkinSelectClinic(session, '2');

    expect(session.data.clinicId).toBe('c2');
    expect(session.data.clinicName).toBe('Baraka Health Centre');
    expect(session.data.departmentPage).toBe(0);
    expect(result.nextState).toBe('CHECKIN_SELECT_DEPARTMENT');
  });

  it('selects from the current page, not the whole list, after paging forward', async () => {
    mockListClinics.mockResolvedValue(TWO_PAGE_CLINICS);
    mockListDepartments.mockResolvedValue([{ id: 'd1', name: 'General' }]);

    const session = freshSession();
    session.data.clinicPage = 1; // page 2: Clinic F, Clinic G

    const result = await checkinSelectClinic(session, '1');

    expect(session.data.clinicId).toBe('c6'); // Clinic F, not Clinic A
    expect(result.nextState).toBe('CHECKIN_SELECT_DEPARTMENT');
  });

  it('re-prompts on an out-of-range or non-numeric choice', async () => {
    mockListClinics.mockResolvedValue(ONE_PAGE_CLINICS);

    const result = await checkinSelectClinic(freshSession(), '9');

    expect(result.nextState).toBeUndefined();
    expect(result.response).toContain('Invalid choice');
  });
});
