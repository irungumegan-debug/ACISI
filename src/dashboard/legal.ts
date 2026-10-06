import { Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { CURRENT_LEGAL_VERSIONS, recordLegalAcceptances, staffNeedsTermsAcceptance } from '../services/legalService';
import { recordAuditEvent } from '../services/auditService';

export const legalRouter = Router();

legalRouter.use(requireStaffSession);

/** Whether the console must show the one-time "accept the Terms" screen before anything else. */
legalRouter.get('/', async (req, res) => {
  const { staffId } = (req as AuthenticatedRequest).dashboardSession;
  res.json({
    termsAcceptanceRequired: await staffNeedsTermsAcceptance(staffId),
    versions: CURRENT_LEGAL_VERSIONS,
  });
});

const acceptSchema = z.object({ accept: z.literal(true) });

/** The staff member ticked "I have read and accept the ACISI Terms of Service" after logging in. */
legalRouter.post('/accept', async (req, res) => {
  if (!acceptSchema.safeParse(req.body).success) {
    res.status(400).json({ error: 'Please tick the box to accept the Terms of Service' });
    return;
  }
  const { staffId, clinicId } = (req as AuthenticatedRequest).dashboardSession;
  await recordLegalAcceptances(['TERMS_OF_SERVICE'], 'STAFF_LOGIN', { staffId, clinicId });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'LEGAL_TERMS_ACCEPTED',
    entityType: 'Staff',
    entityId: staffId,
    metadata: { version: CURRENT_LEGAL_VERSIONS.TERMS_OF_SERVICE },
  });
  res.status(201).json({ termsAcceptanceRequired: false });
});
