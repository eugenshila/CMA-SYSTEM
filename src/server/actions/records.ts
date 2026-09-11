'use server';

import { revalidatePath } from 'next/cache';
import { one, query, execute } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify, notifyMembers, notifyRole } from '@/lib/notify';
import { meetingSchema, firstError, formDataToObject } from '@/lib/validators';
import { sqlDate, isoDate, fmtDate, fmtTime } from '@/lib/dates';
import { num } from '@/lib/money';
import { storeFile, toBuffer } from '@/lib/files';
import { recogniseMeetingMinutes } from '@/lib/ocr';
import { randomToken, sha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import type { ActionResult } from './auth';

/* ------------------------------------------------------------------ *
 * MEETINGS
 * ------------------------------------------------------------------ */
export async function saveMeetingAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(formData.get('id') || 0);
  if (id ? !can(user, 'meetings.update') : !can(user, 'meetings.create')) {
    return { ok: false, error: 'You do not have permission to manage meetings.' };
  }
  const raw = formDataToObject(formData);
  const parsed = meetingSchema.safeParse({
    ...raw,
    parish_id: raw.parish_id ? Number(raw.parish_id) : user.scope_parish_id || null,
    church_id: raw.church_id ? Number(raw.church_id) : null,
    attendance_open: formData.get('attendance_open') === 'on',
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed) || 'Please correct the meeting details.' };
  const d = parsed.data;

  if (id) {
    const before = await one<any>('SELECT * FROM meetings WHERE id = $1', [id]);
    await execute(
      `UPDATE meetings SET title=$2, meeting_type=$3, meeting_date=$4, start_time=$5, end_time=$6, venue=$7,
              parish_id=$8, church_id=$9, chairperson=$10, secretary=$11, agenda=$12, attendance_open=$13
        WHERE id=$1`,
      [
        id, d.title, d.meeting_type, sqlDate(d.meeting_date), d.start_time || null, d.end_time || null, d.venue || null,
        d.parish_id || null, d.church_id || null, d.chairperson || null, d.secretary || null, d.agenda || null,
        Boolean(d.attendance_open),
      ],
    );
    await logAudit({ userId: user.id, userName: user.name, action: 'meeting.updated', entityType: 'meetings', entityId: id, entityLabel: d.title, description: `Updated meeting "${d.title}"`, oldValues: before, newValues: d });
    revalidatePath('/meetings');
    revalidatePath(`/meetings/${id}`);
    return { ok: true, message: 'Meeting updated.' };
  }

  const created = await one<any>(
    `INSERT INTO meetings (title, meeting_type, meeting_date, start_time, end_time, venue, parish_id, church_id,
                           chairperson, secretary, agenda, attendance_open, status, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'scheduled',$13) RETURNING *`,
    [
      d.title, d.meeting_type, sqlDate(d.meeting_date), d.start_time || null, d.end_time || null, d.venue || null,
      d.parish_id || null, d.church_id || null, d.chairperson || null, d.secretary || null, d.agenda || null,
      Boolean(d.attendance_open), user.id,
    ],
  );

  // pre-create attendance rows for every active member of the parish
  const members = await query<any>(
    `SELECT id FROM members WHERE deleted_at IS NULL AND membership_status = 'active'
      ${created.parish_id ? 'AND parish_id = $1' : ''}`,
    created.parish_id ? [created.parish_id] : [],
  );
  for (const m of members) {
    await execute(
      `INSERT INTO attendance (meeting_id, member_id, status, method, recorded_by)
       VALUES ($1,$2,'absent','bulk',$3) ON CONFLICT (meeting_id, member_id) DO NOTHING`,
      [created.id, m.id, user.id],
    );
  }

  await logAudit({ userId: user.id, userName: user.name, action: 'meeting.created', entityType: 'meetings', entityId: created.id, entityLabel: d.title, description: `Scheduled meeting "${d.title}" on ${isoDate(d.meeting_date)}`, newValues: d });

  await notifyMembers(members.map((m) => m.id), {
    title: `Meeting notice — ${d.title}`,
    body: `${d.meeting_type.replace(/_/g, ' ')} meeting on ${isoDate(d.meeting_date)}${d.start_time ? ` at ${String(d.start_time).slice(0, 5)}` : ''}${d.venue ? `, ${d.venue}` : ''}. All members are expected to attend.`,
    category: 'meeting',
    priority: 'high',
    channels: ['in_system', 'sms'],
    link: `/meetings/${created.id}`,
    referenceType: 'meetings',
    referenceId: created.id,
  });

  revalidatePath('/meetings');
  revalidatePath('/attendance');
  return { ok: true, message: `Meeting scheduled and ${members.length} member(s) notified.`, data: created };
}

export async function setMeetingStatusAction(meetingId: number, status: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'meetings.update')) return { ok: false, error: 'You do not have permission to update meetings.' };
  await execute('UPDATE meetings SET status = $2 WHERE id = $1', [meetingId, status]);
  await logAudit({ userId: user.id, userName: user.name, action: 'meeting.status_updated', entityType: 'meetings', entityId: meetingId, description: `Meeting status set to ${status}` });
  revalidatePath('/meetings');
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, message: `Meeting marked ${status}.` };
}

/* ------------------------------------------------------------------ *
 * SECRETARY: MINUTES, REMINDERS & DISTRIBUTION
 * ------------------------------------------------------------------ */
function minutesChannels(input: string[] | undefined) {
  const allowed = new Set(['in_system', 'sms', 'whatsapp']);
  const selected = [...new Set((input || []).filter((channel) => allowed.has(channel)))];
  return (selected.length ? selected : ['in_system']) as ('in_system' | 'sms' | 'whatsapp')[];
}

async function meetingAudience(meeting: any) {
  // Attendance rows are created when a meeting is scheduled, so they are the
  // most accurate recipient list. The fallback also supports older meetings.
  const fromAttendance = await query<{ id: number }>(
    `SELECT DISTINCT m.id
       FROM attendance a JOIN members m ON m.id = a.member_id
      WHERE a.meeting_id = $1 AND m.deleted_at IS NULL AND m.membership_status = 'active'`,
    [meeting.id],
  );
  if (fromAttendance.length) return fromAttendance;

  const params: any[] = [];
  const where = [`m.deleted_at IS NULL`, `m.membership_status = 'active'`];
  if (meeting.parish_id) {
    params.push(meeting.parish_id);
    where.push(`m.parish_id = $${params.length}`);
  }
  if (meeting.church_id) {
    params.push(meeting.church_id);
    where.push(`m.church_id = $${params.length}`);
  }
  return query<{ id: number }>(`SELECT m.id FROM members m WHERE ${where.join(' AND ')}`, params);
}

function meetingLink(meetingId: number) {
  return `/meetings/${meetingId}`;
}

function publicMinutesLink(token: string) {
  return `${env.APP_URL.replace(/\/$/, '')}/api/shared/minutes/${token}?format=pdf`;
}

async function createMinutesShare(meetingId: number, userId: number) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  await execute(
    `INSERT INTO meeting_minutes_shares (meeting_id, token_hash, created_by, expires_at)
     VALUES ($1,$2,$3,$4)`,
    [meetingId, sha256(token), userId, expiresAt],
  );
  return { token, expiresAt, url: publicMinutesLink(token) };
}

export async function saveMeetingMinutesAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const meetingId = Number(formData.get('meeting_id') || 0);
  if (!meetingId) return { ok: false, error: 'Meeting not found.' };
  if (!can(user, 'meetings.update')) return { ok: false, error: 'Only the secretary or an authorised officer can update meeting minutes.' };

  const meeting = await one<any>('SELECT id, title FROM meetings WHERE id = $1', [meetingId]);
  if (!meeting) return { ok: false, error: 'Meeting not found.' };
  const minutes = String(formData.get('minutes') || '').trim();
  if (minutes.length < 10) return { ok: false, error: 'Enter at least a short set of minutes before saving.' };

  await execute(
    `UPDATE meetings
        SET minutes = $2, minutes_ocr_status = 'completed', minutes_ocr_error = NULL,
            minutes_updated_by = $3, minutes_updated_at = now(),
            minutes_published_at = NULL, minutes_published_by = NULL
      WHERE id = $1`,
    [meetingId, minutes, user.id],
  );
  // A new edit must be deliberately republished. This prevents an old public
  // share link from silently serving an earlier draft.
  await execute(
    `UPDATE meeting_minutes_shares SET revoked_at = now()
      WHERE meeting_id = $1 AND revoked_at IS NULL`,
    [meetingId],
  );
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'meeting.minutes_saved',
    entityType: 'meetings',
    entityId: meetingId,
    entityLabel: meeting.title,
    description: `Reviewed meeting minutes saved for “${meeting.title}”`,
  });
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, message: 'Minutes saved as a draft. Publish them when the wording is final.' };
}

export async function uploadMeetingMinutesAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const meetingId = Number(formData.get('meeting_id') || 0);
  if (!meetingId) return { ok: false, error: 'Meeting not found.' };
  if (!can(user, 'meetings.update')) return { ok: false, error: 'Only the secretary or an authorised officer can upload meeting minutes.' };

  const meeting = await one<any>('SELECT id, title, minutes FROM meetings WHERE id = $1', [meetingId]);
  if (!meeting) return { ok: false, error: 'Meeting not found.' };
  const file = formData.get('file') as File | null;
  if (!file || !file.size) return { ok: false, error: 'Choose a scan or text file to upload.' };
  const mime = file.type || 'application/octet-stream';
  const supported = mime.startsWith('image/') || mime === 'application/pdf' || mime === 'text/plain' || /\.(jpe?g|png|webp|gif|pdf|txt)$/i.test(file.name);
  if (!supported) return { ok: false, error: 'Upload a JPG, PNG, WebP, PDF or plain-text minutes file.' };

  try {
    const buffer = await toBuffer(file);
    const [stored, ocr] = await Promise.all([
      storeFile({
        buffer,
        fileName: file.name || 'meeting-minutes-scan',
        mimeType: mime,
        folder: `meetings/${meetingId}/minutes`,
      }),
      recogniseMeetingMinutes({ buffer, fileName: file.name || 'meeting-minutes-scan', mimeType: mime }),
    ]);
    const extracted = ocr.text.trim();
    await execute(
      `UPDATE meetings
          SET minutes_file_name = $2, minutes_file_url = $3, minutes_file_mime_type = $4, minutes_file_size_bytes = $5,
              minutes = CASE WHEN $6 <> '' THEN $6 ELSE minutes END,
              minutes_ocr_status = $7, minutes_ocr_provider = $8, minutes_ocr_error = $9,
              minutes_updated_by = $10, minutes_updated_at = now(),
              minutes_published_at = NULL, minutes_published_by = NULL
        WHERE id = $1`,
      [meetingId, stored.file_name, stored.file_url, stored.mime_type, stored.size_bytes, extracted, ocr.status, ocr.provider, ocr.error || null, user.id],
    );
    await execute(`UPDATE meeting_minutes_shares SET revoked_at = now() WHERE meeting_id = $1 AND revoked_at IS NULL`, [meetingId]);
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'meeting.minutes_scan_uploaded',
      entityType: 'meetings',
      entityId: meetingId,
      entityLabel: meeting.title,
      description: `Uploaded a minutes source file for “${meeting.title}”${extracted ? ' and created an OCR draft' : ''}`,
      newValues: { file_name: stored.file_name, ocr_status: ocr.status, ocr_provider: ocr.provider },
    });
    revalidatePath(`/meetings/${meetingId}`);
    return {
      ok: true,
      message: extracted
        ? 'Scan uploaded and OCR draft created. Review every line, then save the official minutes.'
        : ocr.error || 'Scan uploaded. Enter or paste the reviewed minutes before publishing.',
    };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'The minutes scan could not be uploaded.' };
  }
}

export async function publishMeetingMinutesAction(meetingId: number, selectedChannels: string[] = ['in_system']): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'meetings.update') && !can(user, 'notifications.create')) {
    return { ok: false, error: 'You do not have permission to publish meeting minutes.' };
  }
  const meeting = await one<any>('SELECT * FROM meetings WHERE id = $1', [meetingId]);
  if (!meeting) return { ok: false, error: 'Meeting not found.' };
  if (!String(meeting.minutes || '').trim()) return { ok: false, error: 'Review and save the minutes before publishing.' };

  const channels = minutesChannels(selectedChannels);
  const share = await createMinutesShare(meetingId, user.id);
  const recipients = await meetingAudience(meeting);
  const date = meeting.meeting_date ? fmtDate(meeting.meeting_date) : 'the meeting';
  const body = `The reviewed minutes for “${meeting.title}” (${date}) are ready. Read or download the PDF: ${share.url}`;

  await execute(
    `UPDATE meetings SET minutes_published_at = now(), minutes_published_by = $2 WHERE id = $1`,
    [meetingId, user.id],
  );
  await notifyMembers(recipients.map((member) => member.id), {
    title: `Meeting minutes — ${meeting.title}`,
    body,
    category: 'meeting',
    priority: 'normal',
    channels,
    link: meetingLink(meetingId),
    referenceType: 'meetings',
    referenceId: meetingId,
  });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'meeting.minutes_published',
    entityType: 'meetings',
    entityId: meetingId,
    entityLabel: meeting.title,
    description: `Published meeting minutes for “${meeting.title}” to ${recipients.length} member(s) via ${channels.join(', ')}`,
    newValues: { recipients: recipients.length, channels, share_expires_at: share.expiresAt.toISOString() },
  });
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/notifications');
  return {
    ok: true,
    message: `Minutes published and sent to ${recipients.length} member(s). The secure download link expires in 90 days.`,
    data: { shareUrl: share.url, expiresAt: share.expiresAt.toISOString() },
  };
}

export async function sendMeetingReminderAction(meetingId: number, selectedChannels: string[] = ['in_system', 'sms']): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'meetings.update') && !can(user, 'notifications.create')) {
    return { ok: false, error: 'You do not have permission to send meeting reminders.' };
  }
  const meeting = await one<any>('SELECT * FROM meetings WHERE id = $1', [meetingId]);
  if (!meeting) return { ok: false, error: 'Meeting not found.' };
  if (meeting.status === 'cancelled') return { ok: false, error: 'This meeting is cancelled and cannot be reminded.' };

  const channels = minutesChannels(selectedChannels);
  const recipients = await meetingAudience(meeting);
  const body = `${String(meeting.meeting_type || 'CMA').replace(/_/g, ' ')} reminder: “${meeting.title}” is on ${fmtDate(meeting.meeting_date)}${meeting.start_time ? ` at ${fmtTime(meeting.start_time)}` : ''}${meeting.venue ? `, ${meeting.venue}` : ''}.`;
  await notifyMembers(recipients.map((member) => member.id), {
    title: `Reminder — ${meeting.title}`,
    body,
    category: 'meeting',
    priority: 'high',
    channels,
    link: meetingLink(meetingId),
    referenceType: 'meetings',
    referenceId: meetingId,
  });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'meeting.reminder_sent',
    entityType: 'meetings',
    entityId: meetingId,
    entityLabel: meeting.title,
    description: `Meeting reminder sent to ${recipients.length} member(s) via ${channels.join(', ')}`,
    newValues: { recipients: recipients.length, channels },
  });
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/notifications');
  return { ok: true, message: `Reminder sent to ${recipients.length} member(s).` };
}

/* ------------------------------------------------------------------ *
 * ATTENDANCE
 * ------------------------------------------------------------------ */
export async function saveAttendanceAction(
  meetingId: number,
  entries: { memberId: number; status: 'present' | 'absent' | 'apology' | 'late'; remarks?: string }[],
): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'attendance.update') && !can(user, 'attendance.create')) {
    return { ok: false, error: 'You do not have permission to mark attendance.' };
  }
  const meeting = await one<any>('SELECT * FROM meetings WHERE id = $1', [meetingId]);
  if (!meeting) return { ok: false, error: 'Meeting not found.' };

  let marked = 0;
  for (const e of entries) {
    if (!e.memberId || !e.status) continue;
    await execute(
      `INSERT INTO attendance (meeting_id, member_id, status, check_in_time, method, remarks, recorded_by)
       VALUES ($1,$2,$3, CASE WHEN $2 IS NOT NULL AND $4 IN ('present','late') THEN now() ELSE NULL END, 'manual', $5, $6)
       ON CONFLICT (meeting_id, member_id) DO UPDATE
         SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, recorded_by = EXCLUDED.recorded_by, updated_at = now(),
             check_in_time = CASE WHEN EXCLUDED.status IN ('present','late') AND attendance.check_in_time IS NULL THEN now() ELSE attendance.check_in_time END`,
      [meetingId, e.memberId, e.status, e.status, e.remarks || null, user.id],
    );
    marked++;
  }

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'attendance.saved',
    entityType: 'attendance',
    entityId: meetingId,
    entityLabel: meeting.title,
    description: `Marked attendance for ${marked} member(s) at "${meeting.title}"`,
    newValues: { marked },
  });

  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/attendance');
  revalidatePath('/reports/membership');
  return { ok: true, message: `Attendance saved for ${marked} member(s).` };
}

export async function markAllPresentAction(meetingId: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'attendance.update')) return { ok: false, error: 'You do not have permission to mark attendance.' };
  const res = await execute(
    `UPDATE attendance SET status = 'present', check_in_time = COALESCE(check_in_time, now()), recorded_by = $2, method='bulk'
      WHERE meeting_id = $1 AND status = 'absent'`,
    [meetingId, user.id],
  );
  await logAudit({ userId: user.id, userName: user.name, action: 'attendance.bulk_present', entityType: 'attendance', entityId: meetingId, description: `Marked ${res} member(s) present` });
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, message: `${res} member(s) marked present.` };
}

export async function selfCheckInAction(meetingId: number, code?: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.member_id) return { ok: false, error: 'This account is not linked to a member record.' };
  const meeting = await one<any>('SELECT * FROM meetings WHERE id = $1', [meetingId]);
  if (!meeting) return { ok: false, error: 'Meeting not found.' };
  if (!meeting.attendance_open) return { ok: false, error: 'Attendance for this meeting is not open.' };
  if (meeting.qr_code && code && meeting.qr_code !== code) return { ok: false, error: 'Invalid meeting code.' };

  await execute(
    `INSERT INTO attendance (meeting_id, member_id, status, check_in_time, method)
     VALUES ($1,$2,'present', now(),'self')
     ON CONFLICT (meeting_id, member_id) DO UPDATE SET status='present', check_in_time = now(), method='self'`,
    [meetingId, user.member_id],
  );
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/attendance');
  return { ok: true, message: 'You have been marked present. God bless you!' };
}

/* ------------------------------------------------------------------ *
 * NOTICES & COMMUNICATION
 * ------------------------------------------------------------------ */
export async function saveNoticeAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'notices.create') && !can(user, 'notifications.create')) {
    return { ok: false, error: 'You do not have permission to publish notices.' };
  }
  const title = String(formData.get('title') || '').trim();
  const body = String(formData.get('body') || '').trim();
  const category = String(formData.get('category') || 'general');
  const audience = String(formData.get('audience') || 'all');
  const pinned = formData.get('pinned') === 'on';
  const publishTo = String(formData.get('publish_to') || '');
  if (title.length < 4) return { ok: false, error: 'Enter a notice title (at least 4 characters).' };
  if (body.length < 10) return { ok: false, error: 'Enter the notice message.' };

  const id = Number(formData.get('id') || 0);
  if (id) {
    await execute(
      `UPDATE notices SET title=$2, body=$3, category=$4, audience=$5, pinned=$6, publish_to=$7, status='published' WHERE id=$1`,
      [id, title, body, category, audience, pinned, sqlDate(publishTo) || null],
    );
  } else {
    await execute(
      `INSERT INTO notices (title, body, category, audience, parish_id, pinned, publish_to, published_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published')`,
      [title, body, category, audience, user.scope_parish_id, pinned, sqlDate(publishTo) || null, user.id],
    );
  }
  await logAudit({ userId: user.id, userName: user.name, action: id ? 'notice.updated' : 'notice.published', entityType: 'notices', entityId: id || null, entityLabel: title, description: `Notice published: ${title}` });

  // notify the selected audience
  const members = await audienceMembers(audience, user.scope_parish_id);
  await notifyMembers(members.map((m) => m.id), {
    title,
    body,
    category: `notice:${category}`,
    priority: pinned ? 'high' : 'normal',
    channels: ['in_system', 'sms'],
    link: '/notifications',
  });

  revalidatePath('/notifications');
  revalidatePath('/admin/notices');
  revalidatePath('/dashboard');
  return { ok: true, message: `Notice published and sent to ${members.length} member(s).` };
}

async function audienceMembers(audience: string, parishId: number | null) {
  if (audience === 'committee') {
    const rows = await query<any>(
      `SELECT m.id FROM users u JOIN members m ON m.id = u.member_id
        JOIN roles r ON r.id = u.role_id WHERE r.key <> 'member' AND u.deleted_at IS NULL`,
    );
    return rows;
  }
  if (audience === 'members_with_debt') {
    return query<any>(
      `SELECT DISTINCT m.id FROM members m
         JOIN member_contributions mc ON mc.member_id = m.id
        WHERE m.deleted_at IS NULL AND mc.status IN ('unpaid','partial','overdue')`,
    );
  }
  return query<any>(
    `SELECT id FROM members WHERE deleted_at IS NULL AND membership_status = 'active' ${parishId ? 'AND parish_id = $1' : ''}`,
    parishId ? [parishId] : [],
  );
}

export async function deleteNoticeAction(id: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'notices.delete')) return { ok: false, error: 'You do not have permission to remove notices.' };
  await execute(`UPDATE notices SET status = 'archived' WHERE id = $1`, [id]);
  await logAudit({ userId: user.id, userName: user.name, action: 'notice.archived', entityType: 'notices', entityId: id, description: 'Notice archived' });
  revalidatePath('/admin/notices');
  revalidatePath('/notifications');
  return { ok: true, message: 'Notice archived.' };
}

export async function sendBulkMessageAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'notifications.create')) return { ok: false, error: 'You do not have permission to send messages to members.' };
  const title = String(formData.get('title') || '').trim();
  const body = String(formData.get('body') || '').trim();
  const audience = String(formData.get('audience') || 'all');
  const requestedChannels = formData.getAll('channels').map(String) as any[];
  // Retain an in-system audit/inbox copy even when the secretary only selects
  // SMS or WhatsApp. This is useful when a provider rejects a message.
  const channels = [...new Set(['in_system', ...requestedChannels])];
  const category = String(formData.get('category') || 'general');
  const priority = String(formData.get('priority') || 'normal') as any;
  if (title.length < 4 || body.length < 5) return { ok: false, error: 'Enter a subject and a message.' };

  const members = await audienceMembers(audience, user.scope_parish_id);
  const sent = await notifyMembers(members.map((m) => m.id), {
    title,
    body,
    category,
    priority,
    channels: channels.length ? channels : ['in_system'],
    link: '/notifications',
  });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'communication.sent',
    entityType: 'notifications',
    description: `Bulk message "${title}" sent to ${sent} member(s) via ${channels.join(', ') || 'in-system'}`,
    newValues: { audience, channels, recipients: sent },
  });
  revalidatePath('/notifications');
  revalidatePath('/admin/communication');
  return { ok: true, message: `Message sent to ${sent} member(s).` };
}

/* ------------------------------------------------------------------ *
 * NOTIFICATIONS (own inbox)
 * ------------------------------------------------------------------ */
export async function markNotificationReadAction(id: number): Promise<ActionResult> {
  const user = await requireUser();
  await execute(
    `UPDATE notifications SET read_at = now() WHERE id = $1 AND (user_id = $2 OR member_id = $3)`,
    [id, user.id, user.member_id],
  );
  revalidatePath('/notifications');
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const user = await requireUser();
  const count = await execute(
    `UPDATE notifications SET read_at = now() WHERE read_at IS NULL AND (user_id = $1 OR member_id = $2)`,
    [user.id, user.member_id],
  );
  revalidatePath('/notifications');
  revalidatePath('/dashboard');
  return { ok: true, message: `${count} notification(s) marked as read.` };
}

export async function deleteNotificationAction(id: number): Promise<ActionResult> {
  const user = await requireUser();
  await execute(`DELETE FROM notifications WHERE id = $1 AND (user_id = $2 OR member_id = $3)`, [id, user.id, user.member_id]);
  revalidatePath('/notifications');
  return { ok: true, message: 'Notification removed.' };
}

