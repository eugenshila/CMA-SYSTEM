import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ListChecks, Plus, Banknote, Percent, Users, AlertTriangle } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { query, one } from '@/lib/db';
import { money, num } from '@/lib/money';
import { NewLoanTypeButton, LoanTypeRowActions } from '../forms/loan-forms';

export default async function LoanTypesPage({ user }: { user: SessionUser }) {
  // Loan products are configured by staff only.
  if (isMember(user) || !can(user, 'loans.view')) redirect('/loans');

  const canManage = can(user, 'loans.manage') || can(user, 'settings.update');

  const [types, usage, stats] = await Promise.all([
    query<any>(`SELECT * FROM loan_types ORDER BY active DESC, name`),
    query<any>(
      `SELECT loan_type_id, count(*)::int AS loans, COALESCE(SUM(outstanding_balance),0) AS outstanding
         FROM loans GROUP BY loan_type_id`,
    ),
    one<any>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE active)::int AS active FROM loan_types`,
    ),
  ]);

  const usageMap = new Map(usage.map((u: any) => [String(u.loan_type_id), u]));

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Loan products"
        subtitle="Configure eligibility, pricing, guarantees and penalties for each loan product. Changes apply to new applications; existing loans keep their original terms."
        action={
          <>
            <Link href="/loans" className="btn btn-outline btn-sm"><Banknote className="h-4 w-4" /> Loan book</Link>
            {canManage ? <NewLoanTypeButton /> : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active products" value={String(stats?.active || 0)} tone="green" icon={<ListChecks className="h-4 w-4" />} sub={`${stats?.total || 0} total`} />
        <StatCard label="Products" value={String(stats?.total || 0)} tone="navy" icon={<Banknote className="h-4 w-4" />} />
        <StatCard label="In use" value={String(usage.length)} tone="gold" icon={<Percent className="h-4 w-4" />} sub="products with disbursed loans" />
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader title="Loan product catalogue" subtitle={`${types.length} product(s)`} icon={<ListChecks className="h-[18px] w-[18px]" />} />
        </div>
        {types.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState icon={<Plus className="h-6 w-6" />} title="No loan products" description={canManage ? 'Create your first loan product to let members apply.' : 'No loan products have been configured yet.'} />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Amount range</Th>
                <Th>Interest</Th>
                <Th>Term</Th>
                <Th>Guarantors</Th>
                <Th>Eligibility</Th>
                <Th align="right">Outstanding</Th>
                <Th>Status</Th>
                {canManage ? <Th align="right">Actions</Th> : null}
              </tr>
            </thead>
            <tbody>
              {types.map((t: any) => {
                const u = usageMap.get(String(t.id));
                return (
                  <tr key={t.id}>
                    <Td>
                      <span className="font-semibold text-navy-900">{t.name}</span>
                      <span className="ml-2 badge badge-grey font-mono">{t.code}</span>
                      {t.description ? <span className="block max-w-xs truncate text-[11px] text-slate-400">{t.description}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{money(num(t.min_amount))} – {money(num(t.max_amount))}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{num(t.interest_rate)}% {t.interest_period}<span className="block text-[11px] text-slate-400">{t.interest_method}</span></Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{t.min_repayment_months}–{t.max_repayment_months} mo</Td>
                    <Td className="text-xs text-slate-600"><Users className="mr-1 inline h-3 w-3" />{t.guarantors_required}</Td>
                    <Td className="text-[11px] text-slate-500">
                      {num(t.savings_multiplier) > 0 ? <span className="block">{t.savings_multiplier}× savings</span> : null}
                      {num(t.min_savings_required) > 0 ? <span className="block">min {money(num(t.min_savings_required))} savings</span> : null}
                      {num(t.min_membership_months) > 0 ? <span className="block">{t.min_membership_months} mo membership</span> : null}
                      {t.requires_collateral ? <span className="block text-amber-700"><AlertTriangle className="mr-0.5 inline h-3 w-3" />collateral</span> : null}
                    </Td>
                    <Td align="right" className="font-medium text-navy-900">{u ? money(num(u.outstanding)) : '—'}{u ? <span className="block text-[11px] text-slate-400">{u.loans} loan(s)</span> : null}</Td>
                    <Td><Badge tone={t.active ? 'badge badge-green' : 'badge badge-grey'}>{t.active ? 'Active' : 'Inactive'}</Badge></Td>
                    {canManage ? <Td align="right"><LoanTypeRowActions loanType={t} /></Td> : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
