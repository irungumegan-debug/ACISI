import { A_GLYPH_PATH } from './Logo';

/** The huge, faint "A" mark behind the hero and auth pages — decoration only. */
export function Watermark({ className = '' }: { className?: string }) {
  return (
    <svg className={`watermark ${className}`} viewBox="0 0 100 100" aria-hidden focusable="false">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.5" />
      <path d={A_GLYPH_PATH} fill="none" stroke="currentColor" strokeWidth="0.45" strokeLinejoin="round" />
    </svg>
  );
}
