'use client';

import { useActionState, useState } from 'react';
import { Loader2, Save, ReceiptText, BellRing, RefreshCw, CalendarRange, ShieldOff, ShieldCheck, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, Checkbox, ResultAlert } from './fields';
import {
  saveContributionSettingsAction,
  billPeriodAction,
  billYearAction,
  setExemptionAction,
  updateContributionAction,
  refreshContributionStatusesAction,
  remindUnpaidMembersAction,
} from '@/server/actions/contributions';
import { isoDate, nextPeriod, periodLabel, prevPeriod } from '@/lib/dates';
import type { ActionResult } from '@/server/actions/auth';

const MONTHS = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
  { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
  { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' },
];

/* ------------------------------------------------------------------ *
 * Period switcher (month picker that drives the URL)
 * ------------------------------------------------------------------ */
export function PeriodSwitcher({ period, basePath = '/contributions' }: { period: string; basePath?: string }) {
  const go = (p: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('period', p);
    url.searchParams.delete('page');
    window.location.href = `${basePath}?${url.searchParams.toString()}`;
  };
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="btn btn-outline btn-sm" onClick={() => go(prevPeriod(period))} title={periodLabel(prevPeriod(period))}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <input type="month" value={period} onChange={(e) => e.target.value && go(e.target.value)} className="input !w-40" aria-label="Contribution period" />
      <button type="button" className="btn btn-outline btn-sm" onClick={() => go(nextPeriod(period))} title={periodLabel(nextPeriod(period))}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Billing controls — generate the month (or whole year) bills, remind
 * ------------------------------------------------------------------ */
export function BillingControls({
  period,
  unpaidCount,
  canBill,
  canManage,
  canRemind,
  parishes,
}: {
  period: string;
  unpaidCount: number;
  canBill: boolean;
  canManage: boolean;
  canRemind: boolean;
  parishes: { value: number; label: string }[];
}) {
  const [billState, billAction, billPending] = useActionState(billPeriodAction as any, undefined as ActionResult | undefined);
  const [busy, setBusy] = useState<'' | 'year' | 'refresh' | 'remind'>('');
  const [modal, setModal] = useState<'' | 'bill' | 'year'>('');
  const year = Number(period.slice(0, 4));

  async function run(key: typeof busy, fn: () => Promise<ActionResult>) {
    setBusy(key);
    try {
      const res = await fn();
      if (res.ok) toastSuccess(res.message || 'Done');
      else toastError(res.error || 'Action failed');
    } catch (e: any) {
      toastError(e?.message || 'Something went wrong');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canBill ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal('bill')}>
            <ReceiptText className="h-4 w-4" /> Bill this month
          </button>
        ) : null}
        {canManage ? (
          <button type="button" className="btn btn-outline btn-sm" disabled={busy === 'year'} onClick={() => setModal('year')}>
            {busy === 'year' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />} Bill whole {year}
          </button>
        ) : null}
        {canRemind && unpaidCount > 0 ? (
          <button type="button" className="btn btn-outline btn-sm" disabled={busy === 'remind'} onClick={() => run('remind', () => remindUnpaidMembersAction(period))}>
            {busy === 'remind' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Remind {unpaidCount} unpaid
          </button>
        ) : null}
        {canBill || canManage ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy === 'refresh'} onClick={() => run('refresh', () => refreshContributionStatusesAction())}>
            {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recalculate statuses
          </button>
        ) : null}
      </div>

      {billState && !billPending ? <div className="mt-3"><ResultAlert result={billState} /></div> : null}

      <Modal
        open={modal === 'bill'}
        onClose={() => setModal('')}
        title={`Generate contribution bills`}
        description="Every active, non-exempt member in scope receives a bill for the selected month."
      >
        <form action={billAction} className="space-y-4">
          <FormGrid cols={2}>
            <Field label="Period" required>
              <TextInput name="period" type="month" required defaultValue={period} />
            </Field>
            <Field label="Parish" hint="Leave blank for all parishes in your scope">
              <Select name="parish_id" options={parishes} placeholder="All parishes" />
            </Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Amount override (KSh)" hint="Blank uses the configured monthly amount">
              <TextInput name="amount" type="number" min="0" step="0.01" />
            </Field>
            <Field label="Due day override" hint="Blank uses the configured due day">
              <TextInput name="due_day" type="number" min="1" max="28" step="1" />
            </Field>
          </FormGrid>
          <Checkbox name="notify" label="Notify members" hint="Send an in-system notification (plus SMS / email where configured)" defaultChecked />
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn btn-primary flex-1" disabled={billPending}>
              {billPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />} Generate bills
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setModal('')}>Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={modal === 'year'}
        onClose={() => setModal('')}
        title={`Bill the whole of ${year}`}
        description="Creates twelve monthly bills per member. Existing bills are skipped, so this is safe to re-run."
      >
        <div className="space-y-4">
          <p className="rounded-lg bg-navy-50 p-3 text-sm text-navy-800">
            This can take a few seconds on large parishes. Members are notified only if you enable it below.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={busy === 'year'}
              onClick={() => {
                setModal('');
                run('year', () => billYearAction(year, false));
              }}
            >
              {busy === 'year' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />} Bill {year}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setModal('')}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Settings form
 * ------------------------------------------------------------------ */
export function ContributionSettingsForm({ settings }: { settings: any }) {
  const [state, action, pending] = useActionState(saveContributionSettingsAction as any, undefined as ActionResult | undefined);

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <FormGrid cols={3}>
        <Field label="Monthly contribution (KSh)" required>
          <TextInput name="monthly_amount" type="number" min="1" step="0.01" required defaultValue={settings.monthly_amount} />
        </Field>
        <Field label="Due day of month" required hint="1 – 28">
          <TextInput name="due_day" type="number" min="1" max="28" step="1" required defaultValue={settings.due_day} />
        </Field>
        <Field label="Financial year starts" required>
          <Select name="financial_year_start_month" required defaultValue={settings.financial_year_start_month} placeholder="Select month" options={MONTHS} />
        </Field>
      </FormGrid>
      <FormGrid cols={3}>
        <Field label="Penalty amount (KSh)">
          <TextInput name="penalty_amount" type="number" min="0" step="0.01" defaultValue={settings.penalty_amount} />
        </Field>
        <Field label="Penalty after (days overdue)">
          <TextInput name="penalty_after_days" type="number" min="0" step="1" defaultValue={settings.penalty_after_days} />
        </Field>
        <Field label="Minimum monthly SDP savings (KSh)">
          <TextInput name="sacco_min_monthly_savings" type="number" min="0" step="0.01" defaultValue={settings.sacco_min_monthly_savings} />
        </Field>
      </FormGrid>
      <div className="grid gap-3 sm:grid-cols-3">
        <Checkbox name="penalty_enabled" label="Apply penalties" hint="Add the penalty once a bill passes the grace days" defaultChecked={settings.penalty_enabled} />
        <Checkbox name="auto_bill" label="Auto-bill monthly" hint="Generate bills automatically at the start of each month" defaultChecked={settings.auto_bill} />
      </div>
      <div className="border-t border-slate-200 pt-4">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Monthly exemption toggle
 * ------------------------------------------------------------------ */
export function ExemptionToggle({
  memberId,
  memberName,
  exempt,
  reason,
}: {
  memberId: number;
  memberName: string;
  exempt: boolean;
  reason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(reason || '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await setExemptionAction(memberId, !exempt, text || undefined);
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Saved');
      setOpen(false);
    } else toastError(res.error || 'Action failed');
  }

  return (
    <>
      <button
        type="button"
        className={exempt ? 'btn btn-outline btn-sm' : 'btn btn-ghost btn-sm'}
        onClick={() => exempt && !reason ? setOpen(true) : exempt ? submit() : setOpen(true)}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : exempt ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
        {exempt ? 'Exempted' : 'Exempt'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${exempt ? 'Remove exemption for' : 'Exempt'} ${memberName}`}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {exempt
              ? 'The member will be billed again for monthly contributions from the next period.'
              : 'Exempted members are not billed for the monthly contribution. The reason is stored on the member record and in the audit trail.'}
          </p>
          {!exempt ? (
            <Field label="Reason" required>
              <TextInput name="exemption_reason" required placeholder="e.g. Long-term illness, bereavement, retired" onChange={(e) => setText(e.target.value)} />
            </Field>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {exempt ? 'Remove exemption' : 'Apply exemption'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Edit a single month's bill
 * ------------------------------------------------------------------ */
export function ContributionEditButton({
  contributionId,
  periodLabel,
  memberName,
  amountDue,
  dueDate,
  exempted,
  reason,
}: {
  contributionId: number;
  periodLabel: string;
  memberName: string;
  amountDue: number;
  dueDate: string;
  exempted: boolean;
  reason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [due, setDue] = useState(String(amountDue || ''));
  const [date, setDate] = useState(dueDate ? isoDate(dueDate) : '');
  const [isExempt, setIsExempt] = useState(exempted);
  const [text, setText] = useState(reason || '');

  async function submit() {
    setBusy(true);
    const res = await updateContributionAction(contributionId, {
      amount_due: Number(due),
      due_date: date || undefined,
      exempted: isExempt,
      reason: text || undefined,
    });
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Saved');
      setOpen(false);
    } else toastError(res.error || 'Action failed');
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Adjust
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Adjust bill — ${periodLabel}`} description={memberName}>
        <div className="space-y-4">
          <FormGrid cols={2}>
            <Field label="Amount due (KSh)" required>
              <TextInput name="amount_due" type="number" min="0" step="0.01" required defaultValue={amountDue} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Field label="Due date">
              <TextInput name="due_date" type="date" defaultValue={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </FormGrid>
          <Checkbox
            name="exempted"
            label="Exempt this month"
            hint="No payment will be expected for this period"
            defaultChecked={exempted}
            onChange={(e) => setIsExempt(e.target.checked)}
          />
          <Field label="Reason / note">
            <TextInput name="reason" defaultValue={reason || ''} onChange={(e) => setText(e.target.value)} placeholder="Recorded in the audit trail" />
          </Field>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
