import { FormEvent, useState } from 'react';
import { CircleOff, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { AdminDepartment, api, ApiError } from '../lib/api';
import { CODE_PATTERN, cleanName, nameKey, suggestCode } from '../lib/departments';
import { Badge, btn, EmptyState, field, Skeleton } from './ui';

const smallBtn =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy-900 transition hover:border-gold-500 disabled:opacity-50';

function kes(n: number): string {
  return `KES ${n.toLocaleString('en-KE')}`;
}

/** "" -> null (use the clinic default); digits -> number; anything else -> undefined (invalid). */
function parseFee(text: string): number | null | undefined {
  const t = text.replace(/[,\s]/g, '');
  if (!t) return null;
  return /^\d{1,7}$/.test(t) ? Number(t) : undefined;
}

/**
 * Clinic admin: the clinic's own departments — add, rename, change the short
 * code or consultation fee, deactivate/reactivate, and delete one that was
 * never used. Departments with history are deactivated, never deleted.
 */
export function DepartmentsSection({
  departments,
  onChanged,
}: {
  departments: AdminDepartment[] | null;
  onChanged: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      await onChanged();
      setNotice(success);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function deactivate(d: AdminDepartment) {
    const warning = d.upcomingAppointmentCount
      ? `\n\n${d.upcomingAppointmentCount} upcoming appointment${d.upcomingAppointmentCount === 1 ? ' is' : 's are'} booked in ${d.name}. They stay booked — you can see and cancel them on the Appointments page.`
      : '';
    if (!window.confirm(`Deactivate ${d.name}?\n\nPatients won't be able to check in to it any more. Past visits keep showing it.${warning}`)) return;
    void run(d.id, () => api.updateDepartment(d.id, { isActive: false }), `${d.name} deactivated.`);
  }

  function remove(d: AdminDepartment) {
    if (!window.confirm(`Delete ${d.name}? It has never been used, so nothing is lost.`)) return;
    void run(d.id, () => api.deleteDepartment(d.id), `${d.name} deleted.`);
  }

  if (departments === null) {
    return (
      <div role="status" aria-label="Loading departments" className="space-y-2">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    );
  }

  const activeCount = departments.filter((d) => d.isActive).length;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {departments.length === 0 ? (
        <EmptyState icon={Plus} tone="gold" title="No departments yet">
          Add your first department below.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
          {departments.map((d) =>
            editingId === d.id ? (
              <li key={d.id} className="bg-cream-50 p-4">
                <DepartmentForm
                  initial={d}
                  takenNames={departments.filter((o) => o.id !== d.id).map((o) => o.name)}
                  takenCodes={departments.filter((o) => o.id !== d.id).map((o) => o.code)}
                  submitLabel="Save changes"
                  busy={busyId === d.id}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (values) => {
                    const ok = await run(d.id, () => api.updateDepartment(d.id, values), `${values.name} saved.`);
                    if (ok) setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li key={d.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 ${d.isActive ? '' : 'bg-slate-50'}`}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className={`font-semibold ${d.isActive ? 'text-navy-900' : 'text-ink-500'}`}>{d.name}</span>
                    <span className="rounded-md bg-navy-900 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-gold-300">{d.code}</span>
                    {d.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {d.consultationFeeKes !== null ? `Consultation ${kes(d.consultationFeeKes)}` : 'Clinic default fee'} · {d.visitCount} visit
                    {d.visitCount === 1 ? '' : 's'} · {d.doctorCount} doctor{d.doctorCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={smallBtn} disabled={busyId !== null} onClick={() => setEditingId(d.id)}>
                    <Pencil size={13} aria-hidden /> Edit
                  </button>
                  {d.isActive ? (
                    <button
                      type="button"
                      className={`${smallBtn} hover:border-red-400 hover:text-red-700`}
                      disabled={busyId !== null || activeCount <= 1}
                      title={activeCount <= 1 ? 'A clinic needs at least one active department' : undefined}
                      onClick={() => deactivate(d)}
                    >
                      <CircleOff size={13} aria-hidden /> Deactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={smallBtn}
                      disabled={busyId !== null}
                      onClick={() => void run(d.id, () => api.updateDepartment(d.id, { isActive: true }), `${d.name} is active again.`)}
                    >
                      <RotateCcw size={13} aria-hidden /> Reactivate
                    </button>
                  )}
                  {d.canDelete && (
                    <button
                      type="button"
                      aria-label={`Delete ${d.name}`}
                      className={`${smallBtn} hover:border-red-400 hover:text-red-700`}
                      disabled={busyId !== null}
                      onClick={() => remove(d)}
                    >
                      <Trash2 size={13} aria-hidden /> Delete
                    </button>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="rounded-2xl border border-dashed border-slate-300 p-4">
        <p className="mb-3 text-sm font-semibold text-navy-900">Add a department</p>
        <DepartmentForm
          key={departments.length}
          takenNames={departments.map((d) => d.name)}
          takenCodes={departments.map((d) => d.code)}
          submitLabel="Add department"
          busy={busyId === 'new'}
          onSubmit={async (values) => {
            await run('new', () => api.createDepartment(values), `${values.name} added.`);
          }}
        />
      </div>
      <p className="text-xs text-ink-500">
        Departments with visits can&apos;t be deleted, only deactivated — so past records keep their department. Short codes are
        2–6 capital letters or numbers, kept for future USSD check-in.
      </p>
    </div>
  );
}

function DepartmentForm({
  initial,
  takenNames,
  takenCodes,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: AdminDepartment;
  takenNames: string[];
  takenCodes: string[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: { name: string; code: string; consultationFeeKes: number | null }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(Boolean(initial));
  const [fee, setFee] = useState(initial?.consultationFeeKes != null ? String(initial.consultationFeeKes) : '');
  const [problem, setProblem] = useState<string | null>(null);

  function changeName(value: string) {
    setName(value);
    if (!codeTouched) setCode(cleanName(value).length >= 1 ? suggestCode(value, takenCodes) : '');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = cleanName(name);
    const c = code.trim().toUpperCase();
    const f = parseFee(fee);
    if (n.length < 2) return setProblem('Type a name of at least 2 characters.');
    if (takenNames.some((t) => nameKey(t) === nameKey(n))) return setProblem(`There is already a department called "${n}".`);
    if (!CODE_PATTERN.test(c)) return setProblem('The short code must be 2–6 capital letters or numbers, e.g. BRC.');
    if (takenCodes.some((t) => t.toUpperCase() === c)) return setProblem(`The short code ${c} is already used.`);
    if (f === undefined) return setProblem('The fee must be a whole number of KES, or left empty.');
    setProblem(null);
    await onSubmit({ name: n, code: c, consultationFeeKes: f });
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem_10rem]">
        <label>
          <span className={field.label}>Name</span>
          <input value={name} maxLength={60} onChange={(e) => changeName(e.target.value)} placeholder="e.g. Braces" className={`${field.input} text-base sm:text-[15px]`} />
        </label>
        <label>
          <span className={field.label}>Short code</span>
          <input
            value={code}
            maxLength={6}
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            }}
            placeholder="BRC"
            className={`${field.input} font-mono uppercase tracking-wider`}
          />
        </label>
        <label>
          <span className={field.label}>Fee (KES)</span>
          <input value={fee} inputMode="numeric" onChange={(e) => setFee(e.target.value)} placeholder="Clinic default" className={`${field.input} text-base sm:text-[15px]`} />
        </label>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className={btn.secondary}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy || !name.trim()} className={btn.gold}>
          {initial ? null : <Plus size={16} aria-hidden />}
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
