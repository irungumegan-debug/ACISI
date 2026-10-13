import ExcelJS from 'exceljs';

const store = new Map<string, string>();
jest.mock('../../src/config/redis', () => ({
  redis: {
    set: jest.fn(async (k: string, v: string) => store.set(k, v)),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => store.delete(k)),
  },
}));
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    patient: { findMany: jest.fn(), findFirst: jest.fn() },
    clinic: { findUnique: jest.fn() },
    clinicPatient: { count: jest.fn(), findMany: jest.fn() },
  },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({ registerPatient: jest.fn() }));
jest.mock('../../src/services/clinicPatientService', () => ({
  ...jest.requireActual('../../src/services/clinicPatientService'),
  ensureClinicLink: jest.fn(),
  sendRegistrationSms: jest.fn(),
}));
jest.mock('../../src/services/smsSender', () => ({ sendSms: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { registerPatient } from '../../src/services/patientService';
import { ensureClinicLink, sendRegistrationSms } from '../../src/services/clinicPatientService';
import { sendSms } from '../../src/services/smsSender';
import {
  confirmImport,
  normaliseImportDate,
  normaliseImportSex,
  parseCsv,
  previewImport,
  sendPendingInvitations,
  tableToRows,
} from '../../src/services/patientImportService';

const db = prisma as unknown as {
  patient: { findMany: jest.Mock; findFirst: jest.Mock };
  clinic: { findUnique: jest.Mock };
  clinicPatient: { count: jest.Mock; findMany: jest.Mock };
};

const csv = (text: string) => ({ buffer: Buffer.from(text, 'utf8'), originalname: 'patients.csv' });

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  db.patient.findMany.mockResolvedValue([]);
  db.patient.findFirst.mockResolvedValue(null);
});

describe('parsing', () => {
  it('parses quoted CSV fields with commas and doubled quotes', () => {
    expect(parseCsv('Name,Phone\n"Kamau, Brian","07""12"\n\n')).toEqual([
      ['Name', 'Phone'],
      ['Kamau, Brian', '07"12'],
    ]);
  });

  it('finds columns by common headings and joins first/last name columns', () => {
    const rows = tableToRows([
      ['First name', 'Surname', 'Mobile', 'DOB', 'Gender'],
      ['Jane', 'Wanjiru', '0712345678', '15/03/1990', 'F'],
    ]);
    expect(rows).toEqual([{ rowNumber: 2, fullName: 'Jane Wanjiru', phone: '0712345678', dateOfBirth: '15/03/1990', sex: 'F' }]);
  });

  it('says which columns are missing', () => {
    expect(() => tableToRows([['Name', 'Phone']])).toThrow(/date of birth, sex/);
  });

  it.each([
    ['15/03/1990', '1990-03-15'],
    ['5/3/1990', '1990-03-05'],
    ['15-03-1990', '1990-03-15'],
    ['1990-03-15', '1990-03-15'],
    ['31/02/1990', null],
    ['03/15/1990', null],
    ['', null],
  ])('reads date %s as %s (day first)', (raw, expected) => {
    expect(normaliseImportDate(raw)).toBe(expected);
  });

  it.each([
    ['M', 'MALE'],
    ['female', 'FEMALE'],
    ['Other', 'OTHER'],
    ['x', null],
  ])('reads sex %s', (raw, expected) => {
    expect(normaliseImportSex(raw)).toBe(expected);
  });

  it('reads an Excel file, including real date cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Patients');
    ws.addRow(['Name', 'Phone', 'Date of birth', 'Sex']);
    ws.addRow(['Jane Wanjiru', '0712345678', new Date(Date.UTC(1990, 2, 15)), 'Female']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = await previewImport({ buffer, originalname: 'list.xlsx' }, 'clinic-A');
    expect(preview.rows[0]).toMatchObject({ fullName: 'Jane Wanjiru', dateOfBirth: '1990-03-15', sex: 'FEMALE', status: 'new' });
  });
});

describe('previewImport', () => {
  it('shows errors, duplicates in the file, existing ACISI patients and this clinic’s own patients — writing nothing', async () => {
    db.patient.findMany.mockResolvedValue([
      {
        id: 'p-existing',
        firstName: 'Mary',
        lastName: 'Achieng',
        phoneNumber: '+254722000000',
        dateOfBirth: new Date('1985-01-20T00:00:00Z'),
        clinicLinks: [],
        checkIns: [],
      },
      {
        id: 'p-mine',
        firstName: 'Peter',
        lastName: 'Otieno',
        phoneNumber: '+254733000000',
        dateOfBirth: new Date('1970-07-07T00:00:00Z'),
        clinicLinks: [{ id: 'l' }],
        checkIns: [],
      },
    ]);
    const preview = await previewImport(
      csv(
        [
          'Name,Phone,Date of birth,Sex',
          'Jane Wanjiru,0712345678,15/03/1990,F',
          'Jane Wanjiru,0712 345 678,15/03/1990,F',
          'Mary Achieng,0722000000,20/01/1985,F',
          'Peter Otieno,0733000000,07/07/1970,M',
          'Bad,123,31/02/1990,Q',
          'Child Achieng,0722000000,01/02/2016,M',
        ].join('\n'),
      ),
      'clinic-A',
    );
    expect(preview.rows.map((r) => r.status)).toEqual(['new', 'duplicate_in_file', 'existing', 'already_linked', 'error', 'new']);
    expect(preview.rows[4]?.message).toMatch(/first and last name.*not a valid Kenyan number.*not a real date.*Male, Female or Other/);
    expect(preview.rows[5]?.message).toMatch(/Shares this phone with 1 other patient/);
    expect(preview.counts).toEqual({ new: 2, existing: 1, already_linked: 1, duplicate_in_file: 1, error: 1 });
    expect(registerPatient).not.toHaveBeenCalled();
    expect(ensureClinicLink).not.toHaveBeenCalled();
  });

  it('refuses other file types', async () => {
    await expect(previewImport({ buffer: Buffer.from('x'), originalname: 'list.pdf' }, 'clinic-A')).rejects.toMatchObject({ status: 400 });
  });
});

describe('confirmImport', () => {
  async function preview() {
    db.patient.findMany.mockResolvedValue([
      { id: 'p-existing', firstName: 'Mary', lastName: 'Achieng', phoneNumber: '+254722000000', dateOfBirth: null, clinicLinks: [], checkIns: [] },
    ]);
    return previewImport(csv('Name,Phone,Date of birth,Sex\nJane Wanjiru,0712345678,15/03/1990,F\nMary Achieng,0722000000,20/01/1985,F\nBad,1,x,y'), 'clinic-A');
  }

  it('creates new patients and links existing ones, sending NO SMS', async () => {
    const { importId } = await preview();
    const res = await confirmImport(importId, 'clinic-A', 'admin-1', { clinicConfirmsBasis: true });
    expect(res).toEqual({ created: 1, linked: 1 });
    expect(registerPatient).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Jane', lastName: 'Wanjiru', clinicLink: { clinicId: 'clinic-A', source: 'IMPORTED', addedByStaffId: 'admin-1' } }),
    );
    expect(ensureClinicLink).toHaveBeenCalledWith('clinic-A', 'p-existing', 'IMPORTED', 'admin-1');
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendRegistrationSms).not.toHaveBeenCalled();
  });

  it('can only be used once, and only by the clinic that made the preview', async () => {
    const { importId } = await preview();
    await expect(confirmImport(importId, 'clinic-B', 'admin-2', { clinicConfirmsBasis: true })).rejects.toMatchObject({ status: 404 });
    await confirmImport(importId, 'clinic-A', 'admin-1', { clinicConfirmsBasis: true });
    await expect(confirmImport(importId, 'clinic-A', 'admin-1', { clinicConfirmsBasis: true })).rejects.toMatchObject({ status: 404 });
  });

  it('requires the clinic to confirm these are its own patients', async () => {
    const { importId } = await preview();
    await expect(confirmImport(importId, 'clinic-A', 'admin-1', { clinicConfirmsBasis: false })).rejects.toMatchObject({ status: 400 });
    expect(registerPatient).not.toHaveBeenCalled();
  });
});

describe('sendPendingInvitations', () => {
  it('sends one registration SMS per pending imported patient, in batches', async () => {
    db.clinic.findUnique.mockResolvedValue({ id: 'clinic-A', name: 'Sunrise' });
    db.clinicPatient.findMany.mockResolvedValue([
      { id: 'l1', patient: { id: 'p1', phoneNumber: '+254700000001', smsOptOut: false } },
      { id: 'l2', patient: { id: 'p2', phoneNumber: '+254700000002', smsOptOut: false } },
    ]);
    db.clinicPatient.count.mockResolvedValue(0);
    (sendRegistrationSms as jest.Mock).mockResolvedValueOnce('sent').mockResolvedValueOnce('failed');
    const res = await sendPendingInvitations('clinic-A', 'admin-1');
    expect(sendRegistrationSms).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ sent: 1, failed: 1, remaining: 0, cursor: 'l2', done: true });
    expect(db.clinicPatient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clinicId: 'clinic-A', source: 'IMPORTED', invitedAt: null, patient: { deletedAt: null, smsOptOut: false } }),
      }),
    );
  });
});
