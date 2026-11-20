import { clientMatchesPatient, mapClient, mapFacility, mapPractitioner } from '../../src/hie/registries';

describe('Facility Registry answer', () => {
  it('keeps the FR code, name and a few public details', () => {
    expect(
      mapFacility({ frCode: 'FID-47-115307-8', officialName: 'Sunrise Clinic', facilityType: 'Medical Clinic', kephLevel: 'Level 2', facilityLicenseStatus: 'Licensed', address: { county: 'Nairobi', subCounty: 'Langata' } }),
    ).toEqual({ frCode: 'FID-47-115307-8', officialName: 'Sunrise Clinic', facilityType: 'Medical Clinic', kephLevel: 'Level 2', county: 'Nairobi', subCounty: 'Langata', licenceStatus: 'Licensed', registrationNumber: null });
  });
  it('ignores records without a code or name', () => {
    expect(mapFacility({ officialName: 'X' })).toBeNull();
  });
});

describe('Health Worker Registry answer', () => {
  it('finds the PUID, registered name and latest licence end', () => {
    const r = mapPractitioner({
      message: {
        identifiers: { client_registry_id: 'CR123', identification_number: 'A123' },
        membership: { id: 'PUID-0000443-3', full_name: 'Jane Wanjiku', is_active: 1 },
        licenses: [{ license_end: '2025-12-31' }, { license_end: '2026-12-31' }],
      },
    });
    expect(r).toEqual({ practitionerId: 'PUID-0000443-3', registeredName: 'Jane Wanjiku', licenceEnd: new Date('2026-12-31'), active: true });
  });
  it('no PUID in the answer means no match', () => {
    expect(mapPractitioner({ message: { membership: { id: '42' } } })).toBeNull();
  });
});

describe('Client Registry answer', () => {
  const raw = {
    id: 'CR9795515286992-5',
    first_name: 'Amina',
    middle_name: 'Wairimu',
    last_name: 'Otieno',
    date_of_birth: '1990-04-02',
    gender: 'Female',
    kra_pin: 'A000000000Z',
    employer_name: 'Somewhere Ltd',
    gross_income: 50000,
    phone: '0712345678',
  };

  it('keeps only the CR ID, names, date of birth and sex (data minimisation)', () => {
    expect(mapClient(raw)).toEqual({ crId: 'CR9795515286992-5', firstName: 'Amina', middleName: 'Wairimu', lastName: 'Otieno', dateOfBirth: '1990-04-02', sex: 'FEMALE' });
  });

  it('finds the CR ID among other identifications when id is not one', () => {
    expect(mapClient({ ...raw, id: 'uuid-1', other_identifications: [{ identification_type: 'ClientRegistry ID', identification_number: 'CR111-2' }] })?.crId).toBe('CR111-2');
  });

  it('matches on both names (any order, middle names ignored) and date of birth', () => {
    const client = mapClient(raw)!;
    expect(clientMatchesPatient(client, { firstName: 'amina', lastName: 'Otieno', dateOfBirth: new Date('1990-04-02') })).toBe(true);
    expect(clientMatchesPatient(client, { firstName: 'Otieno', lastName: 'Amina', dateOfBirth: null })).toBe(true);
    expect(clientMatchesPatient(client, { firstName: 'Amina', lastName: 'Otieno', dateOfBirth: new Date('1991-04-02') })).toBe(false);
    expect(clientMatchesPatient(client, { firstName: 'Grace', lastName: 'Otieno', dateOfBirth: new Date('1990-04-02') })).toBe(false);
  });
});
