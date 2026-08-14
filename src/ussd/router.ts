import { Router } from 'express';
import { dispatch, replaySession, splitUssdText } from './fsm';
import { createFreshSession, loadSession, saveSession } from './session';
import { ENTER_SENTINEL, UssdWebhookPayload } from './types';
import { toE164 } from '../utils/phone';
import { logger } from '../utils/logger';

export const ussdRouter = Router();

ussdRouter.post('/', async (req, res) => {
  const { sessionId, phoneNumber, text = '' } = req.body as UssdWebhookPayload;

  if (!sessionId || !phoneNumber) {
    res.status(400).send('END Invalid request.');
    return;
  }

  try {
    const phoneE164 = toE164(phoneNumber);
    const tokens = splitUssdText(text);

    let session = await loadSession(sessionId);

    if (!session) {
      session = createFreshSession(sessionId, phoneE164);
      if (tokens.length > 0) {
        logger.info({ sessionId }, 'Recovering dropped USSD session by replaying prior inputs');
        await replaySession(session, tokens.slice(0, -1));
      }
    }

    const latestInput = tokens.length > 0 ? (tokens[tokens.length - 1] as string) : ENTER_SENTINEL;
    const result = await dispatch(session, latestInput);

    if (result.continueSession) {
      await saveSession(session);
    }

    res.set('Content-Type', 'text/plain');
    res.send(result.response);
  } catch (err) {
    logger.error({ err, sessionId }, 'Unhandled error processing USSD request');
    res.set('Content-Type', 'text/plain');
    res.send('END Sorry, something went wrong. Please try again.');
  }
});
