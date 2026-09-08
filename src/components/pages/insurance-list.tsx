import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldPlus, Plus, Users, Wallet, Search, Download, Clock } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput, SelectFilter } from '../ui/client';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { query, one } from '@/lib/db';
import { money, num } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { listInsurances, INSURANCE_STATUSES } from '@/lib/insurance';

const PER_PAGE = 20;

export default async function InsuranceListPage({ user, sp }: { user: SessionUser; sp: Record<string, string | string[] | undefined> }) {
  if (!can(user, 'insurance.view')) redirect('/dashboard');

  const search = String(sp.search || sp.q || '').trim();
  const status = String(sp.status || '');
  const parish = String(sp.parish || '');
  const company = String(sp.company || '');
  const page = Math.max(1, Number(sp.page || 1));

  const [companies, parishes, summary] = await Promise.all([
    query<any>('SELECT id, name FROM insurance_companies WHERE active = TRUE ORDER BY name'),
    query<any>('SELECT id, name FROM parishes WHERE active = TRUE ORDER BY id'),
    one<any>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active, COALESCE(SUM(coverage_amount),0)::float AS coverage, COALESCE(SUM(total_premiums_paid),0)::float AS premiums FROM last_respect_insurances`),
  ]);

  const { rows, total } = await listInsurances({
    search: search || undefined,
    status: status || undefined,
    parishId: parish ? Number(parish) : user.scope_parish_id || undefined,
    companyId: company ? Number(company) : undefined,
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
  });

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Last Respect Insurance"
        subtitle="Financial support for funeral and end-of-life expenses — immediate cash payouts within 48 hours, ensuring loved ones are not burdened."
        action={
          <>
            {can(user, 'insurance.create') ? (
              <Link href="/insurance/new" className="btn btn-primary btn-sm">
                <Plus className="h-4 w-4" /> New Policy
              </Link>
            ) : null}
            <Link href="/api/exports/insurance?format=excel" className="btn btn-outline btn-sm">
              <Download className="h-4 w-4" /> Excel
            </Link>
          </>
        }
      />

      <Card>
        <div className="prose prose-sm max-w-none text-slate-600">
          <p>
            <strong>Last respect insurance</strong> provides financial support for funeral and end-of-life expenses. Policies cover KSh 50,000–500,000,
            eligible principal 18–65, spouses, children (1 month–24 years, up to 25 if school-going), parents/parents-in-law. Dependents can be added.
            Claims for illness and accidents, with illness waiting period, payout within 48 hours.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Policies" value={String(summary?.total || 0)} tone="navy" icon={<ShieldPlus className="h-4 w-4" />} />
        <StatCard label="Active" value={String(summary?.active || 0)} tone="green" icon={<Users className="h-4 w-4" />} />
        <StatCard label="Total coverage" value={money(num(summary?.coverage))} tone="blue" icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Premiums paid" value={money(num(summary?.premiums))} tone="gold" icon={<Clock className="h-4 w-4" />} sub="Across all policies" />
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader
            title="Insurance policies"
            subtitle={`${total} policy${total === 1 ? '' : 'ies'}`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput param="search" placeholder="Search policy, member, company…" className="w-56" />
                <SelectFilter param="parish" placeholder="All parishes" className="w-56" options={parishes.map((p: any) => ({ value: String(p.id), label: p.name }))} />
                <SelectFilter param="company" placeholder="All companies" className="w-48" options={companies.map((c: any) => ({ value: String(c.id), label: c.name }))} />
                <SelectFilter param="status" placeholder="All statuses" className="w-40" options={INSURANCE_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
              </div>
            }
          />
        </div>

        {rows.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState icon={<ShieldPlus className="h-6 w-6" />} title="No insurance policies" description={search || status || parish ? 'Adjust filters.' : 'Create first Last Respect policy for a member.'} action={can(user, 'insurance.create') ? <Link href="/insurance/new" className="btn btn-primary btn-sm"><Plus className="h-4 w-4" /> New Policy</Link> : undefined} />
          </div>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Policy No</Th>
                  <Th>Member</Th>
                  <Th>Parish</Th>
                  <Th>Company</Th>
                  <Th align="right">Coverage</Th>
                  <Th align="right">Premium</Th>
                  <Th>Beneficiary</Th>
                  <Th>Status</Th>
                  <Th>Next due</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <Td className="font-mono text-xs">{r.policy_no}</Td>
                    <Td>
                      <Link href={`/members/${r.member_id}`} className="font-medium text-navy-800 hover:text-gold-700">{r.full_name}</Link>
                      <div className="text-[11px] text-slate-500">{r.membership_no}</div>
                    </Td>
                    <Td className="text-xs">{r.parish_name || '—'}</Td>
                    <Td className="text-xs">{r.company_name}</Td>
                    <Td align="right" className="font-semibold">{money(num(r.coverage_amount))}</Td>
                    <Td align="right">{money(num(r.premium_amount))} <span className="text-[10px] text-slate-400">/{r.premium_frequency}</span></Td>
                    <Td className="text-xs">{r.beneficiary_name}<div className="text-[11px] text-slate-400">{r.beneficiary_relationship}</div></Td>
                    <Td><Badge tone={r.status === 'active' ? 'badge badge-green' : r.status === 'claimed' ? 'badge badge-gold' : 'badge badge-grey'}>{r.status}</Badge></Td>
                    <Td className="text-xs">{r.next_premium_due ? fmtDate(r.next_premium_due) : '—'}</Td>
                    <Td align="right"><Link href={`/insurance/${r.id}`} className="btn btn-outline btn-sm">Open</Link></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="p-4">
              <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/insurance" query={{ search, status, parish, company }} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
