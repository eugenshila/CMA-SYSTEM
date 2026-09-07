import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Coins, ArrowLeft, Download, Users, Wallet, CalendarCheck } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, KeyValue, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { getShareSettings } from '@/lib/settings';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { DividendForm, DividendRowActions } from '../forms/sacco-forms';

const STATUS_TONES: Record<string, string> = {
  computed: 'badge badge-blue',
  declared: 'badge badge-gold',
  paid: 'badge badge-green',
  cancelled: 'badge badge-red',
};

export default async function SaccoDividendsPage({ user }: { user: SessionUser }) {
  // Members only ever see their own dividends (on their account page), not all batches.
  if (isMember(user)) {
    const own = user.member_id
      ? await one<any>(`SELECT id FROM sacco_accounts WHERE member_id = $1`, [user.member_id])
      : null;
    redirect(own ? `/sacco/accounts/${own.id}` : '/dashboard');
  }
  if (!can(user, 'sacco.view') && !can(user, 'shares.view')) redirect('/dashboard');

  const ownOnly = false;
  const shareSettings = await getShareSettings();
  const thisYear = String(new Date().getFullYear());
  const years = [thisYear, String(Number(thisYear) - 1), String(Number(thisYear) - 2), String(Number(thisYear) - 3)];

  const [batches, totals, allocations, mine, shareholderCount] = await Promise.all([
    query<any>(`SELECT * FROM dividends ORDER BY financial_year DESC, id DESC LIMIT 50`),
    one<any>(
      `SELECT COALESCE(SUM(total_amount),0) AS declared_total,
              count(*)::int AS batches,
              count(*) FILTER (WHERE status = 'paid')::int AS paid,
              count(*) FILTER (WHERE status = 'declared')::int AS pending_credit
         FROM dividends`,
    ),
    ownOnly
      ? Promise.resolve([] as any[])
      : query<any>(
          `SELECT da.*, m.full_name, m.membership_no, m.id AS member_id, d.financial_year, d.status AS batch_status
             FROM dividend_allocations da
             JOIN dividends d ON d.id = da.dividend_id
             JOIN members m ON m.id = da.member_id
            ORDER BY d.financial_year DESC, da.amount DESC LIMIT 200`,
        ),
    user.member_id
      ? query<any>(
          `SELECT da.*, d.financial_year, d.status AS batch_status, d.declared_date, d.paid_date
             FROM dividend_allocations da JOIN dividends d ON d.id = da.dividend_id
            WHERE da.member_id = $1 ORDER BY d.financial_year DESC`,
          [user.member_id],
        )
      : Promise.resolve([] as any[]),
    one<any>(`SELECT count(DISTINCT member_id)::int AS shareholders FROM shares WHERE status = 'active'`),
  ]);

  const canDeclare = can(user, 'sacco.approve') || can(user, 'shares.approve');

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Dividends"
        subtitle={`Declared on shareholding at ${money(shareSettings.value_per_share)} per share, then credited to each member's savings account.`}
        action={
          <>
            <Link href="/sacco" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> SDP overview</Link>
            <Link href="/api/exports/sacco?format=excel" className="btn btn-outline btn-sm"><Download className="h-4 w-4" /> Export</Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Dividends computed" value={money(num(totals?.declared_total))} tone="gold" icon={<Coins className="h-4 w-4" />} />
        <StatCard label="Batches" value={String(totals?.batches || 0)} tone="navy" sub={`${totals?.paid || 0} paid · ${totals?.pending_credit || 0} awaiting credit`} />
        <StatCard label="Shareholders" value={String(shareholderCount?.shareholders || 0)} tone="green" icon={<Users className="h-4 w-4" />} />
        <StatCard label="Latest financial year" value={batches[0]?.financial_year || '—'} tone="slate" icon={<CalendarCheck className="h-4 w-4" />} />
      </div>

      {mine.length > 0 ? (
        <Card padded={false}>
          <div className="p-4"><CardHeader title="My dividends" subtitle="Declared on your shareholding and credited to your savings." icon={<Wallet className="h-4 w-4" />} /></div>
          <Table compact>
            <thead>
              <tr>
                <Th>Year</Th>
                <Th align="right">Shares held</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th>Credited</Th>
              </tr>
            </thead>
            <tbody>
              {mine.map((d: any) => (
                <tr key={d.id}>
                  <Td className="font-semibold text-navy-900">{d.financial_year}</Td>
                  <Td align="right">{d.shares_held}</Td>
                  <Td align="right" className="font-semibold text-emerald-700">{money(num(d.amount))}</Td>
                  <Td><Badge tone={STATUS_TONES[d.batch_status] || 'badge badge-grey'}>{d.batch_status}</Badge> <Badge tone={d.status === 'credited' ? 'badge badge-green' : 'badge badge-gold'}>{d.status}</Badge></Td>
                  <Td className="whitespace-nowrap text-xs text-slate-600">{d.credited_at ? fmtDate(d.credited_at) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {canDeclare ? (
          <Card className="lg:col-span-1">
            <CardHeader title="Compute a dividend" subtitle="The allocation is calculated from each member's active shares." />
            <DividendForm years={years} />
          </Card>
        ) : null}

        <Card className={canDeclare ? 'lg:col-span-2' : 'lg:col-span-3'} padded={false}>
          <div className="p-4"><CardHeader title="Dividend batches" subtitle="Declare, then credit to member savings accounts." /></div>
          {batches.length === 0 ? (
            <div className="p-4 pt-0">
              <EmptyState icon={<Coins className="h-6 w-6" />} title="No dividends yet" description={canDeclare ? 'Compute the first dividend batch from the form.' : 'The SDP committee has not declared a dividend yet.'} />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Year</Th>
                  <Th>Description</Th>
                  <Th align="right">Rate / share</Th>
                  <Th align="right">Percentage</Th>
                  <Th align="right">Total</Th>
                  <Th>Declared</Th>
                  <Th>Paid</Th>
                  <Th>Status</Th>
                  {canDeclare || can(user, 'payments.create') ? <Th align="right">Actions</Th> : null}
                </tr>
              </thead>
              <tbody>
                {batches.map((d: any) => (
                  <tr key={d.id} className="hover:bg-slate-50/70">
                    <Td className="font-semibold text-navy-900">{d.financial_year}</Td>
                    <Td className="max-w-[16rem] truncate text-xs text-slate-600">{d.description || '—'}</Td>
                    <Td align="right">{num(d.rate_per_share) ? money(num(d.rate_per_share)) : '—'}</Td>
                    <Td align="right">{num(d.percentage) ? `${num(d.percentage).toFixed(2)}%` : '—'}</Td>
                    <Td align="right" className="font-semibold">{money(num(d.total_amount))}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{d.declared_date ? fmtDate(d.declared_date) : '—'}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{d.paid_date ? fmtDate(d.paid_date) : '—'}</Td>
                    <Td><Badge tone={STATUS_TONES[d.status] || 'badge badge-grey'}>{d.status}</Badge></Td>
                    {canDeclare || can(user, 'payments.create') ? (
                      <Td align="right"><DividendRowActions dividendId={Number(d.id)} status={d.status} /></Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {!ownOnly ? (
        <Card padded={false}>
          <div className="p-4">
            <CardHeader title="Dividend allocations" subtitle="Who receives what, and whether it has been credited to their savings." />
          </div>
          {allocations.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState title="No allocations computed yet" /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Year</Th>
                  <Th>Member</Th>
                  <Th align="right">Shares held</Th>
                  <Th align="right">Dividend</Th>
                  <Th>Status</Th>
                  <Th>Credited</Th>
                  <Th align="right">Payment</Th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a: any) => (
                  <tr key={a.id}>
                    <Td className="font-semibold text-navy-900">{a.financial_year}</Td>
                    <Td>
                      <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${a.member_id}?tab=sacco`}>{a.full_name}</Link>
                      <div className="text-[11px] text-slate-500">{a.membership_no}</div>
                    </Td>
                    <Td align="right">{a.shares_held}</Td>
                    <Td align="right" className="font-semibold text-emerald-700">{money(num(a.amount))}</Td>
                    <Td><Badge tone={a.status === 'credited' ? 'badge badge-green' : 'badge badge-gold'}>{a.status}</Badge></Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600" >{a.credited_at ? <span title={fmtDateTime(a.credited_at)}>{fmtDate(a.credited_at)}</span> : '—'}</Td>
                    <Td align="right">
                      {a.payment_id && can(user, 'payments.view') ? (
                        <Link href={`/payments/${a.payment_id}`} className="btn btn-ghost btn-sm">View</Link>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}

      <Card>
        <CardHeader title="How dividends work here" />
        <KeyValue
          columns={1}
          items={[
            ['1. Compute', 'The SDP officer enters the financial year and either a rate per share or a percentage of share capital. The system allocates the total across every active shareholder.'],
            ['2. Declare', 'Declaring notifies every shareholder in-system (and by SMS / email where configured) and records the declaration date.'],
            ['3. Credit', 'Crediting posts a “dividend” savings transaction for each member, updates their savings balance and creates an audit entry — no cash leaves the account unless the member withdraws it.'],
            ['Audit', 'Every computation, declaration and credit is written to the audit trail with the acting officer.'],
          ]}
        />
      </Card>
    </div>
  );
}
