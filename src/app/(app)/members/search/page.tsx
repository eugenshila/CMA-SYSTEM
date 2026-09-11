import type { Metadata } from 'next';
import Link from 'next/link';
import { Search, Users, Phone, Mail, MapPin, IdCard, Landmark } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { query } from '@/lib/db';
import { blindIndex } from '@/lib/crypto';
import { memberList } from '@/lib/reports';
import { money, num } from '@/lib/money';
import { fmtDate, age } from '@/lib/dates';
import { Card, SectionHeading, StatusBadge, Avatar, EmptyState, Badge } from '@/components/ui/primitives';
import { SearchInput, SelectFilter } from '@/components/ui/client';

export const metadata: Metadata = { title: 'Member search' };
export const dynamic = 'force-dynamic';

export default async function MemberSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('members.view');
  const sp = await searchParams;
  const q = (sp.q || '').trim();

  let rows: any[] = [];
  let idMatches: any[] = [];

  if (q.length >= 2) {
    const list = await memberList({
      search: q,
      parishId: sp.parish ? Number(sp.parish) : user.scope_parish_id,
      status: sp.status || undefined,
      limit: 40,
    });
    rows = list.rows;

    // exact identifier lookups (encrypted national ID / passport, membership number)
    if (/^[0-9A-Za-z]{5,14}$/.test(q)) {
      idMatches = await query<any>(
        `SELECT m.id, m.membership_no, m.full_name, m.phone, m.photo_url, m.membership_status,
                m.national_id_last4, p.name AS parish_name
           FROM members m LEFT JOIN parishes p ON p.id = m.parish_id
          WHERE m.deleted_at IS NULL
            AND (m.national_id_hash = $1 OR m.passport_hash = $1 OR upper(m.membership_no) = upper($2))
          LIMIT 10`,
        [blindIndex(q), q],
      );
    }
  }

  const parishes = await query<any>('SELECT id, name FROM parishes WHERE active = TRUE ORDER BY name');
  const merged = [...idMatches, ...rows.filter((r) => !idMatches.some((m) => m.id === r.id))];

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Member search"
        subtitle="Search by name, CMA number, phone, email, national ID, passport, residence, occupation or sacco account number."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput placeholder="e.g. John Smith, CMA/SJM/0012, 0712…, 12345678" className="min-w-[240px] flex-1" autoFocus />
          <SelectFilter param="parish" placeholder="All parishes" options={parishes.map((p) => ({ value: String(p.id), label: p.name }))} />
          <SelectFilter
            param="status"
            placeholder="Any status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'pending', label: 'Pending' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'deceased', label: 'Deceased' },
            ]}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><IdCard className="h-3.5 w-3.5" /> National ID / passport (encrypted exact match)</span>
          <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> Phone</span>
          <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Email</span>
          <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Residence</span>
          <span className="flex items-center gap-1"><Landmark className="h-3.5 w-3.5" /> Sacco account no.</span>
        </div>
      </Card>

      {!q ? (
        <EmptyState
          title="Start typing to search"
          description="Results appear as you type. Sensitive identifiers are matched against their encrypted index — the plain value is never stored."
          icon={<Search className="h-5 w-5" />}
        />
      ) : merged.length ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            {merged.length} result{merged.length === 1 ? '' : 's'} for “<span className="font-semibold text-navy-900">{q}</span>”
            {idMatches.length ? ` · ${idMatches.length} exact identifier match(es)` : ''}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {merged.map((m: any) => (
              <Link key={m.id} href={`/members/${m.id}`} className="card card-pad transition hover:border-navy-300 hover:shadow-pop">
                <div className="flex items-start gap-3">
                  <Avatar name={m.full_name} src={m.photo_url} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-navy-900">{m.full_name}</p>
                    <p className="truncate text-[11px] text-slate-500">{m.membership_no}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={m.membership_status} />
                      {m.age ? <Badge tone="badge-grey">{m.age} yrs</Badge> : null}
                    </div>
                  </div>
                </div>
                <dl className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1 text-slate-400"><Phone className="h-3 w-3" /> Phone</dt>
                    <dd className="truncate font-medium text-slate-700">{m.phone}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1 text-slate-400"><Users className="h-3 w-3" /> Parish</dt>
                    <dd className="truncate font-medium text-slate-700">{m.parish_name}</dd>
                  </div>
                  {m.church_name ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-400">Church</dt>
                      <dd className="truncate font-medium text-slate-700">{m.church_name}</dd>
                    </div>
                  ) : null}
                  {m.account_no ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="flex items-center gap-1 text-slate-400"><Landmark className="h-3 w-3" /> Sacco a/c</dt>
                      <dd className="truncate font-medium text-slate-700">{m.account_no}</dd>
                    </div>
                  ) : null}
                  {m.date_of_birth ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-400">Age</dt>
                      <dd className="font-medium text-slate-700">{age(m.date_of_birth) ?? '—'} years</dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">Joined</dt>
                    <dd className="font-medium text-slate-700">{fmtDate(m.date_joined)}</dd>
                  </div>
                </dl>
                <div className="mt-2 grid grid-cols-3 gap-1.5 border-t border-slate-100 pt-2 text-center">
                  <div>
                    <p className="text-[9px] uppercase text-slate-400">Savings</p>
                    <p className="text-[11px] font-bold tabular-nums text-navy-900">{money(m.savings_balance || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase text-slate-400">Shares</p>
                    <p className="text-[11px] font-bold tabular-nums text-navy-900">{m.shares_count || 0}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase text-slate-400">Owes</p>
                    <p className={`text-[11px] font-bold tabular-nums ${num(m.contribution_outstanding) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {money(m.contribution_outstanding || 0)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          title="No member found"
          description={`Nothing matches “${q}”. Check the spelling, try the CMA number or phone number, or clear the filters.`}
          icon={<Search className="h-5 w-5" />}
          action={<Link href="/members/search" className="btn-outline btn-sm">Clear search</Link>}
        />
      )}
    </div>
  );
}
