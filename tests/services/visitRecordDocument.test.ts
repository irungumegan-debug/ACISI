import { renderVisitRecordPdf } from '../../src/services/visitRecordDocument';

/**
 * pdfkit renders text as hex-encoded glyph strings inside `<...>` TJ/Tj
 * operators rather than literal ASCII, even with stream compression off.
 * For the standard Helvetica/WinAnsiEncoding font used here, those hex
 * bytes are just the ASCII codes hex-encoded, so decoding every `<hex>` run
 * in the raw PDF and concatenating them recovers the actual rendered text
 * well enough to assert on — without pulling in a full PDF-parsing library
 * just for this test.
 */
function extractRenderedText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const hexRuns = raw.match(/<[0-9a-fA-F]+>/g) ?? [];
  return hexRuns
    .map((run) => Buffer.from(run.slice(1, -1), 'hex').toString('latin1'))
    .join('');
}

describe('renderVisitRecordPdf', () => {
  it('produces a valid, well-formed PDF buffer', async () => {
    const pdf = await renderVisitRecordPdf({
      patientName: 'Jane Wanjiru',
      patientCode: 'ACI-1042',
      clinicName: 'Sunrise Family Clinic',
      departmentName: 'General',
      visitedAt: new Date('2026-01-15'),
      diagnosis: 'Seasonal flu',
      prescription: 'Paracetamol 500mg, twice daily for 5 days',
    });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  it('includes the patient, clinic, and clinical content in the rendered document', async () => {
    const pdf = await renderVisitRecordPdf({
      patientName: 'Jane Wanjiru',
      patientCode: 'ACI-1042',
      clinicName: 'Sunrise Family Clinic',
      departmentName: 'General',
      visitedAt: new Date('2026-01-15'),
      diagnosis: 'Seasonal flu',
      prescription: 'Paracetamol 500mg, twice daily for 5 days',
    });

    const text = extractRenderedText(pdf);
    expect(text).toContain('Jane Wanjiru');
    expect(text).toContain('ACI-1042');
    expect(text).toContain('Sunrise Family Clinic');
    expect(text).toContain('Seasonal flu');
    expect(text).toContain('Paracetamol 500mg');
  });

  it("substitutes 'Not recorded' for a diagnosis/prescription that hasn't been set, instead of omitting the section", async () => {
    const pdf = await renderVisitRecordPdf({
      patientName: 'Amos Kiptoo',
      patientCode: 'ACI-2091',
      clinicName: 'Baraka Health Centre',
      departmentName: 'Dental',
      visitedAt: new Date('2026-02-01'),
      diagnosis: null,
      prescription: null,
    });

    const text = extractRenderedText(pdf);
    expect(text).toContain('Not recorded');
  });
});
