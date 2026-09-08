'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  login,
  logout,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  changePassword,
  verifyTwoFactor,
  getCurrentUser,
  requestMeta,
} from '@/lib/auth';
import { one, execute } from '@/lib/db';
import { hashPassword, passwordProblems } from '@/lib/crypto';
import { logAudit } from '@/lib/audit';
import { notifyRole } from '@/lib/notify';
import { can, ROLES } from '@/lib/rbac';
import { normalisePhone } from '@/lib/money';
import { memberSchema, firstError } from '@/lib/validators';
import { nextMembershipNumber, createMemberRecord } from '@/server/services/members';

export type ActionResult<T = any> = { ok: boolean; message?: string; error?: string; data?: T };

/* ------------------------------------------------------------------ *
 * LOGIN / LOGOUT
 * ------------------------------------------------------------------ */
export async function loginAction(_prev: any, formData: FormData): Promise<ActionResult & { requires2fa?: boolean; userId?: number; devCode?: string }> {
  const identifier = String(formData.get('identifier') || '').trim();
  const password = String(formData.get('password') || '');
  const remember = formData.get('remember') === 'on';

  if (!identifier || !password) return { ok: false, error: 'Enter your phone number, email or CMA number and your password.' };

  const result = await login(identifier, password, { remember });
  if (!result.ok) return { ok: false, error: result.error || 'Sign in failed.' };

  if (result.requires2fa) {
    return {
      ok: false,
      requires2fa: true,
      userId: (result as any).userId,
      devCode: result.devCode,
      message: `A verification code was sent by ${result.method === 'email' ? 'email' : 'SMS'}.`,
    };
  }

  revalidatePath('/', 'layout');
  const user = await getCurrentUser();
  const next = user && can(user, 'members.view') ? '/dashboard' : '/dashboard';
  redirect(next);
}

export async function twoFactorAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const userId = Number(formData.get('user_id'));
  const code = String(formData.get('code') || '').trim();
  const remember = formData.get('remember') === 'on';
  const result = await verifyTwoFactor(userId, code, remember);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function logoutAction() {
  await logout(false);
  redirect('/login?logged_out=1');
}

/* ------------------------------------------------------------------ *
 * PASSWORD RESET
 * ------------------------------------------------------------------ */
export async function requestResetAction(_prev: any, formData: FormData): Promise<ActionResult & { devCode?: string; channel?: string; destination?: string }> {
  const identifier = String(formData.get('identifier') || '').trim();
  const channel = (String(formData.get('channel') || 'sms') as 'sms' | 'email') || 'sms';
  if (!identifier) return { ok: false, error: 'Enter the phone number, email or CMA number linked to your account.' };
  const result = await requestPasswordResetOtp(identifier, channel);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    message: `If an account exists for "${identifier}", a 6-digit reset code has been sent by ${result.channel || channel}.`,
    devCode: result.devCode,
    channel: result.channel,
    destination: result.destination,
  };
}

export async function resetPasswordAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const identifier = String(formData.get('identifier') || '').trim();
  const code = String(formData.get('code') || '').trim();
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('confirm_password') || '');

  if (password !== confirm) return { ok: false, error: 'The two passwords do not match.' };
  const problems = passwordProblems(password);
  if (problems.length) return { ok: false, error: problems[0] };

  const result = await resetPasswordWithOtp(identifier, code, password);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: 'Your password has been reset. You can now sign in with the new password.' };
}

export async function changePasswordAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  const current = String(formData.get('current_password') || '');
  const next = String(formData.get('new_password') || '');
  const confirm = String(formData.get('confirm_password') || '');
  if (next !== confirm) return { ok: false, error: 'The new passwords do not match.' };
  const problems = passwordProblems(next);
  if (problems.length) return { ok: false, error: problems[0] };
  if (current === next) return { ok: false, error: 'The new password must be different from the current one.' };
  const result = await changePassword(user.id, current, next);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/settings');
  return { ok: true, message: 'Password updated successfully.' };
}

/* ------------------------------------------------------------------ *
 * SELF REGISTRATION (member sign-up)
 * ------------------------------------------------------------------ */
export async function registerAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('confirm_password') || '');
  if (password !== confirm) return { ok: false, error: 'The two passwords do not match.' };
  const problems = passwordProblems(password);
  if (problems.length) return { ok: false, error: problems[0] };

  const parsed = memberSchema.safeParse({
    ...Object.fromEntries(formData.entries()),
    membership_status: 'pending',
    gender: 'male',
    date_joined: String(formData.get('date_joined') || new Date().toISOString().slice(0, 10)),
    church_id: formData.get('church_id') || null,
    scc_id: formData.get('scc_id') || null,
  });
  const error = firstError(parsed);
  if (error || !parsed.success) return { ok: false, error: error || 'Please correct the highlighted fields.' };

  const data = parsed.data;
  const phone = normalisePhone(data.phone);
  if (!phone) return { ok: false, error: 'Enter a valid mobile phone number.' };

  const existing = await one<{ id: number }>(
    'SELECT id FROM users WHERE phone = $1 OR (email IS NOT NULL AND lower(email) = lower($2))',
    [phone, data.email || null],
  );
  if (existing) return { ok: false, error: 'An account with this phone number or email already exists. Please sign in or reset your password.' };

  const memberPhone = await one<{ id: number }>('SELECT id FROM members WHERE phone = $1', [phone]);
  if (memberPhone) return { ok: false, error: 'A member record with this phone number already exists. Contact the CMA Secretary.' };

  const parish = await one<any>('SELECT * FROM parishes WHERE id = $1', [data.parish_id]);
  if (!parish) return { ok: false, error: 'Select a valid parish.' };

  const membershipNo = data.membership_no?.trim() || (await nextMembershipNumber(parish.code));
  const { ip, userAgent } = await requestMeta();

  const member = await createMemberRecord({
    data: { ...data, membership_no: membershipNo, phone } as any,
    actor: { id: null, name: 'Self registration' },
    createLogin: { password, ip, userAgent },
  });

  await notifyRole('secretary', {
    title: 'New member registration pending approval',
    body: `${member.full_name} (${member.membership_no}) has registered online and is awaiting verification by the Secretary.`,
    category: 'membership',
    priority: 'high',
    link: `/members/${member.id}`,
    referenceType: 'member',
    referenceId: member.id,
  });
  await notifyRole('admin', {
    title: 'New member registration',
    body: `${member.full_name} (${member.membership_no}) submitted an online registration.`,
    category: 'membership',
    link: `/members/${member.id}`,
    referenceType: 'member',
    referenceId: member.id,
  });
  await logAudit({
    userId: member.user_id ?? null,
    userName: member.full_name,
    action: 'member.self_registered',
    entityType: 'member',
    entityId: member.id,
    entityLabel: member.membership_no,
    description: 'Online self-registration submitted',
    ip,
    userAgent,
  });

  revalidatePath('/login');
  return {
    ok: true,
    message: `Registration received. Your CMA number is ${membershipNo}. The Secretary will verify your details; you can sign in immediately with your phone number and password.`,
  };
}

/* ------------------------------------------------------------------ *
 * PROFILE PHOTO / ACCOUNT
 * ------------------------------------------------------------------ */
export async function updateOwnProfileAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  if (!user.member_id) return { ok: false, error: 'This account is not linked to a member record.' };
  if (!can(user, 'profile.update_own') && !can(user, 'members.update')) {
    return { ok: false, error: 'You are not allowed to edit this profile.' };
  }

  const fields = [
    'alt_phone', 'email', 'residential_area', 'occupation', 'employer', 'next_of_kin', 'next_of_kin_relation',
    'next_of_kin_phone', 'emergency_contact', 'emergency_contact_rel', 'emergency_contact_phone', 'marital_status',
  ];
  const updates: string[] = [];
  const params: any[] = [];
  for (const f of fields) {
    if (formData.has(f)) {
      params.push(String(formData.get(f) || '').trim() || null);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return { ok: false, error: 'Nothing to update.' };

  const before = await one<any>('SELECT * FROM members WHERE id = $1', [user.member_id]);
  params.push(user.member_id);
  await execute(`UPDATE members SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
  const after = await one<any>('SELECT * FROM members WHERE id = $1', [user.member_id]);

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'member.profile_updated',
    entityType: 'member',
    entityId: user.member_id,
    entityLabel: after?.membership_no,
    description: 'Member updated their own profile',
    oldValues: Object.fromEntries(fields.map((f) => [f, before?.[f]])),
    newValues: Object.fromEntries(fields.map((f) => [f, after?.[f]])),
  });

  revalidatePath('/my-profile');
  revalidatePath(`/members/${user.member_id}`);
  return { ok: true, message: 'Your profile has been updated.' };
}

export async function enableTwoFactorAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  await execute('UPDATE users SET two_factor_enabled = TRUE WHERE id = $1', [user.id]);
  await logAudit({ userId: user.id, userName: user.name, action: 'security.2fa_enabled', entityType: 'user', entityId: user.id, description: 'Two-factor authentication enabled', severity: 'warning' });
  revalidatePath('/settings');
  return { ok: true, message: 'Two-factor authentication enabled. You will receive a code by SMS or email at each sign-in.' };
}

export async function disableTwoFactorAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  await execute('UPDATE users SET two_factor_enabled = FALSE WHERE id = $1', [user.id]);
  await logAudit({ userId: user.id, userName: user.name, action: 'security.2fa_disabled', entityType: 'user', entityId: user.id, description: 'Two-factor authentication disabled', severity: 'warning' });
  revalidatePath('/settings');
  return { ok: true, message: 'Two-factor authentication disabled.' };
}

export async function revokeSessionAction(sessionId: number): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  await execute('UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2', [sessionId, user.id]);
  await logAudit({ userId: user.id, userName: user.name, action: 'session.revoked', entityType: 'user_session', entityId: sessionId, description: 'Session revoked by the account owner' });
  revalidatePath('/settings');
  return { ok: true, message: 'Session ended.' };
}

