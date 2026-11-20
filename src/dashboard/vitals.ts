import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, isFrontDeskRole, requireStaffSession } from './auth';
import { assertEncounterInDoctorQueue } from '../services/encounterService';
import { getDoctorDepartmentIds } from '../services/departmentService';
import { getVitalSigns, recordVitalSigns, VitalSignsError } from '../services/vitalSignsService';

/**
 * Vital signs for a visit. Front desk (triage) on any visit at the clinic; a
 * doctor on visits in their own queue. Lab technicians: no.
 */
export const vitalsRouter = Router();
vitalsRouter.use(requireStaffSession);

async function allowed(req: Request, res: Response): Promise<boolean> {
  const { clinicId, staffId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  if (isFrontDeskRole(role)) return true;
  if (role === 'DOCTOR') {
    try {
      await assertEncounterInDoctorQueue(req.params.encounterId as string, clinicId, await getDoctorDepartmentIds(staffId), staffId);
      return true;
    } catch {
      res.status(404).json({ error: 'Visit not found' });
      return false;
    }
  }
  res.status(403).json({ error: 'Not available for your role' });
  return false;
}

const num = z.number().nullish();
const vitalsSchema = z.object({
  systolic: num,
  diastolic: num,
  pulse: num,
  respiratoryRate: num,
  temperatureC: num,
  oxygenSaturation: num,
  weightKg: num,
  heightCm: num,
  muacCm: num,
});

function sendError(err: unknown, res: Response): void {
  if (err instanceof VitalSignsError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

vitalsRouter.get('/encounters/:encounterId', async (req, res) => {
  if (!(await allowed(req, res))) return;
  const { clinicId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await getVitalSigns(req.params.encounterId as string, clinicId));
  } catch (err) {
    sendError(err, res);
  }
});

vitalsRouter.post('/encounters/:encounterId', async (req, res) => {
  if (!(await allowed(req, res))) return;
  const parsed = vitalsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter the measurements as numbers' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.status(201).json(await recordVitalSigns({ encounterId: req.params.encounterId as string, clinicId, staffId, values: parsed.data }));
  } catch (err) {
    sendError(err, res);
  }
});
