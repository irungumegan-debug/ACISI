import { Resend } from 'resend';
import { env } from './env';

/**
 * Null when Resend isn't configured — email is an optional delivery
 * channel (see env.ts), so callers must check emailConfigured before
 * trying to send rather than assuming this client exists.
 */
export const emailClient = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export const emailConfigured = emailClient !== null && !!env.EMAIL_FROM_ADDRESS;

/** "From" header for every outgoing email — a friendly display name plus the verified sending address. */
export const emailFromHeader = `ACISI <${env.EMAIL_FROM_ADDRESS}>`;
