import 'server-only';
import type { PoolClient } from 'pg';
import { one, query, execute, tx } from './db';
import { num, round2 } from './money';
import { isoDate, periodKey, sqlDate, toDate } from './dates';
import { generateReceiptNo } from './crypto';
import { getOrganisation } from './settings';
import { logAudit, diffObjects } from './audit';
import { notify } from './notify';
import {
  applyContributionPayment,
  CASE_TABLES,
  monthlyContributionType,
  refreshCaseTotals,
  type CaseType,
} from './contributions';
import { postSavings, purchaseShares, ensureSaccoAccount } from './sacco';
import { applyLoanRepayment } from './loans';

export type AllocationType =
  | 'monthly_contribution'
  | 'welfare'
  | 'funeral'
  | 'wedding'
  | 'project'
  | 'savings'
  | 'shares'
  | 'loan'
  | 'penalty'
  | 'fee'
  | 'donation'
  | 'other';

export interface Allocation {
  type: AllocationType;
  amount: number;
  referenceId?: number | null;
  period?: string | null;
  shares?: number | null;
  note?: string | null;
}

export interface RecordPaymentInput {
  memberId: number;
  amount: number;
  method: 'mpesa' | 'airtel' | 'bank' | 'cash' | 'cheque' | 'card' | 'manual';
  allocations: Allocation[];
  paymentDate?: Date | string | null;
  reference?: string | null;
  transactionId?: string | null;
  notes?: string | null;
  channel?: 'manual' | 'stk_push' | 'callback' | 'bank_import' | 'bulk';
  actor?: { id: number; name: string } | null;
  ip?: string | null;
  issueReceipt?: boolean;
}

export const ALLOCATION_LABELS: Record<AllocationType, string> = {
  monthly_contribution: 'Monthly CMA contribution',
  welfare: 'Sick member (welfare)',
  funeral: 'Funeral contribution',
  wedding: 'Wedding contribution',
  project: 'Special project',
  savings: 'SDP / Sacco savings',
  shares: 'Share purchase',
  loan: 'Loan repayment',
  penalty: 'Penalty',
  fee: 'Fee',
  donation: 'Donation',
  other: 'Other',
};

/* ------------------------------------------------------------------ *
 * RECORD PAYMENT (the core money-in routine)
 * ------------------------------------------------------------------ */
export async function recordPayment(input: RecordPaymentInput) {
  const amount = round2(num(input.amount));
  if (amount <= 0) throw new Error('Payment amount must be greater than zero.');

  const allocations = (input.allocations || [])
    .map((a) => ({ ...a, amount: round2(num(a.amount)) }))
    .filter((a) => a.amount > 0);
  const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocated > amount + 0.005) {
    throw new Error(`Allocated amount (KSh ${allocated.toLocaleString()}) exceeds the payment (KSh ${amount.toLocaleString()}).`);
  }

  const member = await one<any>(
    `SELECT m.*, p.name AS parish_name FROM members m LEFT JOIN parishes p ON p.id = m.parish_id WHERE m.id = $1`,
    [input.memberId],
  );
  if (!member) throw new Error('Member not found.');

  const org = await getOrganisation();
  const receiptNo = generateReceiptNo(org.short_name?.replace(/\s+/g, '') || 'CMA');
  const paymentDate = toDate(input.paymentDate) || new Date();

  const result = await tx(async (client) => {
    const payment = await one<any>(
      `INSERT INTO payments
         (receipt_no, member_id, parish_id, amount, allocated_amount, unallocated_amount, payment_date, method,
          reference, transaction_id, status, channel, category, notes, recorded_by, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        receiptNo,
        input.memberId,
        member.parish_id,
        amount,
        allocated,
        round2(amount - allocated),
        paymentDate,
        input.method,
        input.reference || null,
        input.transactionId || null,
        input.channel || 'manual',
        allocations.length === 1 ? ALLOCATION_LABELS[allocations[0].type] : 'Mixed payment',
        input.notes || null,
        input.actor?.id || null,
        input.ip || null,
      ],
      client,
    );

    for (const a of allocations) {
      await applyAllocation(client, {
        paymentId: payment.id,
        receiptNo,
        member,
        allocation: a,
        paymentDate,
        method: input.method,
        actor: input.actor,
      });

      await execute(
        `INSERT INTO payment_allocations
           (payment_id, member_id, allocation_type, reference_type, reference_id, period, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          payment.id,
          input.memberId,
          a.type,
          referenceTypeFor(a.type),
          a.referenceId || null,
          a.period || (a.type === 'monthly_contribution' ? periodKey(paymentDate) : null),
          a.amount,
        ],
        client,
      );
    }

    const balance = await memberOutstandingTotal(input.memberId, client);

    let receiptId: number | null = null;
    if (input.issueReceipt !== false) {
      const receipt = await one<{ id: number }>(
        `INSERT INTO receipts
           (receipt_no, payment_id, member_id, organisation, parish_name, category, description, amount,
            balance_after, payment_method, reference, issued_by, issued_to_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (receipt_no) DO UPDATE SET amount = EXCLUDED.amount
         RETURNING id`,
        [
          receiptNo,
          payment.id,
          input.memberId,
          org.name,
          member.parish_name || org.parish,
          allocations.length === 1 ? ALLOCATION_LABELS[allocations[0].type] : 'Mixed payment',
          allocations.map((a) => `${ALLOCATION_LABELS[a.type]}${a.period ? ` (${a.period})` : ''}: KSh ${a.amount.toLocaleString()}`).join('; ') ||
            'General payment',
          amount,
          balance,
          input.method.toUpperCase(),
          input.reference || input.transactionId || null,
          input.actor?.id || null,
          member.full_name,
        ],
        client,
      );
      receiptId = receipt?.id ?? null;
    }

    await logAudit({
      userId: input.actor?.id ?? null,
      userName: input.actor?.name ?? 'system',
      action: 'payment.recorded',
      entityType: 'payment',
      entityId: payment.id,
      entityLabel: receiptNo,
      description: `Received KSh ${amount.toLocaleString()} from ${member.full_name} (${member.membership_no}) via ${input.method}`,
      newValues: { amount, method: input.method, allocations, receipt_no: receiptNo },
      ip: input.ip,
      client,
    });

    return { paymentId: payment.id, receiptNo, receiptId, balanceAfter: balance };
  });

  await notify({
    memberId: input.memberId,
    title: `Payment received — ${result.receiptNo}`,
    body: `KSh ${amount.toLocaleString()} received (${allocations.map((a) => ALLOCATION_LABELS[a.type]).join(', ') || 'general payment'}). Receipt ${result.receiptNo}. Outstanding balance KSh ${num(result.balanceAfter).toLocaleString()}.`,
    category: 'payment',
    link: `/receipts/${result.receiptNo}`,
    channels: ['in_system', 'sms'],
    referenceType: 'payment',
    referenceId: result.paymentId,
  });

  return result;
}

function referenceTypeFor(type: AllocationType): string {
  switch (type) {
    case 'welfare':
      return 'welfare_cases';
    case 'funeral':
      return 'funeral_cases';
    case 'wedding':
      return 'wedding_cases';
    case 'project':
      return 'special_projects';
    case 'loan':
      return 'loans';
    case 'penalty':
      return 'penalties';
    case 'savings':
    case 'shares':
      return 'sacco_accounts';
    default:
      return 'member_contributions';
  }
}

export async function applyAllocation(
  client: PoolClient,
  ctx: {
    paymentId: number;
    receiptNo: string;
    member: any;
    allocation: Allocation;
    paymentDate: Date;
    method: string;
    actor?: { id: number; name: string } | null;
  },
) {
  const { allocation: a, member } = ctx;

  switch (a.type) {
    case 'monthly_contribution': {
      const type = await monthlyContributionType(client);
      const period = a.period || periodKey(ctx.paymentDate);
      await applyContributionPayment({
        memberId: member.id,
        typeId: type!.id,
        period,
        amount: a.amount,
        paymentId: ctx.paymentId,
        date: ctx.paymentDate,
        client,
      });
      break;
    }

    case 'welfare':
    case 'funeral':
    case 'wedding': {
      if (!a.referenceId) throw new Error(`Select the ${a.type} case for this payment.`);
      const table = CASE_TABLES[a.type as CaseType];
      const theCase = await one<any>(`SELECT * FROM ${table.cases} WHERE id = $1`, [a.referenceId], client);
      if (!theCase) throw new Error(`${a.type} case not found.`);
      const caseField = `${a.type}_case_id`;
      await execute(
        `INSERT INTO ${table.payments} (${caseField}, member_id, payment_id, amount, paid_at, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [a.referenceId, member.id, ctx.paymentId, a.amount, ctx.paymentDate, ctx.actor?.id || null],
        client,
      );
      await refreshCaseTotals(a.type as CaseType, a.referenceId, client);
      break;
    }

    case 'project': {
      if (!a.referenceId) throw new Error('Select the project for this payment.');
      await execute(
        `INSERT INTO project_contributions (project_id, member_id, payment_id, amount_paid, status, paid_at, recorded_by)
         VALUES ($1,$2,$3,$4,'paid',$5,$6)
         ON CONFLICT (project_id, member_id) DO UPDATE
           SET amount_paid = project_contributions.amount_paid + EXCLUDED.amount_paid,
               status = 'paid', paid_at = EXCLUDED.paid_at, payment_id = EXCLUDED.payment_id`,
        [a.referenceId, member.id, ctx.paymentId, a.amount, ctx.paymentDate, ctx.actor?.id || null],
        client,
      );
      await refreshCaseTotals('project', a.referenceId, client);
      break;
    }

    case 'savings': {
      await postSavings({
        memberId: member.id,
        amount: a.amount,
        type: 'deposit',
        paymentId: ctx.paymentId,
        receiptNo: ctx.receiptNo,
        method: ctx.method,
        date: ctx.paymentDate,
        period: periodKey(ctx.paymentDate),
        notes: a.note || 'Savings deposit',
        recordedBy: ctx.actor?.id || null,
        client,
      });
      break;
    }

    case 'shares': {
      await purchaseShares({
        memberId: member.id,
        amount: a.amount,
        shares: a.shares || undefined,
        paymentId: ctx.paymentId,
        date: ctx.paymentDate,
        notes: a.note || 'Share purchase',
        recordedBy: ctx.actor?.id || null,
        client,
      });
      break;
    }

    case 'loan': {
      let loanId = a.referenceId;
      if (!loanId) {
        const active = await one<any>(
          `SELECT id FROM loans WHERE member_id = $1 AND status IN ('active','defaulted','restructured')
            ORDER BY next_due_date ASC NULLS LAST LIMIT 1`,
          [member.id],
          client,
        );
        if (!active) throw new Error('This member has no active loan to repay.');
        loanId = active.id;
      }
      await applyLoanRepayment({
        loanId,
        amount: a.amount,
        paymentId: ctx.paymentId,
        receiptNo: ctx.receiptNo,
        date: ctx.paymentDate,
        method: ctx.method,
        notes: a.note || 'Loan repayment',
        actor: ctx.actor,
        client,
      });
      break;
    }

    case 'penalty': {
      const rows = await query<any>(
        `SELECT * FROM penalties WHERE member_id = $1 AND status = 'pending' AND amount > amount_paid ORDER BY created_at ASC`,
        [member.id],
        client,
      );
      let remaining = a.amount;
      for (const p of rows) {
        if (remaining <= 0) break;
        const due = round2(num(p.amount) - num(p.amount_paid));
        const pay = Math.min(due, remaining);
        await execute(
          `UPDATE penalties SET amount_paid = amount_paid + $2, payment_id = COALESCE($3, payment_id),
                  status = CASE WHEN amount_paid + $2 >= amount THEN 'paid' ELSE status END WHERE id = $1`,
          [p.id, pay, ctx.paymentId],
          client,
        );
        remaining = round2(remaining - pay);
      }
      break;
    }

    default: {
      // fee / donation / other — nothing to reconcile beyond the allocation row
      break;
    }
  }
}

/* ------------------------------------------------------------------ *
 * REVERSAL — financial transactions are never deleted
 * ------------------------------------------------------------------ */
export async function reversePayment(opts: {
  paymentId: number;
  reason: string;
  actor: { id: number; name: string };
}) {
  const payment = await one<any>('SELECT * FROM payments WHERE id = $1', [opts.paymentId]);
  if (!payment) throw new Error('Payment not found.');
  if (payment.status === 'reversed') throw new Error('This payment has already been reversed.');

  const allocations = await query<any>('SELECT * FROM payment_allocations WHERE payment_id = $1', [opts.paymentId]);
  const org = await getOrganisation();

  const result = await tx(async (client) => {
    const reversalReceipt = generateReceiptNo(org.short_name?.replace(/\s+/g, '') || 'CMA');

    for (const a of allocations) {
      await reverseAllocation(client, a, payment);
    }

    const reversal = await one<any>(
      `INSERT INTO payments
         (receipt_no, member_id, parish_id, amount, allocated_amount, unallocated_amount, payment_date, method,
          reference, status, channel, category, notes, recorded_by, original_payment_id)
       VALUES ($1,$2,$3,$4,$5,$6, now(),'reversal',$7,'reversed','manual','Reversal',$8,$9,$10)
       RETURNING *`,
      [
        reversalReceipt,
        payment.member_id,
        payment.parish_id,
        round2(-num(payment.amount)),
        round2(-num(payment.allocated_amount)),
        round2(-num(payment.unallocated_amount)),
        payment.reference,
        `Reversal of ${payment.receipt_no}: ${opts.reason}`,
        opts.actor.id,
        payment.id,
      ],
      client,
    );

    await execute(
      `UPDATE payments SET status = 'reversed', reversed_by = $2, reversed_at = now(), reversal_reason = $3 WHERE id = $1`,
      [opts.paymentId, opts.actor.id, opts.reason],
      client,
    );
    await execute(`UPDATE receipts SET status = 'reversed', voided_at = now() WHERE payment_id = $1`, [opts.paymentId], client);

    await execute(
      `INSERT INTO receipts (receipt_no, payment_id, member_id, organisation, parish_name, category, description,
                             amount, payment_method, reference, issued_by, issued_to_name, status)
       VALUES ($1,$2,$3,$4,$5,'Reversal',$6,$7,'REVERSAL',$8,$9,$10,'valid')`,
      [
        reversalReceipt,
        reversal.id,
        payment.member_id,
        org.name,
        org.parish,
        `Credit note reversing receipt ${payment.receipt_no}`,
        round2(-num(payment.amount)),
        payment.receipt_no,
        opts.actor.id,
        payment.issued_to_name || null,
      ],
      client,
    );

    await logAudit({
      userId: opts.actor.id,
      userName: opts.actor.name,
      action: 'payment.reversed',
      entityType: 'payment',
      entityId: payment.id,
      entityLabel: payment.receipt_no,
      description: `Reversed payment ${payment.receipt_no} (KSh ${num(payment.amount).toLocaleString()}) — ${opts.reason}`,
      oldValues: { status: payment.status },
      newValues: { status: 'reversed', reason: opts.reason, reversal_receipt: reversalReceipt },
      severity: 'critical',
      client,
    });

    return { reversalId: reversal.id, reversalReceipt };
  });

  await notify({
    memberId: payment.member_id,
    title: `Payment reversed — ${payment.receipt_no}`,
    body: `Your payment of KSh ${num(payment.amount).toLocaleString()} (receipt ${payment.receipt_no}) has been reversed. Reason: ${opts.reason}. Credit note ${result.reversalReceipt}.`,
    category: 'payment',
    priority: 'high',
    channels: ['in_system', 'sms'],
    referenceType: 'payment',
    referenceId: payment.id,
  });

  return result;
}

async function reverseAllocation(client: PoolClient, allocation: any, payment: any) {
  const amount = -num(allocation.amount);
  switch (allocation.allocation_type) {
    case 'monthly_contribution': {
      const type = await monthlyContributionType(client);
      const row = await one<any>(
        `SELECT * FROM member_contributions WHERE member_id = $1 AND contribution_type_id = $2 AND period = $3`,
        [payment.member_id, type!.id, allocation.period],
        client,
      );
      if (row) {
        await execute(`UPDATE member_contributions SET amount_paid = GREATEST(0, amount_paid - $2) WHERE id = $1`, [
          row.id,
          num(allocation.amount),
        ], client);
        const updated = await one<any>('SELECT * FROM member_contributions WHERE id = $1', [row.id], client);
        const status =
          num(updated.amount_paid) >= num(updated.amount_due) - 0.005
            ? 'paid'
            : num(updated.amount_paid) > 0
              ? 'partial'
              : toDate(updated.due_date)! < new Date()
                ? 'overdue'
                : 'unpaid';
        await execute(`UPDATE member_contributions SET status = $2 WHERE id = $1`, [row.id, updated.exempted ? 'exempted' : status], client);
      }
      break;
    }
    case 'welfare':
    case 'funeral':
    case 'wedding': {
      const table = CASE_TABLES[allocation.allocation_type as CaseType];
      const caseField = `${allocation.allocation_type}_case_id`;
      await execute(
        `DELETE FROM ${table.payments} WHERE payment_id = $1 AND ${caseField} = $2`,
        [payment.id, allocation.reference_id],
        client,
      );
      await refreshCaseTotals(allocation.allocation_type as CaseType, allocation.reference_id, client);
      break;
    }
    case 'project': {
      await execute(
        `UPDATE project_contributions SET amount_paid = GREATEST(0, amount_paid - $3), status = 'pending'
          WHERE project_id = $2 AND member_id = $1`,
        [payment.member_id, allocation.reference_id, num(allocation.amount)],
        client,
      );
      await refreshCaseTotals('project', allocation.reference_id, client);
      break;
    }
    case 'savings': {
      await postSavings({
        memberId: payment.member_id,
        amount,
        type: 'adjustment',
        paymentId: payment.id,
        notes: `Reversal of savings deposit (receipt ${payment.receipt_no})`,
        client,
      });
      break;
    }
    case 'shares': {
      // Shares are cancelled rather than deleted so the certificate trail stays intact.
      const shares = await query<any>(
        `SELECT * FROM share_transactions WHERE payment_id = $1 AND transaction_type = 'purchase'`,
        [payment.id],
        client,
      );
      for (const s of shares) {
        await execute(`UPDATE shares SET status = 'cancelled', notes = COALESCE(notes,'') || ' | Reversed' WHERE id = $1`, [
          s.share_id,
        ], client);
        await execute(
          `UPDATE sacco_accounts SET shares_count = GREATEST(0, shares_count - $2), share_capital = GREATEST(0, share_capital - $3)
            WHERE member_id = $1`,
          [payment.member_id, s.shares_count, num(s.amount)],
          client,
        );
      }
      break;
    }
    case 'loan': {
      // Reverse a repayment by re-opening the schedule and restoring balances.
      const repayment = await one<any>(
        `SELECT * FROM loan_repayments WHERE payment_id = $1 ORDER BY id DESC LIMIT 1`,
        [payment.id],
        client,
      );
      if (repayment) {
        await execute(
          `UPDATE loans
              SET amount_paid = GREATEST(0, amount_paid - $2),
                  principal_paid = GREATEST(0, principal_paid - $3),
                  interest_paid = GREATEST(0, interest_paid - $4),
                  penalties_paid = GREATEST(0, penalties_paid - $5),
                  outstanding_principal = outstanding_principal + $3,
                  outstanding_balance = outstanding_balance + $3 + $4,
                  status = CASE WHEN status = 'completed' THEN 'active' ELSE status END,
                  completed_at = NULL
            WHERE id = $1`,
          [
            repayment.loan_id,
            num(repayment.amount),
            num(repayment.principal_portion),
            num(repayment.interest_portion),
            num(repayment.penalty_portion),
          ],
          client,
        );
        await execute(
          `UPDATE loan_schedules
              SET amount_paid = GREATEST(0, amount_paid - $2),
                  status = CASE WHEN GREATEST(0, amount_paid - $2) = 0 THEN 'pending' ELSE 'partial' END,
                  paid_at = NULL
            WHERE loan_id = $1 AND status IN ('paid','partial')
              AND installment_no IN (
                SELECT installment_no FROM loan_schedules WHERE loan_id = $1 AND status IN ('paid','partial')
                ORDER BY installment_no DESC LIMIT 3)`,
          [repayment.loan_id, num(repayment.amount)],
          client,
        );
        await execute(`DELETE FROM loan_repayments WHERE id = $1`, [repayment.id], client);
        await execute(
          `UPDATE sacco_accounts SET loan_outstanding = loan_outstanding + $2 WHERE member_id = $1`,
          [payment.member_id, num(repayment.amount)],
          client,
        );
      }
      break;
    }
    case 'penalty': {
      await execute(
        `UPDATE penalties SET amount_paid = GREATEST(0, amount_paid - $2),
                status = CASE WHEN GREATEST(0, amount_paid - $2) < amount THEN 'pending' ELSE status END
          WHERE member_id = $1 AND payment_id = $3`,
        [payment.member_id, num(allocation.amount), payment.id],
        client,
      );
      break;
    }
  }
}

/* ------------------------------------------------------------------ *
 * BALANCES, STATEMENTS AND DASHBOARD DATA
 * ------------------------------------------------------------------ */
export async function memberOutstandingTotal(memberId: number, client?: PoolClient): Promise<number> {
  const b = await memberBalances(memberId, client);
  return b.total_outstanding;
}

export async function memberBalances(memberId: number, client?: PoolClient) {
  const monthly = await one<any>(
    `SELECT COALESCE(SUM(amount_due - amount_paid),0) AS outstanding,
            COALESCE(count(*) FILTER (WHERE status IN ('unpaid','partial','overdue')),0)::int AS periods,
            COALESCE(count(*) FILTER (WHERE status = 'overdue'),0)::int AS overdue_periods,
            COALESCE(SUM(penalty) FILTER (WHERE status <> 'paid'),0) AS penalties
       FROM member_contributions
      WHERE member_id = $1 AND exempted = FALSE AND amount_paid < amount_due`,
    [memberId],
    client,
  );

  const monthlyTotal = await one<any>(
    `SELECT COALESCE(SUM(amount_paid),0) AS paid, COALESCE(SUM(amount_due),0) AS due
       FROM member_contributions WHERE member_id = $1`,
    [memberId],
    client,
  );

  const welfare = await one<{ paid: number; owed: number }>(
    `SELECT COALESCE(SUM(p.amount),0) AS paid,
            COALESCE((SELECT SUM(c.amount_per_member) FROM welfare_cases c
                       WHERE c.status IN ('open','closed','disbursed') AND c.member_id <> $1
                         AND c.parish_id = (SELECT parish_id FROM members WHERE id = $1)),0) AS owed
       FROM welfare_payments p WHERE p.member_id = $1`,
    [memberId],
    client,
  );

  const funeral = await one<{ paid: number }>(
    `SELECT COALESCE(SUM(amount),0) AS paid FROM funeral_payments WHERE member_id = $1`,
    [memberId],
    client,
  );
  const wedding = await one<{ paid: number }>(
    `SELECT COALESCE(SUM(amount),0) AS paid FROM wedding_payments WHERE member_id = $1`,
    [memberId],
    client,
  );
  const project = await one<{ paid: number }>(
    `SELECT COALESCE(SUM(amount_paid),0) AS paid FROM project_contributions WHERE member_id = $1`,
    [memberId],
    client,
  );

  const account = await one<any>('SELECT * FROM sacco_accounts WHERE member_id = $1', [memberId], client);
  const shares = await one<any>(
    `SELECT COALESCE(SUM(shares_count),0)::int AS shares_count, COALESCE(SUM(total_value),0) AS total_value
       FROM shares WHERE member_id = $1 AND status = 'active'`,
    [memberId],
    client,
  );

  const loans = await one<any>(
    `SELECT COALESCE(SUM(outstanding_balance),0) AS outstanding,
            COALESCE(SUM(principal),0) AS borrowed,
            COALESCE(SUM(amount_paid),0) AS repaid,
            COALESCE(SUM(arrears),0) AS arrears,
            count(*)::int AS active_loans
       FROM loans WHERE member_id = $1 AND status IN ('active','defaulted','restructured')`,
    [memberId],
    client,
  );

  const penalties = await one<{ outstanding: number }>(
    `SELECT COALESCE(SUM(amount - amount_paid),0) AS outstanding FROM penalties
      WHERE member_id = $1 AND status = 'pending'`,
    [memberId],
    client,
  );

  const guaranteed = await one<{ amount: number; count: number }>(
    `SELECT COALESCE(SUM(g.amount_guaranteed),0) AS amount, count(*)::int AS count
       FROM loan_guarantors g JOIN loan_applications a ON a.id = g.loan_application_id
      WHERE g.guarantor_member_id = $1 AND g.status IN ('pending','accepted')
        AND a.status NOT IN ('rejected','cancelled','withdrawn','completed')`,
    [memberId],
    client,
  );

  const totalOutstanding = round2(
    num(monthly?.outstanding) + num(penalties?.outstanding) + num(loans?.outstanding),
  );

  return {
    monthly_outstanding: round2(num(monthly?.outstanding)),
    monthly_paid: round2(num(monthlyTotal?.paid)),
    monthly_due_total: round2(num(monthlyTotal?.due)),
    unpaid_periods: Number(monthly?.periods ?? 0),
    overdue_periods: Number(monthly?.overdue_periods ?? 0),
    contribution_penalties: round2(num(monthly?.penalties)),
    welfare_paid: round2(num(welfare?.paid)),
    welfare_expected: round2(num(welfare?.owed)),
    funeral_paid: round2(num(funeral?.paid)),
    wedding_paid: round2(num(wedding?.paid)),
    project_paid: round2(num(project?.paid)),
    savings_balance: round2(num(account?.savings_balance)),
    total_deposits: round2(num(account?.total_deposits)),
    shares_count: Number(shares?.shares_count ?? 0),
    shares_value: round2(num(shares?.total_value)),
    account_no: account?.account_no || null,
    loan_outstanding: round2(num(loans?.outstanding)),
    loan_borrowed: round2(num(loans?.borrowed)),
    loan_repaid: round2(num(loans?.repaid)),
    loan_arrears: round2(num(loans?.arrears)),
    active_loans: Number(loans?.active_loans ?? 0),
    penalties_outstanding: round2(num(penalties?.outstanding)),
    guaranteed_amount: round2(num(guaranteed?.amount)),
    guarantees_active: Number(guaranteed?.count ?? 0),
    total_outstanding: totalOutstanding,
  };
}

export interface StatementSection {
  key: string;
  title: string;
  rows: { date: string; description: string; reference: string; debit: number; credit: number; balance: number }[];
  total_credit: number;
  total_debit: number;
}

/** Consolidated member statement across every module. */
export async function memberStatement(memberId: number, from?: string | Date | null, to?: string | Date | null) {
  const member = await one<any>(
    `SELECT m.*, p.name AS parish_name, c.name AS church_name, s.name AS scc_name
       FROM members m
       LEFT JOIN parishes p ON p.id = m.parish_id
       LEFT JOIN churches c ON c.id = m.church_id
       LEFT JOIN small_christian_communities s ON s.id = m.scc_id
      WHERE m.id = $1`,
    [memberId],
  );
  if (!member) throw new Error('Member not found.');

  const rangeFrom = toDate(from);
  const rangeTo = toDate(to);

  /** Fresh range clause + params per query (avoids parameter-index collisions). */
  const rangeFor = (column: string) => {
    const params: any[] = [];
    let sql = '';
    if (rangeFrom) {
      params.push(sqlDate(rangeFrom));
      sql += ` AND ${column} >= $${params.length + 1}::date`;
    }
    if (rangeTo) {
      params.push(sqlDate(rangeTo));
      sql += ` AND ${column} < ($${params.length + 1}::date + interval '1 day')`;
    }
    return { sql, params };
  };

  const rMonthly = rangeFor('mc.due_date');
  const monthly = await query<any>(
    `SELECT mc.period, mc.period_label, mc.amount_due, mc.amount_paid, mc.penalty, mc.status, mc.due_date,
            ct.name AS type_name
       FROM member_contributions mc JOIN contribution_types ct ON ct.id = mc.contribution_type_id
      WHERE mc.member_id = $1 AND ct.category = 'monthly'${rMonthly.sql}
      ORDER BY mc.period DESC`,
    [memberId, ...rMonthly.params],
  );

  const rWelfare = rangeFor('p.paid_at');
  const welfare = await query<any>(
    `SELECT p.paid_at, p.amount, c.case_no, c.category, m.full_name AS beneficiary
       FROM welfare_payments p JOIN welfare_cases c ON c.id = p.welfare_case_id
       JOIN members m ON m.id = c.member_id
      WHERE p.member_id = $1${rWelfare.sql} ORDER BY p.paid_at DESC`,
    [memberId, ...rWelfare.params],
  );

  const rFuneral = rangeFor('p.paid_at');
  const funerals = await query<any>(
    `SELECT p.paid_at, p.amount, c.case_no, c.deceased_name, c.relationship
       FROM funeral_payments p JOIN funeral_cases c ON c.id = p.funeral_case_id
      WHERE p.member_id = $1${rFuneral.sql} ORDER BY p.paid_at DESC`,
    [memberId, ...rFuneral.params],
  );

  const rWedding = rangeFor('p.paid_at');
  const weddings = await query<any>(
    `SELECT p.paid_at, p.amount, c.case_no, c.wedding_date, m.full_name AS member_name
       FROM wedding_payments p JOIN wedding_cases c ON c.id = p.wedding_case_id
       JOIN members m ON m.id = c.member_id
      WHERE p.member_id = $1${rWedding.sql} ORDER BY p.paid_at DESC`,
    [memberId, ...rWedding.params],
  );

  const rProject = rangeFor('pc.paid_at');
  const projects = await query<any>(
    `SELECT pc.paid_at, pc.amount_paid AS amount, sp.project_no, sp.name, sp.category
       FROM project_contributions pc JOIN special_projects sp ON sp.id = pc.project_id
      WHERE pc.member_id = $1 AND pc.amount_paid > 0${rProject.sql} ORDER BY pc.paid_at DESC`,
    [memberId, ...rProject.params],
  );

  const rSavings = rangeFor('s.transaction_date');
  const savings = await query<any>(
    `SELECT s.transaction_date, s.transaction_type, s.amount, s.running_balance, s.receipt_no, s.reference, s.notes
       FROM savings s WHERE s.member_id = $1 AND s.reversed = FALSE${rSavings.sql}
      ORDER BY s.transaction_date DESC`,
    [memberId, ...rSavings.params],
  );

  const rShares = rangeFor('st.transaction_date');
  const shareTx = await query<any>(
    `SELECT st.transaction_date, st.transaction_type, st.shares_count, st.value_per_share, st.amount, st.certificate_no, st.notes
       FROM share_transactions st WHERE st.member_id = $1${rShares.sql}
      ORDER BY st.transaction_date DESC`,
    [memberId, ...rShares.params],
  );

  const loans = await query<any>(
    `SELECT l.loan_no, l.principal, l.total_interest, l.total_repayable, l.amount_paid, l.outstanding_balance,
            l.status, l.disbursed_at, l.maturity_date, l.next_due_date, l.monthly_repayment, l.arrears, l.term_months,
            l.interest_rate, lt.name AS loan_type
       FROM loans l JOIN loan_types lt ON lt.id = l.loan_type_id
      WHERE l.member_id = $1 ORDER BY l.disbursed_at DESC`,
    [memberId],
  );

  const rRepay = rangeFor('lr.repayment_date');
  const repayments = await query<any>(
    `SELECT lr.repayment_date, lr.amount, lr.principal_portion, lr.interest_portion, lr.penalty_portion,
            lr.balance_after, lr.receipt_no, l.loan_no
       FROM loan_repayments lr JOIN loans l ON l.id = lr.loan_id
      WHERE lr.member_id = $1${rRepay.sql} ORDER BY lr.repayment_date DESC`,
    [memberId, ...rRepay.params],
  );

  const rPayments = rangeFor('p.payment_date');
  const payments = await query<any>(
    `SELECT p.id, p.receipt_no, p.payment_date, p.amount, p.method, p.reference, p.status, p.category
       FROM payments p WHERE p.member_id = $1${rPayments.sql} ORDER BY p.payment_date DESC LIMIT 500`,
    [memberId, ...rPayments.params],
  );

  const penalties = await query<any>(
    `SELECT pen.period, pen.amount, pen.amount_paid, pen.status, pen.reason, pen.created_at
       FROM penalties pen WHERE pen.member_id = $1 ORDER BY pen.created_at DESC`,
    [memberId],
  );

  const balances = await memberBalances(memberId);

  const sections: StatementSection[] = [
    {
      key: 'monthly',
      title: 'MONTHLY CMA CONTRIBUTIONS',
      total_credit: round2(monthly.reduce((a, r) => a + num(r.amount_paid), 0)),
      total_debit: round2(monthly.reduce((a, r) => a + num(r.amount_due), 0)),
      rows: monthly.map((r) => ({
        date: isoDate(`${r.period}-01`),
        description: `${r.period_label} monthly contribution`,
        reference: r.status.toUpperCase(),
        debit: round2(num(r.amount_due) - num(r.amount_paid)),
        credit: num(r.amount_paid),
        balance: 0,
      })),
    },
    {
      key: 'welfare',
      title: 'SICK MEMBER (WELFARE) CONTRIBUTIONS',
      total_credit: round2(welfare.reduce((a, r) => a + num(r.amount), 0)),
      total_debit: 0,
      rows: welfare.map((r) => ({
        date: isoDate(r.paid_at),
        description: `Welfare ${r.case_no} — ${r.beneficiary} (${r.category})`,
        reference: r.case_no,
        debit: 0,
        credit: num(r.amount),
        balance: 0,
      })),
    },
    {
      key: 'funeral',
      title: 'FUNERAL CONTRIBUTIONS',
      total_credit: round2(funerals.reduce((a, r) => a + num(r.amount), 0)),
      total_debit: 0,
      rows: funerals.map((r) => ({
        date: isoDate(r.paid_at),
        description: `Funeral ${r.case_no} — ${r.deceased_name} (${r.relationship})`,
        reference: r.case_no,
        debit: 0,
        credit: num(r.amount),
        balance: 0,
      })),
    },
    {
      key: 'wedding',
      title: 'WEDDING CONTRIBUTIONS',
      total_credit: round2(weddings.reduce((a, r) => a + num(r.amount), 0)),
      total_debit: 0,
      rows: weddings.map((r) => ({
        date: isoDate(r.paid_at),
        description: `Wedding ${r.case_no} — ${r.member_name}`,
        reference: r.case_no,
        debit: 0,
        credit: num(r.amount),
        balance: 0,
      })),
    },
    {
      key: 'projects',
      title: 'SPECIAL PROJECT CONTRIBUTIONS',
      total_credit: round2(projects.reduce((a, r) => a + num(r.amount), 0)),
      total_debit: 0,
      rows: projects.map((r) => ({
        date: isoDate(r.paid_at),
        description: `${r.name} (${r.category})`,
        reference: r.project_no,
        debit: 0,
        credit: num(r.amount),
        balance: 0,
      })),
    },
    {
      key: 'savings',
      title: 'SDP / SACCO SAVINGS',
      total_credit: round2(savings.filter((s) => ['deposit', 'interest', 'dividend'].includes(s.transaction_type)).reduce((a, r) => a + num(r.amount), 0)),
      total_debit: round2(savings.filter((s) => ['withdrawal'].includes(s.transaction_type)).reduce((a, r) => a + num(r.amount), 0)),
      rows: savings.map((r) => ({
        date: isoDate(r.transaction_date),
        description: `${r.transaction_type.replace('_', ' ')}${r.notes ? ` — ${r.notes}` : ''}`,
        reference: r.receipt_no || r.reference || '',
        debit: r.transaction_type === 'withdrawal' ? num(r.amount) : 0,
        credit: r.transaction_type === 'withdrawal' ? 0 : num(r.amount),
        balance: num(r.running_balance),
      })),
    },
    {
      key: 'shares',
      title: 'SHARES',
      total_credit: round2(shareTx.reduce((a, r) => a + num(r.amount), 0)),
      total_debit: 0,
      rows: shareTx.map((r) => ({
        date: isoDate(r.transaction_date),
        description: `${r.transaction_type.replace('_', ' ')} — ${r.shares_count} share(s) @ KSh ${num(r.value_per_share).toLocaleString()}`,
        reference: r.certificate_no || '',
        debit: r.transaction_type === 'transfer_out' ? num(r.amount) : 0,
        credit: r.transaction_type === 'transfer_out' ? 0 : num(r.amount),
        balance: 0,
      })),
    },
    {
      key: 'loans',
      title: 'LOANS',
      total_credit: round2(loans.reduce((a, r) => a + num(r.principal), 0)),
      total_debit: 0,
      rows: loans.map((r) => ({
        date: isoDate(r.disbursed_at),
        description: `${r.loan_type} ${r.loan_no} — ${r.term_months || '—'} months @ ${num(r.interest_rate)}%`,
        reference: r.loan_no,
        debit: 0,
        credit: num(r.principal),
        balance: num(r.outstanding_balance),
      })),
    },
    {
      key: 'loan_repayments',
      title: 'LOAN REPAYMENTS',
      total_credit: round2(repayments.reduce((a, r) => a + num(r.amount), 0)),
      total_debit: 0,
      rows: repayments.map((r) => ({
        date: isoDate(r.repayment_date),
        description: `Repayment ${r.loan_no} (principal KSh ${num(r.principal_portion).toLocaleString()}, interest KSh ${num(r.interest_portion).toLocaleString()})`,
        reference: r.receipt_no || '',
        debit: num(r.amount),
        credit: 0,
        balance: num(r.balance_after),
      })),
    },
  ];

  return {
    member,
    range: { from: rangeFrom ? isoDate(rangeFrom) : null, to: rangeTo ? isoDate(rangeTo) : null },
    balances,
    sections,
    monthly,
    welfare,
    funerals,
    weddings,
    projects,
    savings,
    shareTx,
    loans,
    repayments,
    payments,
    penalties,
    generated_at: new Date(),
  };
}

/* ------------------------------------------------------------------ *
 * PAYMENT LISTING / SEARCH
 * ------------------------------------------------------------------ */
export async function listPayments(filters: {
  memberId?: number | null;
  status?: string;
  method?: string;
  from?: string | Date | null;
  to?: string | Date | null;
  search?: string;
  parishId?: number | null;
  limit?: number;
  offset?: number;
} = {}) {
  const clauses: string[] = ['1=1'];
  const params: any[] = [];
  const add = (sql: string, value: any) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };

  if (filters.memberId) add('p.member_id = ?', filters.memberId);
  if (filters.status) add('p.status = ?', filters.status);
  if (filters.method) add('p.method = ?', filters.method);
  if (filters.parishId) add('p.parish_id = ?', filters.parishId);
  if (filters.from) add('p.payment_date >= ?', `${sqlDate(filters.from)} 00:00:00`);
  if (filters.to) add('p.payment_date <= ?', `${sqlDate(filters.to)} 23:59:59`);
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(
      `(p.receipt_no ILIKE $${params.length} OR p.reference ILIKE $${params.length} OR p.transaction_id ILIKE $${params.length} OR m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length})`,
    );
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const rows = await query<any>(
    `SELECT p.*, m.full_name, m.membership_no, m.phone, m.photo_url
       FROM payments p JOIN members m ON m.id = p.member_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM payments p JOIN members m ON m.id = p.member_id WHERE ${clauses.join(' AND ')}`,
    params,
  );
  const sums = await one<any>(
    `SELECT COALESCE(SUM(p.amount),0) AS total, COALESCE(count(*),0)::int AS count
       FROM payments p JOIN members m ON m.id = p.member_id WHERE ${clauses.join(' AND ')} AND p.status = 'completed'`,
    params,
  );

  return { rows, total: Number(total?.c ?? 0), sum: num(sums?.total), count: Number(sums?.count ?? 0) };
}

export async function paymentAllocations(paymentId: number) {
  return query<any>(
    `SELECT pa.*, m.full_name, m.membership_no
       FROM payment_allocations pa JOIN members m ON m.id = pa.member_id
      WHERE pa.payment_id = $1 ORDER BY pa.id`,
    [paymentId],
  );
}
