import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, Users, CheckCircle2, Clock, MapPin } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput, SelectFilter } from '../ui/client';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { fmtDate, fmtTime } from '@/lib/dates';
import { NewMeetingButton, MEETING_TYPES } from '../forms/meeting-forms';

const PER_PAGE = 15;

const STATUS_TONES: Record<string, string> = {
  scheduled: 'badge badge-blue',
  ongoing: 'badge badge-gold',
  completed: 'badge badge-green',
  cancelled: 'badge badge-grey',
};

export default async function MeetingsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!can(user, 'meetings.view') && !user.member_id) redirect('/dashboard');

  const staff = !isMember(user);
  const canCreate = can(user, 'meetings.create');

  const search = String(sp.search || sp.q || '').trim();
  const type = String(sp.type || '');
  const status = String(sp.status || '');
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const params: any[] = [];
  const where: string[] = ['1=1'];
  // Members and parish-scoped staff see their parish meetings.
  if (!staff || user.scope_parish_id) {
    const pid = user.scope_parish_id;
    if (pid) {
      params.push(Number(pid));
      where.push(`(mt.parish_id = $${params.length} OR mt.parish_id IS NULL)`);
    }
  }
  if (type) {
    params.push(type);
    where.push(`mt.meeting_type = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`mt.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(mt.title ILIKE $${params.length} OR mt.venue ILIKE $${params.length})`);
  }
  const whereSql = where.join(' AND ');

  const [meetings, countRow, stats, parishes, churches] = await Promise.all([
    query<any>(
      `SELECT mt.*,
              (SELECT count(*)::int FROM attendance a WHERE a.meeting_id = mt.id) AS total_members,
              (SELECT count(*)::int FROM attendance a WHERE a.meeting_id = mt.id AND a.status IN ('present','late')) AS present_count,
              p.name AS parish_name
         FROM meetings mt
         LEFT JOIN parishes p ON p.id = mt.parish_id
        WHERE ${whereSql}
        ORDER BY mt.meeting_date DESC, mt.id DESC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(`SELECT count(*)::int AS total FROM meetings mt WHERE ${whereSql}`, params),
    one<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'scheduled')::int AS upcoming,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE meeting_date >= CURRENT_DATE)::int AS future
         FROM meetings mt WHERE ${whereSql}`,
      params,
    ),
    staff && canCreate ? query<any>(`SELECT id, name FROM parishes ORDER BY name`) : Promise.resolve([] as any[]),
    staff && canCreate ? query<any>(`SELECT id, name FROM churches ORDER BY name`) : Promise.resolve([] as any[]),
  ]);

  const total = Number(countRow?.total || 0);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Meetings & attendance"
        subtitle="CMA meetings, General Assemblies and committees — with attendance tracking and member self check-in."
        action={canCreate ? <NewMeetingButton parishes={parishes.map((p: any) => ({ value: Number(p.id), label: p.name }))} churches={churches.map((c: any) => ({ value: Number(c.id), label: c.name }))} /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Meetings" value={String(stats?.total || 0)} tone="navy" icon={<CalendarDays className="h-4 w-4" />} sub={`${stats?.completed || 0} completed`} />
        <StatCard label="Upcoming" value={String(stats?.future || 0)} tone="blue" icon={<Clock className="h-4 w-4" />} sub={`${stats?.upcoming || 0} scheduled`} />
        <StatCard label="Completed" value={String(stats?.completed || 0)} tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="On this page" value={String(meetings.length)} tone="slate" icon={<Users className="h-4 w-4" />} />
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader title="Meetings" subtitle={`${total} meeting${total === 1 ? '' : 's'}`} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SearchInput param="search" placeholder="Search meetings…" />
            <SelectFilter param="type" placeholder="All types" options={MEETING_TYPES} />
            <SelectFilter param="status" placeholder="All statuses" options={[
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'ongoing', label: 'Ongoing' },
              { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]} />
          </div>
        </div>

        {meetings.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No meetings" description={canCreate ? 'Schedule a meeting to notify members and track attendance.' : 'Meetings will appear here when scheduled.'} />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Meeting</Th>
                <Th>Type</Th>
                <Th>Date & time</Th>
                <Th>Venue</Th>
                <Th>Attendance</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m: any) => {
                const pct = m.total_members > 0 ? Math.round((m.present_count / m.total_members) * 100) : 0;
                return (
                  <tr key={m.id}>
                    <Td>
                      <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/meetings/${m.id}`}>{m.title}</Link>
                      {m.parish_name ? <span className="block text-[11px] text-slate-400">{m.parish_name}</span> : null}
                    </Td>
                    <Td className="text-xs text-slate-600">{String(m.meeting_type).replace(/_/g, ' ')}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">
                      {fmtDate(m.meeting_date)}
                      {m.start_time ? <span className="block text-[11px] text-slate-400">{fmtTime(m.start_time)}{m.end_time ? `–${fmtTime(m.end_time)}` : ''}</span> : null}
                    </Td>
                    <Td className="text-xs text-slate-600">{m.venue ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{m.venue}</span> : '—'}</Td>
                    <Td>
                      <span className="text-xs font-semibold text-navy-900">{m.present_count}/{m.total_members}</span>
                      <span className="ml-1 text-[11px] text-slate-400">({pct}%)</span>
                    </Td>
                    <Td><Badge tone={STATUS_TONES[m.status] || 'badge badge-grey'}>{m.status}</Badge></Td>
                    <Td align="right">
                      <Link href={`/meetings/${m.id}`} className="btn btn-ghost btn-sm">{m.status === 'completed' ? 'View' : 'Manage'}</Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="px-4 pb-4">
          <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/meetings" query={{ search, type, status }} />
        </div>
      </Card>
    </div>
  );
}
