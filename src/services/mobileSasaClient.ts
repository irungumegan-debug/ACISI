import { env } from '../config/env';
import { toDarajaFormat, toE164 } from '../utils/phone';

/**
 * Mobile Sasa, ACISI's live SMS provider (sender ID "ACISI").
 * POST https://api.mobilesasa.com/v1/send/message with a Bearer token and
 * { senderID, phone, message }.
 *
 * Errors thrown from here never carry the token, the number or the text:
 * only the HTTP status and Mobile Sasa's response code, so they are safe to
 * log.
 */

export const MOBILESASA_SEND_URL = 'https://api.mobilesasa.com/v1/send/message';
const TIMEOUT_MS = 15_000;

export class MobileSasaError extends Error {
  /** The HTTP status or Mobile Sasa's response code: safe to log. */
  readonly code: string;
  constructor(code: string) {
    super('Mobile Sasa did not accept the SMS');
    this.name = 'MobileSasaError';
    this.code = code;
  }
}

export function mobileSasaConfigured(): boolean {
  return Boolean(env.MOBILESASA_API_TOKEN);
}

/**
 * Mobile Sasa answers { status: true, responseCode: "0200", ... } when it
 * accepts a message. Anything else (status false, another response code,
 * no JSON) is a failure.
 */
export function mobileSasaAccepted(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const { status, responseCode } = body as { status?: unknown; responseCode?: unknown };
  if (status === false) return false;
  if (responseCode !== undefined && String(responseCode) !== '0200') return false;
  return status === true || String(responseCode) === '0200';
}

/** Sends one SMS. Resolves when Mobile Sasa accepted it; throws MobileSasaError otherwise. */
export async function sendViaMobileSasa(to: string, message: string): Promise<void> {
  const token = env.MOBILESASA_API_TOKEN;
  if (!token) throw new MobileSasaError('not_configured');

  let response: Response;
  try {
    response = await fetch(MOBILESASA_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      // Mobile Sasa wants 2547XXXXXXXX (no "+").
      body: JSON.stringify({ senderID: env.MOBILESASA_SENDER_ID, phone: toDarajaFormat(toE164(to)), message }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new MobileSasaError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: treated as not accepted below.
  }
  if (!response.ok || !mobileSasaAccepted(body)) {
    const responseCode = (body as { responseCode?: unknown } | null)?.responseCode;
    throw new MobileSasaError(`http_${response.status}${responseCode !== undefined ? `_${String(responseCode).slice(0, 10)}` : ''}`);
  }
}
