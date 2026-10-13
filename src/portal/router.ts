import { Router } from 'express';
import { portalAuthRouter } from './auth';
import { portalCheckinRouter, portalRecordsRouter } from './checkin';
import { portalAppointmentsRouter } from './appointments';
import { portalLegalRouter } from './legal';
import { portalDetailsRouter } from './details';
import { portalRecordAccessRouter } from './recordAccess';

export const portalRouter = Router();

portalRouter.use('/', portalAuthRouter);
portalRouter.use('/checkin', portalCheckinRouter);
portalRouter.use('/records', portalRecordsRouter);
portalRouter.use('/appointments', portalAppointmentsRouter);
portalRouter.use('/legal', portalLegalRouter);
portalRouter.use('/details', portalDetailsRouter);
portalRouter.use('/record-access', portalRecordAccessRouter);
