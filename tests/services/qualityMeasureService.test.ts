/** Quality measures: numerator/denominator per measure, medians, n/a with no eligible visits, CSV. */
const encounters: unknown[] = [];
jest.mock('../../src/db/prisma', () => ({ prisma: { encounter: { findMany: jest.fn(async () => encounters) } } }));

import { buildQualityMeasures, qualityMeasuresCsv } from '../../src/services/qualityMeasureService';
import { parsePeriod } from '../../src/services/routineReportService';

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 5, h, m));
const visit = (o: { codes?: string[]; vitals?: object[]; tests?: string[]; dob?: string; consulted?: Date | null; lab?: [Date, Date] }) => ({
  id: Math.random().toString(),
  createdAt: t(8),
  consultedAt: o.consulted === undefined ? t(8, 30) : o.consulted,
  diagnosisCodes: JSON.stringify((o.codes ?? []).map((code) => ({ code, title: code }))),
  patient: { dateOfBirth: o.dob ? new Date(o.dob) : new Date('1980-01-01') },
  vitalSigns: o.vitals ?? [],
  labOrders: o.tests ? [{ requestedAt: o.lab?.[0] ?? t(8, 10), completedAt: o.lab?.[1] ?? t(8, 50), status: 'RESULTS_READY', items: o.tests.map((testName) => ({ testName })) }] : [],
  prescriptionItems: [],
});

beforeEach(() => (encounters.length = 0));
const p = parsePeriod('MONTH', '2026-10');
const byId = async () => Object.fromEntries((await buildQualityMeasures('c1', p)).measures.map((m) => [m.id, m]));

it('hypertension BP, malaria test-before-treat, MUAC in children, coded diagnoses', async () => {
  encounters.push(
    visit({ codes: ['BA00'], vitals: [{ systolic: 150, diastolic: 95, muacCm: null }] }),
    visit({ codes: ['BA00'] }),
    visit({ codes: ['1F40'], tests: ['Malaria RDT'] }),
    visit({ codes: ['1F40'] }),
    visit({ codes: ['CA40'], dob: '2025-01-01', vitals: [{ systolic: null, diastolic: null, muacCm: 13 }] }),
    visit({ codes: [] }),
    visit({ codes: ['BA00'], consulted: null }), // not signed: not counted
  );
  const m = await byId();
  expect(m['htn-bp']).toMatchObject({ numerator: 1, denominator: 2, value: 50 });
  expect(m['malaria-tested']).toMatchObject({ numerator: 1, denominator: 2, value: 50 });
  expect(m['child-muac']).toMatchObject({ numerator: 1, denominator: 1, value: 100 });
  expect(m['coded-diagnosis']).toMatchObject({ numerator: 5, denominator: 6 });
  expect(m['diabetes-glucose']).toMatchObject({ denominator: 0, value: null });
});

it('median waiting time and lab turnaround, in minutes', async () => {
  encounters.push(visit({ consulted: t(8, 20) }), visit({ consulted: t(8, 40), tests: ['Hb'], lab: [t(8, 10), t(9, 10)] }), visit({ consulted: t(9, 0) }));
  const m = await byId();
  expect(m['wait-time']).toMatchObject({ value: 40, denominator: 3 });
  expect(m['lab-turnaround']).toMatchObject({ value: 60, denominator: 1 });
});

it('CSV with one row per measure, n/a when nothing to measure', async () => {
  const csv = qualityMeasuresCsv('Sunrise', await buildQualityMeasures('c1', p));
  expect(csv).toContain('Measure,Numerator,Denominator,Value,Unit,Definition');
  expect(csv).toMatch(/Hypertension visits with BP measured,0,0,n\/a,%/);
});
