'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { ShieldPlus, Loader2, Plus, Trash2 } from 'lucide-react';
import { Field, FormGrid, Select, TextInput, TextArea, ResultAlert } from './fields';
import { MemberPicker } from './member-picker';
import { createInsuranceAction } from '@/server/actions/insurance';
import type { ActionResult } from '@/server/actions/auth';
import { money } from '@/lib/money';

export default function InsuranceForm({ companies, parishes, members }: { companies: any[]; parishes: any[]; members: any[] }) {
  const [state, action, pending] = useActionState(createInsuranceAction as any, undefined as ActionResult | undefined);
  const [coverage, setCoverage] = useState('100000');
  const [coversSpouse, setCoversSpouse] = useState(false);
  const [coversChildren, setCoversChildren] = useState(false);
  const [coversParents, setCoversParents] = useState(false);
  const [dependents, setDependents] = useState<{ relationship: string; full_name: string; dob: string; id_no: string; coverage_amount: string; is_school_going: boolean }[]>([]);

  const addDependent = () => {
    setDependents([...dependents, { relationship: 'child', full_name: '', dob: '', id_no: '', coverage_amount: '50000', is_school_going: false }]);
  };

  return (
    <form action={action} className="space-y-6">
      <ResultAlert result={state} />
      {state?.ok ? (
        <div className="flex gap-2">
          <Link href="/insurance" className="btn btn-outline btn-sm">Back to insurance list</Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>Create another</button>
        </div>
      ) : null}

      <Field label="Member (Principal - 18-65 years)" required hint="Principal insured person">
        <MemberPicker options={members.map((m) => ({ value: m.id, label: `${m.membership_no} — ${m.full_name} (${parishes.find((p) => p.id === m.parish_id)?.name || 'Parish'})` }))} />
      </Field>

      <FormGrid cols={2}>
        <Field label="Parish" required>
          <Select name="parish_id" required options={parishes.map((p) => ({ value: String(p.id), label: p.name }))} placeholder="Select parish - St Joseph Mukasa Kahawa West / St Peter and Paul Marengeta / St Francis of Asisi Soweto" />
        </Field>
        <Field label="Insurance Company" required>
          <Select name="insurance_company_id" required options={companies.map((c) => ({ value: String(c.id), label: c.name }))} placeholder="Select company - dropdown of 30 insurers" />
        </Field>
      </FormGrid>

      <FormGrid cols={3}>
        <Field label="Coverage Type" required>
          <Select name="coverage_type" required defaultValue="last_respect" options={[
            { value: 'last_respect', label: 'Last Respect (Funeral Last Expense)' },
            { value: 'funeral', label: 'Funeral Cover' },
            { value: 'life', label: 'Life Assurance' },
            { value: 'combined', label: 'Combined Last Respect + Life' },
          ]} />
        </Field>
        <Field label="Coverage Amount (KSh 50k-500k)" required hint="KSh 50,000 to 500,000">
          <Select name="coverage_amount" required defaultValue={coverage} onChange={(e) => setCoverage(e.target.value)} options={[
            { value: '50000', label: 'KSh 50,000' },
            { value: '100000', label: 'KSh 100,000' },
            { value: '150000', label: 'KSh 150,000' },
            { value: '200000', label: 'KSh 200,000' },
            { value: '300000', label: 'KSh 300,000' },
            { value: '500000', label: 'KSh 500,000' },
          ]} />
        </Field>
        <Field label="Premium Amount (KSh)" required>
          <TextInput name="premium_amount" type="number" min="100" step="50" required placeholder="e.g. 500 monthly" />
        </Field>
      </FormGrid>

      <FormGrid cols={3}>
        <Field label="Premium Frequency">
          <Select name="premium_frequency" defaultValue="monthly" options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'semi_annual', label: 'Semi-Annual' },
            { value: 'annual', label: 'Annual' },
            { value: 'single', label: 'Single Premium' },
          ]} />
        </Field>
        <Field label="Start Date"><TextInput name="start_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="Cause Covered">
          <Select name="cause_of_death_covered" defaultValue="illness_and_accident" options={[
            { value: 'illness_and_accident', label: 'Illness and Accident (48h payout)' },
            { value: 'accident_only', label: 'Accident Only' },
            { value: 'all_causes', label: 'All Causes' },
          ]} />
        </Field>
      </FormGrid>

      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        <strong>Eligibility:</strong> Principal 18–65, children 1 month–24 years (25 if school-going), parents/parents-in-law, spouse. Payout within 48 hours. Waiting period 90 days for illness, 0 for accident.
      </div>

      <CardSection title="Beneficiary - Immediate Cash Payout">
        <FormGrid cols={2}>
          <Field label="Beneficiary Name" required><TextInput name="beneficiary_name" required placeholder="Next of kin full name" /></Field>
          <Field label="Relationship" required>
            <Select name="beneficiary_relationship" required defaultValue="spouse" options={[
              { value: 'spouse', label: 'Spouse' },
              { value: 'child', label: 'Child' },
              { value: 'parent', label: 'Parent' },
              { value: 'parent_in_law', label: 'Parent-in-Law' },
              { value: 'next_of_kin', label: 'Next of Kin' },
              { value: 'other', label: 'Other' },
            ]} />
          </Field>
        </FormGrid>
        <FormGrid cols={2}>
          <Field label="Beneficiary Phone"><TextInput name="beneficiary_phone" placeholder="2547..." /></Field>
          <Field label="Beneficiary ID No"><TextInput name="beneficiary_id_no" placeholder="ID number" /></Field>
        </FormGrid>
      </CardSection>

      <CardSection title="Dependent Coverage Options">
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="covers_spouse" checked={coversSpouse} onChange={(e) => setCoversSpouse(e.target.checked)} className="rounded" /> Covers Spouse (18-65)
          </label>
          {coversSpouse && (
            <FormGrid cols={3}>
              <Field label="Spouse Name"><TextInput name="spouse_name" placeholder="Spouse full name" /></Field>
              <Field label="Spouse DOB"><TextInput name="spouse_dob" type="date" /></Field>
              <Field label="Spouse Coverage"><TextInput name="spouse_coverage_amount" type="number" min="10000" max="500000" placeholder="e.g. 100000" /></Field>
            </FormGrid>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="covers_children" checked={coversChildren} onChange={(e) => setCoversChildren(e.target.checked)} className="rounded" /> Covers Children (1 month - 24y, 25 school-going)
          </label>
          {coversChildren && (
            <FormGrid cols={2}>
              <Field label="Number of Children"><TextInput name="children_count" type="number" min="1" max="10" defaultValue="1" /></Field>
              <Field label="Children Coverage Each"><TextInput name="children_coverage_amount" type="number" min="10000" max="500000" placeholder="e.g. 50000" /></Field>
            </FormGrid>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="covers_parents" checked={coversParents} onChange={(e) => setCoversParents(e.target.checked)} className="rounded" /> Covers Parents / Parents-in-Law
          </label>
          {coversParents && (
            <FormGrid cols={2}>
              <Field label="Number of Parents"><TextInput name="parents_count" type="number" min="1" max="4" defaultValue="1" /></Field>
              <Field label="Parents Coverage Each"><TextInput name="parents_coverage_amount" type="number" min="10000" max="500000" placeholder="e.g. 50000" /></Field>
            </FormGrid>
          )}
        </div>
      </CardSection>

      <CardSection title="Additional Dependents List (Optional)">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Add spouse, children, parents with individual coverage. Children 1 month-24y, school-going up to 25y.</p>
          {dependents.map((d, idx) => (
            <div key={idx} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-5">
              <Select name={`dep_${idx}_relationship`} defaultValue={d.relationship} options={[
                { value: 'spouse', label: 'Spouse' },
                { value: 'child', label: 'Child' },
                { value: 'parent', label: 'Parent' },
                { value: 'parent_in_law', label: 'Parent-in-Law' },
                { value: 'other', label: 'Other' },
              ]} />
              <TextInput name={`dep_${idx}_full_name`} placeholder="Full name" required />
              <TextInput name={`dep_${idx}_dob`} type="date" />
              <TextInput name={`dep_${idx}_coverage_amount`} type="number" placeholder="Coverage e.g. 50000" />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name={`dep_${idx}_is_school_going`} /> School</label>
                <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => setDependents(dependents.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></button>
              </div>
              <input type="hidden" name={`dep_${idx}_id_no`} value="" />
            </div>
          ))}
          <input type="hidden" name="dependents_count" value={String(dependents.length)} />
          <button type="button" className="btn btn-outline btn-sm" onClick={addDependent}><Plus className="h-4 w-4" /> Add Dependent</button>
        </div>
      </CardSection>

      <Field label="Notes" span><TextArea name="notes" placeholder="Additional notes about policy, payout within 48 hours, illness & accident coverage" /></Field>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldPlus className="h-4 w-4" />}
          {pending ? 'Saving…' : 'Create Insurance Policy'}
        </button>
        <Link href="/insurance" className="btn btn-ghost">Cancel</Link>
        <span className="text-xs text-slate-500">Coverage {coverage ? money(Number(coverage)) : ''} · Payout 48h · No medical records required</span>
      </div>
    </form>
  );
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-4">
      <h4 className="font-semibold text-navy-900">{title}</h4>
      {children}
    </div>
  );
}
