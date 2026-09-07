import type { Metadata } from 'next';
import Link from 'next/link';
import { Users, UserPlus, Download, FileSpreadsheet, FileText, Search, Wallet } from 'lucide-react';
import { getCurrentUser, requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { query } from '@/lib/db';
import { memberList } from '@/lib/reports';
import { money, num } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import {
  Card, CardHeader, SectionHeading, Table, Th, Td, StatusBadge, Avatar, Pagination, EmptyState, Badge, Toolbar,
} from '@/components/ui/primitives';
import { SearchInput, SelectFilter } from '@/components/ui/client';
import { BulkLoginButton } from '@/components/forms/member-forms';

export const metadata: Metadata = { title: 'Members' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('members.view');
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page || 1));
  const filters = {
    search: sp.q || undefined,
    status: sp.status || undefined,
    parishId: sp.parish ? Number(sp.parish) : user.scope_parish_id,
    churchId: sp.church ? Number(sp.church) : undefined,
    sccId: sp.scc ? Number(sp.scc) : undefined,
    contributionStatus: sp.contribution || undefined,
    loanStatus: sp.loan || undefined,
    sacco: sp.sacco || undefined,
    sort: sp.sort || 'membership_no',
    dir: (sp.dir === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [list, parishes, churches, communities, summary] = await Promise.all([
    memberList(filters),
    query<any>('SELECT id, name FROM parishes WHERE active = TRUE ORDER BY name'),
    query<any>('SELECT id, name, parish_id FROM churches WHERE active = TRUE ORDER BY name'),
    query<any>('SELECT id, name, parish_id FROM small_christian_communities WHERE active = TRUE ORDER BY name'),
    query<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE membership_status = 'active')::int AS active,
              count(*) FILTER (WHERE membership_status = 'pending')::int AS pending,
              count(*) FILTER (WHERE exempt_monthly)::int AS exempted
         FROM members WHERE deleted_at IS NULL`,
    ),
  ]);

  const noLogin = can(user, 'users.create')
    ? await query<any>(
        `SELECT id, membership_no, full_name FROM members
          WHERE deleted_at IS NULL AND user_id IS NULL AND membership_status = 'active'
          ORDER BY membership_no LIMIT 200`,
      )
    : [];

  const stats = summary[0] || { total: 0, active: 0, pending: 0, exempted: 0 };

  const contributedRows = list.rows.length
    ? await query<any>(
        `SELECT member_id, COALESCE(SUM(amount_paid),0)::float AS paid
           FROM member_contributions WHERE member_id = ANY($1::bigint[]) GROUP BY member_id`,
        [list.rows.map((r: any) => r.id)],
      )
    : [];
  const contributed = new Map<number, number>(contributedRows.map((r) => [Number(r.member_id), Number(r.paid || 0)]));
  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    Object.entries({ ...sp, ...extra }).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    return params.toString();
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Member directory"
        subtitle={`${stats.total} registered · ${stats.active} active · ${stats.pending} pending approval`}
        action={
          <>
            {noLogin.length ? (
              <BulkLoginButton members={noLogin.map((m) => ({ id: m.id, label: `${m.membership_no} — ${m.full_name}` }))} />
            ) : null}
            <Link href={`/api/exports/members?${qs({ format: 'xlsx' })}`} className="btn-outline btn-sm">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Link>
            <Link href={`/api/exports/members?${qs({ format: 'csv' })}`} className="btn-outline btn-sm">
              <Download className="h-4 w-4" /> CSV
            </Link>
            <Link href={`/api/exports/members?${qs({ format: 'pdf' })}`} className="btn-outline btn-sm">
              <FileText className="h-4 w-4" /> PDF
            </Link>
            {can(user, 'members.create') ? (
              <Link href="/members/new" className="btn-primary btn-sm">
                <UserPlus className="h-4 w-4" /> Register member
              </Link>
            ) : null}
          </>
        }
      />

      <Card>
        <Toolbar className="gap-2">
          <SearchInput placeholder="Search name, CMA no, phone, email, area…" className="min-w-[220px] flex-1" />
          <SelectFilter
            param="status"
            placeholder="Any status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'pending', label: 'Pending approval' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'transferred', label: 'Transferred' },
              { value: 'resigned', label: 'Resigned' },
              { value: 'deceased', label: 'Deceased' },
            ]}
          />
          <SelectFilter param="parish" placeholder="All parishes" options={parishes.map((p) => ({ value: String(p.id), label: p.name }))} />
          <SelectFilter param="church" placeholder="All churches" options={churches.map((c) => ({ value: String(c.id), label: c.name }))} />
          <SelectFilter param="scc" placeholder="All SCCs" options={communities.map((c) => ({ value: String(c.id), label: c.name }))} />
          <SelectFilter
            param="contribution"
            placeholder="Any contribution status"
            options={[
              { value: 'paid', label: 'Paid up' },
              { value: 'partial', label: 'Partially paid' },
              { value: 'unpaid', label: 'Unpaid' },
              { value: 'overdue', label: 'Overdue' },
              { value: 'exempted', label: 'Exempted' },
            ]}
          />
          <SelectFilter
            param="loan"
            placeholder="Loans"
            options={[
              { value: 'active', label: 'Has active loan' },
              { value: 'completed', label: 'Completed loans' },
              { value: 'none', label: 'No loan' },
            ]}
          />
          <SelectFilter
            param="sacco"
            placeholder="SDP / Sacco"
            options={[
              { value: 'with_account', label: 'Has sacco account' },
              { value: 'with_savings', label: 'Has savings' },
              { value: 'with_shares', label: 'Has shares' },
            ]}
          />
          <SelectFilter
            param="sort"
            placeholder="Sort: CMA no"
            options={[
              { value: 'membership_no', label: 'Sort: CMA number' },
              { value: 'name', label: 'Sort: name' },
              { value: 'date_joined', label: 'Sort: date joined' },
              { value: 'savings', label: 'Sort: savings' },
              { value: 'shares', label: 'Sort: shares' },
              { value: 'outstanding', label: 'Sort: outstanding' },
            ]}
          />
        </Toolbar>
      </Card>

      {list.rows.length ? (
        <Card padded={false}>
          <div className="hidden lg:block">
            <Table>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Contact</Th>
                  <Th>Church / SCC</Th>
                  <Th>Status</Th>
                  <Th align="right">Contributed</Th>
                  <Th align="right">Outstanding</Th>
                  <Th align="right">Savings</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">Loan</Th>
                  <Th align="center">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((m: any) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.full_name} src={m.photo_url} size={36} />
                        <div className="min-w-0">
                          <Link href={`/members/${m.id}`} className="block truncate text-sm font-bold text-navy-900 hover:underline">
                            {m.full_name}
                          </Link>
                          <span className="block text-[11px] text-slate-500">{m.membership_no} · joined {fmtDate(m.date_joined)}</span>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className="block text-xs text-slate-700">{m.phone}</span>
                      <span className="block truncate text-[11px] text-slate-400">{m.email || m.residential_area || '—'}</span>
                    </Td>
                    <Td>
                      <span className="block truncate text-xs text-slate-700">{m.church_name || m.parish_name}</span>
                      <span className="block truncate text-[11px] text-slate-400">{m.scc_name ? `SCC ${m.scc_name}` : m.parish_name}</span>
                    </Td>
                    <Td>
                      <StatusBadge status={m.membership_status} />
                      {m.unpaid_periods > 0 ? <span className="badge-amber mt-1 block w-fit">{m.unpaid_periods} unpaid</span> : null}
                    </Td>
                    <Td align="right">{money(contributed.get(Number(m.id)) || 0)}</Td>
                    <Td align="right" className={num(m.contribution_outstanding) > 0 ? 'text-red-600' : 'text-emerald-600'}>
                      {money(m.contribution_outstanding)}
                    </Td>
                    <Td align="right">{money(m.savings_balance)}</Td>
                    <Td align="right">
                      {m.shares_count}
                      <span className="block text-[10px] font-normal text-slate-400">{money(m.share_capital)}</span>
                    </Td>
                    <Td align="right" className={num(m.loan_arrears) > 0 ? 'text-red-600' : ''}>
                      {money(m.loan_outstanding)}
                      {m.active_loans ? <span className="block text-[10px] font-normal text-slate-400">{m.active_loans} active</span> : null}
                    </Td>
                    <Td align="center">
                      <div className="flex items-center justify-center gap-1">
                        <Link href={`/members/${m.id}`} className="btn-ghost btn-sm" title="Open profile">
                          <Users className="h-3.5 w-3.5" />
                        </Link>
                        {can(user, 'payments.create') ? (
                          <Link href={`/payments/new?member=${m.id}`} className="btn-ghost btn-sm" title="Record payment">
                            <Wallet className="h-3.5 w-3.5" />
                          </Link>
                        ) : null}
                        {can(user, 'members.update') ? (
                          <Link href={`/members/${m.id}/edit`} className="btn-ghost btn-sm" title="Edit">
                            Edit
                          </Link>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {/* mobile cards */}
          <ul className="divide-y divide-slate-100 lg:hidden">
            {list.rows.map((m: any) => (
              <li key={m.id} className="p-3">
                <Link href={`/members/${m.id}`} className="flex items-start gap-3">
                  <Avatar name={m.full_name} src={m.photo_url} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-navy-900">{m.full_name}</p>
                        <p className="truncate text-[11px] text-slate-500">{m.membership_no} · {m.phone}</p>
                      </div>
                      <StatusBadge status={m.membership_status} />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <p className="text-[9px] uppercase text-slate-400">Savings</p>
                        <p className="text-[11px] font-bold tabular-nums">{money(m.savings_balance)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <p className="text-[9px] uppercase text-slate-400">Shares</p>
                        <p className="text-[11px] font-bold tabular-nums">{m.shares_count}</p>
                      </div>
                      <div className={`rounded-lg px-2 py-1.5 ${num(m.contribution_outstanding) > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                        <p className="text-[9px] uppercase text-slate-400">Owes</p>
                        <p className={`text-[11px] font-bold tabular-nums ${num(m.contribution_outstanding) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {money(m.contribution_outstanding)}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="px-4 pb-2">
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} basePath="/members" query={sp as any} />
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No members match these filters"
          description="Try clearing the search box or filters, or register a new member."
          icon={<Search className="h-5 w-5" />}
          action={
            can(user, 'members.create') ? (
              <Link href="/members/new" className="btn-primary btn-sm">
                <UserPlus className="h-4 w-4" /> Register member
              </Link>
            ) : (
              <Link href="/members" className="btn-outline btn-sm">Clear filters</Link>
            )
          }
        />
      )}

      <Card>
        <CardHeader title="Register summary" subtitle="Live counts across the association" icon={<Users className="h-[18px] w-[18px]" />} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Total members" value={stats.total} />
          <MiniStat label="Active" value={stats.active} tone="green" />
          <MiniStat label="Pending approval" value={stats.pending} tone="amber" />
          <MiniStat label="Exempted" value={stats.exempted} tone="slate" />
        </div>
      </Card>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' | 'slate' }) {
  const tones: Record<string, string> = { green: 'text-emerald-600', amber: 'text-amber-600', slate: 'text-slate-600' };
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold tabular-nums ${tone ? tones[tone] : 'text-navy-900'}`}>{value}</p>
    </div>
  );
}

