import { UssdSessionContext } from '../../src/ussd/types';

// Explicit factories (rather than bare jest.mock(path)) so Jest never has to
// load the real modules to auto-derive a mock shape — those modules pull in
// Redis/BullMQ clients that would otherwise try to connect during tests.
jest.mock('../../src/services/clinicService', () => ({ findClinicByUssdCode: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({
  findPatientByPhone: jest.fn(),
  registerPatient: jest.fn(),
}));
jest.mock('../../src/services/checkInService', () => ({ initiateCheckIn: jest.fn() }));

import { findClinicByUssdCode } from '../../src/services/clinicService';
import { findPatientByPhone, registerPatient } from '../../src/services/patientService';
import { initiateCheckIn } from '../../src/services/checkInService';
import { checkinConfirm, checkinConsent, checkinEnterClinicCode } from '../../src/ussd/states/patientCheckIn';

const mockFindClinic = findClinicByUssdCode as jest.Mock;
const mockFindPatient = findPatientByPhone as jest.Mock;
const mockRegisterPatient = registerPatient as jest.Mock;
const mockInitiateCheckIn = initiateCheckIn as jest.Mock;

function freshSession(): UssdSessionContext {
  return {
    sessionId: 'session-1',
    state: 'CHECKIN_ENTER_CLINIC_CODE',
    phoneNumberE164: '+254712345678',
    data: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('checkinEnterClinicCode', () => {
  it('re-prompts when the clinic code is not found', async () => {
    mockFindClinic.mockResolvedValue(null);
    const result = await checkinEnterClinicCode(freshSession(), '999');
    expect(result.nextState).toBeUndefined();
    expect(result.response).toContain('not found');
  });

  it('routes a returning patient straight to confirmation', async () => {
    mockFindClinic.mockResolvedValue({ id: 'clinic-1', name: 'Sunrise Clinic' });
    mockFindPatient.mockResolvedValue({ id: 'patient-1' });

    const session = freshSession();
    const result = await checkinEnterClinicCode(session, '482');

    expect(result.nextState).toBe('CHECKIN_CONFIRM');
    expect(session.data.patientId).toBe('patient-1');
    expect(result.response).toContain('Sunrise Clinic');
  });

  it('routes a new patient to the consent prompt', async () => {
    mockFindClinic.mockResolvedValue({ id: 'clinic-1', name: 'Sunrise Clinic' });
    mockFindPatient.mockResolvedValue(null);

    const result = await checkinEnterClinicCode(freshSession(), '482');

    expect(result.nextState).toBe('CHECKIN_CONSENT');
    expect(result.response).toContain('Agree');
  });
});

describe('checkinConsent', () => {
  it('ends the session without registering anything when declined', async () => {
    const result = await checkinConsent(freshSession(), '2');
    expect(result.continueSession).toBe(false);
    expect(mockRegisterPatient).not.toHaveBeenCalled();
  });

  it('proceeds to name collection when agreed', async () => {
    const result = await checkinConsent(freshSession(), '1');
    expect(result.nextState).toBe('CHECKIN_NEW_PATIENT_NAME');
  });
});

describe('checkinConfirm', () => {
  it('cancels without calling initiateCheckIn', async () => {
    const session = { ...freshSession(), data: { clinicName: 'Sunrise Clinic' } };
    const result = await checkinConfirm(session, '2');
    expect(result.continueSession).toBe(false);
    expect(mockInitiateCheckIn).not.toHaveBeenCalled();
  });

  it('triggers check-in and tells the patient to check their phone', async () => {
    mockInitiateCheckIn.mockResolvedValue({
      checkIn: { status: 'PENDING_PAYMENT' },
      wasAlreadyInitiated: false,
    });

    const session = {
      ...freshSession(),
      data: { clinicName: 'Sunrise Clinic', clinicId: 'clinic-1', patientId: 'patient-1' },
    };
    const result = await checkinConfirm(session, '1');

    expect(mockInitiateCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-1', patientId: 'patient-1' }),
    );
    expect(result.continueSession).toBe(false);
    expect(result.response).toContain('M-Pesa prompt');
  });
});
