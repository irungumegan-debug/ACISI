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

  it('ids are unique', () => {
    expect(new Set(NOTIFIABLE_DISEASES.map((d) => d.id)).size).toBe(NOTIFIABLE_DISEASES.length);
  });

  it('matches codes and subcodes, not lookalike codes', () => {
    expect(matchNotifiable(['1A00']).map((m) => m.disease.id)).toEqual(['cholera']);
    expect(matchNotifiable(['1D60.01']).map((m) => m.disease.id)).toEqual(['vhf']); // Ebola virus disease
    expect(matchNotifiable(['1D61.2']).map((m) => m.disease.id)).toEqual(['vhf']); // Lassa
    expect(matchNotifiable(['1D61.0'])).toEqual([]); // Argentinian haemorrhagic fever: not listed
    expect(matchNotifiable(['1B14'])).toEqual([]); // latent TB: not listed
    expect(matchNotifiable(['1A07.Z', 'BA00', '1F4Z']).map((m) => m.disease.id)).toEqual(['malaria', 'typhoid']);
    expect(matchNotifiable(['1A0'])).toEqual([]);
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

  it('CSV says the list is a draft and deaths are not recorded', () => {
    const csv = weeklySummaryCsv({
      clinicName: 'Avyora, "Westlands"',
      county: 'Nairobi',
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      rows: [{ diseaseId: 'cholera', name: 'Cholera', reporting: 'IMMEDIATE', under5: 1, fiveAndOver: 2, ageUnknown: 0, total: 3 }],
      totalCases: 3,
      listConfirmed: null,
    });
    expect(csv).toContain('Clinic,"Avyora, ""Westlands"""');
    expect(csv).toContain('DRAFT');
    expect(csv).toContain('Deaths,not recorded in ACISI');
    expect(csv).toContain('Cholera,Immediate,1,2,0,3');
  });
});
