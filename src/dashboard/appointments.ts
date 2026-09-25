import { Response, Router } from 'express';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import {
  AppointmentNotActionableError,
  AppointmentNotFoundError,
  cancelAppointmentByStaff,
  confirmAppointment,
  listClinicAppointments,
} from '../services/appointmentService';
import { checkInPatientForAppointment } from '../services/checkInService';

export const appointmentsRouter = Router();

// Same gating as checkinsRouter — any authenticated staff session, not
// admin-only, since front desk (not just admins) needs to work this list day
// to day.
appointmentsRouter.use(requireStaffSession);

appointmentsRouter.get('/', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const appointments = await listClinicAppointments(clinicId);
  res.json({ appointments });
});

function handleAppointmentActionError(err: unknown, res: Response): void {
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

appointmentsRouter.post('/:id/confirm', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const appointment = await confirmAppointment({ clinicId, appointmentId: req.params.id as string, staffId });
    res.json({ appointmentId: appointment.id, status: appointment.status });
  } catch (err) {
    handleAppointmentActionError(err, res);
  }
});

appointmentsRouter.post('/:id/cancel', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const appointment = await cancelAppointmentByStaff({ clinicId, appointmentId: req.params.id as string, staffId });
    res.json({ appointmentId: appointment.id, status: appointment.status });
  } catch (err) {
    handleAppointmentActionError(err, res);
  }
});

/**
 * Staff checking a booked patient in directly (as opposed to the patient
 * doing it themselves via the portal) — creates the same kind of CheckIn,
 * fee and STK push included, just pre-linked to this appointment.
 */
appointmentsRouter.post('/:id/arrive', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const { checkIn } = await checkInPatientForAppointment(req.params.id as string, clinicId, staffId);
    res.status(201).json({ checkInId: checkIn.id, status: checkIn.status });
  } catch (err) {
    handleAppointmentActionError(err, res);
  }
});
