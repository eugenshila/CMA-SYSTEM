import 'server-only';
import { one, query } from '@/lib/db';
import { memberBalances } from '@/lib/payments';
import { memberCaseOutstanding } from '@/lib/contributions';
import { money, num, round2 } from '@/lib/money';
import { fmtDate, periodKey, periodLabel } from '@/lib/dates';
import type { Obligation } from '@/components/forms/pay-now';

const TYPE_LABELS: Record<string, string> = {
  welfare: 'Welfare case',
  funeral: 'Funeral contribution',
  wedding: 'Wedding contribution',
  project: 'Special project',
};

/**
 * Everything a member currently owes, expressed as payment allocations.
 * Used by the treasurer's "record payment" screen and the member Pay Now flow.
 */
export async function memberObligations(memberId: number): Promise<Obligation[]> {
  const [unpaid, cases, loans, balances, account] = await Promise.all([
    query<any>(
      `SELECT id, period, period_label, amount_due, amount_paid, penalty, status, due_date
         FROM member_contributions
        WHERE member_id = $1 AND exempted = FALSE AND amount_paid < amount_due
        ORDER BY period DESC LIMIT 24`,
      [memberId],
    ),
    memberCaseOutstanding(memberId),
    query<any>(
      `SELECT id, loan_no, outstanding_balance, monthly_repayment, next_due_date, arrears, status
         FROM loans WHERE member_id = $1 AND status IN ('active','defaulted','restructured')
        ORDER BY next_due_date NULLS LAST`,
      [memberId],
    ),
    memberBalances(memberId),
    one<any>('SELECT account_no, savings_balance FROM sacco_accounts WHERE member_id = $1', [memberId]),
  ]);

  const obligations: Obligation[] = [];
  const thisPeriod = periodKey(new Date());

  for (const c of unpaid) {
    const balance = round2(num(c.amount_due) - num(c.amount_paid) + num(c.penalty));
    obligations.push({
      key: `mc-${c.id}`,
      label: `Monthly contribution — ${c.period_label || periodLabel(c.period)}`,
      detail:
        c.status === 'partial'
          ? `Balance of ${money(balance)}${num(c.penalty) > 0 ? ` (includes ${money(num(c.penalty))} penalty)` : ''}`
          : c.period === thisPeriod
            ? 'This month’s CMA subscription'
            : `Arrears · due ${fmtDate(c.due_date)}`,
      allocationType: 'monthly_contribution',
      referenceId: Number(c.id),
      period: c.period,
      amount: balance,
    });
  }

  const arrearsTotal = round2(unpaid.filter((c) => c.period !== thisPeriod).reduce((a, c) => a + num(c.amount_due) - num(c.amount_paid) + num(c.penalty), 0));
  if (arrearsTotal > 0 && unpaid.length > 1) {
    obligations.push({
      key: 'mc-arrears',
      label: 'Clear all contribution arrears',
      detail: `${unpaid.filter((c) => c.period !== thisPeriod).length} month(s) outstanding`,
      allocationType: 'monthly_contribution',
      amount: arrearsTotal,
    });
  }

  for (const c of cases) {
    obligations.push({
      key: `${c.type}-${c.id}`,
      label: `${TYPE_LABELS[c.type] || c.type} — ${c.title}`,
      detail: `${c.reference}${c.deadline ? ` · by ${fmtDate(c.deadline)}` : ''}`,
      allocationType: c.type,
      referenceId: c.id,
      amount: num(c.outstanding),
    });
  }

  for (const l of loans) {
    if (num(l.outstanding_balance) <= 0) continue;
    obligations.push({
      key: `loan-${l.id}`,
      label: `Loan repayment — ${l.loan_no}`,
      detail: `Outstanding ${money(l.outstanding_balance)}${l.next_due_date ? ` · next due ${fmtDate(l.next_due_date)}` : ''}${num(l.arrears) > 0 ? ` · arrears ${money(l.arrears)}` : ''}`,
      allocationType: 'loan',
      referenceId: Number(l.id),
      amount: round2(num(l.monthly_repayment) || num(l.outstanding_balance)),
    });
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
    detail: account?.account_no ? `Account ${account.account_no} · balance ${money(num(account.savings_balance))}` : 'Boost your savings and loan limit',
    allocationType: 'savings',
    amount: 500,
    min: 100,
  });

  obligations.push({
    key: 'shares',
    label: 'Buy shares',
    detail: 'Shares are allocated at the configured price per share',
    allocationType: 'shares',
    amount: 1000,
    min: 1000,
  });

  return obligations;
}
