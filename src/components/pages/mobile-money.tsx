import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Smartphone, Wallet, CheckCheck, AlertTriangle, Link2, RefreshCw } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, KeyValue, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { getPaymentSettings } from '@/lib/settings';
import { ALLOCATION_LABELS, type AllocationType } from '@/lib/payments';
import { money, num } from '@/lib/money';
import { fmtDateTime, relativeTime } from '@/lib/dates';
import { StkPushForm, SimulateStkButton, ReconcileMpesaButton } from '../forms/payment-forms';

export default async function MobileMoneyPage({ user }: { user: SessionUser }) {
  if (!can(user, 'payments.view')) redirect('/dashboard');

  const settings = await getPaymentSettings();
  const scope = user.scope_parish_id ? Number(user.scope_parish_id) : null;

  const [members, transactions, stats] = await Promise.all([
    query<any>(
      `SELECT m.id, m.full_name, m.membership_no, m.phone
         FROM members m
        WHERE m.deleted_at IS NULL AND m.membership_status = 'active' ${scope ? `AND m.parish_id = ${scope}` : ''}
        ORDER BY m.full_name`,
    ),
    query<any>(
      `SELECT t.*, m.full_name, m.membership_no
         FROM mpesa_transactions t LEFT JOIN members m ON m.id = t.member_id
        ORDER BY t.created_at DESC LIMIT 50`,
    ),
    one<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              COALESCE(SUM(amount) FILTER (WHERE status = 'completed'),0) AS collected,
              COALESCE(SUM(amount) FILTER (WHERE status = 'completed' AND payment_id IS NULL),0) AS unreconciled
         FROM mpesa_transactions`,
    ),
  ]);

  const canPush = can(user, 'payments.create');
  const canReconcile = can(user, 'payments.update');
  const mpesa = settings.mpesa;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Mobile money"
        subtitle="M-Pesa Daraja STK push, Airtel Money and manual mobile-money entries with automatic reconciliation."
        action={
          <>
            <Link href="/payments" className="btn btn-outline btn-sm"><Wallet className="h-4 w-4" /> All payments</Link>
            <Link href="/settings" className="btn btn-outline btn-sm"><RefreshCw className="h-4 w-4" /> Gateway settings</Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="STK requests" value={String(stats?.total || 0)} tone="navy" icon={<Smartphone className="h-4 w-4" />} sub={`${stats?.completed || 0} completed · ${stats?.failed || 0} failed`} />
        <StatCard label="Awaiting member action" value={String(stats?.pending || 0)} tone="gold" icon={<AlertTriangle className="h-4 w-4" />} sub="Prompts sent, not yet paid" />
        <StatCard label="Collected via mobile money" value={money(num(stats?.collected))} tone="green" icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="To reconcile" value={money(num(stats?.unreconciled))} tone={num(stats?.unreconciled) > 0 ? 'red' : 'slate'} icon={<Link2 className="h-4 w-4" />} sub="Matched to a member below" />
      </div>

      <Card className={mpesa.enabled ? '' : 'border-amber-200 bg-amber-50/40'}>
        <CardHeader
          title="Daraja (M-Pesa) status"
          subtitle={mpesa.enabled ? `Live configuration — mode: ${mpesa.mode}` : 'Not configured yet — requests are queued in simulation mode.'}
          icon={<Smartphone className="h-4 w-4" />}
          action={
            mpesa.enabled ? <Badge tone="badge badge-green">Enabled</Badge> : <Badge tone="badge badge-gold">Simulation</Badge>
          }
        />
        <KeyValue
          columns={3}
          items={[
            ['Mode', mpesa.mode],
            ['Short code / Paybill', mpesa.short_code || '—'],
            ['Consumer key', mpesa.consumer_key ? `${String(mpesa.consumer_key).slice(0, 6)}…` : '—'],
            ['Passkey', mpesa.passkey ? 'Configured' : '—'],
            ['Callback URL', mpesa.callback_url || `${process.env.APP_URL || ''}/api/mpesa/callback`],
            ['STK timeout', `${mpesa.stk_timeout_seconds}s`],
            ['Airtel Money', settings.airtel?.enabled ? 'Enabled' : 'Not configured'],
            ['Cash / bank entry', settings.cash?.enabled || settings.bank?.enabled ? 'Enabled' : 'Disabled'],
            ['Manual entry verification', settings.manual_entry?.requires_verification ? 'Required' : 'Not required'],
          ]}
        />
        {!mpesa.enabled ? (
          <p className="mt-4 rounded-lg bg-white p-3 text-sm text-amber-800">
            Add the Daraja consumer key, secret, short code and passkey under <Link className="underline" href="/settings">Settings → Payments</Link> to
            send real STK prompts. Until then every request is recorded so you can rehearse the full flow with the simulator below.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Send an STK push" subtitle="The member receives a prompt on their phone and the payment is reconciled automatically on success." />
          {canPush ? (
            <StkPushForm
              members={members.map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.membership_no}`, phone: m.phone }))}
              defaultMemberId={user.member_id}
              enabled={mpesa.enabled}
              mode={mpesa.mode}
            />
          ) : (
            <EmptyState icon={<Smartphone className="h-6 w-6" />} title="No permission" description="Only the treasurer, administrator or a member paying their own dues can send STK prompts." />
          )}
        </Card>

        <Card className="lg:col-span-2" padded={false}>
          <div className="p-4">
            <CardHeader
              title="Mobile money transactions"
              subtitle="Latest 50 requests and callbacks."
              action={<Badge tone="badge badge-navy"><CheckCheck className="mr-1 h-3.5 w-3.5" /> Auto-reconciliation on</Badge>}
            />
          </div>
          {transactions.length === 0 ? (
            <div className="p-4 pt-0">
              <EmptyState icon={<Smartphone className="h-6 w-6" />} title="No mobile money transactions yet" description="Send the first STK push to see it tracked here." />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Phone</Th>
                  <Th align="right">Amount</Th>
                  <Th>Allocated to</Th>
                  <Th>M-Pesa receipt</Th>
                  <Th>Status</Th>
                  <Th>Requested</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t: any) => (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <Td>
                      {t.member_id ? (
                        <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${t.member_id}`}>{t.full_name}</Link>
                      ) : (
                        <span className="text-slate-500">Unmatched</span>
                      )}
                      <div className="text-[11px] text-slate-500">{t.membership_no || t.checkout_request_id?.slice(0, 16)}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{t.phone_number || '—'}</Td>
                    <Td align="right" className="font-semibold">{money(num(t.amount))}</Td>
                    <Td className="text-xs text-slate-600">
                      {ALLOCATION_LABELS[t.allocation_type as AllocationType] || t.allocation_type || '—'}
                      {t.account_reference ? <div className="text-[11px] text-slate-400">ref {t.account_reference}</div> : null}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-xs">{t.mpesa_receipt_no || '—'}</Td>
                    <Td>
                      <Badge
                        tone={
                          t.status === 'completed' ? 'badge badge-green' : t.status === 'failed' ? 'badge badge-red' : t.status === 'pending' ? 'badge badge-gold' : 'badge badge-grey'
                        }
                      >
                        {t.status}
                      </Badge>
                      {t.result_desc ? <div className="mt-0.5 max-w-[10rem] truncate text-[11px] text-slate-500">{t.result_desc}</div> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500"><span title={fmtDateTime(t.created_at)}>{relativeTime(t.created_at)}</span></Td>
                    <Td align="right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {t.status === 'pending' && !mpesa.enabled ? (
                          <SimulateStkButton checkoutId={t.checkout_request_id} status={t.status} />
                        ) : null}
                        {t.status === 'completed' && !t.payment_id && canReconcile ? (
                          <ReconcileMpesaButton
                            transactionId={Number(t.id)}
                            amount={num(t.amount)}
                            defaultMemberId={t.member_id ? Number(t.member_id) : null}
                            members={members.map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.membership_no}` }))}
                          />
                        ) : null}
                        {t.payment_id ? (
                          <Link href={`/payments/${t.payment_id}`} className="btn btn-outline btn-sm">Payment</Link>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="How reconciliation works" subtitle="No manual bookkeeping needed once Daraja is configured." />
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
          <li>The STK prompt is sent and the request is stored with its <code className="rounded bg-slate-100 px-1">CheckoutRequestID</code>.</li>
          <li>Safaricom calls <code className="rounded bg-slate-100 px-1">/api/mpesa/callback</code>; the payload is verified and stored verbatim.</li>
          <li>On success a payment is recorded with the M-Pesa receipt number, allocated to the chosen destination and a PDF receipt is issued.</li>
          <li>Unmatched callbacks (member not identified) stay in the queue above until an officer reconciles them to a member.</li>
          <li>Every step writes to the audit trail, so the treasurer and auditor can trace any shilling end to end.</li>
        </ol>
      </Card>
    </div>
  );
}
