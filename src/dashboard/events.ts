import { Router } from 'express';
import { requireStaffSession, AuthenticatedRequest, isFrontDeskRole } from './auth';
import { subscribeCheckInPaid } from '../services/realtimeEvents';
import { loadDashboardSession, SESSION_COOKIE_NAME } from './session';

export const eventsRouter = Router();

eventsRouter.use(requireStaffSession);

/**
 * Server-Sent Events stream of this clinic's check-in arrivals. One-directional
 * (server -> browser) is all the live queue needs, so SSE over EventSource —
 * no WebSocket upgrade, no extra protocol handling.
 */
eventsRouter.get('/', (req, res) => {
  const { clinicId, role } = (req as AuthenticatedRequest).dashboardSession;
  // Doctors only see their own departments' patients and lab technicians
  // only the lab queue, so every role but front desk gets a bare "something
  // changed" ping and refetches its own scoped list: never the clinic-wide
  // event with patient details in it.
  const isDoctor = !isFrontDeskRole(role);

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const unsubscribe = subscribeCheckInPaid(clinicId, (event) => {
    res.write(`data: ${JSON.stringify(isDoctor ? { type: 'QUEUE_CHANGED' } : event)}\n\n`);
  });

  // Keeps the connection alive through proxies/load balancers that would
  // otherwise time out an idle HTTP connection.
  // Every heartbeat also re-checks the session, so a screen logged off for
  // inactivity (or a deactivated account) stops receiving the live queue.
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  const heartbeat = setInterval(() => {
    void (token ? loadDashboardSession(token) : Promise.resolve(null))
      .then((still) => {
        if (!still) {
          clearInterval(heartbeat);
          unsubscribe();
          res.end();
          return;
        }
        res.write(': heartbeat\n\n');
      })
      .catch(() => res.write(': heartbeat\n\n'));
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
