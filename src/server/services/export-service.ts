import 'server-only';
import { one, query } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { can, isMember } from '@/lib/rbac';
import type { ExportSheet } from '@/lib/exports';
import {
  memberList,
  membershipReport,
  contributionReport,
  outstandingContributions,
  savingsByMember,
  sharesByMember,
  loanPortfolio,
  guarantorExposureReport,
  dividendReport,
  financialSummary,
  incomeStatement,
  fundBalances,
  reconciliationReport,
  attendanceReport,
} from '@/lib/reports';
import { listPayments, memberStatement, ALLOCATION_LABELS, type AllocationType } from '@/lib/payments';
import { CASE_TABLES, caseProgress, type CaseType } from '@/lib/contributions';
import { CASE_META, caseTitle } from '@/lib/cases';
import { money, num } from '@/lib/money';
import { fmtDate, fmtDateTime, periodKey, periodLabel } from '@/lib/dates';
import { getOrganisation } from '@/lib/settings';

export interface ExportResult {
  title: string;
  fileName: string;
  filters: string[];
  sheets: ExportSheet[];
}

const ksh = (v: any) => money(num(v));
const date = (v: any) => (v ? fmtDate(v) : '');
const dateTime = (v: any) => (v ? fmtDateTime(v) : '');

/** Which permission guards each export. */
const EXPORT_PERMISSIONS: Record<string, string> = {
  members: 'members.view',
  contributions: 'contributions.view',
  outstanding: 'contributions.view',
  payments: 'payments.view',
  receipts: 'payments.view',
  statement: 'payments.view',
  cases: 'welfare.view',
  sacco: 'sacco.view',
  loans: 'loans.view',
  financial: 'finance.view',
  attendance: 'attendance.view',
  audit: 'audit.view',
};

export function canExport(user: SessionUser, report: string): boolean {
  const required = EXPORT_PERMISSIONS[report];
  if (!required) return false;
  // Members are self-service: they may export ONLY their own statement, never a
  // full dataset (member list, loan book, payments, etc.) — even though they hold
  // the corresponding *.view permission for their self-service screens.
  if (isMember(user)) return report === 'statement' && Boolean(user.member_id);
  return can(user, required);
}

/* ------------------------------------------------------------------ *
 * Sheet builders
 * ------------------------------------------------------------------ */

async function membersSheets(params: URLSearchParams, user: SessionUser): Promise<ExportResult> {
  const rows = await memberList({
    search: params.get('search') || undefined,
    parishId: user.scope_parish_id ? Number(user.scope_parish_id) : Number(params.get('parish_id')) || null,
    churchId: Number(params.get('church_id')) || null,
    sccId: Number(params.get('scc_id')) || null,
    status: params.get('status') || undefined,
    contributionStatus: params.get('contribution_status') || undefined,
    loanStatus: params.get('loan_status') || undefined,
    sacco: params.get('sacco') || undefined,
    limit: 100000,
  });

  const sheet: ExportSheet = {
    name: 'Members',
    title: 'Member register',
    columns: [
      { key: 'membership_no', label: 'CMA No.', width: 90 },
      { key: 'full_name', label: 'Full name', width: 160 },
      { key: 'phone', label: 'Phone', width: 95 },
      { key: 'email', label: 'Email', width: 140 },
      { key: 'gender', label: 'Gender', width: 50 },
      { key: 'date_of_birth', label: 'Date of birth', width: 80, format: date },
      { key: 'marital_status', label: 'Marital status', width: 80 },
      { key: 'occupation', label: 'Occupation', width: 100 },
      { key: 'residential_area', label: 'Residence', width: 100 },
      { key: 'parish_name', label: 'Parish', width: 110 },
      { key: 'church_name', label: 'Church', width: 110 },
      { key: 'scc_name', label: 'SCC', width: 110 },
      { key: 'date_joined', label: 'Joined', width: 80, format: date },
      { key: 'membership_status', label: 'Status', width: 70 },
      { key: 'savings_balance', label: 'Savings', align: 'right', width: 75, format: ksh },
      { key: 'shares_count', label: 'Shares', align: 'right', width: 55 },
      { key: 'contribution_outstanding', label: 'Arrears', align: 'right', width: 75, format: ksh },
      { key: 'unpaid_periods', label: 'Months unpaid', align: 'right', width: 70 },
      { key: 'active_loans', label: 'Active loans', align: 'right', width: 65 },
      { key: 'loan_outstanding', label: 'Loan balance', align: 'right', width: 85, format: ksh },
    ],
    rows: rows.rows,
    totals: {
      full_name: `${rows.rows.length} members`,
      savings_balance: ksh(rows.rows.reduce((a, r) => a + num(r.savings_balance), 0)),
      contribution_outstanding: ksh(rows.rows.reduce((a, r) => a + num(r.contribution_outstanding), 0)),
      loan_outstanding: ksh(rows.rows.reduce((a, r) => a + num(r.loan_outstanding), 0)),
    },
  };

  const summary = await membershipReport({
    parishId: user.scope_parish_id ? Number(user.scope_parish_id) : null,
    status: params.get('status') || undefined,
  });

  return {
    title: 'Member register',
    fileName: 'cma-members',
    filters: [
      params.get('status') ? `Status: ${params.get('status')}` : 'Status: all',
      params.get('search') ? `Search: ${params.get('search')}` : '',
      `${rows.total} member(s) in total`,
    ].filter(Boolean) as string[],
    sheets: [
      sheet,
      {
        name: 'By status',
        title: 'Members by status',
        columns: [
          { key: 'label', label: 'Status', width: 140 },
          { key: 'value', label: 'Members', align: 'right', width: 80 },
        ],
        rows: summary.byStatus,
      },
      {
        name: 'By church & SCC',
        title: 'Members by church and SCC',
        columns: [
          { key: 'label', label: 'Church / SCC', width: 200 },
          { key: 'value', label: 'Members', align: 'right', width: 80 },
        ],
        rows: [...summary.byChurch, ...summary.byScc],
      },
    ],
  };
}

async function contributionsSheets(params: URLSearchParams, user: SessionUser): Promise<ExportResult> {
  const period = params.get('period') || '';
  const parishId = user.scope_parish_id ? Number(user.scope_parish_id) : Number(params.get('parish_id')) || null;
  const report = await contributionReport({ period: period || undefined, parishId });
  const outstanding = await outstandingContributions({ parishId, limit: 5000 });

  return {
    title: period ? `Contribution report — ${periodLabel(period)}` : 'Contribution report',
    fileName: `cma-contributions${period ? `-${period}` : ''}`,
    filters: [period ? `Period: ${periodLabel(period)}` : 'All billed periods', `Collected: ${ksh(report.summary?.collected)}`, `Outstanding: ${ksh(report.summary?.outstanding)}`],
    sheets: [
      {
        name: 'By member',
        title: 'Contributions by member',
        columns: [
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 170 },
          { key: 'phone', label: 'Phone', width: 95 },
          { key: 'parish_name', label: 'Parish', width: 120 },
          { key: 'expected', label: 'Expected', align: 'right', width: 85, format: ksh },
          { key: 'paid', label: 'Paid', align: 'right', width: 85, format: ksh },
          { key: 'outstanding', label: 'Outstanding', align: 'right', width: 90, format: ksh },
          { key: 'months_paid', label: 'Months paid', align: 'right', width: 70 },
          { key: 'months_unpaid', label: 'Months unpaid', align: 'right', width: 75 },
          { key: 'last_unpaid_period', label: 'Last unpaid', width: 90, format: (v: any) => (v ? periodLabel(String(v)) : '') },
        ],
        rows: report.byMember,
        totals: {
          full_name: `${report.byMember.length} members`,
          expected: ksh(report.summary?.expected),
          paid: ksh(report.summary?.collected),
          outstanding: ksh(report.summary?.outstanding),
        },
      },
      {
        name: 'Outstanding',
        title: 'Outstanding contributions by month',
        columns: [
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 170 },
          { key: 'phone', label: 'Phone', width: 95 },
          { key: 'period', label: 'Period', width: 80, format: (v: any) => periodLabel(String(v)) },
          { key: 'amount_due', label: 'Due', align: 'right', width: 80, format: ksh },
          { key: 'amount_paid', label: 'Paid', align: 'right', width: 80, format: ksh },
          { key: 'penalty', label: 'Penalty', align: 'right', width: 75, format: ksh },
          { key: 'due_date', label: 'Due date', width: 85, format: date },
          { key: 'status', label: 'Status', width: 70 },
        ],
        rows: outstanding,
      },
      {
        name: 'By month',
        title: 'Collections by month',
        columns: [
          { key: 'label', label: 'Period', width: 110, format: (v: any) => periodLabel(String(v)) },
          { key: 'value', label: 'Collected', align: 'right', width: 100, format: ksh },
        ],
        rows: report.byPeriod,
      },
    ],
  };
}

async function paymentsSheets(params: URLSearchParams, user: SessionUser): Promise<ExportResult> {
  const list = await listPayments({
    from: params.get('from'),
    to: params.get('to'),
    method: params.get('method') || undefined,
    status: params.get('status') || undefined,
    search: params.get('search') || undefined,
    memberId: Number(params.get('member_id')) || null,
    limit: 100000,
  });

  return {
    title: 'Payments register',
    fileName: 'cma-payments',
    filters: [
      params.get('from') ? `From ${fmtDate(params.get('from'))}` : '',
      params.get('to') ? `To ${fmtDate(params.get('to'))}` : '',
      `${list.total} payment(s) · ${ksh(list.sum)} collected`,
    ].filter(Boolean) as string[],
    sheets: [
      {
        name: 'Payments',
        title: 'Payments register',
        columns: [
          { key: 'receipt_no', label: 'Receipt no.', width: 110 },
          { key: 'payment_date', label: 'Date', width: 120, format: dateTime },
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 170 },
          { key: 'method', label: 'Method', width: 70 },
          { key: 'reference', label: 'Reference', width: 110 },
          { key: 'transaction_id', label: 'Transaction ID', width: 120 },
          { key: 'amount', label: 'Amount', align: 'right', width: 90, format: ksh },
          { key: 'allocated_amount', label: 'Allocated', align: 'right', width: 90, format: ksh },
          { key: 'unallocated_amount', label: 'Unallocated', align: 'right', width: 90, format: ksh },
          { key: 'status', label: 'Status', width: 75 },
          { key: 'reconciled', label: 'Reconciled', width: 75, format: (v: any) => (v ? 'Yes' : 'No') },
          { key: 'channel', label: 'Channel', width: 80 },
        ],
        rows: list.rows,
        totals: { full_name: `${list.rows.length} payments`, amount: ksh(list.rows.reduce((a, r) => a + num(r.amount), 0)) },
      },
    ],
  };
}

async function receiptsSheets(params: URLSearchParams, user: SessionUser): Promise<ExportResult> {
  const scope = user.scope_parish_id ? `AND COALESCE(p.parish_id, m.parish_id) = ${Number(user.scope_parish_id)}` : '';
  const from = params.get('from');
  const to = params.get('to');
  const rows = await query<any>(
    `SELECT r.receipt_no, r.issued_at, r.amount, r.balance_after, r.payment_method, r.category, r.description, r.reference, r.status,
            m.membership_no, m.full_name, r.issued_by
       FROM receipts r JOIN members m ON m.id = r.member_id LEFT JOIN payments p ON p.id = r.payment_id
      WHERE 1=1 ${scope}
        ${from ? `AND r.issued_at >= '${from}'::date` : ''}
        ${to ? `AND r.issued_at < ('${to}'::date + interval '1 day')` : ''}
      ORDER BY r.issued_at DESC LIMIT 100000`,
  );

  return {
    title: 'Receipts issued',
    fileName: 'cma-receipts',
    filters: [from ? `From ${fmtDate(from)}` : '', to ? `To ${fmtDate(to)}` : '', `${rows.length} receipt(s)`].filter(Boolean) as string[],
    sheets: [
      {
        name: 'Receipts',
        title: 'Receipts issued',
        columns: [
          { key: 'receipt_no', label: 'Receipt no.', width: 110 },
          { key: 'issued_at', label: 'Issued', width: 120, format: dateTime },
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 170 },
          { key: 'description', label: 'Description', width: 180 },
          { key: 'payment_method', label: 'Method', width: 70 },
          { key: 'reference', label: 'Reference', width: 110 },
          { key: 'amount', label: 'Amount', align: 'right', width: 90, format: ksh },
          { key: 'balance_after', label: 'Balance after', align: 'right', width: 95, format: ksh },
          { key: 'status', label: 'Status', width: 70 },
          { key: 'issued_by', label: 'Issued by', width: 120 },
        ],
        rows,
        totals: { full_name: `${rows.length} receipts`, amount: ksh(rows.reduce((a, r) => a + num(r.amount), 0)) },
      },
    ],
  };
}

async function statementSheets(params: URLSearchParams, user: SessionUser): Promise<ExportResult> {
  const memberId = Number(params.get('member_id')) || (user.member_id ?? 0);
  if (!can(user, 'payments.view') && user.member_id !== memberId) throw new Error('Not permitted');
  const statement = await memberStatement(memberId, params.get('from'), params.get('to'));

  return {
    title: `Member statement — ${statement.member.full_name}`,
    fileName: `cma-statement-${statement.member.membership_no.replace(/\//g, '-')}`,
    filters: [
      statement.range.from ? `From ${fmtDate(statement.range.from)}` : 'From inception',
      statement.range.to ? `To ${fmtDate(statement.range.to)}` : `To ${fmtDate(new Date())}`,
    ],
    sheets: statement.sections
      .filter((s) => s.rows.length > 0)
      .map((s) => ({
        name: s.title.slice(0, 28),
        title: s.title,
        columns: [
          { key: 'date', label: 'Date', width: 90 },
          { key: 'description', label: 'Description', width: 260 },
          { key: 'reference', label: 'Reference', width: 110 },
          { key: 'debit', label: 'Debit', align: 'right' as const, width: 90, format: (v: any) => (num(v) ? ksh(v) : '') },
          { key: 'credit', label: 'Credit', align: 'right' as const, width: 90, format: (v: any) => (num(v) ? ksh(v) : '') },
          { key: 'balance', label: 'Balance', align: 'right' as const, width: 95, format: ksh },
        ],
        rows: s.rows,
        totals: { description: 'Total', debit: s.total_debit ? ksh(s.total_debit) : '', credit: s.total_credit ? ksh(s.total_credit) : '' },
      })),
  };
}

async function casesSheets(params: URLSearchParams, user: SessionUser): Promise<ExportResult> {
  const type = (params.get('type') || 'welfare') as CaseType;
  const table = CASE_TABLES[type];
  const refCol = type === 'project' ? 'project_no' : 'case_no';
  const id = Number(params.get('id')) || null;

  if (id) {
    const progress = await caseProgress(type, id);
    const perMember = num(progress.case.amount_per_member);
    const rows = [
      ...progress.contributors.map((c: any) => ({ ...c, expected: perMember, balance: Math.max(0, perMember - num(c.paid)) })),
      ...progress.non_contributors.map((c: any) => ({ ...c, expected: perMember, balance: num(c.outstanding) })),
    ];
    return {
      title: `${CASE_META[type].label} ${progress.case[refCol]} — contributions`,
      fileName: `cma-${type}-${progress.case[refCol].replace(/\//g, '-')}`,
      filters: [
        `Expected ${ksh(progress.expected)}`,
        `Collected ${ksh(progress.collected)}`,
        `Outstanding ${ksh(progress.outstanding)}`,
        `Disbursed ${ksh(progress.disbursed)}`,
      ],
      sheets: [
        {
          name: 'Contributions',
          title: `${CASE_META[type].label} contributions`,
          columns: [
            { key: 'membership_no', label: 'CMA No.', width: 90 },
            { key: 'full_name', label: 'Member', width: 170 },
            { key: 'phone', label: 'Phone', width: 95 },
            { key: 'expected', label: 'Expected', align: 'right', width: 85, format: ksh },
            { key: 'paid', label: 'Paid', align: 'right', width: 85, format: ksh },
            { key: 'balance', label: 'Balance', align: 'right', width: 85, format: ksh },
            { key: 'last_paid', label: 'Last payment', width: 95, format: date },
          ],
          rows,
          totals: {
            full_name: `${rows.length} members`,
            expected: ksh(progress.expected),
            paid: ksh(progress.collected),
            balance: ksh(progress.outstanding),
          },
        },
      ],
    };
  }

  const scope = user.scope_parish_id ? `AND c.parish_id = ${Number(user.scope_parish_id)}` : '';
  const rows = await query<any>(
    `SELECT c.*, c.${refCol} AS ref,
            ${type === 'project' ? 'NULL AS member_name, NULL AS membership_no,' : 'm.full_name AS member_name, m.membership_no,'}
            p.name AS parish_name
       FROM ${table.cases} c
       ${type === 'project' ? '' : 'LEFT JOIN members m ON m.id = c.member_id'}
       LEFT JOIN parishes p ON p.id = c.parish_id
      WHERE 1=1 ${scope} ORDER BY c.created_at DESC LIMIT 100000`,
  );

  return {
    title: CASE_META[type].plural,
    fileName: `cma-${type}s`,
    filters: [`${rows.length} record(s)`, `Collected ${ksh(rows.reduce((a, r) => a + num(r.amount_collected), 0))}`],
    sheets: [
      {
        name: CASE_META[type].plural.slice(0, 28),
        title: CASE_META[type].plural,
        columns: [
          { key: 'ref', label: 'Reference', width: 100 },
          { key: 'member_name', label: 'Member', width: 160 },
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'parish_name', label: 'Parish', width: 120 },
          {
            key: 'title',
            label: type === 'project' ? 'Project' : 'Concerning',
            width: 180,
            format: (_v: any, row: any) =>
              caseTitle(type, {
                ...row,
                full_name: row.member_name,
                name: row.name,
                beneficiary_name: row.beneficiary_name,
                deceased_name: row.deceased_name,
                spouse_name: row.spouse_name,
                category: row.category,
                relationship: row.relationship,
              }),
          },
          { key: 'amount_per_member', label: 'Per member', align: 'right', width: 85, format: ksh },
          { key: 'amount_collected', label: 'Collected', align: 'right', width: 90, format: ksh },
          { key: 'amount_disbursed', label: 'Disbursed', align: 'right', width: 90, format: ksh },
          { key: 'deadline', label: 'Deadline', width: 85, format: date },
          { key: 'scope_type', label: 'Scope', width: 70 },
          { key: 'status', label: 'Status', width: 75 },
          { key: 'created_at', label: 'Opened', width: 110, format: dateTime },
        ],
        rows,
        totals: {
          member_name: `${rows.length} records`,
          amount_collected: ksh(rows.reduce((a, r) => a + num(r.amount_collected), 0)),
          amount_disbursed: ksh(rows.reduce((a, r) => a + num(r.amount_disbursed), 0)),
        },
      },
    ],
  };
}

async function saccoSheets(params: URLSearchParams): Promise<ExportResult> {
  const [savings, shares, dividends] = await Promise.all([savingsByMember(), sharesByMember(), dividendReport(params.get('year') || undefined)]);
  const totals = {
    savings: savings.reduce((a, r) => a + num(r.savings_balance), 0),
    shares: shares.reduce((a, r) => a + num(r.share_capital), 0),
  };

  return {
    title: 'SDP / Sacco report',
    fileName: 'cma-sacco',
    filters: [`Savings ${ksh(totals.savings)}`, `Share capital ${ksh(totals.shares)}`, `${dividends.batches.length} dividend batch(es)`],
    sheets: [
      {
        name: 'Savings',
        title: 'Savings by member',
        columns: [
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 170 },
          { key: 'phone', label: 'Phone', width: 95 },
          { key: 'account_no', label: 'Account', width: 100 },
          { key: 'savings_balance', label: 'Balance', align: 'right', width: 90, format: ksh },
          { key: 'total_deposits', label: 'Deposits', align: 'right', width: 90, format: ksh },
          { key: 'total_withdrawals', label: 'Withdrawals', align: 'right', width: 95, format: ksh },
          { key: 'entries', label: 'Entries', align: 'right', width: 60 },
          { key: 'last_deposit', label: 'Last deposit', width: 95, format: date },
        ],
        rows: savings,
        totals: { full_name: `${savings.length} members`, savings_balance: ksh(totals.savings) },
      },
      {
        name: 'Shares',
        title: 'Shares by member',
        columns: [
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 170 },
          { key: 'account_no', label: 'Account', width: 100 },
          { key: 'shares_count', label: 'Shares', align: 'right', width: 70 },
          { key: 'share_capital', label: 'Share capital', align: 'right', width: 95, format: ksh },
          { key: 'certificates', label: 'Certificates', align: 'right', width: 80 },
          { key: 'certificate_nos', label: 'Certificate numbers', width: 180 },
        ],
        rows: shares,
        totals: { full_name: `${shares.length} shareholders`, share_capital: ksh(totals.shares) },
      },
      {
        name: 'Dividends',
        title: 'Dividend allocations',
        columns: [
          { key: 'financial_year', label: 'Year', width: 70 },
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 170 },
          { key: 'shares_held', label: 'Shares held', align: 'right', width: 80 },
          { key: 'amount', label: 'Dividend', align: 'right', width: 90, format: ksh },
          { key: 'status', label: 'Status', width: 80 },
          { key: 'description', label: 'Batch', width: 180 },
        ],
        rows: dividends.allocations,
      },
    ],
  };
}

async function loansSheets(params: URLSearchParams): Promise<ExportResult> {
  const [portfolio, guarantors] = await Promise.all([loanPortfolio(), guarantorExposureReport()]);
  const s = portfolio.summary;

  return {
    title: 'Loan portfolio report',
    fileName: 'cma-loans',
    filters: [
      `${s?.loans || 0} loan(s)`,
      `Disbursed ${ksh(s?.principal_disbursed)}`,
      `Outstanding ${ksh(s?.outstanding)}`,
      `Arrears ${ksh(s?.arrears)}`,
    ],
    sheets: [
      {
        name: 'Loans',
        title: 'Loan portfolio',
        columns: [
          { key: 'loan_no', label: 'Loan no.', width: 100 },
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Borrower', width: 165 },
          { key: 'phone', label: 'Phone', width: 95 },
          { key: 'loan_type', label: 'Type', width: 110 },
          { key: 'principal', label: 'Principal', align: 'right', width: 90, format: ksh },
          { key: 'interest_rate', label: 'Rate %', align: 'right', width: 60 },
          { key: 'term_months', label: 'Term (m)', align: 'right', width: 60 },
          { key: 'monthly_repayment', label: 'Monthly', align: 'right', width: 85, format: ksh },
          { key: 'amount_paid', label: 'Repaid', align: 'right', width: 85, format: ksh },
          { key: 'outstanding_balance', label: 'Outstanding', align: 'right', width: 95, format: ksh },
          { key: 'arrears', label: 'Arrears', align: 'right', width: 80, format: ksh },
          { key: 'next_due_date', label: 'Next due', width: 85, format: date },
          { key: 'maturity_date', label: 'Maturity', width: 85, format: date },
          { key: 'status', label: 'Status', width: 80 },
        ],
        rows: portfolio.loans,
        totals: {
          full_name: `${portfolio.loans.length} loans`,
          principal: ksh(s?.principal_disbursed),
          amount_paid: ksh(s?.repaid),
          outstanding_balance: ksh(s?.outstanding),
          arrears: ksh(s?.arrears),
        },
      },
      {
        name: 'Arrears',
        title: 'Loans in arrears',
        columns: [
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Borrower', width: 165 },
          { key: 'phone', label: 'Phone', width: 95 },
          { key: 'loan_no', label: 'Loan no.', width: 100 },
          { key: 'loan_type', label: 'Type', width: 110 },
          { key: 'arrears', label: 'Arrears', align: 'right', width: 90, format: ksh },
          { key: 'missed_instalments', label: 'Missed instalments', align: 'right', width: 90 },
          { key: 'next_due_date', label: 'Next due', width: 85, format: date },
          { key: 'status', label: 'Status', width: 80 },
        ],
        rows: portfolio.arrears,
        totals: { full_name: `${portfolio.arrears.length} loan(s)`, arrears: ksh(portfolio.arrears.reduce((a: number, r: any) => a + num(r.arrears), 0)) },
      },
      {
        name: 'Guarantors',
        title: 'Guarantor exposure',
        columns: [
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Guarantor', width: 165 },
          { key: 'phone', label: 'Phone', width: 95 },
          { key: 'savings_balance', label: 'Savings', align: 'right', width: 90, format: ksh },
          { key: 'share_capital', label: 'Shares', align: 'right', width: 90, format: ksh },
          { key: 'active_guarantees', label: 'Active guarantees', align: 'right', width: 90 },
          { key: 'guaranteed_amount', label: 'Guaranteed', align: 'right', width: 95, format: ksh },
          { key: 'accepted_amount', label: 'Accepted', align: 'right', width: 90, format: ksh },
          { key: 'pending_amount', label: 'Pending', align: 'right', width: 90, format: ksh },
        ],
        rows: guarantors,
      },
      {
        name: 'By type',
        title: 'Portfolio by loan type',
        columns: [
          { key: 'label', label: 'Loan type', width: 150 },
          { key: 'loans', label: 'Loans', align: 'right', width: 70 },
          { key: 'principal', label: 'Principal', align: 'right', width: 100, format: ksh },
          { key: 'outstanding', label: 'Outstanding', align: 'right', width: 100, format: ksh },
        ],
        rows: portfolio.byType,
      },
    ],
  };
}

async function financialSheets(params: URLSearchParams, user: SessionUser): Promise<ExportResult> {
  const from = params.get('from');
  const to = params.get('to');
  const parishId = user.scope_parish_id ? Number(user.scope_parish_id) : Number(params.get('parish_id')) || null;
  const [summary, income, funds, reconciliation] = await Promise.all([
    financialSummary({ from, to, parishId }),
    incomeStatement({ from, to }),
    fundBalances(),
    reconciliationReport({ from, to }),
  ]);

  return {
    title: 'Financial report',
    fileName: 'cma-financial',
    filters: [
      from ? `From ${fmtDate(from)}` : 'From inception',
      to ? `To ${fmtDate(to)}` : `To ${fmtDate(new Date())}`,
      `Inflow ${ksh(summary.totals?.inflow)}`,
      `Disbursed — welfare ${ksh(summary.outflow?.welfare)}, funerals ${ksh(summary.outflow?.funerals)}, weddings ${ksh(summary.outflow?.weddings)}, projects ${ksh(summary.outflow?.projects)}`,
      `Loans disbursed ${ksh(summary.outflow?.loans_disbursed)}`,
    ],
    sheets: [
      {
        name: 'Summary',
        title: 'Financial summary',
        columns: [
          { key: 'label', label: 'Category', width: 200 },
          { key: 'value', label: 'Amount', align: 'right', width: 120, format: ksh },
        ],
        rows: summary.byCategory,
        totals: { label: 'Total inflow', value: ksh(summary.totals?.inflow) },
      },
      {
        name: 'By method',
        title: 'Collections by payment method',
        columns: [
          { key: 'label', label: 'Method', width: 140 },
          { key: 'count', label: 'Transactions', align: 'right', width: 90 },
          { key: 'value', label: 'Amount', align: 'right', width: 120, format: ksh },
        ],
        rows: summary.byMethod,
      },
      {
        name: 'By month',
        title: 'Collections by month',
        columns: [
          { key: 'label', label: 'Period', width: 110, format: (v: any) => periodLabel(String(v)) },
          { key: 'value', label: 'Collected', align: 'right', width: 120, format: ksh },
        ],
        rows: summary.byMonth,
      },
      {
        name: 'Income statement',
        title: 'Income statement',
        columns: [
          { key: 'label', label: 'Line', width: 220 },
          { key: 'value', label: 'Amount', align: 'right', width: 120, format: ksh },
        ],
        rows: [
          ...income.incomeRows.map((r: any) => ({ ...r, label: `Income — ${r.label}` })),
          ...income.expenseRows.map((r: any) => ({ ...r, label: `Expense — ${r.label}` })),
          { label: 'NET POSITION', value: income.net },
        ],
        totals: { label: `Income ${ksh(income.totalIncome)} · Expenses ${ksh(income.totalExpense)}`, value: ksh(income.net) },
      },
      {
        name: 'Fund balances',
        title: 'Fund balances by account code',
        columns: [
          { key: 'account_code', label: 'Account code', width: 100 },
          { key: 'fund', label: 'Fund', width: 180 },
          { key: 'category', label: 'Category', width: 100 },
          { key: 'inflow', label: 'Collected', align: 'right', width: 110, format: ksh },
          { key: 'outflow', label: 'Disbursed', align: 'right', width: 110, format: ksh },
          { key: 'balance', label: 'Balance', align: 'right', width: 110, format: ksh },
        ],
        rows: funds,
      },
      {
        name: 'Reconciliation',
        title: 'Payment reconciliation',
        columns: [
          { key: 'receipt_no', label: 'Receipt', width: 105 },
          { key: 'payment_date', label: 'Date', width: 115, format: dateTime },
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 160 },
          { key: 'method', label: 'Method', width: 70 },
          { key: 'amount', label: 'Amount', align: 'right', width: 90, format: ksh },
          { key: 'allocation_total', label: 'Allocated', align: 'right', width: 90, format: ksh },
          { key: 'unallocated_amount', label: 'Unallocated', align: 'right', width: 90, format: ksh },
          { key: 'status', label: 'Status', width: 75 },
          { key: 'reconciled', label: 'Reconciled', width: 80, format: (v: any) => (v ? 'Yes' : 'No') },
        ],
        rows: reconciliation,
      },
    ],
  };
}

async function attendanceSheets(params: URLSearchParams): Promise<ExportResult> {
  const report = await attendanceReport({
    meetingId: Number(params.get('meeting_id')) || undefined,
    memberId: Number(params.get('member_id')) || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
  });

  return {
    title: 'Attendance report',
    fileName: 'cma-attendance',
    filters: [
      params.get('from') ? `From ${fmtDate(params.get('from'))}` : '',
      params.get('to') ? `To ${fmtDate(params.get('to'))}` : '',
      `${report.byMeeting.length} meeting(s)`,
    ].filter(Boolean) as string[],
    sheets: [
      {
        name: 'By member',
        title: 'Attendance by member',
        columns: [
          { key: 'membership_no', label: 'CMA No.', width: 90 },
          { key: 'full_name', label: 'Member', width: 170 },
          { key: 'church_name', label: 'Church', width: 130 },
          { key: 'meetings', label: 'Meetings', align: 'right', width: 70 },
          { key: 'attended', label: 'Attended', align: 'right', width: 70 },
          { key: 'apologies', label: 'Apologies', align: 'right', width: 70 },
          { key: 'absent', label: 'Absent', align: 'right', width: 65 },
          { key: 'attendance_pct', label: 'Attendance %', align: 'right', width: 85, format: (v: any) => `${num(v).toFixed(1)}%` },
        ],
        rows: report.byMember,
      },
      {
        name: 'By meeting',
        title: 'Attendance by meeting',
        columns: [
          { key: 'meeting_date', label: 'Date', width: 90, format: date },
          { key: 'title', label: 'Meeting', width: 200 },
          { key: 'meeting_type', label: 'Type', width: 100 },
          { key: 'venue', label: 'Venue', width: 130 },
          { key: 'marked', label: 'Marked', align: 'right', width: 65 },
          { key: 'present', label: 'Present', align: 'right', width: 70 },
          { key: 'absent', label: 'Absent', align: 'right', width: 65 },
          { key: 'apology', label: 'Apology', align: 'right', width: 70 },
        ],
        rows: report.byMeeting,
      },
    ],
  };
}

async function auditSheets(params: URLSearchParams): Promise<ExportResult> {
  const rows = await query<any>(
    `SELECT a.created_at, a.user_name, a.action, a.entity_type, a.entity_label, a.description, a.severity, a.ip_address
       FROM audit_logs a
      WHERE 1=1
        ${params.get('from') ? `AND a.created_at >= '${params.get('from')}'::date` : ''}
        ${params.get('to') ? `AND a.created_at < ('${params.get('to')}'::date + interval '1 day')` : ''}
        ${params.get('user_id') ? `AND a.user_id = ${Number(params.get('user_id'))}` : ''}
        ${params.get('severity') ? `AND a.severity = '${String(params.get('severity')).replace(/'/g, '')}'` : ''}
      ORDER BY a.created_at DESC LIMIT 20000`,
  );

  return {
    title: 'Audit trail',
    fileName: 'cma-audit-trail',
    filters: [`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`],
    sheets: [
      {
        name: 'Audit trail',
        title: 'System audit trail',
        columns: [
          { key: 'created_at', label: 'When', width: 120, format: dateTime },
          { key: 'user_name', label: 'User', width: 150 },
          { key: 'action', label: 'Action', width: 140 },
          { key: 'entity_type', label: 'Entity', width: 120 },
          { key: 'entity_label', label: 'Reference', width: 110 },
          { key: 'description', label: 'Description', width: 300 },
          { key: 'severity', label: 'Severity', width: 75 },
          { key: 'ip_address', label: 'IP address', width: 100 },
        ],
        rows,
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Dispatcher
 * ------------------------------------------------------------------ */
export async function buildExport(report: string, params: URLSearchParams, user: SessionUser): Promise<ExportResult> {
  const org = await getOrganisation();
  switch (report) {
    case 'members':
      return membersSheets(params, user);
    case 'contributions':
      return contributionsSheets(params, user);
    case 'outstanding': {
      const rows = await outstandingContributions({ parishId: user.scope_parish_id ? Number(user.scope_parish_id) : null, limit: 100000 });
      return {
        title: 'Outstanding contributions',
        fileName: 'cma-outstanding',
        filters: [`${rows.length} unpaid month(s) · ${ksh(rows.reduce((a, r) => a + num(r.amount_due) - num(r.amount_paid) + num(r.penalty), 0))}`],
        sheets: [
          {
            name: 'Outstanding',
            title: 'Outstanding contributions',
            columns: [
              { key: 'membership_no', label: 'CMA No.', width: 90 },
              { key: 'full_name', label: 'Member', width: 170 },
              { key: 'phone', label: 'Phone', width: 95 },
              { key: 'parish_name', label: 'Parish', width: 120 },
              { key: 'period', label: 'Period', width: 90, format: (v: any) => periodLabel(String(v)) },
              { key: 'amount_due', label: 'Due', align: 'right', width: 85, format: ksh },
              { key: 'amount_paid', label: 'Paid', align: 'right', width: 85, format: ksh },
              { key: 'penalty', label: 'Penalty', align: 'right', width: 80, format: ksh },
              { key: 'due_date', label: 'Due date', width: 90, format: date },
              { key: 'status', label: 'Status', width: 75 },
            ],
            rows,
          },
        ],
      };
    }
    case 'payments':
      return paymentsSheets(params, user);
    case 'receipts':
      return receiptsSheets(params, user);
    case 'statement':
      return statementSheets(params, user);
    case 'cases':
      return casesSheets(params, user);
    case 'sacco':
      return saccoSheets(params);
    case 'loans':
      return loansSheets(params);
    case 'financial':
      return financialSheets(params, user);
    case 'attendance':
      return attendanceSheets(params);
    case 'audit':
      return auditSheets(params);
    default:
      throw new Error(`Unknown export "${report}"`);
  }
}

export { ALLOCATION_LABELS };
export type { AllocationType };
export { periodKey };
