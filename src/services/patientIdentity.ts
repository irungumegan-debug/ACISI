import { PatientIdType } from '@prisma/client';
import { z } from 'zod';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';

/**
 * Optional identity document and next of kin on a patient record (see
 * Patient.idType/idNumber/nextOfKin* in schema.prisma). The same rules apply
 * wherever they're entered: patient web check-in, front-desk walk-in, and
 * the patient's page in the staff console.
 */

export const PATIENT_ID_TYPES = ['NATIONAL_ID', 'PASSPORT', 'BIRTH_CERTIFICATE', 'ALIEN_ID'] as const satisfies readonly PatientIdType[];

const ID_TYPE_LABEL: Record<PatientIdType, string> = {
  NATIONAL_ID: 'national ID',
  PASSPORT: 'passport',
  BIRTH_CERTIFICATE: 'birth certificate',
  ALIEN_ID: 'alien ID',
};

/** Request body shape. Empty strings and null mean "nothing entered" (or, with mode 'replace', "clear it"). */
export const patientIdentityInputSchema = z.object({
  idType: z.enum(PATIENT_ID_TYPES).nullish().or(z.literal('')),
  idNumber: z.string().max(40).nullish(),
  nextOfKinName: z.string().max(100).nullish(),
  nextOfKinPhone: z.string().max(20).nullish(),
});

export type PatientIdentityInput = z.infer<typeof patientIdentityInputSchema>;

export interface PatientIdentityUpdate {
  idType?: PatientIdType | null;
  idNumber?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhone?: string | null;
}

export class PatientIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatientIdentityError';
  }
}

/** " 1234 5678 " -> "12345678"; "ab-123" -> "AB-123". */
export function normalizeIdNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

function idNumberProblem(idType: PatientIdType, idNumber: string): string | null {
  if (idType === 'NATIONAL_ID') {
    return /^\d{6,9}$/.test(idNumber) ? null : 'A national ID number is 6 to 9 digits';
  }
  return /^[A-Z0-9/-]{4,20}$/.test(idNumber)
    ? null
    : `Enter the ${ID_TYPE_LABEL[idType]} number using letters and numbers only (4 to 20 characters)`;
}

const blank = (v: string | null | undefined) => v === undefined || v === null || v.trim() === '';

/**
 * Validates and normalises identity input into the Patient fields to write.
 *
 * - mode 'fillIn' (check-in, walk-in): only fields actually entered are
 *   written, so an empty form never wipes what's on file.
 * - mode 'replace' (editing the patient's page): fields sent empty are
 *   cleared.
 *
 * ID type and number go together: one without the other is refused.
 */
export function preparePatientIdentity(input: PatientIdentityInput, mode: 'fillIn' | 'replace'): PatientIdentityUpdate {
  const update: PatientIdentityUpdate = {};
  const idType = input.idType || null;
  const idNumber = blank(input.idNumber) ? null : normalizeIdNumber(input.idNumber!);

  if (idNumber && !idType) throw new PatientIdentityError('Choose the type of ID document');
  if (idType && !idNumber) throw new PatientIdentityError(`Enter the ${ID_TYPE_LABEL[idType]} number`);
  if (idType && idNumber) {
    const problem = idNumberProblem(idType, idNumber);
    if (problem) throw new PatientIdentityError(problem);
    update.idType = idType;
    update.idNumber = idNumber;
  } else if (mode === 'replace' && (input.idType !== undefined || input.idNumber !== undefined)) {
    update.idType = null;
    update.idNumber = null;
  }

  if (!blank(input.nextOfKinName)) {
    const name = input.nextOfKinName!.trim().replace(/\s+/g, ' ');
    if (name.length < 2) throw new PatientIdentityError("Enter the next of kin's full name");
    update.nextOfKinName = name;
  } else if (mode === 'replace' && input.nextOfKinName !== undefined) {
    update.nextOfKinName = null;
  }

  if (!blank(input.nextOfKinPhone)) {
    try {
      update.nextOfKinPhone = toE164(input.nextOfKinPhone!);
    } catch (err) {
      if (err instanceof InvalidPhoneNumberError) {
        throw new PatientIdentityError("Enter a valid Kenyan phone number for the next of kin, e.g. 0712 345 678");
      }
      throw err;
    }
  } else if (mode === 'replace' && input.nextOfKinPhone !== undefined) {
    update.nextOfKinPhone = null;
  }

  return update;
}

/** The identity fields as shown to the patient themselves or to staff at a clinic that has seen them. */
export function identityView(patient: {
  idType: PatientIdType | null;
  idNumber: string | null;
  nextOfKinName: string | null;
  nextOfKinPhone: string | null;
}) {
  return {
    idType: patient.idType,
    idNumber: patient.idNumber,
    nextOfKinName: patient.nextOfKinName,
    nextOfKinPhone: patient.nextOfKinPhone,
  };
}
