import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Users, Phone, Mail, MapPin, Church, CalendarClock, Wallet, HeartPulse, Cross, HeartHandshake,
  HandCoins, Landmark, Banknote, FileText, ClipboardCheck, ShieldCheck, KeyRound, Download, Pencil,
  IdCard, Briefcase, Cake, Gem, UserCheck, AlertTriangle,
} from 'lucide-react';
import { query, one } from '@/lib/db';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { memberById, memberDocuments } from '@/server/services/members';
import { memberBalances } from '@/lib/payments';
import { money, num, percent, phoneDisplay } from '@/lib/money';
import { fmtDate, fmtDateTime, age, periodLabel, relativeTime, isoDate } from '@/lib/dates';
import {
  Card, CardHeader, KeyValue, StatCard, StatusBadge, Table, Th, Td, ProgressBar, EmptyState, Avatar, Badge, Money,
} from '@/components/ui/primitives';
import { LinkTabs } from '@/components/ui/client';
import { MemberActionButtons, DocumentUploadForm, DocumentRowActions } from '@/components/forms/member-forms';
import PayNowButton, { type Obligation } from '@/components/forms/pay-now';

export const dynamic = 'force-dynamic';

export const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'personal', label: 'Personal' },
  { key: 'contact', label: 'Contact & Kin' },
  { key: 'church', label: 'Church Structure' },
  { key: 'membership', label: 'Membership' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'payments', label: 'Payments & Receipts' },
  { key: 'welfare', label: 'Welfare' },
  { key: 'funerals', label: 'Funerals' },
  { key: 'weddings', label: 'Weddings' },
  { key: 'projects', label: 'Projects' },
  { key: 'sacco', label: 'Savings & Shares' },
  { key: 'loans', label: 'Loans & Guarantees' },
  { key: 'records', label: 'Attendance & Documents' },
];

export default async function MemberProfile({ memberId, user, tab }: { memberId: number; user: SessionUser; tab: string }) {
  const member = await memberById(memberId);
  if (!member || member.deleted_at) notFound();

  const isSelf = user.member_id === memberId;
  if (!isSelf && !can(user, 'members.view')) notFound();

  const sensitive = isSelf || can(user, 'members.view_sensitive');

  const [balances, contributions, payments, receipts, penalties, welfare, funerals, weddings, projects, savings, shares, shareTx, dividends, loans, applications, guarantees, attendance, documents, notifications, audit, account, loanTypes] =
    await Promise.all([
      memberBalances(memberId),
      query<any>(
        `SELECT mc.*, ct.name AS type_name FROM member_contributions mc JOIN contribution_types ct ON ct.id = mc.contribution_type_id
          WHERE mc.member_id = $1 ORDER BY mc.period DESC LIMIT 60`,
        [memberId],
      ),
      can(user, 'payments.view') || isSelf
        ? query<any>(
            `SELECT p.*, u.name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
              WHERE p.member_id = $1 ORDER BY p.payment_date DESC LIMIT 60`,
            [memberId],
          )
        : Promise.resolve([] as any[]),
      isSelf || can(user, 'receipts.view')
        ? query<any>(`SELECT * FROM receipts WHERE member_id = $1 ORDER BY issued_at DESC LIMIT 40`, [memberId])
        : Promise.resolve([] as any[]),
      query<any>(`SELECT * FROM penalties WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30`, [memberId]),
      query<any>(
        `SELECT c.*, m.full_name AS beneficiary FROM welfare_cases c JOIN members m ON m.id = c.member_id
          WHERE c.member_id = $1 OR c.id IN (SELECT welfare_case_id FROM welfare_payments WHERE member_id = $1)
          ORDER BY c.opening_date DESC LIMIT 40`,
        [memberId],
      ),
      query<any>(
        `SELECT c.*, m.full_name AS member_name FROM funeral_cases c JOIN members m ON m.id = c.member_id
          WHERE c.member_id = $1 OR c.id IN (SELECT funeral_case_id FROM funeral_payments WHERE member_id = $1)
          ORDER BY c.date_of_death DESC LIMIT 40`,
        [memberId],
      ),
      query<any>(
        `SELECT c.*, m.full_name AS member_name FROM wedding_cases c JOIN members m ON m.id = c.member_id
          WHERE c.member_id = $1 OR c.id IN (SELECT wedding_case_id FROM wedding_payments WHERE member_id = $1)
          ORDER BY c.wedding_date DESC LIMIT 40`,
        [memberId],
      ),
      query<any>(
        `SELECT p.*, pc.amount_paid AS my_paid, pc.amount_pledged AS my_pledged, pc.status AS my_status
           FROM special_projects p LEFT JOIN project_contributions pc ON pc.project_id = p.id AND pc.member_id = $1
          WHERE p.id IN (SELECT project_id FROM project_contributions WHERE member_id = $1)
             OR p.parish_id = $2
          ORDER BY p.start_date DESC LIMIT 40`,
        [memberId, member.parish_id],
      ),
      query<any>(
        `SELECT * FROM savings WHERE member_id = $1 AND reversed = FALSE ORDER BY transaction_date DESC LIMIT 60`,
        [memberId],
      ),
      query<any>(`SELECT * FROM shares WHERE member_id = $1 ORDER BY issued_date DESC LIMIT 40`, [memberId]),
      query<any>(
        `SELECT st.*, m.full_name AS other_member FROM share_transactions st LEFT JOIN members m ON m.id = COALESCE(st.to_member_id, st.from_member_id)
          WHERE st.member_id = $1 ORDER BY st.transaction_date DESC LIMIT 40`,
        [memberId],
      ),
      query<any>(
        `SELECT d.*, da.amount, da.shares_held, da.status AS alloc_status FROM dividend_allocations da
           JOIN dividends d ON d.id = da.dividend_id WHERE da.member_id = $1 ORDER BY d.financial_year DESC`,
        [memberId],
      ),
      query<any>(
        `SELECT l.*, lt.name AS loan_type_name FROM loans l JOIN loan_types lt ON lt.id = l.loan_type_id
          WHERE l.member_id = $1 ORDER BY l.disbursed_at DESC`,
        [memberId],
      ),
      query<any>(
        `SELECT a.*, lt.name AS loan_type_name FROM loan_applications a JOIN loan_types lt ON lt.id = a.loan_type_id
          WHERE a.member_id = $1 ORDER BY a.applied_at DESC LIMIT 30`,
        [memberId],
      ),
      query<any>(
        `SELECT g.*, a.application_no, a.status AS application_status, m.full_name AS borrower
           FROM loan_guarantors g JOIN loan_applications a ON a.id = g.loan_application_id JOIN members m ON m.id = g.member_id
          WHERE g.guarantor_member_id = $1 ORDER BY g.requested_at DESC LIMIT 30`,
        [memberId],
      ),
      query<any>(
        `SELECT a.*, mt.title, mt.meeting_date, mt.meeting_type FROM attendance a JOIN meetings mt ON mt.id = a.meeting_id
          WHERE a.member_id = $1 ORDER BY mt.meeting_date DESC LIMIT 60`,
        [memberId],
      ),
      memberDocuments(memberId),
      query<any>(
        `SELECT id, title, body, category, priority, link, read_at, created_at FROM notifications
          WHERE member_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [memberId],
      ),
      can(user, 'audit.view')
        ? query<any>(
            `SELECT * FROM audit_logs WHERE (entity_type IN ('member','payment','member_document') AND entity_id = $1)
               OR (entity_type = 'member' AND entity_id = $1) ORDER BY created_at DESC LIMIT 30`,
            [memberId],
          )
        : Promise.resolve([] as any[]),
      one<any>('SELECT * FROM sacco_accounts WHERE member_id = $1', [memberId]),
      query<any>('SELECT id, code, name FROM loan_types WHERE active = TRUE ORDER BY name'),
    ]);

  const attendanceStats = {
    total: attendance.length,
    present: attendance.filter((a: any) => a.status === 'present' || a.status === 'late').length,
    apology: attendance.filter((a: any) => a.status === 'apology').length,
    absent: attendance.filter((a: any) => a.status === 'absent').length,
  };

  const obligations: Obligation[] = [];
  const unpaid = contributions.filter((c: any) => !c.exempted && num(c.amount_due) - num(c.amount_paid) > 0).slice(0, 6);
  for (const c of unpaid) {
    obligations.push({
      key: `mc-${c.id}`,
      label: `Monthly contribution — ${periodLabel(c.period)}`,
      detail: `Due ${fmtDate(c.due_date)}${num(c.penalty) > 0 ? ` · penalty ${money(c.penalty)}` : ''}`,
      allocationType: 'monthly_contribution',
      referenceId: c.id,
      period: c.period,
      amount: Math.round((num(c.amount_due) - num(c.amount_paid) + num(c.penalty)) * 100) / 100,
    });
  }
  for (const l of loans.filter((l: any) => num(l.outstanding_balance) > 0)) {
    obligations.push({
      key: `loan-${l.id}`,
      label: `Loan repayment — ${l.loan_no}`,
      detail: `Outstanding ${money(l.outstanding_balance)}`,
      allocationType: 'loan',
      referenceId: l.id,
      amount: num(l.monthly_repayment),
    });
  }
  if (num(balances.penalties_outstanding) > 0) {
    obligations.push({
      key: 'penalty',
      label: 'Penalties & charges',
      allocationType: 'penalty',
      amount: num(balances.penalties_outstanding),
    });
  }
  obligations.push({
    key: 'savings',
    label: 'SDP / Sacco savings deposit',
    detail: account?.account_no ? `Account ${account.account_no}` : 'Savings deposit',
    allocationType: 'savings',
    amount: 500,
    min: 100,
  });

  const canPay = isSelf ? can(user, 'payments.pay_own') || can(user, 'payments.create') : can(user, 'payments.create');
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'overview';

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card padded={false}>
        <div className="flex flex-col gap-4 rounded-t-xl bg-navy-950 px-4 py-4 text-white bg-grid sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <Avatar name={member.full_name} src={member.photo_url} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-extrabold leading-tight sm:text-xl">{member.full_name}</h1>
                <StatusBadge status={member.membership_status} />
                {member.exempt_monthly ? <span className="badge-grey">Exempted</span> : null}
              </div>
              <p className="mt-0.5 text-xs text-slate-300">
                {member.membership_no} · {member.parish_name}
                {member.church_name ? ` · ${member.church_name}` : ''}
                {member.scc_name ? ` · SCC ${member.scc_name}` : ''}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {sensitive ? phoneDisplay(member.phone) : `07•• ••• ${String(member.phone || '').slice(-3)}`}
                {member.email ? ` · ${member.email}` : ''}
                {member.date_of_birth ? ` · ${age(member.date_of_birth)} yrs` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canPay ? <PayNowButton memberId={memberId} phone={member.phone} obligations={obligations} label="Record payment" className="btn-gold" /> : null}
            <Link href={`/api/documents/statement?member=${memberId}`} className="btn-outline btn-sm border-white/30 text-white hover:bg-white/10">
              <FileText className="h-4 w-4" /> Statement
            </Link>
            <Link href={`/api/documents/member-card?member=${memberId}`} className="btn-outline btn-sm border-white/30 text-white hover:bg-white/10">
              <IdCard className="h-4 w-4" /> ID card
            </Link>
            {can(user, 'members.update') || isSelf ? (
              <Link href={`/members/${memberId}/edit`} className="btn-outline btn-sm border-white/30 text-white hover:bg-white/10">
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            ) : null}
          </div>
        </div>

        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-5">
          <Tile label="Contributed" value={money(balances.monthly_paid)} sub={`${contributions.length} period(s) billed`} tone="green" />
          <Tile label="Outstanding" value={money(balances.monthly_outstanding)} sub={balances.unpaid_periods ? `${balances.unpaid_periods} unpaid period(s)` : 'Fully paid up'} tone={num(balances.monthly_outstanding) > 0 ? 'red' : 'green'} />
          <Tile label="Savings" value={money(balances.savings_balance)} sub={account?.account_no || 'No sacco account'} />
          <Tile label="Shares" value={money(balances.shares_value)} sub={`${balances.shares_count} share(s)`} tone="gold" />
          <Tile label="Loan balance" value={money(balances.loan_outstanding)} sub={num(balances.loan_arrears) > 0 ? `Arrears ${money(balances.loan_arrears)}` : `${balances.active_loans} active loan(s)`} tone={num(balances.loan_arrears) > 0 ? 'red' : 'navy'} />
        </div>

        {can(user, 'members.update') || can(user, 'members.approve') ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
            <MemberActionButtons
              memberId={memberId}
              status={member.membership_status}
              exempt={Boolean(member.exempt_monthly)}
              permissions={{
                update: can(user, 'members.update'),
                approve: can(user, 'members.approve'),
                archive: can(user, 'members.delete'),
              }}
            />
            <span className="ml-auto text-[11px] text-slate-400">
              Member since {fmtDate(member.date_joined)} · record #{memberId}
            </span>
          </div>
        ) : null}
      </Card>

      <LinkTabs items={TABS.map((t) => ({ href: `/members/${memberId}?tab=${t.key}`, label: t.label }))} />

      {/* ---------------------------------------------------------- OVERVIEW */}
      {activeTab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader title="Membership snapshot" icon={<Users className="h-[18px] w-[18px]" />} />
              <KeyValue
                columns={3}
                items={[
                  ['CMA number', <span className="font-semibold">{member.membership_no}</span>],
                  ['Status', <StatusBadge status={member.membership_status} />],
                  ['Membership type', <span className="capitalize">{member.membership_type}</span>],
                  ['Date joined', fmtDate(member.date_joined)],
                  ['Parish', member.parish_name],
                  ['Church / outstation', member.church_name || '—'],
                  ['SCC', member.scc_name || '—'],
                  ['Phone', sensitive ? phoneDisplay(member.phone) : 'Restricted'],
                  ['Email', member.email || '—'],
                ]}
              />
            </Card>

            <Card>
              <CardHeader
                title="Contribution performance"
                subtitle="Last 12 billed periods"
                icon={<CalendarClock className="h-[18px] w-[18px]" />}
                action={<Link href={`/members/${memberId}?tab=contributions`} className="btn-ghost btn-sm">Details</Link>}
              />
              {contributions.length ? (
                <>
                  <ProgressBar
                    value={num(balances.monthly_paid)}
                    total={Math.max(num(balances.monthly_due_total), 1)}
                    label={`Paid ${money(balances.monthly_paid)} of ${money(balances.monthly_due_total)} billed (${percent(balances.monthly_paid, balances.monthly_due_total)}%)`}
                    color="#16a34a"
                  />
                  <Table compact className="mt-3">
                    <thead>
                      <tr><Th>Period</Th><Th align="right">Due</Th><Th align="right">Paid</Th><Th align="right">Penalty</Th><Th>Status</Th></tr>
                    </thead>
                    <tbody>
                      {contributions.slice(0, 8).map((c: any) => (
                        <tr key={c.id}>
                          <Td className="font-medium">{c.period_label || periodLabel(c.period)}</Td>
                          <Td align="right">{money(c.amount_due)}</Td>
                          <Td align="right" className="font-semibold">{money(c.amount_paid)}</Td>
                          <Td align="right" className={num(c.penalty) > 0 ? 'text-red-600' : ''}>{money(c.penalty)}</Td>
                          <Td><StatusBadge status={c.status} /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              ) : (
                <EmptyState title="No contributions billed yet" description="Monthly bills are generated by the Treasurer." icon={<CalendarClock className="h-5 w-5" />} />
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="SDP / Sacco" icon={<Landmark className="h-[18px] w-[18px]" />} action={<Link href={`/members/${memberId}?tab=sacco`} className="btn-ghost btn-sm">Open</Link>} />
              {account ? (
                <>
                  <KeyValue
                    columns={1}
                    items={[
                      ['Account number', <span className="font-mono text-xs">{account.account_no}</span>],
                      ['Savings balance', <Money value={account.savings_balance} />],
                      ['Share capital', <Money value={account.share_capital} />],
                      ['Shares held', `${account.shares_count}`],
                      ['Loan outstanding', <Money value={account.loan_outstanding} />],
                      ['Account status', <StatusBadge status={account.status} />],
                    ]}
                  />
                  <p className="mt-2 text-[11px] text-slate-400">Opened {fmtDateTime(account.opened_at)}</p>
                </>
              ) : (
                <EmptyState title="No sacco account" description="Open an SDP/Sacco account to start saving and borrowing." icon={<Landmark className="h-5 w-5" />} action={can(user, 'sacco.create') ? <Link href={`/members/${memberId}?tab=sacco`} className="btn-primary btn-sm">Open account</Link> : undefined} />
              )}
            </Card>

            <Card>
              <CardHeader title="Attendance" subtitle={`${attendanceStats.present}/${attendanceStats.total} meetings attended`} icon={<ClipboardCheck className="h-[18px] w-[18px]" />} />
              {attendanceStats.total ? (
                <>
                  <ProgressBar value={attendanceStats.present} total={attendanceStats.total} label={`Attendance rate ${Math.round(percent(attendanceStats.present, attendanceStats.total))}%`} color="#0e2340" />
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <MiniBox label="Present" value={attendanceStats.present} tone="green" />
                    <MiniBox label="Apology" value={attendanceStats.apology} tone="blue" />
                    <MiniBox label="Absent" value={attendanceStats.absent} tone="red" />
                  </div>
                </>
              ) : (
                <EmptyState title="No attendance records" icon={<ClipboardCheck className="h-5 w-5" />} />
              )}
            </Card>

            <Card>
              <CardHeader title="Welfare & support" icon={<HeartPulse className="h-[18px] w-[18px]" />} />
              <KeyValue
                columns={1}
                items={[
                  ['Welfare given', <Money value={balances.welfare_paid} />],
                  ['Funeral contributions', <Money value={balances.funeral_paid} />],
                  ['Wedding contributions', <Money value={balances.wedding_paid} />],
                  ['Projects & special', <Money value={balances.project_paid} />],
                  ['Guarantees given', `${balances.guarantees_active} loan(s) · ${money(balances.guaranteed_amount)}`],
                ]}
              />
            </Card>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- PERSONAL */}
      {activeTab === 'personal' ? (
        <Card>
          <CardHeader title="Personal & bio data" subtitle="As captured during registration" icon={<UserCheck className="h-[18px] w-[18px]" />} />
          <KeyValue
            columns={3}
            items={[
              ['Salutation', member.salutation || '—'],
              ['First name', member.first_name || '—'],
              ['Middle name', member.middle_name || '—'],
              ['Last name', member.last_name || '—'],
              ['Full name', member.full_name],
              ['Gender', <span className="capitalize">{member.gender}</span>],
              ['Date of birth', member.date_of_birth ? `${fmtDate(member.date_of_birth)} (${age(member.date_of_birth)} yrs)` : '—'],
              ['Marital status', <span className="capitalize">{member.marital_status}</span>],
              ['Baptism date', member.baptism_date ? fmtDate(member.baptism_date) : '—'],
              ['Occupation', member.occupation || '—'],
              ['Employer / business', member.employer || '—'],
              ['KRA PIN', sensitive ? member.kra_pin || '—' : 'Restricted'],
              ['National ID', sensitive ? (member.national_id_last4 ? `••••${member.national_id_last4}` : '—') : 'Restricted'],
              ['Passport', sensitive ? (member.passport_enc ? 'On file (encrypted)' : '—') : 'Restricted'],
              ['Photo on file', member.photo_url ? 'Yes' : 'No'],
            ]}
          />
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy-700" />
            National ID and passport numbers are stored encrypted (AES-256-GCM) with only the last four digits shown.
            Access to this record is logged in the audit trail as required by the Kenya Data Protection Act, 2019.
          </p>
          {member.notes ? (
            <div className="mt-4">
              <p className="label">Committee notes</p>
              <p className="whitespace-pre-wrap rounded-lg bg-amber-50/60 px-3 py-2 text-xs text-slate-700">{member.notes}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- CONTACT */}
      {activeTab === 'contact' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Contact details" icon={<Phone className="h-[18px] w-[18px]" />} />
            <KeyValue
              columns={1}
              items={[
                ['Mobile phone (M-Pesa)', <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />{sensitive ? phoneDisplay(member.phone) : 'Restricted'}</span>],
                ['Alternative phone', member.alt_phone ? phoneDisplay(member.alt_phone) : '—'],
                ['Email address', member.email ? <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-slate-400" />{member.email}</span> : '—'],
                ['Residential area', member.residential_area ? <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400" />{member.residential_area}</span> : '—'],
                ['Postal address', member.address || '—'],
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {member.phone ? <a className="btn-outline btn-sm" href={`tel:${member.phone}`}><Phone className="h-4 w-4" /> Call</a> : null}
              {member.phone ? <a className="btn-outline btn-sm" href={`sms:${member.phone}`}><Phone className="h-4 w-4" /> SMS</a> : null}
              {member.phone ? <a className="btn-outline btn-sm" href={`https://wa.me/${String(member.phone).replace(/^0/, '254')}`} target="_blank" rel="noreferrer"><HandHeart /> WhatsApp</a> : null}
              {member.email ? <a className="btn-outline btn-sm" href={`mailto:${member.email}`}><Mail className="h-4 w-4" /> Email</a> : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Next of kin & emergency contacts" subtitle="Used for welfare, hospitalisation and bereavement response" icon={<Users className="h-[18px] w-[18px]" />} />
            <KeyValue
              columns={2}
              items={[
                ['Next of kin', member.next_of_kin || '—'],
                ['Relationship', member.next_of_kin_relation || '—'],
                ['Next of kin phone', member.next_of_kin_phone ? phoneDisplay(member.next_of_kin_phone) : '—'],
                ['Emergency contact', member.emergency_contact || '—'],
                ['Emergency relationship', member.emergency_contact_rel || '—'],
                ['Emergency phone', member.emergency_contact_phone ? phoneDisplay(member.emergency_contact_phone) : '—'],
              ]}
            />
            {!member.next_of_kin && !member.emergency_contact ? (
              <div className="alert alert-warn mt-3">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p className="text-xs">No next of kin captured. Please update this record so the CMA can respond quickly in an emergency.</p>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- CHURCH */}
      {activeTab === 'church' ? (
        <Card>
          <CardHeader title="Church & organisational structure" subtitle="Country → archdiocese/diocese → deanery → parish → church/outstation → SCC → member" icon={<Church className="h-[18px] w-[18px]" />} />
          <div className="space-y-2">
            <LevelRow level="Country" name="Kenya" detail="KES · +254" />
            <LevelRow level="Diocese / Archdiocese" name={member.diocese_name} />
            <LevelRow level="Deanery" name={member.deanery_name} />
            <LevelRow level="Parish" name={member.parish_name} detail={member.parish_code ? `Code ${member.parish_code}` : undefined} />
            <LevelRow level="Church / Outstation" name={member.church_name} />
            <LevelRow level="Small Christian Community" name={member.scc_name} />
            <LevelRow level="Member" name={member.full_name} detail={member.membership_no} highlight />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MiniBox label="Parish" value={member.parish_name || '—'} />
            <MiniBox label="Church" value={member.church_name || '—'} />
            <MiniBox label="SCC" value={member.scc_name || '—'} />
          </div>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- MEMBERSHIP */}
      {activeTab === 'membership' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Membership record" icon={<Users className="h-[18px] w-[18px]" />} />
            <KeyValue
              columns={2}
              items={[
                ['CMA number', <span className="font-mono text-xs font-bold">{member.membership_no}</span>],
                ['Membership status', <StatusBadge status={member.membership_status} />],
                ['Membership type', <span className="capitalize">{member.membership_type}</span>],
                ['Date joined', fmtDate(member.date_joined)],
                ['Exempt from monthly contributions', member.exempt_monthly ? `Yes — ${member.exemption_reason || 'no reason recorded'}` : 'No'],
                ['Record created', fmtDateTime(member.created_at)],
                ['Last updated', fmtDateTime(member.updated_at)],
                ['Archived', member.deleted_at ? fmtDateTime(member.deleted_at) : 'No'],
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Online account & security" subtitle="Login, roles and two-factor status" icon={<KeyRound className="h-[18px] w-[18px]" />} />
            {member.user_status ? (
              <KeyValue
                columns={1}
                items={[
                  ['Login account', 'Active'],
                  ['Account status', <StatusBadge status={member.user_status} />],
                  ['System role', member.role_name || 'Member'],
                  ['Login email', member.user_email || member.email || '—'],
                  ['Login phone', sensitive ? phoneDisplay(member.phone) : 'Restricted'],
                  ['Login identifiers', 'Phone number, email address or CMA number'],
                ]}
              />
            ) : (
              <EmptyState
                title="No online account"
                description="Create a login so this member can view their dashboard, pay by M-Pesa STK push and apply for loans."
                icon={<KeyRound className="h-5 w-5" />}
                action={can(user, 'users.create') ? <Link href="/admin/users" className="btn-primary btn-sm">Create account</Link> : undefined}
              />
            )}
          </Card>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- CONTRIBUTIONS */}
      {activeTab === 'contributions' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total paid" value={money(balances.monthly_paid)} sub="monthly contributions" tone="green" icon={<HandCoins className="h-4 w-4" />} />
            <StatCard label="Total billed" value={money(balances.monthly_due_total)} sub={`${contributions.length} period(s)`} icon={<CalendarClock className="h-4 w-4" />} />
            <StatCard label="Outstanding" value={money(balances.monthly_outstanding)} sub={`${balances.unpaid_periods} unpaid · ${balances.overdue_periods} overdue`} tone={num(balances.monthly_outstanding) > 0 ? 'red' : 'green'} icon={<AlertTriangle className="h-4 w-4" />} />
            <StatCard label="Penalties" value={money(balances.contribution_penalties)} sub="late payment penalties" tone="gold" icon={<AlertTriangle className="h-4 w-4" />} />
          </div>

          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="card-title">Monthly contribution ledger</h2>
                <p className="card-sub">Every billed period with amounts due, paid and penalties</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/api/documents/statement?member=${memberId}`} className="btn-outline btn-sm"><Download className="h-4 w-4" /> Statement PDF</Link>
                {canPay ? <PayNowButton memberId={memberId} phone={member.phone} obligations={obligations} label="Pay arrears" className="btn-gold" /> : null}
              </div>
            </div>
            {contributions.length ? (
              <Table>
                <thead>
                  <tr><Th>Period</Th><Th>Type</Th><Th>Due date</Th><Th align="right">Due</Th><Th align="right">Paid</Th><Th align="right">Balance</Th><Th align="right">Penalty</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {contributions.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <Td className="font-semibold">{c.period_label || periodLabel(c.period)}</Td>
                      <Td className="text-xs text-slate-500">{c.type_name}</Td>
                      <Td className="text-xs">{fmtDate(c.due_date)}</Td>
                      <Td align="right">{money(c.amount_due)}</Td>
                      <Td align="right" className="font-semibold">{money(c.amount_paid)}</Td>
                      <Td align="right" className={num(c.amount_due) - num(c.amount_paid) > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600'}>
                        {money(Math.max(0, num(c.amount_due) - num(c.amount_paid)))}
                      </Td>
                      <Td align="right" className={num(c.penalty) > 0 ? 'text-amber-600' : ''}>{money(c.penalty)}</Td>
                      <Td><StatusBadge status={c.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div className="p-4"><EmptyState title="No contributions billed" description="Monthly bills appear here once the Treasurer generates them." icon={<CalendarClock className="h-5 w-5" />} /></div>
            )}
          </Card>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- PAYMENTS */}
      {activeTab === 'payments' ? (
        <div className="space-y-4">
          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="card-title">Payments</h2>
                <p className="card-sub">All channels: M-Pesa, Airtel, bank, cash and manual entries</p>
              </div>
              {can(user, 'payments.create') ? <Link href={`/payments/new?member=${memberId}`} className="btn-primary btn-sm"><Wallet className="h-4 w-4" /> Record payment</Link> : null}
            </div>
            {payments.length ? (
              <Table>
                <thead>
                  <tr><Th>Date</Th><Th>Receipt</Th><Th>Method</Th><Th>Category</Th><Th align="right">Amount</Th><Th align="right">Allocated</Th><Th>Status</Th><Th>By</Th></tr>
                </thead>
                <tbody>
                  {payments.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <Td className="text-xs">{fmtDateTime(p.payment_date)}</Td>
                      <Td><Link href={`/payments/${p.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{p.receipt_no}</Link></Td>
                      <Td><Badge tone="badge-grey">{p.method}</Badge></Td>
                      <Td className="text-xs text-slate-500">{p.category || '—'}</Td>
                      <Td align="right" className="font-bold">{money(p.amount)}</Td>
                      <Td align="right">{money(p.allocated_amount)}</Td>
                      <Td><StatusBadge status={p.status} /></Td>
                      <Td className="text-xs text-slate-500">{p.recorded_by_name || 'System'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div className="p-4"><EmptyState title="No payments recorded" icon={<Wallet className="h-5 w-5" />} /></div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card padded={false}>
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="card-title">Receipts</h2>
                <p className="card-sub">Official CMA receipts — downloadable as PDF</p>
              </div>
              {receipts.length ? (
                <Table compact>
                  <thead><tr><Th>Receipt</Th><Th>Category</Th><Th align="right">Amount</Th><Th>Date</Th><Th align="center">PDF</Th></tr></thead>
                  <tbody>
                    {receipts.map((r: any) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <Td className="font-mono text-xs font-semibold">{r.receipt_no}</Td>
                        <Td className="text-xs capitalize">{r.category}</Td>
                        <Td align="right" className="font-bold">{money(r.amount)}</Td>
                        <Td className="text-xs">{fmtDate(r.issued_at)}</Td>
                        <Td align="center">
                          <Link href={`/api/documents/receipt?receipt=${r.receipt_no}`} className="btn-ghost btn-sm"><Download className="h-3.5 w-3.5" /></Link>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <div className="p-4"><EmptyState title="No receipts yet" icon={<FileText className="h-5 w-5" />} /></div>
              )}
            </Card>

            <Card padded={false}>
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="card-title">Penalties</h2>
                <p className="card-sub">Late contribution and loan penalties</p>
              </div>
              {penalties.length ? (
                <Table compact>
                  <thead><tr><Th>Type</Th><Th>Period</Th><Th align="right">Amount</Th><Th align="right">Paid</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {penalties.map((p: any) => (
                      <tr key={p.id}>
                        <Td className="text-xs">{String(p.penalty_type).replace(/_/g, ' ')}</Td>
                        <Td className="text-xs">{p.period ? periodLabel(p.period) : '—'}</Td>
                        <Td align="right" className="font-bold">{money(p.amount)}</Td>
                        <Td align="right">{money(p.amount_paid)}</Td>
                        <Td><StatusBadge status={p.status} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <div className="p-4"><EmptyState title="No penalties" description="This member has never been penalised. Asante!" icon={<ShieldCheck className="h-5 w-5" />} /></div>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- WELFARE */}
      {activeTab === 'welfare' ? (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="card-title">Welfare (sick member) cases</h2>
              <p className="card-sub">Cases raised for this member and cases they contributed to</p>
            </div>
            {can(user, 'welfare.create') ? <Link href="/welfare/new" className="btn-primary btn-sm"><HeartPulse className="h-4 w-4" /> Raise a case</Link> : null}
          </div>
          {welfare.length ? (
            <Table>
              <thead><tr><Th>Case</Th><Th>Member</Th><Th>Category</Th><Th>Hospital</Th><Th align="right">Per member</Th><Th align="right">Collected</Th><Th align="right">Disbursed</Th><Th>Status</Th></tr></thead>
              <tbody>
                {welfare.map((c: any) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td><Link href={`/welfare/${c.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{c.case_no}</Link><span className="block text-[10px] text-slate-400">{fmtDate(c.opening_date)}</span></Td>
                    <Td className="text-xs">{c.beneficiary}</Td>
                    <Td className="text-xs capitalize">{String(c.category).replace(/_/g, ' ')}</Td>
                    <Td className="text-xs">{c.hospital || '—'}</Td>
                    <Td align="right">{money(c.amount_per_member)}</Td>
                    <Td align="right" className="font-semibold">{money(c.amount_collected)}</Td>
                    <Td align="right">{money(c.amount_disbursed)}</Td>
                    <Td><StatusBadge status={c.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-4"><EmptyState title="No welfare cases" description="Welfare cases raised for or contributed to by this member appear here." icon={<HeartPulse className="h-5 w-5" />} /></div>
          )}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- FUNERALS */}
      {activeTab === 'funerals' ? (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="card-title">Funeral / bereavement contributions</h2>
              <p className="card-sub">Member, spouse, child, parent or dependant</p>
            </div>
            {can(user, 'funerals.create') ? <Link href="/funerals/new" className="btn-primary btn-sm"><Cross className="h-4 w-4" /> Report a death</Link> : null}
          </div>
          {funerals.length ? (
            <Table>
              <thead><tr><Th>Case</Th><Th>Deceased</Th><Th>Relationship</Th><Th>Date of death</Th><Th>Burial</Th><Th align="right">Per member</Th><Th align="right">Collected</Th><Th>Status</Th></tr></thead>
              <tbody>
                {funerals.map((c: any) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td><Link href={`/funerals/${c.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{c.case_no}</Link><span className="block text-[10px] text-slate-400">{c.member_name}</span></Td>
                    <Td className="text-xs font-medium">{c.deceased_name}</Td>
                    <Td className="text-xs capitalize">{String(c.relationship).replace(/_/g, ' ')}</Td>
                    <Td className="text-xs">{fmtDate(c.date_of_death)}</Td>
                    <Td className="text-xs">{c.burial_place || '—'}</Td>
                    <Td align="right">{money(c.amount_per_member)}</Td>
                    <Td align="right" className="font-semibold">{money(c.amount_collected)}</Td>
                    <Td><StatusBadge status={c.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-4"><EmptyState title="No funeral cases" icon={<Cross className="h-5 w-5" />} /></div>
          )}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- WEDDINGS */}
      {activeTab === 'weddings' ? (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="card-title">Wedding contributions</h2>
              <p className="card-sub">Support for members getting married</p>
            </div>
            {can(user, 'weddings.create') ? <Link href="/weddings/new" className="btn-primary btn-sm"><HeartHandshake className="h-4 w-4" /> Register wedding</Link> : null}
          </div>
          {weddings.length ? (
            <Table>
              <thead><tr><Th>Case</Th><Th>Member</Th><Th>Spouse</Th><Th>Wedding date</Th><Th>Venue</Th><Th align="right">Per member</Th><Th align="right">Collected</Th><Th>Status</Th></tr></thead>
              <tbody>
                {weddings.map((c: any) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td><Link href={`/weddings/${c.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{c.case_no}</Link></Td>
                    <Td className="text-xs">{c.member_name}</Td>
                    <Td className="text-xs">{c.spouse_name || '—'}</Td>
                    <Td className="text-xs">{fmtDate(c.wedding_date)}</Td>
                    <Td className="text-xs">{c.venue || '—'}</Td>
                    <Td align="right">{money(c.amount_per_member)}</Td>
                    <Td align="right" className="font-semibold">{money(c.amount_collected)}</Td>
                    <Td><StatusBadge status={c.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-4"><EmptyState title="No wedding cases" icon={<Gem className="h-5 w-5" />} /></div>
          )}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- PROJECTS */}
      {activeTab === 'projects' ? (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="card-title">Projects & special contributions</h2>
              <p className="card-sub">Unlimited administrator-defined project categories</p>
            </div>
            {can(user, 'projects.create') ? <Link href="/projects/new" className="btn-primary btn-sm"><HandCoins className="h-4 w-4" /> New project</Link> : null}
          </div>
          {projects.length ? (
            <Table>
              <thead><tr><Th>Project</Th><Th>Category</Th><Th>Start</Th><Th align="right">Target</Th><Th align="right">Collected</Th><Th align="right">My pledge</Th><Th align="right">My paid</Th><Th>My status</Th></tr></thead>
              <tbody>
                {projects.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td><Link href={`/projects/${p.id}`} className="text-xs font-semibold text-navy-900 hover:underline">{p.name}</Link><span className="block text-[10px] text-slate-400">{p.project_no}</span></Td>
                    <Td className="text-xs capitalize">{String(p.category).replace(/_/g, ' ')}</Td>
                    <Td className="text-xs">{fmtDate(p.start_date)}</Td>
                    <Td align="right">{money(p.target_amount)}</Td>
                    <Td align="right" className="font-semibold">{money(p.amount_collected)}</Td>
                    <Td align="right">{p.my_pledged ? money(p.my_pledged) : '—'}</Td>
                    <Td align="right">{p.my_paid ? money(p.my_paid) : '—'}</Td>
                    <Td>{p.my_status ? <StatusBadge status={p.my_status} /> : <span className="text-xs text-slate-400">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-4"><EmptyState title="No projects" icon={<HandCoins className="h-5 w-5" />} /></div>
          )}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- SACCO */}
      {activeTab === 'sacco' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Savings balance" value={money(balances.savings_balance)} sub={account?.account_no || 'No account'} icon={<Landmark className="h-4 w-4" />} />
            <StatCard label="Total deposits" value={money(balances.total_deposits)} sub="lifetime deposits" tone="green" icon={<HandCoins className="h-4 w-4" />} />
            <StatCard label="Share capital" value={money(balances.shares_value)} sub={`${balances.shares_count} share(s)`} tone="gold" icon={<Briefcase className="h-4 w-4" />} />
            <StatCard label="Dividends earned" value={money(dividends.reduce((s: number, d: any) => s + num(d.amount), 0))} sub={`${dividends.length} declaration(s)`} icon={<Gem className="h-4 w-4" />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card padded={false}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div><h2 className="card-title">Savings ledger</h2><p className="card-sub">Deposits, withdrawals, interest and dividends</p></div>
                {can(user, 'savings.create') ? <Link href={`/sacco/savings?member=${memberId}`} className="btn-outline btn-sm">Post transaction</Link> : null}
              </div>
              {savings.length ? (
                <Table compact>
                  <thead><tr><Th>Date</Th><Th>Type</Th><Th>Receipt</Th><Th align="right">Amount</Th><Th align="right">Balance</Th></tr></thead>
                  <tbody>
                    {savings.map((s: any) => (
                      <tr key={s.id}>
                        <Td className="text-xs">{fmtDate(s.transaction_date)}</Td>
                        <Td className="text-xs capitalize">{String(s.transaction_type).replace(/_/g, ' ')}</Td>
                        <Td className="font-mono text-[11px] text-slate-500">{s.receipt_no || '—'}</Td>
                        <Td align="right" className={num(s.amount) < 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>{money(s.amount)}</Td>
                        <Td align="right">{money(s.running_balance)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <div className="p-4"><EmptyState title="No savings transactions" icon={<Landmark className="h-5 w-5" />} /></div>
              )}
            </Card>

            <div className="space-y-4">
              <Card padded={false}>
                <div className="border-b border-slate-100 px-4 py-3"><h2 className="card-title">Share certificates</h2><p className="card-sub">Issued share capital</p></div>
                {shares.length ? (
                  <Table compact>
                    <thead><tr><Th>Certificate</Th><Th align="right">Shares</Th><Th align="right">Value/share</Th><Th align="right">Total</Th><Th>Issued</Th><Th align="center">PDF</Th></tr></thead>
                    <tbody>
                      {shares.map((s: any) => (
                        <tr key={s.id}>
                          <Td className="font-mono text-[11px] font-semibold">{s.certificate_no}</Td>
                          <Td align="right">{s.shares_count}</Td>
                          <Td align="right">{money(s.value_per_share)}</Td>
                          <Td align="right" className="font-bold">{money(s.total_value)}</Td>
                          <Td className="text-xs">{fmtDate(s.issued_date)}</Td>
                          <Td align="center"><Link href={`/api/documents/share-certificate?share=${s.id}`} className="btn-ghost btn-sm"><Download className="h-3.5 w-3.5" /></Link></Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <div className="p-4"><EmptyState title="No shares issued" icon={<Briefcase className="h-5 w-5" />} /></div>
                )}
              </Card>

              <Card padded={false}>
                <div className="border-b border-slate-100 px-4 py-3"><h2 className="card-title">Dividends</h2><p className="card-sub">Declared dividends on shareholding</p></div>
                {dividends.length ? (
                  <Table compact>
                    <thead><tr><Th>Year</Th><Th align="right">Shares</Th><Th align="right">Amount</Th><Th>Status</Th></tr></thead>
                    <tbody>
                      {dividends.map((d: any) => (
                        <tr key={d.id}>
                          <Td className="text-xs font-semibold">{d.financial_year}</Td>
                          <Td align="right">{d.shares_held}</Td>
                          <Td align="right" className="font-bold">{money(d.amount)}</Td>
                          <Td><StatusBadge status={d.alloc_status} /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <div className="p-4"><EmptyState title="No dividends yet" icon={<Gem className="h-5 w-5" />} /></div>
                )}
              </Card>

              {shareTx.length ? (
                <Card padded={false}>
                  <div className="border-b border-slate-100 px-4 py-3"><h2 className="card-title">Share transactions</h2></div>
                  <Table compact>
                    <thead><tr><Th>Date</Th><Th>Type</Th><Th align="right">Shares</Th><Th align="right">Amount</Th></tr></thead>
                    <tbody>
                      {shareTx.map((t: any) => (
                        <tr key={t.id}>
                          <Td className="text-xs">{fmtDate(t.transaction_date)}</Td>
                          <Td className="text-xs capitalize">{String(t.transaction_type).replace(/_/g, ' ')}{t.other_member ? ` · ${t.other_member}` : ''}</Td>
                          <Td align="right">{t.shares_count}</Td>
                          <Td align="right" className="font-semibold">{money(t.amount)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- LOANS */}
      {activeTab === 'loans' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Borrowed" value={money(balances.loan_borrowed)} sub="lifetime principal" icon={<Banknote className="h-4 w-4" />} />
            <StatCard label="Repaid" value={money(balances.loan_repaid)} sub="principal + interest" tone="green" icon={<HandCoins className="h-4 w-4" />} />
            <StatCard label="Outstanding" value={money(balances.loan_outstanding)} sub={`${balances.active_loans} active loan(s)`} tone={num(balances.loan_outstanding) > 0 ? 'gold' : 'green'} icon={<Banknote className="h-4 w-4" />} />
            <StatCard label="Guarantees given" value={money(balances.guaranteed_amount)} sub={`${balances.guarantees_active} loan(s) guaranteed`} tone="red" icon={<ShieldCheck className="h-4 w-4" />} />
          </div>

          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div><h2 className="card-title">Loans</h2><p className="card-sub">Disbursed loans with repayment progress</p></div>
              <div className="flex gap-2">
                {can(user, 'loans.create') ? <Link href={`/loans/apply?member=${memberId}`} className="btn-outline btn-sm">New application</Link> : null}
                {can(user, 'loans.approve') ? <Link href="/loans/approvals" className="btn-primary btn-sm">Approvals</Link> : null}
              </div>
            </div>
            {loans.length ? (
              <Table>
                <thead><tr><Th>Loan</Th><Th>Product</Th><Th align="right">Principal</Th><Th align="right">Interest</Th><Th align="right">Repayable</Th><Th align="right">Paid</Th><Th align="right">Balance</Th><Th>Progress</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {loans.map((l: any) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <Td><Link href={`/loans/${l.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{l.loan_no}</Link><span className="block text-[10px] text-slate-400">{fmtDate(l.disbursed_at)}</span></Td>
                      <Td className="text-xs">{l.loan_type_name}<span className="block text-[10px] text-slate-400">{l.term_months} mo · {num(l.interest_rate)}%</span></Td>
                      <Td align="right">{money(l.principal)}</Td>
                      <Td align="right">{money(l.total_interest)}</Td>
                      <Td align="right">{money(l.total_repayable)}</Td>
                      <Td align="right" className="font-semibold text-emerald-600">{money(l.amount_paid)}</Td>
                      <Td align="right" className="font-bold">{money(l.outstanding_balance)}</Td>
                      <Td className="w-32"><ProgressBar value={num(l.amount_paid)} total={Math.max(num(l.total_repayable), 1)} color="#16a34a" /></Td>
                      <Td><StatusBadge status={l.status} />{num(l.arrears) > 0 ? <span className="badge-red mt-1 block w-fit">arrears {money(l.arrears)}</span> : null}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div className="p-4"><EmptyState title="No loans disbursed" description="This member has not borrowed from the CMA sacco." icon={<Banknote className="h-5 w-5" />} /></div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card padded={false}>
              <div className="border-b border-slate-100 px-4 py-3"><h2 className="card-title">Loan applications</h2><p className="card-sub">Workflow history</p></div>
              {applications.length ? (
                <Table compact>
                  <thead><tr><Th>Application</Th><Th>Product</Th><Th align="right">Requested</Th><Th>Months</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {applications.map((a: any) => (
                      <tr key={a.id}>
                        <Td><Link href={`/loans/applications/${a.id}`} className="font-mono text-[11px] font-semibold hover:underline">{a.application_no}</Link><span className="block text-[10px] text-slate-400">{fmtDate(a.applied_at)}</span></Td>
                        <Td className="text-xs">{a.loan_type_name}</Td>
                        <Td align="right" className="font-semibold">{money(a.amount_requested)}</Td>
                        <Td className="text-xs">{a.repayment_months}</Td>
                        <Td><StatusBadge status={a.status} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <div className="p-4"><EmptyState title="No applications" icon={<FileText className="h-5 w-5" />} /></div>
              )}
            </Card>

            <Card padded={false}>
              <div className="border-b border-slate-100 px-4 py-3"><h2 className="card-title">Guarantees given</h2><p className="card-sub">Loans this member is guaranteeing</p></div>
              {guarantees.length ? (
                <Table compact>
                  <thead><tr><Th>Application</Th><Th>Borrower</Th><Th align="right">Guaranteed</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {guarantees.map((g: any) => (
                      <tr key={g.id}>
                        <Td className="font-mono text-[11px]">{g.application_no}</Td>
                        <Td className="text-xs">{g.borrower}</Td>
                        <Td align="right" className="font-semibold">{money(g.amount_guaranteed)}</Td>
                        <Td><StatusBadge status={g.status} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <div className="p-4"><EmptyState title="No guarantees" description="This member is not guaranteeing any loan." icon={<ShieldCheck className="h-5 w-5" />} /></div>
              )}
            </Card>
          </div>

          {loanTypes.length ? (
            <Card>
              <CardHeader title="Available loan products" subtitle="What this member can apply for" icon={<Banknote className="h-[18px] w-[18px]" />} action={<Link href="/loans/types" className="btn-ghost btn-sm">Configure</Link>} />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {loanTypes.map((t: any) => (
                  <div key={t.id} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="text-xs font-bold text-navy-900">{t.name}</p>
                    <p className="text-[10px] text-slate-500">{t.code}</p>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* ---------------------------------------------------------- RECORDS */}
      {activeTab === 'records' ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card padded={false}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div><h2 className="card-title">Attendance</h2><p className="card-sub">{attendanceStats.present} present · {attendanceStats.apology} apology · {attendanceStats.absent} absent</p></div>
                <Link href="/attendance" className="btn-ghost btn-sm">Attendance register</Link>
              </div>
              {attendance.length ? (
                <Table compact>
                  <thead><tr><Th>Meeting</Th><Th>Date</Th><Th>Type</Th><Th>Status</Th><Th>Check-in</Th></tr></thead>
                  <tbody>
                    {attendance.map((a: any) => (
                      <tr key={a.id}>
                        <Td><Link href={`/meetings/${a.meeting_id}`} className="text-xs font-medium text-navy-900 hover:underline">{a.title}</Link></Td>
                        <Td className="text-xs">{fmtDate(a.meeting_date)}</Td>
                        <Td className="text-xs capitalize">{String(a.meeting_type).replace(/_/g, ' ')}</Td>
                        <Td><StatusBadge status={a.status} /></Td>
                        <Td className="text-[11px] text-slate-500">{a.check_in_time ? fmtDateTime(a.check_in_time) : '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <div className="p-4"><EmptyState title="No attendance records" icon={<ClipboardCheck className="h-5 w-5" />} /></div>
              )}
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Documents" subtitle={`${documents.length} file(s) on record`} icon={<FileText className="h-[18px] w-[18px]" />} />
                {documents.length ? (
                  <ul className="space-y-2">
                    {documents.map((d: any) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                        <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <Link href={`/api/documents/file?url=${encodeURIComponent(d.file_url)}`} className="block truncate text-xs font-semibold text-navy-900 hover:underline" target="_blank">
                            {d.title}
                          </Link>
                          <p className="truncate text-[10px] text-slate-400">
                            {String(d.doc_type).replace(/_/g, ' ')} · {d.file_name} · {((d.size_bytes || 0) / 1024).toFixed(0)} KB · {fmtDate(d.created_at)}
                          </p>
                        </div>
                        {d.verified ? <Badge tone="badge-green">Verified</Badge> : <Badge tone="badge-amber">Unverified</Badge>}
                        <DocumentRowActions
                          documentId={d.id}
                          verified={Boolean(d.verified)}
                          canVerify={can(user, 'documents.update')}
                          canDelete={can(user, 'documents.delete')}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No documents uploaded" description="Upload ID copies, baptism certificates, payslips or title deeds." icon={<FileText className="h-5 w-5" />} />
                )}
                {(can(user, 'documents.create') || isSelf) ? (
                  <div className="mt-4">
                    <DocumentUploadForm memberId={memberId} />
                  </div>
                ) : null}
              </Card>

              <Card>
                <CardHeader title="Notifications sent" subtitle="SMS, email and in-system messages" icon={<Mail className="h-[18px] w-[18px]" />} />
                {notifications.length ? (
                  <ul className="space-y-1.5">
                    {notifications.map((n: any) => (
                      <li key={n.id} className={`rounded-lg border px-3 py-2 ${n.read_at ? 'border-slate-200' : 'border-gold-300 bg-gold-50/40'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-navy-900">{n.title}</p>
                          <span className="shrink-0 text-[10px] text-slate-400">{relativeTime(n.created_at)}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No notifications" icon={<Mail className="h-5 w-5" />} />
                )}
              </Card>
            </div>
          </div>

          {audit.length ? (
            <Card padded={false}>
              <div className="border-b border-slate-100 px-4 py-3"><h2 className="card-title">Audit trail</h2><p className="card-sub">Every change to this member record — permanently retained</p></div>
              <Table compact>
                <thead><tr><Th>When</Th><Th>Action</Th><Th>Description</Th><Th>By</Th><Th>Severity</Th></tr></thead>
                <tbody>
                  {audit.map((a: any) => (
                    <tr key={a.id}>
                      <Td className="whitespace-nowrap text-[11px]">{fmtDateTime(a.created_at)}</Td>
                      <Td className="font-mono text-[11px]">{a.action}</Td>
                      <Td className="text-xs">{a.description}</Td>
                      <Td className="text-xs">{a.user_name || 'System'}</Td>
                      <Td><Badge tone={a.severity === 'critical' ? 'badge-red' : a.severity === 'warning' ? 'badge-amber' : 'badge-grey'}>{a.severity}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'green' | 'red' | 'gold' | 'navy' }) {
  const tones: Record<string, string> = { green: 'text-emerald-600', red: 'text-red-600', gold: 'text-gold-700', navy: 'text-navy-900' };
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-base font-extrabold tabular-nums ${tone ? tones[tone] : 'text-navy-900'}`}>{value}</p>
      {sub ? <p className="truncate text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function MiniBox({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'green' | 'red' | 'blue' }) {
  const tones: Record<string, string> = { green: 'text-emerald-600', red: 'text-red-600', blue: 'text-blue-600' };
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-extrabold tabular-nums ${tone ? tones[tone] : 'text-navy-900'}`}>{value}</p>
    </div>
  );
}

function LevelRow({ level, name, detail, highlight }: { level: string; name?: string | null; detail?: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${highlight ? 'border-gold-400 bg-gold-50/60' : 'border-slate-200'}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-[10px] font-bold text-navy-800">
        <Church className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{level}</p>
        <p className="truncate text-sm font-semibold text-navy-900">{name || '—'}</p>
      </div>
      {detail ? <span className="shrink-0 text-[11px] text-slate-500">{detail}</span> : null}
    </div>
  );
}

function HandHeart() {
  return <HeartHandshake className="h-4 w-4" />;
}

export { isoDate, Cake };
