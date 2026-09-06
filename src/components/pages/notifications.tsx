import Link from 'next/link';
import { Bell, CheckCheck, AlertTriangle, Wallet, Landmark, HeartPulse, CalendarDays, Users, Info } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, SectionHeading, StatCard } from '../ui/primitives';
import { SelectFilter } from '../ui/client';
import { one, query } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { fmtDateTime, relativeTime } from '@/lib/dates';
import { MarkReadButton, DeleteNotificationButton, MarkAllReadButton } from '../forms/notification-actions';

const CATEGORY_META: Record<string, { icon: any; tone: string }> = {
  loan: { icon: Landmark, tone: 'badge badge-blue' },
  payment: { icon: Wallet, tone: 'badge badge-green' },
  contribution: { icon: Wallet, tone: 'badge badge-green' },
  welfare: { icon: HeartPulse, tone: 'badge badge-gold' },
  funeral: { icon: HeartPulse, tone: 'badge badge-grey' },
  meeting: { icon: CalendarDays, tone: 'badge badge-blue' },
  attendance: { icon: Users, tone: 'badge badge-blue' },
  member: { icon: Users, tone: 'badge badge-grey' },
  system: { icon: Info, tone: 'badge badge-grey' },
  general: { icon: Bell, tone: 'badge badge-grey' },
};

export default async function NotificationsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  const unreadOnly = String(sp.unread || '') === '1';
  const category = String(sp.category || '');

  const params: any[] = [user.id, user.member_id ?? null];
  const where: string[] = [`(n.user_id = $1 OR (n.member_id = $2 AND $2 IS NOT NULL))`];
  if (unreadOnly) where.push('n.read_at IS NULL');
  if (category) {
    params.push(category);
    where.push(`n.category = $${params.length}`);
  }
  const whereSql = where.join(' AND ');

  const [notifications, stats, categories] = await Promise.all([
    query<any>(
      `SELECT n.* FROM notifications n WHERE ${whereSql} ORDER BY n.read_at IS NULL DESC, n.created_at DESC LIMIT 200`,
      params,
    ),
    one<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE read_at IS NULL)::int AS unread
         FROM notifications n WHERE (n.user_id = $1 OR (n.member_id = $2 AND $2 IS NOT NULL))`,
      [user.id, user.member_id ?? null],
    ),
    query<any>(
      `SELECT DISTINCT category FROM notifications n
        WHERE (n.user_id = $1 OR (n.member_id = $2 AND $2 IS NOT NULL)) AND category IS NOT NULL ORDER BY category`,
      [user.id, user.member_id ?? null],
    ),
  ]);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Notifications"
        subtitle="Alerts about your contributions, loans, meetings and membership. Unread items appear first."
        action={<MarkAllReadButton count={Number(stats?.unread || 0)} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Unread" value={String(stats?.unread || 0)} tone={(stats?.unread || 0) > 0 ? 'gold' : 'slate'} icon={<Bell className="h-4 w-4" />} />
        <StatCard label="Total notifications" value={String(stats?.total || 0)} tone="navy" icon={<CheckCheck className="h-4 w-4" />} />
        <StatCard label="Categories" value={String(categories.length)} tone="green" icon={<Info className="h-4 w-4" />} />
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader title="Inbox" subtitle={`${notifications.length} shown`} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SelectFilter
              param="category"
              placeholder="All categories"
              options={categories.map((c: any) => ({ value: c.category, label: String(c.category).replace(/_/g, ' ').replace(/\b\w/g, (x: string) => x.toUpperCase()) }))}
            />
            <SelectFilter param="unread" placeholder="Read + unread" options={[{ value: '1', label: 'Unread only' }]} />
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description={unreadOnly ? 'You have no unread notifications.' : 'Notifications about your activity will appear here.'} />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notifications.map((n: any) => {
              const meta = CATEGORY_META[n.category] || CATEGORY_META.general;
              const Icon = meta.icon;
              const unread = !n.read_at;
              const inner = (
                <>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${unread ? 'bg-gold-100 text-gold-700' : 'bg-slate-100 text-slate-500'}`}>
                    {n.priority === 'high' ? <AlertTriangle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm ${unread ? 'font-semibold text-navy-900' : 'font-medium text-slate-700'}`}>{n.title}</p>
                      <Badge tone={meta.tone}>{String(n.category || 'general')}</Badge>
                      {n.priority === 'high' ? <Badge tone="badge badge-red">high</Badge> : null}
                      {unread ? <span className="h-2 w-2 rounded-full bg-gold-500" title="Unread" /> : null}
                    </div>
                    {n.body ? <p className="mt-0.5 text-xs text-slate-600">{n.body}</p> : null}
                    <p className="mt-1 text-[11px] text-slate-400" title={fmtDateTime(n.created_at)}>{relativeTime(n.created_at)}</p>
                  </div>
                </>
              );
              return (
                <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${unread ? 'bg-gold-50/30' : ''}`}>
                  {n.link ? (
                    <Link href={n.link} className="flex min-w-0 flex-1 items-start gap-3 hover:opacity-90">
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-start gap-3">{inner}</div>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    {unread ? <MarkReadButton id={Number(n.id)} /> : null}
                    <DeleteNotificationButton id={Number(n.id)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
