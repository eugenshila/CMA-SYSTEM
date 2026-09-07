import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Banknote, ReceiptText, RotateCcw, CheckCheck, FileText, ShieldCheck, History } from 'lucide-react';
import { Badge, Card, CardHeader, KeyValue, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { paymentAllocations, ALLOCATION_LABELS } from '@/lib/payments';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { ReversePaymentButton, ReconcileButton } from '../forms/payment-forms';

export default async function PaymentDetailPage({ id, user }: { id: number; user: SessionUser }) {
  if (!can(user, 'payments.view')) redirect('/dashboard');

  const [payment, allocations, receipt, audit] = await Promise.all([
    one<any>(
      `SELECT p.*, m.full_name, m.membership_no, m.phone, m.email,
              pa.name AS parish_name, u.name AS recorded_by_name, r.name AS reversed_by_name
         FROM payments p
         JOIN members m ON m.id = p.member_id
         LEFT JOIN parishes pa ON pa.id = p.parish_id
         LEFT JOIN users u ON u.id = p.recorded_by
         LEFT JOIN users r ON r.id = p.reversed_by
        WHERE p.id = $1`,
      [id],
    ),
    paymentAllocations(id),
    one<any>('SELECT * FROM receipts WHERE payment_id = $1 ORDER BY id DESC LIMIT 1', [id]),
    query<any>(
      `SELECT a.action, a.description, a.user_name, a.severity, a.created_at, a.ip_address
         FROM audit_logs a WHERE a.entity_type = 'payments' AND a.entity_id = $1 ORDER BY a.created_at`,
      [id],
    ),
  ]);

  if (!payment) notFound();

  const allocated = num(payment.allocated_amount);
  const unallocated = num(payment.unallocated_amount);
  const canUpdate = can(user, 'payments.update');

  return (
    <div className="space-y-5">
      <SectionHeading
        title={`Payment ${payment.receipt_no}`}
        subtitle={`${payment.full_name} · ${payment.membership_no} · ${fmtDateTime(payment.payment_date)}`}
        action={
          <>
            <Link href="/payments" className="btn btn-outline btn-sm">Back to payments</Link>
            <Link href={`/api/documents/receipt?receipt=${encodeURIComponent(payment.receipt_no)}`} className="btn btn-primary btn-sm" target="_blank">
              <ReceiptText className="h-4 w-4" /> Receipt PDF
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Amount received" value={money(num(payment.amount))} tone="green" icon={<Banknote className="h-4 w-4" />} sub={String(payment.method).toUpperCase()} />
        <StatCard label="Allocated" value={money(allocated)} tone="navy" sub={`${allocations.length} line(s)`} />
        <StatCard label="Unallocated" value={money(unallocated)} tone={unallocated > 0 ? 'gold' : 'slate'} sub={unallocated > 0 ? 'Assign it to a member obligation' : 'Fully allocated'} />
        <StatCard
          label="Balance after payment"
          value={money(num(payment.balance_after))}
          tone="slate"
          sub={payment.status === 'reversed' ? 'Reversed' : payment.reconciled ? `Reconciled ${fmtDate(payment.reconciled_at)}` : 'Awaiting reconciliation'}
        />
      </div>

      {payment.status === 'reversed' ? (
        <Card className="border-red-200 bg-red-50/60">
          <CardHeader
            title="This payment has been reversed"
            subtitle={`${money(num(payment.amount))} reversed on ${fmtDateTime(payment.reversed_at)} by ${payment.reversed_by_name || 'an authorised officer'}.`}
            icon={<RotateCcw className="h-4 w-4 text-red-600" />}
          />
          <p className="text-sm text-red-700">Reason: {payment.reversal_reason || 'Not recorded'}</p>
          {payment.original_payment_id ? (
            <p className="mt-2 text-xs text-red-600">
              Correcting entry for payment{' '}
              <Link className="underline" href={`/payments/${payment.original_payment_id}`}>#{payment.original_payment_id}</Link>
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-4">
            <CardHeader
              title="How the money was allocated"
              subtitle="Each line updates the member's contribution, savings, shares, loan or case record."
            />
          </div>
          {allocations.length === 0 ? (
            <div className="p-4 pt-0">
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                This payment has not been allocated yet.
              </p>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Destination</Th>
                  <Th>Reference</Th>
                  <Th>Period</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a: any) => (
                  <tr key={a.id}>
                    <Td className="font-medium text-navy-900">{ALLOCATION_LABELS[a.allocation_type as keyof typeof ALLOCATION_LABELS] || a.allocation_type}</Td>
                    <Td className="text-xs text-slate-600">
                      {a.reference_type ? `${a.reference_type.replace(/_/g, ' ')}` : '—'}
                      {a.reference_id ? <span className="text-slate-400"> #{a.reference_id}</span> : null}
                    </Td>
                    <Td className="text-xs text-slate-600">{a.period || '—'}</Td>
                    <Td align="right" className="font-semibold">{money(num(a.amount))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
            <p className="text-xs text-slate-500">
              Total allocated <strong className="text-navy-900">{money(allocated)}</strong> of {money(num(payment.amount))} received.
            </p>
            <div className="flex flex-wrap gap-2">
              {canUpdate && !payment.reconciled && payment.status === 'completed' ? (
                <ReconcileButton paymentIds={[Number(payment.id)]} label="Mark reconciled" />
              ) : null}
              {canUpdate && payment.status === 'completed' ? (
                <ReversePaymentButton paymentId={Number(payment.id)} receiptNo={payment.receipt_no} amount={num(payment.amount)} />
              ) : null}
              <Link href={`/api/documents/statement?member_id=${payment.member_id}`} className="btn btn-outline btn-sm" target="_blank">
                <FileText className="h-4 w-4" /> Member statement
              </Link>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Payment information" icon={<ShieldCheck className="h-4 w-4" />} />
            <KeyValue
              columns={1}
              items={[
                ['Receipt number', <span className="font-mono">{payment.receipt_no}</span>],
                ['Status', <Badge tone={payment.status === 'completed' ? 'badge badge-green' : payment.status === 'reversed' ? 'badge badge-red' : 'badge badge-gold'}>{payment.status}</Badge>],
                ['Method', String(payment.method).toUpperCase()],
                ['Channel', payment.channel || 'manual'],
                ['Category', payment.category || '—'],
                ['Reference', payment.reference || '—'],
                ['Transaction ID', payment.transaction_id || '—'],
                ['Payment date', fmtDateTime(payment.payment_date)],
                ['Recorded by', payment.recorded_by_name || '—'],
                ['Parish', payment.parish_name || '—'],
                ['IP address', payment.ip_address || '—'],
                ['Notes', payment.notes || '—'],
              ]}
            />
            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Payer</p>
              <Link href={`/members/${payment.member_id}`} className="mt-1 block font-semibold text-navy-900 hover:text-gold-700">{payment.full_name}</Link>
              <p className="text-xs text-slate-500">{payment.membership_no}{payment.phone ? ` · ${payment.phone}` : ''}</p>
            </div>
          </Card>

          {receipt ? (
            <Card>
              <CardHeader title="Receipt" icon={<ReceiptText className="h-4 w-4" />} />
              <KeyValue
                columns={1}
                items={[
                  ['Receipt no.', <span className="font-mono">{receipt.receipt_no}</span>],
                  ['Issued', fmtDateTime(receipt.issued_at)],
                  ['Issued by', receipt.issued_by || '—'],
                  ['Status', receipt.status === 'valid' ? <Badge tone="badge badge-green">Valid</Badge> : <Badge tone="badge badge-red">{receipt.status}</Badge>],
                  ['Description', receipt.description || '—'],
                ]}
              />
            </Card>
          ) : null}

          <Card padded={false}>
            <div className="p-4"><CardHeader title="Audit trail" icon={<History className="h-4 w-4" />} subtitle="Every action taken on this payment." /></div>
            {audit.length === 0 ? (
              <div className="p-4 pt-0"><p className="text-sm text-slate-500">No audit entries yet.</p></div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {audit.map((a: any) => (
                  <li key={a.action + a.created_at} className="p-4 pt-3">
                    <p className="text-sm font-medium text-navy-900">{a.description || a.action}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {a.user_name || 'System'} · {fmtDateTime(a.created_at)}
                      {a.severity && a.severity !== 'info' ? ` · ${a.severity}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canUpdate ? (
            <Card>
              <CardHeader title="Reconciliation checklist" subtitle={<CheckCheck className="h-4 w-4" />} />
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <span className={payment.reconciled ? 'text-emerald-600' : 'text-amber-600'}>●</span>
                  {payment.reconciled ? `Reconciled on ${fmtDate(payment.reconciled_at)}` : 'Not yet reconciled with the bank / M-Pesa statement'}
                </li>
                <li className="flex items-start gap-2">
                  <span className={unallocated === 0 ? 'text-emerald-600' : 'text-amber-600'}>●</span>
                  {unallocated === 0 ? 'Fully allocated to member obligations' : `${money(unallocated)} still unallocated`}
                </li>
                <li className="flex items-start gap-2">
                  <span className={payment.reference || payment.transaction_id ? 'text-emerald-600' : 'text-amber-600'}>●</span>
                  {payment.reference || payment.transaction_id ? 'Source reference captured' : 'No source reference captured'}
                </li>
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
