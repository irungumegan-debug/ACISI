import { Request, Response, Router } from 'express';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from '../dashboard/auth';
import { loadDashboardSession, SESSION_COOKIE_NAME } from '../dashboard/session';
import { staffPatientScopeWhere } from '../services/staffPatientScope';
import { recordAuditEvent } from '../services/auditService';
import { capabilityStatement, patientEverythingBundle, toPatient, VisitRecord } from './mappers';

/**
 * HL7 FHIR R4 interface, mounted at /fhir/r4.
 *
 * - GET /metadata: the CapabilityStatement (public, no patient data).
 * - GET /Patient/:id: demographics, for logged-in clinic staff, with the
 *   same rule as the patient page (front desk: patients seen at the clinic;
 *   doctors: patients in their own queue; no one else).
 * - GET /Patient/:id/$everything: the full record (diagnoses, prescriptions,
 *   lab results) for doctors only, for patients in their own queue, and only
 *   this clinic's own visits.
 * Every read is audit-logged.
 *
 * Errors are FHIR OperationOutcome resources.
 */
export const fhirRouter = Router();

const FHIR_JSON = 'application/fhir+json; charset=utf-8';

function baseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function outcome(res: Response, status: number, code: string, diagnostics: string): void {
  res.status(status).type(FHIR_JSON).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code, diagnostics }] });
}

fhirRouter.get('/metadata', (req, res) => {
  res.type(FHIR_JSON).json(capabilityStatement(baseUrl(req), process.env.npm_package_version ?? '0.1.0'));
});

// Everything below needs a staff session. Answers come as FHIR OperationOutcome resources.
fhirRouter.use((req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    outcome(res, 401, 'login', 'Log in to ACISI as clinic staff to read patient records');
    return;
  }
  loadDashboardSession(token)
    .then((session) => {
      if (!session) {
        outcome(res, 401, 'login', 'Session expired: log in again');
        return;
      }
      (req as AuthenticatedRequest).dashboardSession = session;
      next();
    })
    .catch(next);
});

async function findPatient(req: Request) {
  const session = (req as AuthenticatedRequest).dashboardSession;
  return prisma.patient.findFirst({
    where: { AND: [{ id: req.params.id as string, deletedAt: null }, await staffPatientScopeWhere(session)] },
  });
}

async function audit(req: Request, patientId: string, operation: 'read' | 'everything', resourceCount: number): Promise<void> {
  const { staffId, clinicId } = (req as AuthenticatedRequest).dashboardSession;
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'FHIR_PATIENT_EXPORTED',
    entityType: 'Patient',
    entityId: patientId,
    metadata: { operation, resourceCount },
  });
}

fhirRouter.get('/Patient/:id', async (req, res) => {
  const patient = await findPatient(req);
  if (!patient) {
    outcome(res, 404, 'not-found', 'Patient not found');
    return;
  }
  await audit(req, patient.id, 'read', 1);
  res.type(FHIR_JSON).json(toPatient(patient));
});

fhirRouter.get('/Patient/:id/\\$everything', async (req, res) => {
  const { clinicId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  // The full record carries diagnoses and lab results, which only doctors see
  // (front desk and admins never receive them on screen either).
  if (role !== 'DOCTOR') {
    outcome(res, 403, 'forbidden', 'Only doctors can read a full patient record, for patients in their own queue');
    return;
  }
  const patient = await findPatient(req);
  if (!patient) {
    outcome(res, 404, 'not-found', 'Patient not found');
    return;
  }

  // This clinic's own visits only; other clinics' records are shared through the HIE, not here.
  const encounters = await prisma.encounter.findMany({
    where: { patientId: patient.id, clinicId },
    orderBy: { createdAt: 'asc' },
    include: {
      clinic: { select: { id: true, name: true, county: true } },
      checkIn: { select: { department: { select: { name: true } } } },
      consultedByStaff: { select: { id: true, name: true, staffCode: true } },
      assignedDoctor: { select: { id: true, name: true, staffCode: true } },
      labOrders: {
        orderBy: { requestedAt: 'asc' },
        include: { items: { orderBy: { position: 'asc' } }, requestedByStaff: { select: { id: true, name: true, staffCode: true } } },
      },
    },
  });

  const clinic = encounters[0]?.clinic ?? (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true, name: true, county: true } }));
  const visits: VisitRecord[] = encounters.map((e) => ({
    id: e.id,
    status: e.status,
    createdAt: e.createdAt,
    checkedOutAt: e.checkedOutAt,
    consultedAt: e.consultedAt,
    visitReason: e.visitReason,
    diagnosis: e.diagnosis,
    prescription: e.prescription,
    clinicId: e.clinicId,
    departmentName: e.checkIn.department.name,
    doctor: e.consultedByStaff ?? e.assignedDoctor,
    labOrders: e.labOrders.map((o) => ({
      id: o.id,
      status: o.status,
      requestedAt: o.requestedAt,
      requestedBy: o.requestedByStaff,
      noteForLab: o.noteForLab,
      completedAt: o.completedAt,
      items: o.items,
    })),
  }));

  const bundle = patientEverythingBundle({ baseUrl: baseUrl(req), patient, clinics: clinic ? [clinic] : [], visits });
  await audit(req, patient.id, 'everything', bundle.total ?? 0);
  res.type(FHIR_JSON).json(bundle);
});
