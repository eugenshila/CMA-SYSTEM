import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ReceiptText, Download, FileText, CheckCircle2, XCircle, Wallet } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput, SelectFilter, DateRangeFilter } from '../ui/client';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime, sqlDate } from '@/lib/dates';

const PER_PAGE = 25;

export default async function ReceiptsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!can(user, 'payments.view') && !user.member_id) redirect('/dashboard');

  const search = String(sp.search || sp.q || '').trim();
  const status = String(sp.status || '');
  const from = String(sp.from || '');
  const to = String(sp.to || '');
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  // A member without finance permission only ever sees their own receipts.
  const ownOnly = !can(user, 'payments.view');
  const params: any[] = [];
  const where: string[] = ['1=1'];
  if (ownOnly) {
    params.push(user.member_id);
    where.push(`r.member_id = $${params.length}`);
  } else if (user.scope_parish_id) {
    params.push(Number(user.scope_parish_id));
    where.push(`COALESCE(p.parish_id, m.parish_id) = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(r.receipt_no ILIKE $${params.length} OR m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length} OR r.reference ILIKE $${params.length})`);
  }
  if (from) {
    params.push(sqlDate(from));
    where.push(`r.issued_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(sqlDate(to));
    where.push(`r.issued_at < ($${params.length}::date + interval '1 day')`);
  }
  const whereSql = where.join(' AND ');

  const [rows, countRow, stats] = await Promise.all([
    query<any>(
      `SELECT r.*, m.full_name, m.membership_no, m.id AS member_id, p.status AS payment_status, p.method, p.channel
         FROM receipts r
         JOIN members m ON m.id = r.member_id
         LEFT JOIN payments p ON p.id = r.payment_id
        WHERE ${whereSql}
        ORDER BY r.issued_at DESC, r.id DESC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(
      `SELECT count(*)::int AS total FROM receipts r JOIN members m ON m.id = r.member_id LEFT JOIN payments p ON p.id = r.payment_id WHERE ${whereSql}`,
      params,
    ),
    one<any>(
      `SELECT count(*)::int AS total,
              COALESCE(SUM(r.amount),0) AS issued,
              count(*) FILTER (WHERE r.status = 'void')::int AS voided,
              COALESCE(SUM(r.amount) FILTER (WHERE r.issued_at >= date_trunc('month', CURRENT_DATE)),0) AS this_month
         FROM receipts r ${ownOnly ? `WHERE r.member_id = $1` : ''}`,
      ownOnly ? [user.member_id] : [],
    ),
  ]);

  const total = Number(countRow?.total || 0);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Receipts"
        subtitle={ownOnly ? 'Every receipt issued for your payments.' : 'Official receipts issued for all payments, ready to download or print.'}
        action={
          <Link href={`/api/exports/receipts?format=excel${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`} className="btn btn-outline btn-sm">
            <Download className="h-4 w-4" /> Export
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Receipts issued" value={String(stats?.total || 0)} tone="navy" icon={<ReceiptText className="h-4 w-4" />} />
        <StatCard label="Total value" value={money(num(stats?.issued))} tone="green" icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="This month" value={money(num(stats?.this_month))} tone="gold" />
        <StatCard label="Void / reversed" value={String(stats?.voided || 0)} tone="red" icon={<XCircle className="h-4 w-4" />} sub="Kept for audit" />
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader
            title="Receipt register"
            subtitle={`${total} receipt${total === 1 ? '' : 's'}`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput param="search" placeholder="Receipt no, member…" className="w-48 sm:w-60" />
                {!ownOnly ? (
                  <SelectFilter
                    param="status"
                    placeholder="All statuses"
                    className="w-36"
                    options={[
                      { value: 'valid', label: 'Valid' },
                      { value: 'void', label: 'Void' },
                    ]}
                  />
                ) : null}
                <DateRangeFilter />
              </div>
            }
          />
        </div>

        {rows.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState icon={<ReceiptText className="h-6 w-6" />} title="No receipts found" description="Adjust the filters, or record a payment to issue the first receipt." />
          </div>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Receipt no.</Th>
                  <Th>Member</Th>
                  <Th>Issued</Th>
                  <Th>Description</Th>
                  <Th>Method</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance after</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className={r.status === 'void' ? 'bg-red-50/40' : 'hover:bg-slate-50/70'}>
                    <Td className="whitespace-nowrap font-mono text-xs">
                      <Link className="text-navy-800 hover:text-gold-700" href={`/receipts/${encodeURIComponent(r.receipt_no)}`}>{r.receipt_no}</Link>
                    </Td>
                    <Td>
                      {can(user, 'members.view') ? (
                        <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${r.member_id}`}>{r.full_name}</Link>
                      ) : (
                        <span className="font-medium text-navy-900">{r.full_name}</span>
                      )}
                      <div className="text-[11px] text-slate-500">{r.membership_no}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600"><span title={fmtDateTime(r.issued_at)}>{fmtDate(r.issued_at)}</span></Td>
                    <Td className="max-w-[16rem] truncate text-xs text-slate-600">{r.description || r.category || '—'}</Td>
                    <Td><Badge tone="badge badge-navy">{String(r.payment_method || r.method || '—').toUpperCase()}</Badge></Td>
                    <Td align="right" className="font-semibold">{money(num(r.amount))}</Td>
                    <Td align="right" className="text-slate-600">{money(num(r.balance_after))}</Td>
                    <Td>
                      {r.status === 'void' ? (
                        <Badge tone="badge badge-red"><XCircle className="mr-1 inline h-3 w-3" /> Void</Badge>
                      ) : (
                        <Badge tone="badge badge-green"><CheckCircle2 className="mr-1 inline h-3 w-3" /> Valid</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Link href={`/receipts/${encodeURIComponent(r.receipt_no)}`} className="btn btn-outline btn-sm">View</Link>
                        <Link href={`/api/documents/receipt?receipt=${encodeURIComponent(r.receipt_no)}`} className="btn btn-ghost btn-sm" target="_blank">
                          <FileText className="h-3.5 w-3.5" /> PDF
                        </Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="p-4">
              <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/receipts" query={{ search, status, from, to }} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
