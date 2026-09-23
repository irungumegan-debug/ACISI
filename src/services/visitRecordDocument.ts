import path from 'node:path';
import PDFDocument from 'pdfkit';

const SIGNATURE_FONT_PATH = path.join(__dirname, '../assets/fonts/DancingScript-Regular.woff');

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
}

/**
 * Renders a single visit into a simple, clean one-page PDF — what a patient
 * would show a pharmacist or keep for their own records. Compression is
 * off: this is a one-page text document downloaded once by one patient, so
 * the size difference is negligible, and it keeps the output's text content
 * directly inspectable (by us in tests, and by anyone checking what a
 * generated file actually contains).
 */
export function renderVisitRecordPdf(data: VisitRecordData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Signature', SIGNATURE_FONT_PATH);

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

    doc.end();
  });
}
