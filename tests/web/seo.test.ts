import fs from 'fs';
import path from 'path';
import { OG_IMAGE_URL, SITE_URL, SITEMAP_PAGES, normalizePath, seoForPath } from '../../web/src/lib/seo';

const root = path.join(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('sitemap.xml', () => {
  const locs = [...read('web/public/sitemap.xml').matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

  it('lists exactly the indexable public pages from lib/seo.ts', () => {
    const expected = Object.keys(SITEMAP_PAGES).map((p) => `${SITE_URL}${p}`);
    expect(locs.sort()).toEqual(expected.sort());
    expect(Object.values(SITEMAP_PAGES).every((p) => p.index)).toBe(true);
  });

  it('never lists a logged-in area', () => {
    for (const loc of locs) expect(loc).not.toMatch(/\/(console|owner|patient|api)(\/|$)/);
  });
});

describe('robots.txt', () => {
  const robots = read('web/public/robots.txt');

  it('points to the sitemap and keeps crawlers out of the API', () => {
    expect(robots).toContain('Sitemap: https://acisi.co.ke/sitemap.xml');
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
  });

  it('lets crawlers fetch the logged-in areas, so they can see the noindex tag', () => {
    expect(robots).not.toMatch(/^Disallow: \/(console|owner|patient)/m);
  });
});

describe('noindex on logged-in pages', () => {
  it.each(['dashboard/index.html', 'owner/index.html'])('%s is noindex', (file) => {
    expect(read(file)).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('the patient portal and unknown paths are noindex, with no canonical', () => {
    for (const p of ['/patient', '/patient/', '/no-such-page']) {
      expect(seoForPath(p)).toMatchObject({ index: false, canonicalUrl: null });
    }
  });

  it('public pages are indexable with a canonical URL', () => {
    expect(seoForPath('/')).toMatchObject({ index: true, canonicalUrl: 'https://acisi.co.ke/' });
    expect(seoForPath('/about/')).toMatchObject({ index: true, canonicalUrl: 'https://acisi.co.ke/about' });
    expect(normalizePath('/contact///')).toBe('/contact');
  });
});

describe('home page share tags (web/index.html)', () => {
  const html = read('web/index.html');

  it('match the home page entry in lib/seo.ts', () => {
    const home = SITEMAP_PAGES['/']!;
    expect(html).toContain(`<title>${home.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${home.description}" />`);
    expect(html).toContain(`<meta property="og:title" content="${home.title}" />`);
    expect(html).toContain(`<meta property="og:description" content="${home.description}" />`);
  });

  it('use an absolute image URL whose file exists', () => {
    expect(html).toContain(`<meta property="og:image" content="${OG_IMAGE_URL}" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${OG_IMAGE_URL}" />`);
    expect(fs.existsSync(path.join(root, 'web/public', path.basename(OG_IMAGE_URL)))).toBe(true);
  });

  it('carry no canonical, since the same file is served for every route', () => {
    expect(html).not.toContain('rel="canonical"');
  });
});

describe('site icons (web/public)', () => {
  const pub = (file: string) => fs.readFileSync(path.join(root, 'web/public', file));
  const html = read('web/index.html');

  it('favicon.ico is a real icon file with 16, 32 and 48px images, so /favicon.ico is never the HTML page', () => {
    const ico = pub('favicon.ico');
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]); // ICONDIR: reserved 0, type 1 (icon)
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16]);
    expect(sizes.sort((a, b) => a! - b!)).toEqual([16, 32, 48]);
  });

  it('apple-touch-icon.png is a 180x180 PNG', () => {
    const png = pub('apple-touch-icon.png');
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180]); // IHDR width, height
  });

  it('every icon is linked from index.html, and every linked icon exists', () => {
    expect(html).toContain('<link rel="icon" href="%BASE_URL%favicon.ico"');
    expect(html).toContain('<link rel="icon" type="image/png" href="%BASE_URL%favicon.png"');
    expect(html).toContain('<link rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png" />');
    for (const [, file] of html.matchAll(/rel="(?:icon|apple-touch-icon)"[^>]*href="%BASE_URL%([^"]+)"/g)) {
      expect(fs.existsSync(path.join(root, 'web/public', file!))).toBe(true);
    }
  });
});
