import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, CalendarDays, MapPin, Clock, Users, UserCheck, ClipboardCheck } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, KeyValue, ProgressBar, SectionHeading, StatCard } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { fmtDate, fmtTime, fmtDateTime } from '@/lib/dates';
import { AttendanceSheet, SelfCheckInButton, EditMeetingButton, MeetingStatusSelect, type AttendanceRow } from '../forms/meeting-forms';

const STATUS_TONES: Record<string, string> = {
  scheduled: 'badge badge-blue',
  ongoing: 'badge badge-gold',
  completed: 'badge badge-green',
  cancelled: 'badge badge-grey',
};

export default async function MeetingDetailPage({ id, user }: { id: number; user: SessionUser }) {
  const meeting = await one<any>(
    `SELECT mt.*, p.name AS parish_name, c.name AS church_name
       FROM meetings mt
       LEFT JOIN parishes p ON p.id = mt.parish_id
       LEFT JOIN churches c ON c.id = mt.church_id
      WHERE mt.id = $1`,
    [id],
  );
  if (!meeting) notFound();
  if (!can(user, 'meetings.view') && !user.member_id) redirect('/meetings');

  const member = isMember(user);
  const canMark = can(user, 'attendance.update') || can(user, 'attendance.create');
  const canEdit = can(user, 'meetings.update');

  const [attendance, parishes, churches] = await Promise.all([
    query<any>(
      `SELECT a.*, m.full_name, m.membership_no, m.id AS member_id
         FROM attendance a JOIN members m ON m.id = a.member_id
        WHERE a.meeting_id = $1 ORDER BY m.full_name`,
      [id],
    ),
    canEdit ? query<any>(`SELECT id, name FROM parishes ORDER BY name`) : Promise.resolve([] as any[]),
    canEdit ? query<any>(`SELECT id, name FROM churches ORDER BY name`) : Promise.resolve([] as any[]),
  ]);

  const counts = attendance.reduce(
    (acc: any, a: any) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    },
    { present: 0, late: 0, apology: 0, absent: 0 },
  );
  const totalMembers = attendance.length;
  const present = (counts.present || 0) + (counts.late || 0);
  const rate = totalMembers > 0 ? Math.round((present / totalMembers) * 100) : 0;

  const myAttendance = user.member_id ? attendance.find((a: any) => Number(a.member_id) === Number(user.member_id)) : null;
  const canCheckIn = member && meeting.attendance_open && !['completed', 'cancelled'].includes(meeting.status);

  const rows: AttendanceRow[] = attendance.map((a: any) => ({
    memberId: Number(a.member_id),
    fullName: a.full_name,
    membershipNo: a.membership_no,
    status: a.status,
    remarks: a.remarks,
  }));

  return (
    <div className="space-y-5">
      <SectionHeading
        title={meeting.title}
        subtitle={`${String(meeting.meeting_type).replace(/_/g, ' ')} · ${fmtDate(meeting.meeting_date)}${meeting.start_time ? ` at ${fmtTime(meeting.start_time)}` : ''}${meeting.venue ? ` · ${meeting.venue}` : ''}`}
        action={
          <>
            <Link href="/meetings" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> All meetings</Link>
            {canEdit ? <EditMeetingButton meeting={meeting} parishes={parishes.map((p: any) => ({ value: Number(p.id), label: p.name }))} churches={churches.map((c: any) => ({ value: Number(c.id), label: c.name }))} /> : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Present" value={String(present)} tone="green" icon={<UserCheck className="h-4 w-4" />} sub={`${counts.present || 0} on time · ${counts.late || 0} late`} />
        <StatCard label="Apologies" value={String(counts.apology || 0)} tone="gold" icon={<Users className="h-4 w-4" />} />
        <StatCard label="Absent" value={String(counts.absent || 0)} tone="red" icon={<ClipboardCheck className="h-4 w-4" />} />
        <StatCard label="Attendance rate" value={`${rate}%`} tone="navy" icon={<CalendarDays className="h-4 w-4" />} sub={`of ${totalMembers} members`} progress={{ value: present, total: totalMembers || 1 }} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader
            title="Meeting details"
            action={<Badge tone={STATUS_TONES[meeting.status] || 'badge badge-grey'}>{meeting.status}</Badge>}
          />
          <KeyValue
            columns={1}
            items={[
              ['Date', fmtDate(meeting.meeting_date)],
              ['Time', meeting.start_time ? `${fmtTime(meeting.start_time)}${meeting.end_time ? ` – ${fmtTime(meeting.end_time)}` : ''}` : '—'],
              ['Venue', meeting.venue || '—'],
              ['Parish', meeting.parish_name || '—'],
              ['Church', meeting.church_name || '—'],
              ['Chairperson', meeting.chairperson || '—'],
              ['Secretary', meeting.secretary || '—'],
              ['Self check-in', meeting.attendance_open ? 'Open' : 'Closed'],
            ]}
          />
          {meeting.agenda ? (
            <div className="mt-3">
              <p className="label">Agenda</p>
              <p className="whitespace-pre-line text-sm text-slate-600">{meeting.agenda}</p>
            </div>
          ) : null}
          {meeting.minutes ? (
            <div className="mt-3">
              <p className="label">Minutes</p>
              <p className="whitespace-pre-line text-sm text-slate-600">{meeting.minutes}</p>
            </div>
          ) : null}
          {canEdit ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="label">Status</p>
              <MeetingStatusSelect meetingId={Number(meeting.id)} current={meeting.status} />
            </div>
          ) : null}
        </Card>

        <Card className="lg:col-span-2" padded={false}>
          <div className="p-4">
            <CardHeader
              title="Attendance"
              subtitle={member ? 'Your check-in status and the meeting summary.' : `${totalMembers} member(s) · mark present, late, apology or absent.`}
              icon={<ClipboardCheck className="h-[18px] w-[18px]" />}
            />
            {member ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Your status</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge tone={myAttendance?.status === 'present' ? 'badge badge-green' : myAttendance?.status === 'late' ? 'badge badge-blue' : myAttendance?.status === 'apology' ? 'badge badge-gold' : 'badge badge-grey'}>
                      {myAttendance?.status || 'not marked'}
                    </Badge>
                    {myAttendance?.check_in_time ? <span className="text-[11px] text-slate-400">checked in {fmtDateTime(myAttendance.check_in_time)}</span> : null}
                  </div>
                  {canCheckIn ? (
                    <div className="mt-3">
                      <SelfCheckInButton meetingId={Number(meeting.id)} requiresCode={Boolean(meeting.qr_code)} />
                    </div>
                  ) : !meeting.attendance_open ? (
                    <p className="mt-2 text-xs text-slate-400">Self check-in is not open for this meeting.</p>
                  ) : null}
                </div>
                <ProgressBar value={present} total={totalMembers || 1} label={`Overall attendance ${rate}%`} />
              </div>
            ) : canMark ? (
              <div className="px-4 pb-4">
                {rows.length === 0 ? (
                  <EmptyState icon={<Users className="h-6 w-6" />} title="No members to mark" description="Attendance rows are prepared when the meeting is scheduled." />
                ) : (
                  <AttendanceSheet meetingId={Number(meeting.id)} rows={rows} />
                )}
              </div>
            ) : (
              <div className="px-4 pb-4">
                <ProgressBar value={present} total={totalMembers || 1} label={`Attendance ${rate}%`} />
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="badge badge-green">{counts.present || 0} present</span>
                  <span className="badge badge-blue">{counts.late || 0} late</span>
                  <span className="badge badge-gold">{counts.apology || 0} apology</span>
                  <span className="badge badge-grey">{counts.absent || 0} absent</span>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
