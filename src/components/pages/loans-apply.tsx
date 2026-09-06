import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Banknote, Wallet, PieChart, Landmark, Info } from 'lucide-react';
import { Card, CardHeader, EmptyState, KeyValue, SectionHeading, StatCard } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { money, num } from '@/lib/money';
import { ApplyLoanForm, type LoanTypeOption } from '../forms/loan-forms';

export default async function LoansApplyPage({ user }: { user: SessionUser }) {
  if (!can(user, 'loans.apply') && !can(user, 'loans.create')) redirect('/loans');

  const staff = !isMember(user) && can(user, 'loans.create');

  const [loanTypes, applicant, members, guarantors] = await Promise.all([
    query<any>(`SELECT * FROM loan_types WHERE active ORDER BY name`),
    user.member_id
      ? one<any>(
          `SELECT m.id, m.full_name, m.membership_no,
                  COALESCE(a.savings_balance,0) AS savings_balance,
                  COALESCE(a.share_capital,0) AS share_capital,
                  COALESCE(a.shares_count,0) AS shares_count,
                  COALESCE(a.id,0) AS sacco_account_id,
                  COALESCE((SELECT SUM(outstanding_balance) FROM loans WHERE member_id = m.id AND status IN ('active','defaulted','restructured')),0) AS loan_outstanding,
                  COALESCE((SELECT count(*) FROM loans WHERE member_id = m.id AND status IN ('active','defaulted','restructured')),0) AS active_loans
             FROM members m
             LEFT JOIN sacco_accounts a ON a.member_id = m.id
            WHERE m.id = $1`,
          [user.member_id],
        )
      : Promise.resolve(null),
    staff
      ? query<any>(
          `SELECT m.id, m.full_name, m.membership_no FROM members m
            WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
            ORDER BY m.full_name`,
        )
      : Promise.resolve([] as any[]),
    query<any>(
      `SELECT m.id, m.full_name, m.membership_no FROM members m
        WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
          AND ($1::bigint IS NULL OR m.id <> $1)
        ORDER BY m.full_name`,
      [user.member_id ?? null],
    ),
  ]);

  const types: LoanTypeOption[] = loanTypes.map((t: any) => ({
    id: Number(t.id),
    code: t.code,
    name: t.name,
    min_amount: num(t.min_amount),
    max_amount: num(t.max_amount),
    interest_rate: num(t.interest_rate),
    interest_period: t.interest_period,
    interest_method: t.interest_method,
    max_repayment_months: Number(t.max_repayment_months),
    min_repayment_months: Number(t.min_repayment_months),
    guarantors_required: Number(t.guarantors_required),
    processing_fee_pct: num(t.processing_fee_pct),
    processing_fee_fixed: num(t.processing_fee_fixed),
  }));

  const memberOptions = members.map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.membership_no}` }));
  const guarantorOptions = guarantors.map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.membership_no}` }));

  const borrowingPower = applicant ? Math.max(0, num(applicant.savings_balance) * 3 - num(applicant.loan_outstanding)) : 0;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Apply for a loan"
        subtitle="Choose a loan product, enter the amount and repayment period, and nominate your guarantors. You'll see the repayment preview before submitting."
        action={<Link href="/loans" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> Back to loans</Link>}
      />

      {applicant ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Savings balance" value={money(num(applicant.savings_balance))} tone="green" icon={<Wallet className="h-4 w-4" />} sub={num(applicant.savings_balance) > 0 ? 'Builds your borrowing power' : 'Save to unlock borrowing'} />
          <StatCard label="Share capital" value={money(num(applicant.share_capital))} tone="gold" icon={<PieChart className="h-4 w-4" />} sub={`${applicant.shares_count} share(s)`} />
          <StatCard label="Loan outstanding" value={money(num(applicant.loan_outstanding))} tone={num(applicant.loan_outstanding) > 0 ? 'red' : 'slate'} icon={<Landmark className="h-4 w-4" />} sub={`${applicant.active_loans} active loan(s)`} />
          <StatCard label="Est. borrowing power" value={money(borrowingPower)} tone="navy" icon={<Banknote className="h-4 w-4" />} sub="≈ 3× savings less commitments" />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Loan application" subtitle={staff ? 'Applying on behalf of a member.' : 'All fields are validated against the product rules before submission.'} icon={<Banknote className="h-[18px] w-[18px]" />} />
          {types.length === 0 ? (
            <EmptyState icon={<Info className="h-6 w-6" />} title="No loan products available" description="Loan products must be configured before members can apply." />
          ) : (
            <ApplyLoanForm
              loanTypes={types}
              guarantorOptions={guarantorOptions}
              memberOptions={staff ? memberOptions : undefined}
              defaultMemberId={staff ? null : user.member_id}
              defaultMemberName={applicant?.full_name}
              isStaff={staff}
            />
          )}
        </Card>

        <div className="space-y-4">
          <Card padded={false}>
            <div className="p-4"><CardHeader title="Available products" subtitle={`${types.length} loan product(s)`} /></div>
            <div className="divide-y divide-slate-100">
              {types.map((t) => (
                <div key={t.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-navy-900">{t.name}</p>
                    <span className="badge badge-grey font-mono">{t.code}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {money(t.min_amount)} – {money(t.max_amount)} · {t.interest_rate}% {t.interest_period} ({t.interest_method})
                  </p>
                  <p className="text-xs text-slate-500">
                    {t.min_repayment_months}–{t.max_repayment_months} months · {t.guarantors_required} guarantor(s)
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="How approval works" />
            <KeyValue
              columns={1}
              items={[
                ['1', 'You submit the application and nominate guarantors.'],
                ['2', 'Each guarantor is notified and must accept.'],
                ['3', 'The loan committee reviews eligibility and approves or declines.'],
                ['4', 'On approval, the loan is disbursed and a repayment schedule is generated.'],
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
