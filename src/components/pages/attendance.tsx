import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ClipboardCheck, CalendarDays, UserCheck, TrendingUp, Award } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, ProgressBar, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SelectFilter } from '../ui/client';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { fmtDate } from '@/lib/dates';

const STATUS_TONES: Record<string, string> = {
  present: 'badge badge-green',
  late: 'badge badge-blue',
  apology: 'badge badge-gold',
  absent: 'badge badge-grey',
};

export default async function AttendancePage({ user, sp }: { user: SessionUser; sp?: Record<string, string | string[] | undefined> }) {
  if (!can(user, 'attendance.view') && !user.member_id) redirect('/dashboard');

  const member = isMember(user);
  const parishParam = sp ? String(sp.parish || '') : '';
  const parishId = parishParam ? Number(parishParam) : user.scope_parish_id ? Number(user.scope_parish_id) : null;
  const parishFilter = parishId ? `AND (mt.parish_id = ${Number(parishId)} OR mt.parish_id IS NULL)` : user.scope_parish_id ? `AND (mt.parish_id = ${Number(user.scope_parish_id)} OR mt.parish_id IS NULL)` : '';

  if (member) {
    // ---- Member self-service: my attendance history ----
    const [mine, summary] = await Promise.all([
      query<any>(
        `SELECT a.status, a.check_in_time, a.method, mt.id AS meeting_id, mt.title, mt.meeting_date, mt.meeting_type
           FROM attendance a JOIN meetings mt ON mt.id = a.meeting_id
          WHERE a.member_id = $1
          ORDER BY mt.meeting_date DESC LIMIT 100`,
        [user.member_id],
      ),
      one<any>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE a.status IN ('present','late'))::int AS attended,
                count(*) FILTER (WHERE a.status = 'apology')::int AS apologies
           FROM attendance a WHERE a.member_id = $1`,
        [user.member_id],
      ),
    ]);
    const rate = summary?.total ? Math.round((Number(summary.attended) / Number(summary.total)) * 100) : 0;

    return (
      <div className="space-y-5">
        <SectionHeading title="My attendance" subtitle="Your presence record across CMA meetings." action={<Link href="/meetings" className="btn btn-outline btn-sm"><CalendarDays className="h-4 w-4" /> Meetings</Link>} />
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Meetings recorded" value={String(summary?.total || 0)} tone="navy" icon={<CalendarDays className="h-4 w-4" />} />
          <StatCard label="Attended" value={String(summary?.attended || 0)} tone="green" icon={<UserCheck className="h-4 w-4" />} sub={`${summary?.apologies || 0} apology(ies)`} />
          <StatCard label="Attendance rate" value={`${rate}%`} tone={rate >= 75 ? 'green' : rate >= 50 ? 'gold' : 'red'} icon={<TrendingUp className="h-4 w-4" />} progress={{ value: rate, total: 100 }} />
        </div>
        <Card padded={false}>
          <div className="p-4"><CardHeader title="Attendance history" subtitle={`${mine.length} meeting(s)`} /></div>
          {mine.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="No attendance yet" description="Your presence will be recorded as meetings are held." /></div>
          ) : (
            <Table>
              <thead><tr><Th>Meeting</Th><Th>Type</Th><Th>Date</Th><Th>Checked in</Th><Th>Status</Th></tr></thead>
              <tbody>
                {mine.map((a: any, i: number) => (
                  <tr key={i}>
                    <Td><Link className="font-medium text-navy-800 hover:text-gold-700" href={`/meetings/${a.meeting_id}`}>{a.title}</Link></Td>
                    <Td className="text-xs text-slate-600">{String(a.meeting_type).replace(/_/g, ' ')}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(a.meeting_date)}</Td>
                    <Td className="text-xs text-slate-500">{a.check_in_time ? new Date(a.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</Td>
                    <Td><Badge tone={STATUS_TONES[a.status] || 'badge badge-grey'}>{a.status}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    );
  }

  // ---- Staff: parish-wide attendance overview ----
  const [byMeeting, leaders, overall, parishes] = await Promise.all([
    query<any>(
      `SELECT mt.id, mt.title, mt.meeting_date, mt.meeting_type, mt.status,
              (SELECT count(*)::int FROM attendance a WHERE a.meeting_id = mt.id) AS total_members,
              (SELECT count(*)::int FROM attendance a WHERE a.meeting_id = mt.id AND a.status IN ('present','late')) AS present
         FROM meetings mt
        WHERE 1=1 ${parishFilter}
        ORDER BY mt.meeting_date DESC LIMIT 15`,
    ),
    query<any>(
      `SELECT m.id, m.full_name, m.membership_no,
              count(*)::int AS meetings,
              count(*) FILTER (WHERE a.status IN ('present','late'))::int AS attended
         FROM attendance a JOIN members m ON m.id = a.member_id
         JOIN meetings mt ON mt.id = a.meeting_id
        WHERE 1=1 ${parishFilter}
        GROUP BY m.id, m.full_name, m.membership_no
        HAVING count(*) >= 3
        ORDER BY (count(*) FILTER (WHERE a.status IN ('present','late'))::float / count(*)) DESC, attended DESC
        LIMIT 10`,
    ),
    one<any>(
      `SELECT count(DISTINCT mt.id)::int AS meetings,
              count(*)::int AS records,
              count(*) FILTER (WHERE a.status IN ('present','late'))::int AS present,
              count(*) FILTER (WHERE a.status = 'absent')::int AS absent
         FROM attendance a JOIN meetings mt ON mt.id = a.meeting_id WHERE 1=1 ${parishFilter}`,
    ),
    query<any>('SELECT id, name FROM parishes WHERE active = TRUE ORDER BY id'),
  ]);

  const overallRate = overall?.records ? Math.round((Number(overall.present) / Number(overall.records)) * 100) : 0;

  return (
    <div className="space-y-5">
      <SectionHeading title="Attendance" subtitle="Meeting-by-meeting attendance and member participation — St Joseph Mukasa Kahawa West / St Peter and Paul Marengeta / St Francis of Asisi Soweto." action={
        <div className="flex items-center gap-2">
          {!member ? <SelectFilter param="parish" placeholder="All parishes" className="w-56" options={parishes.map((p: any) => ({ value: String(p.id), label: p.name }))} /> : null}
          <Link href="/meetings" className="btn btn-outline btn-sm"><CalendarDays className="h-4 w-4" /> Meetings</Link>
        </div>
      } />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Meetings tracked" value={String(overall?.meetings || 0)} tone="navy" icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Attendance records" value={String(overall?.records || 0)} tone="slate" icon={<ClipboardCheck className="h-4 w-4" />} />
        <StatCard label="Overall rate" value={`${overallRate}%`} tone={overallRate >= 75 ? 'green' : overallRate >= 50 ? 'gold' : 'red'} icon={<TrendingUp className="h-4 w-4" />} progress={{ value: overallRate, total: 100 }} />
        <StatCard label="Present marks" value={String(overall?.present || 0)} tone="green" icon={<UserCheck className="h-4 w-4" />} sub={`${overall?.absent || 0} absent`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <div className="p-4"><CardHeader title="Recent meetings" subtitle="Attendance per meeting" /></div>
          {byMeeting.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No meetings" description="Schedule meetings to start tracking attendance." /></div>
          ) : (
            <Table>
              <thead><tr><Th>Meeting</Th><Th>Date</Th><Th>Attendance</Th><Th>Rate</Th><Th align="right">Sheet</Th></tr></thead>
              <tbody>
                {byMeeting.map((m: any) => {
                  const pct = m.total_members > 0 ? Math.round((m.present / m.total_members) * 100) : 0;
                  return (
                    <tr key={m.id}>
                      <Td>
                        <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/meetings/${m.id}`}>{m.title}</Link>
                        <span className="block text-[11px] text-slate-400">{String(m.meeting_type).replace(/_/g, ' ')}</span>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(m.meeting_date)}</Td>
                      <Td className="text-xs font-semibold text-navy-900">{m.present}/{m.total_members}</Td>
                      <Td><div className="w-24"><ProgressBar value={m.present} total={m.total_members || 1} /></div></Td>
                      <Td align="right"><Link href={`/meetings/${m.id}`} className="btn btn-ghost btn-sm">Open</Link></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-4"><CardHeader title="Most active members" subtitle="By attendance rate (min. 3 meetings)" icon={<Award className="h-[18px] w-[18px]" />} /></div>
          {leaders.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<Award className="h-6 w-6" />} title="Not enough data" description="Members appear here after attending at least 3 meetings." /></div>
          ) : (
            <ol className="divide-y divide-slate-100 px-4 pb-4">
              {leaders.map((l: any, i: number) => {
                const pct = Math.round((Number(l.attended) / Number(l.meetings)) * 100);
                return (
                  <li key={l.id} className="flex items-center gap-3 py-2">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? 'bg-gold-100 text-gold-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/members/${l.id}`} className="block truncate text-sm font-medium text-slate-700 hover:text-navy-800">{l.full_name}</Link>
                      <span className="text-[11px] text-slate-400">{l.attended}/{l.meetings} meetings</span>
                    </div>
                    <span className="text-sm font-semibold text-navy-900">{pct}%</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
