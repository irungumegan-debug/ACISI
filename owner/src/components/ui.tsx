import { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-stone-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-stone-200 bg-white ${className}`}>
      {title && <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">{title}</h2>}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ tone, children }: { tone: 'green' | 'red' | 'amber' | 'stone' | 'blue'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    stone: 'bg-stone-100 text-stone-600 ring-stone-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return isActive ? <Badge tone="green">Active</Badge> : <Badge tone="stone">Deactivated</Badge>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-500 focus:outline-none sm:max-w-sm"
    />
  );
}

export function Loading() {
  return <p className="py-8 text-center text-sm text-stone-500">Loading…</p>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-stone-500">{children}</p>;
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
    default: 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    primary: 'bg-stone-900 text-white hover:bg-stone-700',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/** Wraps a wide table so it scrolls sideways inside its card on a phone, instead of the whole page. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4">{children}</div>;
}

export const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-stone-500';
export const td = 'px-3 py-2 align-top text-sm text-stone-700';
