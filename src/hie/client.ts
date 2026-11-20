import axios, { AxiosError, Method } from 'axios';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

/**
 * Connection to DHA's Health Information Exchange (HIE) middleware
 * (https://hie-docs.dha.go.ke). One service-account token for all of ACISI
 * (OAuth2 client credentials, cached in Redis until shortly before it
 * expires); the clinic a call is for goes in the X-Facility-Id headers,
 * because ACISI serves many clinics (DHA "Facility Identification").
 *
 * Nothing about patients is ever logged here: only the path's first segment,
 * the HTTP status and timing.
 */

const TOKEN_KEY = 'hie:access_token';
const TIMEOUT_MS = 15_000;

export type HieErrorKind = 'not_configured' | 'not_found' | 'invalid' | 'unauthorized' | 'unavailable';

export class HieError extends Error {
  constructor(
    public readonly kind: HieErrorKind,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'HieError';
  }
}

/** HTTP status ACISI's own API answers with for each kind. */
export function hieErrorStatus(err: HieError): number {
  return { not_configured: 503, not_found: 404, invalid: 400, unauthorized: 502, unavailable: 502 }[err.kind];
}

export function hieConfigured(): boolean {
  return env.HIE_ENABLED && Boolean(env.HIE_CLIENT_ID && env.HIE_CLIENT_SECRET);
}

function requireConfigured(): void {
  if (!hieConfigured()) {
    throw new HieError('not_configured', "ACISI isn't connected to the national Health Information Exchange yet.");
  }
}

export async function getHieToken(): Promise<string> {
  requireConfigured();
  const cached = await redis.get(TOKEN_KEY);
  if (cached) return cached;
  let data: { access_token?: string; expires_in?: number };
  try {
    ({ data } = await axios.post(
      `${env.HIE_BASE_URL}/tenants/token`,
      new URLSearchParams({ client_id: env.HIE_CLIENT_ID!, client_secret: env.HIE_CLIENT_SECRET! }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: TIMEOUT_MS },
    ));
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    logger.error({ hie: 'token', status }, 'HIE token request failed');
    if (status === 400 || status === 401 || status === 403) {
      throw new HieError('unauthorized', 'The national HIE refused ACISI’s credentials. Contact ACISI support.', status);
    }
    throw new HieError('unavailable', "The national HIE isn't answering right now. Try again in a few minutes.", status);
  }
  if (!data?.access_token) throw new HieError('unavailable', 'The national HIE sent an unexpected answer.');
  // Refresh a minute early; if DHA gives no lifetime, keep it 5 minutes.
  const ttl = data.expires_in && data.expires_in > 120 ? data.expires_in - 60 : 300;
  await redis.set(TOKEN_KEY, data.access_token, 'EX', ttl);
  return data.access_token;
}

export interface HieRequest {
  method: Method;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** The clinic's FR code; omitted only for calls not made on behalf of a facility (e.g. finding the facility itself). */
  facilityId?: string | null;
  /** Extra headers, e.g. X-Consent-Token for reading a patient's national record. */
  headers?: Record<string, string>;
}

/** One call to the HIE. Retries once with a fresh token if the token was rejected. */
export async function hieRequest<T>(req: HieRequest, retried = false): Promise<T> {
  const token = await getHieToken();
  const headers: Record<string, string> = { ...req.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (req.facilityId) {
    headers['X-Facility-Id'] = req.facilityId;
    headers['X-Facility-Id-Type'] = 'fr-code';
  }
  const params = Object.fromEntries(Object.entries(req.query ?? {}).filter(([, v]) => v !== undefined && v !== ''));
  const started = Date.now();
  const area = req.path.split('/')[1] ?? '';
  try {
    const { data, status } = await axios.request<T>({
      method: req.method,
      url: `${env.HIE_BASE_URL}${req.path}`,
      params,
      data: req.body,
      headers,
      timeout: TIMEOUT_MS,
    });
    logger.info({ hie: area, status, ms: Date.now() - started }, 'HIE call');
    return data;
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    logger.warn({ hie: area, status, ms: Date.now() - started }, 'HIE call failed');
    if (status === 401 && !retried) {
      await redis.del(TOKEN_KEY);
      return hieRequest<T>(req, true);
    }
    if (status === 404) throw new HieError('not_found', 'Not found in the national registry.', status);
    if (status === 400 || status === 422) throw new HieError('invalid', 'The national registry did not accept those details. Check them and try again.', status);
    if (status === 401 || status === 403) throw new HieError('unauthorized', 'The national HIE refused the request. Contact ACISI support.', status);
    throw new HieError('unavailable', "The national HIE isn't answering right now. Try again in a few minutes.", status);
  }
}

/** Every string anywhere in a JSON value (for picking identifiers out of answers whose exact shape DHA hasn't fixed). */
export function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, out));
  return out;
}
