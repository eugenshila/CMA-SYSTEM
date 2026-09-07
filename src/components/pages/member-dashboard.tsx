import Link from 'next/link';
import {
  Wallet, PiggyBank, PieChart, Banknote, CalendarClock, HeartPulse, Cross, HeartHandshake, HandCoins,
  CalendarDays, Bell, FileText, ShieldCheck, TrendingUp, AlertTriangle, CheckCircle2, Users,
} from 'lucide-react';
import { one, query } from '@/lib/db';
import { memberBalances } from '@/lib/payments';
import { memberCaseOutstanding } from '@/lib/contributions';
import { money, num, percent } from '@/lib/money';
import { fmtDate, lastNPeriods, periodKey, periodLabel, relativeTime, isoDate } from '@/lib/dates';
import { Card, CardHeader, StatCard, StatusBadge, Table, Th, Td, ProgressBar, EmptyState, Avatar, Badge } from '@/components/ui/primitives';
import { LineChartCard, DonutChartCard } from '@/components/charts';
import PayNowButton, { type Obligation } from '@/components/forms/pay-now';

export const dynamic = 'force-dynamic';

export default async function MemberDashboard({ memberId, canPay }: { memberId: number; canPay: boolean }) {
  const member = await one<any>(
    `SELECT m.*, p.name AS parish_name, c.name AS church_name, s.name AS scc_name
       FROM members m
       LEFT JOIN parishes p ON p.id = m.parish_id
       LEFT JOIN churches c ON c.id = m.church_id
       LEFT JOIN small_christian_communities s ON s.id = m.scc_id
      WHERE m.id = $1`,
    [memberId],
  );
  if (!member) return <EmptyState title="Member record not found" description="Your account is not linked to a member record yet. Please see the CMA Secretary." />;

  const period = periodKey(new Date());
  const periods = lastNPeriods(12);

  const [balances, current, trend, savingsTrend, account, loans, nextInstalments, outstanding, meetings, attendance, notifications, shares] =
    await Promise.all([
      memberBalances(memberId),
      one<any>(`SELECT * FROM member_contributions WHERE member_id = $1 AND period = $2 ORDER BY id DESC LIMIT 1`, [memberId, period]),
      query<any>(
        `SELECT period, COALESCE(SUM(amount_paid),0)::float AS amount FROM member_contributions
          WHERE member_id = $1 AND period = ANY($2::text[]) GROUP BY period ORDER BY period`,
        [memberId, periods],
      ),
      query<any>(
        `SELECT to_char(transaction_date,'YYYY-MM') AS period,
                COALESCE(SUM(amount) FILTER (WHERE transaction_type IN ('deposit','interest','dividend','transfer_in')),0)::float AS deposits
           FROM savings WHERE member_id = $1 AND reversed = FALSE AND transaction_date >= now() - interval '12 months'
          GROUP BY 1 ORDER BY 1`,
      ),
      one<any>('SELECT * FROM sacco_accounts WHERE member_id = $1', [memberId]),
      query<any>(
        `SELECT l.*, lt.name AS loan_type_name FROM loans l JOIN loan_types lt ON lt.id = l.loan_type_id
          WHERE l.member_id = $1 AND l.status IN ('active','defaulted','restructured') ORDER BY l.next_due_date NULLS LAST`,
        [memberId],
      ),
      query<any>(
        `SELECT ls.*, l.loan_no FROM loan_schedules ls JOIN loans l ON l.id = ls.loan_id
          WHERE ls.member_id = $1 AND ls.status <> 'paid' ORDER BY ls.due_date LIMIT 3`,
        [memberId],
      ),
      memberCaseOutstanding(memberId),
      query<any>(
        `SELECT * FROM meetings WHERE status IN ('scheduled','ongoing') AND meeting_date >= CURRENT_DATE - interval '1 day'
          ORDER BY meeting_date, start_time LIMIT 3`,
      ),
      one<any>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('present','late'))::int AS attended
           FROM attendance WHERE member_id = $1`,
        [memberId],
      ),
      query<any>(
        `SELECT id, title, body, category, priority, link, read_at, created_at FROM notifications
          WHERE member_id = $1 OR user_id = (SELECT user_id FROM members WHERE id = $1)
          ORDER BY created_at DESC LIMIT 5`,
        [memberId],
      ),
      one<any>(
        `SELECT COALESCE(SUM(shares_count),0)::int AS shares_count, COALESCE(SUM(total_value),0)::float AS total_value
           FROM shares WHERE member_id = $1 AND status = 'active'`,
        [memberId],
      ),
    ]);

  const trendRows = periods.map((p) => ({ period: p, amount: Number(trend.find((t) => t.period === p)?.amount || 0) }));
  const savingsRows = savingsTrend.map((s) => ({ period: s.period, amount: Number(s.deposits || 0) }));

  /* ------------------------------ pay now ------------------------------ */
  const obligations: Obligation[] = [];

  if (current && !current.exempted && num(current.amount_due) - num(current.amount_paid) > 0) {
    obligations.push({
      key: `mc-${current.id}`,
      label: `Monthly contribution — ${periodLabel(current.period)}`,
      detail:
        current.status === 'partial'
          ? `Balance of ${money(num(current.amount_due) - num(current.amount_paid))}`
          : 'This month’s CMA subscription',
      allocationType: 'monthly_contribution',
      referenceId: current.id,
      period: current.period,
      amount: Math.round((num(current.amount_due) - num(current.amount_paid) + num(current.penalty)) * 100) / 100,
    });
  }

  for (const c of outstanding) {
    obligations.push({
      key: `${c.type}-${c.id}`,
      label: `${labelForType(c.type)} — ${c.title}`,
      detail: `${c.reference}${c.deadline ? ` · by ${fmtDate(c.deadline)}` : ''}`,
      allocationType: c.type === 'project' ? 'project' : c.type,
      referenceId: c.id,
      amount: num(c.outstanding),
    });
  }

  for (const l of loans) {
    if (num(l.outstanding_balance) > 0) {
      obligations.push({
        key: `loan-${l.id}`,
        label: `Loan repayment — ${l.loan_no}`,
        detail: `Outstanding ${money(l.outstanding_balance)}${l.next_due_date ? ` · next due ${fmtDate(l.next_due_date)}` : ''}`,
        allocationType: 'loan',
        referenceId: l.id,
        amount: num(l.monthly_repayment),
      });
    }
  }

  if (num(balances.penalties_outstanding) > 0) {
    obligations.push({
      key: 'penalties',
      label: 'Penalties & charges',
      detail: 'Late contribution or loan penalties',
      allocationType: 'penalty',
      amount: num(balances.penalties_outstanding),
    });
  }

  obligations.push({
    key: 'savings',
    label: 'SDP / Sacco savings deposit',
    detail: account?.account_no ? `Account ${account.account_no}` : 'Boost your savings and loan limit',
    allocationType: 'savings',
    amount: 500,
    min: 100,
  });

  const allObligations = obligations;

  const attendancePct = attendance?.total ? Math.round(percent(attendance.attended, attendance.total)) : null;

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-4 bg-navy-950 px-5 py-5 text-white bg-grid sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={member.full_name} src={member.photo_url} size={56} />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gold-400">Karibu, {member.salutation || 'Brother'}</p>
              <h1 className="text-lg font-extrabold leading-tight sm:text-xl">{member.full_name}</h1>
              <p className="mt-0.5 text-xs text-slate-300">
                {member.membership_no} · {member.parish_name}
                {member.church_name ? ` · ${member.church_name}` : ''}
                {member.scc_name ? ` · SCC ${member.scc_name}` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={member.membership_status} />
            {canPay ? (
              <PayNowButton memberId={memberId} phone={member.phone} obligations={allObligations} label="Pay now" className="btn-gold" />
            ) : null}
            <Link href="/statements" className="btn-outline btn-sm border-white/30 text-white hover:bg-white/10">
              <FileText className="h-4 w-4" /> My statement
            </Link>
          </div>
        </div>

        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat icon={<CalendarClock className="h-4 w-4" />} label="Monthly contribution" value={current ? (current.exempted ? 'Exempted' : money(current.amount_paid)) : 'Not billed'} sub={current ? `${periodLabel(current.period)} · ${money(current.amount_due)}` : 'No bill for this month yet'} tone={current && current.status === 'paid' ? 'green' : current && current.exempted ? 'slate' : 'amber'} />
          <MiniStat icon={<PiggyBank className="h-4 w-4" />} label="Savings balance" value={money(balances.savings_balance)} sub={account?.account_no || 'No SDP/Sacco account yet'} tone="navy" />
          <MiniStat icon={<PieChart className="h-4 w-4" />} label="Share capital" value={money(shares?.total_value || 0)} sub={`${shares?.shares_count || 0} share(s) held`} tone="gold" />
          <MiniStat icon={<Banknote className="h-4 w-4" />} label="Loan outstanding" value={money(balances.loan_outstanding)} sub={balances.active_loans ? `${balances.active_loans} active loan(s)` : 'No active loan'} tone={num(balances.loan_arrears) > 0 ? 'red' : 'navy'} />
        </div>
      </div>

      {/* Alerts */}
      {num(balances.monthly_outstanding) > 0 || num(balances.penalties_outstanding) > 0 || num(balances.loan_arrears) > 0 ? (
        <div className="alert alert-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 text-xs">
            <p className="font-semibold text-amber-900">You have outstanding balances</p>
            <p className="mt-0.5 text-amber-800">
              {num(balances.monthly_outstanding) > 0 ? <>Contributions {money(balances.monthly_outstanding)} ({balances.unpaid_periods} period(s)). </> : null}
              {num(balances.penalties_outstanding) > 0 ? <>Penalties {money(balances.penalties_outstanding)}. </> : null}
              {num(balances.loan_arrears) > 0 ? <>Loan arrears {money(balances.loan_arrears)}. </> : null}
              Settling early keeps you eligible for welfare support and sacco loans.
            </p>
          </div>
          {canPay && allObligations.length ? (
            <PayNowButton memberId={memberId} phone={member.phone} obligations={allObligations} label="Settle now" className="btn-primary" />
          ) : null}
        </div>
      ) : (
        <div className="alert alert-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <p className="text-xs font-medium text-emerald-900">
            Asante! Your contributions are fully paid up to {periodLabel(period)}. Total contributed to date:{' '}
            <strong>{money(balances.monthly_paid)}</strong>.
          </p>
        </div>
      )}

      {/* Stats row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total contributed" value={money(balances.monthly_paid)} sub={`of ${money(balances.monthly_due_total)} billed`} icon={<HandCoins className="h-4 w-4" />} tone="green" progress={{ value: num(balances.monthly_paid), total: Math.max(num(balances.monthly_due_total), 1) }} href="/contributions" />
        <StatCard label="Welfare given" value={money(balances.welfare_paid)} sub="to sick & needy brothers" icon={<HeartPulse className="h-4 w-4" />} tone="red" href="/welfare" />
        <StatCard label="Funeral & wedding" value={money(num(balances.funeral_paid) + num(balances.wedding_paid))} sub={`Funeral ${money(balances.funeral_paid)} · Wedding ${money(balances.wedding_paid)}`} icon={<Cross className="h-4 w-4" />} tone="navy" href="/funerals" />
        <StatCard label="Projects & special" value={money(balances.project_paid)} sub="parish and CMA projects" icon={<HeartHandshake className="h-4 w-4" />} tone="gold" href="/projects" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="My monthly contributions"
            subtitle="Last 12 months"
            icon={<TrendingUp className="h-[18px] w-[18px]" />}
            action={<Link href="/contributions" className="btn-ghost btn-sm">View all</Link>}
          />
          <LineChartCard data={trendRows} xKey="period" series={[{ key: 'amount', label: 'Paid' }]} periodLabels height={240} />
        </Card>

        <Card>
          <CardHeader title="Where my money is" subtitle="Savings, shares and loans" icon={<PieChart className="h-[18px] w-[18px]" />} />
          {num(balances.savings_balance) + num(balances.shares_value) + num(balances.loan_outstanding) > 0 ? (
            <DonutChartCard
              data={[
                { label: 'Savings', value: num(balances.savings_balance) },
                { label: 'Shares', value: num(balances.shares_value) },
                { label: 'Loan balance', value: num(balances.loan_outstanding) },
              ].filter((d) => d.value > 0)}
              height={240}
            />
          ) : (
            <EmptyState
              title="No sacco activity yet"
              description="Open your SDP/Sacco account to start saving, buying shares and accessing loans."
              icon={<LandmarkIcon />}
              action={<Link href="/sacco" className="btn-primary btn-sm">Open my sacco account</Link>}
            />
          )}
        </Card>
      </div>

      {/* Loans + savings trend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="My loans"
            subtitle={balances.active_loans ? `${balances.active_loans} active loan(s)` : 'No active loans'}
            icon={<Banknote className="h-[18px] w-[18px]" />}
            action={<Link href="/loans/apply" className="btn-outline btn-sm">Apply for a loan</Link>}
          />
          {loans.length ? (
            <div className="space-y-3">
              {loans.map((l: any) => (
                <Link key={l.id} href={`/loans/${l.id}`} className="block rounded-xl border border-slate-200 p-3 transition hover:border-navy-300 hover:bg-navy-50/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-navy-900">{l.loan_no}</p>
                      <p className="truncate text-[11px] text-slate-500">{l.loan_type_name} · {l.term_months} months @ {num(l.interest_rate)}%</p>
                    </div>
                    <StatusBadge status={l.status} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-[10px] uppercase text-slate-400">Principal</p><p className="text-xs font-bold tabular-nums">{money(l.principal)}</p></div>
                    <div><p className="text-[10px] uppercase text-slate-400">Outstanding</p><p className="text-xs font-bold tabular-nums">{money(l.outstanding_balance)}</p></div>
                    <div><p className="text-[10px] uppercase text-slate-400">Next due</p><p className="text-xs font-bold tabular-nums">{l.next_due_date ? fmtDate(l.next_due_date) : '—'}</p></div>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={num(l.amount_paid)} total={Math.max(num(l.total_repayable), 1)} label="Repaid" color="#16a34a" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No active loan"
              description="You qualify for emergency, development, school-fees and business loans based on your savings and shares."
              icon={<Banknote className="h-5 w-5" />}
              action={<Link href="/loans/apply" className="btn-primary btn-sm">Apply now</Link>}
            />
          )}

          {nextInstalments.length ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Upcoming instalments</p>
              <ul className="space-y-1.5">
                {nextInstalments.map((i: any) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="text-slate-600">{i.loan_no} · instalment {i.installment_no}</span>
                    <span className="font-bold tabular-nums text-navy-900">{money(i.total_due - i.amount_paid)} <span className="font-normal text-slate-400">due {fmtDate(i.due_date)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Savings deposits" subtitle="Last 12 months" icon={<PiggyBank className="h-[18px] w-[18px]" />} action={<Link href="/sacco/savings" className="btn-ghost btn-sm">Details</Link>} />
          {savingsRows.length ? (
            <LineChartCard data={savingsRows} xKey="period" series={[{ key: 'amount', label: 'Deposits', color: '#d4af37' }]} periodLabels height={200} />
          ) : (
            <EmptyState title="No savings yet" description="Deposit into your SDP/Sacco account to grow your share of the association." icon={<PiggyBank className="h-5 w-5" />} />
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
            <div className="rounded-lg bg-navy-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-navy-700">Savings balance</p>
              <p className="mt-0.5 text-base font-extrabold tabular-nums text-navy-900">{money(balances.savings_balance)}</p>
            </div>
            <div className="rounded-lg bg-gold-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gold-700">Share capital</p>
              <p className="mt-0.5 text-base font-extrabold tabular-nums text-navy-900">{money(balances.shares_value)}</p>
              <p className="text-[10px] text-slate-500">{balances.shares_count} share(s)</p>
            </div>
          </div>
          {balances.guarantees_active ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-navy-700" />
              You are guaranteeing {balances.guarantees_active} loan(s) totalling {money(balances.guaranteed_amount)}.
            </p>
          ) : null}
        </Card>
      </div>

      {/* Meetings, notifications, profile completeness */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming meetings" subtitle="Attendance is a membership duty" icon={<CalendarDays className="h-[18px] w-[18px]" />} action={<Link href="/attendance" className="btn-ghost btn-sm">History</Link>} />
          {meetings.length ? (
            <ul className="space-y-2">
              {meetings.map((m: any) => (
                <li key={m.id}>
                  <Link href={`/meetings/${m.id}`} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-navy-300">
                    <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-navy-900 text-white">
                      <span className="text-[10px] uppercase leading-none">{new Date(m.meeting_date).toLocaleString('en-KE', { month: 'short' })}</span>
                      <span className="text-sm font-extrabold leading-tight">{new Date(m.meeting_date).getDate()}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-navy-900">{m.title}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {m.venue || 'Venue to be announced'}{m.start_time ? ` · ${String(m.start_time).slice(0, 5)}` : ''}
                      </span>
                      <span className="mt-1 inline-flex"><Badge tone="badge-blue">{String(m.meeting_type).replace(/_/g, ' ')}</Badge></span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No upcoming meetings" description="Meeting notices will appear here and by SMS." icon={<CalendarDays className="h-5 w-5" />} />
          )}
          {attendancePct !== null ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <ProgressBar value={attendance.attended} total={Math.max(attendance.total, 1)} label={`My attendance (${attendance.attended}/${attendance.total} meetings)`} color="#0e2340" />
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Notifications" subtitle="Recent messages from the CMA" icon={<Bell className="h-[18px] w-[18px]" />} action={<Link href="/notifications" className="btn-ghost btn-sm">Inbox</Link>} />
          {notifications.length ? (
            <ul className="space-y-2">
              {notifications.map((n: any) => (
                <li key={n.id}>
                  <Link href={n.link || '/notifications'} className={`block rounded-xl border p-3 transition hover:border-navy-300 ${n.read_at ? 'border-slate-200' : 'border-gold-300 bg-gold-50/40'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-bold text-navy-900">{n.title}</p>
                      <span className="shrink-0 text-[10px] text-slate-400">{relativeTime(n.created_at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-600">{n.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No notifications" description="Receipts, reminders and meeting notices will appear here." icon={<Bell className="h-5 w-5" />} />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="My profile" subtitle="Keep your records up to date" icon={<Users className="h-[18px] w-[18px]" />} action={<Link href={`/members/${memberId}`} className="btn-ghost btn-sm">Open</Link>} />
            <Table compact>
              <tbody>
                <tr><Td className="text-slate-500">CMA number</Td><Td align="right" className="font-semibold">{member.membership_no}</Td></tr>
                <tr><Td className="text-slate-500">Phone</Td><Td align="right" className="font-semibold">{member.phone}</Td></tr>
                <tr><Td className="text-slate-500">Email</Td><Td align="right" className="font-semibold">{member.email || '—'}</Td></tr>
                <tr><Td className="text-slate-500">Member since</Td><Td align="right" className="font-semibold">{fmtDate(member.date_joined)}</Td></tr>
                <tr><Td className="text-slate-500">Marital status</Td><Td align="right" className="font-semibold capitalize">{member.marital_status}</Td></tr>
                <tr><Td className="text-slate-500">Occupation</Td><Td align="right" className="font-semibold">{member.occupation || '—'}</Td></tr>
                <tr><Td className="text-slate-500">Next of kin</Td><Td align="right" className="font-semibold">{member.next_of_kin || '—'}</Td></tr>
              </tbody>
            </Table>
            <Link href="/my-profile" className="btn-outline btn-block mt-3">
              <ShieldCheck className="h-4 w-4" /> Update my details
            </Link>
          </Card>

          <Card>
            <CardHeader title="Recent receipts" icon={<FileText className="h-[18px] w-[18px]" />} action={<Link href="/receipts" className="btn-ghost btn-sm">All</Link>} />
            <RecentReceipts memberId={memberId} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function labelForType(type: string) {
  switch (type) {
    case 'welfare': return 'Welfare contribution';
    case 'funeral': return 'Funeral contribution';
    case 'wedding': return 'Wedding contribution';
    case 'project': return 'Project contribution';
    default: return 'Contribution';
  }
}

function LandmarkIcon() {
  return <PiggyBank className="h-5 w-5" />;
}

async function RecentReceipts({ memberId }: { memberId: number }) {
  const rows = await query<any>(
    `SELECT receipt_no, category, amount, issued_at, status FROM receipts WHERE member_id = $1 ORDER BY issued_at DESC LIMIT 5`,
    [memberId],
  );
  if (!rows.length) return <EmptyState title="No receipts yet" description="Your payment receipts will be listed here." icon={<FileText className="h-5 w-5" />} />;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.receipt_no} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <span className="min-w-0">
            <Link href={`/receipts?q=${r.receipt_no}`} className="block truncate text-xs font-semibold text-navy-900 hover:underline">{r.receipt_no}</Link>
            <span className="block truncate text-[10px] text-slate-500">{r.category} · {fmtDate(r.issued_at)}</span>
          </span>
          <span className="shrink-0 text-xs font-bold tabular-nums text-navy-900">{money(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function MiniStat({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone?: 'green' | 'amber' | 'red' | 'navy' | 'gold' | 'slate' }) {
  const tones: Record<string, string> = {
    green: 'text-emerald-300',
    amber: 'text-amber-300',
    red: 'text-red-300',
    navy: 'text-slate-300',
    gold: 'text-gold-300',
    slate: 'text-slate-300',
  };
  return (
    <div className="bg-white px-4 py-3.5">
      <p className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${tones[tone || 'navy']} text-slate-500`}>
        <span className="text-navy-700">{icon}</span>
        {label}
      </p>
      <p className="mt-1 text-base font-extrabold tabular-nums text-navy-900">{value}</p>
      {sub ? <p className="truncate text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

export { isoDate };
