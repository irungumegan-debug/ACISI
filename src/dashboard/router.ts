import { Router } from 'express';
import { authRouter } from './auth';
import { patientsRouter } from './patients';
import { checkinsRouter } from './checkins';
import { eventsRouter } from './events';
import { staffRegistrationRouter } from './registration';
import { clinicSettingsRouter } from './clinicSettings';
import { doctorRouter } from './doctor';
import { appointmentsRouter } from './appointments';
import { walkInRouter } from './walkIn';
import { billingRouter } from './billing';
import { legalRouter } from './legal';
import { phoneVerificationRouter } from './phoneVerification';
import { filesRouter } from './files';
import { labRouter, labTestsAdminRouter } from './lab';
import { surveillanceRouter } from './surveillance';
import { routineReportsRouter } from './routineReports';
import { hieRouter } from './hie';
import { shaRouter } from './sha';
import { env } from '../config/env';
import { serviceOrdersRouter } from './serviceOrders';
import { vitalsRouter } from './vitals';
import { dispensingRouter } from './dispensing';

export const dashboardRouter = Router();

dashboardRouter.use('/auth', authRouter);
dashboardRouter.use('/register', staffRegistrationRouter);
dashboardRouter.use('/clinic', clinicSettingsRouter);
dashboardRouter.use('/files', filesRouter);
dashboardRouter.use('/lab', labRouter);
dashboardRouter.use('/lab-tests', labTestsAdminRouter);
dashboardRouter.use('/patients', patientsRouter);
dashboardRouter.use('/checkins', checkinsRouter);
dashboardRouter.use('/doctor', doctorRouter);
dashboardRouter.use('/surveillance', surveillanceRouter);
dashboardRouter.use('/routine-reports', routineReportsRouter);
dashboardRouter.use('/hie', hieRouter);
// SHA claims add-on: off unless SHA_ENABLED=true (see env.ts), like USSD.
// With it off, /api/staff/sha/* answers 404 and nothing can reach SHA.
if (env.SHA_ENABLED) {
  dashboardRouter.use('/sha', shaRouter);
}
dashboardRouter.use('/service-orders', serviceOrdersRouter);
dashboardRouter.use('/vitals', vitalsRouter);
dashboardRouter.use('/dispensing', dispensingRouter);
dashboardRouter.use('/appointments', appointmentsRouter);
dashboardRouter.use('/walk-in', walkInRouter);
dashboardRouter.use('/billing', billingRouter);
dashboardRouter.use('/events', eventsRouter);
dashboardRouter.use('/legal', legalRouter);
dashboardRouter.use('/phone-verification', phoneVerificationRouter);
