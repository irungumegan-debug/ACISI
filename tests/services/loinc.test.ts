import { isValidLoinc, LOINC_SUGGESTIONS, suggestLoinc } from '../../src/services/loinc';

it('every suggested code passes the LOINC check digit', () => {
  const bad = LOINC_SUGGESTIONS.filter((s) => !isValidLoinc(s.code)).map((s) => s.code);
  expect(bad).toEqual([]);
});

it('check digit catches typing mistakes', () => {
  expect(isValidLoinc('718-7')).toBe(true);
  expect(isValidLoinc('718-6')).toBe(false);
  expect(isValidLoinc('4548-4')).toBe(true);
  expect(isValidLoinc('4458-4')).toBe(false);
  expect(isValidLoinc('abc')).toBe(false);
});

it('suggests codes from the test name', () => {
  expect(suggestLoinc('Hb')[0]!.code).toBe('718-7');
  expect(suggestLoinc('Malaria BS')[0]!.code).toBe('32700-7');
  expect(suggestLoinc('FBS (fasting blood sugar)')[0]!.code).toBe('1558-6');
  expect(suggestLoinc('Something odd')).toEqual([]);
});

it('FHIR: a lab test with a LOINC code is coded in the ServiceRequest and the result', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toLabResources } = require('../../src/fhir/mappers') as typeof import('../../src/fhir/mappers');
  const visit = {
    id: 'enc-1',
    labOrders: [
      {
        id: 'lo-1',
        status: 'RESULTS_READY',
        requestedAt: new Date(),
        requestedBy: { id: 'd', name: 'Dr', staffCode: 'x' },
        noteForLab: null,
        completedAt: new Date(),
        items: [{ id: 'li-1', testName: 'Hb', loincCode: '718-7', resultValue: '12.1', resultUnit: 'g/dL', resultFlag: 'NORMAL', resultComment: null }],
      },
    ],
  } as never;
  const [req, obs] = toLabResources(visit, 'p1');
  expect(req!.code).toEqual({ coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hb' }], text: 'Hb' });
  expect(obs!.code).toEqual(req!.code);
});
