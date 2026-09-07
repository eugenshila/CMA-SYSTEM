import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Users, CalendarClock, AlertTriangle, Wallet, Receipt, FileText, HeartPulse,
  Landmark, Banknote, TrendingUp, ClipboardCheck, History, Download, Table2, FileSpreadsheet, ExternalLink,
} from 'lucide-react';
import { Card, CardHeader, EmptyState, SectionHeading, StatCard, Badge } from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { canExport } from '@/server/services/export-service';
import { financialSummary } from '@/lib/reports';
import { money, num } from '@/lib/money';

interface ReportDef {
  key: string;
  title: string;
  desc: string;
  view?: string;
  icon: any;
  variants?: { label: string; q: string }[];
}

const REPORTS: ReportDef[] = [
  { key: 'members', title: 'Membership register', desc: 'All members with organisational hierarchy, status and balances.', view: '/members', icon: Users },
  { key: 'contributions', title: 'Contributions', desc: 'Monthly contributions by member and period, paid vs expected.', view: '/contributions', icon: CalendarClock },
  { key: 'outstanding', title: 'Outstanding & arrears', desc: 'Unpaid and part-paid contributions with outstanding balances.', view: '/contributions', icon: AlertTriangle },
  { key: 'payments', title: 'Payments journal', desc: 'Every payment with method, allocation and reconciliation status.', view: '/payments', icon: Wallet },
  { key: 'receipts', title: 'Receipts', desc: 'Issued receipts with amounts and references.', view: '/receipts', icon: Receipt },
  { key: 'statement', title: 'Member statement', desc: 'A member\u2019s full financial statement (your own, for members).', view: '/statements', icon: FileText },
  {
    key: 'cases', title: 'Welfare, funeral & projects', desc: 'Case registers and special-project contributions.', view: '/welfare', icon: HeartPulse,
    variants: [
      { label: 'Welfare', q: 'type=welfare' },
      { label: 'Funeral', q: 'type=funeral' },
      { label: 'Projects', q: 'type=project' },
    ],
  },
  { key: 'sacco', title: 'SDP / Sacco', desc: 'Savings balances, share capital and account registers.', view: '/sacco', icon: Landmark },
  { key: 'loans', title: 'Loan portfolio', desc: 'Loans, outstanding balances, arrears and guarantor exposure.', view: '/loans', icon: Banknote },
  { key: 'financial', title: 'Financial summary', desc: 'Income, outflow and fund balances across the parish.', view: '/dashboard', icon: TrendingUp },
  { key: 'attendance', title: 'Attendance', desc: 'Meeting attendance rates by member.', view: '/attendance', icon: ClipboardCheck },
  { key: 'audit', title: 'Audit trail', desc: 'System audit log of financial and administrative actions.', view: '/admin/audit', icon: History },
];

function ExportLinks({ report, q = '' }: { report: string; q?: string }) {
  const base = `/api/exports/${report}?`;
  const sep = q ? `${q}&` : '';
  return (
    <div className="flex flex-wrap gap-1.5">
      <a className="btn btn-primary btn-sm" href={`${base}${sep}format=excel`}><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</a>
      <a className="btn btn-outline btn-sm" href={`${base}${sep}format=csv`}><Table2 className="h-3.5 w-3.5" /> CSV</a>
      <a className="btn btn-outline btn-sm" href={`${base}${sep}format=pdf`}><FileText className="h-3.5 w-3.5" /> PDF</a>
    </div>
  );
}

export default async function ReportsPage({ user }: { user: SessionUser }) {
  if (!can(user, 'reports.view') && !user.member_id) redirect('/dashboard');

  const available = REPORTS.filter((r) => canExport(user, r.key));
  const showFinance = can(user, 'finance.view');

  const finance = showFinance ? await financialSummary({ parishId: user.scope_parish_id ? Number(user.scope_parish_id) : null }) : null;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Reports & exports"
        subtitle={isMember(user) ? 'Download your personal financial statement.' : 'Generate membership, contributions, SDP/Sacco, loan, financial and audit reports as Excel, CSV or PDF.'}
      />

      {showFinance && finance ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total inflow" value={money(num(finance.totals?.inflow))} tone="green" icon={<TrendingUp className="h-4 w-4" />} sub={`${finance.totals?.transactions || 0} completed payment(s)`} />
            <StatCard label="Via M-Pesa" value={money(num(finance.totals?.mpesa))} tone="navy" icon={<Wallet className="h-4 w-4" />} />
            <StatCard label="Via bank" value={money(num(finance.totals?.bank))} tone="blue" icon={<Receipt className="h-4 w-4" />} />
            <StatCard label="Cash / Airtel" value={money(num(finance.totals?.cash) + num(finance.totals?.airtel))} tone="gold" icon={<Wallet className="h-4 w-4" />} />
          </div>
          {finance.byCategory?.length ? (
            <Card padded={false}>
              <div className="p-4"><CardHeader title="Inflow by allocation" subtitle="Where the money went (completed payments)" /></div>
              <div className="flex flex-wrap gap-2 px-4 pb-4">
                {finance.byCategory.slice(0, 10).map((c: any) => (
                  <span key={c.label} className="badge badge-grey">
                    {String(c.label).replace(/_/g, ' ')} · <strong className="text-navy-900">{money(num(c.value))}</strong>
                  </span>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {available.length === 0 ? (
        <Card><EmptyState icon={<Download className="h-6 w-6" />} title="No reports available" description="You do not currently have permission to export any reports." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {available.map((r) => {
            const Icon = r.icon;
            return (
              <Card key={r.key} className="flex flex-col">
                <CardHeader
                  title={r.title}
                  subtitle={r.desc}
                  icon={<Icon className="h-[18px] w-[18px]" />}
                  action={r.view && !isMember(user) ? <Link href={r.view} className="btn btn-ghost btn-sm" title="Open live view"><ExternalLink className="h-3.5 w-3.5" /></Link> : undefined}
                />
                <div className="mt-3 space-y-2">
                  {r.variants ? (
                    r.variants.map((v) => (
                      <div key={v.q} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2">
                        <Badge tone="badge badge-grey">{v.label}</Badge>
                        <ExportLinks report={r.key} q={v.q} />
                      </div>
                    ))
                  ) : (
                    <ExportLinks report={r.key} />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!isMember(user) ? (
        <Card>
          <CardHeader title="About exports" subtitle="Every export is permission-checked and written to the audit trail." />
          <p className="text-xs text-slate-500">
            Exports respect your parish scope and role permissions. Financial statements for individual members are available to the member concerned and to officers with payment access. PDF reports are print-ready for committee and AGM packs.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
