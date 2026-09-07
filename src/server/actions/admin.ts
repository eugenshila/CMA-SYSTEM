'use server';

import { revalidatePath } from 'next/cache';
import { one, query, execute } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { generateTempPassword, hashPassword } from '@/lib/crypto';
import { userSchema, firstError, formDataToObject } from '@/lib/validators';
import { setSetting, getSetting, allSettings } from '@/lib/settings';
import { num } from '@/lib/money';
import type { ActionResult } from './auth';

/* ------------------------------------------------------------------ *
 * USER ACCOUNTS
 * ------------------------------------------------------------------ */
export async function saveUserAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(formData.get('id') || 0);
  if (id ? !can(user, 'users.update') : !can(user, 'users.create')) {
    return { ok: false, error: 'You do not have permission to manage user accounts.' };
  }

  const raw = formDataToObject(formData);
  const parsed = userSchema.safeParse({
    ...raw,
    phone: raw.phone ? String(raw.phone).replace(/\s/g, '') : '',
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed) || 'Please correct the account details.' };
  const d = parsed.data;

  const role = await one<any>('SELECT * FROM roles WHERE key = $1', [d.role_key]);
  if (!role) return { ok: false, error: 'Select a valid role.' };
  if (role.key === 'super_admin' && !can(user, 'users.manage')) {
    return { ok: false, error: 'Only a super administrator may assign the super administrator role.' };
  }

  const memberId = Number(formData.get('member_id') || 0) || null;
  const scopeParishId = Number(formData.get('scope_parish_id') || 0) || null;
  const scopeDioceseId = Number(formData.get('scope_diocese_id') || 0) || null;
  const loginId = String(formData.get('login_id') || '').trim() || null;
  const mustChange = formData.get('must_change_password') === 'on';

  if (id) {
    const before = await one<any>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!before) return { ok: false, error: 'User not found.' };
    if (before.id === user.id && d.role_key !== before.role_key) {
      return { ok: false, error: 'You cannot change your own role.' };
    }
    await execute(
      `UPDATE users SET login_id = $2, email = $3, phone = $4, name = $5, role_id = $6, status = $7,
              member_id = $8, scope_parish_id = $9, scope_diocese_id = $10, must_change_password = $11
        WHERE id = $1`,
      [
        id,
        loginId || before.login_id,
        d.email || null,
        d.phone || null,
        d.name,
        role.id,
        d.status,
        memberId,
        scopeParishId,
        scopeDioceseId,
        mustChange,
      ],
    );
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      entityLabel: d.name,
      description: `Updated account for ${d.name} (${role.name}, ${d.status})`,
      oldValues: { role_id: before.role_id, status: before.status, name: before.name, login_id: before.login_id },
      newValues: { role_id: role.id, status: d.status, name: d.name, login_id: loginId || before.login_id },
    });
    revalidatePath('/admin/users');
    revalidatePath('/admin');
    return { ok: true, message: `Account for ${d.name} updated.` };
  }

  const password = String(formData.get('password') || '').trim() || generateTempPassword();
  const generatedPassword = !String(formData.get('password') || '').trim();
  const duplicate = await one<any>(
    `SELECT id, name FROM users
      WHERE deleted_at IS NULL AND (lower(email) = lower($1) OR phone = $2 OR ($3 <> '' AND lower(login_id) = lower($3)))`,
    [d.email || '__none__', d.phone || '__none__', loginId || ''],
  );
  if (duplicate) return { ok: false, error: `An account with that email, phone or login ID already exists (${duplicate.name}).` };

  const passwordHash = await hashPassword(password);
  const created = await one<any>(
    `INSERT INTO users (login_id, email, phone, name, password_hash, role_id, member_id, status,
                        must_change_password, scope_parish_id, scope_diocese_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, name, login_id`,
    [
      loginId,
      d.email || null,
      d.phone || null,
      d.name,
      passwordHash,
      role.id,
      memberId,
      d.status,
      mustChange || generatedPassword,
      scopeParishId,
      scopeDioceseId,
      user.id,
    ],
  );

  if (memberId) {
    await execute('UPDATE members SET user_id = $2 WHERE id = $1 AND user_id IS NULL', [memberId, created.id]);
  }

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'user.created',
    entityType: 'user',
    entityId: created.id,
    entityLabel: d.name,
    description: `Created ${role.name} account for ${d.name}`,
    newValues: { name: d.name, role: role.key, member_id: memberId, login_id: loginId },
  });

  if (memberId) {
    await notify({
      memberId,
      title: 'Your CMA system account is ready',
      body: generatedPassword
        ? `An account has been created for you with the ${role.name} role. Sign in with your phone number; the CMA office will share your temporary password.`
        : `An account has been created for you with the ${role.name} role. Sign in using your phone number, email or CMA number.`,
      category: 'auth',
      priority: 'high',
      channels: ['in_system', 'sms'],
      link: '/login',
    });
  }

  revalidatePath('/admin/users');
  revalidatePath('/admin');
  return {
    ok: true,
    message: generatedPassword
      ? `Account created for ${d.name}. Temporary password: ${password}`
      : `Account created for ${d.name}.`,
    data: { id: created.id, tempPassword: generatedPassword ? password : undefined },
  };
}

export async function resetUserPasswordAction(userId: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'users.update')) return { ok: false, error: 'You do not have permission to reset passwords.' };
  const target = await one<any>('SELECT id, name, login_id, member_id, phone FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (!target) return { ok: false, error: 'User not found.' };
  if (target.id === user.id) return { ok: false, error: 'Use "Change password" in your account settings for your own account.' };

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await execute(
    `UPDATE users SET password_hash = $2, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL,
            password_changed_at = now()
      WHERE id = $1`,
    [userId, passwordHash],
  );
  await execute('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'user.password_reset',
    entityType: 'user',
    entityId: userId,
    entityLabel: target.name,
    description: `Reset the password for ${target.name}`,
    severity: 'warning',
  });

  if (target.member_id) {
    await notify({
      memberId: target.member_id,
      title: 'Your password was reset',
      body: `An administrator reset your CMA system password. Temporary password: ${tempPassword}. You will be asked to change it at your next sign-in.`,
      category: 'auth',
      priority: 'high',
      channels: ['in_system', 'sms'],
      link: '/login',
    });
  }

  revalidatePath('/admin/users');
  return { ok: true, message: `Temporary password for ${target.name}: ${tempPassword}`, data: { tempPassword } };
}

export async function setUserStatusAction(userId: number, status: 'active' | 'suspended' | 'locked' | 'disabled'): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'users.update')) return { ok: false, error: 'You do not have permission to change account status.' };
  if (userId === user.id) return { ok: false, error: 'You cannot change the status of your own account.' };
  const target = await one<any>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (!target) return { ok: false, error: 'User not found.' };

  await execute(
    `UPDATE users SET status = $2, locked_until = CASE WHEN $2 IN ('suspended','locked','disabled') THEN now() + interval '10 years' ELSE NULL END
      WHERE id = $1`,
    [userId, status],
  );
  if (status !== 'active') {
    await execute('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'user.status_updated',
    entityType: 'user',
    entityId: userId,
    entityLabel: target.name,
    description: `${target.name}'s account was set to ${status}`,
    oldValues: { status: target.status },
    newValues: { status },
    severity: 'warning',
  });
  revalidatePath('/admin/users');
  return { ok: true, message: `Account set to ${status}.` };
}

export async function deleteUserAction(userId: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'users.delete')) return { ok: false, error: 'You do not have permission to remove accounts.' };
  if (userId === user.id) return { ok: false, error: 'You cannot remove your own account.' };
  const target = await one<any>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (!target) return { ok: false, error: 'User not found.' };

  await execute('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  await execute(`UPDATE users SET deleted_at = now(), status = 'disabled' WHERE id = $1`, [userId]);
  await execute('UPDATE members SET user_id = NULL WHERE user_id = $1', [userId]);

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'user.deleted',
    entityType: 'user',
    entityId: userId,
    entityLabel: target.name,
    description: `Removed account ${target.name} (soft delete — history preserved)`,
    oldValues: { name: target.name, login_id: target.login_id, role_id: target.role_id },
    severity: 'critical',
  });
  revalidatePath('/admin/users');
  return { ok: true, message: `Account for ${target.name} removed (soft delete).` };
}

/* ------------------------------------------------------------------ *
 * ROLES & PERMISSIONS
 * ------------------------------------------------------------------ */
export async function togglePermissionAction(roleId: number, permissionId: number, granted: boolean): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'roles.update')) return { ok: false, error: 'You do not have permission to change role permissions.' };
  const role = await one<any>('SELECT * FROM roles WHERE id = $1', [roleId]);
  const permission = await one<any>('SELECT * FROM permissions WHERE id = $1', [permissionId]);
  if (!role || !permission) return { ok: false, error: 'Role or permission not found.' };
  if (role.key === 'super_admin') return { ok: false, error: 'The super administrator role always has every permission.' };

  if (granted) {
    await execute(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, permissionId],
    );
  } else {
    await execute('DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [roleId, permissionId]);
  }
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: granted ? 'role.permission_granted' : 'role.permission_revoked',
    entityType: 'role',
    entityId: roleId,
    entityLabel: role.name,
    description: `${granted ? 'Granted' : 'Revoked'} "${permission.name}" (${permission.key}) for the ${role.name} role`,
    newValues: { role: role.key, permission: permission.key, granted },
    severity: 'critical',
  });
  revalidatePath('/admin/roles');
  revalidatePath('/admin');
  return { ok: true, message: `${permission.name} ${granted ? 'granted to' : 'revoked from'} ${role.name}.` };
}

/* ------------------------------------------------------------------ *
 * SYSTEM SETTINGS
 * ------------------------------------------------------------------ */
export async function saveSettingGroupAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update')) return { ok: false, error: 'You do not have permission to change system settings.' };
  const key = String(formData.get('setting_key') || '').trim();
  if (!key) return { ok: false, error: 'Missing setting key.' };
  let payload: any;
  try {
    payload = JSON.parse(String(formData.get('payload') || '{}'));
  } catch {
    return { ok: false, error: 'Invalid settings payload (expected JSON).' };
  }
  const before = await getSetting(key);
  await setSetting(key, payload, { updatedBy: user.id, groupName: String(formData.get('group_name') || 'general') });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'settings.updated',
    entityType: 'system_settings',
    entityLabel: key,
    description: `Updated "${key}" settings`,
    oldValues: before,
    newValues: payload,
    severity: key === 'security' || key === 'payments' ? 'critical' : 'warning',
  });
  revalidatePath('/admin/settings');
  revalidatePath('/admin');
  revalidatePath('/settings');
  return { ok: true, message: `"${key}" settings saved.` };
}

export async function saveOrgSettingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update')) return { ok: false, error: 'You do not have permission to change organisation settings.' };
  const before = await getSetting('organisation');
  const payload = {
    name: String(formData.get('name') || before.name || 'Catholic Men Association (CMA)'),
    short_name: String(formData.get('short_name') || before.short_name || 'CMA'),
    parish: String(formData.get('parish') || ''),
    deanery: String(formData.get('deanery') || ''),
    diocese: String(formData.get('diocese') || ''),
    archdiocese: String(formData.get('archdiocese') || ''),
    motto: String(formData.get('motto') || ''),
    address: String(formData.get('address') || ''),
    phone: String(formData.get('phone') || ''),
    email: String(formData.get('email') || ''),
    mpesa_paybill: String(formData.get('mpesa_paybill') || ''),
    mpesa_account_prefix: String(formData.get('mpesa_account_prefix') || ''),
    bank_name: String(formData.get('bank_name') || ''),
    bank_account: String(formData.get('bank_account') || ''),
    bank_branch: String(formData.get('bank_branch') || ''),
    logo_url: String(formData.get('logo_url') || before.logo_url || '') || null,
    currency: String(formData.get('currency') || before.currency || 'KES'),
    currency_symbol: String(formData.get('currency_symbol') || before.currency_symbol || 'KSh'),
    timezone: String(formData.get('timezone') || before.timezone || 'Africa/Nairobi'),
  };
  await setSetting('organisation', payload, { updatedBy: user.id, groupName: 'organisation' });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'settings.updated',
    entityType: 'system_settings',
    entityLabel: 'organisation',
    description: 'Organisation profile updated',
    oldValues: before,
    newValues: payload,
  });
  revalidatePath('/admin/settings');
  revalidatePath('/admin');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Organisation profile saved.' };
}

export async function saveSecuritySettingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update')) return { ok: false, error: 'You do not have permission to change security settings.' };
  const before = await getSetting('security');
  const payload = {
    ...before,
    password_min_length: Math.max(6, Math.floor(num(formData.get('password_min_length')) || 8)),
    password_require_number: formData.get('password_require_number') === 'on',
    password_require_special: formData.get('password_require_special') === 'on',
    session_timeout_hours: Math.max(1, Math.floor(num(formData.get('session_timeout_hours')) || 12)),
    max_failed_attempts: Math.max(2, Math.floor(num(formData.get('max_failed_attempts')) || 5)),
    lockout_minutes: Math.max(1, Math.floor(num(formData.get('lockout_minutes')) || 15)),
    two_factor_enabled: formData.get('two_factor_enabled') === 'on',
    audit_retention_days: Math.max(30, Math.floor(num(formData.get('audit_retention_days')) || 730)),
    encrypt_sensitive_fields: formData.get('encrypt_sensitive_fields') === 'on',
    dpa_consent_required: formData.get('dpa_consent_required') === 'on',
  };
  await setSetting('security', payload, { updatedBy: user.id, groupName: 'security' });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'settings.updated',
    entityType: 'system_settings',
    entityLabel: 'security',
    description: 'Security policy updated',
    oldValues: before,
    newValues: payload,
    severity: 'critical',
  });
  revalidatePath('/admin/settings');
  revalidatePath('/admin/security');
  return { ok: true, message: 'Security settings saved.' };
}

export async function saveNotificationSettingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update')) return { ok: false, error: 'You do not have permission to change notification settings.' };
  const before = await getSetting('notifications');
  const payload = {
    ...before,
    sms_enabled: formData.get('sms_enabled') === 'on',
    email_enabled: formData.get('email_enabled') === 'on',
    whatsapp_enabled: formData.get('whatsapp_enabled') === 'on',
    in_system_enabled: formData.get('in_system_enabled') === 'on',
    sms_provider: String(formData.get('sms_provider') || before.sms_provider || 'none'),
    sms_sender_id: String(formData.get('sms_sender_id') || ''),
    sms_api_key: String(formData.get('sms_api_key') || '').trim() || before.sms_api_key || '',
    sms_api_secret: String(formData.get('sms_api_secret') || '').trim() || before.sms_api_secret || '',
    smtp_host: String(formData.get('smtp_host') || ''),
    smtp_port: Math.floor(num(formData.get('smtp_port')) || 587),
    smtp_user: String(formData.get('smtp_user') || ''),
    smtp_password: String(formData.get('smtp_password') || '').trim() || before.smtp_password || '',
    smtp_from: String(formData.get('smtp_from') || ''),
    whatsapp_token: String(formData.get('whatsapp_token') || '').trim() || before.whatsapp_token || '',
    whatsapp_phone_id: String(formData.get('whatsapp_phone_id') || ''),
  };
  await setSetting('notifications', payload, { updatedBy: user.id, groupName: 'notifications', isSecret: true });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'settings.updated',
    entityType: 'system_settings',
    entityLabel: 'notifications',
    description: 'Notification channels updated',
    oldValues: { sms_enabled: before.sms_enabled, email_enabled: before.email_enabled },
    newValues: { sms_enabled: payload.sms_enabled, email_enabled: payload.email_enabled, whatsapp_enabled: payload.whatsapp_enabled },
    severity: 'warning',
  });
  revalidatePath('/admin/settings');
  return { ok: true, message: 'Notification settings saved.' };
}

export async function saveGuarantorSettingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update') && !can(user, 'loans.manage')) {
    return { ok: false, error: 'You do not have permission to change the guarantor policy.' };
  }
  const before = await getSetting('guarantors');
  const payload = {
    ...before,
    min_guarantors: Math.max(0, Math.floor(num(formData.get('min_guarantors')))),
    max_guarantors: Math.max(1, Math.floor(num(formData.get('max_guarantors')) || 5)),
    max_exposure_per_guarantor: Math.max(0, Math.round(num(formData.get('max_exposure_per_guarantor')) * 100) / 100),
    guarantor_must_be_active_member: formData.get('guarantor_must_be_active_member') === 'on',
    guarantor_max_outstanding: Math.round(num(formData.get('guarantor_max_outstanding')) * 100) / 100,
    guarantor_approval_required: formData.get('guarantor_approval_required') === 'on',
    guarantor_self_guarantee: formData.get('guarantor_self_guarantee') === 'on',
  };
  await setSetting('guarantors', payload, { updatedBy: user.id, groupName: 'loans' });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'settings.updated',
    entityType: 'system_settings',
    entityLabel: 'guarantors',
    description: 'Guarantor policy updated',
    oldValues: before,
    newValues: payload,
    severity: 'warning',
  });
  revalidatePath('/admin/settings');
  revalidatePath('/loans/apply');
  return { ok: true, message: 'Guarantor policy saved.' };
}

/* ------------------------------------------------------------------ *
 * ORGANISATIONAL HIERARCHY
 * country → archdiocese/diocese → deanery → parish → church/outstation → SCC → member
 * ------------------------------------------------------------------ */
const ORG_TABLES: Record<string, string[]> = {
  dioceses: ['name', 'code', 'country_id', 'type', 'bishop', 'active'],
  deaneries: ['name', 'code', 'diocese_id', 'active'],
  parishes: ['name', 'code', 'deanery_id', 'diocese_id', 'parish_priest', 'cma_chaplain', 'address', 'phone', 'email', 'active'],
  churches: ['name', 'code', 'parish_id', 'type', 'location', 'active'],
  small_christian_communities: ['name', 'code', 'parish_id', 'church_id', 'leader_name', 'active'],
};

export async function saveOrgEntityAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update') && !can(user, 'users.manage')) {
    return { ok: false, error: 'You do not have permission to manage the organisational structure.' };
  }
  const table = String(formData.get('entity') || '');
  const columns = ORG_TABLES[table];
  if (!columns) return { ok: false, error: 'Unknown organisation entity.' };

  const id = Number(formData.get('id') || 0);
  const values: Record<string, any> = {};
  for (const c of columns) {
    const raw = formData.get(c);
    if (raw === null) continue;
    if (c === 'active') values[c] = raw === 'on' || raw === 'true';
    else if (c.endsWith('_id') || c === 'members_count') values[c] = raw === '' ? null : Number(raw);
    else values[c] = String(raw).trim() || null;
  }
  if (!values.name) return { ok: false, error: 'Enter a name.' };

  const keys = Object.keys(values);
  if (id) {
    const before = await one<any>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!before) return { ok: false, error: 'Record not found.' };
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await execute(`UPDATE ${table} SET ${sets} WHERE id = $1`, [id, ...keys.map((k) => values[k])]);
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'org.updated',
      entityType: table,
      entityId: id,
      entityLabel: values.name,
      description: `Updated ${table.replace(/_/g, ' ')} "${values.name}"`,
      oldValues: before,
      newValues: values,
    });
    revalidatePath('/admin/organization');
    revalidatePath('/members');
    return { ok: true, message: `${values.name} updated.` };
  }

  const created = await one<any>(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    keys.map((k) => values[k]),
  );
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'org.created',
    entityType: table,
    entityId: created.id,
    entityLabel: values.name,
    description: `Created ${table.replace(/_/g, ' ')} "${values.name}"`,
    newValues: values,
  });
  revalidatePath('/admin/organization');
  revalidatePath('/members');
  revalidatePath('/register');
  return { ok: true, message: `${values.name} created.`, data: created };
}

export async function deactivateOrgEntityAction(table: string, id: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update')) return { ok: false, error: 'You do not have permission to modify the organisational structure.' };
  if (!ORG_TABLES[table]) return { ok: false, error: 'Unknown entity.' };
  const before = await one<any>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!before) return { ok: false, error: 'Record not found.' };
  await execute(`UPDATE ${table} SET active = FALSE WHERE id = $1`, [id]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'org.deactivated',
    entityType: table,
    entityId: id,
    entityLabel: before.name,
    description: `Deactivated ${table.replace(/_/g, ' ')} "${before.name}"`,
    oldValues: { active: before.active },
    newValues: { active: false },
    severity: 'warning',
  });
  revalidatePath('/admin/organization');
  return { ok: true, message: `${before.name} deactivated.` };
}

/* ------------------------------------------------------------------ *
 * BACKUP & HOUSEKEEPING
 * ------------------------------------------------------------------ */
export async function createBackupAction(notes?: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update') && !can(user, 'users.manage')) {
    return { ok: false, error: 'You do not have permission to run backups.' };
  }

  const tables = Object.keys(ORG_TABLES).concat([
    'countries', 'roles', 'permissions', 'role_permissions', 'users', 'user_sessions', 'members',
    'member_documents', 'documents', 'financial_years', 'contribution_types', 'member_contributions',
    'project_categories', 'welfare_cases', 'welfare_payments', 'funeral_cases', 'funeral_payments',
    'wedding_cases', 'wedding_payments', 'special_projects', 'project_contributions', 'sacco_accounts',
    'savings', 'shares', 'share_transactions', 'sacco_transactions', 'dividends', 'dividend_allocations',
    'loan_types', 'loan_applications', 'loan_guarantors', 'loans', 'loan_schedules', 'loan_repayments',
    'penalties', 'payments', 'payment_allocations', 'receipts', 'mpesa_transactions', 'meetings',
    'attendance', 'notices', 'notifications', 'notification_logs', 'login_attempts', 'audit_logs',
    'system_settings',
  ]);

  const snapshot: Record<string, any[]> = {};
  let rows = 0;
  for (const t of tables) {
    try {
      const data = await query<any>(`SELECT * FROM ${t}`);
      snapshot[t] = data;
      rows += data.length;
    } catch {
      /* table may not exist in this deployment */
    }
  }

  const payload = JSON.stringify({
    generated_at: new Date().toISOString(),
    generated_by: user.name,
    table_count: Object.keys(snapshot).length,
    row_count: rows,
    tables: snapshot,
  });
  const fileName = `cma-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

  let filePath: string | null = null;
  try {
    const { storeFile } = await import('@/lib/files');
    const stored = await storeFile({
      buffer: Buffer.from(payload, 'utf8'),
      fileName,
      mimeType: 'application/json',
      folder: 'backups',
    });
    filePath = stored.file_url;
  } catch (e: any) {
    console.error('[backup] storage failed', e?.message);
  }

  const backup = await one<any>(
    `INSERT INTO backups (file_name, file_path, size_bytes, backup_type, status, message, created_by)
     VALUES ($1,$2,$3,'manual','completed',$4,$5) RETURNING *`,
    [
      fileName,
      filePath,
      Buffer.byteLength(payload),
      `${Object.keys(snapshot).length} tables, ${rows} rows.${notes ? ` ${notes}` : ''}`.slice(0, 320),
      user.id,
    ],
  );

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'backup.created',
    entityType: 'backups',
    entityId: backup.id,
    entityLabel: fileName,
    description: `Manual backup created: ${rows} rows across ${Object.keys(snapshot).length} tables`,
    severity: 'warning',
  });

  revalidatePath('/admin/backups');
  revalidatePath('/admin');
  return {
    ok: true,
    message: `Backup complete — ${rows.toLocaleString()} rows across ${Object.keys(snapshot).length} tables.`,
    data: backup,
  };
}

export async function restoreBackupAction(backupId: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'users.manage')) return { ok: false, error: 'Only a super administrator can restore a backup.' };
  const backup = await one<any>('SELECT * FROM backups WHERE id = $1', [backupId]);
  if (!backup) return { ok: false, error: 'Backup not found.' };
  await execute(`UPDATE backups SET message = $2 WHERE id = $1`, [
    backupId,
    `Restore requested by ${user.name} on ${new Date().toISOString()}.`.slice(0, 320),
  ]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'backup.restore_requested',
    entityType: 'backups',
    entityId: backupId,
    entityLabel: backup.file_name,
    description: `Restore requested for backup ${backup.file_name}`,
    severity: 'critical',
  });
  revalidatePath('/admin/backups');
  return {
    ok: true,
    message: `Restore request logged for ${backup.file_name}. Download the file and load it into PostgreSQL to complete the restore.`,
    data: { file_path: backup.file_path },
  };
}

export async function purgeAuditLogsAction(): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'users.manage')) return { ok: false, error: 'Only a super administrator can purge audit logs.' };
  const settings = await getSetting('security', { audit_retention_days: 730 } as any);
  const retention = Math.max(30, Number(settings.audit_retention_days) || 730);
  const deleted = await execute(`DELETE FROM audit_logs WHERE created_at < now() - ($1 || ' days')::interval`, [String(retention)]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'audit.purged',
    entityType: 'audit_logs',
    description: `Purged ${deleted} audit log entries older than ${retention} days`,
    severity: 'critical',
  });
  revalidatePath('/admin/audit');
  return { ok: true, message: `${deleted} audit log entry(ies) older than ${retention} days were purged.` };
}

export async function runNightlyJobsAction(): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update') && !can(user, 'users.manage')) {
    return { ok: false, error: 'You do not have permission to run system jobs.' };
  }
  const { refreshContributionStatuses, billMonthlyContributions } = await import('@/lib/contributions');
  const { refreshLoanStatuses, chargeLoanPenalties } = await import('@/lib/loans');
  const { getContributionSettings } = await import('@/lib/settings');
  const { periodKey } = await import('@/lib/dates');

  const settings = await getContributionSettings();
  const billed = settings.auto_bill
    ? await billMonthlyContributions({ period: periodKey(new Date()), actor: { id: user.id, name: user.name }, notifyMembers: false })
    : { created: 0, amount: settings.monthly_amount, due_date: '', exempted: 0 };

  const contributions = await refreshContributionStatuses();
  const loans = await refreshLoanStatuses({ id: user.id, name: user.name });
  const penalties = await chargeLoanPenalties({ id: user.id, name: user.name });

  await setSetting('system', { last_housekeeping: new Date().toISOString(), last_housekeeping_by: user.name }, {
    updatedBy: user.id,
    groupName: 'system',
  });

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'system.housekeeping',
    entityType: 'system',
    description: `Housekeeping run: ${billed.created} bill(s) created, ${contributions.updated} contribution record(s) updated, ${loans.overdue} loan(s) in arrears, ${penalties} penalty(ies) raised`,
  });

  revalidatePath('/admin');
  revalidatePath('/dashboard');
  revalidatePath('/contributions');
  revalidatePath('/loans');
  return {
    ok: true,
    message: `Jobs complete — ${billed.created} new bill(s), ${contributions.updated} contribution record(s) updated, ${loans.overdue} loan(s) in arrears, ${loans.defaulted} defaulted, ${penalties} penalty(ies) raised.`,
  };
}

export { allSettings, ORG_TABLES };
