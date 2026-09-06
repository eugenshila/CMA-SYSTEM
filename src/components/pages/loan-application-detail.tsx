import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, FileText, Users, CheckCircle2, XCircle, Banknote, Paperclip, ShieldCheck } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, KeyValue, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { LOAN_WORKFLOW } from '@/lib/loans';
import { ApplicationReviewForm, DisburseLoanForm, AddGuarantorsForm } from '../forms/loan-forms';

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

const G_TONES: Record<string, string> = {
  pending: 'badge badge-gold',
  accepted: 'badge badge-green',
  rejected: 'badge badge-red',
  released: 'badge badge-grey',
  revoked: 'badge badge-grey',
};

export default async function LoanApplicationDetailPage({ id, user }: { id: number; user: SessionUser }) {
  const app = await one<any>(
    `SELECT a.*, m.full_name, m.membership_no, m.phone, m.id AS member_id,
            lt.name AS loan_type, lt.code AS loan_code, lt.guarantors_required
       FROM loan_applications a
       JOIN members m ON m.id = a.member_id
       JOIN loan_types lt ON lt.id = a.loan_type_id
      WHERE a.id = $1`,
    [id],
  );
  if (!app) notFound();

  const isOwn = user.member_id === Number(app.member_id);
  if (!isOwn) {
    if (isMember(user)) redirect('/loans');
    if (!can(user, 'loan_approvals.view') && !can(user, 'loans.view')) redirect('/loans');
  }

  const canApprove = !isOwn && (can(user, 'loan_approvals.approve') || can(user, 'loans.approve'));
  const canDisburse = can(user, 'loans.approve') || can(user, 'payments.create');
  const canEditGuarantors = isOwn || can(user, 'loans.update');

  const [guarantors, documents, memberOptions] = await Promise.all([
    query<any>(
      `SELECT g.*, gm.full_name AS guarantor_name, gm.membership_no AS guarantor_no, gm.id AS guarantor_member_id
         FROM loan_guarantors g JOIN members gm ON gm.id = g.guarantor_member_id
        WHERE g.loan_application_id = $1 ORDER BY g.status = 'pending' DESC, g.id`,
      [id],
    ),
    query<any>(
      `SELECT id, title, file_name, mime_type, size_bytes, created_at FROM documents
        WHERE entity_type = 'loan_application' AND entity_id = $1 ORDER BY id`,
      [id],
    ),
    canEditGuarantors
      ? query<any>(
          `SELECT m.id, m.full_name, m.membership_no FROM members m
            WHERE m.deleted_at IS NULL AND m.membership_status = 'active' AND m.id <> $1 ORDER BY m.full_name`,
          [app.member_id],
        )
      : Promise.resolve([] as any[]),
  ]);

  let eligibility: any = null;
  try {
    eligibility = app.eligibility_json ? JSON.parse(app.eligibility_json) : null;
  } catch {
    eligibility = null;
  }

  const allNext = LOAN_WORKFLOW[app.status]?.next || [];
  const allowedForUser = isOwn
    ? allNext.filter((s) => ['withdrawn', 'cancelled'].includes(s))
    : allNext;
  const allowed = allowedForUser.map((s) => ({ value: s, label: LOAN_WORKFLOW[s]?.label || s }));
  const gAccepted = guarantors.filter((g: any) => g.status === 'accepted').length;
  const gReady = guarantors.length > 0 && gAccepted >= guarantors.length;

  return (
    <div className="space-y-5">
      <SectionHeading
        title={`Application ${app.application_no}`}
        subtitle={`${app.loan_type} · ${app.full_name} (${app.membership_no}) · applied ${fmtDate(app.applied_at)}`}
        action={
          <>
            <Link href={isOwn ? '/loans' : '/loans/approvals'} className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> {isOwn ? 'My loans' : 'Approvals'}</Link>
            {app.loan_id ? <Link href={`/loans/${app.loan_id}`} className="btn btn-primary btn-sm"><Banknote className="h-4 w-4" /> View disbursed loan</Link> : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Amount requested" value={money(num(app.amount_requested))} tone="navy" icon={<Banknote className="h-4 w-4" />} sub={`${app.repayment_months} month(s)`} />
        <StatCard label="Monthly repayment" value={money(num(app.monthly_repayment))} tone="blue" icon={<FileText className="h-4 w-4" />} sub={`Total ${money(num(app.total_repayable))}`} />
        <StatCard label={app.approved_amount ? 'Approved amount' : 'Status'} value={app.approved_amount ? money(num(app.approved_amount)) : String(app.status).replace(/_/g, ' ')} tone={app.status === 'rejected' ? 'red' : app.status === 'approved' || app.status === 'disbursed' ? 'green' : 'gold'} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Guarantors" value={`${gAccepted}/${guarantors.length}`} tone={gReady ? 'green' : 'gold'} icon={<Users className="h-4 w-4" />} sub={`${app.guarantors_required} required`} />
      </div>

      <Card>
        <CardHeader
          title="Application details"
          subtitle={`Current status: ${LOAN_WORKFLOW[app.status]?.label || app.status}`}
          action={<Badge tone={APP_TONES[app.status] || 'badge badge-grey'}>{String(app.status).replace(/_/g, ' ')}</Badge>}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <KeyValue
            columns={1}
            items={[
              ['Purpose', app.purpose || '—'],
              ['Interest rate', `${num(app.interest_rate)}% ${app.interest_method}`],
              ['Processing fee', money(num(app.processing_fee))],
              ['Total interest', money(num(app.total_interest))],
              ['Savings at application', money(num(app.savings_balance))],
              ['Shares at application', `${app.shares_count || 0} (${money(num(app.shares_value))})`],
              ['Outstanding loans at application', money(num(app.outstanding_loans))],
            ]}
          />
          <KeyValue
            columns={1}
            items={[
              ['Applied', fmtDateTime(app.applied_at)],
              ['Reviewed by', app.reviewed_by ? `#${app.reviewed_by} · ${app.reviewed_at ? fmtDate(app.reviewed_at) : ''}` : '—'],
              ['Approved', app.approved_at ? fmtDate(app.approved_at) : '—'],
              ['Disbursement date', app.disbursement_date ? fmtDate(app.disbursement_date) : '—'],
              ['Disbursement method', app.disbursement_method || '—'],
              ['Rejection reason', app.rejection_reason || '—'],
              ['Review notes', app.review_notes || '—'],
            ]}
          />
        </div>
        {allowed.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {canApprove ? (
              <ApplicationReviewForm applicationId={Number(app.id)} currentStatus={app.status} allowed={allowed} requestedAmount={num(app.amount_requested)} canApprove={canApprove} />
            ) : null}
            {isOwn && allowedForUser.length > 0 ? (
              <ApplicationReviewForm applicationId={Number(app.id)} currentStatus={app.status} allowed={allowed} requestedAmount={num(app.amount_requested)} canApprove buttonLabel="Withdraw application" />
            ) : null}
            {app.status === 'approved' && canDisburse && !app.loan_id ? (
              <DisburseLoanForm applicationId={Number(app.id)} approvedAmount={num(app.approved_amount || app.amount_requested)} />
            ) : null}
            {canEditGuarantors && !['rejected', 'withdrawn', 'cancelled', 'disbursed', 'completed'].includes(app.status) ? (
              <AddGuarantorsForm applicationId={Number(app.id)} currentIds={guarantors.map((g: any) => Number(g.guarantor_member_id))} guarantorOptions={memberOptions.map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.membership_no}` }))} />
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-4"><CardHeader title="Guarantors" subtitle={`${gAccepted} of ${guarantors.length} accepted${app.guarantors_required ? ` · ${app.guarantors_required} required` : ''}`} icon={<ShieldCheck className="h-[18px] w-[18px]" />} /></div>
          {guarantors.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState icon={<Users className="h-6 w-6" />} title="No guarantors" description={canEditGuarantors ? 'Add guarantors — they must each accept before approval.' : 'This application has no guarantors.'} /></div>
          ) : (
            <Table compact>
              <thead>
                <tr><Th>Guarantor</Th><Th>Relationship</Th><Th align="right">Amount</Th><Th align="right">Share</Th><Th>Status</Th><Th>Responded</Th></tr>
              </thead>
              <tbody>
                {guarantors.map((g: any) => (
                  <tr key={g.id}>
                    <Td>
                      <Link className="text-sm text-slate-700 hover:text-navy-800" href={`/members/${g.guarantor_member_id}`}>{g.guarantor_name}</Link>
                      <span className="block text-[11px] text-slate-400">{g.guarantor_no}</span>
                    </Td>
                    <Td className="text-xs text-slate-600">{g.relationship || '—'}</Td>
                    <Td align="right" className="text-xs font-medium">{money(num(g.amount_guaranteed))}</Td>
                    <Td align="right" className="text-xs text-slate-600">{num(g.guarantor_share_pct).toFixed(1)}%</Td>
                    <Td><Badge tone={G_TONES[g.status] || 'badge badge-grey'}>{g.status}</Badge></Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{g.responded_at ? fmtDate(g.responded_at) : <span className="text-amber-700">pending</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card padded={false}>
            <div className="p-4"><CardHeader title="Eligibility assessment" subtitle={eligibility ? (app.eligibility_passed ? 'Passed all checks at application time' : 'One or more checks did not pass') : 'No eligibility snapshot recorded'} icon={<CheckCircle2 className="h-[18px] w-[18px]" />} /></div>
            {eligibility?.checks?.length ? (
              <ul className="divide-y divide-slate-100 px-4 pb-4">
                {eligibility.checks.map((c: any, i: number) => (
                  <li key={i} className="flex items-start gap-2 py-2">
                    {c.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700">{c.label}</p>
                      <p className="text-[11px] text-slate-400">{c.detail}</p>
                    </div>
                  </li>
                ))}
                {eligibility.maxAmount ? (
                  <li className="py-2 text-xs text-slate-500">Maximum eligible amount: <strong className="text-navy-900">{money(num(eligibility.maxAmount))}</strong></li>
                ) : null}
              </ul>
            ) : (
              <div className="p-4 pt-0"><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No checks recorded" description="Eligibility is assessed automatically when the application is submitted." /></div>
            )}
          </Card>

          {documents.length > 0 ? (
            <Card padded={false}>
              <div className="p-4"><CardHeader title="Supporting documents" subtitle={`${documents.length} file(s)`} icon={<Paperclip className="h-[18px] w-[18px]" />} /></div>
              <ul className="divide-y divide-slate-100 px-4 pb-4">
                {documents.map((d: any) => (
                  <li key={d.id} className="flex items-center gap-2 py-2">
                    <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-700">{d.title || d.file_name}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(d.created_at)}{d.size_bytes ? ` · ${(Number(d.size_bytes) / 1024).toFixed(0)} KB` : ''}</p>
                    </div>
                    <Link href={`/api/documents/file?id=${d.id}`} className="btn btn-ghost btn-sm" target="_blank">Open</Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
