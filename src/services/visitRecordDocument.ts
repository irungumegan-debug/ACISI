import path from 'node:path';
import PDFDocument from 'pdfkit';
import { StaffRole } from '@prisma/client';

const SIGNATURE_FONT_PATH = path.join(__dirname, '../assets/fonts/DancingScript-Regular.woff');

/** Human-readable label for the signature block — there's no separate professional-title field on Staff, so the role is the closest thing to one. */
const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  DOCTOR: 'Doctor',
  CLINICIAN: 'Clinician',
  RECEPTIONIST: 'Receptionist',
  ADMIN: 'Clinic Administrator',
  LAB_TECHNICIAN: 'Lab Technician',
};

export interface VisitRecordData {
  patientName: string;
  patientCode: string;
  clinicName: string;
  clinicCounty: string | null;
  departmentName: string;
  visitedAt: Date;
  diagnosis: string | null;
  prescription: string | null;
  /**
   * Null for a visit that hasn't reached a signed consultation yet (still
   * WAITING/IN_CONSULTATION) — in that case the document simply has no
   * signature section, rather than fabricating one. Once
   * encounterService.submitConsultation has run, these always come
   * together: submission IS the signing moment (a re-entered PIN gates it),
   * so signedAt is the actual, real timestamp of that confirmation, not a
   * stamp applied after the fact with no action behind it.
   */
  signature: {
    doctorName: string;
    doctorTitle: string;
    signedAt: Date;
  } | null;
  /** Signed lab results of this visit (empty when none, or not shown to this reader yet). */
  labResults: VisitLabResult[];
}

export interface VisitLabResult {
  testName: string;
  value: string | null;
  unit: string | null;
  flag: 'NORMAL' | 'ABNORMAL' | 'CRITICAL' | null;
  comment: string | null;
  signedByName: string | null;
  signedAt: Date | null;
}

/**
 * Add to an encounter query to load its signed lab results for the visit
 * record. For a patient's own copy, pass { patientView: true }: results then
 * appear only once the visit has been checked out (DONE).
 */
export function visitRecordLabInclude(options: { patientView?: boolean } = {}) {
  return {
    where: { status: 'RESULTS_READY' as const, ...(options.patientView ? { encounter: { status: 'DONE' as const } } : {}) },
    orderBy: { requestedAt: 'asc' as const },
    include: { items: { orderBy: { position: 'asc' as const } }, completedByStaff: { select: { name: true } } },
  };
}

const FLAG_LABEL: Record<'NORMAL' | 'ABNORMAL' | 'CRITICAL', string> = { NORMAL: 'Normal', ABNORMAL: 'Abnormal', CRITICAL: 'Critical' };

interface EncounterForVisitRecord {
  createdAt: Date;
  diagnosis: string | null;
  prescription: string | null;
  consultedAt: Date | null;
  patient: { firstName: string; lastName: string; patientCode: string };
  clinic: { name: string; county: string | null };
  checkIn: { department: { name: string } };
  consultedByStaff: { name: string; role: StaffRole } | null;
  /** Load with visitRecordLabInclude(); left out, the record simply has no lab section. */
  labOrders?: {
    completedAt: Date | null;
    completedByStaff: { name: string } | null;
    items: { testName: string; resultValue: string | null; resultUnit: string | null; resultFlag: 'NORMAL' | 'ABNORMAL' | 'CRITICAL' | null; resultComment: string | null }[];
  }[];
}

/**
 * Maps an Encounter (with its patient/clinic/department/consultedByStaff
 * relations loaded) to the plain data renderVisitRecordPdf needs — shared
 * by every caller that turns a visit into a PDF (the patient portal's own
 * download, and the checkout-time email) so they can't drift apart on how
 * a visit's data becomes a document.
 */
export function buildVisitRecordDataFromEncounter(encounter: EncounterForVisitRecord): VisitRecordData {
  return {
    patientName: `${encounter.patient.firstName} ${encounter.patient.lastName}`,
    patientCode: encounter.patient.patientCode,
    clinicName: encounter.clinic.name,
    clinicCounty: encounter.clinic.county,
    departmentName: encounter.checkIn.department.name,
    visitedAt: encounter.createdAt,
    diagnosis: encounter.diagnosis,
    prescription: encounter.prescription,
    // Only present once the doctor has actually signed (submitConsultation
    // gates reaching this on a re-entered PIN) — consultedAt is that real
    // signing timestamp, not a stamp applied with no action behind it.
    signature:
      encounter.consultedByStaff && encounter.consultedAt
        ? { doctorName: encounter.consultedByStaff.name, doctorTitle: STAFF_ROLE_LABEL[encounter.consultedByStaff.role], signedAt: encounter.consultedAt }
        : null,
    labResults: (encounter.labOrders ?? []).flatMap((o) =>
      o.items.map((i) => ({
        testName: i.testName,
        value: i.resultValue,
        unit: i.resultUnit,
        flag: i.resultFlag,
        comment: i.resultComment,
        signedByName: o.completedByStaff?.name ?? null,
        signedAt: o.completedAt,
      })),
    ),
  };
}

/**
 * Renders a single visit into a simple, clean one-page PDF — what a patient
 * would show a pharmacist or keep for their own records. Compression is
 * off: this is a one-page text document downloaded once by one patient, so
 * the size difference is negligible, and it keeps the output's text content
 * directly inspectable (by us in tests, and by anyone checking what a
 * generated file actually contains).
 */
function drawVisitPage(doc: PDFKit.PDFDocument, data: VisitRecordData): void {
  // Letterhead — the clinic's own identity at the top of the page,
  // distinct from ACISI's own "Visit Record" title below it.
  doc.fontSize(16).text(data.clinicName, { align: 'center' });
  if (data.clinicCounty) {
    doc.fontSize(10).fillColor('#555555').text(data.clinicCounty, { align: 'center' });
    doc.fillColor('#000000');
  }
  doc.moveDown(0.5);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#cccccc')
    .stroke();
  doc.moveDown(1);

  doc.fontSize(18).text('ACISI Visit Record', { align: 'center' });
  doc.moveDown(1.5);

  doc.fontSize(11);
  doc.text(`Patient: ${data.patientName} (${data.patientCode})`);
  doc.text(`Clinic: ${data.clinicName}`);
  doc.text(`Department: ${data.departmentName}`);
  doc.text(`Visit date: ${data.visitedAt.toLocaleDateString()}`);
  doc.moveDown(1.5);

  doc.fontSize(13).text('Diagnosis / notes', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(11).text(data.diagnosis || 'Not recorded');
  doc.moveDown(1.5);

  doc.fontSize(13).text('Prescription', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(11).text(data.prescription || 'Not recorded');

  if (data.labResults.length > 0) {
    doc.moveDown(1.5);
    doc.fontSize(13).text('Lab results', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(11);
    for (const r of data.labResults) {
      const value = [r.value, r.unit].filter(Boolean).join(' ');
      const flag = r.flag ? ` (${FLAG_LABEL[r.flag]})` : '';
      doc.text(`${r.testName}: ${value || 'see comment'}${flag}`);
      if (r.comment) doc.fontSize(10).fillColor('#555555').text(r.comment, { indent: 14 }).fillColor('#000000').fontSize(11);
    }
    const signer = data.labResults.find((r) => r.signedByName && r.signedAt);
    if (signer) {
      doc.fontSize(10).fillColor('#555555').text(`Lab results signed by ${signer.signedByName} on ${signer.signedAt!.toLocaleString()}`).fillColor('#000000');
    }
  }

  if (data.signature) {
    doc.moveDown(2);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + 220, doc.y)
      .strokeColor('#cccccc')
      .stroke();
    doc.moveDown(0.3);

    doc.font('Signature').fontSize(26).text(data.signature.doctorName);
    doc.font('Helvetica').fontSize(10).fillColor('#555555');
    doc.text(data.signature.doctorTitle);
    doc.text(`Signed electronically via ACISI on ${data.signature.signedAt.toLocaleString()}`);
    doc.fillColor('#000000');
  }
}

export function renderVisitRecordPdf(data: VisitRecordData): Promise<Buffer> {
  return renderVisitRecordsPdf([data]);
}

/**
 * Several visits in one PDF, one page each (newest first, as given): the
 * patient's "Download all my visits" (C16). Same page layout as a single
 * visit record.
 */
export function renderVisitRecordsPdf(visits: VisitRecordData[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Signature', SIGNATURE_FONT_PATH);

    for (const data of visits) {
      doc.addPage();
      doc.font('Helvetica');
      drawVisitPage(doc, data);
    }

    doc.end();
  });
}
