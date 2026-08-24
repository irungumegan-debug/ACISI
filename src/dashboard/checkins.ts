import { Router } from 'express';
import dayjs from 'dayjs';
import { prisma } from '../db/prisma';
import { requireStaffSession, AuthenticatedRequest } from './auth';

export const checkinsRouter = Router();

checkinsRouter.use(requireStaffSession);

/** Initial snapshot of today's arrivals; live updates arrive via /events (SSE) after this loads. */
checkinsRouter.get('/today', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const startOfToday = dayjs().startOf('day').toDate();

  const checkIns = await prisma.checkIn.findMany({
    where: { clinicId, status: 'PAID', paidAt: { gte: startOfToday } },
    orderBy: { paidAt: 'desc' },
    include: { patient: { select: { firstName: true, lastName: true } } },
  });

  res.json({
    checkIns: checkIns.map((c) => ({
      checkInId: c.id,
      patientId: c.patientId,
      patientName: `${c.patient.firstName} ${c.patient.lastName}`,
      amountKes: Number(c.amountKes),
      paidAt: c.paidAt,
    })),
  });
});
