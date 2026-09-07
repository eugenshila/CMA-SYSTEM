import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Stamp, Users, Clock, CheckCircle2, XCircle, Banknote, FileText, ShieldCheck } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput, SelectFilter } from '../ui/client';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { money, num } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { LOAN_WORKFLOW } from '@/lib/loans';
import { ApplicationReviewForm, DisburseLoanForm } from '../forms/loan-forms';

const PER_PAGE = 20;

const APP_TONES: Record<string, string> = {
  draft: 'badge badge-grey',
  submitted: 'badge badge-blue',
  under_review: 'badge badge-blue',
  guarantor_pending: 'badge badge-gold',
  committee_review: 'badge badge-gold',
  approved: 'badge badge-green',
  rejected: 'badge badge-red',
  disbursed: 'badge badge-green',
  cancelled: 'badge badge-grey',
  withdrawn: 'badge badge-grey',
  completed: 'badge badge-green',
};

const PENDING = ['submitted', 'under_review', 'guarantor_pending', 'committee_review', 'approved'];

const STATUS_OPTIONS = Object.entries(LOAN_WORKFLOW).map(([value, v]) => ({ value, label: v.label }));

export default async function LoanApprovalsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  // Members do not review applications — they track their own on /loans.
  if (isMember(user) || !can(user, 'loan_approvals.view')) redirect('/loans');

  const canApprove = can(user, 'loan_approvals.approve') || can(user, 'loans.approve');
  const canDisburse = can(user, 'loans.approve') || can(user, 'payments.create');

  const search = String(sp.search || sp.q || '').trim();
  const status = String(sp.status || '');
  const view = String(sp.view || 'pending'); // pending | all
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const params: any[] = [];
  const where: string[] = ['1=1'];
  if (user.scope_parish_id) {
    params.push(Number(user.scope_parish_id));
    where.push(`a.parish_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  } else if (view === 'pending') {
    where.push(`a.status IN ('${PENDING.join("','")}')`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length} OR a.application_no ILIKE $${params.length})`);
  }
  const whereSql = where.join(' AND ');

  const [applications, countRow, stats] = await Promise.all([
    query<any>(
      `SELECT a.*, m.full_name, m.membership_no, m.id AS member_id, lt.name AS loan_type,
              (SELECT count(*)::int FROM loan_guarantors g WHERE g.loan_application_id = a.id) AS g_total,
              (SELECT count(*)::int FROM loan_guarantors g WHERE g.loan_application_id = a.id AND g.status = 'accepted') AS g_accepted
         FROM loan_applications a
         JOIN members m ON m.id = a.member_id
         JOIN loan_types lt ON lt.id = a.loan_type_id
        WHERE ${whereSql}
        ORDER BY a.status = 'approved' DESC, a.applied_at ASC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(`SELECT count(*)::int AS total FROM loan_applications a JOIN members m ON m.id = a.member_id WHERE ${whereSql}`, params),
    one<any>(
      `SELECT count(*) FILTER (WHERE status IN ('${PENDING.join("','")}'))::int AS pending,
              count(*) FILTER (WHERE status = 'approved')::int AS approved,
              count(*) FILTER (WHERE status = 'guarantor_pending')::int AS awaiting_guarantors,
              count(*) FILTER (WHERE status = 'committee_review')::int AS in_committee,
              count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              COALESCE(SUM(amount_requested) FILTER (WHERE status IN ('${PENDING.join("','")}')),0) AS requested
         FROM loan_applications a WHERE 1=1 ${user.scope_parish_id ? `AND a.parish_id = ${Number(user.scope_parish_id)}` : ''}`,
    ),
  ]);

  const total = Number(countRow?.total || 0);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Loan approvals"
        subtitle="Review applications, confirm guarantors, approve or decline, and disburse approved loans."
        action={
          <>
            <Link href="/loans" className="btn btn-outline btn-sm"><Banknote className="h-4 w-4" /> Loan book</Link>
            <Link href="/loans/guarantor-requests" className="btn btn-outline btn-sm"><ShieldCheck className="h-4 w-4" /> Guarantor requests</Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting review" value={String(stats?.pending || 0)} tone="blue" icon={<Clock className="h-4 w-4" />} sub={`${money(num(stats?.requested))} requested`} />
        <StatCard label="Awaiting guarantors" value={String(stats?.awaiting_guarantors || 0)} tone="gold" icon={<Users className="h-4 w-4" />} sub={`${stats?.in_committee || 0} in committee`} />
        <StatCard label="Approved (to disburse)" value={String(stats?.approved || 0)} tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Rejected" value={String(stats?.rejected || 0)} tone="red" icon={<XCircle className="h-4 w-4" />} />
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader title={view === 'pending' ? 'Applications in the pipeline' : 'All applications'} subtitle={`${total} application${total === 1 ? '' : 's'}`} icon={<Stamp className="h-[18px] w-[18px]" />} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SearchInput param="search" placeholder="Search member or application no…" extraParams={{ view }} />
            <SelectFilter param="status" placeholder={view === 'pending' ? 'Pipeline statuses' : 'All statuses'} options={STATUS_OPTIONS} />
            <SelectFilter param="view" placeholder="View" options={[{ value: 'pending', label: 'In pipeline' }, { value: 'all', label: 'All applications' }]} />
          </div>
        </div>

        {applications.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing to review" description="No applications match this view. New applications will appear here for review." />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Application</Th>
                <Th>Member</Th>
                <Th>Product</Th>
                <Th align="right">Requested</Th>
                <Th align="right">Monthly</Th>
                <Th>Guarantors</Th>
                <Th>Applied</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a: any) => {
                const allowed = (LOAN_WORKFLOW[a.status]?.next || []).map((s: string) => ({ value: s, label: LOAN_WORKFLOW[s]?.label || s }));
                const gReady = Number(a.g_total) > 0 && Number(a.g_accepted) >= Number(a.g_total);
                return (
                  <tr key={a.id}>
                    <Td>
                      <Link className="font-mono text-xs font-semibold text-navy-800 hover:text-gold-700" href={`/loans/applications/${a.id}`}>{a.application_no}</Link>
                    </Td>
                    <Td>
                      <Link className="text-sm text-slate-700 hover:text-navy-800" href={`/members/${a.member_id}`}>{a.full_name}</Link>
                      <span className="block text-[11px] text-slate-400">{a.membership_no}</span>
                    </Td>
                    <Td className="text-xs text-slate-600">{a.loan_type}</Td>
                    <Td align="right" className="font-medium">{money(num(a.amount_requested))}</Td>
                    <Td align="right" className="text-slate-600">{money(num(a.monthly_repayment))}</Td>
                    <Td>
                      <span className={`badge ${gReady ? 'badge-green' : Number(a.g_accepted) > 0 ? 'badge-gold' : 'badge-grey'}`}>
                        {a.g_accepted}/{a.g_total} accepted
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(a.applied_at)}</Td>
                    <Td><Badge tone={APP_TONES[a.status] || 'badge badge-grey'}>{String(a.status).replace(/_/g, ' ')}</Badge></Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        {a.status === 'approved' && canDisburse ? (
                          <DisburseLoanForm applicationId={Number(a.id)} approvedAmount={num(a.approved_amount || a.amount_requested)} />
                        ) : null}
                        {canApprove && allowed.length > 0 ? (
                          <ApplicationReviewForm
                            applicationId={Number(a.id)}
                            currentStatus={a.status}
                            allowed={allowed}
                            requestedAmount={num(a.amount_requested)}
                            canApprove={canApprove}
                          />
                        ) : null}
                        <Link href={`/loans/applications/${a.id}`} className="btn btn-ghost btn-sm" title="Open application"><FileText className="h-3.5 w-3.5" /></Link>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="px-4 pb-4">
          <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/loans/approvals" query={{ search, status, view }} />
        </div>
      </Card>
    </div>
  );
}
