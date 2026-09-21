import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import {
  EncounterNotAccessibleError,
  EncounterNotConsultableError,
  getDoctorQueue,
  getEncounterForDoctor,
  submitConsultation,
} from '../services/encounterService';

export const doctorRouter = Router();

doctorRouter.use(requireStaffSession);

/** A doctor is always department-scoped; a session with no departmentId (front desk, admin) can't reach any of these routes. */
function requireDoctor(req: Request, res: Response, next: NextFunction): void {
  const { role, departmentId } = (req as AuthenticatedRequest).dashboardSession;
  if (role !== 'DOCTOR' || !departmentId) {
    res.status(403).json({ error: 'Doctor access required' });
    return;
  }
  next();
}

doctorRouter.use(requireDoctor);

doctorRouter.get('/queue', async (req, res) => {
  const { clinicId, departmentId } = (req as AuthenticatedRequest).dashboardSession;
  const queue = await getDoctorQueue(clinicId, departmentId as string);
  res.json({ queue });
});

doctorRouter.get('/encounters/:id', async (req, res) => {
  const { clinicId, departmentId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const detail = await getEncounterForDoctor(req.params.id as string, clinicId, departmentId as string, staffId);
    res.json(detail);
  } catch (err) {
    if (err instanceof EncounterNotAccessibleError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const consultSchema = z.object({
  diagnosis: z.string().min(1),
  prescription: z.string().min(1),
});

doctorRouter.post('/encounters/:id/consult', async (req, res) => {
  const parsed = consultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Diagnosis and prescription are required' });
    return;
  }

  const { clinicId, departmentId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const encounter = await submitConsultation({
      encounterId: req.params.id as string,
      clinicId,
      departmentId: departmentId as string,
      staffId,
      diagnosis: parsed.data.diagnosis,
      prescription: parsed.data.prescription,
    });
    res.json({ encounterId: encounter.id, status: encounter.status });
  } catch (err) {
    if (err instanceof EncounterNotAccessibleError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof EncounterNotConsultableError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});
