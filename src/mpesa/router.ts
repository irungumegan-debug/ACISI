import { Router } from 'express';
import { parseStkCallback } from './callback';
import { StkCallbackPayload } from './types';
import { applyPaymentResult } from '../services/checkInService';
import { logger } from '../utils/logger';

export const mpesaRouter = Router();

// Daraja expects a fast 200 response acknowledging receipt regardless of the
// payment outcome — the outcome itself lives in the request body. Never
// respond with a non-2xx for a business-logic failure (e.g. unknown
// CheckIn), only for malformed requests, or Daraja will retry indefinitely.
mpesaRouter.post('/callback', async (req, res) => {
  const payload = req.body as StkCallbackPayload;

  if (!payload?.Body?.stkCallback) {
    logger.warn({ body: req.body }, 'Received malformed M-Pesa callback');
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Malformed callback body' });
    return;
  }

  try {
    const parsed = parseStkCallback(payload);
    await applyPaymentResult(parsed, payload);
  } catch (err) {
    logger.error({ err }, 'Failed to process M-Pesa callback');
  }

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});
