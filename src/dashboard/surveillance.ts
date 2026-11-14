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
import { NOTIFIABLE_LIST_CONFIRMED } from '../services/notifiableDiseases';
import { recordAuditEvent } from '../services/auditService';

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
const doctorsAndAdmins = allow(['DOCTOR', 'ADMIN']);

surveillanceRouter.get('/cases', doctorsOnly, async (req, res) => {
  const { clinicId } = session(req);
  const cases = await listNotifiableCases(clinicId, { unreportedOnly: req.query.unreported === '1' });
  res.json({ cases, listConfirmed: NOTIFIABLE_LIST_CONFIRMED });
});

/** For the menu badge. */
surveillanceRouter.get('/unreported-count', doctorsOnly, async (req, res) => {
  res.json({ count: await countUnreportedImmediate(session(req).clinicId) });
});

const reportedSchema = z.object({ note: z.string().max(500).nullish() });

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
