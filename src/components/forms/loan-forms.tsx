'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Save, FilePlus2, Banknote, Stamp, ShieldCheck, Wallet, Plus,
  CheckCircle2, XCircle, Send, Megaphone, RefreshCw, Pencil, Power, Users,
} from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, TextArea, Checkbox, ResultAlert } from './fields';
import { MemberPicker, type PickerOption } from './member-picker';
import {
  applyLoanAction,
  previewLoanAction,
  addGuarantorsAction,
  respondGuaranteeAction,
  setApplicationStatusAction,
  disburseLoanAction,
  repayLoanAction,
  saveLoanTypeAction,
  toggleLoanTypeAction,
  waivePenaltyAction,
  recordPenaltyAction,
  runLoanHousekeepingAction,
} from '@/server/actions/loans';
import { money, num } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { ActionResult } from '@/server/actions/auth';

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'airtel', label: 'Airtel Money' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'manual', label: 'Manual / other' },
];

const INTEREST_PERIODS = [
  { value: 'monthly', label: 'Per month' },
  { value: 'annual', label: 'Per annum' },
  { value: 'daily', label: 'Per day' },
];

const INTEREST_METHODS = [
  { value: 'reducing', label: 'Reducing balance' },
  { value: 'flat', label: 'Flat rate' },
  { value: 'straight', label: 'Straight line' },
  { value: 'amortised', label: 'Amortised' },
];

export interface LoanTypeOption {
  id: number;
  code: string;
  name: string;
  min_amount: number;
  max_amount: number;
  interest_rate: number;
  interest_period: string;
  interest_method: string;
  max_repayment_months: number;
  min_repayment_months: number;
  guarantors_required: number;
  processing_fee_pct: number;
  processing_fee_fixed: number;
}

/* ------------------------------------------------------------------ *
 * Apply for a loan (member self-service or staff on behalf)
 * ------------------------------------------------------------------ */
export function ApplyLoanForm({
  loanTypes,
  guarantorOptions,
  memberOptions,
  defaultMemberId,
  defaultMemberName,
  isStaff,
}: {
  loanTypes: LoanTypeOption[];
  guarantorOptions: PickerOption[];
  memberOptions?: PickerOption[];
  defaultMemberId?: number | null;
  defaultMemberName?: string;
  isStaff?: boolean;
}) {
  const [state, action, pending] = useActionState(applyLoanAction as any, undefined as ActionResult | undefined);
  const [typeId, setTypeId] = useState<string>(loanTypes[0] ? String(loanTypes[0].id) : '');
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState('');
  const [memberId, setMemberId] = useState(defaultMemberId ? String(defaultMemberId) : '');
  const [preview, setPreview] = useState<any>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [chosenGuarantors, setChosenGuarantors] = useState<number[]>([]);

  const loanType = useMemo(() => loanTypes.find((t) => String(t.id) === typeId), [loanTypes, typeId]);

  // debounced live preview
  useEffect(() => {
    const a = num(amount);
    const m = num(months);
    if (!typeId || a <= 0 || m <= 0) {
      setPreview(null);
      return;
    }
    let live = true;
    setPreviewBusy(true);
    const t = setTimeout(async () => {
      const res = await previewLoanAction(Number(typeId), a, Math.floor(m));
      if (live) {
        setPreview(res.ok ? res : null);
        setPreviewBusy(false);
      }
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [typeId, amount, months]);

  useEffect(() => {
    if (loanType) {
      setMonths((prev) => {
        const p = num(prev);
        if (p < loanType.min_repayment_months || p > loanType.max_repayment_months) {
          return String(Math.min(loanType.max_repayment_months, Math.max(loanType.min_repayment_months, 12)));
        }
        return prev;
      });
    }
  }, [loanType]);

  function toggleGuarantor(id: number) {
    setChosenGuarantors((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  }

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />

      <Field label="Applicant" required>
        {isStaff && memberOptions ? (
          <MemberPicker options={memberOptions} onChange={setMemberId} />
        ) : (
          <>
            <input type="hidden" name="member_id" value={defaultMemberId ?? ''} />
            <p className="input !bg-slate-50">{defaultMemberName || `Member #${defaultMemberId}`}</p>
          </>
        )}
      </Field>

      <FormGrid cols={3}>
        <Field label="Loan product" required>
          <Select
            name="loan_type_id"
            required
            value={typeId}
            options={loanTypes.map((t) => ({ value: String(t.id), label: `${t.name} (${t.code})` }))}
            placeholder="Select product"
            onChange={(e) => setTypeId(e.target.value)}
          />
        </Field>
        <Field
          label="Amount requested (KSh)"
          required
          hint={loanType ? `${money(loanType.min_amount)} – ${money(loanType.max_amount)}` : undefined}
        >
          <TextInput
            name="amount"
            type="number"
            min={loanType?.min_amount ?? 1}
            max={loanType?.max_amount ?? undefined}
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field
          label="Repayment period (months)"
          required
          hint={loanType ? `${loanType.min_repayment_months} – ${loanType.max_repayment_months} months` : undefined}
        >
          <TextInput
            name="months"
            type="number"
            min={loanType?.min_repayment_months ?? 1}
            max={loanType?.max_repayment_months ?? 60}
            step="1"
            required
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
        </Field>
      </FormGrid>

      <Field label="Purpose of the loan" required hint="At least a short sentence describing what the loan is for.">
        <TextArea name="purpose" required placeholder="e.g. Pay school fees for two children this term" />
      </Field>

      {/* Live repayment preview */}
      {loanType ? (
        <div className="rounded-xl border border-navy-100 bg-navy-50/40 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-700">Repayment preview</p>
            {previewBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-navy-500" /> : null}
          </div>
          {preview?.plan ? (
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">Monthly repayment</dt>
                <dd className="font-semibold text-navy-900">{money(num(preview.plan.monthly_repayment))}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Processing fee</dt>
                <dd className="font-semibold text-navy-900">{money(num(preview.plan.processing_fee))}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Total interest</dt>
                <dd className="font-semibold text-amber-700">{money(num(preview.plan.total_interest))}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Total repayable</dt>
                <dd className="font-semibold text-navy-900">{money(num(preview.plan.total_repayable))}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Interest {num(loanType.interest_rate)}% {loanType.interest_period} · {loanType.interest_method}. Enter an amount and period to see the schedule.
            </p>
          )}
        </div>
      ) : null}

      {/* Guarantors */}
      <Field
        label={`Guarantors (${chosenGuarantors.length} selected)`}
        required={num(loanType?.guarantors_required) > 0}
        hint={loanType ? `${loanType.guarantors_required} guarantor(s) required — they must accept before approval.` : undefined}
      >
        <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {guarantorOptions.length === 0 ? (
            <p className="p-2 text-xs text-slate-500">No other active members available to guarantee.</p>
          ) : (
            guarantorOptions.map((g) => (
              <label key={g.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  name="guarantors"
                  value={g.value}
                  checked={chosenGuarantors.includes(g.value)}
                  onChange={() => toggleGuarantor(g.value)}
                  className="h-4 w-4 rounded border-slate-300 text-navy-700"
                />
                <span className="text-slate-700">{g.label}</span>
              </label>
            ))
          )}
        </div>
      </Field>

      <Field label="Supporting documents" hint="Optional: attach quotations, fee structures, or ID copies.">
        <input type="file" name="documents" multiple className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-navy-800 hover:file:bg-navy-100" />
      </Field>

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Submit application
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Add / change guarantors on an existing application
 * ------------------------------------------------------------------ */
export function AddGuarantorsForm({
  applicationId,
  guarantorOptions,
  currentIds,
}: {
  applicationId: number;
  guarantorOptions: PickerOption[];
  currentIds: number[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<number[]>(currentIds);

  function toggle(id: number) {
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function submit() {
    setBusy(true);
    const res = await addGuarantorsAction(applicationId, chosen);
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Guarantors updated');
      setOpen(false);
      window.location.reload();
    } else toastError(res.error || 'Could not update guarantors');
  }

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <Users className="h-4 w-4" /> Manage guarantors
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Guarantors" description="Guarantors are notified and must each accept before the application can be approved.">
        <div className="space-y-3">
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {guarantorOptions.map((g) => (
              <label key={g.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={chosen.includes(g.value)} onChange={() => toggle(g.value)} className="h-4 w-4 rounded border-slate-300 text-navy-700" />
                <span className="text-slate-700">{g.label}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Save guarantors
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Respond to a guarantee request (accept / decline)
 * ------------------------------------------------------------------ */
export function RespondGuaranteeButtons({ guarantorId }: { guarantorId: number }) {
  const [busy, setBusy] = useState<'' | 'accept' | 'decline'>('');

  async function run(accept: boolean) {
    let notes: string | undefined;
    if (!accept) {
      const r = window.prompt('Reason for declining (optional):');
      if (r === null) return;
      notes = r || undefined;
    }
    setBusy(accept ? 'accept' : 'decline');
    const res = await respondGuaranteeAction(guarantorId, accept, notes);
    setBusy('');
    if (res.ok) {
      toastSuccess(res.message || 'Done');
      window.location.reload();
    } else toastError(res.error || 'Action failed');
  }

  return (
    <div className="flex justify-end gap-1">
      <button type="button" className="btn btn-primary btn-sm" disabled={busy !== ''} onClick={() => run(true)}>
        {busy === 'accept' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Accept
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy !== ''} onClick={() => run(false)}>
        {busy === 'decline' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Decline
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Review an application (workflow transitions)
 * ------------------------------------------------------------------ */
export function ApplicationReviewForm({
  applicationId,
  currentStatus,
  allowed,
  requestedAmount,
  canApprove,
  buttonLabel = 'Review',
}: {
  applicationId: number;
  currentStatus: string;
  allowed: { value: string; label: string }[];
  requestedAmount: number;
  canApprove: boolean;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [approvedAmount, setApprovedAmount] = useState(String(requestedAmount));
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  async function submit() {
    if (!target) {
      toastError('Choose the next status');
      return;
    }
    setBusy(true);
    const res = await setApplicationStatusAction(applicationId, target, {
      notes: notes || undefined,
      approvedAmount: target === 'approved' ? num(approvedAmount) : undefined,
      rejectionReason: target === 'rejected' ? reason || undefined : undefined,
    });
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Application updated');
      setOpen(false);
      window.location.reload();
    } else toastError(res.error || 'Could not update the application');
  }

  if (!canApprove || allowed.length === 0) return null;

  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <Stamp className="h-4 w-4" /> {buttonLabel}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Move application from "${currentStatus.replace(/_/g, ' ')}"`} description="Advance the loan application through the approval workflow.">
        <div className="space-y-4">
          <Field label="New status" required>
            <Select name="next_status" value={target} options={allowed} placeholder="Select next status" onChange={(e) => setTarget(e.target.value)} />
          </Field>
          {target === 'approved' ? (
            <Field label="Approved amount (KSh)" required hint={`Requested ${money(requestedAmount)}`}>
              <TextInput name="approved_amount" type="number" min="1" step="0.01" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
            </Field>
          ) : null}
          {target === 'rejected' ? (
            <Field label="Rejection reason" required>
              <TextArea name="rejection_reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this application being declined?" />
            </Field>
          ) : null}
          <Field label="Review notes">
            <TextArea name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Committee remarks, conditions, minutes reference…" />
          </Field>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Update application
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Disburse an approved application
 * ------------------------------------------------------------------ */
export function DisburseLoanForm({ applicationId, approvedAmount }: { applicationId: number; approvedAmount: number }) {
  const [state, action, pending] = useActionState(disburseLoanAction as any, undefined as ActionResult | undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" className="btn btn-gold btn-sm" onClick={() => setOpen(true)}>
        <Banknote className="h-4 w-4" /> Disburse
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Disburse loan" description="Creates the loan, generates the repayment schedule and records the disbursement.">
        <form action={action} className="space-y-4">
          <ResultAlert result={state} />
          <input type="hidden" name="application_id" value={applicationId} />
          <FormGrid cols={2}>
            <Field label="Amount to disburse (KSh)" required hint={`Approved ${money(approvedAmount)}`}>
              <TextInput name="amount" type="number" min="1" step="0.01" required defaultValue={approvedAmount} />
            </Field>
            <Field label="Disbursement method" required>
              <Select name="method" required defaultValue="bank" options={METHODS} placeholder="Select method" />
            </Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="First instalment due date">
              <TextInput name="first_due_date" type="date" defaultValue={isoDate(new Date())} />
            </Field>
            <Field label="Reference"><TextInput name="reference" placeholder="Cheque / transfer ref…" /></Field>
          </FormGrid>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} Disburse loan
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Record a loan repayment
 * ------------------------------------------------------------------ */
export function RepayLoanForm({
  loanId,
  loanNo,
  outstanding,
  nextDue,
  isSelf,
}: {
  loanId: number;
  loanNo: string;
  outstanding: number;
  nextDue?: string | null;
  isSelf?: boolean;
}) {
  const [state, action, pending] = useActionState(repayLoanAction as any, undefined as ActionResult | undefined);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setAmount('');
    }
  }, [state]);

  return (
    <>
      <button type="button" className={isSelf ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setOpen(true)}>
        <Wallet className="h-4 w-4" /> {isSelf ? 'Repay now' : 'Record repayment'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Repay loan ${loanNo}`} description={`Outstanding balance ${money(outstanding)}${nextDue ? ` · next instalment due ${nextDue}` : ''}.`}>
        <form action={action} className="space-y-4">
          <ResultAlert result={state} />
          <input type="hidden" name="loan_id" value={loanId} />
          <FormGrid cols={2}>
            <Field label="Amount (KSh)" required>
              <TextInput name="amount" type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Method" required hint={isSelf ? 'M-Pesa repays via STK push to your phone' : undefined}>
              <Select name="method" required defaultValue={isSelf ? 'mpesa' : 'cash'} options={METHODS} placeholder="Select method" />
            </Field>
          </FormGrid>
          <FormGrid cols={2}>
            {!isSelf ? (
              <Field label="Repayment date" required>
                <TextInput name="repayment_date" type="date" required defaultValue={isoDate(new Date())} />
              </Field>
            ) : null}
            <Field label="Reference"><TextInput name="reference" placeholder="M-Pesa code, slip no…" /></Field>
          </FormGrid>
          <Field label="Notes"><TextArea name="notes" placeholder="Optional note for the receipt" /></Field>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Record repayment
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Loan product configuration
 * ------------------------------------------------------------------ */
export function LoanTypeForm({ loanType, onClose }: { loanType?: any; onClose?: () => void }) {
  const [state, action, pending] = useActionState(saveLoanTypeAction as any, undefined as ActionResult | undefined);
  const editing = Boolean(loanType?.id);

  useEffect(() => {
    if (state?.ok && onClose) onClose();
  }, [state, onClose]);

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      {editing ? <input type="hidden" name="id" value={loanType.id} /> : null}
      <FormGrid cols={2}>
        <Field label="Code" required hint="Short uppercase code, e.g. DEV">
          <TextInput name="code" required defaultValue={loanType?.code} placeholder="DEV" />
        </Field>
        <Field label="Product name" required>
          <TextInput name="name" required defaultValue={loanType?.name} placeholder="Development Loan" />
        </Field>
      </FormGrid>
      <Field label="Description"><TextArea name="description" defaultValue={loanType?.description} placeholder="What this loan product is for" /></Field>

      <FormGrid cols={3}>
        <Field label="Minimum amount (KSh)" required><TextInput name="min_amount" type="number" min="0" step="0.01" required defaultValue={loanType?.min_amount ?? 1000} /></Field>
        <Field label="Maximum amount (KSh)" required><TextInput name="max_amount" type="number" min="1" step="0.01" required defaultValue={loanType?.max_amount ?? 100000} /></Field>
        <Field label="Interest rate (%)" required><TextInput name="interest_rate" type="number" min="0" max="50" step="0.01" required defaultValue={loanType?.interest_rate ?? 1} /></Field>
      </FormGrid>

      <FormGrid cols={3}>
        <Field label="Interest period" required>
          <Select name="interest_period" required defaultValue={loanType?.interest_period ?? 'monthly'} options={INTEREST_PERIODS} />
        </Field>
        <Field label="Interest method" required>
          <Select name="interest_method" required defaultValue={loanType?.interest_method ?? 'reducing'} options={INTEREST_METHODS} />
        </Field>
        <Field label="Guarantors required" required><TextInput name="guarantors_required" type="number" min="0" step="1" required defaultValue={loanType?.guarantors_required ?? 2} /></Field>
      </FormGrid>

      <FormGrid cols={3}>
        <Field label="Min repayment months" required><TextInput name="min_repayment_months" type="number" min="1" step="1" required defaultValue={loanType?.min_repayment_months ?? 1} /></Field>
        <Field label="Max repayment months" required><TextInput name="max_repayment_months" type="number" min="1" step="1" required defaultValue={loanType?.max_repayment_months ?? 12} /></Field>
        <Field label="Min membership months"><TextInput name="min_membership_months" type="number" min="0" step="1" defaultValue={loanType?.min_membership_months ?? 0} /></Field>
      </FormGrid>

      <FormGrid cols={3}>
        <Field label="Min savings required (KSh)"><TextInput name="min_savings_required" type="number" min="0" step="0.01" defaultValue={loanType?.min_savings_required ?? 0} /></Field>
        <Field label="Savings multiplier (×)" hint="Max loan = this × savings"><TextInput name="savings_multiplier" type="number" min="0" step="0.5" defaultValue={loanType?.savings_multiplier ?? 3} /></Field>
        <Field label="Max active loans"><TextInput name="max_active_loans" type="number" min="1" step="1" defaultValue={loanType?.max_active_loans ?? 1} /></Field>
      </FormGrid>

      <FormGrid cols={3}>
        <Field label="Min shares required"><TextInput name="min_shares_required" type="number" min="0" step="1" defaultValue={loanType?.min_shares_required ?? 0} /></Field>
        <Field label="Shares multiplier (×)"><TextInput name="shares_multiplier" type="number" min="0" step="0.5" defaultValue={loanType?.shares_multiplier ?? 0} /></Field>
        <Field label="Grace days"><TextInput name="grace_days" type="number" min="0" step="1" defaultValue={loanType?.grace_days ?? 0} /></Field>
      </FormGrid>

      <FormGrid cols={3}>
        <Field label="Processing fee (%)"><TextInput name="processing_fee_pct" type="number" min="0" step="0.01" defaultValue={loanType?.processing_fee_pct ?? 1} /></Field>
        <Field label="Processing fee (fixed KSh)"><TextInput name="processing_fee_fixed" type="number" min="0" step="0.01" defaultValue={loanType?.processing_fee_fixed ?? 0} /></Field>
        <Field label="Penalty rate (% of arrears)"><TextInput name="penalty_rate_pct" type="number" min="0" step="0.01" defaultValue={loanType?.penalty_rate_pct ?? 0} /></Field>
      </FormGrid>

      <FormGrid cols={2}>
        <Field label="Penalty fixed (KSh)"><TextInput name="penalty_fixed" type="number" min="0" step="0.01" defaultValue={loanType?.penalty_fixed ?? 0} /></Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox name="requires_collateral" label="Requires collateral" defaultChecked={loanType?.requires_collateral} />
          <Checkbox name="active" label="Active (available to apply)" defaultChecked={loanType ? loanType.active : true} />
        </div>
      </FormGrid>

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {editing ? 'Update loan product' : 'Create loan product'}
      </button>
    </form>
  );
}

export function LoanTypeRowActions({ loanType }: { loanType: any }) {
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await toggleLoanTypeAction(Number(loanType.id), !loanType.active);
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Done');
      window.location.reload();
    } else toastError(res.error || 'Action failed');
  }

  return (
    <>
      <div className="flex justify-end gap-1">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditOpen(true)} title="Edit product">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={toggle} title={loanType.active ? 'Deactivate' : 'Activate'}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
        </button>
      </div>
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${loanType.name}`} description="Update the loan product configuration. Existing loans keep their original terms.">
        <LoanTypeForm loanType={loanType} onClose={() => setEditOpen(false)} />
      </Modal>
    </>
  );
}

export function NewLoanTypeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New loan product
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New loan product" description="Define eligibility, pricing and repayment rules for a new loan product.">
        <LoanTypeForm onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Penalties
 * ------------------------------------------------------------------ */
export function RecordPenaltyButton({ members }: { members?: PickerOption[] }) {
  const [state, action, pending] = useActionState(recordPenaltyAction as any, undefined as ActionResult | undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Record penalty
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a penalty" description="Applies a manual penalty to a member's account (e.g. late loan instalment).">
        <form action={action} className="space-y-4">
          <ResultAlert result={state} />
          {members ? (
            <Field label="Member" required><MemberPicker name="member_id" options={members} /></Field>
          ) : null}
          <FormGrid cols={2}>
            <Field label="Amount (KSh)" required><TextInput name="amount" type="number" min="1" step="0.01" required /></Field>
            <Field label="Penalty type">
              <Select name="penalty_type" defaultValue="late_loan" options={[
                { value: 'late_loan', label: 'Late loan instalment' },
                { value: 'late_contribution', label: 'Late contribution' },
                { value: 'late_savings', label: 'Late savings' },
                { value: 'late_shares', label: 'Late shares' },
                { value: 'other', label: 'Other' },
              ]} placeholder="Select type" />
            </Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Period"><TextInput name="period" placeholder="e.g. 2026-03" /></Field>
            <Field label="Reason"><TextInput name="reason" placeholder="Reason for the penalty" /></Field>
          </FormGrid>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Record penalty
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function WaivePenaltyButton({ penaltyId }: { penaltyId: number }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    const reason = window.prompt('Reason for waiving this penalty:');
    if (!reason) return;
    setBusy(true);
    const res = await waivePenaltyAction(penaltyId, reason);
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Penalty waived');
      window.location.reload();
    } else toastError(res.error || 'Could not waive the penalty');
  }
  return (
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={run}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Waive
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Housekeeping
 * ------------------------------------------------------------------ */
export function RunHousekeepingButton() {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const res = await runLoanHousekeepingAction();
    setBusy(false);
    if (res.ok) {
      toastSuccess('Housekeeping complete', res.message);
      window.location.reload();
    } else toastError(res.error || 'Housekeeping failed');
  }
  return (
    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={run}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run loan housekeeping
    </button>
  );
}
