jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    staff: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/realtimeEvents', () => ({ publishQueueChanged: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { publishQueueChanged } from '../../src/services/realtimeEvents';
import { changeDoctor, listDoctorOptions } from '../../src/services/doctorReassignmentService';

const p = prisma as unknown as {
  encounter: { findFirst: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
  staff: { findMany: jest.Mock; findFirst: jest.Mock };
};

const TODAY = new Date();
const LATER_TODAY = new Date(TODAY.getTime() + 1000);
const YESTERDAY = new Date(Date.now() - 36 * 60 * 60 * 1000);
const doctor = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  departments: [{ departmentId: 'dept-general' }],
  lastLoginAt: TODAY,
  presenceOverride: null,
  presenceOverrideAt: null,
  ...overrides,
});
const WAITING_VISIT = { id: 'enc-1', status: 'WAITING', assignedDoctorId: 'doc-a', checkIn: { departmentId: 'dept-general' } };
const input = { checkInId: 'ci-1', clinicId: 'clinic-A', doctorId: 'doc-b', staffId: 'staff-1' };

beforeEach(() => {
  jest.clearAllMocks();
  p.encounter.findFirst.mockResolvedValue(WAITING_VISIT);
  p.encounter.updateMany.mockResolvedValue({ count: 1 });
});

describe('listDoctorOptions', () => {
  it("lists only the department's doctors who are in today, with how busy they are", async () => {
    p.staff.findMany.mockResolvedValue([
      doctor('doc-a', 'Dr. Andrew'),
      doctor('doc-b', 'Dr. Lisa'),
      doctor('doc-c', 'Dr. Away', { lastLoginAt: YESTERDAY }),
      doctor('doc-d', 'Dr. Out', { presenceOverride: 'OUT', presenceOverrideAt: LATER_TODAY }),
    ]);
    p.encounter.findMany.mockResolvedValue([
      { assignedDoctorId: 'doc-a', status: 'WAITING' },
      { assignedDoctorId: 'doc-a', status: 'WAITING' },
      { assignedDoctorId: 'doc-b', status: 'IN_CONSULTATION' },
    ]);

    const res = await listDoctorOptions('ci-1', 'clinic-A');

    expect(p.staff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: 'clinic-A', role: 'DOCTOR', isActive: true, departments: { some: { departmentId: 'dept-general' } } } }),
    );
    expect(res).toEqual({
      currentDoctorId: 'doc-a',
      doctors: [
        { id: 'doc-a', name: 'Dr. Andrew', waitingCount: 2, inConsultation: false },
        { id: 'doc-b', name: 'Dr. Lisa', waitingCount: 0, inConsultation: true },
      ],
    });
  });

  it('refuses a patient who is no longer waiting, and an unknown or other-clinic visit', async () => {
    p.encounter.findFirst.mockResolvedValueOnce({ ...WAITING_VISIT, status: 'IN_CONSULTATION' });
    await expect(listDoctorOptions('ci-1', 'clinic-A')).rejects.toMatchObject({ status: 409 });
    p.encounter.findFirst.mockResolvedValueOnce(null);
    await expect(listDoctorOptions('ci-1', 'clinic-B')).rejects.toMatchObject({ status: 404 });
    expect(p.encounter.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { checkInId: 'ci-1', clinicId: 'clinic-B' } }));
  });
});

describe('changeDoctor', () => {
  it('moves a waiting patient to another doctor who is in, audits it and refreshes queues', async () => {
    p.staff.findFirst.mockResolvedValue(doctor('doc-b', 'Dr. Lisa'));

    await expect(changeDoctor(input)).resolves.toEqual({ changed: true, doctorName: 'Dr. Lisa' });

    expect(p.staff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-b', clinicId: 'clinic-A', role: 'DOCTOR', isActive: true } }),
    );
    expect(p.encounter.updateMany).toHaveBeenCalledWith({ where: { id: 'enc-1', status: 'WAITING' }, data: { assignedDoctorId: 'doc-b' } });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ENCOUNTER_DOCTOR_CHANGED', entityId: 'enc-1', metadata: { fromDoctorId: 'doc-a', toDoctorId: 'doc-b' } }),
    );
    expect(publishQueueChanged).toHaveBeenCalledWith({ checkInId: 'ci-1', clinicId: 'clinic-A' });
  });

  it('does nothing when the patient is already with that doctor', async () => {
    p.staff.findFirst.mockResolvedValue(doctor('doc-a', 'Dr. Andrew'));
    await expect(changeDoctor({ ...input, doctorId: 'doc-a' })).resolves.toEqual({ changed: false, doctorName: 'Dr. Andrew' });
    expect(p.encounter.updateMany).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a doctor who doesn't work in the patient's department, or isn't at this clinic", async () => {
    p.staff.findFirst.mockResolvedValueOnce(doctor('doc-b', 'Dr. Lisa', { departments: [{ departmentId: 'dept-dental' }] }));
    await expect(changeDoctor(input)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('department') });
    p.staff.findFirst.mockResolvedValueOnce(null);
    await expect(changeDoctor(input)).rejects.toMatchObject({ status: 409 });
    expect(p.encounter.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['not logged in today', { lastLoginAt: YESTERDAY }],
    ['marked out today', { presenceOverride: 'OUT', presenceOverrideAt: LATER_TODAY }],
  ])('refuses a doctor who is %s', async (_label, overrides) => {
    p.staff.findFirst.mockResolvedValue(doctor('doc-b', 'Dr. Lisa', overrides));
    await expect(changeDoctor(input)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('not marked in today') });
    expect(p.encounter.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the patient has gone in to see a doctor', async () => {
    p.encounter.findFirst.mockResolvedValue({ ...WAITING_VISIT, status: 'IN_CONSULTATION' });
    await expect(changeDoctor(input)).rejects.toMatchObject({ status: 409 });
    expect(p.encounter.updateMany).not.toHaveBeenCalled();
  });

  it('refuses without changing anything if the doctor opened the patient a moment before', async () => {
    p.staff.findFirst.mockResolvedValue(doctor('doc-b', 'Dr. Lisa'));
    p.encounter.updateMany.mockResolvedValue({ count: 0 });
    await expect(changeDoctor(input)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('just gone in') });
    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(publishQueueChanged).not.toHaveBeenCalled();
  });
});

describe('doctors in several departments', () => {
  it('can take a patient from any of their departments', async () => {
    p.staff.findFirst.mockResolvedValue(doctor('doc-b', 'Dr. Lisa', { departments: [{ departmentId: 'dept-braces' }, { departmentId: 'dept-general' }] }));
    await expect(changeDoctor(input)).resolves.toEqual({ changed: true, doctorName: 'Dr. Lisa' });
  });
});
