import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Camera, FileImage, FileText, Lock, Upload, X } from 'lucide-react';
import { api, ApiError, FileCategory, PatientFileItem } from '../lib/api';
import { Badge, btn, Card, field } from './ui';

export const FILE_CATEGORIES: { value: FileCategory; label: string }[] = [
  { value: 'XRAY', label: 'X-ray' },
  { value: 'CT_SCAN', label: 'CT scan' },
  { value: 'MRI', label: 'MRI' },
  { value: 'ULTRASOUND', label: 'Ultrasound' },
  { value: 'LAB_REPORT', label: 'Lab report' },
  { value: 'PREVIOUS_RECORDS', label: 'Previous records' },
  { value: 'OTHER', label: 'Other' },
];

const MAX_MB = 20;
const today = () => new Date().toISOString().slice(0, 10);

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A patient's files: list, upload one JPG/PNG/PDF, or photograph a paper
 * file page by page and save it as one PDF under "Previous records". The
 * server decides what this clinic may see; hidden files are only counted.
 */
export function PatientFiles({ patientId }: { patientId: string }) {
  const [files, setFiles] = useState<PatientFileItem[] | null>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [mode, setMode] = useState<'none' | 'file' | 'photos'>('none');
  const [file, setFile] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [category, setCategory] = useState<FileCategory | ''>('');
  const [documentDate, setDocumentDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .listPatientFiles(patientId)
      .then((r) => {
        setFiles(r.files);
        setHiddenCount(r.hiddenCount);
      })
      .catch(() => setError('Could not load files.'));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function reset(): void {
    setMode('none');
    setFile(null);
    setPhotos([]);
    setCategory('');
    setDocumentDate(today());
    setNote('');
  }

  function pickFile(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_MB} MB.`);
      return;
    }
    setError(null);
    setFile(f);
  }

  function addPhotos(e: ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    const tooBig = picked.find((p) => p.size > MAX_MB * 1024 * 1024);
    if (tooBig) {
      setError(`A photo is over ${MAX_MB} MB.`);
      return;
    }
    setError(null);
    setPhotos((prev) => [...prev, ...picked].slice(0, 30));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'file' && file && category) await api.uploadPatientFile(patientId, file, { category, documentDate, note });
      if (mode === 'photos' && photos.length > 0) await api.uploadPatientPhotos(patientId, photos, { documentDate, note });
      reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Files" icon={FileImage} className="mb-6">
      {files === null && !error && <p className="text-sm text-ink-500">Loading…</p>}
      {files && files.length === 0 && <p className="text-sm text-ink-500">No files yet.</p>}
      {files && files.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
              {f.mimeType === 'application/pdf' ? (
                <FileText size={18} aria-hidden className="text-gold-700" />
              ) : (
                <FileImage size={18} aria-hidden className="text-gold-700" />
              )}
              <a href={api.patientFileUrl(f.id)} target="_blank" rel="noopener noreferrer" className="font-medium text-navy-900 underline-offset-4 hover:underline">
                {f.categoryLabel}
              </a>
              <span className="text-sm text-ink-500">
                {new Date(`${f.documentDate}T00:00:00Z`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                {f.pageCount ? ` · ${f.pageCount} page${f.pageCount === 1 ? '' : 's'}` : ''} · {formatSize(f.sizeBytes)}
              </span>
              {f.patientUploaded && <Badge tone="info">Patient-uploaded</Badge>}
              {!f.patientUploaded && !f.fromThisClinic && <Badge tone="neutral">Other clinic</Badge>}
              {f.note && <p className="basis-full pl-7 text-sm text-ink-700">{f.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-cream-100 px-3.5 py-3 text-sm text-ink-500">
          <Lock size={15} aria-hidden className="mt-0.5 flex-none" />
          {hiddenCount} more file{hiddenCount === 1 ? '' : 's'} from other clinics or uploaded by the patient. They stay hidden until the patient agrees to share
          their records with your clinic.
        </p>
      )}

      {mode === 'none' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btn.secondary} onClick={() => setMode('file')}>
            <Upload size={16} aria-hidden /> Upload a file
          </button>
          <button type="button" className={btn.secondary} onClick={() => setMode('photos')}>
            <Camera size={16} aria-hidden /> Photograph paper file
          </button>
        </div>
      )}

      {mode !== 'none' && (
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3 rounded-2xl bg-cream-50 p-4 ring-1 ring-slate-200">
          {mode === 'file' ? (
            <>
              <label className="block">
                <span className={field.label}>File (JPG, PNG or PDF, up to {MAX_MB} MB)</span>
                <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={pickFile} className="block w-full text-sm" />
              </label>
              {file && <p className="text-sm text-ink-700">{file.name}</p>}
              <label className="block">
                <span className={field.label}>Category</span>
                <select required value={category} onChange={(e) => setCategory(e.target.value as FileCategory)} className={field.input}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {FILE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-700">
                Take a photo of each page of the paper file. They&apos;re saved together as one PDF under <strong>Previous records</strong>.
              </p>
              <label className={`${btn.gold} cursor-pointer`}>
                <Camera size={16} aria-hidden /> {photos.length === 0 ? 'Take first photo' : 'Take another photo'}
                <input type="file" accept="image/jpeg,image/png" capture="environment" multiple onChange={addPhotos} className="sr-only" />
              </label>
              {photos.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {photos.map((p, i) => (
                    <li key={`${p.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                      Page {i + 1}
                      <button type="button" aria-label={`Remove page ${i + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
                        <X size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <label className="block">
            <span className={field.label}>Date of the document</span>
            <input type="date" required max={today()} value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} className={field.input} />
          </label>
          <label className="block">
            <span className={field.label}>Note (optional)</span>
            <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={field.input} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={btn.gold}
              disabled={busy || (mode === 'file' ? !file || !category : photos.length === 0)}
            >
              {busy ? 'Uploading…' : mode === 'photos' ? `Save ${photos.length} page${photos.length === 1 ? '' : 's'} as one PDF` : 'Upload'}
            </button>
            <button type="button" className={btn.secondary} disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </Card>
  );
}
