import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { redis } from '../config/redis';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { formatDateOfBirth, nameKey, parseDateOfBirth, splitFullName } from '../utils/patientInput';
import { recordAuditEvent } from './auditService';
import { DuplicatePatientError, registerPatient } from './patientService';
import { ensureClinicLink, PatientRegistryError, sendRegistrationSms } from './clinicPatientService';

/**
 * Bulk import of a clinic's existing patient list (CSV or Excel .xlsx):
 * upload → preview (errors and duplicates, nothing written) → import.
 * Imported patients get NO SMS; the clinic sends invitations separately
 * ("Send invitations"), so it controls the SMS cost.
 */

export const MAX_IMPORT_ROWS = 5000;
const PREVIEW_TTL_SECONDS = 30 * 60;
/** Invitations are sent in batches so one request never runs for minutes. */
export const INVITATION_BATCH_SIZE = 100;

export interface RawImportRow {
  /** 1-based row number in the file (header is row 1). */
  rowNumber: number;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  sex: string;
}

export type ImportRowStatus =
  /** Will be registered as a new ACISI patient. */
  | 'new'
  /** Already on ACISI (same name, phone and date of birth): will be linked to this clinic, not duplicated. */
  | 'existing'
  /** Already one of this clinic's patients: skipped. */
  | 'already_linked'
  /** Same person appears earlier in the file: skipped. */
  | 'duplicate_in_file'
  | 'error';

export interface ImportPreviewRow {
  rowNumber: number;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  sex: Sex | null;
  status: ImportRowStatus;
  /** Why a row is an error, or a note for staff (e.g. "shares phone with 1 other patient"). */
  message: string | null;
}

interface StoredRow {
  status: ImportRowStatus;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string;
  sex: Sex;
  existingPatientId?: string;
}

export interface ImportPreview {
  importId: string;
  rows: ImportPreviewRow[];
  counts: Record<ImportRowStatus, number>;
}

// --- Parsing ----------------------------------------------------------------

/** Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_ALIASES: Record<keyof Omit<RawImportRow, 'rowNumber'> | 'firstName' | 'lastName', string[]> = {
  fullName: ['name', 'full name', 'fullname', 'patient name', 'patient'],
  firstName: ['first name', 'firstname', 'given name'],
  lastName: ['last name', 'lastname', 'surname', 'other names', 'family name'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'tel', 'contact', 'phone no', 'phone no.'],
  dateOfBirth: ['date of birth', 'dob', 'birth date', 'birthdate', 'd.o.b', 'd.o.b.'],
  sex: ['sex', 'gender'],
};

function findColumn(headers: string[], key: keyof typeof HEADER_ALIASES): number {
  return headers.findIndex((h) => HEADER_ALIASES[key].includes(h.trim().toLowerCase().replace(/\s+/g, ' ')));
}

/** Turns a table (first row = headers) into import rows, or throws if the needed columns aren't there. */
export function tableToRows(table: string[][]): RawImportRow[] {
  const [headerRow, ...body] = table;
  if (!headerRow) throw new PatientRegistryError('The file is empty', 400);
  const col = {
    fullName: findColumn(headerRow, 'fullName'),
    firstName: findColumn(headerRow, 'firstName'),
    lastName: findColumn(headerRow, 'lastName'),
    phone: findColumn(headerRow, 'phone'),
    dateOfBirth: findColumn(headerRow, 'dateOfBirth'),
    sex: findColumn(headerRow, 'sex'),
  };
  const missing = [
    col.fullName < 0 && (col.firstName < 0 || col.lastName < 0) && 'name',
    col.phone < 0 && 'phone',
    col.dateOfBirth < 0 && 'date of birth',
    col.sex < 0 && 'sex',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new PatientRegistryError(`Couldn't find these columns in the first row: ${missing.join(', ')}. Use the headings: Name, Phone, Date of birth, Sex.`, 400);
  }
  if (body.length > MAX_IMPORT_ROWS) {
    throw new PatientRegistryError(`The file has ${body.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`, 400);
  }
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  return body.map((r, i) => ({
    rowNumber: i + 2,
    fullName: col.fullName >= 0 ? at(r, col.fullName) : `${at(r, col.firstName)} ${at(r, col.lastName)}`.trim(),
    phone: at(r, col.phone),
    dateOfBirth: at(r, col.dateOfBirth),
    sex: at(r, col.sex),
  }));
}

function excelCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDateOfBirth(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())));
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return excelCellText(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    return '';
  }
  return String(value);
}

/** Reads the first worksheet of an .xlsx file into a table of strings. */
export async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new PatientRegistryError("Couldn't read that Excel file. Save it as .xlsx or .csv and try again.", 400);
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new PatientRegistryError('The Excel file has no sheets', 400);
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1); // exceljs rows are 1-based
    table.push(values.map(excelCellText));
  });
  return table.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY or DD.MM.YYYY (Kenyan order: day first). */
export function normaliseImportDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return parseDateOfBirth(s.slice(0, 10)) ? s.slice(0, 10) : null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${(m[2] as string).padStart(2, '0')}-${(m[1] as string).padStart(2, '0')}`;
  return parseDateOfBirth(iso) ? iso : null;
}

export function normaliseImportSex(raw: string): Sex | null {
  const s = raw.trim().toLowerCase();
  if (['m', 'male', 'man', 'boy'].includes(s)) return 'MALE';
  if (['f', 'female', 'woman', 'girl'].includes(s)) return 'FEMALE';
  if (['o', 'other'].includes(s)) return 'OTHER';
  return null;
}

// --- Preview ----------------------------------------------------------------

/**
 * Checks every row and works out what importing would do, without writing
 * anything. The checked rows are kept for 30 minutes under an import id
 * that only this clinic can confirm.
 */
export async function previewImport(file: { buffer: Buffer; originalname: string }, clinicId: string): Promise<ImportPreview> {
  const lower = file.originalname.toLowerCase();
  let table: string[][];
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    table = parseCsv(file.buffer.toString('utf8'));
  } else if (lower.endsWith('.xlsx')) {
    table = await parseXlsx(file.buffer);
  } else {
    throw new PatientRegistryError('Upload a .csv or .xlsx file. (Older .xls files: open them and save as .xlsx first.)', 400);
  }
  const raw = tableToRows(table);
  if (raw.length === 0) throw new PatientRegistryError('The file has headings but no patients', 400);

  // Validate each row on its own first.
  const checked = raw.map((r) => {
    const errors: string[] = [];
    const { firstName, lastName } = splitFullName(r.fullName);
    if (firstName.length < 2 || !lastName) errors.push('Needs a first and last name');
    let phoneNumber = '';
    try {
      phoneNumber = toE164(r.phone);
    } catch (err) {
      if (!(err instanceof InvalidPhoneNumberError)) throw err;
      errors.push('Phone number is not a valid Kenyan number');
    }
    const dateOfBirth = normaliseImportDate(r.dateOfBirth);
    if (!dateOfBirth) errors.push('Date of birth is missing or not a real date (use DD/MM/YYYY)');
    const sex = normaliseImportSex(r.sex);
    if (!sex) errors.push('Sex must be Male, Female or Other');
    return { raw: r, firstName, lastName, phoneNumber, dateOfBirth: dateOfBirth ?? '', sex, errors };
  });

  // One query for everyone already on ACISI with these phone numbers.
  const phones = [...new Set(checked.filter((c) => c.phoneNumber).map((c) => c.phoneNumber))];
  const existing = phones.length
    ? await prisma.patient.findMany({
        where: { phoneNumber: { in: phones }, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          dateOfBirth: true,
          clinicLinks: { where: { clinicId }, select: { id: true } },
          checkIns: { where: { clinicId }, select: { id: true }, take: 1 },
        },
      })
    : [];
  const byPhone = new Map<string, typeof existing>();
  for (const p of existing) byPhone.set(p.phoneNumber, [...(byPhone.get(p.phoneNumber) ?? []), p]);

  const seen = new Set<string>();
  const stored: StoredRow[] = [];
  const rows: ImportPreviewRow[] = checked.map((c) => {
    const base = {
      rowNumber: c.raw.rowNumber,
      fullName: c.raw.fullName,
      phone: c.phoneNumber || c.raw.phone,
      dateOfBirth: c.dateOfBirth || c.raw.dateOfBirth,
      sex: c.sex,
    };
    if (c.errors.length > 0) return { ...base, status: 'error', message: c.errors.join('. ') };

    const personKey = `${c.phoneNumber}|${nameKey(c.firstName, c.lastName)}|${c.dateOfBirth}`;
    if (seen.has(personKey)) return { ...base, status: 'duplicate_in_file', message: 'Same person appears earlier in the file' };
    seen.add(personKey);

    const onPhone = byPhone.get(c.phoneNumber) ?? [];
    const match = onPhone.find(
      (p) => nameKey(p.firstName, p.lastName) === nameKey(c.firstName, c.lastName) && (!p.dateOfBirth || formatDateOfBirth(p.dateOfBirth) === c.dateOfBirth),
    );
    const row: StoredRow = {
      status: 'new',
      firstName: c.firstName,
      lastName: c.lastName,
      phoneNumber: c.phoneNumber,
      dateOfBirth: c.dateOfBirth,
      sex: c.sex as Sex,
    };
    if (match) {
      if (match.clinicLinks.length > 0 || match.checkIns.length > 0) {
        return { ...base, status: 'already_linked', message: 'Already one of your patients' };
      }
      stored.push({ ...row, status: 'existing', existingPatientId: match.id });
      return { ...base, status: 'existing', message: 'Already on ACISI — will be added to your patient list, not duplicated' };
    }
    stored.push(row);
    const others = onPhone.length;
    return { ...base, status: 'new', message: others > 0 ? `Shares this phone with ${others} other patient${others === 1 ? '' : 's'} on ACISI` : null };
  });

  const importId = crypto.randomBytes(16).toString('hex');
  await redis.set(importKey(clinicId, importId), JSON.stringify(stored), 'EX', PREVIEW_TTL_SECONDS);

  const counts = { new: 0, existing: 0, already_linked: 0, duplicate_in_file: 0, error: 0 } as Record<ImportRowStatus, number>;
  for (const r of rows) counts[r.status]++;
  return { importId, rows, counts };
}

function importKey(clinicId: string, importId: string): string {
  return `patient-import:${clinicId}:${importId}`;
}

// --- Confirm ----------------------------------------------------------------

export interface ImportResult {
  created: number;
  linked: number;
}

/**
 * Imports the rows checked in a preview: registers new patients and links
 * existing ACISI patients to this clinic (source IMPORTED). Sends no SMS.
 * A preview can only be used once, and only by the clinic that made it.
 */
export async function confirmImport(importId: string, clinicId: string, staffId: string, opts: { clinicConfirmsBasis: boolean }): Promise<ImportResult> {
  if (!opts.clinicConfirmsBasis) {
    throw new PatientRegistryError('Confirm these are your clinic’s existing patients before importing', 400);
  }
  const key = importKey(clinicId, importId);
  const raw = await redis.get(key);
  if (!raw) throw new PatientRegistryError('This preview has expired. Upload the file again.', 404);
  await redis.del(key);
  const rows = JSON.parse(raw) as StoredRow[];

  let created = 0;
  let linked = 0;
  for (const r of rows) {
    if (r.status === 'existing' && r.existingPatientId) {
      await ensureClinicLink(clinicId, r.existingPatientId, 'IMPORTED', staffId);
      linked++;
      continue;
    }
    // Re-check at import time: someone may have added this person since the preview.
    const already = await prisma.patient.findFirst({
      where: {
        phoneNumber: r.phoneNumber,
        deletedAt: null,
        firstName: { equals: r.firstName, mode: 'insensitive' },
        lastName: { equals: r.lastName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (already) {
      await ensureClinicLink(clinicId, already.id, 'IMPORTED', staffId);
      linked++;
      continue;
    }
    try {
      await registerPatient({
        phoneNumberE164: r.phoneNumber,
        firstName: r.firstName,
        lastName: r.lastName,
        dateOfBirth: parseDateOfBirth(r.dateOfBirth) ?? undefined,
        sex: r.sex,
        consentChannel: 'CLINIC_IMPORT',
        clinicLink: { clinicId, source: 'IMPORTED', addedByStaffId: staffId },
      });
      created++;
    } catch (err) {
      if (!(err instanceof DuplicatePatientError)) throw err;
      await ensureClinicLink(clinicId, err.existing.id, 'IMPORTED', staffId);
      linked++;
    }
  }

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'PATIENTS_IMPORTED',
    entityType: 'Clinic',
    entityId: clinicId,
    metadata: { created, linked },
  });
  return { created, linked };
}

// --- Invitations ------------------------------------------------------------

function pendingInvitationsWhere(clinicId: string) {
  return { clinicId, source: 'IMPORTED' as const, invitedAt: null, patient: { deletedAt: null, smsOptOut: false } };
}

/** Imported patients who haven't been sent the registration SMS yet (and haven't opted out). */
export async function countPendingInvitations(clinicId: string): Promise<number> {
  return prisma.clinicPatient.count({ where: pendingInvitationsWhere(clinicId) });
}

/**
 * Sends the registration SMS to up to INVITATION_BATCH_SIZE imported
 * patients who haven't had one. The screen calls this repeatedly, passing
 * back `cursor`, until `done` — one SMS per patient per press. A failed SMS
 * stays pending and is tried again the next time staff press the button.
 */
export async function sendPendingInvitations(
  clinicId: string,
  staffId: string,
  cursor?: string,
): Promise<{ sent: number; failed: number; remaining: number; cursor: string | null; done: boolean }> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true, name: true } });
  if (!clinic) throw new PatientRegistryError('Clinic not found', 404);
  const batch = await prisma.clinicPatient.findMany({
    where: { ...pendingInvitationsWhere(clinicId), ...(cursor ? { id: { gt: cursor } } : {}) },
    include: { patient: { select: { id: true, phoneNumber: true, smsOptOut: true } } },
    orderBy: { id: 'asc' },
    take: INVITATION_BATCH_SIZE,
  });
  let sent = 0;
  let failed = 0;
  for (const link of batch) {
    const outcome = await sendRegistrationSms(link.patient, clinic, { staffId });
    if (outcome === 'sent') sent++;
    else failed++;
  }
  if (batch.length > 0) {
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      clinicId,
      action: 'INVITATIONS_SENT',
      entityType: 'Clinic',
      entityId: clinicId,
      metadata: { sent, failed },
    });
  }
  const last = batch[batch.length - 1];
  return {
    sent,
    failed,
    remaining: await countPendingInvitations(clinicId),
    cursor: last?.id ?? null,
    done: batch.length < INVITATION_BATCH_SIZE,
  };
}
