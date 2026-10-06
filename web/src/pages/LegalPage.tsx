import privacyMarkdown from '../content/privacy.md?raw';
import termsMarkdown from '../content/terms.md?raw';
import { inlineText, parseLegalMarkdown } from '../lib/legalMarkdown';
import { LegalText } from '../components/LegalText';
import { Watermark } from '../components/Watermark';

const DOCUMENTS = {
  privacy: parseLegalMarkdown(privacyMarkdown),
  terms: parseLegalMarkdown(termsMarkdown),
};

/**
 * /privacy and /terms: the approved documents in web/src/content/, word for
 * word (tests/web/legal.test.ts checks the rendered text against the files).
 * The document's own "# " title becomes the page title; everything after it,
 * including the closing "Last updated" line, follows in order.
 */
export function LegalPage({ document }: { document: keyof typeof DOCUMENTS }) {
  const [title, ...body] = DOCUMENTS[document];
  const titleId = `${document}-title`;

  return (
    <div>
      <section className="page-hero legal-hero" aria-labelledby={titleId}>
        <Watermark className="page-hero-watermark" />
        <div className="container page-hero-inner">
          <p className="eyebrow">Legal</p>
          <h1 id={titleId} className="page-title legal-title">
            {title ? inlineText(title.inlines) : ''}
          </h1>
        </div>
      </section>

      <section className="band band-light legal-band">
        <article className="container legal-doc">
          <LegalText blocks={body} />
        </article>
      </section>
    </div>
  );
}
