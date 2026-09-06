'use client';

import { useActionState, useEffect, useState } from 'react';
import { Loader2, Save, Wallet, Plus, ArrowLeftRight, PieChart, Megaphone, Banknote, UserPlus } from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, TextArea, Checkbox, ResultAlert } from './fields';
import { MemberPicker } from './member-picker';
import type { PickerOption } from './member-picker';
import {
  openSaccoAccountAction,
  postSavingsAction,
  purchaseSharesAction,
  transferSharesAction,
  createDividendAction,
  creditDividendsAction,
  declareDividendAction,
  saveSaccoSettingsAction,
  saveShareSettingsAction,
} from '@/server/actions/sacco';
import { money, num } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { ActionResult } from '@/server/actions/auth';

const SAVINGS_TYPES = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'interest', label: 'Interest on deposits' },
  { value: 'dividend', label: 'Dividend' },
  { value: 'adjustment', label: 'Adjustment / correction' },
  { value: 'penalty', label: 'Penalty' },
];

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'airtel', label: 'Airtel Money' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'manual', label: 'Manual / other' },
];

/* ------------------------------------------------------------------ *
 * Open a sacco account
 * ------------------------------------------------------------------ */
export function OpenAccountButton({ memberId, memberName }: { memberId: number; memberName: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-gold btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await openSaccoAccountAction(memberId);
        setBusy(false);
        if (res.ok) {
          toastSuccess(res.message || 'Account opened');
          window.location.reload();
        } else toastError(res.error || 'Could not open the account');
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Open account for {memberName.split(' ')[0]}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Savings: deposit / withdrawal
 * ------------------------------------------------------------------ */
export function PostSavingsForm({
  members,
  defaultMemberId,
  minMonthly,
}: {
  members: PickerOption[];
  defaultMemberId?: number | null;
  minMonthly: number;
}) {
  const [state, action, pending] = useActionState(postSavingsAction as any, undefined as ActionResult | undefined);
  const [memberId, setMemberId] = useState(defaultMemberId ? String(defaultMemberId) : '');
  const [type, setType] = useState('deposit');

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <Field label="Member" required hint="Only members with an open SDP / Sacco account can transact.">
        {defaultMemberId ? (
          <>
            <input type="hidden" name="member_id" value={defaultMemberId} />
            <p className="input !bg-slate-50">{members.find((m) => String(m.value) === String(defaultMemberId))?.label || `Member #${defaultMemberId}`}</p>
          </>
        ) : (
          <MemberPicker options={members} onChange={setMemberId} />
        )}
      </Field>
      <FormGrid cols={3}>
        <Field label="Transaction type" required>
          <Select name="transaction_type" required defaultValue={type} options={SAVINGS_TYPES} placeholder="Select type" onChange={(e) => setType(e.target.value)} />
        </Field>
        <Field label="Amount (KSh)" required hint={type === 'deposit' && minMonthly ? `Minimum monthly saving ${money(minMonthly)}` : undefined}>
          <TextInput name="amount" type="number" min="1" step="0.01" required />
        </Field>
        <Field label="Payment method" required>
          <Select name="method" required defaultValue="cash" options={METHODS} placeholder="Select method" />
        </Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Transaction date" required>
          <TextInput name="transaction_date" type="date" required defaultValue={isoDate(new Date())} />
        </Field>
        <Field label="Reference"><TextInput name="reference" placeholder="M-Pesa code, slip no…" /></Field>
      </FormGrid>
      <Field label="Notes"><TextArea name="notes" placeholder="Purpose of the deposit / withdrawal" /></Field>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Post savings transaction
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Shares
 * ------------------------------------------------------------------ */
export function PurchaseSharesForm({
  members,
  defaultMemberId,
  valuePerShare,
  minShares,
  maxShares,
}: {
  members: PickerOption[];
  defaultMemberId?: number | null;
  valuePerShare: number;
  minShares: number;
  maxShares: number;
}) {
  const [state, action, pending] = useActionState(purchaseSharesAction as any, undefined as ActionResult | undefined);
  const [shares, setShares] = useState(String(minShares || 1));
  const [amount, setAmount] = useState('');
  const computed = num(shares) * valuePerShare;

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <Field label="Member" required>
        {defaultMemberId ? (
          <>
            <input type="hidden" name="member_id" value={defaultMemberId} />
            <p className="input !bg-slate-50">{members.find((m) => String(m.value) === String(defaultMemberId))?.label || `Member #${defaultMemberId}`}</p>
          </>
        ) : (
          <MemberPicker options={members} />
        )}
      </Field>
      <FormGrid cols={2}>
        <Field label="Number of shares" hint={`${minShares} minimum · ${maxShares} maximum per member`}>
          <TextInput name="shares" type="number" min={minShares} max={maxShares} step="1" defaultValue={shares} onChange={(e) => setShares(e.target.value)} />
        </Field>
        <Field label="Or amount invested (KSh)" hint="Leave blank to use shares × value">
          <TextInput name="amount" type="number" min="0" step="0.01" onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </FormGrid>
      <p className="rounded-lg bg-gold-50 p-3 text-sm text-gold-800">
        One share = <strong>{money(valuePerShare)}</strong>.
        {num(shares) > 0 && !num(amount) ? <> Issuing {shares} share(s) costs <strong>{money(computed)}</strong>.</> : null}
        A share certificate is generated automatically.
      </p>
      <Field label="Notes"><TextArea name="notes" placeholder="e.g. Bought during the CMA AGM" /></Field>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Issue shares
      </button>
    </form>
  );
}

export function TransferSharesForm({ members }: { members: PickerOption[] }) {
  const [state, action, pending] = useActionState(transferSharesAction as any, undefined as ActionResult | undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <ArrowLeftRight className="h-4 w-4" /> Transfer shares
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Transfer shares between members" description="A transfer issues a new certificate and cancels the equivalent shares on the sender's account.">
        <form action={action} className="space-y-4">
          <ResultAlert result={state} />
          <Field label="Transfer from" required><MemberPicker name="from_member_id" options={members} /></Field>
          <Field label="Transfer to" required><MemberPicker name="to_member_id" options={members} /></Field>
          <Field label="Number of shares" required><TextInput name="shares" type="number" min="1" step="1" required /></Field>
          <Field label="Reason / notes"><TextArea name="notes" placeholder="e.g. Approved by the SDP committee on …" /></Field>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />} Transfer shares
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Dividends
 * ------------------------------------------------------------------ */
export function DividendForm({ years }: { years: string[] }) {
  const [state, action, pending] = useActionState(createDividendAction as any, undefined as ActionResult | undefined);
  const [rate, setRate] = useState('');
  const [pct, setPct] = useState('');

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <FormGrid cols={2}>
        <Field label="Financial year" required>
          <Select name="financial_year" required options={years.map((y) => ({ value: y, label: y }))} placeholder="Select year" />
        </Field>
        <Field label="Description"><TextInput name="description" placeholder="e.g. Dividend on share capital for 2025" /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Rate per share (KSh)" hint="Use either this or the percentage">
          <TextInput name="rate_per_share" type="number" min="0" step="0.01" onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Percentage of share capital">
          <TextInput name="percentage" type="number" min="0" max="100" step="0.01" onChange={(e) => setPct(e.target.value)} />
        </Field>
      </FormGrid>
      {!(num(rate) > 0) && !(num(pct) > 0) ? (
        <p className="text-xs text-amber-700">Enter a rate per share or a percentage so the allocation can be computed.</p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PieChart className="h-4 w-4" />} Compute dividend
      </button>
    </form>
  );
}

export function DividendRowActions({ dividendId, status }: { dividendId: number; status: string }) {
  const [busy, setBusy] = useState<'' | 'declare' | 'credit'>('');

  async function run(key: 'declare' | 'credit', fn: () => Promise<ActionResult>) {
    setBusy(key);
    const res = await fn();
    setBusy('');
    if (res.ok) {
      toastSuccess(res.message || 'Done');
      window.location.reload();
    } else toastError(res.error || 'Action failed');
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {status === 'computed' ? (
        <button type="button" className="btn btn-outline btn-sm" disabled={busy !== ''} onClick={() => run('declare', () => declareDividendAction(dividendId))}>
          {busy === 'declare' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />} Declare
        </button>
      ) : null}
      {status === 'declared' || status === 'computed' ? (
        <button type="button" className="btn btn-gold btn-sm" disabled={busy !== ''} onClick={() => run('credit', () => creditDividendsAction(dividendId))}>
          {busy === 'credit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />} Credit to savings
        </button>
      ) : null}
      {status === 'paid' ? <span className="badge badge-green">Paid</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */
export function SaccoSettingsForm({ settings }: { settings: any }) {
  const [state, action, pending] = useActionState(saveSaccoSettingsAction as any, undefined as ActionResult | undefined);
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <FormGrid cols={3}>
        <Field label="Account number prefix"><TextInput name="account_prefix" defaultValue={settings.account_prefix} /></Field>
        <Field label="Minimum monthly savings (KSh)"><TextInput name="min_monthly_savings" type="number" min="0" step="0.01" defaultValue={settings.min_monthly_savings} /></Field>
        <Field label="Max withdrawal (% of savings)"><TextInput name="max_savings_withdrawal_pct" type="number" min="0" max="100" step="0.01" defaultValue={settings.max_savings_withdrawal_pct} /></Field>
      </FormGrid>
      <FormGrid cols={3}>
        <Field label="Withdrawal notice (days)"><TextInput name="withdrawal_notice_days" type="number" min="0" step="1" defaultValue={settings.withdrawal_notice_days} /></Field>
        <Field label="Interest on deposits (%)"><TextInput name="interest_on_deposits_pct" type="number" min="0" step="0.01" defaultValue={settings.interest_on_deposits_pct} /></Field>
        <Field label="Dividend policy">
          <Select
            name="dividend_policy"
            defaultValue={settings.dividend_policy}
            options={[
              { value: 'share_capital', label: 'On share capital' },
              { value: 'savings', label: 'On savings balance' },
              { value: 'both', label: 'Both (committee decides)' },
            ]}
            placeholder="Select policy"
          />
        </Field>
      </FormGrid>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save SDP / Sacco settings
      </button>
    </form>
  );
}

export function ShareSettingsForm({ settings }: { settings: any }) {
  const [state, action, pending] = useActionState(saveShareSettingsAction as any, undefined as ActionResult | undefined);
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <FormGrid cols={3}>
        <Field label="Value per share (KSh)" required><TextInput name="value_per_share" type="number" min="1" step="0.01" required defaultValue={settings.value_per_share} /></Field>
        <Field label="Minimum shares per purchase"><TextInput name="min_shares" type="number" min="1" step="1" defaultValue={settings.min_shares} /></Field>
        <Field label="Maximum shares per member"><TextInput name="max_shares_per_member" type="number" min="1" step="1" defaultValue={settings.max_shares_per_member} /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Certificate prefix"><TextInput name="certificate_prefix" defaultValue={settings.certificate_prefix} /></Field>
        <div className="flex items-end pb-1">
          <Checkbox name="transferable" label="Shares are transferable" hint="Allow transfers between members with committee approval" defaultChecked={settings.transferable} />
        </div>
      </FormGrid>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save share settings
      </button>
    </form>
  );
}
