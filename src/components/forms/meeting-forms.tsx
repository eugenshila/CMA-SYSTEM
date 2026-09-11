'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, CalendarPlus, Pencil, ClipboardCheck, CheckCheck, QrCode, Megaphone, Send, Plus, Upload, FileText, FileScan, Download, Share2, BellRing } from 'lucide-react';
import { Modal, toastSuccess, toastError, CopyButton } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, TextArea, Checkbox, ResultAlert } from './fields';
import {
  saveMeetingAction,
  setMeetingStatusAction,
  saveAttendanceAction,
  markAllPresentAction,
  selfCheckInAction,
  saveNoticeAction,
  sendBulkMessageAction,
  uploadMeetingMinutesAction,
  saveMeetingMinutesAction,
  publishMeetingMinutesAction,
  sendMeetingReminderAction,
} from '@/server/actions/records';
import { isoDate } from '@/lib/dates';
import { MEETING_TYPES, MEETING_STATUSES, ATTENDANCE_STATUSES } from '@/lib/meeting-meta';
import type { ActionResult } from '@/server/actions/auth';

export { MEETING_TYPES };

/* ------------------------------------------------------------------ *
 * Meeting create / edit
 * ------------------------------------------------------------------ */
export function MeetingForm({
  meeting,
  parishes,
  churches,
  onClose,
}: {
  meeting?: any;
  parishes?: { value: number; label: string }[];
  churches?: { value: number; label: string }[];
  onClose?: () => void;
}) {
  const [state, action, pending] = useActionState(saveMeetingAction as any, undefined as ActionResult | undefined);
  const editing = Boolean(meeting?.id);

  useEffect(() => {
    if (state?.ok && onClose) onClose();
  }, [state, onClose]);

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      {editing ? <input type="hidden" name="id" value={meeting.id} /> : null}
      <Field label="Meeting title" required>
        <TextInput name="title" required defaultValue={meeting?.title} placeholder="e.g. CMA Monthly Meeting — March" />
      </Field>
      <FormGrid cols={3}>
        <Field label="Type" required>
          <Select name="meeting_type" required defaultValue={meeting?.meeting_type ?? 'monthly'} options={MEETING_TYPES} />
        </Field>
        <Field label="Date" required>
          <TextInput name="meeting_date" type="date" required defaultValue={meeting?.meeting_date ? isoDate(meeting.meeting_date) : isoDate(new Date())} />
        </Field>
        <Field label="Venue"><TextInput name="venue" defaultValue={meeting?.venue} placeholder="Church hall, parish…" /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Start time"><TextInput name="start_time" type="time" defaultValue={meeting?.start_time ? String(meeting.start_time).slice(0, 5) : ''} /></Field>
        <Field label="End time"><TextInput name="end_time" type="time" defaultValue={meeting?.end_time ? String(meeting.end_time).slice(0, 5) : ''} /></Field>
      </FormGrid>
      {parishes?.length ? (
        <FormGrid cols={2}>
          <Field label="Parish"><Select name="parish_id" defaultValue={meeting?.parish_id} options={parishes} placeholder="Parish scope" /></Field>
          <Field label="Church / outstation"><Select name="church_id" defaultValue={meeting?.church_id} options={churches || []} placeholder="All churches" /></Field>
        </FormGrid>
      ) : null}
      <FormGrid cols={2}>
        <Field label="Chairperson"><TextInput name="chairperson" defaultValue={meeting?.chairperson} placeholder="Who is chairing" /></Field>
        <Field label="Secretary"><TextInput name="secretary" defaultValue={meeting?.secretary} placeholder="Who is taking minutes" /></Field>
      </FormGrid>
      <Field label="Agenda"><TextArea name="agenda" defaultValue={meeting?.agenda} placeholder="Agenda items…" /></Field>
      <Checkbox name="attendance_open" label="Open attendance for self check-in" hint="Lets members mark themselves present (optionally with a code)." defaultChecked={meeting?.attendance_open} />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {editing ? 'Update meeting' : 'Schedule meeting'}
      </button>
    </form>
  );
}

export function NewMeetingButton({ parishes, churches }: { parishes?: { value: number; label: string }[]; churches?: { value: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <CalendarPlus className="h-4 w-4" /> Schedule meeting
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule a meeting" description="Members in the parish are notified and attendance rows are prepared automatically.">
        <MeetingForm parishes={parishes} churches={churches} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function EditMeetingButton({ meeting, parishes, churches }: { meeting: any; parishes?: { value: number; label: string }[]; churches?: { value: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> Edit
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit meeting" description="Update the meeting details.">
        <MeetingForm meeting={meeting} parishes={parishes} churches={churches} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function SetMeetingStatusButton({ meetingId, status, label }: { meetingId: number; status: string; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await setMeetingStatusAction(meetingId, status);
        setBusy(false);
        if (res.ok) {
          toastSuccess(res.message || 'Status updated');
          window.location.reload();
        } else toastError(res.error || 'Could not update status');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />} {label}
    </button>
  );
}

export function MeetingStatusSelect({ meetingId, current }: { meetingId: number; current: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Select
      name="status"
      defaultValue={current}
      options={MEETING_STATUSES}
      disabled={busy}
      onChange={async (e) => {
        const next = e.target.value;
        if (!next || next === current) return;
        setBusy(true);
        const res = await setMeetingStatusAction(meetingId, next);
        setBusy(false);
        if (res.ok) {
          toastSuccess(res.message || 'Status updated');
          window.location.reload();
        } else toastError(res.error || 'Could not update status');
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Secretary minutes: scan → review → publish / distribute
 * ------------------------------------------------------------------ */
function ocrStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    not_uploaded: 'No scan uploaded',
    needs_review: 'OCR draft needs review',
    completed: 'Reviewed draft',
    not_configured: 'OCR not configured',
    failed: 'OCR needs attention',
  };
  return labels[status || ''] || 'Draft';
}

export function MeetingReminderButton({ meetingId }: { meetingId: number }) {
  const [busy, setBusy] = useState(false);
  const [whatsApp, setWhatsApp] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <label className="hidden items-center gap-1 text-[11px] text-slate-500 xl:flex">
        <input type="checkbox" checked={whatsApp} onChange={(e) => setWhatsApp(e.target.checked)} className="checkbox" /> WhatsApp
      </label>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await sendMeetingReminderAction(meetingId, whatsApp ? ['in_system', 'sms', 'whatsapp'] : ['in_system', 'sms']);
          setBusy(false);
          if (result.ok) toastSuccess(result.message || 'Reminder sent');
          else toastError(result.error || 'Could not send reminder');
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Send reminder
      </button>
    </div>
  );
}

export function MeetingMinutesPanel({ meeting, canEdit }: { meeting: any; canEdit: boolean }) {
  const [uploadState, uploadAction, uploading] = useActionState(uploadMeetingMinutesAction as any, undefined as ActionResult | undefined);
  const [saveState, saveAction, saving] = useActionState(saveMeetingMinutesAction as any, undefined as ActionResult | undefined);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishMessage, setPublishMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [sendSms, setSendSms] = useState(true);
  const [sendWhatsApp, setSendWhatsApp] = useState(false);

  useEffect(() => {
    if (uploadState?.ok || saveState?.ok) window.setTimeout(() => window.location.reload(), 350);
  }, [uploadState?.ok, saveState?.ok]);

  const pdfUrl = `/api/documents/meeting-minutes/${meeting.id}?format=pdf`;
  const wordUrl = `/api/documents/meeting-minutes/${meeting.id}?format=word`;
  const sourceUrl = `/api/documents/meeting-minutes/${meeting.id}?format=source`;
  const published = Boolean(meeting.minutes_published_at);

  async function publish() {
    setPublishing(true);
    setPublishError('');
    setPublishMessage('');
    const channels = ['in_system', ...(sendSms ? ['sms'] : []), ...(sendWhatsApp ? ['whatsapp'] : [])];
    const result = await publishMeetingMinutesAction(Number(meeting.id), channels);
    setPublishing(false);
    if (!result.ok) {
      setPublishError(result.error || 'Could not publish minutes.');
      return;
    }
    setPublishMessage(result.message || 'Minutes published.');
    setShareUrl(String(result.data?.shareUrl || ''));
    toastSuccess('Minutes published');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-navy-900">Official minutes</p>
          <p className="text-xs text-slate-500">
            {published ? 'Published to meeting members.' : canEdit ? 'Draft — review before publishing.' : 'Minutes are not yet published.'}
          </p>
        </div>
        {meeting.minutes ? (
          <div className="flex flex-wrap gap-2">
            <a href={pdfUrl} target="_blank" className="btn btn-outline btn-sm"><FileText className="h-4 w-4" /> PDF</a>
            {canEdit ? <a href={wordUrl} className="btn btn-outline btn-sm"><Download className="h-4 w-4" /> Word</a> : null}
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <>
          <form action={uploadAction} className="rounded-xl border border-dashed border-navy-200 bg-navy-50/40 p-3">
            <input type="hidden" name="meeting_id" value={meeting.id} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label className="label">Handwritten minutes scan</label>
                <input name="file" type="file" required accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,.jpg,.jpeg,.png,.webp,.gif,.pdf,.txt" className="input !py-1.5" />
                <p className="mt-1 text-[11px] text-slate-500">JPG, PNG, WebP, PDF or text, up to 10 MB. OCR creates a draft; always check names, figures and decisions.</p>
              </div>
              <button type="submit" className="btn btn-outline btn-sm shrink-0" disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileScan className="h-4 w-4" />} Upload & read
              </button>
            </div>
            <ResultAlert result={uploadState} />
          </form>

          {meeting.minutes_file_name ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <FileScan className="h-4 w-4 text-navy-700" />
              <span className="min-w-0 flex-1 truncate">Source scan: {meeting.minutes_file_name}</span>
              <span className="badge badge-gold">{ocrStatusLabel(meeting.minutes_ocr_status)}</span>
              <a href={sourceUrl} target="_blank" className="btn btn-ghost btn-sm">Open scan</a>
            </div>
          ) : null}
          {meeting.minutes_ocr_error ? <p className="text-xs text-amber-700">{meeting.minutes_ocr_error}</p> : null}

          <form action={saveAction} className="space-y-2">
            <input type="hidden" name="meeting_id" value={meeting.id} />
            <label className="label">Reviewed minutes</label>
            <textarea
              name="minutes"
              defaultValue={meeting.minutes || ''}
              rows={14}
              placeholder="Upload a scan to create a draft, or type / paste the official minutes here…"
              className="input resize-y leading-6"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save reviewed draft
              </button>
              {published ? <span className="text-xs text-amber-700">Saving changes will revoke the current sharing link until you publish again.</span> : null}
            </div>
            <ResultAlert result={saveState} />
          </form>

          {meeting.minutes ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Publish & distribute</p>
                  <p className="text-xs text-emerald-800">A 90-day secure PDF link is created for WhatsApp and SMS. Members also receive an in-system notice.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} className="checkbox" /> SMS</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} className="checkbox" /> WhatsApp</label>
                  <button type="button" className="btn btn-success btn-sm" disabled={publishing} onClick={publish}>
                    {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Publish minutes
                  </button>
                </div>
              </div>
              {publishError ? <p className="mt-2 text-xs font-medium text-red-700">{publishError}</p> : null}
              {publishMessage ? <p className="mt-2 text-xs font-medium text-emerald-800">{publishMessage}</p> : null}
              {shareUrl ? (
                <div className="mt-3 flex flex-col gap-2 rounded-lg border border-emerald-200 bg-white p-2 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 break-all text-[11px] text-slate-600">{shareUrl}</code>
                  <div className="flex shrink-0 gap-1">
                    <CopyButton value={shareUrl} label="Copy link" />
                    <a href={`https://wa.me/?text=${encodeURIComponent(`CMA meeting minutes: ${shareUrl}`)}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm"><Share2 className="h-3.5 w-3.5" /> WhatsApp</a>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : published && meeting.minutes ? (
        <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{meeting.minutes}</p>
      ) : (
        <p className="text-sm text-slate-500">The secretary has not published the minutes yet.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Attendance sheet (bulk save)
 * ------------------------------------------------------------------ */
export interface AttendanceRow {
  memberId: number;
  fullName: string;
  membershipNo: string;
  status: string;
  remarks?: string | null;
}

export function AttendanceSheet({ meetingId, rows }: { meetingId: number; rows: AttendanceRow[] }) {
  const [statuses, setStatuses] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((r) => [r.memberId, r.status])));
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const changed = useMemo(
    () => rows.filter((r) => statuses[r.memberId] !== r.status),
    [rows, statuses],
  );
  const visible = useMemo(
    () => (filter ? rows.filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase()) || r.membershipNo.toLowerCase().includes(filter.toLowerCase())) : rows),
    [rows, filter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { present: 0, late: 0, apology: 0, absent: 0 };
    rows.forEach((r) => {
      c[statuses[r.memberId]] = (c[statuses[r.memberId]] || 0) + 1;
    });
    return c;
  }, [rows, statuses]);

  async function save() {
    const entries = changed.map((r) => ({ memberId: r.memberId, status: statuses[r.memberId] as any }));
    if (entries.length === 0) {
      toastError('No changes to save');
      return;
    }
    setBusy(true);
    const res = await saveAttendanceAction(meetingId, entries);
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Attendance saved');
      window.location.reload();
    } else toastError(res.error || 'Could not save attendance');
  }

  async function markAll() {
    setBusy(true);
    const res = await markAllPresentAction(meetingId);
    setBusy(false);
    if (res.ok) {
      toastSuccess(res.message || 'Marked present');
      window.location.reload();
    } else toastError(res.error || 'Could not mark all present');
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter members…" className="input max-w-xs flex-1" />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="badge badge-green">{counts.present || 0} present</span>
          <span className="badge badge-blue">{counts.late || 0} late</span>
          <span className="badge badge-gold">{counts.apology || 0} apology</span>
          <span className="badge badge-grey">{counts.absent || 0} absent</span>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={markAll}>
            <CheckCheck className="h-4 w-4" /> Mark all present
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || changed.length === 0} onClick={save}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save {changed.length > 0 ? `(${changed.length})` : ''}
          </button>
        </div>
      </div>

      <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Member</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => (
              <tr key={r.memberId} className={statuses[r.memberId] !== r.status ? 'bg-gold-50/40' : ''}>
                <td className="px-3 py-1.5">
                  <span className="font-medium text-slate-700">{r.fullName}</span>
                  <span className="ml-2 text-[11px] text-slate-400">{r.membershipNo}</span>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={statuses[r.memberId]}
                    onChange={(e) => setStatuses((s) => ({ ...s, [r.memberId]: e.target.value }))}
                    className="select !py-1 text-xs"
                  >
                    {ATTENDANCE_STATUSES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Member self check-in
 * ------------------------------------------------------------------ */
export function SelfCheckInButton({ meetingId, requiresCode }: { meetingId: number; requiresCode?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {requiresCode ? (
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Meeting code" className="input max-w-[10rem]" />
      ) : null}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await selfCheckInAction(meetingId, code || undefined);
          setBusy(false);
          if (res.ok) {
            toastSuccess(res.message || 'Checked in');
            window.location.reload();
          } else toastError(res.error || 'Could not check in');
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Check me in
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Notices & bulk messaging
 * ------------------------------------------------------------------ */
export function NoticeForm({ onClose }: { onClose?: () => void }) {
  const [state, action, pending] = useActionState(saveNoticeAction as any, undefined as ActionResult | undefined);
  useEffect(() => {
    if (state?.ok && onClose) onClose();
  }, [state, onClose]);
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <Field label="Title" required><TextInput name="title" required placeholder="Notice title" /></Field>
      <Field label="Message" required><TextArea name="body" required placeholder="Write the notice…" /></Field>
      <FormGrid cols={2}>
        <Field label="Category">
          <Select name="category" defaultValue="general" options={[
            { value: 'general', label: 'General' },
            { value: 'meeting', label: 'Meeting' },
            { value: 'contribution', label: 'Contribution' },
            { value: 'welfare', label: 'Welfare' },
            { value: 'event', label: 'Event' },
          ]} />
        </Field>
        <Field label="Audience">
          <Select name="audience" defaultValue="all" options={[
            { value: 'all', label: 'All active members' },
            { value: 'committee', label: 'Committee / staff' },
            { value: 'members_with_debt', label: 'Members with arrears' },
          ]} />
        </Field>
      </FormGrid>
      <Field label="Visible until"><TextInput name="publish_to" type="date" /></Field>
      <Checkbox name="pinned" label="Pin this notice" hint="Pinned notices are treated as high priority." />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />} Publish notice
      </button>
    </form>
  );
}

export function NewNoticeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New notice
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Publish a notice" description="The notice is posted and sent to the selected audience.">
        <NoticeForm onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function BulkMessageForm({ onClose }: { onClose?: () => void }) {
  const [state, action, pending] = useActionState(sendBulkMessageAction as any, undefined as ActionResult | undefined);
  useEffect(() => {
    if (state?.ok && onClose) onClose();
  }, [state, onClose]);
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <Field label="Subject" required><TextInput name="title" required placeholder="Message subject" /></Field>
      <Field label="Message" required><TextArea name="body" required placeholder="Write your message…" /></Field>
      <FormGrid cols={2}>
        <Field label="Audience">
          <Select name="audience" defaultValue="all" options={[
            { value: 'all', label: 'All active members' },
            { value: 'committee', label: 'Committee / staff' },
            { value: 'members_with_debt', label: 'Members with arrears' },
          ]} />
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue="normal" options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]} />
        </Field>
      </FormGrid>
      <Field label="Channels" hint="In-system is always delivered; SMS/email depend on provider configuration.">
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="channels" value="in_system" defaultChecked className="checkbox" /> In-system</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="channels" value="sms" className="checkbox" /> SMS</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="channels" value="email" className="checkbox" /> Email</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="channels" value="whatsapp" className="checkbox" /> WhatsApp</label>
        </div>
      </Field>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send message
      </button>
    </form>
  );
}

export function BulkMessageButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <Send className="h-4 w-4" /> Bulk message
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Send a bulk message" description="Notify a group of members at once.">
        <BulkMessageForm onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}
