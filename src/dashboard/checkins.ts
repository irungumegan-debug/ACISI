import { Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import {
  completeConsultation,
  EncounterNotFoundError,
  InvalidConsultationTransitionError,
  listTodayQueue,
  startConsultation,
} from '../services/consultationService';

export const checkinsRouter = Router();

checkinsRouter.use(requireStaffSession);

/**
 * Today's front-desk queue for this clinic, optionally filtered by
 * department. Initial snapshot on page load; the dashboard polls this every
 * few seconds to pick up status changes from other staff tabs and new
 * arrivals — see docs/ARCHITECTURE.md for why polling (not a second SSE
 * channel) was enough here.
 */
checkinsRouter.get('/today', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const departmentId = typeof req.query.department === 'string' ? req.query.department : undefined;

  const queue = await listTodayQueue(clinicId, departmentId);
  res.json({ queue });
});

checkinsRouter.post('/:encounterId/start', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  const encounterId = req.params.encounterId as string;

  try {
    const encounter = await startConsultation(encounterId, { staffId, clinicId });
    res.json({ encounterId: encounter.id, consultationStatus: encounter.consultationStatus });
  } catch (err) {
    if (err instanceof EncounterNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidConsultationTransitionError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const checkoutSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
  prescription: z.string().trim().max(2000).optional(),
});

checkinsRouter.post('/:encounterId/checkout', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  const encounterId = req.params.encounterId as string;

  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid checkout details' });
    return;
  }

  try {
    const encounter = await completeConsultation(encounterId, { staffId, clinicId }, parsed.data);
    res.json({ encounterId: encounter.id, consultationStatus: encounter.consultationStatus });
  } catch (err) {
    if (err instanceof EncounterNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidConsultationTransitionError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});
