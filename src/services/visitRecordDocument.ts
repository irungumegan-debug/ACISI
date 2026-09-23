import PDFDocument from 'pdfkit';

export interface VisitRecordData {
  patientName: string;
  patientCode: string;
  clinicName: string;
  departmentName: string;
  visitedAt: Date;
  diagnosis: string | null;
  prescription: string | null;
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

    doc.end();
  });
}
