import { lookupIcd11, parseDiagnosisCodes, resolveDiagnosisCodes, searchIcd11 } from '../../src/services/icd11Service';

describe('ICD-11 (WHO MMS 2025-01)', () => {
  it('looks up official titles, case-insensitive', () => {
    expect(lookupIcd11('1f40.z')).toEqual({ code: '1F40.Z', title: 'Malaria due to Plasmodium falciparum, unspecified' });
    expect(lookupIcd11('1A00')?.title).toBe('Cholera');
    expect(lookupIcd11('NOPE')).toBeNull();
  });

  it('finds common diagnoses by words, ordinary diagnoses before newborn or exposure codes', () => {
    expect(searchIcd11('falciparum malaria')[0]?.code).toMatch(/^1F40/);
    expect(searchIcd11('cholera')[0]?.code).toBe('1A00');
    expect(searchIcd11('typhoid fever').map((r) => r.code)).toContain('1A07.Z');
    expect(searchIcd11('essential hypertension')[0]?.code).toMatch(/^BA00/);
  });

  it('finds by code prefix, exact code first', () => {
    expect(searchIcd11('1F40')[0]?.code).toBe('1F40');
    expect(searchIcd11('x')).toEqual([]);
  });

  it('validates the doctor’s codes: 1 to 5, real, deduplicated', () => {
    expect(resolveDiagnosisCodes(['1a00', '1A00 ']).map((c) => c.code)).toEqual(['1A00']);
    expect(() => resolveDiagnosisCodes([])).toThrow('at least one');
    expect(() => resolveDiagnosisCodes(['ZZ99'])).toThrow('ZZ99 is not an ICD-11 diagnosis code');
    expect(() => resolveDiagnosisCodes(['1A00', '1F40.Z', 'BA00', '1A07.Z', '1E32', 'CA40.Z'])).toThrow('at most 5');
  });

  it('reads stored codes back, and older visits (no codes) as an empty list', () => {
    expect(parseDiagnosisCodes(null)).toEqual([]);
    expect(parseDiagnosisCodes('not json')).toEqual([]);
    expect(parseDiagnosisCodes('[{"code":"1A00","title":"Cholera"},{"bad":1}]')).toEqual([{ code: '1A00', title: 'Cholera' }]);
  });
});
