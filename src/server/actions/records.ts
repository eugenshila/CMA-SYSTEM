'use server';

import { revalidatePath } from 'next/cache';
import { one, query, execute } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify, notifyMembers, notifyRole } from '@/lib/notify';
import { meetingSchema, firstError, formDataToObject } from '@/lib/validators';
import { sqlDate, isoDate } from '@/lib/dates';
import { num } from '@/lib/money';
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
  const channels = formData.getAll('channels').map(String) as any[];
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

export { notifyRole, num };
