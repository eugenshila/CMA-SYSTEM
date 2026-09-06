import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FolderOpen, BadgeCheck, Clock, Users, Download, Paperclip, ShieldCheck } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Pagination, SectionHeading, StatCard, Table, Td, Th } from '../ui/primitives';
import { SearchInput, SelectFilter } from '../ui/client';
import { can, isMember } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { fmtDate } from '@/lib/dates';
import { UploadDocumentButton, VerifyDocumentButton, DeleteDocumentButton } from '../forms/document-forms';
import { DOC_TYPES, DOC_TYPE_LABELS } from '@/lib/document-meta';

const PER_PAGE = 25;

function kb(bytes: any) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsPage({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!can(user, 'documents.view') && !user.member_id) redirect('/dashboard');

  const ownOnly = isMember(user);
  const search = String(sp.search || sp.q || '').trim();
  const docType = String(sp.type || '');
  const verified = String(sp.verified || '');
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PER_PAGE;

  const params: any[] = [];
  const where: string[] = ['d.deleted_at IS NULL'];
  if (ownOnly) {
    params.push(user.member_id);
    where.push(`d.member_id = $${params.length}`);
  } else if (user.scope_parish_id) {
    params.push(Number(user.scope_parish_id));
    where.push(`m.parish_id = $${params.length}`);
  }
  if (docType) {
    params.push(docType);
    where.push(`d.doc_type = $${params.length}`);
  }
  if (verified === 'yes') where.push('d.verified = TRUE');
  if (verified === 'no') where.push('d.verified = FALSE');
  if (search) {
    params.push(`%${search}%`);
    where.push(`(m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length} OR d.title ILIKE $${params.length} OR d.file_name ILIKE $${params.length})`);
  }
  const whereSql = where.join(' AND ');

  const canUpload = ownOnly
    ? can(user, 'documents.create') || can(user, 'documents.upload_own')
    : can(user, 'documents.create');
  const canVerify = can(user, 'documents.update');
  const canDelete = can(user, 'documents.delete');

  const [docs, countRow, stats, memberOptions] = await Promise.all([
    query<any>(
      `SELECT d.*, m.full_name, m.membership_no, m.id AS member_id, u.name AS uploaded_by_name
         FROM member_documents d
         JOIN members m ON m.id = d.member_id
         LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE ${whereSql}
        ORDER BY d.verified ASC, d.created_at DESC
        LIMIT ${PER_PAGE} OFFSET ${offset}`,
      params,
    ),
    one<any>(`SELECT count(*)::int AS total FROM member_documents d JOIN members m ON m.id = d.member_id WHERE ${whereSql}`, params),
    one<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE d.verified)::int AS verified,
              count(*) FILTER (WHERE NOT d.verified)::int AS pending,
              count(DISTINCT d.member_id)::int AS members
         FROM member_documents d JOIN members m ON m.id = d.member_id WHERE ${whereSql}`,
      params,
    ),
    canUpload && !ownOnly
      ? query<any>(`SELECT id, full_name, membership_no FROM members WHERE deleted_at IS NULL AND membership_status = 'active' ORDER BY full_name`)
      : Promise.resolve([] as any[]),
  ]);

  const total = Number(countRow?.total || 0);
  const uploadBtn = canUpload ? (
    ownOnly ? (
      <UploadDocumentButton defaultMemberId={user.member_id} label="Upload my document" />
    ) : (
      <UploadDocumentButton members={memberOptions.map((m: any) => ({ value: Number(m.id), label: `${m.full_name} — ${m.membership_no}` }))} />
    )
  ) : undefined;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Documents"
        subtitle={ownOnly ? 'Your uploaded identification and supporting documents.' : 'Member identification and supporting documents — upload, verify and manage across the parish.'}
        action={uploadBtn}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Documents" value={String(stats?.total || 0)} tone="navy" icon={<FolderOpen className="h-4 w-4" />} sub={`${stats?.members || 0} member(s)`} />
        <StatCard label="Verified" value={String(stats?.verified || 0)} tone="green" icon={<BadgeCheck className="h-4 w-4" />} />
        <StatCard label="Pending verification" value={String(stats?.pending || 0)} tone={(stats?.pending || 0) > 0 ? 'gold' : 'slate'} icon={<Clock className="h-4 w-4" />} />
        <StatCard label="On this page" value={String(docs.length)} tone="slate" icon={<Users className="h-4 w-4" />} />
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader title={ownOnly ? 'My documents' : 'Document register'} subtitle={`${total} document${total === 1 ? '' : 's'}`} icon={<ShieldCheck className="h-[18px] w-[18px]" />} />
          {!ownOnly ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SearchInput param="search" placeholder="Search member or file…" />
              <SelectFilter param="type" placeholder="All types" options={DOC_TYPES} />
              <SelectFilter param="verified" placeholder="Verified + pending" options={[{ value: 'yes', label: 'Verified' }, { value: 'no', label: 'Pending' }]} />
            </div>
          ) : null}
        </div>

        {docs.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState
              icon={<Paperclip className="h-6 w-6" />}
              title={ownOnly ? 'No documents yet' : 'No documents found'}
              description={ownOnly ? 'Upload your national ID, baptism certificate or other documents.' : canUpload ? 'Upload identification or supporting documents for members.' : 'No documents match the current filters.'}
            />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                {!ownOnly ? <Th>Member</Th> : null}
                <Th>Type</Th>
                <Th>Title / file</Th>
                <Th>Size</Th>
                <Th>Uploaded</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d: any) => (
                <tr key={d.id}>
                  {!ownOnly ? (
                    <Td>
                      <Link className="text-sm text-slate-700 hover:text-navy-800" href={`/members/${d.member_id}?tab=documents`}>{d.full_name}</Link>
                      <span className="block text-[11px] text-slate-400">{d.membership_no}</span>
                    </Td>
                  ) : null}
                  <Td><Badge tone="badge badge-grey">{DOC_TYPE_LABELS[d.doc_type] || d.doc_type}</Badge></Td>
                  <Td>
                    <span className="block max-w-xs truncate text-sm text-slate-700">{d.title}</span>
                    <span className="block max-w-xs truncate text-[11px] text-slate-400">{d.file_name}</span>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{kb(d.size_bytes)}</Td>
                  <Td className="whitespace-nowrap text-xs text-slate-600">
                    {fmtDate(d.created_at)}
                    {d.uploaded_by_name ? <span className="block text-[11px] text-slate-400">by {d.uploaded_by_name}</span> : null}
                  </Td>
                  <Td>{d.verified ? <Badge tone="badge badge-green">verified</Badge> : <Badge tone="badge badge-gold">pending</Badge>}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <a className="btn btn-ghost btn-sm" href={`/api/documents/file?id=${d.id}`} target="_blank" title="Open / download"><Download className="h-3.5 w-3.5" /></a>
                      {canVerify && !ownOnly ? <VerifyDocumentButton id={Number(d.id)} verified={Boolean(d.verified)} /> : null}
                      {canDelete && !ownOnly ? <DeleteDocumentButton id={Number(d.id)} /> : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="px-4 pb-4">
          <Pagination page={page} pageSize={PER_PAGE} total={total} basePath="/documents" query={{ search, type: docType, verified }} />
        </div>
      </Card>
    </div>
  );
}
