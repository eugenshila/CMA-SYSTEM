'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Save, UserPlus, Upload, ShieldCheck, Trash2, CheckCircle2, XCircle, KeyRound, Archive,
  Loader2, Camera, ChevronDown, Users,
} from 'lucide-react';
import { SubmitButton, ActionButton, FileInput, PasswordInput, Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, Fieldset, FormGrid, Select, TextInput, TextArea, Checkbox, ResultAlert } from './fields';
import {
  createMemberAction,
  updateMemberAction,
  setMembershipStatusAction,
  approveMemberAction,
  archiveMemberAction,
  uploadMemberDocumentAction,
  verifyDocumentAction,
  deleteDocumentAction,
  createLoginsForMembersAction,
} from '@/server/actions/members';
import { setExemptionAction } from '@/server/actions/contributions';
import type { ActionResult } from '@/server/actions/auth';

export interface OrgOption {
  value: number;
  label: string;
  parish_id?: number | null;
  church_id?: number | null;
}

const DOC_TYPES = [
  { value: 'national_id', label: 'National ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'photo', label: 'Passport photo' },
  { value: 'membership_card', label: 'CMA membership card' },
  { value: 'baptism_certificate', label: 'Baptism certificate' },
  { value: 'marriage_certificate', label: 'Marriage certificate' },
  { value: 'birth_certificate', label: 'Birth certificate' },
  { value: 'payslip', label: 'Payslip' },
  { value: 'bank_statement', label: 'Bank statement' },
  { value: 'title_deed', label: 'Title deed / logbook' },
  { value: 'recommendation', label: 'Recommendation letter' },
  { value: 'other', label: 'Other document' },
];

/* ------------------------------------------------------------------ *
 * MEMBER FORM (create + edit)
 * ------------------------------------------------------------------ */
export function MemberForm({
  mode,
  member,
  parishes,
  churches,
  communities,
  nextMembershipNo,
  canCreateLogin,
  cancelHref,
}: {
  mode: 'create' | 'edit';
  member?: any;
  parishes: OrgOption[];
  churches: OrgOption[];
  communities: OrgOption[];
  nextMembershipNo?: string;
  canCreateLogin?: boolean;
  cancelHref: string;
}) {
  const action = mode === 'create' ? createMemberAction : updateMemberAction;
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as any, null);
  const router = useRouter();
  const [parishId, setParishId] = useState<number | null>(member?.parish_id ?? parishes[0]?.value ?? null);
  const [churchId, setChurchId] = useState<number | null>(member?.church_id ?? null);

  useEffect(() => {
    if (state?.ok) {
      toastSuccess(mode === 'create' ? 'Member registered' : 'Member updated', state.message);
      const id = (state.data as any)?.id || member?.id;
      setTimeout(() => router.push(id ? `/members/${id}` : '/members'), 700);
    } else if (state?.error) {
      toastError('Could not save', state.error);
    }
  }, [state, router, mode, member?.id]);

  const filteredChurches = useMemo(
    () => churches.filter((c) => !parishId || !c.parish_id || c.parish_id === parishId),
    [churches, parishId],
  );
  const filteredSccs = useMemo(
    () => communities.filter((c) => !parishId || !c.parish_id || c.parish_id === parishId),
    [communities, parishId],
  );

  return (
    <form action={formAction} className="space-y-4">
      {mode === 'edit' ? <input type="hidden" name="member_id" value={member?.id} /> : null}
      <ResultAlert result={state} />

      <Fieldset title="Personal details" description="As they appear on the member's national ID or baptism certificate.">
        <FormGrid cols={3}>
          <Field label="Salutation">
            <Select
              name="salutation"
              defaultValue={member?.salutation || 'Mr.'}
              placeholder="Select…"
              options={[
                { value: 'Mr.', label: 'Mr.' },
                { value: 'Dr.', label: 'Dr.' },
                { value: 'Eng.', label: 'Eng.' },
                { value: 'Hon.', label: 'Hon.' },
                { value: 'Fr.', label: 'Fr.' },
                { value: 'Bro.', label: 'Bro.' },
              ]}
            />
          </Field>
          <Field label="First name" required>
            <TextInput name="first_name" required defaultValue={member?.first_name} />
          </Field>
          <Field label="Middle name">
            <TextInput name="middle_name" defaultValue={member?.middle_name} />
          </Field>
          <Field label="Last name / surname" required>
            <TextInput name="last_name" required defaultValue={member?.last_name} />
          </Field>
          <Field label="Gender">
            <Select
              name="gender"
              defaultValue={member?.gender || 'male'}
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </Field>
          <Field label="Date of birth">
            <TextInput name="date_of_birth" type="date" defaultValue={member?.date_of_birth ? String(member.date_of_birth).slice(0, 10) : ''} />
          </Field>
          <Field label="Marital status">
            <Select
              name="marital_status"
              defaultValue={member?.marital_status || 'single'}
              options={[
                { value: 'single', label: 'Single' },
                { value: 'married', label: 'Married' },
                { value: 'widowed', label: 'Widowed' },
                { value: 'separated', label: 'Separated' },
                { value: 'divorced', label: 'Divorced' },
              ]}
            />
          </Field>
          <Field label="Occupation">
            <TextInput name="occupation" defaultValue={member?.occupation} />
          </Field>
          <Field label="Employer / business">
            <TextInput name="employer" defaultValue={member?.employer} />
          </Field>
          <Field label="Baptism date">
            <TextInput name="baptism_date" type="date" defaultValue={member?.baptism_date ? String(member.baptism_date).slice(0, 10) : ''} />
          </Field>
        </FormGrid>
      </Fieldset>

      <Fieldset title="Identification" description="National ID / passport numbers are encrypted at rest (Kenya Data Protection Act, 2019).">
        <FormGrid cols={3}>
          <Field label="Document type">
            <Select
              name="document_type"
              defaultValue={member?.passport_enc ? 'passport' : 'national_id'}
              options={[
                { value: 'national_id', label: 'National ID' },
                { value: 'passport', label: 'Passport' },
              ]}
            />
          </Field>
          <Field label="ID / passport number" hint={member?.national_id_last4 ? `Stored as ••••${member.national_id_last4}` : undefined}>
            <TextInput name="national_id" placeholder={member?.national_id_last4 ? 'Leave blank to keep current' : 'e.g. 12345678'} />
          </Field>
          <Field label="KRA PIN">
            <TextInput name="kra_pin" defaultValue={member?.kra_pin} />
          </Field>
        </FormGrid>
      </Fieldset>

      <Fieldset title="Contact details" description="The phone number is the primary M-Pesa and login identifier.">
        <FormGrid cols={3}>
          <Field label="Mobile phone (M-Pesa)" required>
            <TextInput name="phone" required defaultValue={member?.phone} placeholder="0712 345 678" autoComplete="tel" />
          </Field>
          <Field label="Alternative phone">
            <TextInput name="alt_phone" defaultValue={member?.alt_phone} />
          </Field>
          <Field label="Email address">
            <TextInput name="email" type="email" defaultValue={member?.email} />
          </Field>
          <Field label="Residential area / estate" span>
            <TextInput name="residential_area" defaultValue={member?.residential_area} />
          </Field>
        </FormGrid>
      </Fieldset>

      <Fieldset title="Church structure" description="Country → archdiocese/diocese → deanery → parish → church/outstation → SCC → member.">
        <FormGrid cols={3}>
          <Field label="Parish" required>
            <Select
              name="parish_id"
              required
              options={parishes}
              defaultValue={parishId}
              onChange={(e) => {
                setParishId(Number(e.target.value) || null);
                setChurchId(null);
              }}
            />
          </Field>
          <Field label="Church / outstation">
            <Select
              name="church_id"
              options={filteredChurches}
              defaultValue={churchId}
              placeholder="Select church"
              onChange={(e) => setChurchId(Number(e.target.value) || null)}
            />
          </Field>
          <Field label="Small Christian Community (SCC)">
            <Select
              name="scc_id"
              options={filteredSccs}
              defaultValue={member?.scc_id ?? null}
              placeholder="Select SCC"
            />
          </Field>
        </FormGrid>
      </Fieldset>

      <Fieldset title="Membership" description="CMA number, joining date and membership class.">
        <FormGrid cols={3}>
          <Field label="CMA membership number" hint={mode === 'create' && nextMembershipNo ? `Next available: ${nextMembershipNo}` : undefined}>
            <TextInput name="membership_no" defaultValue={member?.membership_no || nextMembershipNo || ''} placeholder="Auto-generated if blank" />
          </Field>
          <Field label="Date joined" required>
            <TextInput
              name="date_joined"
              type="date"
              required
              defaultValue={member?.date_joined ? String(member.date_joined).slice(0, 10) : new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="Membership type">
            <Select
              name="membership_type"
              defaultValue={member?.membership_type || 'full'}
              options={[
                { value: 'full', label: 'Full member' },
                { value: 'associate', label: 'Associate member' },
                { value: 'honorary', label: 'Honorary member' },
              ]}
            />
          </Field>
          <Field label="Membership status">
            <Select
              name="membership_status"
              defaultValue={member?.membership_status || 'active'}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'pending', label: 'Pending approval' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'suspended', label: 'Suspended' },
                { value: 'transferred', label: 'Transferred' },
                { value: 'resigned', label: 'Resigned' },
                { value: 'deceased', label: 'Deceased' },
              ]}
            />
          </Field>
          <Field label="Exempt from monthly contribution" span>
            <div className="grid gap-2 sm:grid-cols-2">
              <Checkbox name="exempt_monthly" label="Exempt this member" defaultChecked={Boolean(member?.exempt_monthly)} hint="E.g. elderly, sick, or clergy" />
              <TextInput name="exemption_reason" placeholder="Reason for exemption" defaultValue={member?.exemption_reason} />
            </div>
          </Field>
        </FormGrid>
      </Fieldset>

      <Fieldset title="Next of kin & emergency contact" description="Used for welfare, hospitalisation and bereavement response.">
        <FormGrid cols={3}>
          <Field label="Next of kin (name)">
            <TextInput name="next_of_kin" defaultValue={member?.next_of_kin} />
          </Field>
          <Field label="Relationship">
            <TextInput name="next_of_kin_relation" defaultValue={member?.next_of_kin_relation} placeholder="Spouse, parent, sibling…" />
          </Field>
          <Field label="Next of kin phone">
            <TextInput name="next_of_kin_phone" defaultValue={member?.next_of_kin_phone} />
          </Field>
          <Field label="Emergency contact (name)">
            <TextInput name="emergency_contact" defaultValue={member?.emergency_contact} />
          </Field>
          <Field label="Emergency relationship">
            <TextInput name="emergency_contact_rel" defaultValue={member?.emergency_contact_rel} />
          </Field>
          <Field label="Emergency phone">
            <TextInput name="emergency_contact_phone" defaultValue={member?.emergency_contact_phone} />
          </Field>
          <Field label="Notes" span>
            <TextArea name="notes" defaultValue={member?.notes} rows={2} placeholder="Anything the committee should know (talents, ministries, health concerns…)" />
          </Field>
        </FormGrid>
      </Fieldset>

      <Fieldset title="Photo & documents" description="Optional — PDF, images or Word files up to 10 MB each.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FileInput name="photo" label="Passport photo" accept="image/*" hint="JPG or PNG, square works best" />
          <div className="space-y-3">
            <FileInput name="id_document" label="National ID / passport copy" accept="image/*,.pdf" />
            <FileInput name="membership_card" label="CMA membership card" accept="image/*,.pdf" />
            <FileInput name="other_document" label="Other supporting documents" accept="image/*,.pdf,.doc,.docx" multiple />
          </div>
        </div>
      </Fieldset>

      {mode === 'create' && canCreateLogin ? (
        <Fieldset title="Online account" description="Create a login so the member can view their dashboard, pay via M-Pesa and apply for loans.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox
              name="create_login"
              label="Create member login account"
              hint="Role: Member. They sign in with phone, email or CMA number."
              defaultChecked={false}
            />
            <Field label="Temporary password" hint="Leave blank to auto-generate a strong password.">
              <TextInput name="temp_password" placeholder="e.g. Cma@2026" />
            </Field>
          </div>
        </Fieldset>
      ) : null}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur">
        <Link href={cancelHref} className="btn-outline">Cancel</Link>
        <SubmitButton pendingText="Saving…" icon={mode === 'create' ? <UserPlus className="h-4 w-4" /> : <Save className="h-4 w-4" />}>
          {mode === 'create' ? 'Register member' : 'Save changes'}
        </SubmitButton>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * MEMBER ACTIONS (status, approve, archive, exemption)
 * ------------------------------------------------------------------ */
export function MemberActionButtons({
  memberId,
  status,
  exempt,
  permissions,
}: {
  memberId: number;
  status: string;
  exempt: boolean;
  permissions: { update: boolean; approve: boolean; archive: boolean };
}) {
  const router = useRouter();
  const [openStatus, setOpenStatus] = useState(false);
  const [openArchive, setOpenArchive] = useState(false);
  const [openExempt, setOpenExempt] = useState(false);
  const [newStatus, setNewStatus] = useState(status);
  const [statusReason, setStatusReason] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [exemptReason, setExemptReason] = useState('');
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toastSuccess('Done', res.message);
        router.refresh();
      } else {
        toastError('Failed', res.error);
      }
      setOpenStatus(false);
      setOpenArchive(false);
      setOpenExempt(false);
    });

  const STATUSES = ['active', 'inactive', 'suspended', 'transferred', 'resigned', 'deceased'];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {permissions.approve && status === 'pending' ? (
          <ActionButton variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} action={() => run(() => approveMemberAction(memberId))}>
            Approve member
          </ActionButton>
        ) : null}
        {permissions.update ? (
          <button type="button" className="btn-outline btn-sm" onClick={() => { setNewStatus(status); setStatusReason(''); setOpenStatus(true); }}>
            <Users className="h-3.5 w-3.5" /> Change status
          </button>
        ) : null}
        {permissions.update ? (
          <button type="button" className="btn-outline btn-sm" onClick={() => { setExemptReason(''); setOpenExempt(true); }}>
            <ShieldCheck className="h-3.5 w-3.5" /> {exempt ? 'Remove exemption' : 'Exempt contributions'}
          </button>
        ) : null}
        {permissions.archive && status !== 'deceased' ? (
          <button type="button" className="btn-danger btn-sm" onClick={() => { setArchiveReason(''); setOpenArchive(true); }}>
            <Archive className="h-3.5 w-3.5" /> Archive
          </button>
        ) : null}
      </div>

      <Modal
        open={openStatus}
        onClose={() => setOpenStatus(false)}
        title="Change membership status"
        size="sm"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpenStatus(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() => run(() => setMembershipStatusAction(memberId, newStatus, statusReason || undefined))}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Update status
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="New status">
            <select className="select" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              {STATUSES.map((st) => (
                <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Reason" hint="Stored in the audit trail.">
            <textarea
              className="input"
              rows={2}
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="e.g. Transferred to St. Peters Parish, Ruiru"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={openArchive}
        onClose={() => setOpenArchive(false)}
        title="Archive member record"
        size="sm"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpenArchive(false)}>Cancel</button>
            <button className="btn-danger" disabled={pending || archiveReason.trim().length < 4} onClick={() => run(() => archiveMemberAction(memberId, archiveReason))}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Archive member
            </button>
          </>
        }
      >
        <p className="text-xs text-slate-600">
          Archiving is a <strong>soft delete</strong>: the member disappears from active lists, but every financial
          transaction, receipt and audit entry is preserved permanently.
        </p>
        <div className="mt-3">
          <Field label="Reason" required>
            <textarea
              className="input"
              rows={2}
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="Reason for archiving"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={openExempt}
        onClose={() => setOpenExempt(false)}
        title={exempt ? 'Remove contribution exemption' : 'Exempt from monthly contributions'}
        size="sm"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpenExempt(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={pending || (!exempt && exemptReason.trim().length < 3)}
              onClick={() => run(() => setExemptionAction(memberId, !exempt, exemptReason || undefined))}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{' '}
              {exempt ? 'Remove exemption' : 'Grant exemption'}
            </button>
          </>
        }
      >
        <Field label="Reason" required={!exempt} hint="Applies to all future monthly contribution bills.">
          <textarea
            className="input"
            rows={2}
            value={exemptReason}
            onChange={(e) => setExemptReason(e.target.value)}
            placeholder="e.g. Elderly member, chronically ill, clergy"
          />
        </Field>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * DOCUMENT UPLOAD
 * ------------------------------------------------------------------ */
export function DocumentUploadForm({ memberId, docTypes = DOC_TYPES }: { memberId: number; docTypes?: { value: string; label: string }[] }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(uploadMemberDocumentAction as any, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      toastSuccess('Uploaded', state.message);
      router.refresh();
    } else if (state?.error) toastError('Upload failed', state.error);
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <input type="hidden" name="member_id" value={memberId} />
      <p className="text-xs font-bold uppercase tracking-wide text-navy-800">Upload a document</p>
      <ResultAlert result={state} />
      <FormGrid cols={2}>
        <Field label="Document type">
          <Select name="doc_type" options={docTypes} defaultValue="national_id" />
        </Field>
        <Field label="Title">
          <TextInput name="title" placeholder="e.g. National ID — front & back" />
        </Field>
      </FormGrid>
      <FileInput name="file" label="File" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" required />
      <SubmitButton className="btn-block" pendingText="Uploading…" icon={<Upload className="h-4 w-4" />}>Upload document</SubmitButton>
    </form>
  );
}

export function DocumentRowActions({ documentId, verified, canVerify, canDelete }: { documentId: number; verified: boolean; canVerify: boolean; canDelete: boolean }) {
  const router = useRouter();
  const act = async (fn: () => Promise<ActionResult>) => {
    const res = await fn();
    if (res.ok) { toastSuccess('Done', res.message); router.refresh(); } else toastError('Failed', res.error);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {canVerify ? (
        <ActionButton
          variant={verified ? 'outline' : 'success'}
          icon={verified ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          action={() => act(() => verifyDocumentAction(documentId, !verified))}
        >
          {verified ? 'Unverify' : 'Verify'}
        </ActionButton>
      ) : null}
      {canDelete ? (
        <ActionButton variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} confirm="Remove this document? The record stays in the audit trail." action={() => act(() => deleteDocumentAction(documentId))}>
          Remove
        </ActionButton>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * BULK LOGIN CREATION
 * ------------------------------------------------------------------ */
export function BulkLoginButton({ members }: { members: { id: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [password, setPassword] = useState('Cma@Member2026');
  const [pending, start] = useTransition();
  const router = useRouter();

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <button type="button" className="btn-outline btn-sm" onClick={() => setOpen(true)}>
        <KeyRound className="h-3.5 w-3.5" /> Create logins ({members.length})
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create member login accounts"
        description="Select the members who should receive an online account. They sign in with their phone number, email or CMA number."
        size="lg"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={pending || !selected.length || password.length < 8}
              onClick={() =>
                start(async () => {
                  const res = await createLoginsForMembersAction(selected, password);
                  if (res.ok) { toastSuccess('Accounts created', res.message); setOpen(false); router.refresh(); }
                  else toastError('Failed', res.error);
                })
              }
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Create {selected.length || ''} account(s)
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Temporary password" required hint="Members are forced to change it at first sign-in.">
            <TextInput name="bulk_password" defaultValue={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-600">{selected.length} selected</p>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(members.map((m) => m.id))}>Select all</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected([])}>Clear</button>
            </div>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto scrollbar-thin">
            {members.map((m) => (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-xs hover:border-navy-300">
                  <input type="checkbox" className="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
                  <span className="truncate font-medium text-slate-700">{m.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </>
  );
}

export { DOC_TYPES, PasswordInput, ChevronDown };
