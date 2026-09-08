'use client';

import { useState } from 'react';
import { Loader2, Wallet, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, TextInput, TextArea } from './fields';
import { fileInsuranceClaimAction, updateInsuranceStatusAction } from '@/server/actions/insurance';

export default function InsuranceActions({ policy, canApprove, canUpdate }: { policy: any; canApprove: boolean; canUpdate: boolean }) {
  const [open, setOpen] = useState<'' | 'claim' | 'status'>('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ date_of_death: '', claim_reference: '', notes: '', status: policy.status });

  async function run(fn: () => Promise<any>) {
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        toastSuccess(res.message || 'Done');
        setOpen('');
        window.location.reload();
      } else toastError(res.error || 'Failed');
    } catch (e: any) {
      toastError(e?.message || 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canApprove && policy.status === 'active' ? (
          <button type="button" className="btn btn-gold btn-sm" onClick={() => setOpen('claim')}>
            <Wallet className="h-4 w-4" /> File Claim (48h payout)
          </button>
        ) : null}
        {canUpdate ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen('status')}>
            <Clock className="h-4 w-4" /> Update Status
          </button>
        ) : null}
      </div>

      <Modal open={open === 'claim'} onClose={() => setOpen('')} title={`File Claim — ${policy.policy_no}`} description="Immediate cash payout to beneficiary within 48 hours for illness & accident.">
        <div className="space-y-4">
          <Field label="Date of Death" required><TextInput type="date" required value={form.date_of_death} onChange={(e) => setForm({ ...form, date_of_death: e.target.value })} /></Field>
          <Field label="Claim Reference"><TextInput value={form.claim_reference} onChange={(e) => setForm({ ...form, claim_reference: e.target.value })} placeholder="e.g. CLM/2026/001" /></Field>
          <Field label="Notes"><TextArea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Cause: illness / accident, documents submitted" /></Field>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy || !form.date_of_death} onClick={() => run(() => fileInsuranceClaimAction(policy.id, { date_of_death: form.date_of_death, claim_reference: form.claim_reference, notes: form.notes }))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} File Claim
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen('')}>Cancel</button>
          </div>
          <p className="text-xs text-slate-500">No medical records required beyond death certificate. Payout within 48 hours.</p>
        </div>
      </Modal>

      <Modal open={open === 'status'} onClose={() => setOpen('')} title={`Update Status — ${policy.policy_no}`}>
        <div className="space-y-4">
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="lapsed">Lapsed</option>
              <option value="suspended">Suspended</option>
              <option value="claimed">Claimed</option>
              <option value="matured">Matured</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </Field>
          <Field label="Notes"><TextArea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => run(() => updateInsuranceStatusAction(policy.id, form.status, { notes: form.notes }))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Update
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen('')}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
