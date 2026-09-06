import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Banknote, FileText, Wallet, TrendingUp, AlertTriangle, CalendarClock, Percent } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, KeyValue, ProgressBar, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { money, num } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { RepayLoanForm, RecordPenaltyButton, WaivePenaltyButton } from '../forms/loan-forms';

const LOAN_TONES: Record<string, string> = {
  active: 'badge badge-blue',
  completed: 'badge badge-green',
  defaulted: 'badge badge-red',
  written_off: 'badge badge-grey',
  restructured: 'badge badge-gold',
  closed: 'badge badge-grey',
};

const SCHED_TONES: Record<string, string> = {
  pending: 'badge badge-grey',
  due: 'badge badge-gold',
  paid: 'badge badge-green',
  partial: 'badge badge-blue',
  overdue: 'badge badge-red',
};

export default async function LoanDetailPage({ id, user }: { id: number; user: SessionUser }) {
  const loan = await one<any>(
    `SELECT l.*, m.full_name, m.membership_no, m.phone, m.id AS member_id,
            lt.name AS loan_type, lt.code AS loan_code, lt.penalty_rate_pct, lt.penalty_fixed,
            a.account_no
       FROM loans l
       JOIN members m ON m.id = l.member_id
       JOIN loan_types lt ON lt.id = l.loan_type_id
       LEFT JOIN sacco_accounts a ON a.id = l.sacco_account_id
      WHERE l.id = $1`,
    [id],
  );
  if (!loan) notFound();

  const isOwn = user.member_id === Number(loan.member_id);
  if (!isOwn) {
    if (isMember(user)) redirect('/loans');
    if (!can(user, 'loans.view')) redirect('/loans');
  }

  const canRepay = isOwn || can(user, 'payments.create') || can(user, 'sacco.create');
  const canManagePenalty = can(user, 'payments.create') || can(user, 'loans.update');

  const [schedule, repayments, penalties] = await Promise.all([
    query<any>(`SELECT * FROM loan_schedules WHERE loan_id = $1 ORDER BY installment_no`, [id]),
    query<any>(`SELECT * FROM loan_repayments WHERE loan_id = $1 ORDER BY repayment_date DESC, id DESC`, [id]),
    query<any>(`SELECT * FROM penalties WHERE reference_type = 'loans' AND reference_id = $1 ORDER BY created_at DESC`, [id]),
  ]);

  const paid = num(loan.amount_paid);
  const repayable = num(loan.total_repayable);
  const progressPct = repayable > 0 ? Math.min(100, (paid / repayable) * 100) : 0;
  const pendingPenalties = penalties.filter((p: any) => p.status === 'pending');

  return (
    <div className="space-y-5">
      <SectionHeading
        title={`Loan ${loan.loan_no}`}
        subtitle={`${loan.loan_type} · ${loan.full_name} (${loan.membership_no})${loan.account_no ? ` · SDP ${loan.account_no}` : ''}`}
        action={
          <>
            <Link href="/loans" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> Loan book</Link>
            <Link href={`/members/${loan.member_id}?tab=loans`} className="btn btn-outline btn-sm">Member profile</Link>
            <Link href={`/api/documents/loan-schedule?loan_id=${loan.id}`} className="btn btn-primary btn-sm" target="_blank"><FileText className="h-4 w-4" /> Schedule PDF</Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Principal" value={money(num(loan.principal))} tone="navy" icon={<Banknote className="h-4 w-4" />} sub={`Disbursed ${fmtDate(loan.disbursed_at)}`} />
        <StatCard label="Outstanding" value={money(num(loan.outstanding_balance))} tone={num(loan.outstanding_balance) > 0 ? 'red' : 'green'} icon={<Wallet className="h-4 w-4" />} sub={`of ${money(repayable)} repayable`} />
        <StatCard label="Repaid" value={money(paid)} tone="green" icon={<TrendingUp className="h-4 w-4" />} sub={`${progressPct.toFixed(0)}% of total`} progress={{ value: paid, total: repayable }} />
        <StatCard label="Arrears" value={money(num(loan.arrears))} tone={num(loan.arrears) > 0 ? 'red' : 'slate'} icon={<AlertTriangle className="h-4 w-4" />} sub={loan.next_due_date ? `Next due ${fmtDate(loan.next_due_date)}` : 'No due instalment'} />
      </div>

      <Card>
        <CardHeader
          title="Loan summary"
          subtitle={`${loan.term_months}-month ${loan.interest_method} loan at ${num(loan.interest_rate)}%`}
          action={<Badge tone={LOAN_TONES[loan.status] || 'badge badge-grey'}>{loan.status}</Badge>}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <ProgressBar value={paid} total={repayable} label="Repayment progress" />
            <p className="mt-2 text-xs text-slate-500">
              Monthly instalment <strong className="text-navy-900">{money(num(loan.monthly_repayment))}</strong>
              {loan.maturity_date ? <> · matures {fmtDate(loan.maturity_date)}</> : null}
            </p>
            {canRepay && loan.status === 'active' ? (
              <div className="mt-3">
                <RepayLoanForm loanId={Number(loan.id)} loanNo={loan.loan_no} outstanding={num(loan.outstanding_balance)} nextDue={loan.next_due_date ? fmtDate(loan.next_due_date) : null} isSelf={isOwn} />
              </div>
            ) : null}
          </div>
          <KeyValue
            columns={2}
            items={[
              ['Interest rate', `${num(loan.interest_rate)}% ${loan.interest_method}`],
              ['Processing fee', money(num(loan.processing_fee))],
              ['Total interest', money(num(loan.total_interest))],
              ['Total repayable', money(repayable)],
              ['Principal paid', money(num(loan.principal_paid))],
              ['Interest paid', money(num(loan.interest_paid))],
              ['Penalties charged', money(num(loan.penalties_charged))],
              ['Penalties paid', money(num(loan.penalties_paid))],
              ['First due date', loan.first_due_date ? fmtDate(loan.first_due_date) : '—'],
              ['Disbursement method', loan.disbursement_method || '—'],
            ]}
          />
        </div>
      </Card>

      {pendingPenalties.length > 0 ? (
        <Card>
          <CardHeader
            title="Outstanding penalties"
            subtitle={`${pendingPenalties.length} unpaid penalty(ies) totalling ${money(pendingPenalties.reduce((a: number, p: any) => a + num(p.amount) - num(p.amount_paid), 0))}`}
            icon={<AlertTriangle className="h-[18px] w-[18px]" />}
            action={canManagePenalty ? <RecordPenaltyButton /> : undefined}
          />
          <Table compact>
            <thead>
              <tr><Th>Period</Th><Th>Reason</Th><Th align="right">Amount</Th><Th>Status</Th>{can(user, 'payments.reverse') || can(user, 'loans.approve') ? <Th align="right">Action</Th> : null}</tr>
            </thead>
            <tbody>
              {penalties.map((p: any) => (
                <tr key={p.id}>
                  <Td className="text-xs text-slate-600">{p.period || '—'}</Td>
                  <Td className="text-xs text-slate-600">{p.reason || p.penalty_type}</Td>
                  <Td align="right" className="font-semibold text-red-600">{money(num(p.amount))}</Td>
                  <Td><Badge tone={p.status === 'paid' ? 'badge badge-green' : p.status === 'waived' ? 'badge badge-grey' : 'badge badge-gold'}>{p.status}</Badge></Td>
                  {can(user, 'payments.reverse') || can(user, 'loans.approve') ? (
                    <Td align="right">{p.status === 'pending' ? <WaivePenaltyButton penaltyId={Number(p.id)} /> : <span className="text-[11px] text-slate-400">—</span>}</Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-4"><CardHeader title="Repayment schedule" subtitle={`${schedule.length} instalment(s)`} icon={<CalendarClock className="h-[18px] w-[18px]" />} /></div>
          {schedule.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No schedule" description="The schedule is generated on disbursement." /></div>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <Table compact>
                <thead>
                  <tr><Th>#</Th><Th>Due</Th><Th align="right">Principal</Th><Th align="right">Interest</Th><Th align="right">Total</Th><Th align="right">Paid</Th><Th align="right">Balance</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {schedule.map((s: any) => (
                    <tr key={s.id}>
                      <Td className="text-xs text-slate-500">{s.installment_no}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(s.due_date)}</Td>
                      <Td align="right" className="text-xs">{money(num(s.principal))}</Td>
                      <Td align="right" className="text-xs text-amber-700">{money(num(s.interest))}</Td>
                      <Td align="right" className="text-xs font-semibold">{money(num(s.total_due))}</Td>
                      <Td align="right" className="text-xs text-emerald-700">{money(num(s.amount_paid))}</Td>
                      <Td align="right" className="text-xs text-slate-600">{money(num(s.balance_after))}</Td>
                      <Td><Badge tone={SCHED_TONES[s.status] || 'badge badge-grey'}>{s.status}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-4"><CardHeader title="Repayments received" subtitle={`${repayments.length} payment(s)`} icon={<Wallet className="h-[18px] w-[18px]" />} /></div>
          {repayments.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<Wallet className="h-6 w-6" />} title="No repayments yet" description={loan.status === 'active' ? 'Record the first repayment when it comes in.' : 'No repayments recorded.'} /></div>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <Table compact>
                <thead>
                  <tr><Th>Date</Th><Th>Receipt</Th><Th>Method</Th><Th align="right">Amount</Th><Th align="right">Principal</Th><Th align="right">Interest</Th><Th align="right">Balance</Th></tr>
                </thead>
                <tbody>
                  {repayments.map((r: any) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(r.repayment_date)}</Td>
                      <Td>{r.receipt_no && r.payment_id && can(user, 'receipts.view') ? <Link className="font-mono text-[11px] text-navy-800 hover:text-gold-700" href={`/receipts/${r.receipt_no}`}>{r.receipt_no}</Link> : <span className="font-mono text-[11px] text-slate-500">{r.receipt_no || '—'}</span>}</Td>
                      <Td className="text-xs text-slate-600">{r.method || '—'}</Td>
                      <Td align="right" className="text-xs font-semibold text-emerald-700">{money(num(r.amount))}</Td>
                      <Td align="right" className="text-xs text-slate-600">{money(num(r.principal_portion))}</Td>
                      <Td align="right" className="text-xs text-amber-700">{money(num(r.interest_portion))}</Td>
                      <Td align="right" className="text-xs text-slate-600">{money(num(r.balance_after))}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
