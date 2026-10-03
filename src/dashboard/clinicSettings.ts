import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireStaffSession, requireAdmin, AuthenticatedRequest } from './auth';
import { regenerateInviteCode } from '../services/clinicService';
import { recordAuditEvent } from '../services/auditService';
import { getPaymentSettings } from '../services/billingService';
import { MAX_AMOUNT_KES } from '../services/billingMath';
import { clinicStkConfigured } from '../mpesa/clinicStk';
import { env } from '../config/env';
import {
  InvalidPinFormatError,
  StaffIsNotADoctorError,
  StaffNotFoundError,
  listClinicStaff,
  resetStaffPinByAdmin,
  setDoctorPresenceByAdmin,
} from '../services/staffService';

export const clinicSettingsRouter = Router();

clinicSettingsRouter.use(requireStaffSession, requireAdmin);

clinicSettingsRouter.get('/invite-code', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { inviteCode: true } });
  if (!clinic) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }
  res.json({ inviteCode: clinic.inviteCode });
});

clinicSettingsRouter.post('/invite-code/regenerate', async (req, res) => {
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const inviteCode = await regenerateInviteCode(clinicId, staffId);
  res.json({ inviteCode });
});

clinicSettingsRouter.get('/staff', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const staff = await listClinicStaff(clinicId);
  res.json({ staff });
});

const resetPinSchema = z.object({ newPin: z.string().optional() });

/**
 * Resets one staff/doctor's PIN, scoped to the requesting admin's own
 * clinic. Returns the new PIN in plaintext exactly once, for the admin to
 * relay directly — never stored or logged in that form anywhere.
 */
clinicSettingsRouter.post('/staff/:id/reset-pin', async (req, res) => {
  const parsed = resetPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const result = await resetStaffPinByAdmin({
      clinicId,
      staffId: req.params.id as string,
      requestedByStaffId: staffId,
      newPin: parsed.data.newPin,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof StaffNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidPinFormatError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const presenceSchema = z.object({ status: z.enum(['IN', 'OUT']) });

/** Lets a clinic admin mark one of their own doctors in/out for today, e.g. on a doctor's behalf for a planned absence. */
clinicSettingsRouter.post('/staff/:id/presence', async (req, res) => {
  const parsed = presenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'status must be IN or OUT' });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const result = await setDoctorPresenceByAdmin({
      clinicId,
      staffId: req.params.id as string,
      requestedByStaffId: staffId,
      status: parsed.data.status,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof StaffNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof StaffIsNotADoctorError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// --- Payment settings (clinic admin only, like everything on this router) ---

const paymentSettingsSchema = z
  .object({
    acceptsCash: z.boolean(),
    acceptsCard: z.boolean(),
    acceptsMobileMoney: z.boolean(),
    mobileMoneyType: z.enum(['TILL', 'PAYBILL']).nullish(),
    mobileMoneyNumber: z
      .string()
      .trim()
      .regex(/^\d{5,7}$/, 'Till and paybill numbers are 5 to 7 digits')
      .nullish()
      .or(z.literal('')),
    paybillAccountFormat: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9-]*(\{(patientCode|billNumber)\}[A-Za-z0-9-]*)*$/, 'Use letters, numbers, - and {patientCode} or {billNumber}')
      .nullish()
      .or(z.literal('')),
    defaultConsultationFeeKes: z.number().int('Use a whole number of KES').min(0).max(MAX_AMOUNT_KES),
  })
  .refine((s) => s.acceptsCash || s.acceptsCard || s.acceptsMobileMoney, { message: 'Accept at least one payment method' })
  .refine((s) => !s.acceptsMobileMoney || (s.mobileMoneyType && s.mobileMoneyNumber), {
    message: 'Choose till or paybill and enter the number to accept mobile money',
  });

clinicSettingsRouter.get('/payment-settings', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const settings = await getPaymentSettings(clinicId);
  res.json({
    acceptsCash: settings.acceptsCash,
    acceptsCard: settings.acceptsCard,
    acceptsMobileMoney: settings.acceptsMobileMoney,
    mobileMoneyType: settings.mobileMoneyType,
    mobileMoneyNumber: settings.mobileMoneyNumber,
    paybillAccountFormat: settings.paybillAccountFormat,
    defaultConsultationFeeKes: settings.defaultConsultationFeeKes,
    stkConfigured: clinicStkConfigured(),
    stkMode: env.CLINIC_MPESA_ENV,
  });
});

clinicSettingsRouter.put('/payment-settings', async (req, res) => {
  const parsed = paymentSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' });
    return;
  }
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const s = parsed.data;
  const data = {
    acceptsCash: s.acceptsCash,
    acceptsCard: s.acceptsCard,
    acceptsMobileMoney: s.acceptsMobileMoney,
    mobileMoneyType: s.mobileMoneyType || null,
    mobileMoneyNumber: s.mobileMoneyNumber || null,
    paybillAccountFormat: s.mobileMoneyType === 'PAYBILL' ? s.paybillAccountFormat || null : null,
    defaultConsultationFeeKes: s.defaultConsultationFeeKes,
    updatedByStaffId: staffId,
  };
  await prisma.clinicPaymentSettings.upsert({ where: { clinicId }, create: { clinicId, ...data }, update: data });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'PAYMENT_SETTINGS_UPDATED',
    entityType: 'Clinic',
    entityId: clinicId,
    metadata: { ...data, updatedByStaffId: undefined },
  });
  res.json({ ok: true });
});
