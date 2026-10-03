import { ReactNode, useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Footprints,
  Hourglass,
  Stethoscope,
  Wallet,
  XCircle,
} from 'lucide-react';

/*
 * Shared console building blocks. Styling only — nothing here fetches data
 * or changes behaviour. Colours come from brand/tokens.css via Tailwind.
 */

// --- Brand --------------------------------------------------------------------

/** The serif "A" glyph of the ACISI mark, in a 100×100 box. */
export const A_GLYPH_PATH =
  'M46 21 L52.7 21 L70.2 71 L74.4 72.6 L74.4 75 L57.6 75 L57.6 72.6 L61.7 71.2 L57.9 60 L36.8 60 L33.2 71.2 ' +
  'L37.6 72.6 L37.6 75 L25.8 75 L25.8 72.6 L29.6 71 Z M47 28.9 L38.3 55.5 L56.3 55.5 Z';

export function LogoMark({ size = 32, title = 'ACISI' }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}>
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

/** Huge faint "A" outline for navy backgrounds — decoration only. */
export function Watermark({ className = '' }: { className?: string }) {
  return (
    <svg className={`pointer-events-none ${className}`} viewBox="0 0 100 100" aria-hidden focusable="false">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.5" />
      <path d={A_GLYPH_PATH} fill="none" stroke="currentColor" strokeWidth="0.45" strokeLinejoin="round" />
    </svg>
  );
}

// --- People -------------------------------------------------------------------

export function initialsOf(name: string): string {
  const words = name
    .replace(/^(dr|dr\.)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const AVATAR_TONES = [
  'bg-navy-800 text-gold-300',
  'bg-teal-100 text-teal-800',
  'bg-blue-100 text-blue-800',
  'bg-amber-100 text-amber-900',
  'bg-emerald-100 text-emerald-800',
  'bg-rose-100 text-rose-800',
];

/** Initials in a circle; the colour is stable per name. */
export function Avatar({ name, size = 'md', className = '' }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg' };
  return (
    <span aria-hidden className={`inline-flex flex-none items-center justify-center rounded-full font-semibold ${sizes[size]} ${tone} ${className}`}>
      {initialsOf(name)}
    </span>
  );
}

// --- Status badges ------------------------------------------------------------

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'blue' | 'neutral' | 'gold';

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-teal-50 text-teal-800 ring-teal-200',
  blue: 'bg-blue-50 text-blue-800 ring-blue-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  gold: 'bg-white text-gold-700 ring-gold-500',
};

/** A coloured pill. Always carries a text label, so colour is never the only signal. */
export function Badge({ tone, icon: Icon, children, className = '' }: { tone: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE_CLASSES[tone]} ${className}`}
    >
      {Icon && <Icon size={13} aria-hidden strokeWidth={2.4} />}
      {children}
    </span>
  );
}

const STATUS: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  // visit (encounter)
  WAITING: { label: 'Waiting', tone: 'warning', icon: Hourglass },
  IN_CONSULTATION: { label: 'In consultation', tone: 'info', icon: Stethoscope },
  READY_FOR_CHECKOUT: { label: 'Ready for checkout', tone: 'blue', icon: Wallet },
  DONE: { label: 'Done', tone: 'success', icon: CheckCircle2 },
  // bill
  PAID: { label: 'Paid', tone: 'success', icon: CheckCircle2 },
  PARTLY_PAID: { label: 'Partly paid', tone: 'warning', icon: CircleDashed },
  UNPAID: { label: 'Unpaid', tone: 'danger', icon: AlertCircle },
  NONE: { label: 'No bill yet', tone: 'neutral', icon: Clock },
  // payment
  PENDING: { label: 'Waiting for patient', tone: 'warning', icon: Hourglass },
  SUCCEEDED: { label: 'Paid', tone: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Failed', tone: 'danger', icon: XCircle },
  CANCELLED: { label: 'Cancelled', tone: 'danger', icon: XCircle },
  TIMED_OUT: { label: 'Timed out', tone: 'neutral', icon: Clock },
  VOIDED: { label: 'Voided', tone: 'neutral', icon: XCircle },
};

/** Badge for any visit, bill or payment status code, e.g. "WAITING" or "PARTLY_PAID". */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, ' ').toLowerCase(), tone: 'neutral' as Tone, icon: Clock };
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {label ?? s.label}
    </Badge>
  );
}

export function WalkInBadge() {
  return (
    <Badge tone="gold" icon={Footprints}>
      Walk-in
    </Badge>
  );
}

// --- Layout pieces ------------------------------------------------------------

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  icon: Icon,
  actions,
  children,
  className = '',
  bodyClassName = 'p-5',
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white shadow-card ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2.5 text-base font-semibold text-navy-900">
            {Icon && (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-tint text-gold-700">
                <Icon size={17} aria-hidden />
              </span>
            )}
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

type StatTone = 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'blue';

const STAT_TONES: Record<StatTone, { strip: string; circle: string }> = {
  gold: { strip: 'bg-gold-500', circle: 'bg-gold-tint text-gold-700' },
  success: { strip: 'bg-emerald-500', circle: 'bg-emerald-50 text-emerald-700' },
  warning: { strip: 'bg-amber-500', circle: 'bg-amber-50 text-amber-700' },
  danger: { strip: 'bg-red-500', circle: 'bg-red-50 text-red-700' },
  info: { strip: 'bg-teal-500', circle: 'bg-teal-50 text-teal-700' },
  blue: { strip: 'bg-blue-500', circle: 'bg-blue-50 text-blue-700' },
};

/** Icon in a coloured circle, label, big number, coloured top strip. `hero` is the navy/gold "Total" style. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'gold',
  hint,
  hero = false,
  accent,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  hint?: ReactNode;
  hero?: boolean;
  /** Optional exact strip colour (e.g. to match a chart series). */
  accent?: string;
}) {
  if (hero) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy-700 via-navy-900 to-navy-950 p-5 text-white shadow-raised ring-1 ring-gold-500/40">
        <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-foil" />
        <div aria-hidden className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gold-400/15 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-slate-300">{label}</p>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-foil text-navy-900">
            <Icon size={19} aria-hidden />
          </span>
        </div>
        <p className="relative mt-2 font-display text-3xl font-bold tracking-tight text-gold-300 tabular-nums">{value}</p>
        {hint && <p className="relative mt-1 text-sm text-slate-300">{hint}</p>}
      </div>
    );
  }
  const t = STAT_TONES[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
      <div aria-hidden className={`absolute inset-x-0 top-0 h-1 ${accent ? '' : t.strip}`} style={accent ? { background: accent } : undefined} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${t.circle}`}>
          <Icon size={19} aria-hidden />
        </span>
      </div>
      <p className="mt-2 font-display text-3xl font-bold tracking-tight text-navy-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-sm text-ink-500">{hint}</p>}
    </div>
  );
}

/** A friendly icon plus a short message, instead of plain grey text. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  tone = 'neutral',
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'success' | 'gold';
  action?: ReactNode;
}) {
  const circle = {
    neutral: 'bg-slate-100 text-slate-500',
    success: 'bg-emerald-50 text-emerald-600',
    gold: 'bg-gold-tint text-gold-700',
  }[tone];
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${circle}`}>
        <Icon size={26} aria-hidden />
      </span>
      <p className="font-display text-base font-semibold text-navy-900">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// --- Loading ------------------------------------------------------------------

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** A card-shaped placeholder list shown while a page loads. */
export function SkeletonList({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-white p-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

// --- Buttons and inputs (class strings, so existing elements keep their props) --

export const btn = {
  gold: 'btn-gold min-h-11 px-5 py-2.5 text-sm',
  primary:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-700 disabled:opacity-50',
  secondary:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-navy-900 transition hover:border-gold-500 hover:bg-gold-tint/40 disabled:opacity-50',
  danger:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50',
  ghost: 'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-navy-900 underline-offset-4 hover:underline',
};

export const field = {
  label: 'mb-1.5 block text-sm font-medium text-ink-700',
  input:
    'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-navy-900 placeholder:text-slate-400 transition focus:border-gold-500 focus:outline-none',
};
