import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Banknote, TrendingUp, AlertTriangle, CheckCircle2, Download, FilePlus2, Landmark } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput, SelectFilter } from '../ui/client';
import { DonutChartCard } from '../charts';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { money, num } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { RepayLoanForm, RunHousekeepingButton } from '../forms/loan-forms';

const PER_PAGE = 20;

const LOAN_TONES: Record<string, string> = {
  active: 'badge badge-blue',
  completed: 'badge badge-green',
  defaulted: 'badge badge-red',
  written_off: 'badge badge-grey',
  restructured: 'badge badge-gold',
  closed: 'badge badge-grey',
};

export default async function LoansPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!can(user, 'loans.view') && !user.member_id) redirect('/dashboard');

  // Members only ever see their OWN loans, never the whole book.
  const ownOnly = isMember(user) || (!can(user, 'loans.view') && Boolean(user.member_id));

  const search = String(sp.search || sp.q || '').trim();
  const status = String(sp.status || '');
  const typeId = String(sp.type || '');
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const params: any[] = [];
  const where: string[] = ['1=1'];
  if (ownOnly) {
    params.push(user.member_id);
    where.push(`l.member_id = $${params.length}`);
  } else if (user.scope_parish_id) {
    params.push(Number(user.scope_parish_id));
    where.push(`m.parish_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`l.status = $${params.length}`);
  }
  if (typeId) {
    params.push(Number(typeId));
    where.push(`l.loan_type_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length} OR l.loan_no ILIKE $${params.length})`);
  }
  const whereSql = where.join(' AND ');

  const canRepay = can(user, 'payments.create') || can(user, 'sacco.create');
  const canHousekeep = can(user, 'loans.update') || can(user, 'loans.manage');

  const [loans, countRow, totals, byStatus, loanTypes] = await Promise.all([
    query<any>(
      `SELECT l.*, m.full_name, m.membership_no, m.id AS member_id, lt.name AS loan_type, lt.code AS loan_code
         FROM loans l
         JOIN members m ON m.id = l.member_id
         JOIN loan_types lt ON lt.id = l.loan_type_id
        WHERE ${whereSql}
        ORDER BY l.status = 'active' DESC, l.next_due_date ASC NULLS LAST, l.id DESC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(`SELECT count(*)::int AS total FROM loans l JOIN members m ON m.id = l.member_id WHERE ${whereSql}`, params),
    one<any>(
      `SELECT count(*)::int AS loans,
              count(*) FILTER (WHERE l.status = 'active')::int AS active,
              count(*) FILTER (WHERE l.status = 'defaulted')::int AS defaulted,
              count(*) FILTER (WHERE l.status = 'completed')::int AS completed,
              COALESCE(SUM(l.principal),0) AS disbursed,
              COALESCE(SUM(l.outstanding_balance),0) AS outstanding,
              COALESCE(SUM(l.arrears),0) AS arrears,
              COALESCE(SUM(l.amount_paid),0) AS repaid
         FROM loans l JOIN members m ON m.id = l.member_id WHERE ${whereSql}`,
      params,
    ),
    query<any>(
      `SELECT l.status AS label, count(*)::int AS value FROM loans l JOIN members m ON m.id = l.member_id
        WHERE ${whereSql} GROUP BY l.status ORDER BY 2 DESC`,
      params,
    ),
    query<any>(`SELECT id, code, name FROM loan_types WHERE active ORDER BY name`),
  ]);

  const total = Number(countRow?.total || 0);

  return (
    <div className="space-y-5">
      <SectionHeading
        title={ownOnly ? 'My loans' : 'Loan book'}
        subtitle={
          ownOnly
            ? 'Your active and past SDP / Sacco loans, balances and repayment schedule.'
            : 'All disbursed loans across the loan book — balances, arrears and repayment tracking.'
        }
        action={
          <>
            {can(user, 'loans.apply') ? (
              <Link href="/loans/apply" className="btn btn-primary btn-sm"><FilePlus2 className="h-4 w-4" /> Apply for a loan</Link>
            ) : null}
            {can(user, 'loan_approvals.view') && !ownOnly ? (
              <Link href="/loans/approvals" className="btn btn-outline btn-sm"><CheckCircle2 className="h-4 w-4" /> Approvals</Link>
            ) : null}
            {can(user, 'loans.export') && !ownOnly ? (
              <Link href="/api/exports/loans?format=excel" className="btn btn-outline btn-sm"><Download className="h-4 w-4" /> Export</Link>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={ownOnly ? 'My outstanding' : 'Outstanding balance'} value={money(num(totals?.outstanding))} tone="navy" icon={<Banknote className="h-4 w-4" />} sub={`${totals?.active || 0} active loan(s)`} />
        <StatCard label={ownOnly ? 'Amount borrowed' : 'Total disbursed'} value={money(num(totals?.disbursed))} tone="slate" icon={<Landmark className="h-4 w-4" />} sub={`${totals?.loans || 0} loan(s)`} />
        <StatCard label="Repaid" value={money(num(totals?.repaid))} tone="green" icon={<TrendingUp className="h-4 w-4" />} sub={`${totals?.completed || 0} completed`} />
        <StatCard label="Arrears" value={money(num(totals?.arrears))} tone={(num(totals?.arrears) > 0) ? 'red' : 'slate'} icon={<AlertTriangle className="h-4 w-4" />} sub={`${totals?.defaulted || 0} defaulted`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <div className="p-4">
            <CardHeader
              title={ownOnly ? 'My loan history' : 'Loans'}
              subtitle={`${total} loan${total === 1 ? '' : 's'}`}
              action={canHousekeep && !ownOnly ? <RunHousekeepingButton /> : undefined}
            />
            {!ownOnly ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <SearchInput param="search" placeholder="Search member or loan no…" />
                <SelectFilter
                  param="status"
                  placeholder="All statuses"
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'defaulted', label: 'Defaulted' },
                    { value: 'restructured', label: 'Restructured' },
                    { value: 'written_off', label: 'Written off' },
                    { value: 'closed', label: 'Closed' },
                  ]}
                />
                <SelectFilter param="type" placeholder="All products" options={loanTypes.map((t: any) => ({ value: String(t.id), label: t.name }))} />
              </div>
            ) : null}
          </div>

          {loans.length === 0 ? (
            <div className="p-4 pt-0">
              <EmptyState
                icon={<Banknote className="h-6 w-6" />}
                title={ownOnly ? 'You have no loans yet' : 'No loans found'}
                description={ownOnly ? 'Apply for a loan when you need one — your savings and shares build borrowing power.' : 'Adjust the filters, or disburse an approved application.'}
              />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Loan</Th>
                  {!ownOnly ? <Th>Member</Th> : null}
                  <Th>Product</Th>
                  <Th align="right">Principal</Th>
                  <Th align="right">Monthly</Th>
                  <Th align="right">Outstanding</Th>
                  {!ownOnly ? <Th align="right">Arrears</Th> : null}
                  <Th>Next due</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l: any) => (
                  <tr key={l.id}>
                    <Td>
                      <Link className="font-mono text-xs font-semibold text-navy-800 hover:text-gold-700" href={`/loans/${l.id}`}>{l.loan_no}</Link>
                    </Td>
                    {!ownOnly ? (
                      <Td>
                        <Link className="text-sm text-slate-700 hover:text-navy-800" href={`/members/${l.member_id}`}>{l.full_name}</Link>
                        <span className="block text-[11px] text-slate-400">{l.membership_no}</span>
                      </Td>
                    ) : null}
                    <Td className="text-xs text-slate-600">{l.loan_type}</Td>
                    <Td align="right" className="font-medium">{money(num(l.principal))}</Td>
                    <Td align="right" className="text-slate-600">{money(num(l.monthly_repayment))}</Td>
                    <Td align="right" className="font-semibold text-navy-900">{money(num(l.outstanding_balance))}</Td>
                    {!ownOnly ? (
                      <Td align="right" className={num(l.arrears) > 0 ? 'font-semibold text-red-600' : 'text-slate-400'}>{money(num(l.arrears))}</Td>
                    ) : null}
                    <Td className="whitespace-nowrap text-xs text-slate-600">{l.next_due_date ? fmtDate(l.next_due_date) : '—'}</Td>
                    <Td><Badge tone={LOAN_TONES[l.status] || 'badge badge-grey'}>{l.status}</Badge></Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        {l.status === 'active' && (ownOnly || canRepay) ? (
                          <RepayLoanForm loanId={Number(l.id)} loanNo={l.loan_no} outstanding={num(l.outstanding_balance)} nextDue={l.next_due_date ? fmtDate(l.next_due_date) : null} isSelf={ownOnly} />
                        ) : null}
                        <Link href={`/loans/${l.id}`} className="btn btn-ghost btn-sm">View</Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="px-4 pb-4">
            <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/loans" query={{ search, status, type: typeId }} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card padded={false}>
            <div className="p-4"><CardHeader title="Portfolio by status" subtitle="Loan count across statuses." /></div>
            <div className="px-4 pb-4">
              <DonutChartCard
                data={byStatus.map((s: any) => ({ label: String(s.label).replace(/_/g, ' '), value: Number(s.value) }))}
                currency={false}
                centerLabel="Loans"
                centerValue={String(totals?.loans || 0)}
              />
            </div>
          </Card>
          {ownOnly ? (
            <Card>
              <CardHeader title="Borrowing tips" subtitle="How to strengthen your next application" />
              <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                <li>Save consistently — most products lend up to a multiple of your savings.</li>
                <li>Buy shares; some products require a minimum shareholding.</li>
                <li>Clear arrears on any active loan before applying again.</li>
                <li>Choose guarantors who are active members in good standing.</li>
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
