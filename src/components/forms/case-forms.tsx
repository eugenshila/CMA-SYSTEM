'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Heart, Flower, Gem, Hammer, Wallet, BellRing, CheckCircle2, RotateCcw, Loader2, Users } from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, TextArea, ResultAlert } from './fields';
import { MemberPicker } from './member-picker';
import {
  createCaseAction,
  disburseCaseAction,
  remindNonPayersAction,
  setCaseStatusAction,
} from '@/server/actions/cases';
import { money, num } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { CaseType } from '@/lib/contributions';
import { CASE_META } from '@/lib/cases';
import type { ActionResult } from '@/server/actions/auth';

const ICONS: Record<CaseType, any> = { welfare: Heart, funeral: Flower, wedding: Gem, project: Hammer };

export interface CaseFormOptions {
  members: { value: number; label: string }[];
  categories: { value: string; label: string }[];
  churches: { value: number; label: string }[];
  sccs: { value: number; label: string }[];
  relationships: { value: string; label: string }[];
}

/* ------------------------------------------------------------------ *
 * Create form — one component, fields adapt to the case type
 * ------------------------------------------------------------------ */
export function CaseForm({ type, options }: { type: CaseType; options: CaseFormOptions }) {
  const Icon = ICONS[type];
  const meta = CASE_META[type];
  const bound = useMemo(() => createCaseAction.bind(null, type), [type]);
  const [state, action, pending] = useActionState(bound as any, undefined as ActionResult | undefined);
  const [scope, setScope] = useState('parish');
  const [perMember, setPerMember] = useState('');
  const memberCount = options.members.length;
  const estimate = perMember ? Math.round(num(perMember) * memberCount) : 0;

  return (
    <form action={action} className="space-y-5">
      <ResultAlert result={state} />
      {state?.ok ? (
        <div className="flex flex-wrap gap-2">
          <Link href={meta.route} className="btn btn-outline btn-sm">Back to {meta.plural}</Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>Create another</button>
        </div>
      ) : null}

      {type !== 'project' ? (
        <Field label="CMA member concerned" required hint="The member the case is opened for.">
          <MemberPicker options={options.members} />
        </Field>
      ) : null}

      {type === 'welfare' ? (
        <>
          <FormGrid cols={2}>
            <Field label="Category" required>
              <Select name="category" required defaultValue="sickness" options={options.categories} placeholder="Select a category" />
            </Field>
            <Field label="Opening date" required>
              <TextInput name="opening_date" type="date" required defaultValue={isoDate(new Date())} />
            </Field>
          </FormGrid>
          <Field label="Nature of assistance" required span>
            <TextArea name="nature_of_assistance" required placeholder="e.g. Member admitted for malaria treatment and needs financial support" />
          </Field>
          <FormGrid cols={3}>
            <Field label="Hospital"><TextInput name="hospital" placeholder="Facility name" /></Field>
            <Field label="Ward / room"><TextInput name="ward" /></Field>
            <Field label="Admission date"><TextInput name="admission_date" type="date" /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Beneficiary name" hint="Defaults to the member when left blank"><TextInput name="beneficiary_name" /></Field>
            <Field label="Relationship"><TextInput name="beneficiary_relationship" placeholder="Member, Spouse, Child…" /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Target amount (KSh)" hint="Leave blank to calculate from amount per member"><TextInput name="target_amount" type="number" min="0" step="0.01" /></Field>
          </FormGrid>
        </>
      ) : null}

      {type === 'funeral' ? (
        <>
          <Field label="Name of the deceased" required span><TextInput name="deceased_name" required /></Field>
          <FormGrid cols={2}>
            <Field label="Relationship to the member" required>
              <Select name="relationship" required defaultValue="member" options={options.relationships} placeholder="Select relationship" />
            </Field>
            <Field label="If other, specify"><TextInput name="relationship_other" /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Date of death" required><TextInput name="date_of_death" type="date" required /></Field>
            <Field label="Funeral date"><TextInput name="funeral_date" type="date" /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Mortuary"><TextInput name="mortuary" /></Field>
            <Field label="Burial place"><TextInput name="burial_place" /></Field>
          </FormGrid>
          <Field label="In-kind support" hint="Non-cash support offered by the SCC / church" span>
            <TextArea name="in_kind_support" placeholder="e.g. SCC provides tent, chairs and transport" />
          </Field>
        </>
      ) : null}

      {type === 'wedding' ? (
        <>
          <FormGrid cols={2}>
            <Field label="Wedding date" required><TextInput name="wedding_date" type="date" required /></Field>
            <Field label="Spouse name"><TextInput name="spouse_name" /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Venue"><TextInput name="venue" placeholder="Church / hall" /></Field>
            <Field label="Target amount (KSh)" hint="Leave blank to calculate from amount per member"><TextInput name="target_amount" type="number" min="0" step="0.01" /></Field>
          </FormGrid>
        </>
      ) : null}

      {type === 'project' ? (
        <>
          <Field label="Project name" required span><TextInput name="name" required placeholder="e.g. CMA Day 2026" /></Field>
          <FormGrid cols={2}>
            <Field label="Category" required>
              <Select name="category" required options={options.categories} placeholder="Select a category" />
            </Field>
            <Field label="Start date" required><TextInput name="start_date" type="date" required defaultValue={isoDate(new Date())} /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Event / target date"><TextInput name="event_date" type="date" /></Field>
            <Field label="Committee"><TextInput name="committee" placeholder="Chairperson and members" /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Target amount (KSh)" hint="Leave blank to calculate from amount per member"><TextInput name="target_amount" type="number" min="0" step="0.01" /></Field>
          </FormGrid>
          <Field label="Description" span><TextArea name="description" /></Field>
        </>
      ) : null}

      <FormGrid cols={2}>
        <Field
          label="Amount per member (KSh)"
          required
          hint={estimate > 0 ? `≈ ${money(estimate)} across ${memberCount} members in scope` : undefined}
        >
          <TextInput name="amount_per_member" type="number" min="0" step="0.01" required onChange={(e) => setPerMember(e.target.value)} />
        </Field>
        <Field label="Contribution deadline"><TextInput name="deadline" type="date" /></Field>
      </FormGrid>

      <FormGrid cols={3}>
        <Field label="Collection scope" required>
          <Select
            name="scope_type"
            required
            defaultValue={scope}
            placeholder="Select scope"
            onChange={(e) => setScope(e.target.value)}
            options={[
              { value: 'parish', label: 'Whole parish' },
              { value: 'church', label: 'Church / outstation' },
              { value: 'scc', label: 'SCC only' },
              { value: 'all', label: 'All members' },
            ]}
          />
        </Field>
        {scope === 'church' ? (
          <Field label="Church" required><Select name="church_id" required options={options.churches} placeholder="Select church" /></Field>
        ) : null}
        {scope === 'scc' ? (
          <Field label="Small Christian Community" required><Select name="scc_id" required options={options.sccs} placeholder="Select SCC" /></Field>
        ) : null}
      </FormGrid>

      <Field label="Notes" span><TextArea name="notes" placeholder="Additional information for the records" /></Field>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
          {pending ? 'Saving…' : `Create ${meta.label.toLowerCase()}`}
        </button>
        <Link href={meta.route} className="btn btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Case actions: disburse, remind non-payers, close / re-open
 * ------------------------------------------------------------------ */
export function CaseActions({
  type,
  id,
  status,
  available,
  outstanding,
  canDisburse,
  canApprove,
  nonPayers,
  caseRef,
}: {
  type: CaseType;
  id: number;
  status: string;
  available: number;
  outstanding: number;
  canDisburse: boolean;
  canApprove: boolean;
  nonPayers: number;
  caseRef: string;
}) {
  const [open, setOpen] = useState<'' | 'disburse' | 'remind' | 'close'>('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<ActionResult>) {
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        toastSuccess(res.message || 'Done');
        setOpen('');
      } else {
        toastError(res.error || 'Action failed');
      }
    } catch (e: any) {
      toastError(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canDisburse && status !== 'disbursed' && status !== 'completed' ? (
          <button
            type="button"
            className="btn btn-gold btn-sm"
            disabled={available <= 0}
            onClick={() => {
              setAmount(available.toFixed(2));
              setOpen('disburse');
            }}
          >
            <Wallet className="h-4 w-4" /> Disburse funds
          </button>
        ) : null}
        {canApprove && nonPayers > 0 ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen('remind')}>
            <BellRing className="h-4 w-4" /> Remind {nonPayers} non-payer{nonPayers === 1 ? '' : 's'}
          </button>
        ) : null}
        {canApprove && (status === 'open' || status === 'in_progress') ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen('close')}>
            <CheckCircle2 className="h-4 w-4" /> Close record
          </button>
        ) : null}
        {canApprove && (status === 'closed' || status === 'disbursed' || status === 'completed') ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => setCaseStatusAction(type, id, 'open'))}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Re-open
          </button>
        ) : null}
      </div>

      <Modal
        open={open === 'disburse'}
        onClose={() => setOpen('')}
        title={`Disburse funds — ${caseRef}`}
        description="Disbursement reduces the available balance and is written to the audit trail."
      >
        <div className="space-y-4">
          <p className="rounded-lg bg-navy-50 p-3 text-sm text-navy-800">
            Available for disbursement: <strong>{money(available)}</strong>
            {outstanding > 0 ? <> · still outstanding from members: <strong>{money(outstanding)}</strong></> : null}
          </p>
          <Field label="Amount (KSh)" required>
            <TextInput name="disburse_amount" type="number" min="0.01" step="0.01" max={available} required onChange={(e) => setAmount(e.target.value)} defaultValue={available ? available.toFixed(2) : ''} />
          </Field>
          <Field label="Payment reference" hint="M-Pesa code, cheque number or bank reference">
            <TextInput name="disburse_reference" onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Note"><TextArea name="disburse_note" placeholder="Received by / purpose" onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={busy || !(num(amount) > 0)}
              onClick={() => run(() => disburseCaseAction(type, id, num(amount), reference || undefined, notes || undefined))}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Disburse
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen('')}>Cancel</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={open === 'remind'}
        onClose={() => setOpen('')}
        title="Remind members who have not contributed"
        description="Members in scope who are still below the requested amount."
      >
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-navy-700" />
            <span>
              <strong>{nonPayers}</strong> member{nonPayers === 1 ? '' : 's'} will receive an in-system notification about {caseRef}
              (plus SMS / email where those channels are configured).
            </span>
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => run(() => remindNonPayersAction(type, id))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Send reminders
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen('')}>Cancel</button>
          </div>
        </div>
      </Modal>

      <Modal open={open === 'close'} onClose={() => setOpen('')} title={`Close ${caseRef}`}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Money already collected stays on record. Closing stops further contributions and marks the record complete — you can re-open it later if needed.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => run(() => setCaseStatusAction(type, id, 'closed'))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Close record
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen('')}>Cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
