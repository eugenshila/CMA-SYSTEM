import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wallet, PieChart, Users, TrendingUp, ArrowRight, Landmark, Coins, FileText } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, KeyValue, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { BarChartCard } from '../charts';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { getSaccoSettings, getShareSettings } from '@/lib/settings';
import { money, num } from '@/lib/money';
import { fmtDate, lastNPeriods, periodKey, periodLabel } from '@/lib/dates';

export default async function SaccoPage({ user }: { user: SessionUser }) {
  // Members are self-service: they only ever see their OWN SDP account, never the
  // aggregate register. Send them straight to their account detail page.
  if (isMember(user)) {
    const own = user.member_id
      ? await one<any>(`SELECT id FROM sacco_accounts WHERE member_id = $1`, [user.member_id])
      : null;
    redirect(own ? `/sacco/accounts/${own.id}` : '/dashboard');
  }
  if (!can(user, 'sacco.view') && !can(user, 'savings.view')) redirect('/dashboard');

  const settings = await getSaccoSettings();
  const shareSettings = await getShareSettings();
  const parishFilter = user.scope_parish_id ? `AND a.parish_id = ${Number(user.scope_parish_id)}` : '';
  const periods = lastNPeriods(6);

  const [totals, accounts, topSavers, topShareholders, recent, trend, withoutAccount, loans] = await Promise.all([
    one<any>(
      `SELECT count(*)::int AS accounts,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              COALESCE(SUM(savings_balance),0) AS savings,
              COALESCE(SUM(share_capital),0) AS share_capital,
              COALESCE(SUM(shares_count),0)::int AS shares,
              COALESCE(SUM(total_deposits),0) AS deposits,
              COALESCE(SUM(total_withdrawals),0) AS withdrawals,
              COALESCE(SUM(loan_outstanding),0) AS loan_outstanding
         FROM sacco_accounts a WHERE 1=1 ${parishFilter}`,
    ),
    one<any>(`SELECT count(*)::int AS members FROM members WHERE deleted_at IS NULL AND membership_status = 'active'`),
    query<any>(
      `SELECT a.id, a.account_no, a.savings_balance, a.shares_count, a.share_capital, m.id AS member_id, m.full_name, m.membership_no
         FROM sacco_accounts a JOIN members m ON m.id = a.member_id
        WHERE 1=1 ${parishFilter} ORDER BY a.savings_balance DESC LIMIT 10`,
    ),
    query<any>(
      `SELECT a.id, a.account_no, a.shares_count, a.share_capital, m.id AS member_id, m.full_name, m.membership_no
         FROM sacco_accounts a JOIN members m ON m.id = a.member_id
        WHERE COALESCE(a.shares_count,0) > 0 ${parishFilter} ORDER BY a.shares_count DESC LIMIT 10`,
    ),
    query<any>(
      `SELECT s.transaction_type, s.amount, s.transaction_date, s.running_balance, s.payment_method, s.reference,
              m.full_name, m.membership_no, m.id AS member_id
         FROM savings s JOIN members m ON m.id = s.member_id
        WHERE s.reversed = FALSE ORDER BY s.transaction_date DESC, s.id DESC LIMIT 12`,
    ),
    query<any>(
      `SELECT to_char(s.transaction_date,'YYYY-MM') AS label,
              COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type = 'deposit'),0)::float AS deposits,
              COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type = 'withdrawal'),0)::float AS withdrawals
         FROM savings s
        WHERE s.reversed = FALSE AND to_char(s.transaction_date,'YYYY-MM') = ANY($1::text[])
        GROUP BY 1 ORDER BY 1`,
      [periods],
    ),
    query<any>(
      `SELECT m.id, m.full_name, m.membership_no, m.phone FROM members m
        WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM sacco_accounts a WHERE a.member_id = m.id)
        ORDER BY m.membership_no LIMIT 10`,
    ),
    one<any>(
      `SELECT count(*)::int AS active_loans, COALESCE(SUM(outstanding_balance),0) AS outstanding, COALESCE(SUM(arrears),0) AS arrears
         FROM loans WHERE status IN ('active','defaulted','restructured')`,
    ),
  ]);

  const canCreate = can(user, 'sacco.create') || can(user, 'savings.create');
  const ownAccount = user.member_id
    ? await one<any>('SELECT id, account_no, savings_balance, shares_count, share_capital FROM sacco_accounts WHERE member_id = $1', [user.member_id])
    : null;

  const trendRows = periods.map((p) => {
    const row = trend.find((t: any) => t.label === p);
    return { label: periodLabel(p), deposits: Number(row?.deposits || 0), withdrawals: Number(row?.withdrawals || 0) };
  });

  return (
    <div className="space-y-5">
      <SectionHeading
        title="SDP / Sacco"
        subtitle="Savings and Development Programme — member savings, share capital, dividends and the loan book backed by them."
        action={
          <>
            <Link href="/sacco/savings" className="btn btn-outline btn-sm"><Wallet className="h-4 w-4" /> Savings</Link>
            <Link href="/sacco/shares" className="btn btn-outline btn-sm"><PieChart className="h-4 w-4" /> Shares</Link>
            <Link href="/sacco/dividends" className="btn btn-outline btn-sm"><Coins className="h-4 w-4" /> Dividends</Link>
            {can(user, 'loans.view') ? <Link href="/loans" className="btn btn-primary btn-sm">Loans <ArrowRight className="h-4 w-4" /></Link> : null}
          </>
        }
      />

      {ownAccount ? (
        <Card className="border-gold-50/40 bg-gold-50/40">
          <CardHeader
            title={`Your SDP account — ${ownAccount.account_no}`}
            subtitle="Savings can be used as security for a loan, and shares earn dividends every year."
            action={<Link href={`/sacco/accounts/${ownAccount.id}`} className="btn btn-outline btn-sm">Open my account</Link>}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Savings balance" value={money(num(ownAccount.savings_balance))} tone="green" />
            <StatCard label="Shares held" value={String(ownAccount.shares_count || 0)} tone="gold" sub={money(num(ownAccount.share_capital))} />
            <StatCard label="Share value" value={money(num(ownAccount.shares_count || 0) * shareSettings.value_per_share)} tone="navy" sub={`${money(shareSettings.value_per_share)} per share`} />
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total savings" value={money(num(totals?.savings))} tone="green" icon={<Wallet className="h-4 w-4" />} sub={`${money(num(totals?.deposits))} deposited · ${money(num(totals?.withdrawals))} withdrawn`} />
        <StatCard label="Share capital" value={money(num(totals?.share_capital))} tone="gold" icon={<PieChart className="h-4 w-4" />} sub={`${totals?.shares || 0} shares issued`} />
        <StatCard label="Sacco accounts" value={String(totals?.accounts || 0)} tone="navy" icon={<Users className="h-4 w-4" />} sub={`${totals?.active || 0} active of ${accounts?.members || 0} members`} />
        <StatCard label="Loan book (SDP-backed)" value={money(num(loans?.outstanding))} tone="red" icon={<Landmark className="h-4 w-4" />} sub={`${loans?.active_loans || 0} active · ${money(num(loans?.arrears))} in arrears`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-4"><CardHeader title="Savings movement" subtitle="Deposits against withdrawals for the last six months." /></div>
          <div className="px-2 pb-4">
            <BarChartCard
              data={trendRows}
              xKey="label"
              series={[
                { key: 'deposits', label: 'Deposits', color: '#0e7c4a' },
                { key: 'withdrawals', label: 'Withdrawals', color: '#b91c1c' },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="SDP rules in force" subtitle="Configured by the SDP officer or administrator." icon={<FileText className="h-4 w-4" />} />
          <KeyValue
            columns={1}
            items={[
              ['Minimum monthly savings', money(settings.min_monthly_savings)],
              ['Maximum withdrawal', `${settings.max_savings_withdrawal_pct}% of savings`],
              ['Withdrawal notice', `${settings.withdrawal_notice_days} day(s)`],
              ['Interest on deposits', `${settings.interest_on_deposits_pct}% p.a.`],
              ['Dividend policy', String(settings.dividend_policy || 'share_capital').replace(/_/g, ' ')],
              ['Value per share', money(shareSettings.value_per_share)],
              ['Shares per member', `${shareSettings.min_shares} – ${shareSettings.max_shares_per_member}`],
              ['Transferable', shareSettings.transferable ? 'Yes' : 'No'],
            ]}
          />
          {can(user, 'settings.update') ? (
            <Link href="/settings" className="btn btn-outline btn-sm mt-4"><TrendingUp className="h-4 w-4" /> Edit SDP settings</Link>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-4"><CardHeader title="Top savers" subtitle="Highest savings balances." action={<Link href="/sacco/savings" className="btn btn-ghost btn-sm">All savings</Link>} /></div>
          {topSavers.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<Wallet className="h-6 w-6" />} title="No savings yet" description="Post the first deposit to start the SDP fund." /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Account</Th>
                  <Th align="right">Savings</Th>
                  <Th align="right">Shares</Th>
                </tr>
              </thead>
              <tbody>
                {topSavers.map((r: any) => (
                  <tr key={r.id}>
                    <Td>
                      <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${r.member_id}`}>{r.full_name}</Link>
                      <div className="text-[11px] text-slate-500">{r.membership_no}</div>
                    </Td>
                    <Td><Link className="font-mono text-xs text-navy-800 hover:text-gold-700" href={`/sacco/accounts/${r.id}`}>{r.account_no}</Link></Td>
                    <Td align="right" className="font-semibold text-emerald-700">{money(num(r.savings_balance))}</Td>
                    <Td align="right">{r.shares_count || 0}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-4"><CardHeader title="Top shareholders" subtitle="Share capital determines dividends and loan guarantees." action={<Link href="/sacco/shares" className="btn btn-ghost btn-sm">All shares</Link>} /></div>
          {topShareholders.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<PieChart className="h-6 w-6" />} title="No shares issued" description="Issue the first share certificate from the Shares page." /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Account</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">Capital</Th>
                </tr>
              </thead>
              <tbody>
                {topShareholders.map((r: any) => (
                  <tr key={r.id}>
                    <Td>
                      <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${r.member_id}`}>{r.full_name}</Link>
                      <div className="text-[11px] text-slate-500">{r.membership_no}</div>
                    </Td>
                    <Td><Link className="font-mono text-xs text-navy-800 hover:text-gold-700" href={`/sacco/accounts/${r.id}`}>{r.account_no}</Link></Td>
                    <Td align="right">{r.shares_count}</Td>
                    <Td align="right" className="font-semibold">{money(num(r.share_capital))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-4"><CardHeader title="Recent savings transactions" subtitle="Latest deposits, withdrawals and credits." action={<Link href="/sacco/savings" className="btn btn-ghost btn-sm">Open register</Link>} /></div>
          {recent.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState title="No savings transactions yet" /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Member</Th>
                  <Th>Type</Th>
                  <Th>Method</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r: any, i: number) => (
                  <tr key={`${r.member_id}-${i}`}>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(r.transaction_date)}</Td>
                    <Td>
                      <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${r.member_id}`}>{r.full_name}</Link>
                      <div className="text-[11px] text-slate-500">{r.membership_no}</div>
                    </Td>
                    <Td>
                      <Badge tone={r.transaction_type === 'withdrawal' ? 'badge badge-red' : 'badge badge-green'}>
                        {String(r.transaction_type).replace(/_/g, ' ')}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-slate-600">{r.payment_method || '—'}</Td>
                    <Td align="right" className={r.transaction_type === 'withdrawal' ? 'text-red-600' : 'font-semibold text-emerald-700'}>
                      {r.transaction_type === 'withdrawal' ? '−' : ''}{money(num(r.amount))}
                    </Td>
                    <Td align="right" className="text-slate-600">{money(num(r.running_balance))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-4">
            <CardHeader
              title="Members without a SDP account"
              subtitle="Every active member should save with the SDP."
              action={canCreate ? <Link href="/sacco/savings" className="btn btn-gold btn-sm">Open accounts</Link> : undefined}
            />
          </div>
          {withoutAccount.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState title="Everyone has an account" description="All active members are enrolled in the SDP." /></div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {withoutAccount.map((m: any) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link className="block truncate text-sm font-medium text-navy-800 hover:text-gold-700" href={`/members/${m.id}`}>{m.full_name}</Link>
                    <p className="text-[11px] text-slate-500">{m.membership_no}{m.phone ? ` · ${m.phone}` : ''}</p>
                  </div>
                  {can(user, 'sacco.create') ? <span className="badge badge-gold">No account</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
