'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Banknote, Plus, Trash2, Save, RotateCcw, CheckCheck, Smartphone,
  FlaskConical, Link2, ReceiptText, Wallet,
} from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, TextArea, ResultAlert } from './fields';
import type { Obligation } from './pay-now';
import {
  recordPaymentAction,
  reversePaymentAction,
  markReconciledAction,
  stkPushAction,
  simulateStkAction,
  reconcileMpesaTransactionAction,
} from '@/server/actions/payments';
import { money, num, round2 } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { ActionResult } from '@/server/actions/auth';

export { PAYMENT_METHODS, ALLOCATION_TYPES } from '@/lib/payment-meta';
import { PAYMENT_METHODS, ALLOCATION_TYPES } from '@/lib/payment-meta';

interface Row {
  uid: number;
  type: string;
  referenceId: string;
  period: string;
  shares: string;
  amount: string;
  note: string;
}

let uid = 0;
const nextUid = () => ++uid;

/* ------------------------------------------------------------------ *
 * Record a payment (treasurer / secretary / admin)
 * ------------------------------------------------------------------ */
export function RecordPaymentForm({
  member,
  obligations,
  preset,
  balance,
}: {
  member: { id: number; name: string; membership_no: string; phone?: string | null };
  obligations: Obligation[];
  preset?: { type?: string; referenceId?: number | null; period?: string | null; amount?: number } | null;
  balance?: number;
}) {
  const [state, action, pending] = useActionState(recordPaymentAction as any, undefined as ActionResult | undefined);
  const [rows, setRows] = useState<Row[]>(() => {
    if (preset?.type) {
      return [
        {
          uid: nextUid(),
          type: preset.type,
          referenceId: preset.referenceId ? String(preset.referenceId) : '',
          period: preset.period || '',
          shares: '',
          amount: preset.amount ? String(preset.amount) : '',
          note: '',
        },
      ];
    }
    return [];
  });
  const [method, setMethod] = useState('cash');
  const [total, setTotal] = useState(preset?.amount ? String(preset.amount) : '');

  const allocated = useMemo(() => round2(rows.reduce((a, r) => a + num(r.amount), 0)), [rows]);
  const declared = round2(num(total));
  const mismatch = rows.length > 0 && Math.abs(allocated - declared) > 0.009;

  function addFromObligation(key: string) {
    const ob = obligations.find((o) => o.key === key);
    if (!ob) return;
    setRows((prev) => [
      ...prev,
      {
        uid: nextUid(),
        type: ob.allocationType,
        referenceId: ob.referenceId ? String(ob.referenceId) : '',
        period: ob.period || '',
        shares: ob.shares ? String(ob.shares) : '',
        amount: String(ob.amount || ''),
        note: '',
      },
    ]);
    setTotal(String(round2(allocated + num(ob.amount))));
  }

  function addBlank() {
    setRows((prev) => [...prev, { uid: nextUid(), type: 'monthly_contribution', referenceId: '', period: '', shares: '', amount: '', note: '' }]);
  }

  function patch(id: number, changes: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.uid === id ? { ...r, ...changes } : r)));
  }

  function remove(id: number) {
    setRows((prev) => prev.filter((r) => r.uid !== id));
  }

  const payload = JSON.stringify(
    rows.map((r) => ({
      type: r.type,
      amount: round2(num(r.amount)),
      referenceId: r.referenceId ? Number(r.referenceId) : null,
      period: r.period || null,
      shares: r.shares ? Number(r.shares) : null,
      note: r.note || null,
    })),
  );

  const receiptNo = state?.ok ? String((state.data as any)?.receiptNo || '') : '';
  const paymentId = state?.ok ? Number((state.data as any)?.paymentId || 0) : 0;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="member_id" value={member.id} />
      <input type="hidden" name="allocations" value={payload} />
      <ResultAlert result={state} />

      {state?.ok ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">Payment recorded — receipt {receiptNo}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {receiptNo ? <Link className="btn btn-outline btn-sm" href={`/receipts/${receiptNo}`}><ReceiptText className="h-4 w-4" /> View receipt</Link> : null}
            {receiptNo ? <Link className="btn btn-outline btn-sm" href={`/api/documents/receipt?receipt=${encodeURIComponent(receiptNo)}`} target="_blank">Receipt PDF</Link> : null}
            {paymentId ? <Link className="btn btn-outline btn-sm" href={`/payments/${paymentId}`}>Payment details</Link> : null}
            <Link className="btn btn-ghost btn-sm" href={`/members/${member.id}?tab=payments`}>Member profile</Link>
          </div>
        </div>
      ) : null}

      <Card2 title="Payer">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-navy-900">{member.name}</p>
            <p className="text-xs text-slate-500">{member.membership_no}{member.phone ? ` · ${member.phone}` : ''}</p>
          </div>
          {typeof balance === 'number' ? (
            <p className="text-sm text-slate-600">
              Outstanding balance <strong className="text-navy-900">{money(balance)}</strong>
            </p>
          ) : null}
          <Link href={`/payments/new`} className="btn btn-ghost btn-sm">Change member</Link>
        </div>
      </Card2>

      <Card2 title="Payment">
        <FormGrid cols={3}>
          <Field label="Amount received (KSh)" required>
            <TextInput name="amount" type="number" min="0.01" step="0.01" required defaultValue={total} onChange={(e) => setTotal(e.target.value)} />
          </Field>
          <Field label="Method" required>
            <Select name="method" required defaultValue={method} options={PAYMENT_METHODS} placeholder="Select method" onChange={(e) => setMethod(e.target.value)} />
          </Field>
          <Field label="Payment date" required>
            <TextInput name="payment_date" type="date" required defaultValue={isoDate(new Date())} />
          </Field>
        </FormGrid>
        <FormGrid cols={2}>
          <Field label="Reference" hint="M-Pesa code, cheque number or bank slip">
            <TextInput name="reference" placeholder={method === 'cash' ? 'e.g. Cash book page 12' : 'e.g. QGH7X2K1L9'} />
          </Field>
          <Field label="Transaction ID"><TextInput name="transaction_id" placeholder="Optional" /></Field>
        </FormGrid>
        <Field label="Notes"><TextArea name="notes" placeholder="Anything the auditors should see" /></Field>
      </Card2>

      <Card2
        title="Allocate the money"
        action={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={addBlank}><Plus className="h-4 w-4" /> Manual line</button>
          </div>
        }
      >
        {obligations.length > 0 ? (
          <div className="mb-4">
            <p className="label mb-2">Add from what this member owes</p>
            <div className="flex flex-wrap gap-2">
              {obligations.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-gold-500 hover:bg-gold-50/40"
                  onClick={() => addFromObligation(o.key)}
                >
                  <span className="block font-semibold text-navy-900">{o.label}</span>
                  <span className="block text-slate-500">{money(o.amount)}{o.detail ? ` · ${o.detail}` : ''}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
            No allocation lines yet. Add what this payment covers — at least one line is required.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={r.uid} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Line {i + 1}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(r.uid)}><Trash2 className="h-3.5 w-3.5" /> Remove</button>
                </div>
                <FormGrid cols={3}>
                  <Field label="Goes to" required>
                    <Select
                      name={`alloc_type_${r.uid}`}
                      required
                      defaultValue={r.type}
                      options={ALLOCATION_TYPES}
                      placeholder="Select destination"
                      onChange={(e) => patch(r.uid, { type: e.target.value })}
                    />
                  </Field>
                  <Field label="Amount (KSh)" required>
                    <TextInput
                      name={`alloc_amount_${r.uid}`}
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      defaultValue={r.amount}
                      onChange={(e) => patch(r.uid, { amount: e.target.value })}
                    />
                  </Field>
                  {r.type === 'monthly_contribution' ? (
                    <Field label="Period" hint="yyyy-MM">
                      <TextInput name={`alloc_period_${r.uid}`} type="month" defaultValue={r.period} onChange={(e) => patch(r.uid, { period: e.target.value })} />
                    </Field>
                  ) : r.type === 'shares' ? (
                    <Field label="Number of shares">
                      <TextInput name={`alloc_shares_${r.uid}`} type="number" min="1" step="1" defaultValue={r.shares} onChange={(e) => patch(r.uid, { shares: e.target.value })} />
                    </Field>
                  ) : (
                    <Field label="Record ID" hint="Case / loan / project ID">
                      <TextInput name={`alloc_ref_${r.uid}`} type="number" min="1" step="1" defaultValue={r.referenceId} onChange={(e) => patch(r.uid, { referenceId: e.target.value })} />
                    </Field>
                  )}
                </FormGrid>
              </div>
            ))}

            <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 text-sm ${mismatch ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
              <span>Allocated <strong>{money(allocated)}</strong> of <strong>{money(declared)}</strong> received</span>
              {mismatch ? (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setTotal(String(allocated))}>
                  <Wallet className="h-4 w-4" /> Set amount to {money(allocated)}
                </button>
              ) : (
                <span className="font-semibold">Balanced ✓</span>
              )}
            </div>
          </div>
        )}
      </Card2>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <button type="submit" className="btn btn-primary" disabled={pending || rows.length === 0 || mismatch}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
          {pending ? 'Recording…' : 'Record payment & issue receipt'}
        </button>
        <Link href="/payments" className="btn btn-ghost">Cancel</Link>
        {rows.length === 0 ? <span className="text-xs text-slate-500">Add at least one allocation line.</span> : null}
        {mismatch ? <span className="text-xs text-red-600">Allocations must equal the amount received.</span> : null}
      </div>
    </form>
  );
}

function Card2({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-navy-800">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Reverse a payment (never delete financial records)
 * ------------------------------------------------------------------ */
export function ReversePaymentButton({ paymentId, receiptNo, amount }: { paymentId: number; receiptNo: string; amount: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (reason.trim().length < 5) {
      toastError('Give a reason of at least 5 characters');
      return;
    }
    setBusy(true);
    const res = await reversePaymentAction(paymentId, reason.trim());
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Payment reversed');
      setOpen(false);
      window.location.reload();
    } else toastError(res.error || 'Could not reverse the payment');
  }

  return (
    <>
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setOpen(true)}>
        <RotateCcw className="h-4 w-4" /> Reverse payment
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Reverse ${receiptNo}`}
        description="Reversals keep the original record for audit and create a correcting entry."
      >
        <div className="space-y-4">
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {money(amount)} will be reversed. Every allocation (contributions, savings, loans, cases) is unwound and the member is notified.
          </p>
          <Field label="Reason for reversal" required hint="Stored permanently in the audit trail">
            <TextArea name="reversal_reason" required placeholder="e.g. Duplicate M-Pesa entry, wrong member selected" onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button type="button" className="btn btn-danger flex-1" disabled={busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reverse payment
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Reconciliation
 * ------------------------------------------------------------------ */
export function ReconcileButton({ paymentIds, label = 'Mark reconciled' }: { paymentIds: number[]; label?: string }) {
  const [busy, setBusy] = useState(false);
  if (!paymentIds.length) return null;
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await markReconciledAction(paymentIds);
        setBusy(false);
        if (res.ok) {
          toastSuccess(res.message || 'Reconciled');
          window.location.reload();
        } else toastError(res.error || 'Could not reconcile');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} {label} ({paymentIds.length})
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * M-Pesa STK push
 * ------------------------------------------------------------------ */
export function StkPushForm({
  members,
  defaultMemberId,
  enabled,
  mode,
}: {
  members: { value: number; label: string; phone?: string | null }[];
  defaultMemberId?: number | null;
  enabled: boolean;
  mode: string;
}) {
  const [state, action, pending] = useActionState(stkPushAction as any, undefined as ActionResult | undefined);
  const [memberId, setMemberId] = useState(defaultMemberId ? String(defaultMemberId) : '');
  const member = members.find((m) => String(m.value) === memberId);

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      {!enabled ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Daraja credentials are not configured, so requests run in <strong>{mode}</strong> mode: the transaction is queued and can be
          settled from the simulator below. Add the credentials in Settings to go live.
        </p>
      ) : null}
      <FormGrid cols={2}>
        <Field label="Member" required>
          <Select
            name="member_id"
            required
            defaultValue={memberId}
            placeholder="Select a member"
            options={members.map((m) => ({ value: m.value, label: m.label }))}
            onChange={(e) => setMemberId(e.target.value)}
          />
        </Field>
        <Field label="M-Pesa phone number" required hint="2547XXXXXXXX">
          <TextInput name="phone_number" required defaultValue={member?.phone || ''} placeholder="254712345678" />
        </Field>
      </FormGrid>
      <FormGrid cols={3}>
        <Field label="Amount (KSh)" required>
          <TextInput name="amount" type="number" min="1" step="0.01" required />
        </Field>
        <Field label="Allocate to" required>
          <Select name="allocation_type" required defaultValue="monthly_contribution" options={ALLOCATION_TYPES} placeholder="Select destination" />
        </Field>
        <Field label="Period / record ID" hint="Optional">
          <TextInput name="reference_id" type="number" min="1" step="1" placeholder="Case, loan or project ID" />
        </Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Period (yyyy-MM)"><TextInput name="period" type="month" /></Field>
        <Field label="Description"><TextInput name="description" placeholder="Shown on the STK prompt" /></Field>
      </FormGrid>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />} Send STK push
      </button>
    </form>
  );
}

export function SimulateStkButton({ checkoutId, status }: { checkoutId: string; status: string }) {
  const [busy, setBusy] = useState<'' | 'ok' | 'fail'>('');

  async function run(success: boolean) {
    setBusy(success ? 'ok' : 'fail');
    const res = await simulateStkAction(checkoutId, success);
    setBusy('');
    if (res.ok) {
      toastSuccess(res.message || 'Simulated');
      window.location.reload();
    } else toastError(res.error || 'Simulation failed');
  }

  if (status !== 'pending') return <span className="badge badge-grey">{status}</span>;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <button type="button" className="btn btn-success btn-sm" disabled={busy !== ''} onClick={() => run(true)}>
        {busy === 'ok' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Paid
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy !== ''} onClick={() => run(false)}>
        {busy === 'fail' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Cancelled
      </button>
    </div>
  );
}

export function ReconcileMpesaButton({
  transactionId,
  amount,
  members,
  defaultMemberId,
}: {
  transactionId: number;
  amount: number;
  members: { value: number; label: string }[];
  defaultMemberId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memberId, setMemberId] = useState(defaultMemberId ? String(defaultMemberId) : '');
  const [type, setType] = useState('monthly_contribution');
  const [value, setValue] = useState(String(amount));

  async function submit() {
    if (!memberId) {
      toastError('Select the member who paid');
      return;
    }
    setBusy(true);
    const res = await reconcileMpesaTransactionAction(transactionId, Number(memberId), type, num(value) || undefined);
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Reconciled');
      setOpen(false);
      window.location.reload();
    } else toastError(res.error || 'Could not reconcile');
  }

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <Link2 className="h-3.5 w-3.5" /> Reconcile
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Reconcile mobile money transaction" description={`${money(amount)} received`}>
        <div className="space-y-4">
          <Field label="Member" required>
            <Select name="reconcile_member" required defaultValue={memberId} placeholder="Select the member who paid" options={members} onChange={(e) => setMemberId(e.target.value)} />
          </Field>
          <FormGrid cols={2}>
            <Field label="Allocate to" required>
              <Select name="reconcile_type" required defaultValue={type} options={ALLOCATION_TYPES} placeholder="Select destination" onChange={(e) => setType(e.target.value)} />
            </Field>
            <Field label="Amount (KSh)">
              <TextInput name="reconcile_amount" type="number" min="0.01" step="0.01" defaultValue={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          </FormGrid>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Reconcile & allocate
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
