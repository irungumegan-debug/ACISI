import { UssdSessionContext } from '../../src/ussd/types';

jest.mock('../../src/services/clinicService', () => ({ listActiveClinics: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({
  findPatientByPhone: jest.fn(),
  getPortableHistory: jest.fn(),
  registerPatient: jest.fn(),
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/checkInService', () => ({ initiateCheckIn: jest.fn() }));

import { listActiveClinics } from '../../src/services/clinicService';
import { findPatientByPhone, getPortableHistory } from '../../src/services/patientService';
import { splitUssdText } from '../../src/ussd/fsm';
import { mainMenu } from '../../src/ussd/states/mainMenu';
import { staffMenu } from '../../src/ussd/states/staffLogin';
import { ENTER_SENTINEL } from '../../src/ussd/types';

const mockListClinics = listActiveClinics as jest.Mock;
const mockFindPatient = findPatientByPhone as jest.Mock;
const mockGetHistory = getPortableHistory as jest.Mock;

function freshSession(): UssdSessionContext {
  return {
    sessionId: 'session-1',
    state: 'MAIN_MENU',
    phoneNumberE164: '+254712345678',
    data: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('splitUssdText', () => {
  it('returns no tokens for an empty first request', () => {
    expect(splitUssdText('')).toEqual([]);
  });

  it('splits accumulated keystrokes on *', () => {
    expect(splitUssdText('1*482*1')).toEqual(['1', '482', '1']);
  });
});

describe('mainMenu', () => {
  it('renders the menu on first entry without consuming input', async () => {
    const result = await mainMenu(freshSession(), ENTER_SENTINEL);
    expect(result.continueSession).toBe(true);
    expect(result.response).toContain('Welcome to ACISI');
    expect(result.response).toContain('3. My Records');
    expect(result.nextState).toBeUndefined();
  });

  it('routes "1" to the clinic selection menu', async () => {
    mockListClinics.mockResolvedValue([{ id: 'c1', name: 'Sunrise Clinic' }]);
    const result = await mainMenu(freshSession(), '1');
    expect(result.nextState).toBe('CHECKIN_SELECT_CLINIC');
    expect(result.continueSession).toBe(true);
    expect(result.response).toContain('Sunrise Clinic');
  });

  it('ends gracefully on "1" when no clinics are active', async () => {
    mockListClinics.mockResolvedValue([]);
    const result = await mainMenu(freshSession(), '1');
    expect(result.continueSession).toBe(false);
    expect(result.response).toContain('No clinics are available');
  });

  it('routes "2" to the staff login flow', async () => {
    const result = await mainMenu(freshSession(), '2');
    expect(result.nextState).toBe('STAFF_ENTER_CODE');
  });

  it('tells an unregistered caller they have no records on "3"', async () => {
    mockFindPatient.mockResolvedValue(null);
    const result = await mainMenu(freshSession(), '3');
    expect(result.continueSession).toBe(false);
    expect(result.response).toContain("don't have any ACISI records");
  });

  it('shows visit history for a registered caller on "3"', async () => {
    mockFindPatient.mockResolvedValue({ id: 'patient-1', firstName: 'Jane' });
    mockGetHistory.mockResolvedValue([{ clinicName: 'Sunrise Clinic', visitedAt: new Date('2026-01-15') }]);

    const result = await mainMenu(freshSession(), '3');

    expect(result.continueSession).toBe(false);
    expect(result.response).toContain('Sunrise Clinic');
  });

  it('re-prompts on an invalid choice without changing state', async () => {
    const result = await mainMenu(freshSession(), '9');
    expect(result.nextState).toBeUndefined();
    expect(result.response).toContain('Invalid choice');
  });
});

describe('staffMenu', () => {
  it('routes "1" to patient history lookup', async () => {
    const result = await staffMenu(freshSession(), '1');
    expect(result.nextState).toBe('STAFF_HISTORY_ENTER_PHONE');
  });

  it('re-prompts on an invalid choice', async () => {
    const result = await staffMenu(freshSession(), '9');
    expect(result.nextState).toBeUndefined();
    expect(result.continueSession).toBe(true);
  });
});
