import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest, isFrontDeskRole, requireStaffSession } from './auth';
import { closeServiceOrder, listServiceOrders, ServiceOrderError } from '../services/serviceOrderService';

/**
 * Front desk: a visit's radiology, therapy and other orders, to arrange at
 * checkout, and marking each one done (done here, referred or booked) or not
 * needed. The doctor places and withdraws them (routes in doctor.ts).
 */
export const serviceOrdersRouter = Router();
serviceOrdersRouter.use(requireStaffSession);

const session = (req: unknown) => (req as AuthenticatedRequest).dashboardSession;

serviceOrdersRouter.get('/encounters/:encounterId', async (req, res) => {
  const { clinicId, role } = session(req);
  if (!isFrontDeskRole(role)) {
    res.status(403).json({ error: 'Front desk only' });
    return;
  }
  const encounter = await prisma.encounter.findFirst({ where: { id: req.params.encounterId, clinicId }, select: { id: true } });
  if (!encounter) {
    res.status(404).json({ error: 'Visit not found' });
    return;
  }
  res.json({ orders: await listServiceOrders(encounter.id) });
});

const closeSchema = z.object({ outcome: z.enum(['DONE', 'CANCELLED']) });

serviceOrdersRouter.post('/encounters/:encounterId/:orderId/close', async (req, res) => {
  const { clinicId, staffId, role } = session(req);
  if (!isFrontDeskRole(role)) {
    res.status(403).json({ error: 'Front desk only' });
    return;
  }
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose done or not needed' });
    return;
  }
  try {
    res.json({ orders: await closeServiceOrder({ orderId: req.params.orderId, encounterId: req.params.encounterId, clinicId, staffId, outcome: parsed.data.outcome }) });
  } catch (err) {
    if (err instanceof ServiceOrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});
