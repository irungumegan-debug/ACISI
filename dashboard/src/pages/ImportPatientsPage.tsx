import { ChangeEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CircleCheckBig, FileSpreadsheet, MessageSquareText, Send } from 'lucide-react';
import { api, ApiError, ImportPreview, ImportRowStatus } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Badge, btn, Card, Tone } from '../components/ui';

const STATUS: Record<ImportRowStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'success' },
  existing: { label: 'On ACISI — will link', tone: 'info' },
  already_linked: { label: 'Already yours — skip', tone: 'neutral' },
  duplicate_in_file: { label: 'Duplicate — skip', tone: 'warning' },
  error: { label: 'Error — skip', tone: 'danger' },
};

/**
 * Bulk import of the clinic's existing patient list. Upload → preview
 * (errors and duplicates, nothing saved yet) → import. No SMS is sent on
 * import; "Send invitations" is separate so the clinic controls SMS cost.
 */
export function ImportPatientsPage() {
  const { session } = useAuth();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmBasis, setConfirmBasis] = useState(false);
  const [imported, setImported] = useState<{ created: number; linked: number } | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [sending, setSending] = useState<{ sent: number; failed: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api
      .getPendingInvitations()
      .then((r) => setPending(r.pending))
      .catch(() => setPending(null));
  }, [imported]);

  if (session && session.role !== 'ADMIN') return <Navigate to="/patients" replace />;

  async function handleFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setImported(null);
    try {
      setPreview(await api.previewPatientImport(file));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setImported(await api.confirmPatientImport(preview.importId));
      setPreview(null);
      setConfirmBasis(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendInvitations(): Promise<void> {
    if (!pending || !window.confirm(`Send ${pending} registration SMS (one per patient)? Each SMS is charged.`)) return;
    setBusy(true);
    setError(null);
    const total = { sent: 0, failed: 0 };
    setSending(total);
    try {
      let cursor: string | undefined;
      for (;;) {
        const r = await api.sendInvitations(cursor);
        total.sent += r.sent;
        total.failed += r.failed;
        setSending({ ...total });
        setPending(r.remaining);
        if (r.done || !r.cursor) break;
        cursor = r.cursor;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sending stopped. Press the button again to continue.');
    } finally {
      setBusy(false);
    }
  }

  const importable = preview ? preview.counts.new + preview.counts.existing : 0;
  const rows = preview ? (showAll ? preview.rows : preview.rows.filter((r) => r.status !== 'new')) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Import patients</h1>
        <p className="mt-1 text-sm text-ink-500">
          Upload your existing patient list as a CSV or Excel (.xlsx) file with the columns <strong>Name, Phone, Date of birth, Sex</strong>. Dates
          are read day first (DD/MM/YYYY). You&apos;ll see a preview before anything is saved.
        </p>
      </div>

      <Card>
        <label className={`${btn.gold} cursor-pointer`}>
          <FileSpreadsheet size={17} aria-hidden /> {busy && !preview ? 'Reading…' : 'Choose file'}
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => void handleFile(e)} disabled={busy} />
        </label>
        <p className="mt-2 text-xs text-ink-500">Up to 5,000 patients and 5 MB per file. No SMS is sent when you import.</p>
      </Card>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {preview && (
        <Card>
          <h2 className="font-display text-lg font-semibold text-navy-900">Preview</h2>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {(Object.keys(STATUS) as ImportRowStatus[]).map((k) => (
              <li key={k}>
                <Badge tone={STATUS[k].tone}>
                  {STATUS[k].label}: {preview.counts[k]}
                </Badge>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-ink-500">{showAll ? 'All rows' : 'Rows that need a look (new patients hidden)'}</p>
            <button type="button" className={btn.ghost} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show only problems' : 'Show all rows'}
            </button>
          </div>
          <div className="mt-2 max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-cream-100 text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Date of birth</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-ink-500">
                      No problems found.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="px-3 py-2 text-ink-500">{r.rowNumber}</td>
                    <td className="px-3 py-2">{r.fullName || '—'}</td>
                    <td className="px-3 py-2">{r.phone || '—'}</td>
                    <td className="px-3 py-2">{r.dateOfBirth || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      {r.message && <p className="mt-1 text-xs text-ink-500">{r.message}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded-xl bg-cream-100 p-3.5 text-sm text-ink-700 ring-1 ring-slate-200">
            <input type="checkbox" checked={confirmBasis} onChange={(e) => setConfirmBasis(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900" />
            <span>These are our clinic&apos;s existing patients, and we may add their details to ACISI under our Privacy Notice.</span>
          </label>
          <button type="button" disabled={busy || !confirmBasis || importable === 0} onClick={() => void handleImport()} className={`${btn.gold} mt-4`}>
            {busy ? 'Importing…' : `Import ${importable} patient${importable === 1 ? '' : 's'}`}
          </button>
          <p className="mt-2 text-xs text-ink-500">Rows marked skip are not imported. Fix them in your file and upload it again if needed.</p>
        </Card>
      )}

      {imported && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
          <CircleCheckBig size={18} aria-hidden /> Imported: {imported.created} new patient{imported.created === 1 ? '' : 's'}, {imported.linked} linked from
          ACISI. No SMS was sent.
        </p>
      )}

      <Card>
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-navy-900">
          <MessageSquareText size={19} aria-hidden className="text-teal-700" /> Send invitations
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Sends each imported patient one SMS: &ldquo;You&apos;re registered with {session?.clinicName ?? 'your clinic'} on ACISI. Check in from home next
          time at acisi.co.ke.&rdquo; Patients who don&apos;t want SMS are left out.
        </p>
        <p className="mt-3 text-sm font-medium text-navy-900">
          {pending === null ? '…' : pending === 0 ? 'No imported patients are waiting for an invitation.' : `${pending} patient${pending === 1 ? '' : 's'} waiting — ${pending} SMS.`}
        </p>
        {sending && (
          <p role="status" className="mt-2 text-sm text-ink-700">
            Sent {sending.sent}
            {sending.failed > 0 && `, ${sending.failed} couldn't be sent (they stay on the list to try again later)`}.
          </p>
        )}
        <button type="button" disabled={busy || !pending} onClick={() => void handleSendInvitations()} className={`${btn.primary} mt-4`}>
          <Send size={16} aria-hidden /> {busy && sending ? 'Sending…' : 'Send invitations'}
        </button>
      </Card>
    </div>
  );
}
