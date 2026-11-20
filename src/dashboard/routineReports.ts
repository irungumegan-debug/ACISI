import { Request, Response, Router } from 'express';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { buildRoutineReport, InvalidPeriodError, lastFullMonth, parsePeriod, PeriodBounds, routineReportCsv } from '../services/routineReportService';
import { recordAuditEvent } from '../services/auditService';
import { buildQualityMeasures, qualityMeasuresCsv } from '../services/qualityMeasureService';
import { prisma } from '../db/prisma';

/**
 * Routine reports (monthly, quarterly, annual) at /api/staff/routine-reports:
 * counts only, no patient names. Doctors and clinic admins.
 */
export const routineReportsRouter = Router();

routineReportsRouter.use(requireStaffSession);
routineReportsRouter.use((req, res, next) => {
  if (!['DOCTOR', 'ADMIN'].includes((req as AuthenticatedRequest).dashboardSession.role)) {
    res.status(403).json({ error: 'Not available for your role' });
    return;
  }
  next();
});

function periodFrom(req: Request, res: Response): PeriodBounds | null {
  const period = typeof req.query.period === 'string' ? req.query.period.toUpperCase() : 'MONTH';
  const value = typeof req.query.value === 'string' && req.query.value ? req.query.value : lastFullMonth();
  try {
    return parsePeriod(period, value);
  } catch (err) {
    if (err instanceof InvalidPeriodError) {
      res.status(400).json({ error: err.message });
      return null;
    }
    throw err;
  }
}

routineReportsRouter.get('/', async (req, res) => {
  const p = periodFrom(req, res);
  if (!p) return;
  res.json(await buildRoutineReport((req as AuthenticatedRequest).dashboardSession.clinicId, p));
});

routineReportsRouter.get('/csv', async (req, res) => {
  const p = periodFrom(req, res);
  if (!p) return;
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const report = await buildRoutineReport(clinicId, p);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'ROUTINE_REPORT_DOWNLOADED',
    entityType: 'Clinic',
    entityId: clinicId,
    metadata: { period: p.period, value: p.value },
  });
  res.type('text/csv; charset=utf-8').attachment(`acisi-${p.period.toLowerCase()}-report-${p.value}.csv`).send(routineReportCsv(report));
});

/** Quality-of-care measures for the period (counts and percentages, no names). */
routineReportsRouter.get('/quality', async (req, res) => {
  const p = periodFrom(req, res);
  if (!p) return;
  res.json(await buildQualityMeasures((req as AuthenticatedRequest).dashboardSession.clinicId, p));
});

routineReportsRouter.get('/quality/csv', async (req, res) => {
  const p = periodFrom(req, res);
  if (!p) return;
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const [report, clinic] = await Promise.all([buildQualityMeasures(clinicId, p), prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true } })]);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'QUALITY_MEASURES_DOWNLOADED',
    entityType: 'Clinic',
    entityId: clinicId,
    metadata: { period: p.period, value: p.value },
  });
  res.type('text/csv; charset=utf-8').attachment(`acisi-quality-measures-${p.value}.csv`).send(qualityMeasuresCsv(clinic?.name ?? '', report));
});
