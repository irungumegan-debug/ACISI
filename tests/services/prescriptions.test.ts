import { findAllergyConflicts, findMedicine, MEDICINES } from '../../src/services/medicines';
import { dhaDisplay, ingredientsOf, searchProducts, suggestedDoseUnit, suggestedRoute } from '../../src/services/dhaTerminology';
import {
  DOSE_UNITS,
  formatPrescriptionLine,
  InvalidPrescriptionError,
  linesForCheck,
  resolvePrescriptionItems,
  ROUTES,
  suggestedQuantity,
} from '../../src/services/prescriptionService';
import { toMedicationRequests } from '../../src/fhir/mappers';

const allergy = (substance: string, id = 'al') => ({ id, substance });
const conflicts = (drugs: string[], substances: string[]) =>
  findAllergyConflicts(linesForCheck(drugs.map((drugName) => ({ drugName }))), substances.map((s, i) => allergy(s, `al-${i}`)));

describe('allergy warning', () => {
  it('a penicillin allergy warns for amoxicillin, co-amoxiclav (DHA name) and benzylpenicillin, not for paracetamol', () => {
    const c = conflicts(
      ['Amoxicillin 500 mg Oral Capsule', 'Amoxicillin 500 mg/Clavulanic acid 125 mg Oral Tablet', 'Benzylpenicillin', 'Paracetamol 500 mg Oral Tablet'],
      ['Penicillin'],
    );
    expect(c.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(c[0]!.reason).toContain('same group (penicillins)');
  });

  it('brand names and the exact medicine match ("Augmentin", "Septrin")', () => {
    expect(conflicts(['Amoxicillin 875 mg/Clavulanic acid 125 mg Oral Tablet'], ['Augmentin'])).toHaveLength(1);
    expect(conflicts(['Sulfamethoxazole 400 mg/Trimethoprim 80 mg Oral Tablet'], ['Septrin'])[0]!.reason).toContain('Septrin');
  });

  it('group words in longer allergy text ("sulfa drugs", "NSAIDs - wheeze")', () => {
    expect(conflicts(['Sulfadoxine 500 mg/Pyrimethamine 25 mg Oral Tablet'], ['sulfa drugs'])).toHaveLength(1);
    expect(conflicts(['Diclofenac 50 mg Oral Tablet', 'Ibuprofen 400 mg Oral Tablet'], ['NSAIDs - wheeze'])).toHaveLength(2);
  });

  it('an allergy to one drug warns for others in its group (ciprofloxacin -> levofloxacin)', () => {
    expect(conflicts(['Levofloxacin 500 mg Oral Tablet'], ['Ciprofloxacin'])[0]!.reason).toContain('fluoroquinolones');
  });

  it('medicines not on the list match by name only', () => {
    expect(conflicts(['Herbal mixture X'], ['herbal mixture x'])).toHaveLength(1);
    expect(conflicts(['Herbal mixture X'], ['Penicillin'])).toHaveLength(0);
  });

  it('no false alarm across unrelated groups (penicillin allergy, ceftriaxone)', () => {
    // Cross-reactivity between penicillins and cephalosporins is not checked (stated in the console).
    expect(conflicts(['Ceftriaxone 1000 mg Intravenous Powder for Solution'], ['Penicillin'])).toHaveLength(0);
  });

  it('every medicine on the group list has a unique id', () => {
    expect(new Set(MEDICINES.map((m) => m.id)).size).toBe(MEDICINES.length);
    expect(findMedicine('Amoxicillin 500mg caps')?.id).toBe('amoxicillin');
  });
});

describe('DHA ePrescription terminology', () => {
  it('finds medicines on DHA\'s list and suggests route and unit from the dose form', () => {
    const [first] = searchProducts('paracetamol 500');
    expect(first).toEqual({ code: 'GE10177', name: 'Paracetamol 500 mg Oral Tablet' });
    expect(suggestedRoute('Ceftriaxone 1000 mg Intravenous Powder for Solution')).toBe('RT10036');
    expect(suggestedDoseUnit('Amoxicillin 500 mg Oral Capsule')).toBe('UM10032');
    expect(suggestedDoseUnit('Salbutamol 2 mg per 5ml Oral Syrup')).toBe('UM10245');
    expect(ingredientsOf('Artemether 20 mg/Lumefantrine 120 mg Oral Tablet')).toEqual(['Artemether', 'Lumefantrine']);
  });

  it('every route and unit offered is a real DHA code', () => {
    for (const r of ROUTES) expect([r, dhaDisplay('routes', r) !== null]).toEqual([r, true]);
    for (const u of Object.keys(DOSE_UNITS)) expect([u, dhaDisplay('units', u) !== null]).toEqual([u, true]);
  });
});

describe('prescription lines', () => {
  const base = { productCode: 'GE10177', doseValue: 2, doseUnit: 'UM10415' as const, route: 'RT10025' as const, frequency: 'TDS' as const, durationDays: 3 };

  it('names come from DHA\'s list; bad codes are refused', () => {
    const [r] = resolvePrescriptionItems([{ ...base, drugName: 'ignored', instructionCodes: ['SWALLOW-WHOLE'] }].map((i) => ({ ...i, instructionCodes: [] })));
    expect(r!.drugName).toBe('Paracetamol 500 mg Oral Tablet');
    expect(() => resolvePrescriptionItems([{ ...base, productCode: 'GE00000' }])).toThrow(InvalidPrescriptionError);
    expect(() => resolvePrescriptionItems([{ ...base, instructionCodes: ['NOPE'] }])).toThrow('unknown instruction NOPE');
  });

  it('reads well for the SMS and the record', () => {
    const [r] = resolvePrescriptionItems([{ ...base, quantity: 18, instructionCodes: ['TAKE-WITH-OR-AFTER-FOOD'] }]);
    expect(formatPrescriptionLine(r!)).toBe('Paracetamol 500 mg Oral Tablet: 2 tablets 3 times a day for 3 days (18 tablets). Take with or after food.');
    const [inj] = resolvePrescriptionItems([{ productCode: 'GE10169', doseValue: 1, doseUnit: 'UM10475', route: 'RT10036', frequency: 'STAT' }]);
    expect(formatPrescriptionLine(inj!)).toBe('Ceftriaxone 1000 mg Intravenous Powder for Solution (Intravenous): 1 vial once, now.');
  });

  it('suggests the quantity to dispense', () => {
    expect(suggestedQuantity({ doseValue: 2, doseUnit: 'UM10415', frequency: 'TDS', durationDays: 3 })).toBe(18);
    expect(suggestedQuantity({ doseValue: 1, doseUnit: 'UM10415', frequency: 'PRN', durationDays: 3 })).toBeNull();
  });
});

describe('FHIR MedicationRequest (DHA ePrescription shape)', () => {
  const visit = {
    id: 'enc-1',
    status: 'DONE',
    createdAt: new Date('2026-11-14T08:00:00Z'),
    checkedOutAt: null,
    consultedAt: new Date('2026-11-14T09:00:00Z'),
    visitReason: null,
    diagnosis: null,
    diagnosisCodes: [],
    prescription: 'x',
    clinicId: 'c',
    departmentName: 'General',
    doctor: { id: 'doc-1', name: 'Dr A', staffCode: 'S' },
    labOrders: [],
    prescriptionItems: [
      {
        id: 'rx-1',
        productCode: 'GE10177',
        drugName: 'Paracetamol 500 mg Oral Tablet',
        doseValue: 2,
        doseUnit: 'UM10415',
        route: 'RT10025',
        frequency: 'TDS',
        durationDays: 3,
        quantity: 18,
        quantityUnit: 'UM10415',
        instructionCodes: 'TAKE-WITH-OR-AFTER-FOOD',
        instructions: null,
      },
      { id: 'rx-2', productCode: null, drugName: 'Herbal syrup', doseValue: 5, doseUnit: 'UM10245', route: 'RT10025', frequency: 'PRN', durationDays: null, quantity: null, quantityUnit: null, instructionCodes: null, instructions: 'Only if pain' },
    ],
  };

  it('one request per medicine, coded with DHA systems', () => {
    const [mr, other] = toMedicationRequests(visit, 'pat-1');
    expect(mr).toMatchObject({
      id: 'rx-1',
      intent: 'order',
      status: 'completed',
      medicationCodeableConcept: { coding: [{ system: 'https://fhir.dha.go.ke/terminology/CodeSystem/generic-products-cs', code: 'GE10177' }] },
      dosageInstruction: [
        {
          timing: { repeat: { frequency: 3, period: 1, periodUnit: 'd', boundsDuration: { value: 3, code: 'd' } } },
          route: { coding: [{ system: 'https://fhir.dha.go.ke/terminology/CodeSystem/route-of-administration-cs', code: 'RT10025', display: 'Oral' }] },
          doseAndRate: [{ doseQuantity: { value: 2, system: 'https://fhir.dha.go.ke/terminology/CodeSystem/unit-of-measure-cs', code: 'UM10415' } }],
          additionalInstruction: [{ coding: [{ code: 'TAKE-WITH-OR-AFTER-FOOD' }] }],
        },
      ],
      dispenseRequest: { quantity: { value: 18, code: 'UM10415' } },
    });
    expect(other).toMatchObject({ medicationCodeableConcept: { text: 'Herbal syrup' }, note: [{ text: 'Only if pain' }], dosageInstruction: [{ asNeededBoolean: true }] });
    expect(other).not.toHaveProperty('dispenseRequest');
  });

  it('older visits (no lines) stay one text-only request', () => {
    expect(toMedicationRequests({ ...visit, prescriptionItems: [] }, 'pat-1')).toEqual([expect.objectContaining({ id: 'enc-1-rx', medicationCodeableConcept: { text: 'x' } })]);
  });
});
