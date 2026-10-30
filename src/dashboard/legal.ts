import { Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import {
  CURRENT_LEGAL_VERSIONS,
  recordLegalAcceptances,
  staffNeedsConfidentialityAcceptance,
  staffNeedsTermsAcceptance,
} from '../services/legalService';
import { recordAuditEvent } from '../services/auditService';
import { CONFIDENTIALITY_UNDERTAKING_TEXT } from '../config/legal';

export const legalRouter = Router();

legalRouter.use(requireStaffSession);

async function status(staffId: string) {
  const [termsRequired, confidentialityRequired] = await Promise.all([
    staffNeedsTermsAcceptance(staffId),
    staffNeedsConfidentialityAcceptance(staffId),
  ]);
  return {
    // The console shows its one-time screen while either is outstanding.
    termsAcceptanceRequired: termsRequired || confidentialityRequired,
    termsRequired,
    confidentialityRequired,
    confidentialityText: CONFIDENTIALITY_UNDERTAKING_TEXT,
    versions: CURRENT_LEGAL_VERSIONS,
  };
}

/** Whether the console must show the one-time "accept" screen (Terms and/or confidentiality undertaking) before anything else. */
legalRouter.get('/', async (req, res) => {
  res.json(await status((req as AuthenticatedRequest).dashboardSession.staffId));
});

const acceptSchema = z.object({ accept: z.literal(true), acceptConfidentiality: z.boolean().optional() });

/**
 * The staff member ticked the box(es) on the one-time screen: the Terms of
 * Service if outstanding, and the confidentiality undertaking if they
 * haven't accepted the current version (C19). Each is recorded with its
 * version, date and time.
 */
legalRouter.post('/accept', async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please tick the box to accept the Terms of Service' });
    return;
  }
  const { staffId, clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const before = await status(staffId);
  if (before.confidentialityRequired && parsed.data.acceptConfidentiality !== true) {
    res.status(400).json({ error: 'Please tick the box to accept the confidentiality undertaking' });
    return;
  }

  if (before.termsRequired) {
    await recordLegalAcceptances(['TERMS_OF_SERVICE'], 'STAFF_LOGIN', { staffId, clinicId });
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      clinicId,
      action: 'LEGAL_TERMS_ACCEPTED',
      entityType: 'Staff',
      entityId: staffId,
      metadata: { version: CURRENT_LEGAL_VERSIONS.TERMS_OF_SERVICE },
    });
  }
  if (before.confidentialityRequired) {
    await recordLegalAcceptances(['CONFIDENTIALITY_UNDERTAKING'], 'STAFF_LOGIN', { staffId, clinicId });
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      clinicId,
      action: 'CONFIDENTIALITY_UNDERTAKING_ACCEPTED',
      entityType: 'Staff',
      entityId: staffId,
      metadata: { version: CURRENT_LEGAL_VERSIONS.CONFIDENTIALITY_UNDERTAKING },
    });
  }
  res.status(201).json({ termsAcceptanceRequired: false });
});
