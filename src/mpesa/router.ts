import { Router } from 'express';
import { parseStkCallback } from './callback';
import { StkCallbackPayload } from './types';
import { handleStkCallback } from '../services/checkInService';
import { clinicStkConfigured } from './clinicStk';
import { applyClinicStkResult } from '../services/billingService';
import { errorSummary, logger } from '../utils/logger';

export const mpesaRouter = Router();

// Daraja expects a fast 200 response acknowledging receipt regardless of the
// payment outcome — the outcome itself lives in the request body. Never
// respond with a non-2xx for a business-logic failure (e.g. unknown
// CheckIn), only for malformed requests, or Daraja will retry indefinitely.
mpesaRouter.post('/callback', async (req, res) => {
  const payload = req.body as StkCallbackPayload;

  if (!payload?.Body?.stkCallback) {
    // No body in the log: a callback can carry the patient's phone number.
    logger.warn('Received malformed M-Pesa callback');
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Malformed callback body' });
    return;
  }

  // A success is only applied once Safaricom's status query confirms it
  // (handleStkCallback): the callback alone is never trusted. One log line
  // per callback (checkInId, source, resultCode, status — never the phone
  // number, receipt number or payload).
  try {
    await handleStkCallback(parseStkCallback(payload), payload);
  } catch (err) {
    logger.error(
      { err: errorSummary(err), resultCode: payload.Body.stkCallback.ResultCode },
      'Failed to process M-Pesa callback',
    );
  }

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/**
 * Callback for CLINIC checkout payments (CLINIC_MPESA_CALLBACK_URL) — a
 * separate route from /callback above, which only ever handles ACISI's own
 * check-in fee. Same rules: always acknowledge with 200 so Daraja doesn't
 * retry forever; the outcome is applied to the matching clinic Payment.
 */
mpesaRouter.post('/clinic-callback', async (req, res) => {
  const payload = req.body as StkCallbackPayload;
  if (!payload?.Body?.stkCallback) {
    // No body in the log: a callback can carry the patient's phone number.
    logger.warn('Received malformed clinic M-Pesa callback');
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Malformed callback body' });
    return;
  }
  // Switched off (always on a live server): no clinic prompt was sent, so nothing can match.
  if (!clinicStkConfigured()) {
    logger.warn('Clinic M-Pesa callback ignored: clinic M-Pesa requests are switched off');
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    return;
  }

  try {
    const parsed = parseStkCallback(payload);
    const matched = await applyClinicStkResult({
      checkoutRequestId: parsed.checkoutRequestId,
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
      mpesaReceiptNumber: parsed.mpesaReceiptNumber,
      rawPayload: payload,
    });
    if (!matched)
      logger.warn(
        { checkoutRequestId: parsed.checkoutRequestId },
        'Clinic M-Pesa callback for unknown payment',
      );
  } catch (err) {
    logger.error({ err }, 'Failed to process clinic M-Pesa callback');
  }

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});
