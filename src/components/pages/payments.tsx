import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Banknote, Plus, Download, CheckCheck, RotateCcw, CalendarDays, TrendingUp, Wallet, Smartphone } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Pagination,
  SectionHeading,
  StatCard,
  Table,
  Td,
  Th,
} from '../ui/primitives';
import { SearchInput, SelectFilter, DateRangeFilter } from '../ui/client';
import { BarChartCard, DonutChartCard } from '../charts';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { listPayments } from '@/lib/payments';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime, isoDate, periodKey } from '@/lib/dates';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@/lib/payment-meta';
import { ReconcileButton } from '../forms/payment-forms';

const PER_PAGE = 25;

const STATUS_TONES: Record<string, string> = {
  completed: 'badge badge-green',
  pending: 'badge badge-gold',
  failed: 'badge badge-red',
  reversed: 'badge badge-red',
};

export default async function PaymentsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!can(user, 'payments.view')) redirect('/dashboard');

  const from = String(sp.from || '');
  const to = String(sp.to || '');
  const method = String(sp.method || '');
  const status = String(sp.status || '');
  const search = String(sp.search || sp.q || '').trim();
  const memberId = Number(sp.member_id || 0) || null;
  const reconciled = String(sp.reconciled || '');
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const scope = user.scope_parish_id ? `AND p.parish_id = ${Number(user.scope_parish_id)}` : '';

  const [list, stats, byMethod, trend, unreconciledRows] = await Promise.all([
    listPayments({ memberId, status, method, from: from || null, to: to || null, search, limit: PER_PAGE, offset }),
    one<any>(
      `SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date::date = CURRENT_DATE AND p.status = 'completed'),0) AS today,
              COALESCE(SUM(p.amount) FILTER (WHERE to_char(p.payment_date,'YYYY-MM') = $1 AND p.status = 'completed'),0) AS this_month,
              count(*) FILTER (WHERE p.reconciled = FALSE AND p.status = 'completed')::int AS unreconciled,
              COALESCE(SUM(p.amount) FILTER (WHERE p.reconciled = FALSE AND p.status = 'completed'),0) AS unreconciled_amount,
              count(*) FILTER (WHERE p.status = 'reversed')::int AS reversed,
              count(*)::int AS all_count
         FROM payments p WHERE 1=1 ${scope}`,
      [periodKey(new Date())],
    ),
    query<any>(
      `SELECT initcap(p.method) AS label, COALESCE(SUM(p.amount),0)::float AS value
         FROM payments p WHERE p.status = 'completed' ${scope} GROUP BY 1 ORDER BY 2 DESC`,
    ),
    query<any>(
      `SELECT to_char(p.payment_date,'YYYY-MM-DD') AS label, COALESCE(SUM(p.amount),0)::float AS collected
         FROM payments p
        WHERE p.status = 'completed' AND p.payment_date >= CURRENT_DATE - interval '13 days' ${scope}
        GROUP BY 1 ORDER BY 1`,
    ),
    reconciled === 'no'
      ? query<any>(
          `SELECT p.id FROM payments p WHERE p.status = 'completed' AND p.reconciled = FALSE ${scope} ORDER BY p.payment_date DESC LIMIT 200`,
        )
      : Promise.resolve([] as any[]),
  ]);

  // reconcile filter is applied in SQL above only for the bulk action list; keep the register consistent
  const rows = reconciled === 'no' ? list.rows.filter((r: any) => !r.reconciled) : reconciled === 'yes' ? list.rows.filter((r: any) => r.reconciled) : list.rows;
  const canCreate = can(user, 'payments.create');
  const canUpdate = can(user, 'payments.update');

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Payments & receipts"
        subtitle="Every shilling received, how it was allocated, and whether it has been reconciled with the bank or M-Pesa statement."
        action={
          <>
            {canCreate ? (
              <Link href="/payments/new" className="btn btn-primary btn-sm"><Plus className="h-4 w-4" /> Record payment</Link>
            ) : null}
            <Link href="/payments/mobile-money" className="btn btn-outline btn-sm"><Smartphone className="h-4 w-4" /> Mobile money</Link>
            <Link href={`/api/exports/payments?format=excel${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`} className="btn btn-outline btn-sm">
              <Download className="h-4 w-4" /> Excel
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Collected today" value={money(num(stats?.today))} tone="green" icon={<Banknote className="h-4 w-4" />} />
        <StatCard label="Collected this month" value={money(num(stats?.this_month))} tone="navy" icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard
          label="Awaiting reconciliation"
          value={String(stats?.unreconciled || 0)}
          tone="gold"
          icon={<CheckCheck className="h-4 w-4" />}
          sub={money(num(stats?.unreconciled_amount))}
          href="/payments?reconciled=no"
        />
        <StatCard label="Reversed payments" value={String(stats?.reversed || 0)} tone="red" icon={<RotateCcw className="h-4 w-4" />} sub="Kept for audit" />
        <StatCard label="Payments on record" value={String(stats?.all_count || 0)} tone="slate" icon={<CalendarDays className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-4"><CardHeader title="Daily collections" subtitle="Last 14 days." /></div>
          <div className="px-2 pb-4">
            <BarChartCard data={trend} xKey="label" series={[{ key: 'collected', label: 'Collected', color: '#0e2340' }]} />
          </div>
        </Card>
        <Card padded={false}>
          <div className="p-4"><CardHeader title="By payment method" /></div>
          <div className="px-2 pb-4">
            <DonutChartCard data={byMethod.map((m: any) => ({ label: m.label, value: Number(m.value) }))} centerLabel="Collected" centerValue={money(byMethod.reduce((a: number, m: any) => a + Number(m.value), 0))} />
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader
            title="Payment register"
            subtitle={`${list.total} payment${list.total === 1 ? '' : 's'} · ${money(list.sum)} collected in this view`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput param="search" placeholder="Receipt, ref, member…" className="w-48 sm:w-60" />
                <SelectFilter param="method" placeholder="All methods" className="w-36" options={PAYMENT_METHODS} />
                <SelectFilter
                  param="status"
                  placeholder="All statuses"
                  className="w-36"
                  options={PAYMENT_STATUSES}
                />
                <SelectFilter
                  param="reconciled"
                  placeholder="Reconciliation"
                  className="w-40"
                  options={[
                    { value: 'no', label: 'Not reconciled' },
                    { value: 'yes', label: 'Reconciled' },
                  ]}
                />
                <DateRangeFilter />
              </div>
            }
          />
        </div>

        {rows.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState
              icon={<Wallet className="h-6 w-6" />}
              title="No payments match these filters"
              description={canCreate ? 'Record a payment or clear the filters.' : 'Try clearing the filters.'}
              action={canCreate ? <Link href="/payments/new" className="btn btn-primary btn-sm"><Plus className="h-4 w-4" /> Record payment</Link> : undefined}
            />
          </div>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Member</Th>
                  <Th>Date</Th>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Allocated</Th>
                  <Th>Status</Th>
                  <Th>Reconciled</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p: any) => (
                  <tr key={p.id} className={p.status === 'reversed' ? 'bg-red-50/40' : 'hover:bg-slate-50/70'}>
                    <Td className="whitespace-nowrap font-mono text-xs">
                      <Link className="text-navy-800 hover:text-gold-700" href={`/payments/${p.id}`}>{p.receipt_no}</Link>
                    </Td>
                    <Td>
                      <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${p.member_id}?tab=payments`}>{p.full_name}</Link>
                      <div className="text-[11px] text-slate-500">{p.membership_no}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDateTime(p.payment_date)}</Td>
                    <Td><Badge tone="badge badge-navy">{String(p.method).toUpperCase()}</Badge></Td>
                    <Td className="max-w-[9rem] truncate text-xs text-slate-500" >{p.reference || p.transaction_id || '—'}</Td>
                    <Td align="right" className="font-semibold">{money(num(p.amount))}</Td>
                    <Td align="right" className={num(p.unallocated_amount) > 0 ? 'text-amber-700' : 'text-slate-500'}>
                      {money(num(p.allocated_amount))}
                      {num(p.unallocated_amount) > 0 ? <div className="text-[11px]">{money(num(p.unallocated_amount))} unallocated</div> : null}
                    </Td>
                    <Td><Badge tone={STATUS_TONES[p.status] || 'badge badge-grey'}>{p.status}</Badge></Td>
                    <Td>
                      {p.reconciled ? (
                        <span className="badge badge-green">Yes · {fmtDate(p.reconciled_at)}</span>
                      ) : (
                        <span className="badge badge-gold">Pending</span>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Link href={`/payments/${p.id}`} className="btn btn-outline btn-sm">Open</Link>
                        <Link href={`/api/documents/receipt?receipt=${encodeURIComponent(p.receipt_no)}`} className="btn btn-ghost btn-sm" target="_blank">PDF</Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              {canUpdate && unreconciledRows.length > 0 ? (
                <ReconcileButton paymentIds={unreconciledRows.map((r: any) => Number(r.id))} label="Reconcile unreconciled" />
              ) : (
                <span className="text-xs text-slate-500">
                  {canUpdate ? 'Filter by “Not reconciled” to bulk-reconcile payments.' : ''}
                </span>
              )}
              <Pagination
                page={page}
                pageSize={PER_PAGE}
                total={list.total}
                basePath="/payments"
                query={{ search, method, status, reconciled, from, to, member_id: memberId }}
              />
            </div>
          </>
        )}
      </Card>

      <p className="text-xs text-slate-500">
        Financial records are never deleted. A reversed payment keeps its original entry and creates a correcting transaction with the
        reason stored in the audit trail (Kenya Data Protection Act & SASRA-style record keeping).
      </p>
    </div>
  );
}
