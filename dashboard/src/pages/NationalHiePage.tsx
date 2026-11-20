import { FormEvent, useEffect, useState } from 'react';
import { BadgeCheck, Building2, Search, Stethoscope } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError, HieFacility, HieStatus } from '../lib/api';
import { Badge, btn, Card, field, PageHeader, SkeletonList } from '../components/ui';

const REGULATORS: { value: string; label: string }[] = [
  { value: 'KMPDC', label: 'KMPDC (doctors and dentists)' },
  { value: 'COC', label: 'Clinical Officers Council' },
  { value: 'NCK', label: 'Nursing Council of Kenya' },
  { value: 'PPB', label: 'Pharmacy and Poisons Board' },
];

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * The clinic's link to DHA's national Health Information Exchange: the
 * clinic's facility code (admin) and each clinician's own registration.
 */
export function NationalHiePage() {
  const { session } = useAuth();
  const [status, setStatus] = useState<HieStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHieStatus()
      .then(setStatus)
      .catch((err: unknown) => setError(errorText(err, 'Could not load the HIE status')));
  }, []);

  if (error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!status) return <SkeletonList rows={2} label="Loading" />;

  const isAdmin = session?.role === 'ADMIN';

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="National HIE"
        subtitle="Kenya's Health Information Exchange, run by the Digital Health Agency (DHA): national registries of facilities, health workers and patients."
      />
      {!status.connected && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          ACISI isn&apos;t connected to the national HIE yet: we&apos;re waiting for DHA to issue our access. You can see what will be needed below;
          lookups start working once the connection is switched on.
        </p>
      )}
      <FacilityCard status={status} canEdit={isAdmin} onSaved={(facility) => setStatus({ ...status, facility })} />
      {status.practitioner && (
        <PractitionerCard
          status={status}
          onSaved={(practitioner) => setStatus({ ...status, practitioner })}
        />
      )}
    </div>
  );
}

function FacilityCard({ status, canEdit, onSaved }: { status: HieStatus; canEdit: boolean; onSaved: (f: HieStatus['facility']) => void }) {
  const [mode, setMode] = useState<'name' | 'mfl' | 'fr-code'>('name');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HieFacility[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const q = mode === 'name' ? { name: query } : { identifier: query, identifierType: mode };
      setResults((await api.searchHieFacilities(q)).facilities);
    } catch (err) {
      setError(errorText(err, 'Search failed'));
    } finally {
      setBusy(false);
    }
  }

  async function choose(f: HieFacility): Promise<void> {
    if (!confirm(`Set this clinic's facility to ${f.officialName} (${f.frCode})?`)) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.setHieFacility(f.frCode);
      onSaved({ frCode: saved.frCode, name: saved.name, verifiedAt: new Date().toISOString() });
      setResults(null);
      setQuery('');
    } catch (err) {
      setError(errorText(err, 'Could not save the facility'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="This clinic in the Facility Registry" icon={Building2} className="mb-6">
      {status.facility ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-navy-900">
          <Badge tone="success" icon={BadgeCheck}>Verified</Badge>
          <span className="font-semibold">{status.facility.name}</span>
          <span className="font-mono text-ink-500">{status.facility.frCode}</span>
        </p>
      ) : (
        <p className="text-sm text-ink-700">
          Not set. Every HIE request says which facility it comes from, so this is needed before patients can be looked up.
          {!canEdit && ' Your clinic admin sets it.'}
        </p>
      )}
      {canEdit && (
        <>
          <p className="mt-4 text-sm text-ink-500">
            Find your clinic by name, or by its Kenya Master Health Facility List (MFL) code if you have it (shown on your facility licence and on
            kmhfr.health.go.ke).
          </p>
          <form onSubmit={(e) => void search(e)} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="facilitySearchMode">Search by</label>
            <select id="facilitySearchMode" className={`${field.input} sm:w-44`} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="name">Name</option>
              <option value="mfl">MFL code</option>
              <option value="fr-code">FR code</option>
            </select>
            <label className="sr-only" htmlFor="facilitySearch">Facility</label>
            <input
              id="facilitySearch"
              className={field.input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'name' ? 'e.g. Sunrise Medical Clinic' : 'Code'}
              minLength={mode === 'name' ? 3 : 2}
              required
            />
            <button type="submit" className={btn.primary} disabled={busy || !status.connected}>
              <Search size={16} aria-hidden /> {busy ? 'Searching…' : 'Search'}
            </button>
          </form>
          {results && results.length === 0 && <p className="mt-3 text-sm text-ink-500">No facility found. Try fewer words or the MFL code.</p>}
          {results && results.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {results.map((f) => (
                <li key={f.frCode} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-navy-900">{f.officialName}</p>
                    <p className="text-ink-500">
                      {[f.facilityType, f.kephLevel, f.subCounty, f.county].filter(Boolean).join(' · ')}
                      {f.licenceStatus ? ` · Licence: ${f.licenceStatus}` : ''}
                    </p>
                    <p className="font-mono text-xs text-ink-500">{f.frCode}</p>
                  </div>
                  <button type="button" className={btn.secondary} disabled={busy} onClick={() => void choose(f)}>
                    This is our clinic
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
    </Card>
  );
}

function PractitionerCard({ status, onSaved }: { status: HieStatus; onSaved: (p: NonNullable<HieStatus['practitioner']>) => void }) {
  const current = status.practitioner!;
  const [regulator, setRegulator] = useState(current.regulator ?? 'KMPDC');
  const [number, setNumber] = useState(current.registrationNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.verifyMyPractitionerRecord(regulator, number));
    } catch (err) {
      setError(errorText(err, 'Could not check your registration'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Your registration (Health Worker Registry)" icon={Stethoscope} className="mb-6">
      {current.practitionerId ? (
        <div className="mb-4 space-y-1 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="success" icon={BadgeCheck}>Verified</Badge>
            <span className="font-semibold text-navy-900">{current.registeredName ?? 'Registered'}</span>
            <span className="font-mono text-ink-500">{current.practitionerId}</span>
          </p>
          {current.licenceEnd && (
            <p className={current.licenceCurrent ? 'text-ink-700' : 'font-semibold text-red-700'}>
              Licence {current.licenceCurrent ? 'valid until' : 'expired on'} {new Date(current.licenceEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          )}
        </div>
      ) : (
        <p className="mb-4 text-sm text-ink-700">
          Records you send to the national Shared Health Record carry your practitioner ID. Enter your registration number once to find it.
        </p>
      )}
      <form onSubmit={(e) => void verify(e)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className={field.label} htmlFor="regulator">Regulator</label>
          <select id="regulator" className={field.input} value={regulator} onChange={(e) => setRegulator(e.target.value)}>
            {REGULATORS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={field.label} htmlFor="regNumber">Registration number</label>
          <input id="regNumber" className={field.input} value={number} onChange={(e) => setNumber(e.target.value)} required minLength={2} maxLength={30} />
        </div>
        <button type="submit" className={btn.gold} disabled={busy || !status.connected}>
          {busy ? 'Checking…' : current.practitionerId ? 'Check again' : 'Verify'}
        </button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
    </Card>
  );
}

