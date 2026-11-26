import { Response, Router } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, isFrontDeskRole, requireStaffSession } from './auth';
import { sendHieError } from './hie';
import { shaAddonStatus } from '../hie/shaAddon';
import { checkShaEligibility, listShaBenefits, listShaInterventions, listShaSubBenefits } from '../hie/shaEligibility';
import { getShaVisit, listShaContacts, sendShaVisitCode, startShaVisit } from '../hie/shaVisit';

/**
 * SHA claims: an optional add-on, not part of ACISI's core. Mounted at
 * /api/staff/sha only when SHA_ENABLED=true (see dashboard/router.ts); with
 * it off every route here answers 404. Even when mounted, each service call
 * checks the clinic's own switch first (hie/shaAddon.ts), so nothing goes to
 * SHA for a clinic the owner hasn't switched on.
 */
export const shaRouter = Router();
shaRouter.use(requireStaffSession);

const session = (req: unknown) => (req as AuthenticatedRequest).dashboardSession;

/** The code DHA texts the patient to confirm the SHA visit. */
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from the SMS (numbers only)') });

/** Whether the console shows SHA panels for this clinic. Any staff role. */
shaRouter.get('/status', async (req, res) => {
  res.json(await shaAddonStatus(session(req).clinicId));
});

// ---------- SHA eligibility (claims phase 1), front desk ----------

/** Front desk only, like the Client Registry lookup; the patient must have been seen at this clinic. */
function shaRoute(handler: (args: { req: import('express').Request; patientId: string; clinicId: string; staffId: string }) => Promise<unknown>) {
  return async (req: import('express').Request, res: Response) => {
    const { clinicId, staffId, role } = session(req);
    if (!isFrontDeskRole(role)) {
      res.status(403).json({ error: 'Only front-desk staff can check SHA cover' });
      return;
    }
    try {
      res.json(await handler({ req, patientId: req.params.id as string, clinicId, staffId }));
    } catch (err) {
      sendHieError(res, err);
    }
  };
}

/** Is the patient covered by SHA today, under which schemes? */
shaRouter.post('/patients/:id/eligibility', shaRoute(({ patientId, clinicId, staffId }) => checkShaEligibility({ patientId, clinicId, staffId })));

shaRouter.get('/patients/:id/benefits', shaRoute(async ({ patientId, clinicId, staffId }) => ({ benefits: await listShaBenefits({ patientId, clinicId, staffId }) })));

shaRouter.get(
  '/patients/:id/benefits/:benefitCode/sub-benefits',
  shaRoute(async ({ req, patientId, clinicId, staffId }) => ({
    subBenefits: await listShaSubBenefits({ patientId, clinicId, staffId, benefitCode: req.params.benefitCode as string }),
  })),
);

shaRouter.get(
  '/patients/:id/sub-benefits/:subBenefitCode/interventions',
  shaRoute(async ({ req, patientId, clinicId, staffId }) => ({
    interventions: await listShaInterventions({
      patientId,
      clinicId,
      staffId,
      subBenefitCode: req.params.subBenefitCode as string,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    }),
  })),
);

// ---------- SHA start visit (claims), front desk ----------


function shaVisitRoute(handler: (args: { req: import('express').Request; res: Response; encounterId: string; clinicId: string; staffId: string }) => Promise<unknown>) {
  return async (req: import('express').Request, res: Response) => {
    const { clinicId, staffId, role } = session(req);
    if (!isFrontDeskRole(role)) {
      res.status(403).json({ error: 'Only front-desk staff can start SHA visits' });
      return;
    }
    try {
      const out = await handler({ req, res, encounterId: req.params.encounterId as string, clinicId, staffId });
      if (!res.headersSent) res.json(out);
    } catch (err) {
      sendHieError(res, err);
    }
  };
}

shaRouter.get('/visits/:encounterId', shaVisitRoute(({ encounterId, clinicId }) => getShaVisit(encounterId, clinicId)));

shaRouter.get(
  '/visits/:encounterId/contacts',
  shaVisitRoute(async ({ encounterId, clinicId, staffId }) => ({ contacts: await listShaContacts({ encounterId, clinicId, staffId }) })),
);

const shaCodeSchema = z.object({
  interventionCodes: z.array(z.string().trim().min(2).max(42)).min(1).max(10),
  contactId: z.number().int().positive().optional(),
});

shaRouter.post(
  '/visits/:encounterId/code',
  shaVisitRoute(async ({ req, res, encounterId, clinicId, staffId }) => {
    const parsed = shaCodeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Choose the SHA services for this visit (at most 10).' });
      return;
    }
    return sendShaVisitCode({ encounterId, clinicId, staffId, ...parsed.data });
  }),
);

shaRouter.post(
  '/visits/:encounterId/start',
  shaVisitRoute(async ({ req, res, encounterId, clinicId, staffId }) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Enter the code' });
      return;
    }
    return startShaVisit({ encounterId, clinicId, staffId, code: parsed.data.code });
  }),
);
