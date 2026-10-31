import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { autolink, lastUpdatedVersion, parseLegalMarkdown, toMarkdown, toPlainText } from '../../web/src/lib/legalMarkdown';
import { legalBoxSatisfied } from '../../web/src/lib/legal';
import { legalBoxSatisfied as consoleLegalBoxSatisfied } from '../../dashboard/src/lib/legal';
import {
  CONFIDENTIALITY_UNDERTAKING_CHECKBOX,
  CONFIDENTIALITY_UNDERTAKING_PATH,
  CONFIDENTIALITY_UNDERTAKING_VERSION,
  PRIVACY_NOTICE_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from '../../src/config/legal';
import { SITE_URL, SITEMAP_PAGES, seoForPath } from '../../web/src/lib/seo';

const root = path.join(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/**
 * SHA-256 of the approved documents (the files as supplied, with the two
 * approved PIN wording fixes). Any edit to the text — even one character —
 * fails here, so changing a legal document is always deliberate: update the
 * file, its "Last updated" date, src/config/legal.ts and this hash together.
 */
const APPROVED = {
  'web/src/content/privacy.md': '12977722c89130ae6968af15c28ff9480d5d0f5c7e9413be59f12e643d6d668c',
  'web/src/content/terms.md': '0f2c2a98e3d3b11b88403a6cd7e63cd9a0b4327ce33684a86530879d4219bdde',
};

describe.each(Object.keys(APPROVED) as (keyof typeof APPROVED)[])('%s', (file) => {
  const markdown = read(file);
  const blocks = parseLegalMarkdown(markdown);

  it('is the approved text, byte for byte', () => {
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')).toBe(APPROVED[file]);
  });

  it('renders every character of the file: parsing loses or changes nothing', () => {
    expect(toMarkdown(blocks)).toBe(markdown);
  });

  it("the page's visible text is exactly the file's text without the Markdown symbols", () => {
    const expected = markdown
      .trimEnd()
      .replace(/^#{1,3} /gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    expect(toPlainText(blocks)).toBe(expected);
  });

  it('turning contact details into links never changes the text', () => {
    for (const block of blocks) {
      for (const inline of block.inlines) {
        if (inline.kind === 'text') expect(autolink(inline.text).map((p) => p.text).join('')).toBe(inline.text);
      }
    }
  });

  it('has one title, section headings, and ends with its "Last updated" date', () => {
    expect(blocks.filter((b) => b.kind === 'heading' && b.level === 1)).toHaveLength(1);
    expect(blocks.filter((b) => b.kind === 'heading' && b.level === 2).length).toBeGreaterThanOrEqual(3);
    expect(toPlainText(blocks.slice(-1))).toMatch(/^Last updated: \d{1,2} [A-Z][a-z]+ \d{4}$/);
  });
});

describe('document versions', () => {
  it('the server records acceptances against each file’s "Last updated" date', () => {
    expect(lastUpdatedVersion(read('web/src/content/privacy.md'))).toBe(PRIVACY_NOTICE_VERSION);
    expect(lastUpdatedVersion(read('web/src/content/terms.md'))).toBe(TERMS_OF_SERVICE_VERSION);
  });

  it('reads the date as YYYY-MM-DD', () => {
    expect(lastUpdatedVersion('**Last updated:** 6 October 2026')).toBe('2026-10-06');
    expect(lastUpdatedVersion('**Last updated:** 15 March 2027')).toBe('2027-03-15');
    expect(lastUpdatedVersion('no date')).toBeNull();
  });
});

describe('autolink', () => {
  it('links emails, phone numbers and the ACISI legal pages', () => {
    expect(autolink('email acisi.help@gmail.com or 0746404155.')).toEqual([
      { text: 'email ' },
      { text: 'acisi.help@gmail.com', href: 'mailto:acisi.help@gmail.com' },
      { text: ' or ' },
      { text: '0746404155', href: 'tel:0746404155' },
      { text: '.' },
    ]);
    expect(autolink('phone on 020 780 1800,')[1]).toEqual({ text: '020 780 1800', href: 'tel:0207801800' });
    expect(autolink('Notice at acisi.co.ke/privacy.')[1]).toEqual({ text: 'acisi.co.ke/privacy', href: '/privacy' });
  });
});

describe('legal pages in the site map and search', () => {
  it('have the agreed titles and are listed in sitemap.xml', () => {
    expect(SITEMAP_PAGES['/privacy']?.title).toBe('Privacy Notice – ACISI');
    expect(SITEMAP_PAGES['/terms']?.title).toBe('Terms of Service – ACISI');
    const sitemap = read('web/public/sitemap.xml');
    expect(sitemap).toContain(`<loc>${SITE_URL}/privacy</loc>`);
    expect(sitemap).toContain(`<loc>${SITE_URL}/terms</loc>`);
    expect(seoForPath('/privacy/')).toMatchObject({ index: true, canonicalUrl: 'https://acisi.co.ke/privacy' });
  });
});

describe.each([
  ['web', legalBoxSatisfied],
  ['console', consoleLegalBoxSatisfied],
])('checkbox rule (%s)', (_name, satisfied) => {
  it('cannot continue without ticking a required box', () => {
    expect(satisfied(true, false)).toBe(false);
    expect(satisfied(true, true)).toBe(true);
  });

  it('does not block when the box is not needed', () => {
    expect(satisfied(false, false)).toBe(true);
  });

  it('never allows submitting while it is still unknown whether the box is needed', () => {
    expect(satisfied(null, false)).toBe(false);
    expect(satisfied(null, true)).toBe(false);
  });
});

describe('Confidentiality Undertaking (C19)', () => {
  const file = 'web/src/content/confidentiality.md';
  const markdown = read(file);
  const blocks = parseLegalMarkdown(markdown);

  /** The text as supplied by ACISI, word for word (line breaks aside). */
  const SUPPLIED =
    "Confidentiality Undertaking Who signs this undertaking: Everyone who is given access to ACISI signs this undertaking. This includes the founder of ACISI Healthcare; any staff member of ACISI Healthcare; and clinic users of ACISI: doctors, clinicians, receptionists and clinic administrators. " +
    "1. What is confidential: All personal data held in ACISI is confidential. This includes patients' names, phone numbers and identity details; visit records, diagnoses and prescriptions; payment details; staff account details; and login details, including staff codes and PINs. " +
    '2. My undertaking: I undertake that I will: (a) access patient information only when I need it for my role; (b) keep my staff code and PIN private, and never let anyone else use my account; (c) log out, or lock the screen, whenever I leave a device; ' +
    "(d) not copy, photograph, screenshot, print, download or send patient information, except where this is needed for the patient's care or the clinic's administration and is allowed by my clinic or by ACISI; " +
    "(e) not discuss patient information with anyone who does not need it for the patient's care, including family, friends and on social media; and (f) report any suspected loss, misuse or unauthorised access immediately to my clinic administrator (if I work at a clinic) and to ACISI's Data Protection Officer. " +
    '3. Monitoring: Access to patient records in ACISI is recorded in an audit log, which may be reviewed to investigate misuse. ' +
    '4. Duration: This undertaking continues to apply after I leave the clinic or ACISI, or after my ACISI account is closed. ' +
    '5. Consequences of a breach: Breaking this undertaking may lead to removal of my access to ACISI, action by my employer, and liability under the Data Protection Act, 2019 and other laws of Kenya. ' +
    '6. Contact: Data Protection Officer: Megan Irungu, ACISI Healthcare. Email: acisi.help@gmail.com';

  it('is the approved text, byte for byte (change the file, the version and this hash together)', () => {
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')).toBe(
      '66142004a56ddb398a2a9f89831efb4c7f6e9554544626743bb54273b915f049',
    );
    expect(CONFIDENTIALITY_UNDERTAKING_VERSION).toBe('2026-10-31');
  });

  it('the page shows the supplied wording, word for word, and no placeholder', () => {
    const shown = toPlainText(blocks).split(/\s+/).join(' ');
    expect(shown).toBe(SUPPLIED);
    expect(markdown).not.toMatch(/placeholder/i);
    expect(toMarkdown(blocks)).toBe(markdown);
  });

  it('is published at /confidentiality-undertaking, linked from the footer, and indexable', () => {
    expect(CONFIDENTIALITY_UNDERTAKING_PATH).toBe('/confidentiality-undertaking');
    expect(read('web/src/App.tsx')).toContain('<Route path="/confidentiality-undertaking" element={<LegalPage document="confidentiality" />} />');
    expect(read('web/src/layouts/MarketingLayout.tsx')).toContain('<Link to="/confidentiality-undertaking">Confidentiality Undertaking</Link>');
    expect(seoForPath('/confidentiality-undertaking')).toMatchObject({ index: true, title: 'Confidentiality Undertaking – ACISI' });
  });

  it.each(['web/src/pages/SignupPage.tsx', 'dashboard/src/components/ProtectedLayout.tsx'])(
    'the tick-box in %s reads "I have read and agree to the ACISI Confidentiality Undertaking." and links to the full text',
    (component) => {
      const source = read(component);
      expect(CONFIDENTIALITY_UNDERTAKING_CHECKBOX).toBe('I have read and agree to the ACISI Confidentiality Undertaking.');
      expect(source).toMatch(/I have read and agree to the\{' '\}\s*<a href=\{CONFIDENTIALITY_UNDERTAKING_PATH\}[^>]*target="_blank"[^>]*>\s*ACISI Confidentiality Undertaking\s*<\/a>\s*\./);
    },
  );
});
