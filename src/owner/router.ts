import { Router } from 'express';
import { ownerAuthRouter, requireOwnerSession } from './auth';
import { ownerOverviewRouter } from './overview';
import { ownerClinicsRouter } from './clinics';
import { ownerStaffRouter } from './staff';
import { ownerPatientsRouter } from './patients';
import { ownerActivityRouter } from './activity';

/**
 * The owner site's API (/api/owner) — platform-wide access for the company
 * owner, entirely separate from the clinic-scoped staff API. Everything but
 * /auth requires an owner session.
 */
export const ownerRouter = Router();

ownerRouter.use('/auth', ownerAuthRouter);
ownerRouter.use(requireOwnerSession);
ownerRouter.use('/overview', ownerOverviewRouter);
ownerRouter.use('/clinics', ownerClinicsRouter);
ownerRouter.use('/staff', ownerStaffRouter);
ownerRouter.use('/patients', ownerPatientsRouter);
ownerRouter.use('/activity', ownerActivityRouter);
