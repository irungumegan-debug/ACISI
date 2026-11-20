import { buildVisitRecordDataFromEncounter } from '../../src/services/visitRecordDocument';

const day = (d: string) => new Date(`${d}T09:00:00Z`);
const item = (drugName: string, durationDays: number | null, frequency = 'BD') => ({
  id: drugName,
  productCode: null,
  drugName,
  doseValue: 1,
  doseUnit: 'TAB',
  route: 'PO',
  frequency,
  durationDays,
  quantity: null,
  quantityUnit: null,
  instructionCodes: null,
  instructions: null,
});

it('clinical summary: biodata, other current medicines from this clinic, plan / follow-up', () => {
  const data = buildVisitRecordDataFromEncounter({
    id: 'enc-now',
    clinicId: 'c1',
    createdAt: day('2026-11-20'),
    consultedAt: day('2026-11-20'),
    diagnosis: null,
    diagnosisCodes: null,
    prescription: 'Paracetamol',
    carePlan: 'Review in 2 weeks with BP readings',
    patient: {
      firstName: 'Amina',
      lastName: 'Otieno',
      patientCode: 'ACI-1',
      dateOfBirth: new Date('1980-02-03T00:00:00Z'),
      sex: 'FEMALE',
      idType: 'NATIONAL_ID',
      idNumber: '12345678',
      encounters: [
        { id: 'enc-now', clinicId: 'c1', consultedAt: day('2026-11-20'), prescriptionItems: [item('Today only', 5)] },
        { id: 'old-1', clinicId: 'c1', consultedAt: day('2026-11-01'), prescriptionItems: [item('Amlodipine 5 mg', 30), item('Amoxicillin', 5)] },
        { id: 'old-2', clinicId: 'c2', consultedAt: day('2026-11-15'), prescriptionItems: [item('Other clinic drug', 30)] },
      ],
    },
    clinic: { name: 'Sunrise', county: null },
    checkIn: { department: { name: 'General' } },
    consultedByStaff: null,
  } as never);
  expect(data.biodata).toEqual({ dateOfBirth: new Date('1980-02-03T00:00:00Z'), sex: 'Female', idDocument: 'National ID 12345678' });
  expect(data.currentMedicines).toHaveLength(1);
  expect(data.currentMedicines![0]).toMatch(/^Amlodipine 5 mg/);
  expect(data.carePlan).toBe('Review in 2 weeks with BP readings');
});
