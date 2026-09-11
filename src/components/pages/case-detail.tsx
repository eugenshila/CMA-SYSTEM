import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Heart, Flower, Gem, Hammer, Wallet, Users, ArrowUpRight, Inbox, Banknote, CalendarDays, MapPin, Stethoscope } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  ProgressBar,
  SectionHeading,
  StatCard,
  Table,
  Td,
  Th,
} from '../ui/primitives';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { CASE_TABLES, caseProgress, type CaseType } from '@/lib/contributions';
import { CASE_META, caseLabel, caseStatusTone } from '@/lib/cases';
import { money, num } from '@/lib/money';
import { fmtDate, isPast } from '@/lib/dates';
import { CaseActions } from '../forms/case-forms';

const ICONS: Record<CaseType, any> = { welfare: Heart, funeral: Flower, wedding: Gem, project: Hammer };

export default async function CaseDetailPage({ type, id, user }: { type: CaseType; id: number; user: SessionUser }) {
  const meta = CASE_META[type];
  if (!can(user, `${meta.permission}.view`)) redirect('/dashboard');

  // Case notices are visible to the CMA community, but a member role must
  // never receive another member's identity, phone number or payment record.
  const memberView = isMember(user);
  if (memberView && !user.member_id) redirect('/dashboard');

  const table = CASE_TABLES[type];
  const refCol = type === 'project' ? 'project_no' : 'case_no';
  const hasMember = type !== 'project';
  const record = await one<any>(
    `SELECT c.*, c.${refCol} AS ref,
            ${hasMember ? 'm.full_name AS member_name, m.membership_no, m.phone AS member_phone,' : 'NULL AS member_name, NULL AS membership_no, NULL AS member_phone,'}
            p.name AS parish_name, ch.name AS church_name, s.name AS scc_name, u.name AS created_by_name
       FROM ${table.cases} c
       ${hasMember ? 'LEFT JOIN members m ON m.id = c.member_id' : ''}
       LEFT JOIN parishes p ON p.id = c.parish_id
       LEFT JOIN churches ch ON ch.id = c.church_id
       LEFT JOIN small_christian_communities s ON s.id = c.scc_id
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id = $1`,
    [id],
  );
  if (!record) notFound();

  const progress = await caseProgress(type, id);
  const memberInScope = memberView
    ? [...progress.contributors, ...progress.non_contributors].some((entry: any) => Number(entry.id) === Number(user.member_id))
    : true;
  if (!memberInScope) notFound();

  const Icon = ICONS[type];
  const collected = num(progress.collected);
  const expected = num(progress.expected);
  const disbursed = num(progress.disbursed);
  const available = Math.max(0, collected - disbursed);
  const outstanding = num(progress.outstanding);
  const perMember = num(record.amount_per_member);

  const canApprove = can(user, `${meta.permission}.approve`);
  const canPay = can(user, 'payments.create');
  const payHref = (memberId: number, amount: number) =>
    `/payments/new?member_id=${memberId}&alloc_type=${type}&alloc_ref=${id}&amount=${amount.toFixed(2)}`;

  const staffDetails: [React.ReactNode, React.ReactNode][] = [
    ...(type === 'welfare'
      ? ([
          ['Category', record.category],
          ['Beneficiary', record.beneficiary_name || record.member_name],
          ['Relationship', record.beneficiary_relationship],
          ['Nature of assistance', record.nature_of_assistance],
          ['Hospital', record.hospital],
          ['Ward / room', record.ward],
          ['Admission date', record.admission_date ? fmtDate(record.admission_date) : null],
          ['Opening date', record.opening_date ? fmtDate(record.opening_date) : null],
          ['Target amount', money(num(record.target_amount))],
        ] as [React.ReactNode, React.ReactNode][])
      : []),
    ...(type === 'funeral'
      ? ([
          ['Deceased', record.deceased_name],
          ['Relationship', record.relationship_other || record.relationship?.replace(/_/g, ' ')],
          ['Date of death', record.date_of_death ? fmtDate(record.date_of_death) : null],
          ['Funeral date', record.funeral_date ? fmtDate(record.funeral_date) : null],
          ['Mortuary', record.mortuary],
          ['Burial place', record.burial_place],
          ['In-kind support', record.in_kind_support],
          ['Total expected', money(num(record.total_expected))],
        ] as [React.ReactNode, React.ReactNode][])
      : []),
    ...(type === 'wedding'
      ? ([
          ['Wedding date', record.wedding_date ? fmtDate(record.wedding_date) : null],
          ['Spouse', record.spouse_name],
          ['Venue', record.venue],
          ['Target amount', money(num(record.target_amount))],
        ] as [React.ReactNode, React.ReactNode][])
      : []),
    ...(type === 'project'
      ? ([
          ['Category', record.category],
          ['Description', record.description],
          ['Start date', record.start_date ? fmtDate(record.start_date) : null],
          ['Event date', record.event_date ? fmtDate(record.event_date) : null],
          ['Committee', record.committee],
          ['Target amount', money(num(record.target_amount))],
        ] as [React.ReactNode, React.ReactNode][])
      : []),
    ['Collection scope', record.scope_type],
    ['Disbursement reference', record.disbursement_reference],
    ['Disbursed on', record.disbursed_at ? fmtDate(record.disbursed_at) : null],
    ['Recorded by', record.created_by_name],
    ['Opened on', fmtDate(record.created_at)],
    ['Notes', record.notes],
  ];

  const title = memberView
    ? type === 'welfare'
      ? 'CMA welfare support'
      : type === 'funeral'
        ? 'CMA bereavement support'
        : type === 'wedding'
          ? 'CMA wedding support'
          : record.name
    : type === 'welfare'
      ? `Welfare — ${record.beneficiary_name || record.member_name}`
      : type === 'funeral'
        ? `Funeral — ${record.deceased_name}`
        : type === 'wedding'
          ? `Wedding — ${record.member_name}${record.spouse_name ? ` & ${record.spouse_name}` : ''}`
          : record.name;
  const details: [React.ReactNode, React.ReactNode][] = memberView
    ? [
        ['Case reference', record.ref],
        ['Status', caseLabel(record.status)],
        ['Your required contribution', money(perMember)],
        ['Deadline', record.deadline ? fmtDate(record.deadline) : '—'],
      ]
    : staffDetails;
  const myContribution = memberView
    ? [...progress.contributors, ...progress.non_contributors].find((entry: any) => Number(entry.id) === Number(user.member_id))
    : null;
  const visibleContributors = memberView
    ? progress.contributors.filter((entry: any) => Number(entry.id) === Number(user.member_id))
    : progress.contributors;
  const visibleNonContributors = memberView
    ? progress.non_contributors.filter((entry: any) => Number(entry.id) === Number(user.member_id))
    : progress.non_contributors;

  return (
    <div className="space-y-5">
      <SectionHeading
        title={title}
        subtitle={memberView
          ? `${meta.label} contribution · ${record.ref}`
          : `${meta.plural} · ${record.ref}${record.parish_name ? ` · ${record.parish_name}` : ''}${record.church_name ? ` · ${record.church_name}` : ''}${record.scc_name ? ` · SCC ${record.scc_name}` : ''}`}
        action={
          <>
            <Link href={meta.route} className="btn btn-outline btn-sm">Back to list</Link>
            {!memberView && can(user, 'documents.view') ? (
              <Link href={`/api/exports/cases?type=${type}&id=${id}&format=pdf`} className="btn btn-outline btn-sm">Case report (PDF)</Link>
            ) : null}
          </>
        }
      />

      <div className={`grid gap-4 sm:grid-cols-2 ${memberView ? 'xl:grid-cols-3' : 'xl:grid-cols-5'}`}>
        {memberView ? (
          <>
            <StatCard label="Your required contribution" value={money(perMember)} tone="navy" icon={<Users className="h-4 w-4" />} />
            <StatCard label="Your amount paid" value={money(num(myContribution?.paid))} tone="green" icon={<Wallet className="h-4 w-4" />} />
            <StatCard label="Your balance" value={money(Math.max(0, perMember - num(myContribution?.paid)))} tone={num(myContribution?.paid) >= perMember ? 'slate' : 'gold'} icon={<Inbox className="h-4 w-4" />} />
          </>
        ) : (
          <>
            <StatCard label="Expected from members" value={money(expected)} tone="navy" icon={<Users className="h-4 w-4" />} sub={`${progress.scope_members} members in scope`} />
            <StatCard label="Collected" value={money(collected)} tone="green" icon={<Wallet className="h-4 w-4" />} sub={`${progress.contributors.length} contributed`} />
            <StatCard label="Outstanding" value={money(outstanding)} tone="red" icon={<Inbox className="h-4 w-4" />} sub={`${progress.non_contributors.length} yet to pay`} />
            <StatCard label="Disbursed" value={money(disbursed)} tone="slate" icon={<ArrowUpRight className="h-4 w-4" />} />
            <StatCard label="Available balance" value={money(available)} tone="gold" icon={<Banknote className="h-4 w-4" />} />
          </>
        )}
      </div>

      <Card>
        <CardHeader title={memberView ? 'Your contribution progress' : 'Collection progress'} action={<Badge tone={caseStatusTone(record.status)}>{caseLabel(record.status)}</Badge>} />
        <ProgressBar
          value={memberView ? num(myContribution?.paid) : collected}
          total={memberView ? perMember || 1 : expected || collected || 1}
          label={memberView ? `${money(num(myContribution?.paid))} of ${money(perMember)}` : `${money(collected)} of ${money(expected)}`}
        />
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1.5"><Icon className="h-4 w-4 text-gold-600" /> {money(perMember)} {memberView ? 'requested from you' : 'per member'}</span>
          {!memberView ? <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-navy-700" /> {progress.scope_members} in scope</span> : null}
          {record.deadline ? (
            <span className={`inline-flex items-center gap-1.5 ${isPast(record.deadline) && record.status === 'open' ? 'font-semibold text-red-600' : ''}`}>
              <CalendarDays className="h-4 w-4" /> Deadline {fmtDate(record.deadline)}
            </span>
          ) : null}
          {!memberView && record.parish_name ? (
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {record.parish_name}</span>
          ) : null}
        </div>
        {!memberView && (canApprove || canPay) ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <CaseActions
              type={type}
              id={id}
              status={record.status}
              available={available}
              outstanding={outstanding}
              canDisburse={canApprove || canPay}
              canApprove={canApprove}
              nonPayers={progress.non_contributors.filter((m: any) => m.outstanding > 0).length}
              caseRef={record.ref}
            />
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Details" />
          <KeyValue items={details} columns={1} />
          {!memberView && type !== 'project' && record.member_id ? (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Member concerned</p>
              <Link href={`/members/${record.member_id}`} className="mt-1 block font-semibold text-navy-900 hover:text-gold-700">{record.member_name}</Link>
              <p className="text-xs text-slate-500">{record.membership_no}{record.member_phone ? ` · ${record.member_phone}` : ''}</p>
              <Link href={`/members/${record.member_id}`} className="btn btn-outline btn-sm mt-3">Open member profile</Link>
            </div>
          ) : null}
          {!memberView && type === 'welfare' && record.hospital ? (
            <p className="mt-4 flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
              <Stethoscope className="h-4 w-4 shrink-0" /> {record.hospital}{record.ward ? ` — ${record.ward}` : ''}
            </p>
          ) : null}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card padded={false}>
            <div className="p-4">
              <CardHeader
                title={memberView ? 'Your payment' : `Members who contributed (${visibleContributors.length})`}
                subtitle={memberView ? `Your required contribution is ${money(perMember)}.` : `Each member was asked for ${money(perMember)}.`}
              />
            </div>
            {visibleContributors.length === 0 ? (
              <div className="p-4 pt-0">
                <EmptyState icon={<Wallet className="h-6 w-6" />} title={memberView ? 'No payment recorded yet' : 'No contributions yet'} description={memberView ? 'Use Pay now from your dashboard to settle this contribution.' : 'Record the first contribution for this case.'} />
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Member</Th>
                    <Th align="right">Paid</Th>
                    <Th>Last payment</Th>
                    <Th align="right">{canPay ? 'Action' : 'Balance'}</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleContributors.map((c: any) => {
                    const owed = Math.max(0, perMember - num(c.paid));
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70">
                        <Td>
                          <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${c.id}`}>{c.full_name}</Link>
                          <div className="text-[11px] text-slate-500">{c.membership_no}</div>
                        </Td>
                        <Td align="right" className="font-semibold text-emerald-700">{money(num(c.paid))}</Td>
                        <Td className="whitespace-nowrap text-xs text-slate-600">{c.last_paid ? fmtDate(c.last_paid) : '—'}</Td>
                        <Td align="right">
                          {owed > 0 && canPay ? (
                            <Link href={payHref(c.id, owed)} className="btn btn-gold btn-sm">Top up {money(owed)}</Link>
                          ) : owed > 0 ? (
                            <span className="text-xs font-semibold text-amber-600">{money(owed)} due</span>
                          ) : (
                            <Badge tone="badge badge-green">Fully paid</Badge>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {visibleNonContributors.length > 0 ? (
            <Card padded={false}>
              <div className="p-4">
                <CardHeader
                  title={memberView ? 'Your outstanding contribution' : `Yet to contribute (${visibleNonContributors.length})`}
                  subtitle={memberView ? 'Use Pay now from your dashboard to settle your contribution.' : 'Send reminders from the actions above, or record a payment on their behalf.'}
                  action={!memberView && canPay ? <Link href={`/payments/new?alloc_type=${type}&alloc_ref=${id}`} className="btn btn-outline btn-sm"><Banknote className="h-4 w-4" /> Record payment</Link> : undefined}
                />
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>Member</Th>
                    <Th>Contact</Th>
                    <Th align="right">Expected</Th>
                    <Th align="right">Paid</Th>
                    <Th align="right">Outstanding</Th>
                    {canPay ? <Th align="right">Action</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleNonContributors.slice(0, 50).map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <Td>
                        <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${c.id}`}>{c.full_name}</Link>
                        <div className="text-[11px] text-slate-500">{c.membership_no}</div>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{c.phone || '—'}</Td>
                      <Td align="right" className="text-slate-500">{money(perMember)}</Td>
                      <Td align="right">{money(num(c.paid))}</Td>
                      <Td align="right" className="font-semibold text-amber-700">{money(num(c.outstanding))}</Td>
                      {canPay ? (
                        <Td align="right">
                          <Link href={payHref(c.id, num(c.outstanding) || perMember)} className="btn btn-outline btn-sm">Pay</Link>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {!memberView && visibleNonContributors.length > 50 ? (
                <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
                  Showing the first 50 of {visibleNonContributors.length} members. Use the export button for the full list.
                </p>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
