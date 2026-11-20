import { lookupIcd11 } from '../../src/services/icd11Service';
import { matchNotifiable, NOTIFIABLE_DISEASES } from '../../src/services/notifiableDiseases';
import { buildNotifiableAlertSms } from '../../src/services/smsTemplates';
import {
  isWeekStart,
  lastFullWeekStart,
  weekBounds,
  weeklySummaryCsv,
  weekStartOf,
} from '../../src/services/notifiableDiseaseService';

describe('notifiable disease list', () => {
  it('every ICD-11 stem is a real WHO ICD-11 MMS code', () => {
    for (const d of NOTIFIABLE_DISEASES) for (const stem of d.icd11) expect([d.id, stem, lookupIcd11(stem) !== null]).toEqual([d.id, stem, true]);
  });

  it('every ICD-11 code under a stem in the WHO file matches it (no subcode is missed)', () => {
    const all = (jest.requireActual('../../src/assets/icd11/icd11-mms-2025-01.json') as { codes: { c: string }[] }).codes.map((x) => x.c);
    for (const d of NOTIFIABLE_DISEASES)
      for (const stem of d.icd11) {
        const children = all.filter((c) => c !== stem && (c.startsWith(`${stem}.`) || (stem.includes('.') && c.startsWith(stem))));
        for (const c of children) expect([c, matchNotifiable([c]).some((m) => m.disease.id === d.id)]).toEqual([c, true]);
      }
  });

  it('ids are unique', () => {
    expect(new Set(NOTIFIABLE_DISEASES.map((d) => d.id)).size).toBe(NOTIFIABLE_DISEASES.length);
  });

  it('follows Table 5 (3rd edition): immediately reportable diseases', () => {
    const immediate = NOTIFIABLE_DISEASES.filter((d) => d.reporting === 'IMMEDIATE').map((d) => d.id);
    expect(immediate.sort()).toEqual(
      [
        'vhf', 'rvf', 'acute-jaundice', 'aefi', 'anthrax', 'meningococcal-meningitis', 'bacterial-meningitis-other', 'chikungunya', 'cholera',
        'dengue', 'dysentery', 'guinea-worm', 'influenza-new-subtype', 'maternal-death', 'measles', 'mers', 'neonatal-tetanus', 'plague',
        'afp', 'rabies', 'sari', 'sars-covid', 'smallpox', 'typhoid', 'yellow-fever', 'zika', 'pheic',
      ].sort(),
    );
  });

  it('every MOH 505 row (2020 edition) is present', () => {
    const rows = new Set(NOTIFIABLE_DISEASES.map((d) => d.form505Row));
    for (const r of ['AEFI', 'Acute Jaundice', 'Acute Malnutrition', 'AFP (Poliomyelitis)', 'Anthrax', 'Cholera', 'Dengue', 'Dysentery (Bacillary)',
      'Guinea Worm Disease', 'Measles', 'Suspected Malaria', 'Deaths due to Malaria', 'Maternal deaths', 'Meningococcal Meningitis', 'Neonatal deaths',
      'Neonatal Tetanus', 'Plague', 'Rabies', 'Rift Valley Fever', 'SARI (Cluster ≥3 cases)', 'Suspected MDR/XDR TB', 'Typhoid', 'VHF', 'Yellow Fever',
      'Others (specify)']) expect([r, rows.has(r)]).toEqual([r, true]);
  });

  it('matches codes and subcodes, not lookalike codes', () => {
    expect(matchNotifiable(['1A00']).map((m) => m.disease.id)).toEqual(['cholera']);
    expect(matchNotifiable(['1D60.01']).map((m) => m.disease.id)).toEqual(['vhf']); // Ebola virus disease
    expect(matchNotifiable(['1D61.2']).map((m) => m.disease.id)).toEqual(['vhf']); // Lassa
    expect(matchNotifiable(['1D61.0'])).toEqual([]); // Argentinian haemorrhagic fever: not listed
    expect(matchNotifiable(['1B14'])).toEqual([]); // latent TB: not listed
    expect(matchNotifiable(['1A07.Z', 'BA00', '1F4Z']).map((m) => m.disease.id)).toEqual(['malaria', 'typhoid']);
    expect(matchNotifiable(['1A0'])).toEqual([]);
    expect(matchNotifiable(['1C1C.0']).map((m) => m.disease.id)).toEqual(['meningococcal-meningitis']);
    expect(matchNotifiable(['1C1C.2'])).toEqual([]); // meningococcaemia: not "meningococcal meningitis"
    expect(matchNotifiable(['MG52.00']).map((m) => m.disease.id)).toEqual(['tb-mdr-xdr']);
    expect(matchNotifiable(['RA01.0']).map((m) => m.disease.id)).toEqual(['sars-covid']); // "SARS e.g., COVID-19"
    expect(matchNotifiable(['1D01.00']).map((m) => m.disease.id)).toEqual(['bacterial-meningitis-other']); // Hib meningitis
    expect(matchNotifiable(['1D01.1'])).toEqual([]); // fungal meningitis: not bacterial
    expect(matchNotifiable(['1E71'])).toEqual([]); // mpox: not in Table 5 (report it as a public health event if one is declared)
  });

});

describe('alert SMS', () => {
  it('never names the disease or a patient, and fits one SMS', () => {
    const m = buildNotifiableAlertSms({ clinicName: 'A very long clinic name that goes on and on and on, Westlands branch' });
    expect(m.length).toBeLessThanOrEqual(160);
    expect(m).toMatch(/^ACISI: An immediately notifiable disease was diagnosed at /);
    for (const d of NOTIFIABLE_DISEASES) expect(m.toLowerCase()).not.toContain(d.name.toLowerCase());
  });
});

describe('epidemiological week (Monday to Sunday, Nairobi time)', () => {
  it('Sunday 23:30 Nairobi belongs to the week that started on the Monday before', () => {
    expect(weekStartOf(new Date('2026-11-15T20:30:00Z'))).toBe('2026-11-09'); // Sun 23:30 EAT
    expect(weekStartOf(new Date('2026-11-15T21:30:00Z'))).toBe('2026-11-16'); // Mon 00:30 EAT
  });

  it('bounds are Monday 00:00 to next Monday 00:00 Nairobi', () => {
    expect(weekBounds('2026-11-09')).toEqual({ from: new Date('2026-11-08T21:00:00Z'), to: new Date('2026-11-15T21:00:00Z') });
  });

  it('last full week, and only Mondays are accepted', () => {
    expect(lastFullWeekStart(new Date('2026-11-14T10:00:00Z'))).toBe('2026-11-02');
    expect(isWeekStart('2026-11-09')).toBe(true);
    expect(isWeekStart('2026-11-10')).toBe(false);
    expect(isWeekStart('2026-02-30')).toBe(false);
    expect(isWeekStart('x')).toBe(false);
  });

  it('CSV: draft flag when unconfirmed, and "count by hand" rows', () => {
    const csv = weeklySummaryCsv({
      clinicName: 'Avyora, "Westlands"',
      county: 'Nairobi',
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      rows: [
        { diseaseId: 'cholera', name: 'Cholera', reporting: 'IMMEDIATE', form505Row: 'Cholera', countedByAcisi: true, source: 'DIAGNOSES', under5: 1, fiveAndOver: 2, ageUnknown: 0, total: 3, deathsUnder5: 0, deathsFiveAndOver: 0 },
        { diseaseId: 'neonatal-deaths', name: 'Neonatal death', reporting: 'WEEKLY', form505Row: 'Neonatal deaths', countedByAcisi: true, source: 'EVENTS', under5: 0, fiveAndOver: 0, ageUnknown: 0, total: 0, deathsUnder5: 2, deathsFiveAndOver: 0 },
        { diseaseId: 'maternal-death', name: 'Maternal death', reporting: 'IMMEDIATE', form505Row: 'Maternal deaths', countedByAcisi: false, source: 'EVENTS', under5: 0, fiveAndOver: 0, ageUnknown: 0, total: 0, deathsUnder5: 0, deathsFiveAndOver: 0 },
      ],
      totalCases: 3,
      listConfirmed: null,
      listSource: 'MOH',
    });
    expect(csv).toContain('Clinic,"Avyora, ""Westlands"""');
    expect(csv).toContain('DRAFT');
    expect(csv).toContain('Deaths come from recorded events only');
    expect(csv).toContain('Maternal deaths,Maternal death,Immediate,events,count by hand,,,,,');
    expect(csv).toContain('Cholera,Cholera,Immediate,diagnoses,1,2,0,3,0,0');
    expect(csv).toContain('Neonatal deaths,Neonatal death,Weekly,events,0,0,0,0,2,0');
  });
});

describe('weekly summary on a stubbed database', () => {
  it('lists every disease in MOH 505 order, counts by age group, and marks hand-counted rows', async () => {
    jest.resetModules();
    jest.doMock('../../src/db/prisma', () => ({
      prisma: {
        clinic: { findUnique: jest.fn(async () => ({ name: 'Sunrise', county: 'Nairobi' })) },
        notifiableDiseaseCase: {
          findMany: jest.fn(async () => [
            { diseaseId: 'cholera', diagnosedAt: new Date('2026-11-10T08:00:00Z'), patient: { dateOfBirth: new Date('2024-01-01') } },
            { diseaseId: 'cholera', diagnosedAt: new Date('2026-11-10T09:00:00Z'), patient: { dateOfBirth: new Date('1990-01-01') } },
            { diseaseId: 'malaria', diagnosedAt: new Date('2026-11-11T09:00:00Z'), patient: { dateOfBirth: null } },
            { diseaseId: 'sars-covid', diagnosedAt: new Date('2026-11-11T09:00:00Z'), patient: { dateOfBirth: null } },
          ]),
        },
        publicHealthEvent: {
          findMany: jest.fn(async () => [
            { type: 'AEFI', casesCount: 3, casesUnder5: 2, deathsCount: 0, deathsUnder5: 0 },
            { type: 'MATERNAL_DEATH', casesCount: 0, casesUnder5: 0, deathsCount: 1, deathsUnder5: 0 },
            { type: 'ILLNESS_CLUSTER', casesCount: 6, casesUnder5: 1, deathsCount: 1, deathsUnder5: 1 },
          ]),
        },
      },
    }));
    const { weeklySummary } = await import('../../src/services/notifiableDiseaseService');
    const s = await weeklySummary('clinic-1', '2026-11-09');
    expect(s.rows).toHaveLength(NOTIFIABLE_DISEASES.length);
    expect(s.rows[0]?.form505Row).toBe('AEFI');
    expect(s.rows.find((r) => r.diseaseId === 'cholera')).toMatchObject({ under5: 1, fiveAndOver: 1, total: 2, countedByAcisi: true });
    expect(s.rows.find((r) => r.diseaseId === 'malaria')).toMatchObject({ ageUnknown: 1, total: 1 });
    expect(s.rows.find((r) => r.diseaseId === 'aefi')).toMatchObject({ source: 'EVENTS', under5: 2, fiveAndOver: 1, total: 3 });
    expect(s.rows.find((r) => r.diseaseId === 'maternal-death')).toMatchObject({ countedByAcisi: true, total: 0, deathsFiveAndOver: 1 });
    expect(s.rows.find((r) => r.diseaseId === 'pheic')).toMatchObject({ total: 6, under5: 1, deathsUnder5: 1, deathsFiveAndOver: 0 });
    expect(s.rows.find((r) => r.diseaseId === 'sars-covid')).toMatchObject({ form505Row: 'Others (specify)', total: 1 });
    expect(s.totalCases).toBe(13); // 4 diagnosed + 9 from events
    expect(s.listConfirmed).toBe('2026-11-14');
  });
});

describe('International Health Regulations flag', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NOTIFIABLE_DISEASES, matchNotifiable } = require('../../src/services/notifiableDiseases') as typeof import('../../src/services/notifiableDiseases');
  const ihr = (id: string) => NOTIFIABLE_DISEASES.find((d) => d.id === id)?.ihr;
  it('IHR Annex 2: always notifiable vs. assessed with the decision instrument; others unflagged', () => {
    expect(['smallpox', 'afp', 'influenza-new-subtype', 'sars-covid'].map(ihr)).toEqual(['ALWAYS', 'ALWAYS', 'ALWAYS', 'ALWAYS']);
    expect(['cholera', 'plague', 'yellow-fever', 'vhf', 'pheic'].map(ihr)).toEqual(['ASSESS', 'ASSESS', 'ASSESS', 'ASSESS', 'ASSESS']);
    expect(ihr('typhoid')).toBeUndefined();
    expect(matchNotifiable(['1A00'])[0]!.disease.ihr).toBe('ASSESS');
  });
});
