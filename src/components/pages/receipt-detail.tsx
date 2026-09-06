import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ReceiptText, FileText, Wallet, ArrowLeft } from 'lucide-react';
import { Badge, Card, CardHeader, KeyValue, SectionHeading, Table, Td, Th } from '../ui/primitives';
import { PrintButton } from '../ui/client';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { paymentAllocations, ALLOCATION_LABELS, type AllocationType } from '@/lib/payments';
import { getOrganisation } from '@/lib/settings';
import { money, num } from '@/lib/money';
import { fmtDateTime } from '@/lib/dates';

export default async function ReceiptDetailPage({ receiptNo, user }: { receiptNo: string; user: SessionUser }) {
  const receipt = await one<any>(
    `SELECT r.*, m.full_name, m.membership_no, m.phone, m.email, m.id AS member_id,
            p.amount AS payment_amount, p.method, p.reference, p.transaction_id, p.status AS payment_status,
            p.payment_date, p.allocated_amount, p.unallocated_amount
       FROM receipts r
       JOIN members m ON m.id = r.member_id
       LEFT JOIN payments p ON p.id = r.payment_id
      WHERE r.receipt_no = $1`,
    [receiptNo],
  );
  if (!receipt) notFound();

  // A member may only open their own receipt; staff need payments or receipts access.
  const isOwn = user.member_id === Number(receipt.member_id);
  if (!isOwn && !can(user, 'payments.view') && !can(user, 'receipts.view')) redirect('/receipts');

  const org = await getOrganisation();
  const allocations = receipt.payment_id ? await paymentAllocations(Number(receipt.payment_id)) : [];

  return (
    <div className="space-y-5">
      <SectionHeading
        title={`Receipt ${receipt.receipt_no}`}
        subtitle={`Issued ${fmtDateTime(receipt.issued_at)} by ${receipt.issued_by || org.name}`}
        action={
          <>
            <Link href="/receipts" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> All receipts</Link>
            <PrintButton />
            <Link href={`/api/documents/receipt?receipt=${encodeURIComponent(receipt.receipt_no)}`} className="btn btn-primary btn-sm" target="_blank">
              <FileText className="h-4 w-4" /> Download PDF
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 print:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="text-lg font-bold text-navy-900">{org.name}</p>
              <p className="text-xs text-slate-500">
                {[org.scc, org.church, org.parish, org.deanery, org.diocese, org.archdiocese, org.country].filter(Boolean).join(' · ')}
              </p>
              {org.phone || org.email ? (
                <p className="mt-1 text-xs text-slate-500">{[org.phone, org.email].filter(Boolean).join(' · ')}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Official receipt</p>
              <p className="font-mono text-lg font-bold text-navy-900">{receipt.receipt_no}</p>
              {receipt.status === 'void' ? <Badge tone="badge badge-red">VOID</Badge> : <Badge tone="badge badge-green">VALID</Badge>}
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-gold-50 p-4 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gold-700">Amount received</p>
            <p className="text-3xl font-extrabold text-navy-900">{money(num(receipt.amount))}</p>
            <p className="mt-1 text-xs text-slate-600">{receipt.description || 'CMA payment'}</p>
          </div>

          <div className="mt-5">
            <KeyValue
              columns={2}
              items={[
                ['Received from', receipt.issued_to_name || receipt.full_name],
                ['CMA membership no.', receipt.membership_no],
                ['Phone', receipt.phone || '—'],
                ['Payment method', String(receipt.payment_method || receipt.method || '—').toUpperCase()],
                ['Payment date', receipt.payment_date ? fmtDateTime(receipt.payment_date) : fmtDateTime(receipt.issued_at)],
                ['Reference', receipt.reference || '—'],
                ['Transaction ID', receipt.transaction_id || '—'],
                ['Category', receipt.category || '—'],
                ['Balance after payment', money(num(receipt.balance_after))],
                ['Issued by', receipt.issued_by || 'System'],
              ]}
            />
          </div>

          {allocations.length > 0 ? (
            <div className="mt-6">
              <CardHeader title="Allocated to" subtitle="How this payment was applied to the member's account." />
              <Table compact>
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
                      <Td className="font-medium text-navy-900">{ALLOCATION_LABELS[a.allocation_type as AllocationType] || a.allocation_type}</Td>
                      <Td className="text-xs text-slate-600">{a.reference_type ? a.reference_type.replace(/_/g, ' ') : '—'}{a.reference_id ? ` #${a.reference_id}` : ''}</Td>
                      <Td className="text-xs text-slate-600">{a.period || '—'}</Td>
                      <Td align="right" className="font-semibold">{money(num(a.amount))}</Td>
                    </tr>
                  ))}
                  {num(receipt.unallocated_amount) > 0 ? (
                    <tr>
                      <Td className="text-slate-500" >Unallocated balance</Td>
                      <Td />
                      <Td />
                      <Td align="right" className="text-amber-700">{money(num(receipt.unallocated_amount))}</Td>
                    </tr>
                  ) : null}
                </tbody>
              </Table>
            </div>
          ) : null}

          <p className="mt-6 border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-500">
            This is a computer-generated receipt issued under the {org.name} member management system. It is valid without a signature or
            stamp. Financial records are retained in line with the Kenya Data Protection Act, 2019 and are never deleted — corrections are
            made by reversal so the audit trail stays intact.
          </p>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Member" icon={<Wallet className="h-4 w-4" />} />
            <p className="font-semibold text-navy-900">{receipt.full_name}</p>
            <p className="text-xs text-slate-500">{receipt.membership_no}{receipt.phone ? ` · ${receipt.phone}` : ''}</p>
            {can(user, 'members.view') ? (
              <Link href={`/members/${receipt.member_id}`} className="btn btn-outline btn-sm mt-3">Open member profile</Link>
            ) : null}
          </Card>

          {receipt.payment_id ? (
            <Card>
              <CardHeader title="Payment record" icon={<ReceiptText className="h-4 w-4" />} />
              <KeyValue
                columns={1}
                items={[
                  ['Payment ID', <span className="font-mono">#{receipt.payment_id}</span>],
                  ['Status', String(receipt.payment_status || '—')],
                  ['Amount received', money(num(receipt.payment_amount))],
                  ['Allocated', money(num(receipt.allocated_amount))],
                  ['Unallocated', money(num(receipt.unallocated_amount))],
                ]}
              />
              {can(user, 'payments.view') ? (
                <Link href={`/payments/${receipt.payment_id}`} className="btn btn-outline btn-sm mt-3">Open payment</Link>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Need a statement?" subtitle="A consolidated statement covers contributions, welfare, savings, shares and loans." />
            <div className="flex flex-wrap gap-2">
              <Link href={`/api/documents/statement?member_id=${receipt.member_id}`} className="btn btn-outline btn-sm" target="_blank">
                <FileText className="h-4 w-4" /> Statement PDF
              </Link>
              {can(user, 'payments.view') || isOwn ? (
                <Link href={`/statements?member_id=${receipt.member_id}`} className="btn btn-ghost btn-sm">View on screen</Link>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
