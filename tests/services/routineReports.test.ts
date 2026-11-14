import { readFileSync } from 'fs';
import path from 'path';

jest.mock('../../src/db/prisma', () => ({
  prisma: {
    clinic: { findUnique: jest.fn(async () => ({ name: 'Sunrise, "Main"', county: 'Nairobi' })) },
    encounter: { findMany: jest.fn() },
    notifiableDiseaseCase: { findMany: jest.fn(async () => [{ diseaseName: 'Cholera', reporting: 'IMMEDIATE' }, { diseaseName: 'Malaria', reporting: 'WEEKLY' }]) },
    publicHealthEvent: {
      findMany: jest.fn(async () => [{ type: 'AEFI', casesCount: 2, casesUnder5: 2, deathsCount: 0, deathsUnder5: 0 }]),
    },
  },
}));

import { prisma } from '../../src/db/prisma';
import { buildRoutineReport, codeMatches, InvalidPeriodError, lastFullMonth, MONTHLY_DISEASES, parsePeriod, routineReportCsv } from '../../src/services/routineReportService';

const findMany = (prisma as unknown as { encounter: { findMany: jest.Mock } }).encounter.findMany;

describe('periods (Kenya time)', () => {
  it('a month runs from the 1st 00:00 EAT to the next 1st', () => {
    const p = parsePeriod('MONTH', '2026-11');
    expect(p).toMatchObject({ label: 'November 2026', startDate: '2026-11-01', endDate: '2026-12-01' });
    expect(p.from.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-11-30T21:00:00.000Z');
  });

  it('quarters and years, December rolls over', () => {
    expect(parsePeriod('QUARTER', '2026-Q4')).toMatchObject({ startDate: '2026-10-01', endDate: '2027-01-01', label: 'Q4 2026 (October–December)' });
    expect(parsePeriod('YEAR', '2026')).toMatchObject({ startDate: '2026-01-01', endDate: '2027-01-01' });
    expect(parsePeriod('MONTH', '2026-12').endDate).toBe('2027-01-01');
  });

  it('refuses anything else', () => {
    for (const [p, v] of [['MONTH', '2026-13'], ['MONTH', '2026-1'], ['QUARTER', '2026-Q5'], ['YEAR', '1999'], ['WEEK', '2026-11'], ['MONTH', '']])
      expect(() => parsePeriod(p!, v!)).toThrow(InvalidPeriodError);
  });

  it('last full month, Kenya time', () => {
    expect(lastFullMonth(new Date('2026-11-14T10:00:00Z'))).toBe('2026-10');
    expect(lastFullMonth(new Date('2026-11-30T21:30:00Z'))).toBe('2026-11'); // 1 Dec 00:30 EAT
    expect(lastFullMonth(new Date('2026-01-05T10:00:00Z'))).toBe('2025-12');
  });
});

describe('IDSR monthly disease list', () => {
  const who = JSON.parse(readFileSync(path.join(__dirname, '../../src/assets/icd11/icd11-mms-2025-01.json'), 'utf8')) as { codes: { c: string; t: string }[] };
  const codes = new Set(who.codes.map((c) => c.c));

  it('every code is a real ICD-11 MMS 2025-01 code, and each matches at least one code', () => {
    for (const d of MONTHLY_DISEASES)
      for (const stem of [...d.icd11, ...(d.alsoNeeds ?? [])]) {
        expect([d.id, stem, codes.has(stem)]).toEqual([d.id, stem, true]);
      }
  });

  it('latent TB is not tuberculosis; subcodes match their parent', () => {
    expect(MONTHLY_DISEASES.find((d) => d.id === 'tuberculosis')!.icd11.some((s) => codeMatches('1B14', s))).toBe(false);
    expect(codeMatches('1F40.0', '1F40')).toBe(true);
    expect(codeMatches('1F400', '1F40')).toBe(false);
    expect(codeMatches('1F66.30', '1F66.3')).toBe(true);
  });

  it('only the road traffic injuries row is counted by hand', () => {
    expect(MONTHLY_DISEASES.filter((d) => d.icd11.length === 0).map((d) => d.id)).toEqual(['rta-injuries']);
  });
});

const enc = (o: { id: string; patientId: string; codes?: string[]; dob?: string | null; sex?: string; at?: string; source?: string; status?: string }) => ({
  id: o.id,
  patientId: o.patientId,
  status: o.status ?? 'DONE',
  createdAt: new Date(o.at ?? '2026-11-10T08:00:00Z'),
  consultedAt: new Date(o.at ?? '2026-11-10T09:00:00Z'),
  diagnosisCodes: o.codes ? JSON.stringify(o.codes.map((c) => ({ code: c, title: `Title ${c}` }))) : null,
  prescription: o.codes ? 'Rx' : null,
  patient: { dateOfBirth: o.dob === undefined ? new Date('1980-01-01') : o.dob === null ? null : new Date(o.dob), sex: o.sex ?? 'FEMALE' },
  checkIn: { source: o.source ?? 'WALK_IN', department: { name: 'General' } },
  labOrders: [],
  prescriptionItems: o.codes ? [{ drugName: 'Paracetamol' }] : [],
});

describe('building the report (stubbed database)', () => {
  it('counts visits, people once, new cases once, the under-5 rules and combined codes', async () => {
    findMany
      .mockResolvedValueOnce([
        enc({ id: 'e1', patientId: 'p1', codes: ['BA00'] }), // hypertension, new
        enc({ id: 'e2', patientId: 'p1', codes: ['BA00'], at: '2026-11-20T08:00:00Z', source: 'USSD' }), // same patient again: not new twice
        enc({ id: 'e3', patientId: 'p2', codes: ['BA00'] }), // had hypertension before this month: not new
        enc({ id: 'e4', patientId: 'p3', codes: ['1A40.0', '5C70.0'], dob: '2024-06-01', sex: 'MALE' }), // diarrhoea + dehydration, under 5
        enc({ id: 'e5', patientId: 'p4', codes: ['1A40.0'], dob: '2024-06-01' }), // diarrhoea without dehydration: not counted
        enc({ id: 'e6', patientId: 'p5', codes: ['CA40.0'], dob: '1990-01-01' }), // adult pneumonia: not in the under-5 row
        enc({ id: 'e7', patientId: 'p6', codes: ['1F40.Z'], dob: null, sex: 'UNKNOWN' }), // malaria, age unknown
        enc({ id: 'e8', patientId: 'p7' }), // signed with text only
      ])
      .mockResolvedValueOnce([{ patientId: 'p2', diagnosisCodes: JSON.stringify([{ code: 'BA00', title: 'Essential hypertension' }]) }]);

    const r = await buildRoutineReport('clinic-1', parsePeriod('MONTH', '2026-11'));
    const row = (id: string) => r.monthlyDiseases.find((d) => d.id === id)!;
    expect(r.visits).toEqual({ total: 8, completed: 8, walkIn: 7, remote: 1 });
    expect(r.patients).toEqual({ seen: 7, newToClinic: 6, returning: 1 });
    expect(row('hypertension-new')).toMatchObject({ total: 1, fiveAndOver: 1 });
    expect(row('diarrhoea-dehydration-u5')).toMatchObject({ total: 1, under5: 1 });
    expect(row('pneumonia-u5').total).toBe(0);
    expect(row('malaria')).toMatchObject({ total: 1, ageUnknown: 1 });
    expect(row('rta-injuries').countedByAcisi).toBe(false);
    expect(r.visitsWithoutCodes).toBe(1);
    expect(r.topDiagnoses[0]).toEqual({ code: 'BA00', title: 'Title BA00', count: 3 });
    expect(r.bySex).toEqual(expect.arrayContaining([{ label: 'Male', count: 1 }, { label: 'Not recorded', count: 1 }]));
    expect(r.byAge).toEqual(expect.arrayContaining([{ label: 'Under 5', count: 2 }, { label: 'Not recorded', count: 1 }]));
    expect(r.notifiable).toEqual({ immediate: 1, weekly: 1, byDisease: [{ label: 'Cholera', count: 1 }, { label: 'Malaria', count: 1 }] });
    expect(r.events).toMatchObject({ total: 1, cases: 2, deaths: 0 });
    expect(r.prescriptions.medicineLines).toBe(7);
    // Earlier visits are looked up for this month's patients only, before the period start.
    expect(findMany.mock.calls[1][0].where).toMatchObject({ clinicId: 'clinic-1', createdAt: { lt: new Date('2026-10-31T21:00:00Z') } });

    const csv = routineReportCsv(r);
    expect(csv).toContain('Clinic,"Sunrise, ""Main"""');
    expect(csv).toContain('Hypertension (New cases),0,1,0,1,');
    expect(csv).toContain('Injuries (Road Traffic Accidents),count by hand');
    expect(csv).not.toMatch(/Test Patient|p1|e1/);
  });

  it('an empty month is all zeros, without querying earlier visits', async () => {
    findMany.mockReset().mockResolvedValueOnce([]);
    const r = await buildRoutineReport('clinic-1', parsePeriod('MONTH', '2026-10'));
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(r.visits.total).toBe(0);
    expect(r.monthlyDiseases.every((d) => d.total === 0)).toBe(true);
  });
});
