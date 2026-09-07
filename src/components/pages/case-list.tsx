import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Heart, Flower, Gem, Hammer, Plus, Users, Wallet, Inbox, ArrowUpRight, Download } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Pagination,
  ProgressBar,
  SectionHeading,
  StatCard,
  Table,
  Td,
  Th,
} from '../ui/primitives';
import { SearchInput, SelectFilter } from '../ui/client';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { CASE_TABLES, type CaseType } from '@/lib/contributions';
import { CASE_META, CASE_STATUSES, caseLabel, caseStatusTone, caseTitle } from '@/lib/cases';
import { money, num } from '@/lib/money';
import { fmtDate, isPast } from '@/lib/dates';

const ICONS: Record<CaseType, any> = { welfare: Heart, funeral: Flower, wedding: Gem, project: Hammer };
const PER_PAGE = 20;

export default async function CaseListPage({
  type,
  user,
  sp,
}: {
  type: CaseType;
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  const meta = CASE_META[type];
  if (!can(user, `${meta.permission}.view`)) redirect('/dashboard');

  const Icon = ICONS[type];
  const table = CASE_TABLES[type];
  const refCol = type === 'project' ? 'project_no' : 'case_no';
  const search = String(sp.search || sp.q || '').trim();
  const status = String(sp.status || '');
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const scopeClause = user.scope_parish_id ? `AND c.parish_id = ${Number(user.scope_parish_id)}` : '';
  const params: any[] = [];
  const where: string[] = ['1=1'];
  if (status) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const col = type === 'project' ? 'c.name' : 'm.full_name';
    where.push(
      `(c.${refCol} ILIKE $${params.length} OR ${col} ILIKE $${params.length}${
        type === 'project' ? '' : ` OR m.membership_no ILIKE $${params.length}`
      })`,
    );
  }
  const whereSql = `${where.join(' AND ')} ${scopeClause}`;
  const hasMember = type !== 'project';
  const memberJoin = hasMember ? 'LEFT JOIN members m ON m.id = c.member_id' : '';
  const memberCols = hasMember ? 'm.full_name AS member_name, m.membership_no, m.id AS member_id,' : 'NULL AS member_name, NULL AS membership_no, NULL AS member_id,';

  const keyDate =
    type === 'welfare' ? 'c.opening_date' : type === 'funeral' ? 'c.date_of_death' : type === 'wedding' ? 'c.wedding_date' : 'c.start_date';
  const expectedCol = type === 'funeral' ? 'COALESCE(c.total_expected,0)' : 'COALESCE(c.target_amount,0)';
  const titleCol =
    type === 'welfare' ? 'c.beneficiary_name' : type === 'funeral' ? 'c.deceased_name' : type === 'wedding' ? 'c.spouse_name' : 'c.name';

  const [rows, countRow, totals, categories] = await Promise.all([
    query<any>(
      `SELECT c.id, c.${refCol} AS ref, c.status, c.amount_per_member, c.amount_collected, c.amount_disbursed,
              c.deadline, ${keyDate} AS key_date, ${expectedCol} AS expected, ${titleCol} AS title,
              ${memberCols} p.name AS parish_name
         FROM ${table.cases} c
         ${memberJoin}
         LEFT JOIN parishes p ON p.id = c.parish_id
        WHERE ${whereSql}
        ORDER BY (c.status = 'open') DESC, c.created_at DESC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(
      `SELECT count(*)::int AS total FROM ${table.cases} c ${memberJoin} WHERE ${whereSql}`,
      params,
    ),
    one<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE c.status IN ('open','in_progress'))::int AS open,
              COALESCE(SUM(c.amount_collected),0) AS collected,
              COALESCE(SUM(c.amount_disbursed),0) AS disbursed
         FROM ${table.cases} c WHERE 1=1 ${scopeClause}`,
    ),
    type === 'project' ? query<any>('SELECT id, name FROM project_categories WHERE active = TRUE ORDER BY name') : Promise.resolve([] as any[]),
  ]);

  const total = Number(countRow?.total || 0);
  const collected = num(totals?.collected);
  const disbursed = num(totals?.disbursed);
  const balance = collected - disbursed;

  return (
    <div className="space-y-5">
      <SectionHeading
        title={meta.plural}
        subtitle="Open a case, invite the members in scope to contribute, track collection and disburse the funds."
        action={
          <>
            {can(user, `${meta.permission}.create`) ? (
              <Link href={`${meta.route}/new`} className="btn btn-primary btn-sm">
                <Plus className="h-4 w-4" /> {meta.newLabel}
              </Link>
            ) : null}
            <Link href={`/api/exports/cases?type=${type}&format=excel`} className="btn btn-outline btn-sm">
              <Download className="h-4 w-4" /> Excel
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`${meta.label}s recorded`} value={String(totals?.total || 0)} tone="navy" icon={<Users className="h-4 w-4" />} />
        <StatCard label="Open now" value={String(totals?.open || 0)} tone="blue" icon={<Inbox className="h-4 w-4" />} />
        <StatCard label="Total collected" value={money(collected)} tone="green" icon={<Wallet className="h-4 w-4" />} />
        <StatCard
          label="Available to disburse"
          value={money(balance)}
          tone="gold"
          icon={<ArrowUpRight className="h-4 w-4" />}
          sub={`${money(disbursed)} already disbursed`}
        />
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader
            title="Records"
            subtitle={search || status ? `${total} matching record${total === 1 ? '' : 's'}` : `${total} record${total === 1 ? '' : 's'} in total`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput param="search" placeholder={type === 'project' ? 'Search projects…' : 'Search member or ref…'} className="w-48 sm:w-64" />
                <SelectFilter
                  param="status"
                  placeholder="All statuses"
                  className="w-40"
                  options={CASE_STATUSES.map((s) => ({ value: s.key, label: s.label }))}
                />
              </div>
            }
          />
        </div>

        {rows.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState
              icon={<Icon className="h-6 w-6" />}
              title={`No ${meta.label.toLowerCase()} records`}
              description={search || status ? 'Adjust your filters and try again.' : `Create the first ${meta.label.toLowerCase()} to start collecting.`}
              action={
                can(user, `${meta.permission}.create`) ? (
                  <Link href={`${meta.route}/new`} className="btn btn-primary btn-sm"><Plus className="h-4 w-4" /> {meta.newLabel}</Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>{type === 'project' ? 'Project' : 'Concerning'}</Th>
                  {type !== 'project' ? <Th>Member</Th> : null}
                  <Th align="right">Per member</Th>
                  <Th align="right">Collected</Th>
                  <Th className="w-40">Progress</Th>
                  <Th>Deadline</Th>
                  <Th>Status</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const collectedRow = num(r.amount_collected);
                  const expectedRow = num(r.expected);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <Td className="whitespace-nowrap font-mono text-xs">{r.ref}</Td>
                      <Td>
                        <div className="font-medium text-navy-900">{caseTitle(type, { ...r, full_name: r.member_name, name: r.title })}</div>
                        <div className="text-[11px] text-slate-500">
                          {r.parish_name || 'Parish'} · opened {fmtDate(r.key_date)}
                        </div>
                      </Td>
                      {type !== 'project' ? (
                        <Td>
                          <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${r.member_id}`}>{r.member_name}</Link>
                          <div className="text-[11px] text-slate-500">{r.membership_no}</div>
                        </Td>
                      ) : null}
                      <Td align="right">{money(num(r.amount_per_member))}</Td>
                      <Td align="right" className="font-semibold">{money(collectedRow)}</Td>
                      <Td>
                        <ProgressBar value={collectedRow} total={expectedRow || collectedRow || 1} label={expectedRow ? undefined : 'no target set'} />
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {r.deadline ? (
                          <span className={isPast(r.deadline) && r.status === 'open' ? 'font-semibold text-red-600' : 'text-slate-600'}>
                            {fmtDate(r.deadline)}
                          </span>
                        ) : (
                          <span className="text-slate-400">No deadline</span>
                        )}
                      </Td>
                      <Td><Badge tone={caseStatusTone(r.status)}>{caseLabel(r.status)}</Badge></Td>
                      <Td align="right">
                        <Link href={`${meta.route}/${r.id}`} className="btn btn-outline btn-sm">Open</Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="p-4">
              <Pagination page={page} pageSize={PER_PAGE} total={total} basePath={meta.route} query={{ search, status }} />
            </div>
          </>
        )}
      </Card>

      {type === 'project' && categories.length > 0 ? (
        <Card>
          <CardHeader title="Project categories" subtitle="Administrators can add unlimited categories for special projects." />
          <div className="flex flex-wrap gap-2">
            {categories.map((c: any) => (
              <Badge key={c.id} tone="badge badge-navy">{c.name}</Badge>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
