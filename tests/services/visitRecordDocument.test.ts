import { buildVisitRecordDataFromEncounter, renderVisitRecordPdf } from '../../src/services/visitRecordDocument';

/**
 * pdfkit renders text as hex-encoded glyph strings inside `<...>` TJ/Tj
 * operators rather than literal ASCII, even with stream compression off.
 * For the standard Helvetica/WinAnsiEncoding font used here, those hex
 * bytes are just the ASCII codes hex-encoded, so decoding every `<hex>` run
 * in the raw PDF and concatenating them recovers the actual rendered text
 * well enough to assert on — without pulling in a full PDF-parsing library
 * just for this test. This does NOT hold for the embedded signature font
 * (a subsetted TrueType font uses arbitrary glyph IDs, not character
 * codes) — the signature-block tests below check for the font's embedding
 * and the surrounding (Helvetica) text instead of the name itself.
 */
function extractRenderedText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const hexRuns = raw.match(/<[0-9a-fA-F]+>/g) ?? [];
  return hexRuns
    .map((run) => Buffer.from(run.slice(1, -1), 'hex').toString('latin1'))
    .join('');
}

const BASE_DATA = {
  patientName: 'Jane Wanjiru',
  patientCode: 'ACI-1042',
  clinicName: 'Sunrise Family Clinic',
  clinicCounty: 'Nairobi',
  departmentName: 'General',
  visitedAt: new Date('2026-01-15'),
  diagnosis: 'Seasonal flu',
  prescription: 'Paracetamol 500mg, twice daily for 5 days',
  signature: null,
};

describe('buildVisitRecordDataFromEncounter', () => {
  it("still shows the consulting doctor's name and role when their account has since been deactivated — Staff rows are never deleted, so the relation still resolves", () => {
    const data = buildVisitRecordDataFromEncounter({
      createdAt: new Date('2026-01-15'),
      diagnosis: 'Seasonal flu',
      prescription: 'Paracetamol 500mg, twice daily for 5 days',
      consultedAt: new Date('2026-01-15T09:00:00Z'),
      patient: { firstName: 'Jane', lastName: 'Wanjiru', patientCode: 'ACI-1042' },
      clinic: { name: 'Sunrise Family Clinic', county: 'Nairobi' },
      checkIn: { department: { name: 'General' } },
      // isActive: false doesn't even appear in the selected shape this
      // function receives — the join was never gated on it in the first
      // place, so a deactivated doctor's historic visits are unaffected.
      consultedByStaff: { name: 'Dr. Amani Wambui', role: 'DOCTOR' },
    });

    expect(data.signature).toEqual({
      doctorName: 'Dr. Amani Wambui',
      doctorTitle: 'Doctor',
      signedAt: new Date('2026-01-15T09:00:00Z'),
    });
  });
});

describe('renderVisitRecordPdf', () => {
  it('produces a valid, well-formed PDF buffer', async () => {
    const pdf = await renderVisitRecordPdf(BASE_DATA);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  it('includes the patient, clinic (letterhead), and clinical content in the rendered document', async () => {
    const pdf = await renderVisitRecordPdf(BASE_DATA);

    const text = extractRenderedText(pdf);
    expect(text).toContain('Jane Wanjiru');
    expect(text).toContain('ACI-1042');
    expect(text).toContain('Sunrise Family Clinic');
    expect(text).toContain('Nairobi');
    expect(text).toContain('Seasonal flu');
    expect(text).toContain('Paracetamol 500mg');
  });

  it("substitutes 'Not recorded' for a diagnosis/prescription that hasn't been set, instead of omitting the section", async () => {
    const pdf = await renderVisitRecordPdf({
      ...BASE_DATA,
      patientName: 'Amos Kiptoo',
      patientCode: 'ACI-2091',
      clinicName: 'Baraka Health Centre',
      clinicCounty: null,
      departmentName: 'Dental',
      visitedAt: new Date('2026-02-01'),
      diagnosis: null,
      prescription: null,
    });

    const text = extractRenderedText(pdf);
    expect(text).toContain('Not recorded');
  });

  it('omits the signature block entirely for a visit that has not been signed yet', async () => {
    const pdf = await renderVisitRecordPdf(BASE_DATA);

    const text = extractRenderedText(pdf);
    expect(text).not.toContain('Signed electronically');
  });

  it("includes the doctor's title and the real signing timestamp, and embeds the signature-style font, once the visit has been signed", async () => {
    const signedAt = new Date('2026-01-15T09:32:00Z');
    const pdf = await renderVisitRecordPdf({
      ...BASE_DATA,
      signature: { doctorName: 'Dr. Amani Wambui', doctorTitle: 'Doctor', signedAt },
    });

    const text = extractRenderedText(pdf);
    expect(text).toContain('Doctor');
    expect(text).toContain(`Signed electronically via ACISI on ${signedAt.toLocaleString()}`);

    // The doctor's printed name itself renders through the embedded
    // signature font (a subsetted TrueType embed uses glyph IDs, not
    // character codes, so it won't show up via the hex-as-ASCII decode
    // above) — check the font was actually embedded instead.
    const raw = pdf.toString('latin1');
    expect(raw).toContain('DancingScript');
  });
});
