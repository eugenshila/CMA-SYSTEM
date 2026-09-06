'use client';

import { useActionState, useEffect, useState } from 'react';
import { Loader2, Upload, BadgeCheck, ShieldX, Trash2, Paperclip } from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, ResultAlert } from './fields';
import { MemberPicker, type PickerOption } from './member-picker';
import { uploadMemberDocumentAction, verifyDocumentAction, deleteDocumentAction } from '@/server/actions/members';
import { DOC_TYPES } from '@/lib/document-meta';
import type { ActionResult } from '@/server/actions/auth';

export function UploadDocumentForm({
  members,
  defaultMemberId,
  defaultMemberName,
  onClose,
}: {
  members?: PickerOption[];
  defaultMemberId?: number | null;
  defaultMemberName?: string;
  onClose?: () => void;
}) {
  const [state, action, pending] = useActionState(uploadMemberDocumentAction as any, undefined as ActionResult | undefined);
  useEffect(() => {
    if (state?.ok && onClose) onClose();
  }, [state, onClose]);

  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      <ResultAlert result={state} />
      <Field label="Member" required>
        {defaultMemberId ? (
          <>
            <input type="hidden" name="member_id" value={defaultMemberId} />
            <p className="input !bg-slate-50">{defaultMemberName || `Member #${defaultMemberId}`}</p>
          </>
        ) : members ? (
          <MemberPicker name="member_id" options={members} />
        ) : null}
      </Field>
      <FormGrid cols={2}>
        <Field label="Document type" required>
          <Select name="doc_type" required defaultValue="national_id" options={DOC_TYPES} placeholder="Select type" />
        </Field>
        <Field label="Title"><TextInput name="title" placeholder="e.g. National ID — front" /></Field>
      </FormGrid>
      <Field label="File" required hint="PDF, JPG or PNG. Stored securely; sensitive files are access-controlled.">
        <input type="file" name="file" required className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-navy-800 hover:file:bg-navy-100" />
      </Field>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload document
      </button>
    </form>
  );
}

export function UploadDocumentButton({
  members,
  defaultMemberId,
  defaultMemberName,
  label = 'Upload document',
}: {
  members?: PickerOption[];
  defaultMemberId?: number | null;
  defaultMemberName?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload a document" description="Attach an identification or supporting document to a member record.">
        <UploadDocumentForm members={members} defaultMemberId={defaultMemberId} defaultMemberName={defaultMemberName} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function VerifyDocumentButton({ id, verified }: { id: number; verified: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={verified ? 'btn btn-ghost btn-sm text-slate-500' : 'btn btn-outline btn-sm'}
      title={verified ? 'Remove verification' : 'Verify document'}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await verifyDocumentAction(id, !verified);
        setBusy(false);
        if (res.ok) {
          toastSuccess(res.message || 'Done');
          window.location.reload();
        } else toastError(res.error || 'Action failed');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : verified ? <ShieldX className="h-3.5 w-3.5" /> : <BadgeCheck className="h-3.5 w-3.5" />}
    </button>
  );
}

export function DeleteDocumentButton({ id }: { id: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm text-red-500 hover:bg-red-50"
      title="Remove document"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm('Remove this document? This cannot be undone by members.')) return;
        setBusy(true);
        const res = await deleteDocumentAction(id);
        setBusy(false);
        if (res.ok) {
          toastSuccess(res.message || 'Removed');
          window.location.reload();
        } else toastError(res.error || 'Could not remove');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

export function DocIcon() {
  return <Paperclip className="h-4 w-4" />;
}
