import crypto from 'node:crypto';

/**
 * Field-level encryption at rest (AES-256-GCM) for health data and identity
 * documents. Stored values look like "enc:v1:<base64 of iv|tag|ciphertext>";
 * anything without that prefix is older plaintext and is returned as is
 * (scripts/encryptExistingData.ts encrypts it once).
 *
 * The 32-byte key comes from DATA_ENCRYPTION_KEY (base64). It lives in the
 * server's root-only settings file and in the encrypted config backup, and
 * must also be kept offline with the backup key: without it these fields
 * cannot be read.
 */

export const ENCRYPTED_PREFIX = 'enc:v1:';

/** Fields encrypted wherever they appear in a write (Encounter, LabOrder, LabOrderItem, Patient, PendingPatientSignup, PatientAllergy). */
export const ENCRYPTED_FIELDS: ReadonlySet<string> = new Set([
  'diagnosis',
  'prescription',
  'visitReason',
  'noteForLab',
  'resultValue',
  'resultComment',
  'idNumber',
  'nextOfKinName',
  'nextOfKinPhone',
  'substance',
  'reaction',
  'removedReason',
]);

let cachedKey: Buffer | null | undefined;

export function encryptionKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    cachedKey = null;
    return cachedKey;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)');
  cachedKey = key;
  return cachedKey;
}

/** For tests only. */
export function resetEncryptionKeyCache(): void {
  cachedKey = undefined;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptValue(plain: string): string {
  const key = encryptionKey();
  if (!key || isEncrypted(plain)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ENCRYPTED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptValue(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const key = encryptionKey();
  if (!key) throw new Error('Encrypted data found but DATA_ENCRYPTION_KEY is not set');
  const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/**
 * Only plain objects and arrays are walked. Anything else (Prisma.Decimal
 * money amounts, Date, Buffer, any class instance) is passed through
 * untouched: rebuilding a Decimal as a plain object breaks the write.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Encrypts the listed fields anywhere in a Prisma write payload (nested creates included). */
export function encryptWritePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encryptWritePayload);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (ENCRYPTED_FIELDS.has(k) && typeof v === 'string') out[k] = encryptValue(v);
    else if (ENCRYPTED_FIELDS.has(k) && v && typeof v === 'object' && typeof (v as { set?: unknown }).set === 'string') {
      out[k] = { ...(v as object), set: encryptValue((v as { set: string }).set) };
    } else out[k] = encryptWritePayload(v);
  }
  return out;
}

/** Decrypts every encrypted string anywhere in a query result. */
export function decryptResult<T>(value: T): T {
  if (typeof value === 'string') return (isEncrypted(value) ? decryptValue(value) : value) as T;
  if (Array.isArray(value)) return value.map(decryptResult) as T;
  if (!isPlainObject(value)) return value;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v && (typeof v === 'object' || isEncrypted(v))) (value as Record<string, unknown>)[k] = decryptResult(v);
  }
  return value;
}
