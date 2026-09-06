import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wallet, Download, TrendingDown, TrendingUp, ArrowLeft } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput, SelectFilter, DateRangeFilter } from '../ui/client';
import { BarChartCard } from '../charts';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { getSaccoSettings } from '@/lib/settings';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime, lastNPeriods, periodLabel, sqlDate } from '@/lib/dates';
import { PostSavingsForm, OpenAccountButton } from '../forms/sacco-forms';

const PER_PAGE = 30;

const TYPE_TONES: Record<string, string> = {
  deposit: 'badge badge-green',
  withdrawal: 'badge badge-red',
  interest: 'badge badge-blue',
  dividend: 'badge badge-gold',
  transfer_in: 'badge badge-blue',
  transfer_out: 'badge badge-red',
  adjustment: 'badge badge-grey',
  penalty: 'badge badge-red',
};

export default async function SaccoSavingsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  // Members only ever see their own account, not the full savings register.
  if (isMember(user)) {
    const own = user.member_id
      ? await one<any>(`SELECT id FROM sacco_accounts WHERE member_id = $1`, [user.member_id])
      : null;
    redirect(own ? `/sacco/accounts/${own.id}` : '/dashboard');
  }
  const canView = can(user, 'savings.view') || can(user, 'sacco.view');
  if (!canView) redirect('/dashboard');

  const ownOnly = false;
  const settings = await getSaccoSettings();
  const search = String(sp.search || sp.q || '').trim();
  const type = String(sp.type || '');
  const from = String(sp.from || '');
  const to = String(sp.to || '');
  const accountId = Number(sp.account_id || 0) || null;
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const params: any[] = [];
  const where: string[] = ['s.reversed = FALSE'];
  if (ownOnly) {
    params.push(user.member_id);
    where.push(`s.member_id = $${params.length}`);
  } else if (user.scope_parish_id) {
    params.push(Number(user.scope_parish_id));
    where.push(`COALESCE(a.parish_id, m.parish_id) = $${params.length}`);
  }
  if (accountId) {
    params.push(accountId);
    where.push(`s.sacco_account_id = $${params.length}`);
  }
  if (type) {
    params.push(type);
    where.push(`s.transaction_type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length} OR COALESCE(s.reference,'') ILIKE $${params.length} OR COALESCE(s.receipt_no,'') ILIKE $${params.length} OR COALESCE(a.account_no,'') ILIKE $${params.length})`);
  }
  if (from) {
    params.push(sqlDate(from));
    where.push(`s.transaction_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(sqlDate(to));
    where.push(`s.transaction_date < ($${params.length}::date + interval '1 day')`);
  }
  const whereSql = where.join(' AND ');
  const joins = `JOIN members m ON m.id = s.member_id LEFT JOIN sacco_accounts a ON a.id = s.sacco_account_id`;

  const [rows, countRow, totals, trend, members, accountsWithout] = await Promise.all([
    query<any>(
      `SELECT s.*, m.full_name, m.membership_no, m.id AS member_id, a.account_no
         FROM savings s ${joins}
        WHERE ${whereSql}
        ORDER BY s.transaction_date DESC, s.id DESC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(`SELECT count(*)::int AS total FROM savings s ${joins} WHERE ${whereSql}`, params),
    one<any>(
      `SELECT COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type IN ('deposit','interest','dividend','transfer_in')),0) AS inflow,
              COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type IN ('withdrawal','transfer_out','penalty')),0) AS outflow,
              count(*)::int AS entries,
              count(DISTINCT s.member_id)::int AS savers
         FROM savings s ${joins} WHERE ${whereSql}`,
      params,
    ),
    query<any>(
      `SELECT to_char(s.transaction_date,'YYYY-MM') AS label,
              COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type IN ('deposit','interest','dividend','transfer_in')),0)::float AS inflow,
              COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type IN ('withdrawal','transfer_out','penalty')),0)::float AS outflow
         FROM savings s ${joins}
        WHERE s.reversed = FALSE AND to_char(s.transaction_date,'YYYY-MM') = ANY($1::text[]) ${ownOnly ? `AND s.member_id = $2` : ''}
        GROUP BY 1 ORDER BY 1`,
      ownOnly ? [lastNPeriods(12), user.member_id] : [lastNPeriods(12)],
    ),
    can(user, 'savings.create')
      ? query<any>(
          `SELECT m.id, m.full_name, m.membership_no, a.id AS account_id, a.account_no
             FROM members m LEFT JOIN sacco_accounts a ON a.member_id = m.id
            WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
              ${user.scope_parish_id ? `AND m.parish_id = ${Number(user.scope_parish_id)}` : ''}
            ORDER BY m.membership_no`,
        )
      : Promise.resolve([] as any[]),
    can(user, 'sacco.create')
      ? query<any>(
          `SELECT m.id, m.full_name, m.membership_no FROM members m
            WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
              AND NOT EXISTS (SELECT 1 FROM sacco_accounts a WHERE a.member_id = m.id)
              ${user.scope_parish_id ? `AND m.parish_id = ${Number(user.scope_parish_id)}` : ''}
            ORDER BY m.full_name LIMIT 12`,
        )
      : Promise.resolve([] as any[]),
  ]);

  const total = Number(countRow?.total || 0);
  const trendRows = lastNPeriods(12).map((p) => {
    const row = trend.find((t: any) => t.label === p);
    return { label: periodLabel(p), inflow: Number(row?.inflow || 0), outflow: Number(row?.outflow || 0) };
  });

  return (
    <div className="space-y-5">
      <SectionHeading
        title="SDP savings register"
        subtitle={`Minimum monthly saving ${money(settings.min_monthly_savings)} · withdrawals limited to ${settings.max_savings_withdrawal_pct}% with ${settings.withdrawal_notice_days} day(s) notice.`}
        action={
          <>
            <Link href="/sacco" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> SDP overview</Link>
            <Link href={`/api/exports/sacco?format=excel`} className="btn btn-outline btn-sm"><Download className="h-4 w-4" /> Export</Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Money in" value={money(num(totals?.inflow))} tone="green" icon={<TrendingUp className="h-4 w-4" />} sub="Deposits, interest & dividends" />
        <StatCard label="Money out" value={money(num(totals?.outflow))} tone="red" icon={<TrendingDown className="h-4 w-4" />} sub="Withdrawals & penalties" />
        <StatCard label="Transactions" value={String(totals?.entries || 0)} tone="navy" icon={<Wallet className="h-4 w-4" />} sub={`${totals?.savers || 0} saving member(s)`} />
        <StatCard label="Net savings movement" value={money(num(totals?.inflow) - num(totals?.outflow))} tone="gold" />
      </div>

      <Card padded={false}>
        <div className="p-4"><CardHeader title="Twelve month movement" subtitle="Money in against money out." /></div>
        <div className="px-2 pb-4">
          <BarChartCard
            data={trendRows}
            xKey="label"
            series={[
              { key: 'inflow', label: 'In', color: '#0e7c4a' },
              { key: 'outflow', label: 'Out', color: '#b91c1c' },
            ]}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {can(user, 'savings.create') ? (
          <Card className="lg:col-span-1">
            <CardHeader title="Post a savings transaction" subtitle="Deposits raise the balance; withdrawals are checked against the SDP rules." />
            <PostSavingsForm
              members={members
                .filter((m: any) => m.account_id)
                .map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.account_no || m.membership_no}` }))}
              minMonthly={settings.min_monthly_savings}
            />
          </Card>
        ) : null}

        <Card className={can(user, 'savings.create') ? 'lg:col-span-2' : 'lg:col-span-3'} padded={false}>
          <div className="p-4">
            <CardHeader
              title="Savings ledger"
              subtitle={`${total} entr${total === 1 ? 'y' : 'ies'}`}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <SearchInput param="search" placeholder="Member, account, ref…" className="w-44 sm:w-56" />
                  <SelectFilter
                    param="type"
                    placeholder="All types"
                    className="w-40"
                    options={[
                      { value: 'deposit', label: 'Deposits' },
                      { value: 'withdrawal', label: 'Withdrawals' },
                      { value: 'interest', label: 'Interest' },
                      { value: 'dividend', label: 'Dividends' },
                      { value: 'adjustment', label: 'Adjustments' },
                      { value: 'penalty', label: 'Penalties' },
                    ]}
                  />
                  <DateRangeFilter />
                </div>
              }
            />
          </div>
          {rows.length === 0 ? (
            <div className="p-4 pt-0">
              <EmptyState icon={<Wallet className="h-6 w-6" />} title="No savings transactions" description="Post a deposit or adjust the filters." />
            </div>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Member</Th>
                    <Th>Account</Th>
                    <Th>Type</Th>
                    <Th>Method</Th>
                    <Th>Reference</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">Balance</Th>
                    <Th align="right">Receipt</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <Td className="whitespace-nowrap text-xs text-slate-600"><span title={fmtDateTime(r.transaction_date)}>{fmtDate(r.transaction_date)}</span></Td>
                      <Td>
                        <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${r.member_id}?tab=sacco`}>{r.full_name}</Link>
                        <div className="text-[11px] text-slate-500">{r.membership_no}</div>
                      </Td>
                      <Td>
                        {r.sacco_account_id ? (
                          <Link className="font-mono text-xs text-navy-800 hover:text-gold-700" href={`/sacco/accounts/${r.sacco_account_id}`}>{r.account_no}</Link>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </Td>
                      <Td><Badge tone={TYPE_TONES[r.transaction_type] || 'badge badge-grey'}>{String(r.transaction_type).replace(/_/g, ' ')}</Badge></Td>
                      <Td className="text-xs text-slate-600">{r.payment_method || '—'}</Td>
                      <Td className="max-w-[8rem] truncate font-mono text-[11px] text-slate-500">{r.reference || '—'}</Td>
                      <Td align="right" className={r.transaction_type === 'withdrawal' ? 'font-semibold text-red-600' : 'font-semibold text-emerald-700'}>
                        {['withdrawal', 'transfer_out', 'penalty'].includes(r.transaction_type) ? '−' : ''}{money(num(r.amount))}
                      </Td>
                      <Td align="right" className="text-slate-600">{money(num(r.running_balance))}</Td>
                      <Td align="right">
                        {r.payment_id && can(user, 'payments.view') ? (
                          <Link href={`/payments/${r.payment_id}`} className="btn btn-ghost btn-sm">View</Link>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="p-4">
                <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/sacco/savings" query={{ search, type, from, to, account_id: accountId }} />
              </div>
            </>
          )}
        </Card>
      </div>

      {accountsWithout.length > 0 && can(user, 'sacco.create') ? (
        <Card>
          <CardHeader title="Open SDP accounts" subtitle="These active members do not have a savings account yet." />
          <div className="flex flex-wrap gap-2">
            {accountsWithout.map((m: any) => (
              <OpenAccountButton key={m.id} memberId={Number(m.id)} memberName={m.full_name} />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
