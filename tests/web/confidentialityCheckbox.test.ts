import fs from 'node:fs';
import path from 'node:path';
import { CONFIDENTIALITY_UNDERTAKING_CHECKBOX } from '../../src/config/legal';

/** The tick-box wording agreed with the owner (C19), word for word, everywhere it is shown. */
describe('confidentiality undertaking tick box', () => {
  it('uses the agreed wording', () => {
    expect(CONFIDENTIALITY_UNDERTAKING_CHECKBOX).toBe('I have read and agree to the ACISI Confidentiality Undertaking.');
  });

  it.each(['web/src/pages/SignupPage.tsx', 'dashboard/src/components/ProtectedLayout.tsx'])('%s shows exactly that wording', (file) => {
    const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    expect(source).toContain(CONFIDENTIALITY_UNDERTAKING_CHECKBOX);
    expect(source).not.toContain('accept this confidentiality undertaking');
  });
});
