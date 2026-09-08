import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, Wallet, AlertTriangle, ShieldCheck, TrendingUp, Download, Banknote } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  Pagination,
  ProgressBar,
  SectionHeading,
  StatCard,
  Table,
  Td,
  Th,
} from '../ui/primitives';
import { SearchInput, SelectFilter } from '../ui/client';
import { BarChartCard, DonutChartCard } from '../charts';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { getContributionSettings } from '@/lib/settings';
import { money, num, percent } from '@/lib/money';
import { fmtDate, isPast, lastNPeriods, nextPeriod, periodKey, periodLabel, prevPeriod } from '@/lib/dates';
import { BillingControls, ContributionSettingsForm, ContributionEditButton, ExemptionToggle, PeriodSwitcher } from '../forms/contribution-forms';

const PER_PAGE = 25;

const STATUS_TONES: Record<string, string> = {
  paid: 'badge badge-green',
  partial: 'badge badge-gold',
  unpaid: 'badge badge-red',
  overdue: 'badge badge-red',
  exempted: 'badge badge-grey',
};

export default async function ContributionsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!can(user, 'contributions.view')) redirect('/dashboard');

  const settings = await getContributionSettings();
  const period = String(sp.period || periodKey(new Date()));
  const status = String(sp.status || '');
  const parishFilter = String(sp.parish || '');
  const churchId = Number(sp.church_id || 0) || null;
  const sccId = Number(sp.scc_id || 0) || null;
  const search = String(sp.search || sp.q || '').trim();
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const scope = user.scope_parish_id ? `AND m.parish_id = ${Number(user.scope_parish_id)}` : parishFilter ? `AND m.parish_id = ${Number(parishFilter)}` : '';
  const params: any[] = [period];
  const where = [`mc.period = $1`];
  if (status) {
    params.push(status);
    where.push(`mc.status = $${params.length}`);
  }
  if (churchId) {
    params.push(churchId);
    where.push(`m.church_id = $${params.length}`);
  }
  if (sccId) {
    params.push(sccId);
    where.push(`m.scc_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length})`);
  }
  const whereSql = `${where.join(' AND ')} ${scope}`;

  const trendPeriods = lastNPeriods(6, `${period}-15`);

  const [summary, rows, countRow, trend, statusSplit, arrears, churches, sccs, parishes, exemptedMembers] = await Promise.all([
    one<any>(
      `SELECT count(*)::int AS bills,
              COALESCE(SUM(mc.amount_due),0) AS expected,
              COALESCE(SUM(mc.amount_paid),0) AS collected,
              COALESCE(SUM(mc.penalty),0) AS penalties,
              count(*) FILTER (WHERE mc.status = 'paid')::int AS paid,
              count(*) FILTER (WHERE mc.status = 'partial')::int AS partial,
              count(*) FILTER (WHERE mc.status IN ('unpaid','overdue'))::int AS unpaid,
              count(*) FILTER (WHERE mc.exempted)::int AS exempted
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id
        WHERE ${whereSql}`,
      params,
    ),
    query<any>(
      `SELECT mc.id AS contribution_id, mc.period, mc.period_label, mc.amount_due, mc.amount_paid, mc.penalty,
              mc.status, mc.exempted, mc.exemption_reason, mc.due_date,
              m.id AS member_id, m.full_name, m.membership_no, m.exempt_monthly, m.exemption_reason AS member_exemption,
              ch.name AS church_name, s.name AS scc_name
         FROM member_contributions mc
         JOIN members m ON m.id = mc.member_id
         LEFT JOIN churches ch ON ch.id = m.church_id
         LEFT JOIN small_christian_communities s ON s.id = m.scc_id
        WHERE ${whereSql}
        ORDER BY m.membership_no
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(`SELECT count(*)::int AS total FROM member_contributions mc JOIN members m ON m.id = mc.member_id WHERE ${whereSql}`, params),
    query<any>(
      `SELECT mc.period AS label,
              COALESCE(SUM(mc.amount_paid),0)::float AS collected,
              COALESCE(SUM(mc.amount_due),0)::float AS expected
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id
        WHERE mc.period = ANY($1::text[]) ${scope}
        GROUP BY mc.period ORDER BY mc.period`,
      [trendPeriods],
    ),
    query<any>(
      `SELECT initcap(mc.status) AS label, count(*)::int AS value
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id
        WHERE ${whereSql} GROUP BY 1 ORDER BY 2 DESC`,
      params,
    ),
    query<any>(
      `SELECT m.id AS member_id, m.full_name, m.membership_no, s.name AS scc_name,
              COALESCE(SUM(mc.amount_due - mc.amount_paid),0) AS outstanding,
              count(*)::int AS months, max(mc.period) AS last_period
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id
         LEFT JOIN small_christian_communities s ON s.id = m.scc_id
        WHERE mc.status IN ('unpaid','partial','overdue') AND mc.exempted = FALSE ${scope}
        GROUP BY m.id, m.full_name, m.membership_no, s.name
        ORDER BY outstanding DESC LIMIT 10`,
    ),
    query<any>(
      `SELECT c.id, c.name FROM churches c ${user.scope_parish_id ? `WHERE c.parish_id = ${Number(user.scope_parish_id)}` : ''} ORDER BY c.name`,
    ),
    query<any>(
      `SELECT s.id, s.name FROM small_christian_communities s ${churchId ? `WHERE s.church_id = ${churchId}` : user.scope_parish_id ? `JOIN churches c ON c.id = s.church_id WHERE c.parish_id = ${Number(user.scope_parish_id)}` : ''} ORDER BY s.name`,
    ),
    query<any>('SELECT id, name FROM parishes ORDER BY name'),
    query<any>(
      `SELECT m.id, m.full_name, m.membership_no, m.exemption_reason FROM members m
        WHERE m.deleted_at IS NULL AND m.exempt_monthly = TRUE ${scope} ORDER BY m.full_name LIMIT 50`,
    ),
  ]);

  const expected = num(summary?.expected);
  const collected = num(summary?.collected);
  const outstanding = Math.max(0, expected - collected);
  const unpaidCount = Number(summary?.unpaid || 0) + Number(summary?.partial || 0);
  const total = Number(countRow?.total || 0);
  const canManage = can(user, 'contributions.manage') || can(user, 'settings.update');
  const canBill = can(user, 'contributions.create') || can(user, 'contributions.manage');
  const canEdit = can(user, 'contributions.update');
  const canPay = can(user, 'payments.create');

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Monthly contributions"
        subtitle={`${periodLabel(period)} · ${money(settings.monthly_amount)} per member, due on day ${settings.due_day}${settings.penalty_enabled ? ` · penalty ${money(settings.penalty_amount)} after ${settings.penalty_after_days} days` : ''}`}
        action={
          <>
            <PeriodSwitcher period={period} />
            <Link href={`/api/exports/contributions?period=${period}&format=excel`} className="btn btn-outline btn-sm">
              <Download className="h-4 w-4" /> Export
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Bills issued" value={String(summary?.bills || 0)} tone="navy" icon={<CalendarDays className="h-4 w-4" />} sub={`${summary?.exempted || 0} exempted`} />
        <StatCard label="Expected" value={money(expected)} tone="slate" icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Collected" value={money(collected)} tone="green" icon={<Wallet className="h-4 w-4" />} sub={`${percent(collected, expected).toFixed(0)}% of the month`} />
        <StatCard label="Outstanding" value={money(outstanding)} tone="red" icon={<AlertTriangle className="h-4 w-4" />} sub={`${unpaidCount} member(s) behind`} />
        <StatCard label="Penalties charged" value={money(num(summary?.penalties))} tone="gold" icon={<Banknote className="h-4 w-4" />} />
      </div>

      {canBill || canManage ? (
        <Card>
          <CardHeader title="Billing & reminders" subtitle="Generate the monthly bills, remind members who have not paid, or recalculate statuses after manual changes." />
          <BillingControls
            period={period}
            unpaidCount={unpaidCount}
            canBill={canBill}
            canManage={canManage}
            canRemind={can(user, 'notifications.create') || can(user, 'contributions.update')}
            parishes={parishes.map((p: any) => ({ value: Number(p.id), label: p.name }))}
          />
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-4">
            <CardHeader title="Collection trend" subtitle="Collected against expected for the last six months." />
          </div>
          <div className="px-2 pb-4">
            <BarChartCard
              data={trend.map((t) => ({ ...t, label: periodLabel(t.label) }))}
              xKey="label"
              series={[
                { key: 'collected', label: 'Collected', color: '#0e7c4a' },
                { key: 'expected', label: 'Expected', color: '#d4af37' },
              ]}
              periodLabels
            />
          </div>
        </Card>
        <Card padded={false}>
          <div className="p-4">
            <CardHeader title="Status this month" />
          </div>
          <div className="px-2 pb-4">
            <DonutChartCard
              data={statusSplit.map((s: any) => ({ label: s.label, value: Number(s.value) }))}
              currency={false}
              centerLabel="Bills"
              centerValue={String(summary?.bills || 0)}
            />
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader
            title={`Contribution register — ${periodLabel(period)}`}
            subtitle={`${total} record${total === 1 ? '' : 's'}`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput param="search" placeholder="Search member…" className="w-44 sm:w-56" extraParams={{ period }} />
                <SelectFilter param="parish" placeholder="All parishes" className="w-56" options={parishes.map((p: any) => ({ value: String(p.id), label: p.name }))} />
                <SelectFilter
                  param="status"
                  placeholder="All statuses"
                  className="w-36"
                  options={[
                    { value: 'paid', label: 'Paid' },
                    { value: 'partial', label: 'Partial' },
                    { value: 'unpaid', label: 'Unpaid' },
                    { value: 'overdue', label: 'Overdue' },
                    { value: 'exempted', label: 'Exempted' },
                  ]}
                />
                <SelectFilter
                  param="church_id"
                  placeholder="All churches"
                  className="w-44"
                  options={churches.map((c: any) => ({ value: String(c.id), label: c.name }))}
                />
                <SelectFilter
                  param="scc_id"
                  placeholder="All SCCs"
                  className="w-44"
                  options={sccs.map((s: any) => ({ value: String(s.id), label: s.name }))}
                />
              </div>
            }
          />
        </div>

        {rows.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title={`No bills for ${periodLabel(period)}`}
              description={canBill ? 'Use “Bill this month” above to generate the contribution bills for every active member.' : 'Bills for this month have not been generated yet.'}
            />
          </div>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>SCC / church</Th>
                  <Th align="right">Due</Th>
                  <Th align="right">Paid</Th>
                  <Th align="right">Penalty</Th>
                  <Th align="right">Balance</Th>
                  <Th>Due date</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const due = num(r.amount_due);
                  const paid = num(r.amount_paid);
                  const balance = Math.max(0, due + num(r.penalty) - paid);
                  return (
                    <tr key={r.contribution_id} className="hover:bg-slate-50/70">
                      <Td>
                        <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${r.member_id}?tab=contributions`}>{r.full_name}</Link>
                        <div className="text-[11px] text-slate-500">{r.membership_no}</div>
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {r.scc_name || '—'}
                        <div className="text-[11px] text-slate-400">{r.church_name || ''}</div>
                      </Td>
                      <Td align="right">{money(due)}</Td>
                      <Td align="right" className={paid > 0 ? 'font-semibold text-emerald-700' : 'text-slate-400'}>{money(paid)}</Td>
                      <Td align="right" className={num(r.penalty) > 0 ? 'text-amber-700' : 'text-slate-400'}>{num(r.penalty) > 0 ? money(num(r.penalty)) : '—'}</Td>
                      <Td align="right" className="font-semibold">{balance > 0 ? money(balance) : '—'}</Td>
                      <Td className="whitespace-nowrap text-xs">
                        {r.due_date ? (
                          <span className={isPast(r.due_date) && balance > 0 && !r.exempted ? 'font-semibold text-red-600' : 'text-slate-600'}>{fmtDate(r.due_date)}</span>
                        ) : '—'}
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONES[r.status] || 'badge badge-grey'}>{String(r.status).replace(/_/g, ' ')}</Badge>
                        {r.exempted && r.exemption_reason ? <div className="mt-0.5 text-[11px] text-slate-500">{r.exemption_reason}</div> : null}
                      </Td>
                      <Td align="right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {balance > 0 && canPay ? (
                            <Link
                              href={`/payments/new?member_id=${r.member_id}&alloc_type=monthly_contribution&period=${r.period}&amount=${balance.toFixed(2)}`}
                              className="btn btn-gold btn-sm"
                            >
                              Collect
                            </Link>
                          ) : null}
                          {canEdit ? (
                            <ContributionEditButton
                              contributionId={Number(r.contribution_id)}
                              periodLabel={r.period_label || periodLabel(r.period)}
                              memberName={r.full_name}
                              amountDue={due}
                              dueDate={r.due_date ? fmtDate(r.due_date) : ''}
                              exempted={Boolean(r.exempted)}
                              reason={r.exemption_reason}
                            />
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="p-4">
              <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/contributions" query={{ period, status, parish: parishFilter, church_id: churchId, scc_id: sccId, search }} />
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-4">
            <CardHeader title="Members with the highest arrears" subtitle="Across every billed month." />
          </div>
          {arrears.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState title="No arrears" description="Every billed member is up to date." /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>SCC</Th>
                  <Th align="right">Months</Th>
                  <Th align="right">Outstanding</Th>
                  {canPay ? <Th align="right">Action</Th> : null}
                </tr>
              </thead>
              <tbody>
                {arrears.map((a: any) => (
                  <tr key={a.member_id}>
                    <Td>
                      <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${a.member_id}?tab=contributions`}>{a.full_name}</Link>
                      <div className="text-[11px] text-slate-500">{a.membership_no} · last unpaid {periodLabel(a.last_period)}</div>
                    </Td>
                    <Td className="text-xs text-slate-600">{a.scc_name || '—'}</Td>
                    <Td align="right">{a.months}</Td>
                    <Td align="right" className="font-semibold text-red-600">{money(num(a.outstanding))}</Td>
                    {canPay ? (
                      <Td align="right">
                        <Link href={`/payments/new?member_id=${a.member_id}`} className="btn btn-outline btn-sm">Collect</Link>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card padded={false}>
            <div className="p-4">
              <CardHeader title="Members exempted from monthly contributions" subtitle="Exemptions are permanent until removed by an authorised officer." />
            </div>
            {exemptedMembers.length === 0 ? (
              <div className="p-4 pt-0"><EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No exemptions" description="Every active member is billed monthly." /></div>
            ) : (
              <Table compact>
                <thead>
                  <tr>
                    <Th>Member</Th>
                    <Th>Reason</Th>
                    {canManage ? <Th align="right">Action</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {exemptedMembers.map((m: any) => (
                    <tr key={m.id}>
                      <Td>
                        <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${m.id}`}>{m.full_name}</Link>
                        <div className="text-[11px] text-slate-500">{m.membership_no}</div>
                      </Td>
                      <Td className="text-xs text-slate-600">{m.exemption_reason || '—'}</Td>
                      {canManage ? (
                        <Td align="right">
                          <ExemptionToggle memberId={Number(m.id)} memberName={m.full_name} exempt reason={m.exemption_reason} />
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {canManage ? (
            <Card>
              <CardHeader title="Contribution settings" subtitle="Applies to every parish unless overridden when billing." />
              <ContributionSettingsForm settings={settings} />
            </Card>
          ) : (
            <Card>
              <CardHeader title="Contribution settings" />
              <KeyValue
                columns={2}
                items={[
                  ['Monthly amount', money(settings.monthly_amount)],
                  ['Due day', `Day ${settings.due_day}`],
                  ['Penalty', settings.penalty_enabled ? `${money(settings.penalty_amount)} after ${settings.penalty_after_days} days` : 'Disabled'],
                  ['Auto-billing', settings.auto_bill ? 'Enabled' : 'Manual'],
                ]}
              />
            </Card>
          )}

          <Card>
            <CardHeader title="This month at a glance" />
            <ProgressBar value={collected} total={expected || 1} label={`${money(collected)} collected of ${money(expected)}`} />
            <div className="mt-4">
              <KeyValue
                columns={2}
                items={[
                  ['Paid in full', String(summary?.paid || 0)],
                  ['Partially paid', String(summary?.partial || 0)],
                  ['Unpaid / overdue', String(summary?.unpaid || 0)],
                  ['Exempted', String(summary?.exempted || 0)],
                ]}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
