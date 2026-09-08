import 'server-only';
import { one, execute, tx } from '@/lib/db';
import { applyAllocation, type Allocation } from '@/lib/payments';
import { num, round2 } from '@/lib/money';
import { logAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';

/**
 * Allocate (part of) an existing payment's unallocated balance to obligations —
 * used by the treasurer when reconciling M-Pesa paybill collections.
 */
export async function applyAllocationToExistingPayment(opts: {
  paymentId: number;
  allocations: Allocation[];
  actor: { id: number; name: string };
}) {
  const result = await tx(async (client) => {
    const payment = await one<any>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [opts.paymentId], client);
    if (!payment) throw new Error('Payment not found.');

    const member = await one<any>('SELECT * FROM members WHERE id = $1', [payment.member_id], client);
    const total = round2(opts.allocations.reduce((a, x) => a + num(x.amount), 0));
    if (total > num(payment.unallocated_amount) + 0.01) {
      throw new Error(
        `Allocation of KSh ${total.toLocaleString()} exceeds the unallocated balance of KSh ${num(payment.unallocated_amount).toLocaleString()}.`,
      );
    }

    for (const a of opts.allocations) {
      await applyAllocation(client, {
        paymentId: payment.id,
        receiptNo: payment.receipt_no,
        member,
        allocation: { ...a, amount: round2(num(a.amount)) },
        paymentDate: payment.payment_date,
        method: payment.method,
        actor: opts.actor,
      });
      await execute(
        `INSERT INTO payment_allocations (payment_id, member_id, allocation_type, reference_type, reference_id, period, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          payment.id,
          payment.member_id,
          a.type,
          referenceTypeFor(a.type),
          a.referenceId || null,
          a.period || null,
          round2(num(a.amount)),
        ],
        client,
      );
    }

    await execute(
      `UPDATE payments
          SET allocated_amount = allocated_amount + $2,
              unallocated_amount = GREATEST(0, unallocated_amount - $2),
              category = CASE WHEN category IS NULL OR category = 'Unallocated' THEN $3 ELSE category END,
              reconciled = TRUE, reconciled_at = now(), reconciled_by = $4
        WHERE id = $1`,
      [payment.id, total, opts.allocations.map((a) => a.type).join(', '), opts.actor.id],
      client,
    );

    await logAudit({
      userId: opts.actor.id,
      userName: opts.actor.name,
      action: 'payment.allocated',
      entityType: 'payment',
      entityId: payment.id,
      entityLabel: payment.receipt_no,
      description: `Allocated KSh ${total.toLocaleString()} of payment ${payment.receipt_no}`,
      newValues: { allocations: opts.allocations },
      client,
    });

    return { total, memberId: payment.member_id, receiptNo: payment.receipt_no, paymentId: payment.id };
  });

  // Notify outside the transaction — with PGPOOL_MAX=1 the single PGlite connection
  // is held for the whole tx, so any extra query inside would deadlock.
  await notify({
    memberId: result.memberId,
    title: `Payment allocated — ${result.receiptNo}`,
    body: `KSh ${result.total.toLocaleString()} from your payment ${result.receiptNo} has been allocated to: ${opts.allocations
      .map((a) => a.type.replace(/_/g, ' '))
      .join(', ')}.`,
    category: 'payment',
    link: `/receipts/${result.receiptNo}`,
    referenceType: 'payment',
    referenceId: result.paymentId,
  });

  return { total: result.total };
}

function referenceTypeFor(type: string) {
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
