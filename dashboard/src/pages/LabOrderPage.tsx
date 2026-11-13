import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FlaskConical, Paperclip, Save, ShieldCheck, Upload } from 'lucide-react';
import { api, ApiError, LabOrderDetailForLab, LabResultFlag, LabResultInput } from '../lib/api';
import { Avatar, btn, field, SkeletonList, StatusBadge } from '../components/ui';

const SEX_LABEL: Record<string, string> = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other' };
const FLAGS: { value: LabResultFlag; label: string }[] = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'ABNORMAL', label: 'Abnormal' },
  { value: 'CRITICAL', label: 'Critical' },
];
const MAX_MB = 20;

type Draft = Record<string, { value: string; unit: string; flag: LabResultFlag | ''; comment: string }>;

function toInputs(draft: Draft): LabResultInput[] {
  return Object.entries(draft).map(([itemId, d]) => ({
    itemId,
    value: d.value.trim() || null,
    unit: d.unit.trim() || null,
    flag: d.flag || null,
    comment: d.comment.trim() || null,
  }));
}

/**
 * One lab request: the tests the doctor asked for, a result for each,
 * optional printouts, then "Results ready" signed with the lab
 * technician's PIN. That sends the results to the doctor and texts the
 * patient to go back to the doctor.
 */
export function LabOrderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<LabOrderDetailForLab | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [step, setStep] = useState<'enter' | 'sign' | 'done'>('enter');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [smsOutcome, setSmsOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .openLabOrder(id)
      .then((o) => {
        setOrder(o);
        setDraft(
          Object.fromEntries(
            o.items.map((i) => [i.id, { value: i.resultValue ?? '', unit: i.resultUnit ?? '', flag: i.resultFlag ?? '', comment: i.resultComment ?? '' }]),
          ),
        );
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not open this lab request.'));
  }, [id]);

  function set(itemId: string, patch: Partial<Draft[string]>): void {
    setSaved(false);
    setDraft((prev) => ({ ...prev, [itemId]: { ...prev[itemId]!, ...patch } }));
  }

  const missing = order ? order.items.filter((i) => !draft[i.id]?.value.trim() && !draft[i.id]?.flag) : [];

  async function save(): Promise<boolean> {
    if (!id) return false;
    setBusy(true);
    setError(null);
    try {
      await api.saveLabResults(id, toInputs(draft));
      setSaved(true);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function continueToSign(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (missing.length > 0) return;
    if (await save()) setStep('sign');
  }

  async function sign(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.completeLabOrder(id, pin);
      setSmsOutcome(r.sms);
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign the results. Try again.');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  async function attach(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !id || !order) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_MB} MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const f = await api.uploadLabFile(id, file);
      setOrder({ ...order, files: [...order.files, { id: f.id, categoryLabel: f.categoryLabel, mimeType: f.mimeType, uploadedAt: f.uploadedAt }] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!order && !error) return <SkeletonList rows={3} label="Opening the lab request" />;

  const back = (
    <p className="mb-3 text-sm">
      <Link to="/lab/queue" className="inline-flex items-center gap-1.5 font-medium text-ink-500 hover:text-navy-900">
        <ArrowLeft size={16} aria-hidden /> Back to the lab queue
      </Link>
    </p>
  );

  if (!order) {
    return (
      <div>
        {back}
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-card">
        <CheckCircle2 size={40} aria-hidden className="mx-auto text-emerald-600" />
        <h1 className="mt-3 font-display text-2xl font-semibold text-navy-900">Results sent to the doctor</h1>
        <p className="mt-2 text-ink-700">
          {smsOutcome === 'sent' && `${order.patientName} has been sent an SMS to go back to the doctor.`}
          {smsOutcome === 'opted_out' && `${order.patientName} doesn't want SMS. Please tell them to go back to the doctor.`}
          {smsOutcome === 'failed' && `The SMS to ${order.patientName} didn't go through. Please tell them to go back to the doctor.`}
          {smsOutcome === 'not_sent_yet' && 'This patient has another lab request still open. They will be sent back when all the results are signed.'}
        </p>
        <button type="button" className={`${btn.gold} mt-5`} onClick={() => navigate('/lab/queue', { replace: true })}>
          Back to the lab queue
        </button>
      </div>
    );
  }

  const describe = [order.age !== null ? `${order.age} yrs` : null, SEX_LABEL[order.sex] ?? null].filter(Boolean).join(' · ');

  return (
    <div>
      {back}
      <div className="relative mb-6 flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-navy-700 via-navy-900 to-navy-950 p-5 text-white shadow-raised sm:p-6">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-foil" />
        <Avatar name={order.patientName} size="lg" className="ring-2 ring-gold-400/60" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-300">Lab request</p>
          <h1 className="truncate font-display text-2xl font-bold tracking-tight">{order.patientName}</h1>
          <p className="mt-0.5 text-sm text-slate-300">
            {order.patientCode}
            {describe && ` · ${describe}`} · requested by {order.requestedByName}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {order.noteForLab && (
        <p className="mb-6 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 ring-1 ring-blue-200">
          <span className="font-semibold">Note from the doctor:</span> {order.noteForLab}
        </p>
      )}

      {step === 'enter' ? (
        <form onSubmit={(e) => void continueToSign(e)} className="space-y-4">
          {order.items.map((item) => {
            const d = draft[item.id]!;
            return (
              <fieldset key={item.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5">
                <legend className="sr-only">{item.testName}</legend>
                <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-navy-900">
                  <FlaskConical size={17} aria-hidden className="text-blue-700" /> {item.testName}
                </h2>
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1.2fr]">
                  <label className="block">
                    <span className={field.label}>Result</span>
                    <input className={field.input} maxLength={200} value={d.value} onChange={(e) => set(item.id, { value: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className={field.label}>Unit</span>
                    <input className={field.input} maxLength={30} placeholder="e.g. g/dL" value={d.unit} onChange={(e) => set(item.id, { unit: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className={field.label}>Flag</span>
                    <select className={field.input} value={d.flag} onChange={(e) => set(item.id, { flag: e.target.value as LabResultFlag | '' })}>
                      <option value="">Not set</option>
                      {FLAGS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="mt-3 block">
                  <span className={field.label}>Comment (optional)</span>
                  <input className={field.input} maxLength={500} value={d.comment} onChange={(e) => set(item.id, { comment: e.target.value })} />
                </label>
              </fieldset>
            );
          })}

          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5">
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-navy-900">
              <Paperclip size={17} aria-hidden className="text-gold-700" /> Printouts (optional)
            </h2>
            {order.files.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-2">
                {order.files.map((f, i) => (
                  <li key={f.id}>
                    <a
                      href={api.labFileUrl(order.id, f.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-cream-50 px-3 py-1 text-sm font-medium text-navy-900 ring-1 ring-slate-200 hover:ring-gold-500"
                    >
                      <Paperclip size={14} aria-hidden /> Printout {i + 1}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <label className={`${btn.secondary} cursor-pointer`}>
              <Upload size={16} aria-hidden /> Attach a PDF or photo
              <input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={(e) => void attach(e)} disabled={busy} />
            </label>
            <p className="mt-2 text-xs text-ink-500">JPG, PNG or PDF, up to {MAX_MB} MB. Saved on the patient&apos;s record as a lab report.</p>
          </section>

          {missing.length > 0 && <p className="text-sm text-ink-500">Enter a result or a flag for every test to finish ({missing.map((i) => i.testName).join(', ')}).</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => void save()}>
              <Save size={16} aria-hidden /> {saved ? 'Saved' : 'Save for later'}
            </button>
            <button type="submit" className={btn.gold} disabled={busy || missing.length > 0}>
              <CheckCircle2 size={16} aria-hidden /> Results ready
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={(e) => void sign(e)} className="mx-auto max-w-lg rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-7">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold text-navy-900">
            <ShieldCheck size={20} aria-hidden className="text-gold-700" /> Sign the results
          </h2>
          <ul className="mb-4 divide-y divide-slate-100 rounded-xl bg-cream-50 px-4 text-sm ring-1 ring-slate-200">
            {order.items.map((item) => {
              const d = draft[item.id]!;
              return (
                <li key={item.id} className="flex flex-wrap gap-x-3 py-2">
                  <span className="font-medium text-navy-900">{item.testName}</span>
                  <span className="text-ink-700">{[d.value, d.unit].filter((x) => x.trim()).join(' ')}</span>
                  {d.flag && <span className="ml-auto text-ink-500">{FLAGS.find((f) => f.value === d.flag)?.label}</span>}
                </li>
              );
            })}
          </ul>
          <p className="mb-3 text-sm text-ink-700">I confirm these results are accurate. They go to the doctor, and the patient gets an SMS to go back to the doctor.</p>
          <label className="block">
            <span className={field.label}>Your PIN</span>
            <input className={field.input} type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
          <div className="mt-4 flex gap-2">
            <button type="button" className={`${btn.secondary} flex-1`} disabled={busy} onClick={() => setStep('enter')}>
              Back
            </button>
            <button type="submit" className={`${btn.gold} flex-1`} disabled={busy || !pin}>
              {busy ? 'Signing…' : 'Confirm & sign'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
