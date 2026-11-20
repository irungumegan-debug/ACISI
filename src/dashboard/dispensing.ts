import { Router } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, isFrontDeskRole, requireStaffSession } from './auth';
import { DispensingError, listDispensing, recordDispensing } from '../services/dispensingService';

/** Front desk at checkout: record which prescribed medicines the clinic gave (and how much). */
export const dispensingRouter = Router();
dispensingRouter.use(requireStaffSession);
dispensingRouter.use((req, res, next) => {
  if (!isFrontDeskRole((req as AuthenticatedRequest).dashboardSession.role)) {
    res.status(403).json({ error: 'Front desk only' });
    return;
  }
  next();
});

const send = (res: import('express').Response, err: unknown) => {
  if (err instanceof DispensingError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
};

dispensingRouter.get('/encounters/:encounterId', async (req, res) => {
  try {
    res.json({ items: await listDispensing(req.params.encounterId, (req as unknown as AuthenticatedRequest).dashboardSession.clinicId) });
  } catch (err) {
    send(res, err);
  }
});

const schema = z.object({ status: z.enum(['DISPENSED', 'NOT_DISPENSED']), quantity: z.number().nullish() });

dispensingRouter.post('/encounters/:encounterId/items/:itemId', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose given or not given' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.json({ items: await recordDispensing({ encounterId: req.params.encounterId, itemId: req.params.itemId, clinicId, staffId, ...parsed.data }) });
  } catch (err) {
    send(res, err);
  }
});
