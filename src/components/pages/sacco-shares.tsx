import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PieChart, Download, ArrowLeft, Award, FileText } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput } from '../ui/client';
import { DonutChartCard } from '../charts';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { getShareSettings } from '@/lib/settings';
import { money, num } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { PurchaseSharesForm, TransferSharesForm, ShareSettingsForm } from '../forms/sacco-forms';

const PER_PAGE = 25;

export default async function SaccoSharesPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  // Members only ever see their own shareholding, not the full share register.
  if (isMember(user)) {
    const own = user.member_id
      ? await one<any>(`SELECT id FROM sacco_accounts WHERE member_id = $1`, [user.member_id])
      : null;
    redirect(own ? `/sacco/accounts/${own.id}` : '/dashboard');
  }
  if (!can(user, 'shares.view') && !can(user, 'sacco.view')) redirect('/dashboard');

  const settings = await getShareSettings();
  const ownOnly = false;
  const search = String(sp.search || sp.q || '').trim();
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const params: any[] = [];
  const where: string[] = [`sh.status = 'active'`];
  if (ownOnly) {
    params.push(user.member_id);
    where.push(`sh.member_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length} OR sh.certificate_no ILIKE $${params.length})`);
  }
  const whereSql = where.join(' AND ');

  const [certificates, countRow, totals, byMember, memberOptions] = await Promise.all([
    query<any>(
      `SELECT sh.*, m.full_name, m.membership_no, m.id AS member_id, a.account_no
         FROM shares sh JOIN members m ON m.id = sh.member_id
         LEFT JOIN sacco_accounts a ON a.id = sh.sacco_account_id
        WHERE ${whereSql}
        ORDER BY sh.issued_date DESC, sh.id DESC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(`SELECT count(*)::int AS total FROM shares sh JOIN members m ON m.id = sh.member_id WHERE ${whereSql}`, params),
    one<any>(
      `SELECT count(*)::int AS certificates,
              COALESCE(SUM(sh.shares_count),0)::int AS shares,
              COALESCE(SUM(sh.total_value),0) AS capital,
              count(DISTINCT sh.member_id)::int AS shareholders
         FROM shares sh WHERE sh.status = 'active'`,
    ),
    query<any>(
      `SELECT m.full_name AS label, COALESCE(SUM(sh.shares_count),0)::float AS value
         FROM shares sh JOIN members m ON m.id = sh.member_id
        WHERE sh.status = 'active' GROUP BY m.full_name ORDER BY 2 DESC LIMIT 8`,
    ),
    can(user, 'shares.create')
      ? query<any>(
          `SELECT m.id, m.full_name, m.membership_no, a.account_no FROM members m
             JOIN sacco_accounts a ON a.member_id = m.id
            WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
              ${user.scope_parish_id ? `AND m.parish_id = ${Number(user.scope_parish_id)}` : ''}
            ORDER BY m.full_name`,
        )
      : Promise.resolve([] as any[]),
  ]);

  const total = Number(countRow?.total || 0);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Shares & certificates"
        subtitle={`One share = ${money(settings.value_per_share)}. Shares determine dividends, voting power in the SDP and how much a member can guarantee for others.`}
        action={
          <>
            <Link href="/sacco" className="btn btn-outline btn-sm"><ArrowLeft className="h-4 w-4" /> SDP overview</Link>
            <Link href="/api/exports/sacco?format=excel" className="btn btn-outline btn-sm"><Download className="h-4 w-4" /> Export</Link>
            {can(user, 'shares.update') && settings.transferable ? <TransferSharesForm members={memberOptions.map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.account_no || m.membership_no}` }))} /> : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Share capital" value={money(num(totals?.capital))} tone="gold" icon={<PieChart className="h-4 w-4" />} />
        <StatCard label="Shares issued" value={String(totals?.shares || 0)} tone="navy" sub={`${totals?.certificates || 0} certificate(s)`} />
        <StatCard label="Shareholders" value={String(totals?.shareholders || 0)} tone="green" sub={`of ${settings.max_shares_per_member} shares max each`} />
        <StatCard label="Average holding" value={String(totals?.shareholders ? Math.round(Number(totals?.shares || 0) / Number(totals?.shareholders || 1)) : 0)} tone="slate" sub="Shares per member" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {can(user, 'shares.create') || user.member_id ? (
          <Card className="lg:col-span-1">
            <CardHeader title="Issue shares" subtitle="A numbered certificate is created and can be downloaded as a PDF." icon={<Award className="h-4 w-4" />} />
            <PurchaseSharesForm
              members={memberOptions.map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.account_no || m.membership_no}` }))}
              defaultMemberId={ownOnly ? user.member_id : null}
              valuePerShare={settings.value_per_share}
              minShares={settings.min_shares}
              maxShares={settings.max_shares_per_member}
            />
          </Card>
        ) : null}

        <Card className="lg:col-span-2" padded={false}>
          <div className="p-4">
            <CardHeader
              title="Share certificates"
              subtitle={`${total} certificate${total === 1 ? '' : 's'}`}
              action={<SearchInput param="search" placeholder="Member or certificate no…" className="w-52 sm:w-64" />}
            />
          </div>
          {certificates.length === 0 ? (
            <div className="p-4 pt-0">
              <EmptyState icon={<PieChart className="h-6 w-6" />} title="No share certificates" description="Issue the first shares to build the SDP share capital." />
            </div>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Certificate</Th>
                    <Th>Member</Th>
                    <Th>Account</Th>
                    <Th align="right">Shares</Th>
                    <Th align="right">Value each</Th>
                    <Th align="right">Total</Th>
                    <Th>Issued</Th>
                    <Th>Status</Th>
                    <Th align="right">Certificate</Th>
                  </tr>
                </thead>
                <tbody>
                  {certificates.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <Td className="whitespace-nowrap font-mono text-xs">{c.certificate_no}</Td>
                      <Td>
                        <Link className="font-medium text-navy-800 hover:text-gold-700" href={`/members/${c.member_id}?tab=sacco`}>{c.full_name}</Link>
                        <div className="text-[11px] text-slate-500">{c.membership_no}</div>
                      </Td>
                      <Td>
                        {c.sacco_account_id ? (
                          <Link className="font-mono text-xs text-navy-800 hover:text-gold-700" href={`/sacco/accounts/${c.sacco_account_id}`}>{c.account_no}</Link>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </Td>
                      <Td align="right" className="font-semibold">{c.shares_count}</Td>
                      <Td align="right" className="text-slate-600">{money(num(c.value_per_share))}</Td>
                      <Td align="right" className="font-semibold">{money(num(c.total_value))}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{fmtDate(c.issued_date)}</Td>
                      <Td><Badge tone={c.status === 'active' ? 'badge badge-green' : 'badge badge-grey'}>{c.status}</Badge></Td>
                      <Td align="right">
                        <Link href={`/api/documents/share-certificate?id=${c.id}`} className="btn btn-outline btn-sm" target="_blank">
                          <FileText className="h-3.5 w-3.5" /> PDF
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="p-4">
                <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/sacco/shares" query={{ search }} />
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-4"><CardHeader title="Largest shareholders" subtitle="Top eight members by shares held." /></div>
          {byMember.length === 0 ? (
            <div className="p-4 pt-0"><EmptyState title="No shares issued yet" /></div>
          ) : (
            <div className="px-2 pb-4">
              <DonutChartCard data={byMember.map((b: any) => ({ label: b.label, value: Number(b.value) }))} currency={false} centerLabel="Shares" centerValue={String(totals?.shares || 0)} />
            </div>
          )}
        </Card>

        {can(user, 'settings.update') ? (
          <Card>
            <CardHeader title="Share settings" subtitle="Changes apply to future issues; existing certificates keep their original value." />
            <ShareSettingsForm settings={settings} />
          </Card>
        ) : (
          <Card>
            <CardHeader title="Share policy" />
            <div className="space-y-2 text-sm text-slate-600">
              <p>Value per share: <strong>{money(settings.value_per_share)}</strong></p>
              <p>Minimum purchase: <strong>{settings.min_shares} share(s)</strong></p>
              <p>Maximum holding: <strong>{settings.max_shares_per_member} shares</strong></p>
              <p>Transferable: <strong>{settings.transferable ? 'Yes, with committee approval' : 'No'}</strong></p>
              <p>Certificate prefix: <strong>{settings.certificate_prefix || '—'}</strong></p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
