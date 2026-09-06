import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { memberById } from '@/server/services/members';
import { decryptField } from '@/lib/crypto';
import { Card, SectionHeading } from '@/components/ui/primitives';
import { MemberForm } from '@/components/forms/member-forms';

export const metadata: Metadata = { title: 'Edit member' };
export const dynamic = 'force-dynamic';

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const memberId = Number(id);

  const member = await memberById(memberId);
  if (!member || member.deleted_at) notFound();

  const isOwn = user.member_id === memberId;
  if (!isOwn && !can(user, 'members.update')) {
    return (
      <Card>
        <p className="text-sm text-slate-600">You do not have permission to edit this member record.</p>
        <Link href={`/members/${memberId}`} className="btn-outline btn-sm mt-3">Back to profile</Link>
      </Card>
    );
  }

  const [parishes, churches, communities] = await Promise.all([
    query<any>('SELECT id, name, code FROM parishes WHERE active = TRUE ORDER BY name'),
    query<any>('SELECT id, name, parish_id FROM churches WHERE active = TRUE ORDER BY name'),
    query<any>('SELECT id, name, parish_id FROM small_christian_communities WHERE active = TRUE ORDER BY name'),
  ]);

  // never send the raw identifier to the browser: only the masked last four digits
  const masked = member.national_id_last4 ? `••••${member.national_id_last4}` : null;
  void decryptField;

  return (
    <div className="space-y-4">
      <SectionHeading
        title={`Edit ${member.full_name}`}
        subtitle={`${member.membership_no}${masked ? ` · ID ${masked}` : ''}`}
        action={
          <Link href={`/members/${memberId}`} className="btn-outline btn-sm">
            <ArrowLeft className="h-4 w-4" /> Back to profile
          </Link>
        }
      />
      <Card>
        <MemberForm
          mode="edit"
          member={member}
          parishes={parishes.map((p) => ({ value: p.id, label: `${p.name}${p.code ? ` (${p.code})` : ''}` }))}
          churches={churches.map((c) => ({ value: c.id, label: c.name, parish_id: c.parish_id }))}
          communities={communities.map((c) => ({ value: c.id, label: c.name, parish_id: c.parish_id }))}
          cancelHref={`/members/${memberId}`}
        />
      </Card>
    </div>
  );
}
