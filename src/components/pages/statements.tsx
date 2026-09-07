import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Download, Search, Wallet, ArrowLeft } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, KeyValue, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { DateRangeFilter, PrintButton } from '../ui/client';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { memberStatement } from '@/lib/payments';
import { getOrganisation } from '@/lib/settings';
import BrandLogo from '@/components/brand/BrandLogo';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';

export default async function StatementsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  const memberId = Number(sp.member_id || 0) || (can(user, 'payments.view') ? null : user.member_id);
  if (!memberId) {
    // staff without a chosen member: show the picker
    const members = await query<any>(
      `SELECT m.id, m.full_name, m.membership_no, s.name AS scc_name
         FROM members m LEFT JOIN small_christian_communities s ON s.id = m.scc_id
        WHERE m.deleted_at IS NULL ${user.scope_parish_id ? `AND m.parish_id = ${Number(user.scope_parish_id)}` : ''}
        ORDER BY m.membership_no`,
    );
    return (
      <div className="space-y-5">
        <SectionHeading title="Member statements" subtitle="Consolidated statement across contributions, welfare, funerals, weddings, projects, savings, shares and loans." />
        <Card>
          <CardHeader title="Select a member" subtitle="Choose whose statement to open, then pick a date range." />
          <form method="get" className="space-y-4">
            <label className="label" htmlFor="statement-member">Member</label>
            <select id="statement-member" name="member_id" required className="select" defaultValue="">
              <option value="">Select a member…</option>
              {members.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} — {m.membership_no}
                  {m.scc_name ? ` (${m.scc_name})` : ''}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary"><Search className="h-4 w-4" /> Open statement</button>
              <Link href="/members" className="btn btn-ghost">Browse members</Link>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  // members may only open their own statement
  if (!can(user, 'payments.view') && user.member_id !== memberId) redirect('/my-profile');

  const from = String(sp.from || '');
  const to = String(sp.to || '');
  const [statement, org] = await Promise.all([
    memberStatement(memberId, from || null, to || null),
    getOrganisation(),
  ]);

  const m = statement.member;
  const b = statement.balances;
  const sections = statement.sections.filter((s) => s.rows.length > 0);
  const downloadBase = `/api/documents/statement?member_id=${memberId}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;

  return (
    <div className="space-y-5">
      <SectionHeading
        title={`Statement — ${m.full_name}`}
        subtitle={`${m.membership_no}${m.parish_name ? ` · ${m.parish_name}` : ''}${m.scc_name ? ` · SCC ${m.scc_name}` : ''} · ${statement.range.from ? `From ${fmtDate(statement.range.from)}` : 'From inception'} · ${statement.range.to ? `To ${fmtDate(statement.range.to)}` : 'To date'}`}
        action={
          <>
            <Link href="/statements" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> Change member</Link>
            <DateRangeFilter />
            <PrintButton />
            <Link href={downloadBase} className="btn btn-primary btn-sm" target="_blank"><FileText className="h-4 w-4" /> Statement PDF</Link>
            <Link href={`/api/exports/statement?member_id=${memberId}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}&format=excel`} className="btn btn-outline btn-sm">
              <Download className="h-4 w-4" /> Excel
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total contributions paid" value={money(num(b.monthly_paid))} tone="green" icon={<Wallet className="h-4 w-4" />} sub={`${b.unpaid_periods || 0} month(s) unpaid`} />
        <StatCard label="Monthly arrears" value={money(num(b.monthly_outstanding))} tone={num(b.monthly_outstanding) > 0 ? 'red' : 'slate'} sub={num(b.contribution_penalties) > 0 ? `${money(num(b.contribution_penalties))} penalties` : 'No penalties'} />
        <StatCard label="Sacco savings" value={money(num(b.savings_balance))} tone="navy" sub={`${b.shares_count || 0} shares · ${money(num(b.shares_value))}`} />
        <StatCard label="Loan outstanding" value={money(num(b.loan_outstanding))} tone={num(b.loan_outstanding) > 0 ? 'gold' : 'slate'} sub={`${b.active_loans || 0} active loan(s)`} />
      </div>

      <Card>
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
          <BrandLogo org={org} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-navy-900">{org.name}</p>
            <p className="truncate text-xs text-slate-500">
              {[org.scc, org.church, org.parish, org.deanery, org.diocese, org.archdiocese, org.country].filter(Boolean).join(' · ') || 'Member statement'}
            </p>
          </div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Member statement</p>
        </div>
        <CardHeader title="Member & account summary" subtitle={`Generated ${fmtDateTime(statement.generated_at)} by ${org.name}.`} />
        <KeyValue
          columns={3}
          items={[
            ['Full name', m.full_name],
            ['Membership no.', m.membership_no],
            ['Status', <Badge tone={m.membership_status === 'active' ? 'badge badge-green' : 'badge badge-grey'}>{m.membership_status}</Badge>],
            ['Parish', m.parish_name || '—'],
            ['Church / outstation', m.church_name || '—'],
            ['SCC', m.scc_name || '—'],
            ['Phone', m.phone || '—'],
            ['Email', m.email || '—'],
            ['Sacco account', b.account_no || 'Not opened'],
            ['Welfare contributed', money(num(b.welfare_paid))],
            ['Funerals contributed', money(num(b.funeral_paid))],
            ['Projects contributed', money(num(b.project_paid))],
          ]}
        />
      </Card>

      {sections.length === 0 ? (
        <EmptyState icon={<FileText className="h-6 w-6" />} title="No transactions in this period" description="Widen the date range or pick another member." />
      ) : (
        <div className="space-y-4">
          {sections.map((s) => (
            <Card key={s.key} padded={false}>
              <div className="p-4">
                <CardHeader
                  title={s.title}
                  subtitle={`${s.rows.length} entr${s.rows.length === 1 ? 'y' : 'ies'}${s.total_credit ? ` · ${money(s.total_credit)} received` : ''}${s.total_debit ? ` · ${money(s.total_debit)} paid out` : ''}`}
                />
              </div>
              <Table compact>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Reference</Th>
                    <Th align="right">Debit</Th>
                    <Th align="right">Credit</Th>
                    <Th align="right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r, i) => (
                    <tr key={`${s.key}-${i}`}>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{r.date ? fmtDate(r.date) : '—'}</Td>
                      <Td className="text-sm text-navy-900">{r.description}</Td>
                      <Td className="whitespace-nowrap font-mono text-[11px] text-slate-500">{r.reference || '—'}</Td>
                      <Td align="right" className={r.debit ? 'text-red-600' : 'text-slate-300'}>{r.debit ? money(r.debit) : '—'}</Td>
                      <Td align="right" className={r.credit ? 'font-semibold text-emerald-700' : 'text-slate-300'}>{r.credit ? money(r.credit) : '—'}</Td>
                      <Td align="right" className="text-slate-600">{money(r.balance)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Statements are generated from the live ledger and can be exported as PDF or Excel for the member, the parish auditor or the
        diocesan review. Amounts shown in KSh (Kenya Shillings).
      </p>
    </div>
  );
}
