import { Router } from 'express';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { subscribeCheckInPaid } from '../services/realtimeEvents';

export const eventsRouter = Router();

eventsRouter.use(requireStaffSession);

/**
 * Server-Sent Events stream of this clinic's check-in arrivals. One-directional
 * (server -> browser) is all the live queue needs, so SSE over EventSource —
 * no WebSocket upgrade, no extra protocol handling.
 */
eventsRouter.get('/', (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const unsubscribe = subscribeCheckInPaid(clinicId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Keeps the connection alive through proxies/load balancers that would
  // otherwise time out an idle HTTP connection.
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
