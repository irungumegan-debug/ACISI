jest.mock('../../src/services/patientService', () => ({
  ...jest.requireActual('../../src/services/patientService'),
  findPatientsByPhone: jest.fn(),
  registerPatient: jest.fn(),
  getPortableHistory: jest.fn(),
}));
jest.mock('../../src/services/patientAuthService', () => ({
  ...jest.requireActual('../../src/services/patientAuthService'),
  confirmPatientPin: jest.fn(),
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/checkInService', () => ({ initiateCheckIn: jest.fn() }));

import { DuplicatePatientError, findPatientsByPhone, getPortableHistory, registerPatient } from '../../src/services/patientService';
import { confirmPatientPin } from '../../src/services/patientAuthService';
import { checkinNewPatientSex, checkinSelectPerson, proceedToPatientLookup } from '../../src/ussd/states/patientCheckIn';
import { mainMenu, myRecordsEnterPin, myRecordsSelectPerson } from '../../src/ussd/states/mainMenu';
import { UssdSessionContext } from '../../src/ussd/types';

const PARENT = { id: 'p-1', firstName: 'Jane', lastName: 'Wanjiru', pinHash: 'hash' };
const CHILD = { id: 'p-2', firstName: 'Brian', lastName: 'Kamau', pinHash: null };

function session(data: Record<string, unknown> = {}): UssdSessionContext {
  return { sessionId: 's-1', state: 'MAIN_MENU', phoneNumberE164: '+254712345678', data, createdAt: 0, updatedAt: 0 };
}

beforeEach(() => {
  jest.clearAllMocks();
  (findPatientsByPhone as jest.Mock).mockResolvedValue([PARENT, CHILD]);
});

describe('USSD check-in on a shared phone', () => {
  it('asks who is checking in, with an option for someone new', async () => {
    const s = session();
    const res = await proceedToPatientLookup(s, { id: 'c-1', name: 'Sunrise' } as never);
    expect(res.nextState).toBe('CHECKIN_SELECT_PERSON');
    expect(res.response).toBe('CON Who is checking in?\n1. Jane W.\n2. Brian K.\n0. Someone new');
  });

  it('checks in the person chosen', async () => {
    const s = session({ clinicName: 'Sunrise', personIds: ['p-1', 'p-2'], personNames: ['Jane W.', 'Brian K.'] });
    const res = await checkinSelectPerson(s, '2');
    expect(s.data.patientId).toBe('p-2');
    expect(res.nextState).toBe('CHECKIN_CONFIRM');
  });

  it('"0" registers someone new on the same phone', async () => {
    const s = session({ personIds: ['p-1', 'p-2'], personNames: ['Jane W.', 'Brian K.'] });
    expect((await checkinSelectPerson(s, '0')).nextState).toBe('CHECKIN_CONSENT');
  });

  it('re-asks on a choice that is not listed', async () => {
    const s = session({ personIds: ['p-1', 'p-2'], personNames: ['Jane W.', 'Brian K.'] });
    const res = await checkinSelectPerson(s, '7');
    expect(res.nextState).toBeUndefined();
    expect(res.response).toContain('Please choose from the list');
  });
});

describe('USSD registration', () => {
  it('no longer asks the "share with all clinics" question, and marks the birth date as year-only', async () => {
    (registerPatient as jest.Mock).mockResolvedValue({ id: 'p-new' });
    const s = session({ clinicName: 'Sunrise', firstName: 'Amina', lastName: 'Otieno', birthYear: 1990 });
    const res = await checkinNewPatientSex(s, '2');
    expect(res.nextState).toBe('CHECKIN_CONFIRM');
    expect(registerPatient).toHaveBeenCalledWith(expect.objectContaining({ dateOfBirthEstimated: true, crossClinicConsent: false }));
  });

  it('a replayed session reuses the patient instead of registering them twice', async () => {
    (registerPatient as jest.Mock).mockRejectedValue(new DuplicatePatientError({ id: 'p-existing' } as never));
    const s = session({ clinicName: 'Sunrise', firstName: 'Amina', lastName: 'Otieno', birthYear: 1990 });
    const res = await checkinNewPatientSex(s, '2');
    expect(s.data.patientId).toBe('p-existing');
    expect(res.nextState).toBe('CHECKIN_CONFIRM');
  });
});

describe('USSD "My Records" on a shared phone', () => {
  it('asks whose records', async () => {
    const res = await mainMenu(session(), '3');
    expect(res.nextState).toBe('MY_RECORDS_SELECT_PERSON');
    expect(res.response).toBe('CON Whose records?\n1. Jane W.\n2. Brian K.');
  });

  it("needs that person's PIN before showing anything", async () => {
    const s = session({ personIds: ['p-1', 'p-2'], personNames: ['Jane W.', 'Brian K.'] });
    expect((await myRecordsSelectPerson(s, '1')).nextState).toBe('MY_RECORDS_ENTER_PIN');

    (confirmPatientPin as jest.Mock).mockResolvedValue(false);
    expect((await myRecordsEnterPin(s, '000000')).response).toBe('END Wrong PIN.');
    expect(getPortableHistory).not.toHaveBeenCalled();

    (confirmPatientPin as jest.Mock).mockResolvedValue(true);
    (getPortableHistory as jest.Mock).mockResolvedValue([]);
    expect((await myRecordsEnterPin(s, '730194')).response).toContain('Jane, you have no visits');
  });

  it('a person with no PIN is told to set one first, and sees nothing', async () => {
    const s = session({ personIds: ['p-1', 'p-2'], personNames: ['Jane W.', 'Brian K.'] });
    const res = await myRecordsSelectPerson(s, '2');
    expect(res.response).toMatch(/^END .*set one at acisi.co.ke/i);
    expect(getPortableHistory).not.toHaveBeenCalled();
  });
});
