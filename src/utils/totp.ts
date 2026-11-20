import crypto from 'node:crypto';

/**
 * Time-based one-time codes (RFC 6238, the standard every authenticator app
 * uses: Google Authenticator, Microsoft Authenticator, Authy, 1Password...).
 * SHA-1, 6 digits, 30-second steps: the only settings all apps support.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Codes from one step either side are accepted, for phones whose clock is up to ~30 s off. */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits, as RFC 4226 recommends), base32 for the app. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code for one time step (RFC 4226 HOTP with the step as counter). */
export function totpCodeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(binary).padStart(TOTP_DIGITS, '0');
}

/**
 * Returns the time step the code belongs to, or null if it doesn't match.
 * Callers refuse a step at or before the last one accepted, so a code
 * can't be used twice.
 */
export function matchTotp(secret: string, code: string, atMs: number = Date.now()): number | null {
  const given = Buffer.from(code.trim());
  if (!/^\d{6}$/.test(code.trim())) return null;
  const now = totpStep(atMs);
  let matched: number | null = null;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    // Compare every candidate (no early exit) in constant time.
    if (crypto.timingSafeEqual(given, Buffer.from(totpCodeForStep(secret, step))) && matched === null) matched = step;
  }
  return matched;
}

/** The otpauth:// link the app reads from the QR code. */
export function otpauthUrl(secret: string, accountName: string, issuer = 'ACISI'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
