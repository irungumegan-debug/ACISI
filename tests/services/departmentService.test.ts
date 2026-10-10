jest.mock('../../src/db/prisma', () => {
  const prisma = {
    department: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), delete: jest.fn() },
    staff: { findFirst: jest.fn(), update: jest.fn() },
    staffDepartment: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import {
  createDepartment,
  deleteDepartment,
  findActiveDepartment,
  listActiveDepartments,
  prepareDepartmentList,
  setDoctorDepartments,
  suggestDepartmentCode,
  updateDepartment,
} from '../../src/services/departmentService';

const p = prisma as unknown as {
  department: Record<string, jest.Mock>;
  staff: Record<string, jest.Mock>;
  staffDepartment: Record<string, jest.Mock>;
};
const base = { clinicId: 'clinic-A', staffId: 'admin-1' };

beforeEach(() => {
  jest.clearAllMocks();
  p.staffDepartment.findMany!.mockResolvedValue([]);
});

describe('suggestDepartmentCode', () => {
  it.each([
    ['General', 'GEN'],
    ['Braces', 'BRA'],
    ['Invisalign', 'INV'],
    ['Oral Surgery', 'OS'],
    ['General Dentistry', 'GD'],
    ['Orthodontics / Braces', 'OB'],
    ['Eye Clinic', 'EC'],
    ['X', 'XDE'],
  ])('%s -> %s', (name, code) => {
    expect(suggestDepartmentCode(name)).toBe(code);
  });

  it('numbers a code that is already taken', () => {
    expect(suggestDepartmentCode('General', ['GEN'])).toBe('GEN2');
    expect(suggestDepartmentCode('Generalist', ['GEN', 'GEN2'])).toBe('GEN3');
  });
});

describe('prepareDepartmentList (registration)', () => {
  it('cleans names, fills in codes and keeps fees', () => {
    expect(prepareDepartmentList([{ name: '  General ' }, { name: 'Braces', code: 'brc', consultationFeeKes: 2000 }, { name: 'Invisalign' }])).toEqual([
      { name: 'General', nameKey: 'general', code: 'GEN', consultationFeeKes: null },
      { name: 'Braces', nameKey: 'braces', code: 'BRC', consultationFeeKes: 2000 },
      { name: 'Invisalign', nameKey: 'invisalign', code: 'INV', consultationFeeKes: null },
    ]);
  });

  it('never suggests a code the admin typed for another department', () => {
    const list = prepareDepartmentList([{ name: 'General' }, { name: 'Gynecology', code: 'GEN' }]);
    expect(list.map((d) => d.code)).toEqual(['GEN2', 'GEN']);
  });

  it('requires at least one department', () => {
    expect(() => prepareDepartmentList([])).toThrow('at least one department');
  });

  it('rejects duplicate names, ignoring case and extra spaces', () => {
    expect(() => prepareDepartmentList([{ name: 'Braces' }, { name: ' BRACES ' }])).toThrow('listed twice');
    expect(() => prepareDepartmentList([{ name: 'Oral  Surgery' }, { name: 'oral surgery' }])).toThrow('listed twice');
  });

  it('rejects duplicate and badly formed codes, bad names and bad fees', () => {
    expect(() => prepareDepartmentList([{ name: 'A1', code: 'XY' }, { name: 'B1', code: 'xy' }])).toThrow('used twice');
    expect(() => prepareDepartmentList([{ name: 'General', code: 'TOOLONG1' }])).toThrow('2–6 capital letters');
    expect(() => prepareDepartmentList([{ name: 'G' }])).toThrow('at least 2 characters');
    expect(() => prepareDepartmentList([{ name: 'General', consultationFeeKes: 99.5 }])).toThrow('whole number');
  });
});

describe('active departments for check-in', () => {
  it('only lists and accepts active departments of that clinic', async () => {
    p.department.findMany!.mockResolvedValue([]);
    await listActiveDepartments('clinic-A');
    expect(p.department.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clinicId: 'clinic-A', isActive: true } }));
    p.department.findFirst!.mockResolvedValue(null);
    await expect(findActiveDepartment('dept-old', 'clinic-A')).resolves.toBeNull();
    expect(p.department.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'dept-old', clinicId: 'clinic-A', isActive: true } }));
  });
});

describe('createDepartment', () => {
  beforeEach(() => {
    p.department.findMany!.mockResolvedValue([{ nameKey: 'general', code: 'GEN' }]);
    p.department.create!.mockImplementation(async ({ data }) => ({ id: 'dept-new', ...data }));
  });

  it('adds a department with a suggested code and audits it', async () => {
    const created = await createDepartment({ ...base, name: 'Braces', consultationFeeKes: 2000 });
    expect(created).toEqual({ id: 'dept-new', name: 'Braces', code: 'BRA', consultationFeeKes: 2000 });
    expect(p.department.create).toHaveBeenCalledWith({
      data: { clinicId: 'clinic-A', name: 'Braces', nameKey: 'braces', code: 'BRA', consultationFeeKes: 2000 },
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPARTMENT_CREATED' }));
  });

  it('rejects a name that already exists, whatever the case', async () => {
    await expect(createDepartment({ ...base, name: 'GENERAL' })).rejects.toMatchObject({ status: 409 });
    expect(p.department.create).not.toHaveBeenCalled();
  });

  it('rejects a code that already exists', async () => {
    await expect(createDepartment({ ...base, name: 'Gentle Care', code: 'gen' })).rejects.toMatchObject({ status: 409 });
  });

  it('turns a database clash (two admins at once) into a 409', async () => {
    p.department.create!.mockRejectedValue({ code: 'P2002' });
    await expect(createDepartment({ ...base, name: 'Braces' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('updateDepartment', () => {
  const braces = { id: 'dept-brc', clinicId: 'clinic-A', name: 'Braces', nameKey: 'braces', code: 'BRA', consultationFeeKes: null, isActive: true };
  beforeEach(() => {
    p.department.findFirst!.mockResolvedValueOnce(braces);
    p.department.update!.mockImplementation(async ({ data }) => ({ ...braces, ...data }));
  });

  it('renames, recodes and sets a fee', async () => {
    p.department.findFirst!.mockResolvedValue(null); // no clashes
    const res = await updateDepartment({ ...base, departmentId: 'dept-brc', patch: { name: 'Orthodontics (Braces)', code: 'brc', consultationFeeKes: 2500 } });
    expect(res).toMatchObject({ name: 'Orthodontics (Braces)', code: 'BRC', consultationFeeKes: 2500 });
  });

  it('rejects renaming to another department’s name', async () => {
    p.department.findFirst!.mockResolvedValueOnce({ id: 'dept-gen', name: 'General' });
    await expect(updateDepartment({ ...base, departmentId: 'dept-brc', patch: { name: 'general' } })).rejects.toMatchObject({ status: 409 });
    expect(p.department.update).not.toHaveBeenCalled();
  });

  it('deactivates — which hides it from check-in — while keeping the row and its history', async () => {
    p.department.count!.mockResolvedValue(2);
    const res = await updateDepartment({ ...base, departmentId: 'dept-brc', patch: { isActive: false } });
    expect(res.isActive).toBe(false);
    expect(p.department.update).toHaveBeenCalledWith({ where: { id: 'dept-brc' }, data: { isActive: false } });
    expect(p.department.delete).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPARTMENT_DEACTIVATED' }));
  });

  it('refuses to deactivate the last active department', async () => {
    p.department.count!.mockResolvedValue(0);
    await expect(updateDepartment({ ...base, departmentId: 'dept-brc', patch: { isActive: false } })).rejects.toMatchObject({ status: 409 });
    expect(p.department.update).not.toHaveBeenCalled();
  });

  it('refuses another clinic’s department', async () => {
    p.department.findFirst!.mockReset().mockResolvedValue(null);
    await expect(updateDepartment({ ...base, clinicId: 'clinic-B', departmentId: 'dept-brc', patch: { name: 'X1' } })).rejects.toMatchObject({ status: 404 });
  });
});

describe('deleteDepartment', () => {
  const row = (counts: Partial<Record<'checkIns' | 'doctors' | 'appointments' | 'staff', number>>) => ({
    id: 'dept-1',
    name: 'Braces',
    code: 'BRA',
    consultationFeeKes: null,
    isActive: false,
    _count: { checkIns: 0, doctors: 0, appointments: 0, staff: 0, ...counts },
    appointments: [],
  });

  it('deletes a department that was never used', async () => {
    p.department.findMany!.mockResolvedValue([row({})]);
    await deleteDepartment({ ...base, departmentId: 'dept-1' });
    expect(p.department.delete).toHaveBeenCalledWith({ where: { id: 'dept-1' } });
  });

  it.each([['visits', { checkIns: 3 }], ['doctors', { doctors: 1 }], ['appointments', { appointments: 1 }]])(
    'refuses once it has %s, so history stays intact',
    async (_label, counts) => {
      p.department.findMany!.mockResolvedValue([row(counts)]);
      await expect(deleteDepartment({ ...base, departmentId: 'dept-1' })).rejects.toMatchObject({ status: 409 });
      expect(p.department.delete).not.toHaveBeenCalled();
    },
  );
});

describe('setDoctorDepartments', () => {
  beforeEach(() => {
    p.staff.findFirst!.mockResolvedValue({ id: 'doc-1', departmentId: 'dept-gen' });
  });

  it('sets several departments for a doctor', async () => {
    p.department.findMany!.mockResolvedValue([
      { id: 'dept-brc', name: 'Braces' },
      { id: 'dept-gen', name: 'General' },
    ]);
    const res = await setDoctorDepartments({ ...base, doctorId: 'doc-1', departmentIds: ['dept-gen', 'dept-brc'] });
    expect(res).toHaveLength(2);
    expect(p.staffDepartment.deleteMany).toHaveBeenCalledWith({ where: { staffId: 'doc-1', departmentId: { notIn: ['dept-gen', 'dept-brc'] } } });
    expect(p.staffDepartment.createMany).toHaveBeenCalledWith({
      data: [
        { staffId: 'doc-1', departmentId: 'dept-gen' },
        { staffId: 'doc-1', departmentId: 'dept-brc' },
      ],
      skipDuplicates: true,
    });
    expect(p.staff.update).not.toHaveBeenCalled(); // home department still among them
  });

  it('moves the home department when it is removed', async () => {
    p.department.findMany!.mockResolvedValue([{ id: 'dept-brc', name: 'Braces' }]);
    await setDoctorDepartments({ ...base, doctorId: 'doc-1', departmentIds: ['dept-brc'] });
    expect(p.staff.update).toHaveBeenCalledWith({ where: { id: 'doc-1' }, data: { departmentId: 'dept-brc' } });
  });

  it('requires at least one active department from this clinic', async () => {
    await expect(setDoctorDepartments({ ...base, doctorId: 'doc-1', departmentIds: [] })).rejects.toThrow('at least one');
    p.department.findMany!.mockResolvedValue([]); // inactive or another clinic's
    await expect(setDoctorDepartments({ ...base, doctorId: 'doc-1', departmentIds: ['dept-other'] })).rejects.toThrow('active departments');
    expect(p.staffDepartment.createMany).not.toHaveBeenCalled();
  });

  it('only works on doctors at this clinic', async () => {
    p.staff.findFirst!.mockResolvedValue(null);
    await expect(setDoctorDepartments({ ...base, doctorId: 'reception-1', departmentIds: ['dept-gen'] })).rejects.toMatchObject({ status: 404 });
  });
});
