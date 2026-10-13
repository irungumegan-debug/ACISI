import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { recordAuditEvent } from '../services/auditService';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { logger } from '../utils/logger';

/**
 * Replies to our SMS, posted by Africa's Talking's "incoming messages"
 * callback (form fields: from, to, text, date, id, linkId). A reply of
 * STOP turns on "does not want SMS" for every patient on that phone — no
 * clinic SMS after that (receipts, summaries, invitations, queue updates).
 *
 * Replies only reach us once our sender is a two-way short code; until
 * then the SMS text doesn't mention STOP (env SMS_REPLY_STOP_ENABLED).
 * Set SMS_INBOUND_TOKEN and add ?token=… to the callback URL in the Africa's
 * Talking dashboard so nobody else can post here. Always answers 200 so AT
 * doesn't retry; never logs the number or the text.
 */
export const smsInboundRouter = Router();

// "ACHA" is Swahili for "stop". Not CANCEL/END: a patient may mean an appointment.
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'QUIT', 'ACHA']);

export function isStopRequest(text: unknown): boolean {
  return typeof text === 'string' && STOP_WORDS.has(text.trim().toUpperCase().replace(/[^A-Z]/g, ''));
}

function tokenOk(given: unknown): boolean {
  if (!env.SMS_INBOUND_TOKEN) return true;
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(env.SMS_INBOUND_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

smsInboundRouter.post('/inbound', async (req, res) => {
  if (!tokenOk(req.query.token)) {
    res.status(403).end();
    return;
  }
  const body = (req.body ?? {}) as { from?: unknown; text?: unknown };
  if (!isStopRequest(body.text) || typeof body.from !== 'string') {
    res.status(200).end();
    return;
  }
  let phone: string;
  try {
    phone = toE164(body.from);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      res.status(200).end();
      return;
    }
    throw err;
  }
  const patients = await prisma.patient.findMany({ where: { phoneNumber: phone, deletedAt: null }, select: { id: true } });
  if (patients.length > 0) {
    await prisma.patient.updateMany({ where: { id: { in: patients.map((p) => p.id) } }, data: { smsOptOut: true, smsOptOutUpdatedAt: new Date() } });
    for (const p of patients) {
      await recordAuditEvent({ actorType: 'PATIENT', actorId: p.id, action: 'PATIENT_SMS_OPTED_OUT', entityType: 'Patient', entityId: p.id, metadata: { channel: 'SMS_REPLY_STOP' } });
    }
  }
  logger.info({ patients: patients.length }, 'SMS STOP reply processed');
  res.status(200).end();
});
