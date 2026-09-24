import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { prisma } from '../db/prisma';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { CheckInNotPendingError, confirmCheckInPaidManually } from '../services/checkInService';
import { CheckoutDeliveryMethod, EncounterNotReadyForCheckoutError, checkoutEncounter } from '../services/encounterService';
import { emailConfigured } from '../config/email';

export const checkinsRouter = Router();

checkinsRouter.use(requireStaffSession);

/**
 * Initial snapshot of today's arrivals; live updates arrive via /events
 * (SSE) after this loads. Includes PENDING_PAYMENT and FAILED rows (not
 * just PAID) so front desk can manually confirm the ACISI check-in fee
 * whenever the automated M-Pesa flow hasn't gone through yet or didn't
 * succeed, for any patient — CANCELLED check-ins aren't actionable so those
 * are still left out.
 */
checkinsRouter.get('/today', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const startOfToday = dayjs().startOf('day').toDate();

  const checkIns = await prisma.checkIn.findMany({
    where: { clinicId, createdAt: { gte: startOfToday }, status: { in: ['PENDING_PAYMENT', 'PAID', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      patient: { select: { firstName: true, lastName: true, patientCode: true, phoneNumber: true, email: true } },
      department: { select: { name: true } },
      encounter: { select: { id: true, status: true, assignedDoctor: { select: { name: true } } } },
    },
  });

  res.json({
    // Whether checkout can even offer email delivery at all — separate
    // from whether any given patient has an email on file, checked
    // per-row below. The dashboard only shows the email option when both
    // are true.
    emailDeliveryAvailable: emailConfigured,
    checkIns: checkIns.map((c) => ({
      checkInId: c.id,
      encounterId: c.encounter?.id ?? null,
      patientId: c.patientId,
      patientName: `${c.patient.firstName} ${c.patient.lastName}`,
      patientCode: c.patient.patientCode,
      phoneNumber: c.patient.phoneNumber,
      patientEmail: c.patient.email,
      departmentName: c.department.name,
      amountKes: Number(c.amountKes),
      checkInStatus: c.status,
      encounterStatus: c.encounter?.status ?? null,
      assignedDoctorName: c.encounter?.assignedDoctor?.name ?? null,
      paidAt: c.paidAt,
      createdAt: c.createdAt,
    })),
  });
});

/**
 * Real, permanent, audited manual confirmation of ACISI's own check-in fee
 * — rescues a check-in for any patient at any clinic when the automated
 * M-Pesa STK flow didn't go through. Never touches or replaces the STK
 * push flow itself.
 */
checkinsRouter.post('/:id/confirm-payment', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const checkIn = await confirmCheckInPaidManually(req.params.id as string, clinicId, staffId);
    res.json({ checkInId: checkIn.id, status: checkIn.status });
  } catch (err) {
    if (err instanceof CheckInNotPendingError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message === 'Check-in not found') {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const checkoutSchema = z.object({ deliveryMethod: z.enum(['sms', 'sms_and_email']).optional() });

/**
 * Completes the visit and triggers the visit summary — only once the
 * doctor's consultation has moved the encounter to READY_FOR_CHECKOUT.
 * Keyed by checkInId (front desk's natural unit) even though the state
 * lives on Encounter, since CheckIn:Encounter is 1:1. The SMS summary
 * always fires; deliveryMethod only controls whether email is *also* sent
 * — see encounterService.checkoutEncounter.
 */
checkinsRouter.post('/:id/checkout', async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  const encounter = await prisma.encounter.findFirst({ where: { checkInId: req.params.id as string, clinicId } });
  if (!encounter) {
    res.status(404).json({ error: 'Visit not found' });
    return;
  }

  try {
    const deliveryMethod: CheckoutDeliveryMethod = parsed.data.deliveryMethod ?? 'sms';
    const updated = await checkoutEncounter(encounter.id, clinicId, staffId, deliveryMethod);
    res.json({ encounterId: updated.id, status: updated.status });
  } catch (err) {
    if (err instanceof EncounterNotReadyForCheckoutError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});
