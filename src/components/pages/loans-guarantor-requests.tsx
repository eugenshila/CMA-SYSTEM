import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck, Users, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { money, num } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { RespondGuaranteeButtons } from '../forms/loan-forms';

const G_TONES: Record<string, string> = {
  pending: 'badge badge-gold',
  accepted: 'badge badge-green',
  rejected: 'badge badge-red',
  released: 'badge badge-grey',
  revoked: 'badge badge-grey',
};

export default async function GuarantorRequestsPage({ user }: { user: SessionUser }) {
  if (!can(user, 'guarantors.view') && !user.member_id) redirect('/dashboard');

  const ownOnly = isMember(user);
  const canRespond = can(user, 'guarantors.respond') || can(user, 'guarantors.update');

  // Members see requests where THEY are the guarantor; staff monitor the whole parish.
  const scopeSql = ownOnly
    ? `AND g.guarantor_member_id = ${Number(user.member_id)}`
    : user.scope_parish_id
      ? `AND a.parish_id = ${Number(user.scope_parish_id)}`
      : '';

  const [requests, exposure, pendingCount] = await Promise.all([
    query<any>(
      `SELECT g.*, a.application_no, a.status AS app_status, a.amount_requested,
              borrower.full_name AS borrower_name, borrower.membership_no AS borrower_no, borrower.id AS borrower_id,
              guar.full_name AS guarantor_name, guar.id AS guarantor_id
         FROM loan_guarantors g
         JOIN loan_applications a ON a.id = g.loan_application_id
         JOIN members borrower ON borrower.id = a.member_id
         JOIN members guar ON guar.id = g.guarantor_member_id
        WHERE 1=1 ${scopeSql}
        ORDER BY g.status = 'pending' DESC, g.requested_at DESC
        LIMIT 200`,
    ),
    ownOnly
      ? one<any>(
          `SELECT COALESCE(SUM(amount_guaranteed) FILTER (WHERE status IN ('pending','accepted')),0) AS total_exposure,
                  count(*) FILTER (WHERE status = 'accepted')::int AS active_guarantees
             FROM loan_guarantors WHERE guarantor_member_id = $1`,
          [user.member_id],
        )
      : one<any>(
          `SELECT count(*)::int AS pending FROM loan_guarantors g JOIN loan_applications a ON a.id=g.loan_application_id WHERE g.status='pending' ${scopeSql}`,
        ),
    ownOnly
      ? one<any>(`SELECT count(*)::int AS pending FROM loan_guarantors WHERE guarantor_member_id = $1 AND status = 'pending'`, [user.member_id])
      : Promise.resolve(null),
  ]);

  const pending = ownOnly ? Number(pendingCount?.pending || 0) : Number((exposure as any)?.pending || 0);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Guarantor requests"
        subtitle={
          ownOnly
            ? 'Loan applications where you have been asked to be a guarantor. Accept only if you understand the responsibility.'
            : 'Guarantee requests across the parish and their response status.'
        }
        action={<Link href="/loans" className="btn btn-outline btn-sm"><ShieldCheck className="h-4 w-4" /> Loans</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ownOnly ? (
          <>
            <StatCard label="Awaiting your response" value={String(pending)} tone={pending > 0 ? 'gold' : 'slate'} icon={<Clock className="h-4 w-4" />} />
            <StatCard label="Your guarantee exposure" value={money(num((exposure as any)?.total_exposure))} tone="navy" icon={<AlertTriangle className="h-4 w-4" />} sub={`${(exposure as any)?.active_guarantees || 0} active guarantee(s)`} />
            <StatCard label="Requests received" value={String(requests.length)} tone="slate" icon={<Users className="h-4 w-4" />} />
          </>
        ) : (
          <>
            <StatCard label="Pending responses" value={String(pending)} tone={pending > 0 ? 'gold' : 'slate'} icon={<Clock className="h-4 w-4" />} />
            <StatCard label="Requests shown" value={String(requests.length)} tone="navy" icon={<Users className="h-4 w-4" />} />
            <StatCard label="Accepted" value={String(requests.filter((r: any) => r.status === 'accepted').length)} tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
          </>
        )}
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader
            title={ownOnly ? 'Requests for you to action' : 'All guarantor requests'}
            subtitle="A guarantee means you commit to repay if the borrower defaults."
            icon={<ShieldCheck className="h-[18px] w-[18px]" />}
          />
        </div>
        {requests.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title={ownOnly ? 'No guarantor requests' : 'No requests yet'} description={ownOnly ? 'When a fellow member nominates you as a guarantor, the request appears here.' : 'Guarantee requests will appear here as members apply for loans.'} />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Application</Th>
                <Th>Borrower</Th>
                {!ownOnly ? <Th>Guarantor</Th> : null}
                <Th align="right">Amount guaranteed</Th>
                <Th>Relationship</Th>
                <Th>Requested</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((g: any) => {
                const isMine = Number(g.guarantor_id) === Number(user.member_id);
                return (
                  <tr key={g.id}>
                    <Td>
                      <Link className="font-mono text-xs font-semibold text-navy-800 hover:text-gold-700" href={`/loans/applications/${g.loan_application_id}`}>{g.application_no}</Link>
                    </Td>
                    <Td>
                      <Link className="text-sm text-slate-700 hover:text-navy-800" href={`/members/${g.borrower_id}`}>{g.borrower_name}</Link>
                      <span className="block text-[11px] text-slate-400">{g.borrower_no}</span>
                    </Td>
                    {!ownOnly ? <Td className="text-sm text-slate-600">{g.guarantor_name}</Td> : null}
                    <Td align="right" className="font-semibold text-navy-900">{money(num(g.amount_guaranteed))}</Td>
                    <Td className="text-xs text-slate-600">{g.relationship || '—'}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(g.requested_at)}</Td>
                    <Td><Badge tone={G_TONES[g.status] || 'badge badge-grey'}>{g.status}</Badge></Td>
                    <Td align="right">
                      {g.status === 'pending' && canRespond && (ownOnly || isMine) ? (
                        <RespondGuaranteeButtons guarantorId={Number(g.id)} />
                      ) : g.status === 'pending' ? (
                        <span className="text-[11px] text-slate-400">Awaiting guarantor</span>
                      ) : (
                        <span className="text-[11px] text-slate-400">{g.responded_at ? fmtDate(g.responded_at) : '—'}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
