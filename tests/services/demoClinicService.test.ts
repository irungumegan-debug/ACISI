import {
  demoClinicName,
  departmentKind,
  demoPhone,
  displayPhone,
  DEMO_PATIENTS,
  parseDepartmentList,
} from '../../src/services/demoClinicService';

describe('demo clinic parameters', () => {
  it('parses a department list with short codes and optional fees', () => {
    expect(
      parseDepartmentList('General Consultation:G, Paediatrics:P:1200 ,Gynaecology & Antenatal:GY'),
    ).toEqual([
      { name: 'General Consultation', code: 'G' },
      { name: 'Paediatrics', code: 'P', consultationFeeKes: 1200 },
      { name: 'Gynaecology & Antenatal', code: 'GY' },
    ]);
    expect(() => parseDepartmentList('General')).toThrow('needs a name and a short code');
    expect(() => parseDepartmentList('General:G:abc')).toThrow('whole number');
  });

  it('names the demo clinic with its location, once', () => {
    expect(demoClinicName('Alina Medical Centre', 'Hurlingham')).toBe(
      'Alina Medical Centre – Hurlingham (Demo)',
    );
    expect(demoClinicName('Westlands Medical Centre', 'Westlands')).toBe('Westlands Medical Centre (Demo)');
  });

  it('knows lab and pharmacy departments from their names', () => {
    expect(departmentKind('Laboratory')).toBe('lab');
    expect(departmentKind('Lab')).toBe('lab');
    expect(departmentKind('Pharmacy')).toBe('pharmacy');
    expect(departmentKind('General Consultation')).toBe('consult');
    expect(departmentKind('Paediatrics')).toBe('consult');
  });

  it('uses only the obviously fake 0700 000 xxx numbers', () => {
    expect(demoPhone(0, 1)).toBe('+254700000001');
    expect(displayPhone(demoPhone(0, 8))).toBe('0700 000 008');
    expect(displayPhone(demoPhone(1, 1))).toBe('0700 000 101');
  });

  it('uses the agreed neutral names for patients', () => {
    expect(DEMO_PATIENTS.map((p) => `${p.firstName} ${p.lastName}`)).toEqual([
      'Joy Carter',
      'Brian Ellis',
      'Mercy Lawson',
      'Kevin Hart',
      'Esther Wells',
      'Victor Shaw',
      'Linda Parker',
      'Caleb Foster',
    ]);
  });
});
