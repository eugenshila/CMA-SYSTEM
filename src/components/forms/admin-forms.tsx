'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  Loader2, UserPlus, Pencil, KeyRound, Trash2, ShieldCheck, Ban, DatabaseBackup,
  RotateCcw, MoonStar, Building2, Plus, Power,
} from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, TextArea, Checkbox, ResultAlert } from './fields';
import { MemberPicker, type PickerOption } from './member-picker';
import {
  saveUserAction, resetUserPasswordAction, setUserStatusAction, deleteUserAction,
  saveOrgEntityAction, deactivateOrgEntityAction, createBackupAction, restoreBackupAction,
  runNightlyJobsAction, purgeAuditLogsAction,
} from '@/server/actions/admin';
import type { ActionResult } from '@/server/actions/auth';

export type RoleOption = { key: string; name: string };
export type ParishOption = { value: number; label: string };

const USER_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'locked', label: 'Locked' },
  { value: 'disabled', label: 'Disabled' },
];

/* ------------------------------------------------------------------ *
 * USER ACCOUNT FORM
 * ------------------------------------------------------------------ */
export function UserForm({
  roles, parishes, members, record, onClose,
}: {
  roles: RoleOption[];
  parishes: ParishOption[];
  members: PickerOption[];
  record?: any;
  onClose?: () => void;
}) {
  const [state, action, pending] = useActionState(saveUserAction as any, undefined as ActionResult | undefined);
  const [tempPw, setTempPw] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (state?.ok) {
      if (state.data?.tempPassword) setTempPw(state.data.tempPassword);
      else if (onClose) onClose();
    }
  }, [state, onClose]);

  const roleOptions = roles.map((r) => ({ value: r.key, label: r.name }));

  if (tempPw) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Account created</p>
          <p className="mt-1 text-sm text-emerald-800">Share this temporary password securely. The user must change it at first sign-in.</p>
          <p className="mt-3 select-all rounded-lg bg-white px-3 py-2 font-mono text-lg font-bold text-navy-900">{tempPw}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => onClose?.()}>Done</button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      {record?.id && <input type="hidden" name="id" value={record.id} />}
      <FormGrid cols={2}>
        <Field label="Full name" required><TextInput name="name" required defaultValue={record?.name} placeholder="e.g. John Smith" /></Field>
        <Field label="Role" required>
          <Select name="role_key" required defaultValue={record?.role_key || 'member'} options={roleOptions} placeholder="Select role" />
        </Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Email"><TextInput name="email" type="email" defaultValue={record?.email} placeholder="name@parish.or.ke" /></Field>
        <Field label="Phone"><TextInput name="phone" defaultValue={record?.phone} placeholder="2547…" /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Login ID" hint="Optional staff number, e.g. TRES001"><TextInput name="login_id" defaultValue={record?.login_id} /></Field>
        <Field label="Status">
          <Select name="status" defaultValue={record?.status || 'active'} options={USER_STATUSES} />
        </Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Data scope — parish" hint="Limit what this user can see">
          <Select name="scope_parish_id" defaultValue={record?.scope_parish_id ?? ''} options={[{ value: '', label: 'All parishes (no restriction)' }, ...parishes]} />
        </Field>
        <Field label="Linked member profile" hint="Optional — connects the login to a member record">
          <MemberPicker name="member_id" options={members} defaultValue={record?.member_id ?? null} />
        </Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label={record?.id ? 'New password' : 'Password'} hint={record?.id ? 'Leave blank to keep the current password' : 'Leave blank to auto-generate a temporary password'}>
          <TextInput name="password" type="text" placeholder={record?.id ? '••••••••' : 'Auto-generate'} />
        </Field>
        <div className="flex items-end pb-1">
          <Checkbox name="must_change_password" label="Require password change at next sign-in" defaultChecked={record?.must_change_password ?? !record?.id} />
        </div>
      </FormGrid>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : record?.id ? <Pencil className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
        {record?.id ? 'Save changes' : 'Create account'}
      </button>
    </form>
  );
}

export function NewUserButton({ roles, parishes, members }: { roles: RoleOption[]; parishes: ParishOption[]; members: PickerOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> New user
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create a user account" description="Grant a member or officer access to the system with a specific role and data scope.">
        <UserForm roles={roles} parishes={parishes} members={members} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function EditUserButton({ roles, parishes, members, record }: { roles: RoleOption[]; parishes: ParishOption[]; members: PickerOption[]; record: any }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" title="Edit account" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Edit ${record.name}`} description="Update the account details, role, status or data scope.">
        <UserForm roles={roles} parishes={parishes} members={members} record={record} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function UserStatusSelect({ id, status, disabled }: { id: number; status: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (disabled) return <span className="text-xs text-slate-400">—</span>;
  return (
    <select
      className="input !h-8 !py-1 text-xs"
      defaultValue={status}
      disabled={busy}
      onChange={async (e) => {
        const next = e.target.value as any;
        if (next === status) return;
        setBusy(true);
        const res = await setUserStatusAction(id, next);
        setBusy(false);
        if (res.ok) { toastSuccess(res.message || 'Status updated'); window.location.reload(); }
        else { toastError(res.error || 'Could not change status'); e.target.value = status; }
      }}
    >
      {USER_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  );
}

export function ResetPasswordButton({ id, name }: { id: number; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      title="Reset password"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Reset the password for ${name}? A temporary password will be generated and they must change it at next sign-in.`)) return;
        setBusy(true);
        const res = await resetUserPasswordAction(id);
        setBusy(false);
        if (res.ok) {
          const pw = res.data?.tempPassword;
          if (pw) window.alert(`Temporary password for ${name}:\n\n${pw}\n\nShare it securely — it is shown only once.`);
          toastSuccess('Password reset');
        } else toastError(res.error || 'Could not reset password');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
    </button>
  );
}

export function DeleteUserButton({ id, name, disabled }: { id: number; name: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (disabled) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm text-red-500 hover:bg-red-50"
      title="Remove account (soft delete)"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Remove the account for ${name}? The user will lose access. Financial records are never deleted.`)) return;
        setBusy(true);
        const res = await deleteUserAction(id);
        setBusy(false);
        if (res.ok) { toastSuccess(res.message || 'Account removed'); window.location.reload(); }
        else toastError(res.error || 'Could not remove account');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * ORGANISATIONAL HIERARCHY
 * ------------------------------------------------------------------ */
export const ORG_ENTITY_LABELS: Record<string, string> = {
  dioceses: 'Diocese / Archdiocese',
  deaneries: 'Deanery',
  parishes: 'Parish',
  churches: 'Church / Outstation',
  small_christian_communities: 'Small Christian Community',
};

type OrgField = { name: string; label: string; kind: 'text' | 'textarea' | 'select' | 'checkbox'; optionsFrom?: string; options?: { value: string; label: string }[] };

const ORG_FIELDS: Record<string, OrgField[]> = {
  dioceses: [
    { name: 'name', label: 'Name', kind: 'text' },
    { name: 'code', label: 'Code', kind: 'text' },
    { name: 'type', label: 'Type', kind: 'select', options: [{ value: 'diocese', label: 'Diocese' }, { value: 'archdiocese', label: 'Archdiocese' }] },
    { name: 'country_id', label: 'Country', kind: 'select', optionsFrom: 'countries' },
    { name: 'bishop', label: 'Bishop / Archbishop', kind: 'text' },
    { name: 'active', label: 'Active', kind: 'checkbox' },
  ],
  deaneries: [
    { name: 'name', label: 'Name', kind: 'text' },
    { name: 'code', label: 'Code', kind: 'text' },
    { name: 'diocese_id', label: 'Diocese', kind: 'select', optionsFrom: 'dioceses' },
    { name: 'active', label: 'Active', kind: 'checkbox' },
  ],
  parishes: [
    { name: 'name', label: 'Name', kind: 'text' },
    { name: 'code', label: 'Code', kind: 'text' },
    { name: 'deanery_id', label: 'Deanery', kind: 'select', optionsFrom: 'deaneries' },
    { name: 'diocese_id', label: 'Diocese', kind: 'select', optionsFrom: 'dioceses' },
    { name: 'parish_priest', label: 'Parish priest', kind: 'text' },
    { name: 'cma_chaplain', label: 'CMA chaplain', kind: 'text' },
    { name: 'phone', label: 'Phone', kind: 'text' },
    { name: 'email', label: 'Email', kind: 'text' },
    { name: 'address', label: 'Address', kind: 'textarea' },
    { name: 'active', label: 'Active', kind: 'checkbox' },
  ],
  churches: [
    { name: 'name', label: 'Name', kind: 'text' },
    { name: 'code', label: 'Code', kind: 'text' },
    { name: 'parish_id', label: 'Parish', kind: 'select', optionsFrom: 'parishes' },
    { name: 'type', label: 'Type', kind: 'select', options: [{ value: 'church', label: 'Church' }, { value: 'outstation', label: 'Outstation' }] },
    { name: 'location', label: 'Location', kind: 'text' },
    { name: 'active', label: 'Active', kind: 'checkbox' },
  ],
  small_christian_communities: [
    { name: 'name', label: 'Name', kind: 'text' },
    { name: 'code', label: 'Code', kind: 'text' },
    { name: 'parish_id', label: 'Parish', kind: 'select', optionsFrom: 'parishes' },
    { name: 'church_id', label: 'Church / Outstation', kind: 'select', optionsFrom: 'churches' },
    { name: 'leader_name', label: 'Leader', kind: 'text' },
    { name: 'active', label: 'Active', kind: 'checkbox' },
  ],
};

export function OrgEntityForm({
  entity, parents, record, onClose,
}: {
  entity: string;
  parents: Record<string, { value: number | string; label: string }[]>;
  record?: any;
  onClose?: () => void;
}) {
  const [state, action, pending] = useActionState(saveOrgEntityAction as any, undefined as ActionResult | undefined);
  useEffect(() => { if (state?.ok && onClose) onClose(); }, [state, onClose]);
  const fields = ORG_FIELDS[entity] || [];
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <input type="hidden" name="entity" value={entity} />
      {record?.id && <input type="hidden" name="id" value={record.id} />}
      <FormGrid cols={2}>
        {fields.map((f) => {
          if (f.kind === 'checkbox') {
            return <div key={f.name} className="flex items-end pb-1"><Checkbox name={f.name} label={f.label} defaultChecked={record ? record[f.name] !== false : true} /></div>;
          }
          if (f.kind === 'textarea') {
            return <div key={f.name} className="sm:col-span-2"><Field label={f.label}><TextArea name={f.name} defaultValue={record?.[f.name]} /></Field></div>;
          }
          if (f.kind === 'select') {
            const opts = f.optionsFrom ? (parents[f.optionsFrom] || []) : (f.options || []);
            return (
              <Field key={f.name} label={f.label}>
                <Select name={f.name} defaultValue={record?.[f.name] ?? ''} options={[{ value: '', label: '—' }, ...(opts as any)]} />
              </Field>
            );
          }
          return <Field key={f.name} label={f.label} required={f.name === 'name'}><TextInput name={f.name} required={f.name === 'name'} defaultValue={record?.[f.name]} /></Field>;
        })}
      </FormGrid>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : record?.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {record?.id ? 'Save changes' : `Add ${ORG_ENTITY_LABELS[entity] || 'entity'}`}
      </button>
    </form>
  );
}

export function OrgEntityButton({ entity, parents, record, label }: { entity: string; parents: Record<string, any[]>; record?: any; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={record ? 'btn btn-ghost btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setOpen(true)}>
        {record ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {record ? '' : (label || `Add ${ORG_ENTITY_LABELS[entity]}`)}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={record ? `Edit ${record.name}` : `Add ${ORG_ENTITY_LABELS[entity] || 'entity'}`} description="Organisational hierarchy: country → archdiocese/diocese → deanery → parish → church/outstation → SCC → member.">
        <OrgEntityForm entity={entity} parents={parents} record={record} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function DeactivateOrgEntityButton({ table, id, name }: { table: string; id: number; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm text-red-500 hover:bg-red-50"
      title="Deactivate"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Deactivate ${name}? It will be hidden from selection but existing records are preserved.`)) return;
        setBusy(true);
        const res = await deactivateOrgEntityAction(table, id);
        setBusy(false);
        if (res.ok) { toastSuccess(res.message || 'Deactivated'); window.location.reload(); }
        else toastError(res.error || 'Could not deactivate');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * SYSTEM MAINTENANCE
 * ------------------------------------------------------------------ */
export function CreateBackupButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      disabled={busy}
      onClick={async () => {
        const notes = window.prompt('Optional notes for this backup:') || undefined;
        setBusy(true);
        const res = await createBackupAction(notes);
        setBusy(false);
        if (res.ok) { toastSuccess('Backup created', res.message); window.location.reload(); }
        else toastError(res.error || 'Backup failed');
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />} Create backup now
    </button>
  );
}

export function RestoreBackupButton({ id, name }: { id: number; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Request a restore from "${name}"? This logs the request and provides the file path for a DBA to load.`)) return;
        setBusy(true);
        const res = await restoreBackupAction(id);
        setBusy(false);
        if (res.ok) { toastSuccess('Restore logged', res.message); }
        else toastError(res.error || 'Could not request restore');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Restore
    </button>
  );
}

export function RunNightlyJobsButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm('Run the nightly jobs now? This bills contributions, applies penalties and sends reminders.')) return;
        setBusy(true);
        const res = await runNightlyJobsAction();
        setBusy(false);
        if (res.ok) { toastSuccess('Jobs complete', res.message); window.location.reload(); }
        else toastError(res.error || 'Jobs failed');
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoonStar className="h-4 w-4" />} Run nightly jobs
    </button>
  );
}

export function PurgeAuditButton({ retentionDays }: { retentionDays?: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm text-red-600 hover:bg-red-50"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Purge audit logs older than the retention period${retentionDays ? ` (${retentionDays} days)` : ''}? Recent logs are kept. This is itself recorded in the audit trail.`)) return;
        setBusy(true);
        const res = await purgeAuditLogsAction();
        setBusy(false);
        if (res.ok) { toastSuccess('Audit logs purged', res.message); window.location.reload(); }
        else toastError(res.error || 'Could not purge logs');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Purge old logs
    </button>
  );
}
