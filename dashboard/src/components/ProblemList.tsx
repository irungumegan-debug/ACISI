import { FormEvent, useState } from 'react';
import { ListChecks, Lock } from 'lucide-react';
import { api, ApiError, Icd11Code, ProblemItem } from '../lib/api';
import { Icd11Picker } from './Icd11Picker';
import { Badge, btn, Card, field } from './ui';

const STATUS: Record<ProblemItem['status'], { label: string; tone: 'success' | 'neutral' | 'warning' }> = {
  ACTIVE: { label: 'Active', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  ENTERED_IN_ERROR: { label: 'Entered in error', tone: 'neutral' },
};
const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The patient's problem list on the consultation page: add (ICD-11), resolve, make active again, entered in error, with history. */
export function ProblemList({ encounterId, initial, hiddenElsewhere }: { encounterId: string; initial: ProblemItem[]; hiddenElsewhere: boolean }) {
  const [problems, setProblems] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Icd11Code | null>(null);
  const [note, setNote] = useState('');
  const [onset, setOnset] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ problems: ProblemItem[] }>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setProblems((await fn()).problems);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!picked) return;
    if (await run(() => api.addProblem(encounterId, { icd11Code: picked.code, note: note || undefined, onsetDate: onset || undefined }))) {
      setPicked(null);
      setNote('');
      setOnset('');
      setAdding(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card
      title="Problem list"
      icon={ListChecks}
      className="mb-6"
      actions={
        !adding ? (
          <button type="button" className={btn.ghost} onClick={() => setAdding(true)}>
            + Add problem
          </button>
        ) : undefined
      }
    >
      <p className="mb-3 text-xs text-ink-500">Long-term or important conditions that matter beyond this visit (e.g. hypertension, diabetes, asthma).</p>
      {problems.length === 0 && !adding && <p className="text-sm text-ink-500">No problems recorded.</p>}
      {problems.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {problems.map((p) => (
            <li key={p.id} className={`p-3 text-sm ${p.status === 'ENTERED_IN_ERROR' ? 'opacity-60' : ''}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className={`font-medium text-navy-900 ${p.status === 'ENTERED_IN_ERROR' ? 'line-through' : ''}`}>
                    {p.title} <span className="font-mono text-xs text-ink-500">{p.icd11Code}</span>
                  </p>
                  {p.note && <p className="text-ink-700">{p.note}</p>}
                  <p className="text-xs text-ink-500">
                    {p.onsetDate ? `Since ${fmt(p.onsetDate)} · ` : ''}Recorded {fmt(p.recordedAt)}
                    {!p.isOwnClinic ? ' at another clinic' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                  {p.status === 'ACTIVE' && (
                    <button type="button" className={btn.ghost} disabled={busy} onClick={() => void run(() => api.updateProblem(encounterId, p.id, { status: 'RESOLVED' }))}>
                      Resolved
                    </button>
                  )}
                  {p.status === 'RESOLVED' && (
                    <button type="button" className={btn.ghost} disabled={busy} onClick={() => void run(() => api.updateProblem(encounterId, p.id, { status: 'ACTIVE' }))}>
                      Active again
                    </button>
                  )}
                  {p.status !== 'ENTERED_IN_ERROR' && (
                    <>
                      <button
                        type="button"
                        className={btn.ghost}
                        disabled={busy}
                        onClick={() => {
                          const n = prompt('Note for this problem (leave empty to remove it):', p.note ?? '');
                          if (n !== null) void run(() => api.updateProblem(encounterId, p.id, { note: n.trim() || null }));
                        }}
                      >
                        Edit note
                      </button>
                      <button
                        type="button"
                        className={btn.ghost}
                        disabled={busy}
                        onClick={() => {
                          if (confirm('Mark this problem as entered in error? It stays in the history.')) void run(() => api.updateProblem(encounterId, p.id, { status: 'ENTERED_IN_ERROR' }));
                        }}
                      >
                        Error
                      </button>
                    </>
                  )}
                </div>
              </div>
              {p.history.length > 1 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-semibold text-gold-700">History</summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
                    {p.history.map((h, i) => (
                      <li key={i}>
                        {fmt(h.at)}: {h.action}, {h.byName}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {hiddenElsewhere && (
        <p className="mb-3 flex items-start gap-2 text-xs text-ink-500">
          <Lock size={13} aria-hidden className="mt-0.5 flex-none" /> Other clinics recorded problems that aren&apos;t shown (no sharing consent).
        </p>
      )}
      {adding && (
        <form onSubmit={(e) => void add(e)} className="space-y-3">
          <div>
            <p className={field.label}>Condition (ICD-11)</p>
            <Icd11Picker value={picked ? [picked] : []} onChange={(codes) => setPicked(codes[codes.length - 1] ?? null)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <div>
              <label className={field.label} htmlFor="problemNote">Note (optional)</label>
              <input id="problemNote" className={field.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. On amlodipine 5 mg since 2024" />
            </div>
            <div>
              <label className={field.label} htmlFor="problemOnset">Since (optional)</label>
              <input id="problemOnset" type="date" className={field.input} value={onset} max={today} onChange={(e) => setOnset(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btn.primary} disabled={busy || !picked}>
              {busy ? 'Adding…' : 'Add to problem list'}
            </button>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => setAdding(false)}>
              Close
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
