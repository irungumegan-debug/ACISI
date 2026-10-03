import { ReactNode, useId } from 'react';
import { CircleAlert, Inbox, Search } from 'lucide-react';

/*
 * Owner-site building blocks, styled with the shared ACISI design tokens.
 * Same exports and props as before; only the look changed.
 */

export const A_GLYPH_PATH =
  'M46 21 L52.7 21 L70.2 71 L74.4 72.6 L74.4 75 L57.6 75 L57.6 72.6 L61.7 71.2 L57.9 60 L36.8 60 L33.2 71.2 ' +
  'L37.6 72.6 L37.6 75 L25.8 75 L25.8 72.6 L29.6 71 Z M47 28.9 L38.3 55.5 L56.3 55.5 Z';

export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d67e" />
          <stop offset="0.45" stopColor="#fff0bf" />
          <stop offset="0.7" stopColor="#d4a83f" />
          <stop offset="1" stopColor="#a87a22" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="none" stroke={`url(#g${id})`} strokeWidth="2.4" />
      <path d={A_GLYPH_PATH} fill={`url(#g${id})`} fillRule="evenodd" />
    </svg>
  );
}

export function Watermark({ className = '' }: { className?: string }) {
  return (
    <svg className={`pointer-events-none ${className}`} viewBox="0 0 100 100" aria-hidden focusable="false">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.5" />
      <path d={A_GLYPH_PATH} fill="none" stroke="currentColor" strokeWidth="0.45" strokeLinejoin="round" />
    </svg>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-stone-200/80 bg-white shadow-card ${className}`}>
      {title && (
        <h2 className="flex items-center gap-2.5 border-b border-stone-100 px-5 py-4 text-base font-semibold text-navy-900">
          <span aria-hidden className="h-4 w-1 rounded-full bg-foil" />
          {title}
        </h2>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Badge({ tone, children }: { tone: 'green' | 'red' | 'amber' | 'stone' | 'blue'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    stone: 'bg-stone-100 text-stone-600 ring-stone-200',
    blue: 'bg-teal-50 text-teal-800 ring-teal-200',
  };
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return isActive ? <Badge tone="green">Active</Badge> : <Badge tone="stone">Deactivated</Badge>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative w-full sm:max-w-sm">
      <span className="sr-only">{placeholder}</span>
      <Search size={17} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-11 w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-3.5 text-[15px] text-navy-900 placeholder:text-stone-400 focus:border-gold-500 focus:outline-none"
      />
    </label>
  );
}

export function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-16" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
      <CircleAlert size={16} aria-hidden className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gold-tint text-gold-700">
        <Inbox size={22} aria-hidden />
      </span>
      <p className="text-sm text-ink-500">{children}</p>
    </div>
  );
}

export function Button({
  children,
  onClick,
  tone = 'default',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const tones = {
    default: 'border border-stone-300 bg-white text-navy-900 hover:border-gold-500',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    primary: 'btn-gold',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/** Wraps a wide table so it scrolls sideways inside its card on a phone, instead of the whole page. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="relative -mx-5 overflow-x-auto px-5">{children}</div>;
}

export const th = 'whitespace-nowrap bg-cream-50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-ink-500';
export const td = 'px-3 py-3 align-top text-sm text-ink-700';
