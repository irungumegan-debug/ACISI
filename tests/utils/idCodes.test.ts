import { generatePatientCode, looksLikePatientCode } from '../../src/utils/idCodes';

describe('generatePatientCode', () => {
  it('produces ACS- followed by five digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePatientCode()).toMatch(/^ACS-[1-9]\d{4}$/);
    }
  });

  it('does not hand out IDs in sequence', () => {
    const codes = Array.from({ length: 50 }, () => Number(generatePatientCode().slice(4)));
    const consecutive = codes.slice(1).filter((n, i) => n === (codes[i] as number) + 1).length;
    expect(consecutive).toBeLessThan(3);
    expect(new Set(codes).size).toBeGreaterThan(45);
  });
});

describe('looksLikePatientCode', () => {
  it.each(['ACS-48217', 'acs-48217', ' ACS-48217 ', 'ACI-7F2K'])('accepts %s', (code) => {
    expect(looksLikePatientCode(code)).toBe(true);
  });

  it.each(['0712345678', '+254712345678', 'ACI-STF-7F2K', 'ACS-', 'XYZ-48217'])('rejects %s', (code) => {
    expect(looksLikePatientCode(code)).toBe(false);
  });
});
