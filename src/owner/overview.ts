import { Router } from 'express';
import { prisma } from '../db/prisma';

export const ownerOverviewRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows belonging to a real clinic, never a demo one. */
const REAL_CLINIC = { clinic: { isDemo: false } } as const;

/**
 * Platform-wide headline numbers for the owner site's home page. Counts only
 * — no patient data. Demo clinics (Clinic.isDemo), their staff, fake patients,
 * visits and simulated check-in fees are left out of every number.
 */
ownerOverviewRouter.get('/', async (_req, res) => {
  const since30Days = new Date(Date.now() - 30 * DAY_MS);

  const [
    activeClinics,
    totalClinics,
    activeStaff,
    totalStaff,
    activeDoctors,
    activePatients,
    deletedPatients,
    totalVisits,
    visitsLast30Days,
    upcomingAppointments,
    revenueAll,
    revenueLast30Days,
  ] = await Promise.all([
    prisma.clinic.count({ where: { isActive: true, isDemo: false } }),
    prisma.clinic.count({ where: { isDemo: false } }),
    prisma.staff.count({ where: { isActive: true, ...REAL_CLINIC } }),
    prisma.staff.count({ where: REAL_CLINIC }),
    prisma.staff.count({ where: { isActive: true, role: 'DOCTOR', ...REAL_CLINIC } }),
    prisma.patient.count({ where: { deletedAt: null, demoClinicId: null } }),
    prisma.patient.count({ where: { deletedAt: { not: null }, demoClinicId: null } }),
    prisma.encounter.count({ where: REAL_CLINIC }),
    prisma.encounter.count({ where: { createdAt: { gte: since30Days }, ...REAL_CLINIC } }),
    prisma.appointment.count({
      where: { status: { in: ['REQUESTED', 'CONFIRMED'] }, scheduledFor: { gte: new Date() }, ...REAL_CLINIC },
    }),
    prisma.checkIn.aggregate({ where: { status: 'PAID', ...REAL_CLINIC }, _sum: { amountKes: true } }),
    prisma.checkIn.aggregate({ where: { status: 'PAID', paidAt: { gte: since30Days }, ...REAL_CLINIC }, _sum: { amountKes: true } }),
  ]);

  res.json({
    clinics: { active: activeClinics, total: totalClinics },
    staff: { active: activeStaff, total: totalStaff },
    doctors: { active: activeDoctors },
    patients: { active: activePatients, deleted: deletedPatients },
    visits: { total: totalVisits, last30Days: visitsLast30Days },
    upcomingAppointments,
    revenueKes: {
      total: Number(revenueAll._sum.amountKes ?? 0),
      last30Days: Number(revenueLast30Days._sum.amountKes ?? 0),
    },
  });
});
