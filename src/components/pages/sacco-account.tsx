import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Wallet, PieChart, Landmark, ArrowLeft, Coins, FileText } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, KeyValue, ProgressBar, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { getShareSettings } from '@/lib/settings';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { PostSavingsForm, OpenAccountButton } from '../forms/sacco-forms';

const TYPE_TONES: Record<string, string> = {
  deposit: 'badge badge-green',
  withdrawal: 'badge badge-red',
  interest: 'badge badge-blue',
  dividend: 'badge badge-gold',
  transfer_in: 'badge badge-blue',
  transfer_out: 'badge badge-red',
  adjustment: 'badge badge-grey',
  penalty: 'badge badge-red',
};

export default async function SaccoAccountPage({ id, user }: { id: number; user: SessionUser }) {
  const account = await one<any>(
    `SELECT a.*, m.full_name, m.membership_no, m.phone, m.email, m.id AS member_id,
            p.name AS parish_name, s.name AS scc_name
       FROM sacco_accounts a
       JOIN members m ON m.id = a.member_id
       LEFT JOIN parishes p ON p.id = a.parish_id
       LEFT JOIN small_christian_communities s ON s.id = m.scc_id
      WHERE a.id = $1`,
    [id],
  );
  if (!account) notFound();

  const isOwn = user.member_id === Number(account.member_id);
  if (!isOwn) {
    // A member may only ever open their OWN account — never another member's.
    if (isMember(user)) redirect('/dashboard');
    if (!can(user, 'sacco.view') && !can(user, 'savings.view')) redirect('/sacco');
  }

  const shareSettings = await getShareSettings();
  const [savings, shares, dividends, loans, guarantees] = await Promise.all([
    query<any>(
      `SELECT * FROM savings WHERE sacco_account_id = $1 AND reversed = FALSE ORDER BY transaction_date DESC, id DESC LIMIT 100`,
      [id],
    ),
    query<any>(`SELECT * FROM shares WHERE sacco_account_id = $1 ORDER BY issued_date DESC`, [id]),
    query<any>(
      `SELECT da.*, d.financial_year, d.status AS batch_status FROM dividend_allocations da
         JOIN dividends d ON d.id = da.dividend_id WHERE da.member_id = $1 ORDER BY d.financial_year DESC`,
      [account.member_id],
    ),
    query<any>(
      `SELECT l.id, l.loan_no, l.principal, l.outstanding_balance, l.status, l.next_due_date, lt.name AS loan_type
         FROM loans l JOIN loan_types lt ON lt.id = l.loan_type_id
        WHERE l.member_id = $1 ORDER BY l.id DESC`,
      [account.member_id],
    ),
    query<any>(
      `SELECT g.amount_guaranteed, g.status, l.loan_no, m.full_name AS borrower
         FROM loan_guarantors g
         JOIN loan_applications a ON a.id = g.loan_application_id
         LEFT JOIN loans l ON l.id = a.loan_id
         LEFT JOIN members m ON m.id = a.member_id
        WHERE g.guarantor_member_id = $1 AND g.status IN ('pending','accepted') ORDER BY g.id DESC`,
      [account.member_id],
    ),
  ]);

  const savingsBalance = num(account.savings_balance);
  const shareCapital = num(account.share_capital);
  const guaranteed = guarantees.reduce((a: number, g: any) => a + num(g.amount_guaranteed), 0);
  const loanOutstanding = num(account.loan_outstanding);
  // a common SDP rule: borrow up to 3x savings, less what is already guaranteed
  const borrowingPower = Math.max(0, savingsBalance * 3 - loanOutstanding - guaranteed);

  return (
    <div className="space-y-5">
      <SectionHeading
        title={`SDP account ${account.account_no}`}
        subtitle={`${account.full_name} · ${account.membership_no}${account.scc_name ? ` · SCC ${account.scc_name}` : ''}${account.parish_name ? ` · ${account.parish_name}` : ''}`}
        action={
          <>
            <Link href="/sacco" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> SDP overview</Link>
            <Link href={`/members/${account.member_id}?tab=sacco`} className="btn btn-outline btn-sm">Member profile</Link>
            <Link href={`/api/documents/statement?member_id=${account.member_id}`} className="btn btn-primary btn-sm" target="_blank">
              <FileText className="h-4 w-4" /> Statement PDF
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Savings balance" value={money(savingsBalance)} tone="green" icon={<Wallet className="h-4 w-4" />} sub={`${money(num(account.total_deposits))} in · ${money(num(account.total_withdrawals))} out`} />
        <StatCard label="Share capital" value={money(shareCapital)} tone="gold" icon={<PieChart className="h-4 w-4" />} sub={`${account.shares_count || 0} shares @ ${money(shareSettings.value_per_share)}`} />
        <StatCard label="Loan outstanding" value={money(loanOutstanding)} tone={loanOutstanding > 0 ? 'red' : 'slate'} icon={<Landmark className="h-4 w-4" />} sub={`${loans.length} loan(s) on record`} />
        <StatCard label="Guaranteed for others" value={money(guaranteed)} tone="navy" icon={<Coins className="h-4 w-4" />} sub={`${guarantees.length} active guarantee(s)`} />
      </div>

      <Card>
        <CardHeader
          title="Account status"
          subtitle={`Opened ${fmtDate(account.opened_at)}${account.closed_at ? ` · closed ${fmtDate(account.closed_at)}` : ''}`}
          action={<Badge tone={account.status === 'active' ? 'badge badge-green' : 'badge badge-grey'}>{account.status}</Badge>}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <ProgressBar value={savingsBalance} total={Math.max(savingsBalance, num(account.min_monthly_savings) * 12)} label="Savings against a 12-month target" />
            <p className="mt-2 text-xs text-slate-500">
              Minimum monthly saving {money(num(account.min_monthly_savings))}. Estimated borrowing power (3× savings less commitments):{' '}
              <strong className="text-navy-900">{money(borrowingPower)}</strong>
            </p>
          </div>
          <KeyValue
            columns={2}
            items={[
              ['Account type', account.account_type || 'savings'],
              ['Phone', account.phone || '—'],
              ['Email', account.email || '—'],
              ['Total deposits', money(num(account.total_deposits))],
              ['Total withdrawals', money(num(account.total_withdrawals))],
              ['Last activity', savings[0] ? fmtDate(savings[0].transaction_date) : '—'],
            ]}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {can(user, 'savings.create') ? (
          <Card className="lg:col-span-1">
            <CardHeader title="Post to this account" subtitle="Deposit or withdraw against this member's savings." />
            <PostSavingsForm
              members={[{ value: Number(account.member_id), label: `${account.full_name} — ${account.account_no}` }]}
              defaultMemberId={Number(account.member_id)}
              minMonthly={num(account.min_monthly_savings)}
            />
          </Card>
        ) : null}

        <Card className={can(user, 'savings.create') ? 'lg:col-span-2' : 'lg:col-span-3'} padded={false}>
          <div className="p-4">
            <CardHeader title="Savings ledger" subtitle={`${savings.length} entr${savings.length === 1 ? 'y' : 'ies'} (latest first)`} action={<Link href={`/sacco/savings?account_id=${account.id}`} className="btn btn-ghost btn-sm">Full register</Link>} />
          </div>
          {savings.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<Wallet className="h-6 w-6" />} title="No savings entries" description="Post the first deposit to this account." /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance</Th>
                  <Th>Recorded by</Th>
                </tr>
              </thead>
              <tbody>
                {savings.map((s: any) => (
                  <tr key={s.id}>
                    <Td className="whitespace-nowrap text-xs text-slate-600"><span title={fmtDateTime(s.transaction_date)}>{fmtDate(s.transaction_date)}</span></Td>
                    <Td><Badge tone={TYPE_TONES[s.transaction_type] || 'badge badge-grey'}>{String(s.transaction_type).replace(/_/g, ' ')}</Badge></Td>
                    <Td className="text-xs text-slate-600">{s.payment_method || '—'}</Td>
                    <Td className="max-w-[9rem] truncate font-mono text-[11px] text-slate-500">{s.reference || s.receipt_no || '—'}</Td>
                    <Td align="right" className={s.transaction_type === 'withdrawal' ? 'font-semibold text-red-600' : 'font-semibold text-emerald-700'}>
                      {['withdrawal', 'transfer_out', 'penalty'].includes(s.transaction_type) ? '−' : ''}{money(num(s.amount))}
                    </Td>
                    <Td align="right" className="text-slate-600">{money(num(s.running_balance))}</Td>
                    <Td className="text-xs text-slate-500">{s.period || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false}>
          <div className="p-4"><CardHeader title="Share certificates" subtitle={`${shares.length} certificate(s)`} /></div>
          {shares.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<PieChart className="h-6 w-6" />} title="No shares" description="This member has not bought shares yet. Issue shares from the Share capital page." /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Certificate</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">Value</Th>
                  <Th>Issued</Th>
                  <Th align="right">PDF</Th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s: any) => (
                  <tr key={s.id}>
                    <Td className="font-mono text-xs">{s.certificate_no}</Td>
                    <Td align="right" className="font-semibold">{s.shares_count}</Td>
                    <Td align="right">{money(num(s.total_value))}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(s.issued_date)}</Td>
                    <Td align="right">
                      <Link href={`/api/documents/share-certificate?id=${s.id}`} className="btn btn-ghost btn-sm" target="_blank"><FileText className="h-3.5 w-3.5" /></Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-4"><CardHeader title="Dividends" subtitle={`${dividends.length} batch(es)`} /></div>
          {dividends.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<Coins className="h-6 w-6" />} title="No dividends" description="Dividends appear here once declared." /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Year</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {dividends.map((d: any) => (
                  <tr key={d.id}>
                    <Td className="font-semibold text-navy-900">{d.financial_year}</Td>
                    <Td align="right">{d.shares_held}</Td>
                    <Td align="right" className="font-semibold text-emerald-700">{money(num(d.amount))}</Td>
                    <Td><Badge tone={d.status === 'credited' ? 'badge badge-green' : 'badge badge-gold'}>{d.status}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-4"><CardHeader title="Loans against this account" subtitle={`${loans.length} loan(s)`} action={can(user, 'loans.view') ? <Link href="/loans" className="btn btn-ghost btn-sm">Loan book</Link> : undefined} /></div>
          {loans.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<Landmark className="h-6 w-6" />} title="No loans" description={borrowingPower > 0 ? `This member could borrow up to ${money(borrowingPower)}.` : 'No borrowing power yet — savings build it.'} /></div>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Loan</Th>
                  <Th>Type</Th>
                  <Th align="right">Principal</Th>
                  <Th align="right">Outstanding</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l: any) => (
                  <tr key={l.id}>
                    <Td>
                      {can(user, 'loans.view') ? (
                        <Link className="font-mono text-xs text-navy-800 hover:text-gold-700" href={`/loans/${l.id}`}>{l.loan_no}</Link>
                      ) : (
                        <span className="font-mono text-xs">{l.loan_no}</span>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-600">{l.loan_type}</Td>
                    <Td align="right">{money(num(l.principal))}</Td>
                    <Td align="right" className="font-semibold">{money(num(l.outstanding_balance))}</Td>
                    <Td><Badge tone={l.status === 'active' ? 'badge badge-blue' : l.status === 'defaulted' ? 'badge badge-red' : 'badge badge-grey'}>{l.status}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {account.status !== 'active' && can(user, 'sacco.create') ? (
        <Card>
          <CardHeader title="Account not active" subtitle="Re-open or re-create the SDP account for this member." />
          <OpenAccountButton memberId={Number(account.member_id)} memberName={account.full_name} />
        </Card>
      ) : null}
    </div>
  );
}
