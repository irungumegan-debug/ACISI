import { useState } from 'react';
import { api, ApiError, CLINIC_PLANS, ClinicDetail, ClinicPlan, SmsUsage } from '../lib/api';
import { formatKes } from '../lib/format';
import { Button, Card, ErrorText } from './ui';

function monthName(month: string): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-KE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function UsageRow({ label, usage }: { label: string; usage: SmsUsage }) {
  return (
    <tr>
      <td className="py-2 pr-3 text-stone-900">
        {label}
        <div className="text-xs text-stone-500">{monthName(usage.month)}</div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{usage.messages.toLocaleString()}</td>
      <td className="py-2 pr-3 text-right font-medium tabular-nums text-stone-900">
        {usage.sms.toLocaleString()}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{usage.allowance.toLocaleString()}</td>
      <td className={`py-2 pr-3 text-right tabular-nums ${usage.over ? 'font-medium text-red-700' : ''}`}>
        {usage.over.toLocaleString()}
      </td>
      <td
        className={`py-2 text-right tabular-nums ${usage.extraChargeKes ? 'font-medium text-red-700' : ''}`}
      >
        {formatKes(usage.extraChargeKes)}
      </td>
    </tr>
  );
}

/**
 * C24: SMS sent to patients on this clinic's behalf (receipts, appointment
 * reminders, walk-in invitations) against its plan. Security codes are not
 * counted. Owner site only.
 */
export function SmsUsageCard({ clinic, onChanged }: { clinic: ClinicDetail; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<ClinicPlan>(clinic.plan);
  const [allowance, setAllowance] = useState(String(clinic.smsMonthlyAllowance));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing(): void {
    setPlan(clinic.plan);
    setAllowance(String(clinic.smsMonthlyAllowance));
    setError(null);
    setEditing(true);
  }

  function choosePlan(next: ClinicPlan): void {
    setPlan(next);
    setAllowance(String(CLINIC_PLANS.find((p) => p.value === next)?.smsAllowance ?? ''));
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.setClinicPlan(clinic.id, plan, allowance.trim() === '' ? undefined : Number(allowance));
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="SMS to patients">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-stone-600">
          Plan: <span className="font-medium text-stone-900">{clinic.planLabel}</span> ·{' '}
          {clinic.smsMonthlyAllowance.toLocaleString()} SMS a month. Extra SMS are KES 2 each.
        </p>
        {!editing && <Button onClick={startEditing}>Change plan</Button>}
      </div>

      {editing && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
          <label className="flex flex-col gap-1">
            Plan
            <select
              value={plan}
              onChange={(e) => choosePlan(e.target.value as ClinicPlan)}
              className="rounded-md border border-stone-300 bg-white px-2 py-1.5"
            >
              {CLINIC_PLANS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} ({p.smsAllowance.toLocaleString()} SMS)
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            SMS allowance a month
            <input
              type="number"
              min={0}
              step={1}
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
              className="w-32 rounded-md border border-stone-300 bg-white px-2 py-1.5 tabular-nums"
            />
          </label>
          <Button tone="primary" onClick={() => void save()} disabled={busy}>
            Save
          </Button>
          <Button onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
          {error && (
            <div className="w-full">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="pb-1 pr-3 font-medium">Month</th>
              <th className="pb-1 pr-3 text-right font-medium">Messages</th>
              <th className="pb-1 pr-3 text-right font-medium">SMS used</th>
              <th className="pb-1 pr-3 text-right font-medium">Allowance</th>
              <th className="pb-1 pr-3 text-right font-medium">Over</th>
              <th className="pb-1 text-right font-medium">Extra charge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            <UsageRow label="This month" usage={clinic.smsUsage.thisMonth} />
            <UsageRow label="Last month" usage={clinic.smsUsage.lastMonth} />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-stone-500">
        Counts receipts, appointment reminders and walk-in invitations. Long messages count as more than one
        SMS. Security codes (PIN reset, phone verification) are not counted. Last month is shown against
        today's allowance.
      </p>
    </Card>
  );
}
