import Link from 'next/link';
import { redirect } from 'next/navigation';
import { History, Download, ShieldAlert, ArrowLeft } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput, SelectFilter, DateRangeFilter } from '../ui/client';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { fmtDateTime, relativeTime } from '@/lib/dates';
import { PurgeAuditButton } from '../forms/admin-forms';

const PER_PAGE = 40;

const SEVERITY_TONE: Record<string, string> = {
  info: 'badge badge-blue',
  warning: 'badge badge-gold',
  critical: 'badge badge-red',
  error: 'badge badge-red',
};

export default async function AdminAuditPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!can(user, 'audit.view')) redirect('/dashboard');

  const search = String(sp.search || sp.q || '').trim();
  const severity = String(sp.severity || '');
  const from = String(sp.from || '');
  const to = String(sp.to || '');
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const params: any[] = [];
  const where: string[] = ['1=1'];
  if (severity) { params.push(severity); where.push(`severity = $${params.length}`); }
  if (from) { params.push(from); where.push(`created_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`created_at < ($${params.length}::date + interval '1 day')`); }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(action ILIKE $${params.length} OR user_name ILIKE $${params.length} OR entity_label ILIKE $${params.length} OR entity_type ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }
  const whereSql = where.join(' AND ');

  const [rows, countRow, stats] = await Promise.all([
    query<any>(
      `SELECT id, user_id, user_name, action, entity_type, entity_id, entity_label, description,
              ip_address, severity, created_at
         FROM audit_logs WHERE ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(`SELECT count(*)::int AS total FROM audit_logs WHERE ${whereSql}`, params),
    one<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE severity = 'critical' OR severity = 'error')::int AS critical,
              count(*) FILTER (WHERE severity = 'warning')::int AS warning,
              count(DISTINCT user_id)::int AS actors
         FROM audit_logs WHERE ${whereSql}`,
      params,
    ),
  ]);

  const total = Number(countRow?.total || 0);
  const qs: Record<string, string | number | undefined> = { search: search || undefined, severity: severity || undefined, from: from || undefined, to: to || undefined };
  const exportHref = `/api/exports/audit?format=excel${severity ? `&severity=${encodeURIComponent(severity)}` : ''}${from ? `&from=${encodeURIComponent(from)}` : ''}${to ? `&to=${encodeURIComponent(to)}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Audit trail"
        subtitle="An immutable log of every significant action — logins, record changes, approvals, payments, settings and exports. Financial transactions are never hard-deleted."
        action={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm"><ArrowLeft className="h-4 w-4" /> Admin</Link>
            {can(user, 'audit.export') && <a className="btn btn-outline btn-sm" href={exportHref}><Download className="h-4 w-4" /> Export</a>}
            {can(user, 'users.manage') && <PurgeAuditButton />}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Log entries" value={String(stats?.total || 0)} tone="navy" icon={<History className="h-4 w-4" />} sub={`${stats?.actors || 0} actor(s)`} />
        <StatCard label="Critical" value={String(stats?.critical || 0)} tone={(stats?.critical || 0) > 0 ? 'red' : 'slate'} icon={<ShieldAlert className="h-4 w-4" />} />
        <StatCard label="Warnings" value={String(stats?.warning || 0)} tone={(stats?.warning || 0) > 0 ? 'gold' : 'slate'} icon={<ShieldAlert className="h-4 w-4" />} />
        <StatCard label="On this page" value={String(rows.length)} tone="slate" icon={<History className="h-4 w-4" />} />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput param="search" placeholder="Search action, user, entity or description…" extraParams={{ severity, from, to }} className="sm:max-w-xs" />
          <SelectFilter param="severity" placeholder="All severities" options={[
            { value: 'info', label: 'Info' },
            { value: 'warning', label: 'Warning' },
            { value: 'critical', label: 'Critical' },
          ]} />
          <DateRangeFilter />
        </div>

        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No audit entries" description="No actions match the current filters." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Description</Th>
                  <Th>Severity</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      <div className="text-xs font-medium text-navy-900">{fmtDateTime(r.created_at)}</div>
                      <div className="text-[11px] text-slate-400">{relativeTime(r.created_at)}</div>
                    </Td>
                    <Td className="text-xs text-slate-700">{r.user_name || <span className="text-slate-400">system</span>}</Td>
                    <Td><code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-navy-800">{r.action}</code></Td>
                    <Td className="text-xs text-slate-600">
                      {r.entity_type ? <span className="text-slate-400">{r.entity_type}</span> : null}
                      {r.entity_label ? <div className="font-medium text-navy-800">{r.entity_label}</div> : null}
                    </Td>
                    <Td className="max-w-[280px] text-xs text-slate-600"><span className="line-clamp-2">{r.description || '—'}</span></Td>
                    <Td><span className={SEVERITY_TONE[r.severity] || 'badge badge-grey'}>{r.severity || 'info'}</span></Td>
                    <Td className="whitespace-nowrap text-[11px] text-slate-400">{r.ip_address || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {total > PER_PAGE && (
          <div className="border-t border-slate-100 p-3">
            <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/admin/audit" query={qs} />
          </div>
        )}
      </Card>
    </div>
  );
}
