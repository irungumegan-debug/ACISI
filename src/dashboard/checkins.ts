import { Router } from 'express';
import dayjs from 'dayjs';
import { prisma } from '../db/prisma';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { CheckInNotPendingError, confirmCheckInPaidManually } from '../services/checkInService';
import { EncounterNotReadyForCheckoutError, checkoutEncounter } from '../services/encounterService';

export const checkinsRouter = Router();

checkinsRouter.use(requireStaffSession);

/**
 * Initial snapshot of today's arrivals; live updates arrive via /events
 * (SSE) after this loads. Includes PENDING_PAYMENT rows too (not just PAID)
 * so front desk can manually confirm payment for a bank-only clinic —
 * FAILED/CANCELLED check-ins aren't actionable so they're left out.
 */
checkinsRouter.get('/today', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const startOfToday = dayjs().startOf('day').toDate();

  const checkIns = await prisma.checkIn.findMany({
    where: { clinicId, createdAt: { gte: startOfToday }, status: { in: ['PENDING_PAYMENT', 'PAID'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      patient: { select: { firstName: true, lastName: true, patientCode: true, phoneNumber: true } },
      department: { select: { name: true } },
      encounter: { select: { id: true, status: true, assignedDoctor: { select: { name: true } } } },
    },
  });

  res.json({
    checkIns: checkIns.map((c) => ({
      checkInId: c.id,
      encounterId: c.encounter?.id ?? null,
      patientId: c.patientId,
      patientName: `${c.patient.firstName} ${c.patient.lastName}`,
      patientCode: c.patient.patientCode,
      phoneNumber: c.patient.phoneNumber,
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
 * Real, permanent, audited manual payment confirmation — for a clinic that
 * is bank-only or takes payment through its own till, without M-Pesa STK.
 * Never touches or replaces the STK push flow.
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

/**
 * Completes the visit and triggers the SMS visit summary — only once the
 * doctor's consultation has moved the encounter to READY_FOR_CHECKOUT.
 * Keyed by checkInId (front desk's natural unit) even though the state
 * lives on Encounter, since CheckIn:Encounter is 1:1.
 */
checkinsRouter.post('/:id/checkout', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  const encounter = await prisma.encounter.findFirst({ where: { checkInId: req.params.id as string, clinicId } });
  if (!encounter) {
    res.status(404).json({ error: 'Visit not found' });
    return;
  }

  try {
    const updated = await checkoutEncounter(encounter.id, clinicId, staffId);
    res.json({ encounterId: updated.id, status: updated.status });
  } catch (err) {
    if (err instanceof EncounterNotReadyForCheckoutError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});
