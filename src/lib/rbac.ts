import 'server-only';
import { cache } from 'react';
import { query } from './db';

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  CHAIRMAN: 'chairman',
  TREASURER: 'treasurer',
  SECRETARY: 'secretary',
  SACCO_OFFICER: 'sacco_officer',
  LOAN_COMMITTEE: 'loan_committee',
  AUDITOR: 'auditor',
  MEMBER: 'member',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Administrator',
  admin: 'CMA Administrator',
  chairman: 'Chairman',
  treasurer: 'Treasurer / Finance Officer',
  secretary: 'Secretary',
  sacco_officer: 'SDP / Sacco Officer',
  loan_committee: 'Loan Committee',
  auditor: 'Auditor',
  member: 'Member',
};

/** Roles that administer money (used for finance dashboards & sensitive access). */
export const FINANCE_ROLES: RoleKey[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.TREASURER,
  ROLES.SACCO_OFFICER,
  ROLES.CHAIRMAN,
  ROLES.AUDITOR,
];

export const SACCO_ADMIN_ROLES: RoleKey[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SACCO_OFFICER, ROLES.TREASURER];

export const LOAN_APPROVER_ROLES: RoleKey[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.CHAIRMAN,
  ROLES.LOAN_COMMITTEE,
  ROLES.SACCO_OFFICER,
];

export interface PermissionUser {
  id: number;
  role_key: string;
  role_level?: number;
  member_id?: number | null;
  permissions?: string[];
}

const loadRolePermissions = cache(async (roleId: number): Promise<string[]> => {
  const rows = await query<{ key: string }>(
    `SELECT p.key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1`,
    [roleId],
  );
  return rows.map((r) => r.key);
});

export async function permissionsForRole(roleId: number): Promise<string[]> {
  return loadRolePermissions(roleId);
}

export async function permissionsForUser(user: { id: number; role_id?: number; role?: { id: number } }): Promise<string[]> {
  const roleId = user.role_id ?? user.role?.id;
  if (!roleId) return [];
  return loadRolePermissions(roleId);
}

export function can(user: PermissionUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.role_key === ROLES.SUPER_ADMIN) return true;
  const perms = user.permissions || [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  const [module] = permission.split('.');
  // module.* grants the whole module
  if (perms.includes(`${module}.*`)) return true;
  // a `manage` permission implies every action on that module
  if (perms.includes(`${module}.manage`)) return true;
  return false;
}

export function canAny(user: PermissionUser | null | undefined, permissions: string[]): boolean {
  return permissions.some((p) => can(user, p));
}

export function canAll(user: PermissionUser | null | undefined, permissions: string[]): boolean {
  return permissions.every((p) => can(user, p));
}

export function hasRole(user: PermissionUser | null | undefined, ...roles: string[]): boolean {
  if (!user) return false;
  return roles.includes(user.role_key as string);
}

export function isMember(user: PermissionUser | null | undefined): boolean {
  return user?.role_key === ROLES.MEMBER;
}

export function isStaff(user: PermissionUser | null | undefined): boolean {
  return Boolean(user) && user!.role_key !== ROLES.MEMBER;
}

/** Throws when the current user lacks a permission. */
export function assertCan(user: PermissionUser | null | undefined, permission: string, message?: string) {
  if (!can(user, permission)) {
    const err: any = new Error(
      message || `You do not have permission to perform this action (${permission}).`,
    );
    err.code = 'FORBIDDEN';
    err.status = 403;
    throw err;
  }
}

export const READ_ONLY_ROLES: RoleKey[] = [ROLES.AUDITOR];

export function isReadOnly(user: PermissionUser | null | undefined): boolean {
  return hasRole(user, ROLES.AUDITOR);
}
