import axios from 'axios';
import dayjs from 'dayjs';
import { env, mpesaBaseUrl } from '../config/env';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

const TOKEN_CACHE_KEY = 'mpesa:access_token';

/**
 * Fetches (and caches in Redis) a Daraja OAuth token. Tokens are valid for
 * ~3600s; we cache for slightly less so we never hand out one that expires
 * mid-request.
 */
export async function getDarajaAccessToken(): Promise<string> {
  const cached = await redis.get(TOKEN_CACHE_KEY);
  if (cached) return cached;

  const credentials = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');

  const { data } = await axios.get<{ access_token: string; expires_in: string }>(
    `${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } },
  );

  const ttlSeconds = Math.max(Number(data.expires_in) - 60, 60);
  await redis.set(TOKEN_CACHE_KEY, data.access_token, 'EX', ttlSeconds);

  return data.access_token;
}

/** Daraja's required timestamp format: yyyyMMddHHmmss. */
export function darajaTimestamp(date: Date = new Date()): string {
  return dayjs(date).format('YYYYMMDDHHmmss');
}

export function darajaPassword(timestamp: string): string {
  return Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString('base64');
}

export async function darajaClient() {
  const token = await getDarajaAccessToken();
  return axios.create({
    baseURL: mpesaBaseUrl,
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function logDarajaError(context: string, err: unknown): void {
  if (axios.isAxiosError(err)) {
    logger.error({ context, status: err.response?.status, data: err.response?.data }, 'Daraja API error');
  } else {
    logger.error({ context, err }, 'Unexpected Daraja error');
  }
}
