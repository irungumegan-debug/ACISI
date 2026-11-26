import { useState } from 'react';
import { api, ApiError, ClinicDetail } from '../lib/api';
import { Button, Card, ErrorText } from './ui';

/**
 * SHA claims add-on for one clinic. Optional, off by default, and only the
 * ACISI owner can switch it on. While off, nothing about this clinic's
 * patients is sent to SHA. Also needs SHA_ENABLED=true on the server.
 */
export function ShaAddonCard({ clinic, onChanged }: { clinic: ClinicDetail; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { enabled, serverEnabled, changedAt } = clinic.shaAddon;

  async function toggle(): Promise<void> {
    const next = !enabled;
    if (next && !window.confirm(`Switch the SHA add-on on for ${clinic.name}? Front desk will be able to check patients' SHA cover and start SHA visits, which sends patient identifiers to SHA through DHA.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.setClinicShaAddon(clinic.id, next);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="SHA claims add-on">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-stone-700">
            {enabled ? 'On for this clinic.' : 'Off for this clinic.'}
            {changedAt && <span className="text-stone-500"> Changed {new Date(changedAt).toLocaleDateString('en-KE')}.</span>}
          </p>
          <Button tone={enabled ? 'danger' : 'default'} disabled={busy} onClick={() => void toggle()}>
            {busy ? 'Saving…' : enabled ? 'Switch off' : 'Switch on'}
          </Button>
        </div>
        <p className="text-xs text-stone-500">
          Optional add-on, not part of ACISI&apos;s core. While it is off, no patient data from this clinic is sent to SHA.
          {!serverEnabled && ' It is also switched off on the server (SHA_ENABLED), so nothing runs even if this clinic is switched on.'}
        </p>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Card>
  );
}
