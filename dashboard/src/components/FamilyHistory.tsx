import { useState } from 'react';
import { Users } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { btn, Card, field } from './ui';

/** Family history note on the consultation page (doctors). */
export function FamilyHistory({ encounterId, initial }: { encounterId: string; initial: string | null }) {
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setFamilyHistory(encounterId, text.trim() || null);
      setSaved(res.familyHistory);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Family history"
      icon={Users}
      className="mb-6"
      actions={
        !editing ? (
          <button type="button" className={btn.ghost} onClick={() => setEditing(true)}>
            {saved ? 'Edit' : '+ Add'}
          </button>
        ) : undefined
      }
    >
      {!editing ? (
        <p className="whitespace-pre-wrap text-sm text-ink-700">{saved || <span className="text-ink-500">None recorded.</span>}</p>
      ) : (
        <div>
          <label htmlFor="familyHistory" className={field.label}>
            Conditions in close family (who, what)
          </label>
          <textarea
            id="familyHistory"
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Mother: type 2 diabetes. Father: hypertension, stroke at 60. Sister: asthma."
            className={`${field.input} min-h-20 resize-y py-3`}
          />
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
              onClick={() => {
                setText(saved ?? '');
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
