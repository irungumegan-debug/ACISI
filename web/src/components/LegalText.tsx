import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { autolink, Block, Inline } from '../lib/legalMarkdown';

/** Plain text, with emails, phone numbers and the ACISI legal pages made tappable. The words are unchanged. */
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {autolink(text).map((piece, i) =>
        !piece.href ? (
          <Fragment key={i}>{piece.text}</Fragment>
        ) : piece.href.startsWith('/') ? (
          <Link key={i} to={piece.href}>
            {piece.text}
          </Link>
        ) : (
          <a key={i} href={piece.href}>
            {piece.text}
          </a>
        ),
      )}
    </>
  );
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, i) =>
        inline.kind === 'strong' ? (
          <strong key={i}>{inline.text}</strong>
        ) : inline.kind === 'link' ? (
          <a key={i} href={inline.href} target="_blank" rel="noopener noreferrer">
            {inline.text}
          </a>
        ) : (
          <LinkedText key={i} text={inline.text} />
        ),
      )}
    </>
  );
}

/** Renders parsed legal Markdown blocks (see lib/legalMarkdown.ts). The level-1 title is rendered by the page itself. */
export function LegalText({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={i}>
              <Inlines inlines={block.inlines} />
            </p>
          );
        }
        const Heading = block.level === 2 ? 'h2' : 'h3';
        return (
          <Heading key={i} id={block.id}>
            <Inlines inlines={block.inlines} />
          </Heading>
        );
      })}
    </>
  );
}
