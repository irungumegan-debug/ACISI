import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));

jest.mock('../../src/services/staffService', () => ({
  ...jest.requireActual('../../src/services/staffService'),
  findActiveStaffById: jest.fn(),
  setDoctorPresenceBySelf: jest.fn(),
}));

jest.mock('../../src/services/appointmentService', () => ({ listDepartmentAppointmentsToday: jest.fn() }));
jest.mock('../../src/services/departmentService', () => ({ getDoctorDepartmentIds: jest.fn() }));

jest.mock('../../src/services/encounterService', () => ({
  getDoctorQueue: jest.fn(),
  getEncounterForDoctor: jest.fn(),
  submitConsultation: jest.fn(),
  EncounterNotAccessibleError: class EncounterNotAccessibleError extends Error {
    constructor() {
      super('Patient not found in your queue');
      this.name = 'EncounterNotAccessibleError';
    }
  },
  EncounterNotConsultableError: class EncounterNotConsultableError extends Error {
    constructor() {
      super('This patient is not currently awaiting consultation');
      this.name = 'EncounterNotConsultableError';
    }
  },
  InvalidPinError: class InvalidPinError extends Error {
    constructor() {
      super('Incorrect PIN. Please try again.');
      this.name = 'InvalidPinError';
    }
  },
  PinLockedOutError: class PinLockedOutError extends Error {},
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import {
  getDoctorQueue,
  getEncounterForDoctor,
  submitConsultation,
  EncounterNotAccessibleError,
  InvalidPinError,
} from '../../src/services/encounterService';
import { findActiveStaffById, setDoctorPresenceBySelf } from '../../src/services/staffService';
import { listDepartmentAppointmentsToday } from '../../src/services/appointmentService';
import { doctorRouter } from '../../src/dashboard/doctor';
import { AllergyOverrideRequiredError } from '../../src/services/prescriptionService';
import { getDoctorDepartmentIds } from '../../src/services/departmentService';

const mockDoctorDepartments = getDoctorDepartmentIds as jest.Mock;

const mockLoadSession = loadDashboardSession as jest.Mock;
const mockGetQueue = getDoctorQueue as jest.Mock;
const mockGetEncounter = getEncounterForDoctor as jest.Mock;
const mockSubmitConsult = submitConsultation as jest.Mock;
const mockFindStaffById = findActiveStaffById as jest.Mock;
const mockSetPresenceBySelf = setDoctorPresenceBySelf as jest.Mock;
const mockListAppointmentsToday = listDepartmentAppointmentsToday as jest.Mock;

const TODAY = new Date();

const DOCTOR_SESSION = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-DEMO',
  staffName: 'Dr. Amani Wambui',
  role: 'DOCTOR',
  clinicId: 'clinic-1',
  clinicName: 'Sunrise Family Clinic',
  departmentId: 'dept-1',
};

const RECEPTIONIST_SESSION = { ...DOCTOR_SESSION, role: 'RECEPTIONIST', departmentId: null };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/doctor', doctorRouter);
  return app;
}

function withCookie(req: request.Test) {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDoctorDepartments.mockResolvedValue(['dept-1']);
});

describe('requireDoctor gating', () => {
  it('rejects a non-doctor role', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await withCookie(request(buildApp()).get('/doctor/queue'));
    expect(res.status).toBe(403);
    expect(mockGetQueue).not.toHaveBeenCalled();
  });

  it('rejects a doctor who has no departments', async () => {
    mockLoadSession.mockResolvedValue({ ...DOCTOR_SESSION, departmentId: null });
    mockDoctorDepartments.mockResolvedValue([]);
    const res = await withCookie(request(buildApp()).get('/doctor/queue'));
    expect(res.status).toBe(403);
  });
});

describe('GET /doctor/queue', () => {
  it("returns the doctor's own clinic+department queue, plus their current presence", async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockGetQueue.mockResolvedValue([{ encounterId: 'enc-1', patientName: 'Jane Wanjiru' }]);
    mockFindStaffById.mockResolvedValue({ lastLoginAt: TODAY, presenceOverride: null, presenceOverrideAt: null });

    const res = await withCookie(request(buildApp()).get('/doctor/queue'));

    expect(res.status).toBe(200);
    expect(mockGetQueue).toHaveBeenCalledWith('clinic-1', ['dept-1'], 'staff-1');
    expect(res.body.queue).toHaveLength(1);
    expect(res.body.presence).toBe('IN');
  });

  it('reports NOT_IN_YET when the staff row is somehow missing', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockGetQueue.mockResolvedValue([]);
    mockFindStaffById.mockResolvedValue(null);

    const res = await withCookie(request(buildApp()).get('/doctor/queue'));

    expect(res.body.presence).toBe('NOT_IN_YET');
  });
});

describe('POST /doctor/presence', () => {
  it('rejects an invalid status', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    const res = await withCookie(request(buildApp()).post('/doctor/presence').send({ status: 'MAYBE' }));
    expect(res.status).toBe(400);
    expect(mockSetPresenceBySelf).not.toHaveBeenCalled();
  });

  it('lets a doctor mark themselves out for today', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockSetPresenceBySelf.mockResolvedValue({ presence: 'OUT' });

    const res = await withCookie(request(buildApp()).post('/doctor/presence').send({ status: 'OUT' }));

    expect(res.status).toBe(200);
    expect(mockSetPresenceBySelf).toHaveBeenCalledWith('staff-1', 'OUT');
    expect(res.body.presence).toBe('OUT');
  });

  it('is blocked for a non-doctor session, same as the rest of this router', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await withCookie(request(buildApp()).post('/doctor/presence').send({ status: 'OUT' }));
    expect(res.status).toBe(403);
    expect(mockSetPresenceBySelf).not.toHaveBeenCalled();
  });
});

describe('GET /doctor/appointments/today', () => {
  it("returns today's confirmed appointments for the doctor's own clinic+department", async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockListAppointmentsToday.mockResolvedValue([{ id: 'appt-1', patientName: 'Jane Wanjiru', patientCode: 'ACI-1042' }]);

    const res = await withCookie(request(buildApp()).get('/doctor/appointments/today'));

    expect(res.status).toBe(200);
    expect(mockListAppointmentsToday).toHaveBeenCalledWith('clinic-1', ['dept-1']);
    expect(res.body.appointments).toHaveLength(1);
  });

  it('is blocked for a non-doctor session, same as the rest of this router', async () => {
    mockLoadSession.mockResolvedValue(RECEPTIONIST_SESSION);
    const res = await withCookie(request(buildApp()).get('/doctor/appointments/today'));
    expect(res.status).toBe(403);
    expect(mockListAppointmentsToday).not.toHaveBeenCalled();
  });
});

describe('GET /doctor/encounters/:id', () => {
  it('returns 404 when the encounter is not in this queue', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockGetEncounter.mockRejectedValue(new EncounterNotAccessibleError());

    const res = await withCookie(request(buildApp()).get('/doctor/encounters/enc-999'));

    expect(res.status).toBe(404);
  });

  it('returns the encounter detail for a valid queue member', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockGetEncounter.mockResolvedValue({ encounterId: 'enc-1', patientName: 'Jane Wanjiru', history: [] });

    const res = await withCookie(request(buildApp()).get('/doctor/encounters/enc-1'));

    expect(res.status).toBe(200);
    expect(mockGetEncounter).toHaveBeenCalledWith('enc-1', 'clinic-1', ['dept-1'], 'staff-1');
  });
});

/** Paracetamol 500 mg Oral Tablet (DHA GE10177): 2 tablets 3 times a day for 3 days. */
const RX = [{ productCode: 'GE10177', doseValue: 2, doseUnit: 'UM10415', route: 'RT10025', frequency: 'TDS', durationDays: 3 }];

describe('POST /doctor/encounters/:id/consult', () => {
  it('rejects a missing diagnosis or prescription', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    const res = await withCookie(request(buildApp()).post('/doctor/encounters/enc-1/consult').send({ diagnosis: 'Flu' }));
    expect(res.status).toBe(400);
    expect(mockSubmitConsult).not.toHaveBeenCalled();
  });

  it('rejects a missing PIN — signing is not optional', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    const res = await withCookie(
      request(buildApp()).post('/doctor/encounters/enc-1/consult').send({ diagnosis: 'Flu', prescriptionItems: RX }),
    );
    expect(res.status).toBe(400);
    expect(mockSubmitConsult).not.toHaveBeenCalled();
  });

  it('submits the consultation, including the signing PIN, and moves the encounter to READY_FOR_CHECKOUT', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockSubmitConsult.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT' });

    const res = await withCookie(
      request(buildApp())
        .post('/doctor/encounters/enc-1/consult')
        .send({ diagnosisCodes: ['1F40.Z'], diagnosis: 'Flu', prescriptionItems: RX, pin: '1234' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('READY_FOR_CHECKOUT');
    expect(mockSubmitConsult).toHaveBeenCalledWith(
      expect.objectContaining({
        encounterId: 'enc-1',
        clinicId: 'clinic-1',
        departmentIds: ['dept-1'],
        staffId: 'staff-1',
        pin: '1234',
      }),
    );
  });

  it('returns 401 when the signing PIN is wrong, without the frontend losing anything but the PIN field', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockSubmitConsult.mockRejectedValue(new InvalidPinError());

    const res = await withCookie(
      request(buildApp())
        .post('/doctor/encounters/enc-1/consult')
        .send({ diagnosisCodes: ['1F40.Z'], diagnosis: 'Flu', prescriptionItems: RX, pin: 'wrong' }),
    );

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect PIN. Please try again.');
  });
});

describe('doctors in several departments', () => {
  it('reads departments fresh and passes them all to the queue', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockDoctorDepartments.mockResolvedValue(['dept-general', 'dept-braces']);
    mockGetQueue.mockResolvedValue([]);
    mockFindStaffById.mockResolvedValue({ id: 'staff-1', lastLoginAt: new Date(), presenceOverride: null, presenceOverrideAt: null });
    const res = await withCookie(request(buildApp()).get('/doctor/queue'));
    expect(res.status).toBe(200);
    expect(mockDoctorDepartments).toHaveBeenCalledWith('staff-1');
    expect(mockGetQueue).toHaveBeenCalledWith('clinic-1', ['dept-general', 'dept-braces'], 'staff-1');
  });
});

describe('ICD-11 coded diagnosis', () => {
  it('signing needs at least one ICD-11 code, and only real codes are accepted, with WHO titles from the server', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockDoctorDepartments.mockResolvedValue(['dept-1']);
    mockSubmitConsult.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT' });
    const send = (body: object) => withCookie(request(buildApp()).post('/doctor/encounters/enc-1/consult').send(body));

    expect((await send({ diagnosisCodes: [], prescriptionItems: RX, pin: '1' })).status).toBe(400);
    const fake = await send({ diagnosisCodes: ['ZZ99'], prescriptionItems: RX, pin: '1' });
    expect(fake.status).toBe(400);
    expect(fake.body.error).toContain('ZZ99');

    const ok = await send({ diagnosisCodes: ['1f40.z', '1F40.Z', 'BA00'], prescriptionItems: RX, pin: '1' });
    expect(ok.status).toBe(200);
    expect(mockSubmitConsult.mock.lastCall[0].diagnosisCodes).toEqual([
      { code: '1F40.Z', title: 'Malaria due to Plasmodium falciparum, unspecified' },
      { code: 'BA00', title: 'Essential hypertension' },
    ]);
  });

  it('searches the ICD-11 list', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockDoctorDepartments.mockResolvedValue(['dept-1']);
    const res = await withCookie(request(buildApp()).get('/doctor/icd11?q=cholera'));
    expect(res.body.results[0]).toEqual({ code: '1A00', title: 'Cholera' });
    expect(res.body.release).toBe('2025-01');
  });
});

describe('structured prescriptions', () => {
  const send = (body: object) => withCookie(request(buildApp()).post('/doctor/encounters/enc-1/consult').send(body));
  beforeEach(() => {
    mockLoadSession.mockResolvedValue(DOCTOR_SESSION);
    mockDoctorDepartments.mockResolvedValue(['dept-1']);
    mockSubmitConsult.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT', notifiable: [] });
  });

  it('takes the medicine name from DHA\'s list, never from the browser', async () => {
    const res = await send({ diagnosisCodes: ['1E32'], prescriptionItems: [{ ...RX[0], drugName: 'Something else' }], pin: '1' });
    expect(res.status).toBe(200);
    expect(mockSubmitConsult.mock.lastCall[0].prescriptionItems[0]).toMatchObject({
      productCode: 'GE10177',
      drugName: 'Paracetamol 500 mg Oral Tablet',
      doseValue: 2,
      doseUnit: 'UM10415',
      route: 'RT10025',
      frequency: 'TDS',
      durationDays: 3,
    });
  });

  it('refuses unknown medicine codes, units, routes and instructions', async () => {
    const bad = async (patch: object) => (await send({ diagnosisCodes: ['1E32'], prescriptionItems: [{ ...RX[0], ...patch }], pin: '1' })).status;
    expect(await bad({ productCode: 'GE99999' })).toBe(400);
    expect(await bad({ doseUnit: 'UM99999' })).toBe(400);
    expect(await bad({ route: 'RT10004' })).toBe(400); // haemodialysis: not offered
    expect(await bad({ instructionCodes: ['MADE-UP'] })).toBe(400);
    expect(await bad({ doseValue: 0 })).toBe(400);
    expect(await bad({ productCode: null, drugName: '' })).toBe(400);
    expect(mockSubmitConsult).not.toHaveBeenCalled();
  });

  it('accepts a medicine not on the list by name', async () => {
    const res = await send({ diagnosisCodes: ['1E32'], prescriptionItems: [{ ...RX[0], productCode: null, drugName: 'Local herbal syrup' }], pin: '1' });
    expect(res.status).toBe(200);
    expect(mockSubmitConsult.mock.lastCall[0].prescriptionItems[0]).toMatchObject({ productCode: null, drugName: 'Local herbal syrup' });
  });

  it('an allergy clash without a reason is refused with the clashes listed (409)', async () => {
    mockSubmitConsult.mockRejectedValueOnce(
      new AllergyOverrideRequiredError([{ index: 0, drugName: 'Amoxicillin', allergyId: 'al-1', allergySubstance: 'Penicillin', reason: 'same group' }]),
    );
    const res = await send({ diagnosisCodes: ['1E32'], prescriptionItems: RX, pin: '1' });
    expect(res.status).toBe(409);
    expect(res.body.allergyConflicts[0]).toMatchObject({ index: 0, allergySubstance: 'Penicillin' });
  });

  it('searches DHA\'s medicines list and offers DHA codes for routes, units and instructions', async () => {
    const m = await withCookie(request(buildApp()).get('/doctor/medicines?q=paracetamol 500'));
    expect(m.body.results[0]).toMatchObject({ code: 'GE10177', name: 'Paracetamol 500 mg Oral Tablet', suggestedRoute: 'RT10025', suggestedDoseUnit: 'UM10415' });
    const o = await withCookie(request(buildApp()).get('/doctor/prescription-options'));
    expect(o.body.routes).toContainEqual({ code: 'RT10025', name: 'Oral' });
    expect(o.body.instructions).toHaveLength(25);
    expect(o.body.frequencies.map((f: { code: string }) => f.code)).toEqual(['OD', 'BD', 'TDS', 'QID', 'NOCTE', 'PRN', 'STAT', 'WEEKLY']);
  });
});
