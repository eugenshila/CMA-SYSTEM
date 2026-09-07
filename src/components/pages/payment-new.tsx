import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Banknote, Search, Users } from 'lucide-react';
import { Card, CardHeader, EmptyState, KeyValue, SectionHeading, StatCard } from '../ui/primitives';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { memberBalances } from '@/lib/payments';
import { memberObligations } from '@/server/services/obligations';
import { money, num } from '@/lib/money';
import { PAYMENT_METHODS } from '@/lib/payment-meta';
import { RecordPaymentForm } from '../forms/payment-forms';

export default async function PaymentNewPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!can(user, 'payments.create')) redirect('/payments');

  const memberId = Number(sp.member_id || 0) || null;
  const parishFilter = user.scope_parish_id ? `AND m.parish_id = ${Number(user.scope_parish_id)}` : '';

  if (!memberId) {
    const [members, recent] = await Promise.all([
      query<any>(
        `SELECT m.id, m.full_name, m.membership_no, s.name AS scc_name
           FROM members m LEFT JOIN small_christian_communities s ON s.id = m.scc_id
          WHERE m.deleted_at IS NULL AND m.membership_status = 'active' ${parishFilter}
          ORDER BY m.membership_no`,
      ),
      query<any>(
        `SELECT m.id, m.full_name, m.membership_no,
                COALESCE((SELECT SUM(mc.amount_due - mc.amount_paid) FROM member_contributions mc
                           WHERE mc.member_id = m.id AND mc.exempted = FALSE AND mc.amount_paid < mc.amount_due),0) AS arrears
           FROM members m
          WHERE m.deleted_at IS NULL AND m.membership_status = 'active' ${parishFilter}
          ORDER BY arrears DESC, m.membership_no LIMIT 8`,
      ),
    ]);

    return (
      <div className="space-y-5">
        <SectionHeading title="Record a payment" subtitle="Choose the member whose payment you are receiving. A receipt is issued automatically." />

        <Card>
          <CardHeader title="Select member" subtitle="Search by name or CMA membership number, then continue." />
          <form method="get" className="space-y-4">
            <label className="label" htmlFor="member-select">Member</label>
            <select id="member-select" name="member_id" required className="select" defaultValue="">
              <option value="">Select a member…</option>
              {members.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} — {m.membership_no}
                  {m.scc_name ? ` (${m.scc_name})` : ''}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary"><Search className="h-4 w-4" /> Continue</button>
              <Link href="/members" className="btn btn-ghost">Browse the member directory</Link>
            </div>
          </form>
        </Card>

        <Card padded={false}>
          <div className="p-4">
            <CardHeader title="Members with the highest arrears" subtitle="A quick way to start collecting." icon={<Users className="h-4 w-4" />} />
          </div>
          {recent.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState title="No members with arrears" description="Every active member is up to date." /></div>
          ) : (
            <div className="grid gap-3 p-4 pt-0 sm:grid-cols-2 xl:grid-cols-4">
              {recent.map((m: any) => (
                <Link
                  key={m.id}
                  href={`/payments/new?member_id=${m.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-gold-500 hover:shadow-pop"
                >
                  <p className="truncate text-sm font-semibold text-navy-900">{m.full_name}</p>
                  <p className="text-[11px] text-slate-500">{m.membership_no}</p>
                  <p className="mt-2 text-sm font-bold text-red-600">{money(num(m.arrears))} arrears</p>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  }

  const [member, balances, obligations] = await Promise.all([
    one<any>(
      `SELECT m.id, m.full_name, m.membership_no, m.phone, m.email, m.membership_status, m.exempt_monthly,
              p.name AS parish_name, s.name AS scc_name, ch.name AS church_name
         FROM members m
         LEFT JOIN parishes p ON p.id = m.parish_id
         LEFT JOIN churches ch ON ch.id = m.church_id
         LEFT JOIN small_christian_communities s ON s.id = m.scc_id
        WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [memberId],
    ),
    memberBalances(memberId),
    memberObligations(memberId),
  ]);

  if (!member) redirect('/payments/new');

  const presetType = String(sp.alloc_type || '');
  const preset = presetType
    ? {
        type: presetType,
        referenceId: sp.alloc_ref ? Number(sp.alloc_ref) : null,
        period: sp.period ? String(sp.period) : null,
        amount: sp.amount ? num(sp.amount) : obligations.find((o) => o.allocationType === presetType)?.amount || 0,
      }
    : null;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Record a payment"
        subtitle={`${member.full_name} · ${member.membership_no}${member.scc_name ? ` · SCC ${member.scc_name}` : ''}`}
        action={<Link href="/payments" className="btn btn-outline btn-sm">Back to payments</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Monthly arrears" value={money(balances.monthly_outstanding)} tone={balances.monthly_outstanding > 0 ? 'red' : 'green'} sub={`${balances.unpaid_periods} month(s) unpaid`} />
        <StatCard label="Loan outstanding" value={money(balances.loan_outstanding)} tone="navy" sub={`${balances.active_loans} active loan(s)`} />
        <StatCard label="Penalties" value={money(balances.penalties_outstanding)} tone="gold" />
        <StatCard label="Sacco savings" value={money(balances.savings_balance)} tone="green" sub={balances.account_no || 'No account yet'} />
      </div>

      <Card>
        <CardHeader
          title="Payment details"
          subtitle="Allocate the money to contributions, cases, savings, shares or loan repayments. The receipt is generated automatically."
          icon={<Banknote className="h-4 w-4" />}
        />
        <RecordPaymentForm
          member={{ id: Number(member.id), name: member.full_name, membership_no: member.membership_no, phone: member.phone }}
          obligations={obligations}
          preset={preset}
          balance={balances.total_outstanding}
        />
      </Card>

      <Card>
        <CardHeader title="Member balances" subtitle="Used to advise the member during collection." />
        <KeyValue
          columns={3}
          items={[
            ['Total outstanding', money(balances.total_outstanding)],
            ['Monthly contributions paid', money(balances.monthly_paid)],
            ['Welfare contributed', money(balances.welfare_paid)],
            ['Funerals contributed', money(balances.funeral_paid)],
            ['Weddings contributed', money(balances.wedding_paid)],
            ['Projects contributed', money(balances.project_paid)],
            ['Shares held', `${balances.shares_count} (${money(balances.shares_value)})`],
            ['Guaranteed for others', money(balances.guaranteed_amount)],
            ['Payment methods accepted', PAYMENT_METHODS.map((m) => m.label).join(', ')],
          ]}
        />
      </Card>
    </div>
  );
}
