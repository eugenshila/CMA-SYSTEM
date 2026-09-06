import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { query } from '@/lib/db';
import { requirePermission, getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { nextMembershipNumber } from '@/server/services/members';
import { Card, SectionHeading } from '@/components/ui/primitives';
import { MemberForm } from '@/components/forms/member-forms';

export const metadata: Metadata = { title: 'Register member' };
export const dynamic = 'force-dynamic';

export default async function NewMemberPage() {
  const user = await requirePermission('members.create');

  const [parishes, churches, communities] = await Promise.all([
    query<any>('SELECT id, name, code FROM parishes WHERE active = TRUE ORDER BY name'),
    query<any>('SELECT id, name, parish_id FROM churches WHERE active = TRUE ORDER BY name'),
    query<any>('SELECT id, name, parish_id FROM small_christian_communities WHERE active = TRUE ORDER BY name'),
  ]);

  const primaryParish = parishes.find((p) => p.id === user.scope_parish_id) || parishes[0];
  const nextNo = primaryParish ? await nextMembershipNumber(primaryParish.code) : '';

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Register a new member"
        subtitle="Baptised and confirmed Catholic men aged 18 and above. Fields marked * are required."
        action={
          <Link href="/members" className="btn-outline btn-sm">
            <ArrowLeft className="h-4 w-4" /> Back to directory
          </Link>
        }
      />
      <Card>
        <MemberForm
          mode="create"
          parishes={parishes.map((p) => ({ value: p.id, label: `${p.name}${p.code ? ` (${p.code})` : ''}` }))}
          churches={churches.map((c) => ({ value: c.id, label: c.name, parish_id: c.parish_id }))}
          communities={communities.map((c) => ({ value: c.id, label: c.name, parish_id: c.parish_id }))}
          nextMembershipNo={nextNo}
          canCreateLogin={can(user, 'users.create')}
          cancelHref="/members"
        />
      </Card>
    </div>
  );
}
