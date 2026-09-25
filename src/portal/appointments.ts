import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requirePatientSession, AuthenticatedPatientRequest } from './auth';
import {
  AppointmentNotActionableError,
  AppointmentNotFoundError,
  PastScheduledTimeError,
  cancelOwnAppointment,
  listOwnAppointments,
  requestAppointment,
} from '../services/appointmentService';

export const portalAppointmentsRouter = Router();

portalAppointmentsRouter.use(requirePatientSession);

const requestSchema = z.object({
  clinicId: z.string().min(1),
  departmentId: z.string().min(1),
  scheduledFor: z.string().min(1),
});

/**
 * Books a future-dated appointment — separate from portalCheckinRouter's
 * same-day walk-in check-in. Same clinic/department validity checks as that
 * route, so a booking can only ever target a real, active clinic+department.
 */
portalAppointmentsRouter.post('/', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'clinicId, departmentId, and scheduledFor are required' });
    return;
  }

  const scheduledFor = new Date(parsed.data.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) {
    res.status(400).json({ error: 'scheduledFor must be a valid date/time' });
    return;
  }

  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;

  const [clinic, department] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: parsed.data.clinicId } }),
    prisma.department.findFirst({ where: { id: parsed.data.departmentId, clinicId: parsed.data.clinicId, isActive: true } }),
  ]);

  if (!clinic || !clinic.isActive) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }
  if (!department) {
    res.status(400).json({ error: 'Please choose a valid department' });
    return;
  }

  try {
    const appointment = await requestAppointment({
      patientId,
      clinicId: clinic.id,
      departmentId: department.id,
      scheduledFor,
    });
    res.status(201).json({ appointmentId: appointment.id, status: appointment.status });
  } catch (err) {
    if (err instanceof PastScheduledTimeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

portalAppointmentsRouter.get('/', async (req, res) => {
  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;
  const appointments = await listOwnAppointments(patientId);
  res.json({ appointments });
});

portalAppointmentsRouter.post('/:id/cancel', async (req, res) => {
  const { patientId } = (req as unknown as AuthenticatedPatientRequest).patientSession;

  try {
    const appointment = await cancelOwnAppointment(patientId, req.params.id as string);
    res.json({ appointmentId: appointment.id, status: appointment.status });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof AppointmentNotActionableError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});
