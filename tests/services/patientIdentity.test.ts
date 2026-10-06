import { normalizeIdNumber, PatientIdentityError, preparePatientIdentity } from '../../src/services/patientIdentity';

describe('preparePatientIdentity', () => {
  it('normalises the ID number and next-of-kin phone', () => {
    expect(
      preparePatientIdentity({ idType: 'PASSPORT', idNumber: ' ak 123456 ', nextOfKinName: '  Peter   Otieno ', nextOfKinPhone: '0722 000 111' }, 'fillIn'),
    ).toEqual({ idType: 'PASSPORT', idNumber: 'AK123456', nextOfKinName: 'Peter Otieno', nextOfKinPhone: '+254722000111' });
  });

  it.each([
    ['NATIONAL_ID', '12345678'],
    ['NATIONAL_ID', '123456'],
    ['BIRTH_CERTIFICATE', '1234567890'],
    ['ALIEN_ID', '123456'],
    ['PASSPORT', 'C1234567'],
  ] as const)('accepts a %s number %s', (idType, idNumber) => {
    expect(preparePatientIdentity({ idType, idNumber }, 'fillIn')).toEqual({ idType, idNumber });
  });

  it.each([
    [{ idType: 'NATIONAL_ID', idNumber: '12345' }, 'A national ID number is 6 to 9 digits'],
    [{ idType: 'NATIONAL_ID', idNumber: 'A1234567' }, 'A national ID number is 6 to 9 digits'],
    [{ idType: 'PASSPORT', idNumber: 'AK#1' }, 'Enter the passport number using letters and numbers only (4 to 20 characters)'],
    [{ idNumber: '12345678' }, 'Choose the type of ID document'],
    [{ idType: 'BIRTH_CERTIFICATE', idNumber: ' ' }, 'Enter the birth certificate number'],
    [{ nextOfKinName: 'P' }, "Enter the next of kin's full name"],
    [{ nextOfKinPhone: '12345' }, 'Enter a valid Kenyan phone number for the next of kin, e.g. 0712 345 678'],
  ] as const)('refuses %j', (input, message) => {
    expect(() => preparePatientIdentity(input, 'fillIn')).toThrow(new PatientIdentityError(message));
  });

  it("'fillIn' ignores empty fields, so nothing on file is wiped", () => {
    expect(preparePatientIdentity({ idType: '', idNumber: '', nextOfKinName: null, nextOfKinPhone: '' }, 'fillIn')).toEqual({});
  });

  it("'replace' clears fields sent empty, but leaves fields not sent alone", () => {
    expect(preparePatientIdentity({ idType: '', idNumber: '', nextOfKinName: '' }, 'replace')).toEqual({
      idType: null,
      idNumber: null,
      nextOfKinName: null,
    });
  });

  it('normalizeIdNumber strips spaces and upper-cases', () => {
    expect(normalizeIdNumber(' ab 12-3 ')).toBe('AB12-3');
  });
});
