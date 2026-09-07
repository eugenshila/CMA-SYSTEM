import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users as UsersIcon, ShieldCheck, Building2, ServerCog, History, ExternalLink } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { query } from '@/lib/db';
import { fmtDateTime, relativeTime } from '@/lib/dates';
import { SectionHeading, Table, Th, Td, Badge, StatusBadge } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/tabs';
import {
  NewUserButton, EditUserButton, UserStatusSelect, ResetPasswordButton, DeleteUserButton,
  OrgEntityButton, DeactivateOrgEntityButton, ORG_ENTITY_LABELS,
  CreateBackupButton, RestoreBackupButton, RunNightlyJobsButton,
} from '@/components/forms/admin-forms';
import { PermissionMatrix } from '@/components/forms/permission-matrix';

export const metadata = { title: 'Administration · CMA' };

const ORG_ORDER = ['dioceses', 'deaneries', 'parishes', 'churches', 'small_christian_communities'] as const;

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!can(user, 'users.view')) redirect('/dashboard');

  const canManageUsers = can(user, 'users.update') || can(user, 'users.manage');
  const canEditRoles = can(user, 'roles.view');
  const canEditOrg = can(user, 'settings.view') || can(user, 'users.manage');
  const canSystem = can(user, 'users.manage') || can(user, 'system.manage');

  const [users, roles, permissions, grants, parishes, memberRows, countries, dioceses, deaneries, parishRows, churches, sccs, backups] = await Promise.all([
    query<any>(`SELECT u.id, u.name, u.email, u.phone, u.login_id, u.status, u.role_id, u.member_id,
                       u.scope_parish_id, u.must_change_password, u.last_login_at, u.two_factor_enabled,
                       r.key AS role_key, r.name AS role_name, r.level AS role_level,
                       m.full_name AS member_name, m.membership_no, p.name AS parish_name
                FROM users u
                LEFT JOIN roles r ON r.id = u.role_id
                LEFT JOIN members m ON m.id = u.member_id
                LEFT JOIN parishes p ON p.id = u.scope_parish_id
                WHERE u.deleted_at IS NULL
                ORDER BY r.level DESC, u.name`),
    query<any>('SELECT id, key, name, level FROM roles ORDER BY level'),
    query<any>('SELECT id, key, module, action, description FROM permissions ORDER BY module, action'),
    query<any>('SELECT role_id, permission_id FROM role_permissions'),
    query<any>('SELECT id, name FROM parishes WHERE active ORDER BY name'),
    query<any>("SELECT id, full_name AS name, membership_no FROM members WHERE deleted_at IS NULL ORDER BY full_name LIMIT 500"),
    query<any>('SELECT id, name FROM countries WHERE active ORDER BY name'),
    query<any>('SELECT id, name, code, type, bishop, country_id, active FROM dioceses ORDER BY name'),
    query<any>('SELECT id, name, code, diocese_id, active FROM deaneries ORDER BY name'),
    query<any>('SELECT id, name, code, deanery_id, diocese_id, parish_priest, cma_chaplain, phone, email, address, active FROM parishes ORDER BY name'),
    query<any>('SELECT id, name, code, parish_id, type, location, active FROM churches ORDER BY name'),
    query<any>('SELECT id, name, code, parish_id, church_id, leader_name, active FROM small_christian_communities ORDER BY name'),
    query<any>('SELECT id, file_name, file_path, size_bytes, backup_type, status, message, created_at FROM backups ORDER BY created_at DESC LIMIT 20'),
  ]);

  const roleOptions = roles.map((r) => ({ key: r.key, name: r.name }));
  const parishOptions = parishes.map((p) => ({ value: p.id, label: p.name }));
  const memberOptions = memberRows.map((m) => ({ value: m.id, label: `${m.name}${m.membership_no ? ` · ${m.membership_no}` : ''}` }));
  const grantKeys = grants.map((g) => `${g.role_id}:${g.permission_id}`);

  const parents: Record<string, { value: number; label: string }[]> = {
    countries: countries.map((c) => ({ value: c.id, label: c.name })),
    dioceses: dioceses.map((d) => ({ value: d.id, label: d.name })),
    deaneries: deaneries.map((d) => ({ value: d.id, label: d.name })),
    parishes: parishRows.map((p) => ({ value: p.id, label: p.name })),
    churches: churches.map((c) => ({ value: c.id, label: c.name })),
  };

  const orgData: Record<string, any[]> = { dioceses, deaneries, parishes: parishRows, churches, small_christian_communities: sccs };

  /* ---------------- Users tab ---------------- */
  const usersTab = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{users.length} user account{users.length === 1 ? '' : 's'} across all roles.</p>
        {can(user, 'users.create') && <NewUserButton roles={roleOptions} parishes={parishOptions} members={memberOptions} />}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Data scope</Th>
              <Th>Member</Th>
              <Th>Last login</Th>
              {canManageUsers && <Th align="right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <Td>
                  <div className="font-semibold text-navy-900">{u.name}{u.id === user.id && <span className="ml-1 text-[10px] font-bold uppercase text-gold-600">you</span>}</div>
                  <div className="text-xs text-slate-500">{u.email || u.phone || u.login_id || '—'}</div>
                </Td>
                <Td><Badge tone="badge badge-navy">{u.role_name || '—'}</Badge></Td>
                <Td>
                  {canManageUsers && u.id !== user.id
                    ? <UserStatusSelect id={u.id} status={u.status} />
                    : <StatusBadge status={u.status} />}
                </Td>
                <Td className="text-xs text-slate-600">{u.parish_name || <span className="text-slate-400">All parishes</span>}</Td>
                <Td className="text-xs">
                  {u.member_id
                    ? <Link className="text-navy-700 underline decoration-dotted hover:text-gold-600" href={`/members/${u.member_id}`}>{u.member_name || `#${u.member_id}`}</Link>
                    : <span className="text-slate-400">—</span>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{u.last_login_at ? relativeTime(u.last_login_at) : <span className="text-slate-400">never</span>}</Td>
                {canManageUsers && (
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      {can(user, 'users.update') && <EditUserButton roles={roleOptions} parishes={parishOptions} members={memberOptions} record={{ ...u, role_key: u.role_key }} />}
                      {can(user, 'users.update') && <ResetPasswordButton id={u.id} name={u.name} />}
                      {can(user, 'users.delete') && <DeleteUserButton id={u.id} name={u.name} disabled={u.id === user.id} />}
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );

  /* ---------------- Roles tab ---------------- */
  const rolesTab = (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Grant or revoke fine-grained permissions per role. Changes apply immediately and are audited. The member role is fixed.
      </p>
      <PermissionMatrix roles={roles} permissions={permissions} grants={grantKeys} />
    </div>
  );

  /* ---------------- Organisation tab ---------------- */
  const orgTab = (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Manage the organisational hierarchy — country → archdiocese/diocese → deanery → parish → church/outstation → Small Christian Community → member.
      </p>
      {ORG_ORDER.map((entity) => {
        const rows = orgData[entity] || [];
        return (
          <div key={entity} className="rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <h3 className="text-sm font-bold text-navy-900">{ORG_ENTITY_LABELS[entity]} <span className="ml-1 text-xs font-medium text-slate-400">({rows.length})</span></h3>
              {can(user, 'settings.update') && <OrgEntityButton entity={entity} parents={parents} />}
            </div>
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-400">None yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Code</Th>
                      <Th>Parent</Th>
                      <Th>Status</Th>
                      {can(user, 'settings.update') && <Th align="right">Actions</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const parentId = r.diocese_id ?? r.deanery_id ?? r.parish_id ?? r.church_id ?? r.country_id;
                      const parentName =
                        parents.dioceses.find((x) => x.value === r.diocese_id)?.label ||
                        parents.deaneries.find((x) => x.value === r.deanery_id)?.label ||
                        parents.parishes.find((x) => x.value === r.parish_id)?.label ||
                        parents.churches.find((x) => x.value === r.church_id)?.label ||
                        parents.countries.find((x) => x.value === r.country_id)?.label || '—';
                      return (
                        <tr key={r.id}>
                          <Td>
                            <div className="font-medium text-navy-900">{r.name}</div>
                            {(r.parish_priest || r.bishop || r.leader_name) && (
                              <div className="text-[11px] text-slate-500">{r.parish_priest || r.bishop || r.leader_name}</div>
                            )}
                          </Td>
                          <Td className="text-xs text-slate-500">{r.code || '—'}</Td>
                          <Td className="text-xs text-slate-600">{parentName}</Td>
                          <Td>{r.active ? <Badge tone="badge badge-green">active</Badge> : <Badge tone="badge badge-grey">inactive</Badge>}</Td>
                          {can(user, 'settings.update') && (
                            <Td align="right">
                              <div className="flex justify-end gap-1">
                                <OrgEntityButton entity={entity} parents={parents} record={r} />
                                <DeactivateOrgEntityButton table={entity} id={r.id} name={r.name} />
                              </div>
                            </Td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  /* ---------------- System tab ---------------- */
  const systemTab = (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-1 text-sm font-bold text-navy-900">Data backup</h3>
          <p className="mb-3 text-xs text-slate-500">Export a JSON snapshot of all tables to the server backups directory. Financial data is never hard-deleted.</p>
          <CreateBackupButton />
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-1 text-sm font-bold text-navy-900">Nightly jobs</h3>
          <p className="mb-3 text-xs text-slate-500">Bill monthly contributions, apply late penalties and send reminders. Runs automatically overnight; trigger manually here.</p>
          <RunNightlyJobsButton />
        </div>
      </div>
      <div className="rounded-xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <h3 className="text-sm font-bold text-navy-900">Recent backups</h3>
          <Link href="/admin/audit" className="flex items-center gap-1 text-xs font-semibold text-navy-700 hover:text-gold-600"><History className="h-3.5 w-3.5" /> Audit trail</Link>
        </div>
        {backups.length === 0 ? (
          <p className="px-3 py-4 text-xs text-slate-400">No backups yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr><Th>File</Th><Th>Type</Th><Th>Size</Th><Th>Created</Th><Th>Status</Th>{can(user, 'users.manage') && <Th align="right">Restore</Th>}</tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <Td className="text-xs font-medium text-navy-900">{b.file_name}</Td>
                    <Td className="text-xs text-slate-500">{b.backup_type}</Td>
                    <Td className="text-xs text-slate-500">{b.size_bytes ? `${(b.size_bytes / 1024).toFixed(0)} KB` : '—'}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(b.created_at)}</Td>
                    <Td><StatusBadge status={b.status} /></Td>
                    {can(user, 'users.manage') && <Td align="right"><RestoreBackupButton id={b.id} name={b.file_name} /></Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );

  const sections = [
    { id: 'users', label: 'Users', badge: users.length, node: usersTab },
    ...(canEditRoles ? [{ id: 'roles', label: 'Roles & permissions', node: rolesTab }] : []),
    ...(canEditOrg ? [{ id: 'organisation', label: 'Organisation', node: orgTab }] : []),
    ...(canSystem ? [{ id: 'system', label: 'System', node: systemTab }] : []),
  ];

  return (
    <>
      <SectionHeading
        title="Administration"
        subtitle="Manage user accounts, role permissions, the organisational hierarchy and system maintenance."
        action={can(user, 'audit.view') ? (
          <Link href="/admin/audit" className="btn btn-outline btn-sm"><History className="h-4 w-4" /> Audit trail <ExternalLink className="h-3 w-3" /></Link>
        ) : undefined}
      />
      <Tabs sections={sections} />
    </>
  );
}
