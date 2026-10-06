/**
 * The legal documents (web/src/content/privacy.md, terms.md) are approved
 * legal text, rendered word for word. They only use #/##/### headings,
 * paragraphs, **bold** and [links](url), so this small parser covers exactly
 * that rather than pulling in a Markdown library. Pure — no DOM — so the
 * backend's Jest suite can prove the rendered text is the file, exactly
 * (tests/web/legal.test.ts).
 */

export type Inline = { kind: 'text'; text: string } | { kind: 'strong'; text: string } | { kind: 'link'; text: string; href: string };

export type Block = { kind: 'heading'; level: 1 | 2 | 3; id: string; inlines: Inline[] } | { kind: 'paragraph'; inlines: Inline[] };

const INLINE_PATTERN = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInlines(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE_PATTERN)) {
    if (m.index! > last) out.push({ kind: 'text', text: source.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'strong', text: m[1] });
    else out.push({ kind: 'link', text: m[2]!, href: m[3]! });
    last = m.index! + m[0].length;
  }
  if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
  return out;
}

/** "Who are we and how can you contact us?" -> "who-are-we-and-how-can-you-contact-us" */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function inlineText(inlines: Inline[]): string {
  return inlines.map((i) => i.text).join('');
}

/** Blocks are separated by blank lines; a block starting with 1–3 "#" is a heading. */
export function parseLegalMarkdown(markdown: string): Block[] {
  return markdown
    .replace(/\n+$/, '')
    .split('\n\n')
    .map((chunk): Block => {
      const heading = /^(#{1,3}) (.*)$/.exec(chunk);
      if (heading) {
        const inlines = parseInlines(heading[2]!);
        return { kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, id: slugify(inlineText(inlines)), inlines };
      }
      return { kind: 'paragraph', inlines: parseInlines(chunk) };
    });
}

/** Back to Markdown — for the test that nothing in the file is lost or changed by parsing. */
export function toMarkdown(blocks: Block[]): string {
  const inline = (inlines: Inline[]) =>
    inlines.map((i) => (i.kind === 'strong' ? `**${i.text}**` : i.kind === 'link' ? `[${i.text}](${i.href})` : i.text)).join('');
  return `${blocks.map((b) => (b.kind === 'heading' ? `${'#'.repeat(b.level)} ${inline(b.inlines)}` : inline(b.inlines))).join('\n\n')}\n`;
}

/** The visible text of the rendered page, block by block. */
export function toPlainText(blocks: Block[]): string {
  return blocks.map((b) => inlineText(b.inlines)).join('\n\n');
}

export interface TextPiece {
  text: string;
  /** Set when this piece should be a tap-to-email/call/open link; the text itself is never changed. */
  href?: string;
}

const AUTOLINK_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b0\d{9}\b|\b0\d{2} \d{3} \d{4}\b|\bacisi\.co\.ke\/(?:privacy|terms)\b/g;

/** Splits plain text so emails, phone numbers and acisi.co.ke/privacy|terms can be links. Joining the pieces gives back `text`. */
export function autolink(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(AUTOLINK_PATTERN)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const t = m[0];
    const href = t.includes('@') ? `mailto:${t}` : t.startsWith('acisi.co.ke/') ? t.slice('acisi.co.ke'.length) : `tel:${t.replace(/\s/g, '')}`;
    out.push({ text: t, href });
    last = m.index! + t.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "**Last updated:** 6 October 2026" -> "2026-10-06" — the document's version. */
export function lastUpdatedVersion(markdown: string): string | null {
  const m = /\*\*Last updated:\*\* (\d{1,2}) ([A-Z][a-z]+) (\d{4})/.exec(markdown);
  const month = m ? MONTHS.indexOf(m[2]!) : -1;
  if (!m || month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}
