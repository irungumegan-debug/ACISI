import pino from 'pino';
import { env } from '../config/env';

/**
 * Never let phone numbers, PINs, one-time codes or record contents reach
 * the logs. Three layers: known sensitive fields are redacted; requests are
 * logged without query strings, bodies or cookies; and error messages have
 * digit runs (phone numbers, PINs, codes) masked — database errors, whose
 * messages can echo the values that were being saved, keep only their code.
 */

/** "+254 712 345 678", "0712345678", "730194" -> "[number]". */
export function maskNumbers(text: string): string {
  return text.replace(/\+?\d[\d\s-]{4,}\d/g, '[number]');
}

/** An error reduced to what's safe to log: name, code, a masked message and stack. */
export function safeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { type: typeof err };
  const code = (err as { code?: unknown }).code;
  const isDbError = err.name.startsWith('Prisma');
  const message = isDbError ? undefined : maskNumbers(err.message).slice(0, 300);
  // Frame lines only: a stack starts with the message, which can span several lines.
  const frames = (err.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l)).join('\n');
  return {
    type: err.name,
    ...(typeof code === 'string' ? { code } : {}),
    ...(message ? { message } : {}),
    ...(frames ? { stack: frames } : {}),
  };
}

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  serializers: {
    err: safeError,
    // Path only: query strings carry searches by phone number or ACISI ID.
    req: (req: { method?: string; url?: string; id?: unknown }) => ({ id: req.id, method: req.method, url: (req.url ?? '').split('?')[0] }),
    res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
  },
  redact: {
    // Never let PII or secrets leak into logs, even if a caller passes them in
    // (at the top level or one level down).
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      ...['pin', 'pinHash', 'newPin', 'pinConfirm', 'otp', 'phone', 'phoneNumber', 'phoneNumberE164', 'text', 'diagnosis', 'prescription', 'password', 'mpesaConsumerSecret'].flatMap(
        (f) => [f, `*.${f}`],
      ),
    ],
    censor: '[REDACTED]',
  },
});

/**
 * An error reduced to its name and code, for logs on payment paths: a
 * database or HTTP error's message can echo the data it was given (a phone
 * number, an M-Pesa code), which must never reach the logs.
 */
export function errorSummary(err: unknown): { name: string; code?: string } {
  const code = (err as { code?: unknown })?.code;
  return { name: err instanceof Error ? err.name : typeof err, ...(typeof code === 'string' ? { code } : {}) };
}
