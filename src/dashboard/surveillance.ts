import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import {
  countUnreportedImmediate,
  isWeekStart,
  lastFullWeekStart,
  listNotifiableCases,
  markCaseReported,
  NotifiableCaseNotFoundError,
  weeklySummary,
  weeklySummaryCsv,
} from '../services/notifiableDiseaseService';
import { NOTIFIABLE_LIST_CONFIRMED, NOTIFIABLE_LIST_SOURCE } from '../services/notifiableDiseases';
import { recordAuditEvent } from '../services/auditService';
import {
  countUnreportedEvents,
  EVENT_TYPES,
  EventNotFoundError,
  InvalidEventError,
  listPublicHealthEvents,
  markEventReported,
  recordEventSchema,
  recordPublicHealthEvent,
} from '../services/publicHealthEventService';

/**
 * Disease surveillance (IDSR), mounted at /api/staff/surveillance.
 * - Case list and "reported": doctors only (names the patient and the disease).
 * - Weekly counts and CSV: doctors and clinic admins (numbers only, no names).
 */
export const surveillanceRouter = Router();

surveillanceRouter.use(requireStaffSession);

const session = (req: Request) => (req as AuthenticatedRequest).dashboardSession;

function allow(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!roles.includes(session(req).role)) {
      res.status(403).json({ error: 'Not available for your role' });
      return;
    }
    next();
  };
}

const doctorsOnly = allow(['DOCTOR']);
const reportedSchema = z.object({ note: z.string().max(500).nullish() });
const doctorsAndAdmins = allow(['DOCTOR', 'ADMIN']);

surveillanceRouter.get('/cases', doctorsOnly, async (req, res) => {
  const { clinicId } = session(req);
  const cases = await listNotifiableCases(clinicId, { unreportedOnly: req.query.unreported === '1' });
  res.json({ cases, listConfirmed: NOTIFIABLE_LIST_CONFIRMED, listSource: NOTIFIABLE_LIST_SOURCE });
});

/** For the menu badge: immediately reportable cases (doctors) and events (doctors and admins) not yet reported. */
surveillanceRouter.get('/unreported-count', doctorsAndAdmins, async (req, res) => {
  const { clinicId, role } = session(req);
  const [cases, events] = await Promise.all([role === 'DOCTOR' ? countUnreportedImmediate(clinicId) : 0, countUnreportedEvents(clinicId)]);
  res.json({ count: cases + events });
});

// ---- Public health events (counts only, no patient names): doctors and admins ----

surveillanceRouter.get('/events', doctorsAndAdmins, async (req, res) => {
  res.json({
    events: await listPublicHealthEvents(session(req).clinicId),
    types: Object.entries(EVENT_TYPES).map(([code, t]) => ({ code, label: t.label, immediate: t.immediate })),
  });
});

surveillanceRouter.post('/events', doctorsAndAdmins, async (req, res) => {
  const parsed = recordEventSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Check the event details' });
    return;
  }
  const { clinicId, staffId } = session(req);
  try {
    const event = await recordPublicHealthEvent({ ...parsed.data, clinicId, staffId });
    res.status(201).json({ id: event.id, immediate: EVENT_TYPES[event.type].immediate });
  } catch (err) {
    if (err instanceof InvalidEventError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

surveillanceRouter.post('/events/:id/reported', doctorsAndAdmins, async (req, res) => {
  const parsed = reportedSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Keep the note under 500 characters' });
    return;
  }
  const { clinicId, staffId } = session(req);
  try {
    await markEventReported({ eventId: req.params.id as string, clinicId, staffId, note: parsed.data.note });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

surveillanceRouter.post('/cases/:id/reported', doctorsOnly, async (req, res) => {
  const parsed = reportedSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Keep the note under 500 characters' });
    return;
  }
  const { clinicId, staffId } = session(req);
  try {
    await markCaseReported({ caseId: req.params.id as string, clinicId, staffId, note: parsed.data.note });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof NotifiableCaseNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

function weekParam(req: Request, res: Response): string | null {
  const week = typeof req.query.week === 'string' && req.query.week ? req.query.week : lastFullWeekStart();
  if (!isWeekStart(week)) {
    res.status(400).json({ error: 'week must be a Monday, as YYYY-MM-DD' });
    return null;
  }
  return week;
}

surveillanceRouter.get('/weekly', doctorsAndAdmins, async (req, res) => {
  const week = weekParam(req, res);
  if (!week) return;
  res.json(await weeklySummary(session(req).clinicId, week));
});

surveillanceRouter.get('/weekly.csv', doctorsAndAdmins, async (req, res) => {
  const week = weekParam(req, res);
  if (!week) return;
  const { clinicId, staffId } = session(req);
  const summary = await weeklySummary(clinicId, week);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'IDSR_WEEKLY_SUMMARY_DOWNLOADED',
    entityType: 'Clinic',
    entityId: clinicId,
    metadata: { week },
  });
  res
    .type('text/csv; charset=utf-8')
    .attachment(`idsr-weekly-${week}.csv`)
    .send(weeklySummaryCsv(summary));
});
