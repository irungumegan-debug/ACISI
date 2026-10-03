import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Stethoscope, UserRoundX, X } from 'lucide-react';
import { api, ApiError, DoctorOption } from '../lib/api';
import { Avatar, btn, EmptyState, Skeleton } from './ui';

/**
 * Front desk's "Change doctor" for a waiting patient: lists the doctors in
 * the patient's department who are in today, with how busy each one is.
 */
export function ChangeDoctorDialog({
  checkInId,
  patientName,
  onClose,
  onChanged,
}: {
  checkInId: string;
  patientName: string;
  onClose: () => void;
  onChanged: (doctorName: string) => void;
}) {
  const [doctors, setDoctors] = useState<DoctorOption[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getDoctorOptions(checkInId)
      .then((res) => {
        if (cancelled) return;
        setDoctors(res.doctors);
        setCurrentId(res.currentDoctorId);
        setSelected(res.currentDoctorId);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load the doctors. Try again.'));
    return () => {
      cancelled = true;
    };
  }, [checkInId]);

  // Escape closes; focus moves into the dialog and returns to the page on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!selected || selected === currentId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.changeDoctor(checkInId, selected);
      onChanged(res.doctorName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the doctor. Try again.');
      setSaving(false);
    }
  }

  const others = doctors?.filter((d) => d.id !== currentId) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className="absolute inset-0 bg-navy-950/60" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-doctor-title"
        className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-raised outline-none sm:max-w-md sm:rounded-3xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="change-doctor-title" className="flex items-center gap-2 font-display text-xl font-semibold text-navy-900">
              <Stethoscope size={20} aria-hidden className="text-gold-700" /> Change doctor
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">For {patientName}. Only doctors in this department who are in today are shown.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 flex-none items-center justify-center rounded-xl text-ink-500 hover:bg-slate-100">
            <X size={20} aria-hidden />
          </button>
        </div>

        {doctors === null && !error ? (
          <div role="status" aria-label="Loading doctors" className="space-y-2">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        ) : doctors && others.length === 0 ? (
          <EmptyState icon={UserRoundX} title="No other doctor is in today">
            Only {doctors.length === 1 ? 'one doctor is' : 'these doctors are'} available in this department right now. A doctor can mark themselves in on their queue, or an admin can under Settings.
          </EmptyState>
        ) : (
          <form onSubmit={(e) => void save(e)}>
            <fieldset className="space-y-2">
              <legend className="sr-only">Doctor</legend>
              {doctors?.map((d) => {
                const isCurrent = d.id === currentId;
                const isSelected = d.id === selected;
                return (
                  <label
                    key={d.id}
                    className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-500 ${
                      isSelected ? 'border-gold-500 bg-gold-tint' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input type="radio" name="doctor" value={d.id} checked={isSelected} onChange={() => setSelected(d.id)} className="sr-only" />
                    <Avatar name={d.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">
                        {d.name}
                        {isCurrent && <span className="rounded-full bg-navy-900 px-2 py-0.5 text-[11px] font-semibold text-gold-300">Current</span>}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {d.waitingCount} waiting · {d.inConsultation ? 'with a patient now' : 'free now'}
                      </span>
                    </span>
                    {isSelected && (
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-foil text-navy-900">
                        <Check size={15} aria-hidden strokeWidth={3} />
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className={btn.secondary}>
                Cancel
              </button>
              <button type="submit" disabled={!selected || selected === currentId || saving} className={btn.gold}>
                {saving ? 'Moving…' : 'Move patient'}
              </button>
            </div>
          </form>
        )}
        {error && doctors === null && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
