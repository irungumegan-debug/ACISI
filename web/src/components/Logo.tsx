import { useId } from 'react';

/** The serif "A" glyph inside the ring, in a 100×100 box (shared by the mark and the hero watermark). */
export const A_GLYPH_PATH =
  'M46 21 L52.7 21 L70.2 71 L74.4 72.6 L74.4 75 L57.6 75 L57.6 72.6 L61.7 71.2 L57.9 60 L36.8 60 L33.2 71.2 ' +
  'L37.6 72.6 L37.6 75 L25.8 75 L25.8 72.6 L29.6 71 Z M47 28.9 L38.3 55.5 L56.3 55.5 Z';

/**
 * ACISI's "A" mark — the favicon's gold serif A in a thin gold ring, drawn
 * as SVG so it stays sharp at every size. `framed` adds the navy tile.
 */
export function LogoMark({ size = 36, framed = false, title = 'ACISI' }: { size?: number; framed?: boolean; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title} className="logo-mark">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d67e" />
          <stop offset="0.45" stopColor="#fff0bf" />
          <stop offset="0.7" stopColor="#d4a83f" />
          <stop offset="1" stopColor="#a87a22" />
        </linearGradient>
      </defs>
      {framed && <rect width="100" height="100" rx="22" fill="#0a0f24" />}
      <circle cx="50" cy="50" r={framed ? 38 : 46} fill="none" stroke={`url(#g${id})`} strokeWidth={framed ? 1.6 : 2.4} />
      <g transform={framed ? 'translate(9.5 8.6) scale(0.81)' : undefined}>
        <path d={A_GLYPH_PATH} fill={`url(#g${id})`} fillRule="evenodd" />
      </g>
    </svg>
  );
}

/** Mark + wordmark, used in the header, footer and auth pages. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} title="" />
      <span className="logo-word">ACISI</span>
    </span>
  );
}
