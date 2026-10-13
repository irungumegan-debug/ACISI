import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { FileImage, Upload } from 'lucide-react';
import { api, ApiError, PatientFileItem } from '../lib/api';

const CATEGORIES = [
  ['XRAY', 'X-ray'],
  ['CT_SCAN', 'CT scan'],
  ['MRI', 'MRI'],
  ['ULTRASOUND', 'Ultrasound'],
  ['LAB_REPORT', 'Lab report'],
  ['PREVIOUS_RECORDS', 'Previous records'],
  ['OTHER', 'Other'],
] as const;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The patient's files — from their clinics and their own uploads — and a
 * form to add one (JPG, PNG or PDF, up to 20 MB). Files they upload show
 * as "Patient-uploaded" to clinics, and clinics only see them once the
 * patient has agreed to share their records with that clinic.
 */
export function MyFiles() {
  const [files, setFiles] = useState<PatientFileItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('');
  const [documentDate, setDocumentDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .getMyFiles()
      .then((r) => setFiles(r.files))
      .catch(() => setError('Could not load your files.'));
  useEffect(() => {
    void load();
  }, []);

  function pick(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 20 * 1024 * 1024) {
      setError('That file is over 20 MB.');
      e.target.value = '';
      return;
    }
    setError(null);
    setFile(f);
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!file || !category) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadMyFile(file, { category, documentDate, note });
      setOpen(false);
      setFile(null);
      setCategory('');
      setNote('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>
        <FileImage size={20} aria-hidden /> My files
      </h2>
      {files && files.length === 0 && <p>No files yet. X-rays, scans, lab reports and old records you upload appear here.</p>}
      {files && files.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {files.map((f) => (
            <li key={f.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
              <a href={api.myFileUrl(f.id)} target="_blank" rel="noopener noreferrer">
                <strong>{f.categoryLabel}</strong>
              </a>{' '}
              — {new Date(`${f.documentDate}T00:00:00Z`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
              {f.patientUploaded && <span className="pill"> · Uploaded by you</span>}
              {f.note && <div style={{ fontSize: 14, opacity: 0.8 }}>{f.note}</div>}
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          <Upload size={16} aria-hidden /> Upload a file
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="mf-file">File (JPG, PNG or PDF, up to 20 MB)</label>
            <input id="mf-file" type="file" accept="image/jpeg,image/png,application/pdf" required onChange={pick} />
          </div>
          <div className="field">
            <label htmlFor="mf-cat">What is it?</label>
            <select id="mf-cat" required value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mf-date">Date of the document</label>
            <input id="mf-date" type="date" required max={today()} value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mf-note">Note (optional)</label>
            <input id="mf-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p style={{ fontSize: 14, opacity: 0.8 }}>
            Clinics see files you upload only after you agree to share your records with them.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={busy || !file || !category}>
              {busy ? 'Uploading…' : 'Upload'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
