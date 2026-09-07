import { redirect } from 'next/navigation';
import { Card, CardHeader, SectionHeading } from '../ui/primitives';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { membersInScope, type CaseType } from '@/lib/contributions';
import { CASE_META, WELFARE_CATEGORIES, FUNERAL_RELATIONSHIPS } from '@/lib/cases';
import { CaseForm } from '../forms/case-forms';

export default async function CaseNewPage({ type, user }: { type: CaseType; user: SessionUser }) {
  const meta = CASE_META[type];
  if (!can(user, `${meta.permission}.create`)) redirect(meta.route);

  const parishFilter = user.scope_parish_id ? Number(user.scope_parish_id) : undefined;

  const [scopeMembers, churches, sccs, projectCategories] = await Promise.all([
    membersInScope({ scope_type: 'all', parish_id: parishFilter }),
    query<any>(
      `SELECT id, name FROM churches WHERE TRUE ${parishFilter ? `AND parish_id = ${parishFilter}` : ''} ORDER BY name`,
    ),
    query<any>(
      `SELECT s.id, s.name FROM small_christian_communities s JOIN churches c ON c.id = s.church_id
        WHERE TRUE ${parishFilter ? `AND c.parish_id = ${parishFilter}` : ''} ORDER BY s.name`,
    ),
    type === 'project' ? query<any>('SELECT key, name FROM project_categories WHERE active = TRUE ORDER BY name') : Promise.resolve([] as any[]),
  ]);

  const categories =
    type === 'project'
      ? projectCategories.map((c: any) => ({ value: c.key, label: c.name }))
      : type === 'welfare'
        ? WELFARE_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))
        : [];

  return (
    <div className="space-y-5">
      <SectionHeading
        title={meta.newLabel}
        subtitle="Members in the selected scope are notified as soon as the record is created."
      />
      <Card>
        <CardHeader title="Record details" subtitle="Fields marked with * are required." />
        <CaseForm
          type={type}
          options={{
            members: scopeMembers.map((m: any) => ({
              value: Number(m.id),
              label: `${m.full_name} — ${m.membership_no}${m.scc_name ? ` (${m.scc_name})` : ''}`,
            })),
            categories,
            churches: churches.map((c: any) => ({ value: Number(c.id), label: c.name })),
            sccs: sccs.map((s: any) => ({ value: Number(s.id), label: s.name })),
            relationships: FUNERAL_RELATIONSHIPS.map((r) => ({ value: r.key, label: r.label })),
          }}
        />
      </Card>
    </div>
  );
}
