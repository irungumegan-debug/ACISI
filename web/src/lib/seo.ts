/**
 * Search-engine and link-preview details for every route of the public site.
 * Pure data and lookups — no DOM — so the backend's Jest suite can check it
 * against web/public/sitemap.xml (tests/web/seo.test.ts).
 */

export const SITE_URL = 'https://acisi.co.ke';
export const SITE_NAME = 'ACISI';
/** Absolute, as WhatsApp/LinkedIn/X require. The file is web/public/og-image.jpg (1200×630). */
export const OG_IMAGE_URL = `${SITE_URL}/og-image.jpg`;

export interface PageSeo {
  title: string;
  description: string;
  /** false adds <meta name="robots" content="noindex, nofollow">. */
  index: boolean;
}

/**
 * The public pages Google should index. Every entry here must also be listed
 * in web/public/sitemap.xml, and nothing else may be — the test enforces it.
 */
export const SITEMAP_PAGES: Readonly<Record<string, PageSeo>> = {
  '/': {
    title: 'ACISI – Clinic management for Kenya',
    description:
      'One system for patients, doctors and clinic staff: check-in, records, prescriptions and payments, without the paper files.',
    index: true,
  },
  '/about': {
    title: 'About ACISI – Clinic management for Kenya',
    description:
      'Why ACISI exists: one shared record for each clinic visit, from check-in to checkout, for patients, doctors and clinic staff in Kenya.',
    index: true,
  },
  '/contact': {
    title: 'Contact ACISI – Book a demo',
    description:
      'Questions about ACISI, or want a demo for your clinic? Email or call us. Support Mon–Fri 8am–6pm and weekends 10am–5pm EAT.',
    index: true,
  },
  '/privacy': {
    title: 'Privacy Notice – ACISI',
    description:
      'What personal data ACISI collects, why, who sees it, where it is stored in Kenya, and your rights under the Data Protection Act, 2019.',
    index: true,
  },
  '/terms': {
    title: 'Terms of Service – ACISI',
    description:
      'The agreement between ACISI and everyone who uses it: patients, and the clinics, owners, administrators and staff who sign up.',
    index: true,
  },
};

/** Other routes of this app: reachable from search, but not listed in the sitemap, or kept out of search entirely. */
const OTHER_PAGES: Readonly<Record<string, PageSeo>> = {
  '/login': {
    title: 'Log in – ACISI',
    description: 'Log in to ACISI as a patient, doctor or clinic staff member.',
    index: true,
  },
  '/signup': {
    title: 'Sign up – ACISI',
    description: 'Create an ACISI account as a patient, or register your clinic.',
    index: true,
  },
  // Logged-in area: never shown in search results.
  '/patient': {
    title: 'Patient portal – ACISI',
    description: 'Your ACISI patient portal.',
    index: false,
  },
};

/** Unknown paths: never indexed, so a mistyped link can't end up in search results. */
const FALLBACK: PageSeo = {
  title: 'ACISI',
  description: SITEMAP_PAGES['/']!.description,
  index: false,
};

/** "/about/" → "/about"; "/" stays "/". */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function seoForPath(pathname: string): PageSeo & { canonicalUrl: string | null } {
  const path = normalizePath(pathname);
  const page = SITEMAP_PAGES[path] ?? OTHER_PAGES[path] ?? FALLBACK;
  return { ...page, canonicalUrl: page.index ? `${SITE_URL}${path === '/' ? '/' : path}` : null };
}
