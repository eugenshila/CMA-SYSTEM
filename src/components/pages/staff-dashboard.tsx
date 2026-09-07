import Link from 'next/link';
import {
  Users, Wallet, Landmark, Banknote, CalendarClock, HeartPulse, Cross, HeartHandshake, TrendingUp,
  AlertTriangle, CalendarDays, FileText, ShieldCheck, UserPlus, Stamp, ArrowRight, PieChart, Receipt, HandCoins,
} from 'lucide-react';
import { one, query } from '@/lib/db';
import { financeDashboard } from '@/lib/reports';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { money, num, percent } from '@/lib/money';
import { fmtDate, lastNPeriods, periodLabel, relativeTime } from '@/lib/dates';
import { getContributionSettings } from '@/lib/settings';
import {
  Card, CardHeader, StatCard, StatusBadge, Table, Th, Td, ProgressBar, EmptyState, Badge, Avatar,
} from '@/components/ui/primitives';
import { BarChartCard, LineChartCard, DonutChartCard } from '@/components/charts';

export const dynamic = 'force-dynamic';

export default async function StaffDashboard({ user }: { user: SessionUser }) {
  const parishId = user.scope_parish_id;
  const finance = await financeDashboard(parishId);
  const settings = await getContributionSettings();

  const [membership, growth, statusSplit, churchSplit, pending, meetings, attendanceRate, defaulters, openCases, saccoTrend, notices] =
    await Promise.all([
      one<any>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE membership_status = 'active')::int AS active,
                count(*) FILTER (WHERE membership_status = 'pending')::int AS pending,
                count(*) FILTER (WHERE membership_status = 'inactive')::int AS inactive,
                count(*) FILTER (WHERE membership_status = 'suspended')::int AS suspended,
                count(*) FILTER (WHERE membership_status = 'deceased')::int AS deceased,
                count(*) FILTER (WHERE exempt_monthly)::int AS exempted,
                count(*) FILTER (WHERE date_joined >= CURRENT_DATE - interval '30 days')::int AS new_this_month
           FROM members WHERE deleted_at IS NULL ${parishId ? 'AND parish_id = $1' : ''}`,
        parishId ? [parishId] : [],
      ),
      query<any>(
        `SELECT to_char(d,'YYYY-MM') AS period,
                COALESCE((SELECT count(*) FROM members m WHERE m.deleted_at IS NULL AND to_char(m.date_joined,'YYYY-MM') = to_char(d,'YYYY-MM') ${parishId ? 'AND m.parish_id = $1' : ''}),0)::int AS joined
           FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') d
          ORDER BY 1`,
        parishId ? [parishId] : [],
      ),
      query<any>(
        `SELECT membership_status AS name, count(*)::int AS value FROM members
          WHERE deleted_at IS NULL ${parishId ? 'AND parish_id = $1' : ''} GROUP BY 1 ORDER BY 2 DESC`,
        parishId ? [parishId] : [],
      ),
      query<any>(
        `SELECT COALESCE(c.name,'Unassigned') AS name, count(m.id)::int AS value
           FROM churches c LEFT JOIN members m ON m.church_id = c.id AND m.deleted_at IS NULL
          WHERE c.parish_id = COALESCE($1, c.parish_id) GROUP BY c.id, c.name ORDER BY 2 DESC LIMIT 8`,
        [parishId],
      ),
      one<any>(
        `SELECT
           (SELECT count(*)::int FROM members WHERE deleted_at IS NULL AND membership_status = 'pending') AS members_pending,
           (SELECT count(*)::int FROM loan_applications WHERE status IN ('submitted','under_review','guarantor_pending','committee_review','approved')) AS loans_pending,
           (SELECT count(*)::int FROM loan_guarantors WHERE status = 'pending') AS guarantees_pending,
           (SELECT count(*)::int FROM payments WHERE status = 'completed' AND reconciled = FALSE AND method IN ('mpesa','airtel','bank')) AS unreconciled,
           (SELECT count(*)::int FROM payments WHERE unallocated_amount > 0 AND status = 'completed') AS unallocated,
           (SELECT count(*)::int FROM member_documents WHERE verified = FALSE AND deleted_at IS NULL) AS docs_pending,
           (SELECT count(*)::int FROM mpesa_transactions WHERE status = 'pending') AS stk_pending`,
      ),
      query<any>(
        `SELECT id, title, meeting_type, meeting_date, start_time, venue, status, attendance_open
           FROM meetings WHERE meeting_date >= CURRENT_DATE - interval '2 days'
          ORDER BY meeting_date, start_time LIMIT 4`,
      ),
      one<any>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE a.status IN ('present','late'))::int AS present
           FROM attendance a JOIN meetings m ON m.id = a.meeting_id
          WHERE m.meeting_date >= CURRENT_DATE - interval '90 days'`,
      ),
      query<any>(
        `SELECT m.id, m.membership_no, m.full_name, m.phone,
                COALESCE(SUM(mc.amount_due - mc.amount_paid),0)::float AS outstanding,
                count(*) FILTER (WHERE mc.status <> 'paid' AND mc.exempted = FALSE)::int AS periods
           FROM members m JOIN member_contributions mc ON mc.member_id = m.id
          WHERE m.deleted_at IS NULL AND m.membership_status = 'active' AND mc.exempted = FALSE AND mc.amount_paid < mc.amount_due
            ${parishId ? 'AND m.parish_id = $1' : ''}
          GROUP BY m.id ORDER BY outstanding DESC LIMIT 6`,
        parishId ? [parishId] : [],
      ),
      one<any>(
        `SELECT (SELECT count(*)::int FROM welfare_cases WHERE status = 'open') AS welfare,
                (SELECT count(*)::int FROM funeral_cases WHERE status = 'open') AS funerals,
                (SELECT count(*)::int FROM wedding_cases WHERE status = 'open') AS weddings,
                (SELECT count(*)::int FROM special_projects WHERE status = 'open') AS projects,
                (SELECT COALESCE(SUM(amount_collected),0) FROM welfare_cases) AS welfare_collected,
                (SELECT COALESCE(SUM(amount_collected),0) FROM funeral_cases) AS funeral_collected,
                (SELECT COALESCE(SUM(amount_collected),0) FROM wedding_cases) AS wedding_collected,
                (SELECT COALESCE(SUM(amount_collected),0) FROM special_projects) AS project_collected`,
      ),
      query<any>(
        `SELECT to_char(d,'YYYY-MM') AS period,
                COALESCE((SELECT SUM(amount) FROM savings s WHERE to_char(s.transaction_date,'YYYY-MM') = to_char(d,'YYYY-MM') AND s.transaction_type = 'deposit' AND s.reversed = FALSE),0)::float AS savings,
                COALESCE((SELECT SUM(amount) FROM share_transactions st WHERE to_char(st.transaction_date,'YYYY-MM') = to_char(d,'YYYY-MM') AND st.transaction_type = 'purchase'),0)::float AS shares
           FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') d
          ORDER BY 1`,
      ),
      query<any>(
        `SELECT id, title, body, pinned, created_at FROM notices WHERE status = 'published'
           AND (publish_to IS NULL OR publish_to >= now()) ORDER BY pinned DESC, created_at DESC LIMIT 3`,
      ),
    ]);

  const collectionRate = finance.collectionRate;
  const growthRows = growth.map((g) => ({ period: g.period, joined: Number(g.joined || 0) }));
  const trendRows = finance.monthlyTrend.map((r: any) => ({ period: r.period, amount: Number(r.value || 0) }));
  const saccoRows = saccoTrend.map((r) => ({ period: r.period, savings: Number(r.savings || 0), shares: Number(r.shares || 0) }));
  const canSeeFinance = can(user, 'payments.view') || can(user, 'contributions.view');
  const canSeeSacco = can(user, 'sacco.view') || can(user, 'savings.view') || can(user, 'shares.view');
  const canSeeLoans = can(user, 'loans.view') || can(user, 'loan_approvals.view');
  const canSeeMembers = can(user, 'members.view');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 bg-navy-950 px-5 py-5 text-white bg-grid sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} src={user.photo_url} size={48} />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gold-400">{user.role_name}</p>
              <h1 className="text-lg font-extrabold leading-tight sm:text-xl">
                {greeting()}, {user.name.split(' ')[0]}
              </h1>
              <p className="text-xs text-slate-300">
                {periodLabel(finance.period)} · {membership?.active ?? 0} active members
                {parishId ? ' · parish scope' : ' · all parishes'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(user, 'payments.create') ? (
              <Link href="/payments/new" className="btn-gold btn-sm"><Wallet className="h-4 w-4" /> Record payment</Link>
            ) : null}
            {can(user, 'members.create') ? (
              <Link href="/members/new" className="btn-outline btn-sm border-white/30 text-white hover:bg-white/10"><UserPlus className="h-4 w-4" /> New member</Link>
            ) : null}
            {can(user, 'reports.view') ? (
              <Link href="/reports" className="btn-outline btn-sm border-white/30 text-white hover:bg-white/10"><FileText className="h-4 w-4" /> Reports</Link>
            ) : null}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            icon={<CalendarClock className="h-4 w-4" />}
            label={`${periodLabel(finance.period)} collection`}
            value={money(finance.contributions?.collected || 0)}
            sub={`${collectionRate}% of ${money(finance.contributions?.expected || 0)} billed`}
            progress={{ value: num(finance.contributions?.collected), total: Math.max(num(finance.contributions?.expected), 1) }}
            href={can(user, 'contributions.view') ? '/contributions' : undefined}
          />
          <KpiTile
            icon={<Users className="h-4 w-4" />}
            label="Members"
            value={(membership?.total ?? 0).toLocaleString()}
            sub={`${membership?.active ?? 0} active · ${membership?.pending ?? 0} pending${membership?.new_this_month ? ` · +${membership.new_this_month} this month` : ''}`}
            href={canSeeMembers ? '/members' : undefined}
          />
          <KpiTile
            icon={<Landmark className="h-4 w-4" />}
            label="SDP / Sacco funds"
            value={money(num(finance.sacco?.savings) + num(finance.sacco?.share_capital))}
            sub={`Savings ${money(finance.sacco?.savings || 0)} · Shares ${money(finance.sacco?.share_capital || 0)}`}
            href={canSeeSacco ? '/sacco' : undefined}
          />
          <KpiTile
            icon={<Banknote className="h-4 w-4" />}
            label="Loan book"
            value={money(finance.loans?.outstanding || 0)}
            sub={`${finance.loans?.active_loans ?? 0} active · arrears ${money(finance.loans?.arrears || 0)}`}
            tone={num(finance.loans?.arrears) > 0 ? 'red' : 'navy'}
            href={canSeeLoans ? '/loans' : undefined}
          />
        </div>
      </div>

      {/* Action queue */}
      {pending && (pending.members_pending || pending.loans_pending || pending.unreconciled || pending.unallocated || pending.docs_pending || pending.guarantees_pending) ? (
        <Card>
          <CardHeader
            title="Needs your attention"
            subtitle="Approval and reconciliation queue"
            icon={<AlertTriangle className="h-[18px] w-[18px]" />}
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {pending.members_pending && can(user, 'members.approve') ? (
              <QueueTile count={pending.members_pending} label="Members awaiting approval" href="/members?status=pending" icon={<UserPlus className="h-4 w-4" />} tone="amber" />
            ) : null}
            {pending.loans_pending && can(user, 'loan_approvals.view') ? (
              <QueueTile count={pending.loans_pending} label="Loan applications to review" href="/loans/approvals" icon={<Stamp className="h-4 w-4" />} tone="blue" />
            ) : null}
            {pending.guarantees_pending && can(user, 'guarantors.view') ? (
              <QueueTile count={pending.guarantees_pending} label="Guarantor requests pending" href="/loans/guarantor-requests" icon={<ShieldCheck className="h-4 w-4" />} tone="blue" />
            ) : null}
            {pending.unreconciled && can(user, 'payments.update') ? (
              <QueueTile count={pending.unreconciled} label="Mobile money to reconcile" href="/payments/mobile-money" icon={<Receipt className="h-4 w-4" />} tone="red" />
            ) : null}
            {pending.unallocated && can(user, 'payments.update') ? (
              <QueueTile count={pending.unallocated} label="Payments not yet allocated" href="/payments?unallocated=1" icon={<Wallet className="h-4 w-4" />} tone="amber" />
            ) : null}
            {pending.docs_pending && can(user, 'documents.verify') ? (
              <QueueTile count={pending.docs_pending} label="Documents to verify" href="/documents?verified=false" icon={<FileText className="h-4 w-4" />} tone="slate" />
            ) : null}
            {pending.stk_pending ? (
              <QueueTile count={pending.stk_pending} label="STK pushes awaiting response" href="/payments/mobile-money" icon={<TrendingUp className="h-4 w-4" />} tone="slate" />
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Finance row */}
      {canSeeFinance ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Collections this financial year"
              subtitle="Monthly contributions received"
              icon={<TrendingUp className="h-[18px] w-[18px]" />}
              action={<Link href="/reports/contributions" className="btn-ghost btn-sm">Report</Link>}
            />
            <LineChartCard data={trendRows} xKey="period" series={[{ key: 'amount', label: 'Collected' }]} periodLabels height={250} />
          </Card>

          <Card>
            <CardHeader title={`${periodLabel(finance.period)} status`} subtitle={`Due by day ${settings.due_day} of the month`} icon={<CalendarClock className="h-[18px] w-[18px]" />} />
            <div className="flex items-center justify-center py-2">
              <Ring percentValue={collectionRate} label="collected" />
            </div>
            <dl className="mt-2 space-y-2 text-xs">
              <Row label="Expected" value={money(finance.contributions?.expected || 0)} />
              <Row label="Collected" value={money(finance.contributions?.collected || 0)} tone="green" />
              <Row label="Outstanding" value={money(finance.contributions?.outstanding || 0)} tone="red" />
              <Row label="Penalties raised" value={money(finance.contributions?.penalties || 0)} tone="amber" />
              <Row label="Monthly rate" value={`${money(settings.monthly_amount)} per member`} />
            </dl>
            <div className="mt-3 flex gap-2">
              {can(user, 'contributions.create') ? (
                <Link href="/contributions" className="btn-primary btn-sm flex-1 justify-center">Manage</Link>
              ) : null}
              {can(user, 'notifications.create') ? (
                <Link href="/admin/communication" className="btn-outline btn-sm flex-1 justify-center">Remind</Link>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}

      {/* Membership row */}
      {canSeeMembers ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Membership status" subtitle="Distribution across the register" icon={<Users className="h-[18px] w-[18px]" />} action={<Link href="/members" className="btn-ghost btn-sm">Directory</Link>} />
            {statusSplit.length ? (
              <DonutChartCard
                data={statusSplit.map((s: any) => ({ label: String(s.name).replace(/_/g, ' '), value: Number(s.value) }))}
                height={230}
                currency={false}
              />
            ) : (
              <EmptyState title="No members yet" description="Register your first CMA member to get started." icon={<Users className="h-5 w-5" />} action={<Link href="/members/new" className="btn-primary btn-sm">Add member</Link>} />
            )}
          </Card>

          <Card>
            <CardHeader title="New members" subtitle="Registrations per month (12 months)" icon={<UserPlus className="h-[18px] w-[18px]" />} />
            <LineChartCard data={growthRows} xKey="period" series={[{ key: 'joined', label: 'Joined', color: '#16a34a' }]} periodLabels currency={false} height={230} />
          </Card>

          <Card>
            <CardHeader title="By church / outstation" subtitle="Where our members worship" icon={<PieChart className="h-[18px] w-[18px]" />} />
            {churchSplit.length ? (
              <BarChartCard data={churchSplit.map((c: any) => ({ name: c.name, members: Number(c.value) }))} xKey="name" series={[{ key: 'members', label: 'Members' }]} currency={false} height={230} />
            ) : (
              <EmptyState title="No churches configured" description="Add churches and outstations under Administration → Organisation." icon={<Cross className="h-5 w-5" />} />
            )}
          </Card>
        </div>
      ) : null}

      {/* Welfare / cases + sacco */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Welfare & special funds" subtitle="Open cases and amounts collected" icon={<HeartPulse className="h-[18px] w-[18px]" />} />
          <div className="space-y-2">
            <CaseRow icon={<HeartPulse className="h-4 w-4" />} label="Sick member welfare" count={openCases?.welfare ?? 0} collected={openCases?.welfare_collected} href="/welfare" tone="red" />
            <CaseRow icon={<Cross className="h-4 w-4" />} label="Funeral contributions" count={openCases?.funerals ?? 0} collected={openCases?.funeral_collected} href="/funerals" tone="navy" />
            <CaseRow icon={<HeartHandshake className="h-4 w-4" />} label="Wedding contributions" count={openCases?.weddings ?? 0} collected={openCases?.wedding_collected} href="/weddings" tone="gold" />
            <CaseRow icon={<HandCoins className="h-4 w-4" />} label="Projects & special" count={openCases?.projects ?? 0} collected={openCases?.project_collected} href="/projects" tone="green" />
          </div>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <Row label="Total in case funds" value={money(num(openCases?.welfare_collected) + num(openCases?.funeral_collected) + num(openCases?.wedding_collected) + num(openCases?.project_collected))} strong />
          </div>
        </Card>

        {canSeeSacco ? (
          <Card className="lg:col-span-2">
            <CardHeader
              title="SDP / Sacco performance"
              subtitle="Savings deposits and share capital issued per month"
              icon={<Landmark className="h-[18px] w-[18px]" />}
              action={<Link href="/sacco" className="btn-ghost btn-sm">Open sacco</Link>}
            />
            <BarChartCard
              data={saccoRows}
              xKey="period"
              series={[
                { key: 'savings', label: 'Savings', color: '#0e2340' },
                { key: 'shares', label: 'Shares', color: '#d4af37' },
              ]}
              periodLabels
              height={220}
            />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniBox label="Savings" value={money(finance.sacco?.savings || 0)} />
              <MiniBox label="Share capital" value={money(finance.sacco?.share_capital || 0)} />
              <MiniBox label="Shares issued" value={(finance.sacco?.shares ?? 0).toLocaleString()} />
              <MiniBox label="Accounts" value={(finance.sacco?.accounts ?? 0).toLocaleString()} />
            </div>
          </Card>
        ) : null}
      </div>

      {/* Loans + recent payments */}
      <div className="grid gap-4 lg:grid-cols-2">
        {canSeeLoans ? (
          <Card>
            <CardHeader title="Loan portfolio" subtitle="Disbursed, repaid and in arrears" icon={<Banknote className="h-[18px] w-[18px]" />} action={<Link href="/loans" className="btn-ghost btn-sm">All loans</Link>} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniBox label="Disbursed" value={money(finance.loans?.disbursed || 0)} />
              <MiniBox label="Repaid" value={money(finance.loans?.repaid || 0)} tone="green" />
              <MiniBox label="Outstanding" value={money(finance.loans?.outstanding || 0)} />
              <MiniBox label="Arrears" value={money(finance.loans?.arrears || 0)} tone="red" />
            </div>
            <div className="mt-3 space-y-2">
              <ProgressBar value={num(finance.loans?.repaid)} total={Math.max(num(finance.loans?.disbursed) + num(finance.loans?.outstanding), 1)} label="Portfolio repaid" color="#16a34a" />
            </div>
            {finance.loans?.defaulted ? (
              <div className="alert alert-error mt-3">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p className="text-xs">{finance.loans.defaulted} loan(s) have defaulted and need recovery action.</p>
              </div>
            ) : null}
            {can(user, 'loan_approvals.view') && pending?.loans_pending ? (
              <Link href="/loans/approvals" className="btn-outline btn-block mt-3">
                <Stamp className="h-4 w-4" /> Review {pending.loans_pending} application(s) <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </Card>
        ) : null}

        {canSeeFinance ? (
          <Card>
            <CardHeader title="Latest payments" subtitle="Most recent receipts issued" icon={<Wallet className="h-[18px] w-[18px]" />} action={<Link href="/payments" className="btn-ghost btn-sm">All payments</Link>} />
            {finance.recent.length ? (
              <Table compact>
                <thead>
                  <tr><Th>Member</Th><Th>Receipt</Th><Th>Method</Th><Th align="right">Amount</Th></tr>
                </thead>
                <tbody>
                  {finance.recent.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <Td>
                        <Link href={`/members/${p.member_id ?? ''}`} className="font-semibold text-navy-900 hover:underline">{p.full_name}</Link>
                        <span className="block text-[10px] text-slate-400">{p.membership_no}</span>
                      </Td>
                      <Td><Link href={`/payments/${p.id}`} className="text-xs font-medium text-slate-600 hover:text-navy-800 hover:underline">{p.receipt_no}</Link></Td>
                      <Td><Badge tone="badge-grey">{p.method}</Badge></Td>
                      <Td align="right" className="font-bold">{money(p.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No payments recorded" description="Recorded contributions, savings and loan repayments appear here." icon={<Wallet className="h-5 w-5" />} />
            )}
          </Card>
        ) : null}
      </div>

      {/* Meetings, defaulters, notices */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Meetings & attendance" subtitle="Upcoming gatherings" icon={<CalendarDays className="h-[18px] w-[18px]" />} action={can(user, 'meetings.create') ? <Link href="/meetings/new" className="btn-outline btn-sm">Schedule</Link> : <Link href="/meetings" className="btn-ghost btn-sm">All</Link>} />
          {meetings.length ? (
            <ul className="space-y-2">
              {meetings.map((m: any) => (
                <li key={m.id}>
                  <Link href={`/meetings/${m.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 transition hover:border-navy-300">
                    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-navy-900 text-white">
                      <span className="text-[9px] uppercase leading-none">{fmtDate(m.meeting_date, 'MMM')}</span>
                      <span className="text-sm font-extrabold leading-tight">{new Date(m.meeting_date).getDate()}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-navy-900">{m.title}</span>
                      <span className="block truncate text-[11px] text-slate-500">{m.venue || 'Venue TBA'}{m.start_time ? ` · ${String(m.start_time).slice(0, 5)}` : ''}</span>
                    </span>
                    <StatusBadge status={m.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No upcoming meetings" description="Schedule a monthly, committee or general assembly meeting." icon={<CalendarDays className="h-5 w-5" />} />
          )}
          {attendanceRate?.total ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <ProgressBar value={attendanceRate.present} total={Math.max(attendanceRate.total, 1)} label={`Attendance rate (last 90 days): ${Math.round(percent(attendanceRate.present, attendanceRate.total))}%`} color="#0e2340" />
            </div>
          ) : null}
        </Card>

        {canSeeFinance ? (
          <Card>
            <CardHeader title="Highest outstanding" subtitle="Members with unpaid contributions" icon={<AlertTriangle className="h-[18px] w-[18px]" />} action={<Link href="/reports/contributions" className="btn-ghost btn-sm">Report</Link>} />
            {defaulters.length ? (
              <ul className="space-y-1.5">
                {defaulters.map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                    <span className="min-w-0">
                      <Link href={`/members/${d.id}`} className="block truncate text-xs font-semibold text-navy-900 hover:underline">{d.full_name}</Link>
                      <span className="block text-[10px] text-slate-500">{d.membership_no} · {d.periods} period(s)</span>
                    </span>
                    <span className="shrink-0 text-xs font-bold tabular-nums text-red-600">{money(d.outstanding)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Everyone is paid up" description="No outstanding monthly contributions. Asante!" icon={<ShieldCheck className="h-5 w-5" />} />
            )}
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Notices" subtitle="Published to members" icon={<FileText className="h-[18px] w-[18px]" />} action={can(user, 'notices.create') ? <Link href="/admin/communication" className="btn-outline btn-sm">Publish</Link> : undefined} />
          {notices.length ? (
            <ul className="space-y-2">
              {notices.map((n: any) => (
                <li key={n.id} className={`rounded-xl border p-3 ${n.pinned ? 'border-gold-300 bg-gold-50/40' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-xs font-bold text-navy-900">{n.title}</p>
                    <span className="shrink-0 text-[10px] text-slate-400">{relativeTime(n.created_at)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-600">{n.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No notices" description="Publish meeting notices, reminders and announcements to members." icon={<FileText className="h-5 w-5" />} />
          )}
          {isMember(user) ? null : (
            <Link href="/notifications" className="btn-ghost btn-block mt-3">Notification centre <ArrowRight className="h-4 w-4" /></Link>
          )}
        </Card>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function KpiTile({
  icon, label, value, sub, progress, href, tone = 'navy',
}: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string;
  progress?: { value: number; total: number }; href?: string; tone?: 'navy' | 'red' | 'green';
}) {
  const body = (
    <div className="bg-white px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        <span className={tone === 'red' ? 'text-red-600' : 'text-navy-700'}>{icon}</span>
        {label}
      </p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${tone === 'red' ? 'text-red-600' : 'text-navy-900'}`}>{value}</p>
      {progress ? <div className="mt-1.5"><ProgressBar value={progress.value} total={progress.total} height="h-1.5" /></div> : null}
      {sub ? <p className="mt-1 truncate text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="transition hover:bg-slate-50">{body}</Link> : body;
}

function QueueTile({ count, label, href, icon, tone }: { count: number; label: string; href: string; icon: React.ReactNode; tone: 'amber' | 'blue' | 'red' | 'slate' }) {
  const tones: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition hover:shadow-pop ${tones[tone]}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold leading-none tabular-nums">{count}</span>
        <span className="block truncate text-[11px] font-medium">{label}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 opacity-60" />
    </Link>
  );
}

function Ring({ percentValue, label }: { percentValue: number; label: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percentValue));
  return (
    <div className="relative h-32 w-32">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e6eaf1" strokeWidth="12" />
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke={clamped >= 80 ? '#16a34a' : clamped >= 50 ? '#d4af37' : '#dc2626'}
          strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (clamped / 100) * c}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold tabular-nums text-navy-900">{clamped}%</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      </div>
    </div>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: React.ReactNode; tone?: 'green' | 'red' | 'amber'; strong?: boolean }) {
  const tones: Record<string, string> = { green: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600' };
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`tabular-nums ${tone ? tones[tone] : 'text-navy-900'} ${strong ? 'text-sm font-extrabold' : 'font-semibold'}`}>{value}</dd>
    </div>
  );
}

function MiniBox({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-extrabold tabular-nums ${tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-navy-900'}`}>{value}</p>
    </div>
  );
}

function CaseRow({ icon, label, count, collected, href, tone }: { icon: React.ReactNode; label: string; count: number; collected: any; href: string; tone: 'red' | 'navy' | 'gold' | 'green' }) {
  const tones: Record<string, string> = { red: 'bg-red-50 text-red-600', navy: 'bg-navy-50 text-navy-800', gold: 'bg-gold-50 text-gold-700', green: 'bg-emerald-50 text-emerald-700' };
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-navy-300 hover:bg-slate-50">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-navy-900">{label}</span>
        <span className="block text-[10px] text-slate-500">{count} open case(s)</span>
      </span>
      <span className="shrink-0 text-xs font-bold tabular-nums text-navy-900">{money(collected || 0)}</span>
    </Link>
  );
}

export { lastNPeriods };
