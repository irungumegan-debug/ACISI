import { Router } from 'express';
import { portalAuthRouter } from './auth';
import { portalCheckinRouter } from './checkin';
import { portalVisitsRouter } from './visits';

export const portalRouter = Router();

portalRouter.use('/auth', portalAuthRouter);
portalRouter.use('/visits', portalVisitsRouter);
// Clinic/department listing + check-in creation/status live at the root of
// this router (e.g. /api/portal/clinics, /api/portal/checkin) — see checkin.ts.
portalRouter.use('/', portalCheckinRouter);
