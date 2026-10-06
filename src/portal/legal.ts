import { Router } from 'express';
import { z } from 'zod';
import { requirePatientSession, AuthenticatedPatientRequest } from './auth';
import { patientNeedsTermsAcceptance, recordLegalAcceptances, CURRENT_LEGAL_VERSIONS } from '../services/legalService';
import { recordAuditEvent } from '../services/auditService';

export const portalLegalRouter = Router();

portalLegalRouter.use(requirePatientSession);

/** Whether the portal must show the one-time "accept the Terms" screen before anything else. */
portalLegalRouter.get('/', async (req, res) => {
  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;
  res.json({
    termsAcceptanceRequired: await patientNeedsTermsAcceptance(patientId),
    versions: CURRENT_LEGAL_VERSIONS,
  });
});

const acceptSchema = z.object({ accept: z.literal(true) });

/** The patient ticked "I accept the Terms of Service and have read the Privacy Notice" after logging in. */
portalLegalRouter.post('/accept', async (req, res) => {
  if (!acceptSchema.safeParse(req.body).success) {
    res.status(400).json({ error: 'Please tick the box to accept the Terms of Service and Privacy Notice' });
    return;
  }
  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;
  await recordLegalAcceptances(['TERMS_OF_SERVICE', 'PRIVACY_NOTICE'], 'PATIENT_PORTAL_LOGIN', { patientId });
  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patientId,
    action: 'LEGAL_TERMS_ACCEPTED',
    entityType: 'Patient',
    entityId: patientId,
    metadata: { versions: CURRENT_LEGAL_VERSIONS },
  });
  res.status(201).json({ termsAcceptanceRequired: false });
});
