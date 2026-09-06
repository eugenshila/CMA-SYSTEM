import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { one, query, execute } from './db';
import { env } from './env';
import {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  generateOtp,
} from './crypto';
import { can, permissionsForRole, ROLES, type PermissionUser } from './rbac';
import { logAudit } from './audit';
import { getSecuritySettings } from './settings';
import { normalisePhone } from './money';

export const SESSION_COOKIE = 'cma_session';
export const CHALLENGE_COOKIE = 'cma_2fa';

export interface SessionUser extends PermissionUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role_id: number;
  role_key: string;
  role_name: string;
  member_id: number | null;
  scope_parish_id: number | null;
  scope_diocese_id: number | null;
  photo_url: string | null;
  membership_no: string | null;
  two_factor_enabled: boolean;
  must_change_password: boolean;
  permissions: string[];
  session_id: number;
}

const secretKey = () => new TextEncoder().encode(env.AUTH_SECRET);

/* ------------------------------------------------------------------ *
 * Request metadata
 * ------------------------------------------------------------------ */
export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      h.get('x-real-ip') ||
      null;
    return { ip, userAgent: h.get('user-agent') };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */
async function signSession(userId: number, sessionId: number, roleKey: string, hours: number) {
  return new SignJWT({ rk: roleKey, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setIssuer('cma-system')
    .setExpirationTime(`${Math.round(hours * 3600)}s`)
    .sign(secretKey());
}

async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: 'cma-system' });
    return payload as { sub: string; sid: number; rk: string; exp: number };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Current user
 * ------------------------------------------------------------------ */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const row = await one<any>(
    `SELECT u.id, u.name, u.email, u.phone, u.member_id, u.status, u.role_id, u.two_factor_enabled,
            u.must_change_password, u.scope_parish_id, u.scope_diocese_id,
            r.key AS role_key, r.name AS role_name, r.level AS role_level,
            m.membership_no, m.photo_url, m.membership_status,
            s.id AS session_id, s.revoked_at, s.expires_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN members m ON m.id = u.member_id
       LEFT JOIN user_sessions s ON s.id = $2
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [Number(payload.sub), payload.sid],
  );

  if (!row) return null;
  if (row.status !== 'active') return null;
  if (row.session_id && (row.revoked_at || new Date(row.expires_at) < new Date())) return null;

  const permissions = await permissionsForRole(row.role_id);

  // keep the session "last seen" fresh (best effort)
  execute('UPDATE user_sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]).catch(() => {});

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role_id: row.role_id,
    role_key: row.role_key,
    role_name: row.role_name,
    role_level: row.role_level,
    member_id: row.member_id,
    scope_parish_id: row.scope_parish_id,
    scope_diocese_id: row.scope_diocese_id,
    photo_url: row.photo_url,
    membership_no: row.membership_no,
    two_factor_enabled: Boolean(row.two_factor_enabled),
    must_change_password: Boolean(row.must_change_password),
    permissions,
    session_id: row.session_id,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requirePermission(permission: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect('/dashboard?denied=1');
  return user;
}

export async function requireRole(...roles: string[]): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role_key === ROLES.SUPER_ADMIN) return user;
  if (!roles.includes(user.role_key)) redirect('/dashboard?denied=1');
  return user;
}

/* ------------------------------------------------------------------ *
 * Login / logout
 * ------------------------------------------------------------------ */
export interface LoginResult {
  ok: boolean;
  error?: string;
  requires2fa?: boolean;
  challengeToken?: string;
  method?: 'sms' | 'email';
  user?: SessionUser;
  mustChangePassword?: boolean;
  devCode?: string;
}

export async function findUserByIdentifier(identifierRaw: string) {
  const identifier = String(identifierRaw || '').trim();
  if (!identifier) return null;
  const phone = normalisePhone(identifier);
  const localPhone = identifier.startsWith('0') ? identifier : null;

  return one<any>(
    `SELECT u.*, r.key AS role_key, r.name AS role_name, m.membership_no
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN members m ON m.id = u.member_id
      WHERE u.deleted_at IS NULL
        AND ( lower(u.email) = lower($1)
           OR u.phone = $2
           OR lower(u.login_id) = lower($1)
           OR lower(m.membership_no) = lower($1) )
      LIMIT 1`,
    [identifier, phone || localPhone],
  );
}

export async function login(identifier: string, password: string, opts: { remember?: boolean } = {}): Promise<LoginResult> {
  const security = await getSecuritySettings();
  const { ip, userAgent } = await requestMeta();

  const user = await findUserByIdentifier(identifier);
  await execute(
    'INSERT INTO login_attempts (identifier, ip_address, user_agent, success, reason) VALUES ($1,$2,$3,$4,$5)',
    [identifier, ip, userAgent, Boolean(user), user ? null : 'unknown identifier'],
  );

  if (!user) {
    return { ok: false, error: 'Invalid credentials. Please check your phone number, email or CMA number.' };
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    return { ok: false, error: `Account temporarily locked after too many failed attempts. Try again in ${mins} minute(s).` };
  }

  if (user.status === 'suspended' || user.status === 'disabled') {
    return { ok: false, error: 'This account has been suspended. Please contact the CMA Secretary or Administrator.' };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const attempts = (user.failed_attempts || 0) + 1;
    const shouldLock = attempts >= security.max_failed_attempts;
    await execute(
      `UPDATE users SET failed_attempts = $2,
              locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
        WHERE id = $1`,
      [user.id, attempts, shouldLock, security.lockout_minutes],
    );
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'login.failed',
      entityType: 'user',
      entityId: user.id,
      description: shouldLock
        ? `Failed login — account locked for ${security.lockout_minutes} minutes`
        : `Failed login attempt ${attempts}/${security.max_failed_attempts}`,
      ip,
      userAgent,
      severity: shouldLock ? 'warning' : 'info',
    });
    return {
      ok: false,
      error: shouldLock
        ? `Too many failed attempts. Your account has been locked for ${security.lockout_minutes} minutes.`
        : `Invalid password. ${security.max_failed_attempts - attempts} attempt(s) remaining before lockout.`,
    };
  }

  if (user.must_change_password) {
    // allow login but force the password change screen
  }

  if (user.two_factor_enabled && security.two_factor_enabled) {
    const nonce = randomToken(24);
    const otp = generateOtp(6);
    const channel: 'sms' | 'email' = user.phone ? 'sms' : 'email';
    const destination = channel === 'sms' ? user.phone : user.email;

    const cookieStore = await cookies();
    cookieStore.set(CHALLENGE_COOKIE, `${user.id}:${sha256(nonce)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      maxAge: 600,
      path: '/',
    });
    await execute('UPDATE otp_codes SET consumed_at = now() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL', [
      user.id,
      'two_factor',
    ]);
    await execute(
      `INSERT INTO otp_codes (user_id, purpose, code_hash, channel, destination, expires_at)
       VALUES ($1,'two_factor',$2,$3,$4, now() + interval '10 minutes')`,
      [user.id, sha256(otp), channel, destination],
    );
    if (destination) {
      const { sendOtp } = await import('./notify');
      await sendOtp({ to: destination, channel, name: user.name, code: otp, purpose: 'two_factor', userId: user.id });
    }
    return {
      ok: true,
      requires2fa: true,
      challengeToken: nonce,
      method: channel,
      devCode: env.isProduction ? undefined : otp,
    } as LoginResult;
  }

  return completeLogin(user, security, ip, userAgent, opts.remember);
}

async function completeLogin(
  user: any,
  security: Awaited<ReturnType<typeof getSecuritySettings>>,
  ip: string | null,
  userAgent: string | null,
  remember?: boolean,
): Promise<LoginResult> {
  const hours = remember ? security.remember_me_days * 24 : security.session_hours;
  const sessionId = await createSession(user.id, hours, ip, userAgent);
  const token = await signSession(user.id, sessionId, user.role_key, hours);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: hours * 3600,
    path: '/',
  });

  await execute(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now(), last_login_ip = $2 WHERE id = $1',
    [user.id, ip],
  );
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'login.success',
    entityType: 'user',
    entityId: user.id,
    description: `Signed in as ${user.role_name || user.role_key}`,
    ip,
    userAgent,
  });

  const permissions = await permissionsForRole(user.role_id);
  return {
    ok: true,
    mustChangePassword: Boolean(user.must_change_password),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role_id: user.role_id,
      role_key: user.role_key,
      role_name: user.role_name,
      member_id: user.member_id,
      scope_parish_id: user.scope_parish_id,
      scope_diocese_id: user.scope_diocese_id,
      photo_url: null,
      membership_no: user.membership_no,
      two_factor_enabled: Boolean(user.two_factor_enabled),
      must_change_password: Boolean(user.must_change_password),
      permissions,
      session_id: sessionId,
    },
  };
}

export async function createSession(userId: number, hours: number, ip: string | null, userAgent: string | null) {
  const raw = randomToken(32);
  const row = await one<{ id: number }>(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)
     RETURNING id`,
    [userId, sha256(raw), ip, userAgent, hours],
  );
  return row!.id;
}

export async function logout(redirectAfter = true) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload) {
      await execute('UPDATE user_sessions SET revoked_at = now() WHERE id = $1', [payload.sid]);
      await logAudit({
        userId: Number(payload.sub),
        action: 'logout',
        entityType: 'user',
        entityId: Number(payload.sub),
        description: 'Signed out',
      });
    }
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(CHALLENGE_COOKIE);
  if (redirectAfter) redirect('/login?logged_out=1');
}

export async function revokeAllSessions(userId: number) {
  await execute('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

/* ------------------------------------------------------------------ *
 * Password reset via OTP (SMS or email)
 * ------------------------------------------------------------------ */
export interface OtpRequestResult {
  ok: boolean;
  error?: string;
  channel?: 'sms' | 'email';
  destination?: string;
  devCode?: string;
}

export async function requestPasswordResetOtp(identifier: string, preferredChannel: 'sms' | 'email' = 'sms'): Promise<OtpRequestResult> {
  const user = await findUserByIdentifier(identifier);
  const { ip } = await requestMeta();

  // Do not reveal whether an account exists.
  if (!user) return { ok: true, channel: preferredChannel, destination: '' };

  const channel: 'sms' | 'email' =
    preferredChannel === 'email' && user.email ? 'email' : user.phone ? 'sms' : 'email';
  const destination = channel === 'sms' ? user.phone : user.email;
  if (!destination) return { ok: false, error: 'This account has no verified phone number or email address for OTP delivery.' };

  const code = generateOtp(6);
  await execute('UPDATE otp_codes SET consumed_at = now() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL', [
    user.id,
    'password_reset',
  ]);
  await execute(
    `INSERT INTO otp_codes (user_id, purpose, code_hash, channel, destination, expires_at)
     VALUES ($1,'password_reset',$2,$3,$4, now() + interval '15 minutes')`,
    [user.id, sha256(code), channel, destination],
  );
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'password.reset_requested',
    entityType: 'user',
    entityId: user.id,
    description: `OTP requested via ${channel}`,
    ip,
  });

  const { sendOtp } = await import('./notify');
  await sendOtp({
    to: destination,
    channel,
    name: user.name,
    code,
    purpose: 'password_reset',
    userId: user.id,
  });

  return {
    ok: true,
    channel,
    destination,
    devCode: env.isProduction ? undefined : code,
  };
}

export async function resetPasswordWithOtp(
  identifier: string,
  code: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await findUserByIdentifier(identifier);
  if (!user) return { ok: false, error: 'Invalid or expired reset code.' };

  const otp = await one<any>(
    `SELECT * FROM otp_codes
      WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL AND expires_at > now()
      ORDER BY id DESC LIMIT 1`,
    [user.id],
  );
  if (!otp) return { ok: false, error: 'Reset code has expired. Please request a new one.' };
  if (otp.attempts >= 5) return { ok: false, error: 'Too many incorrect attempts. Please request a new code.' };
  if (sha256(String(code).trim()) !== otp.code_hash) {
    await execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    return { ok: false, error: 'Incorrect reset code.' };
  }

  const hash = await hashPassword(newPassword);
  await execute(
    `UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = FALSE,
            failed_attempts = 0, locked_until = NULL
      WHERE id = $1`,
    [user.id, hash],
  );
  await execute('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
  await revokeAllSessions(user.id);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'password.reset_completed',
    entityType: 'user',
    entityId: user.id,
    description: 'Password reset via OTP; all sessions revoked',
    severity: 'warning',
  });
  return { ok: true };
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const user = await one<any>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!user) return { ok: false, error: 'User not found.' };
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) return { ok: false, error: 'Current password is incorrect.' };
  const hash = await hashPassword(newPassword);
  await execute('UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = FALSE WHERE id = $1', [
    userId,
    hash,
  ]);
  await logAudit({ userId, action: 'password.changed', entityType: 'user', entityId: userId, description: 'Password changed by user' });
  return { ok: true };
}

export async function verifyTwoFactor(userId: number, code: string, remember = false): Promise<LoginResult> {
  const cookieStore = await cookies();
  const challenge = cookieStore.get(CHALLENGE_COOKIE)?.value;
  if (!challenge || !challenge.startsWith(`${userId}:`)) return { ok: false, error: 'Two-factor session expired. Please sign in again.' };
  const row = await one<any>(
    `SELECT * FROM otp_codes WHERE user_id = $1 AND purpose = 'two_factor' AND consumed_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  if (!row) return { ok: false, error: 'Two-factor code expired. Please sign in again.' };
  if (sha256(String(code).trim()) !== row.code_hash) {
    await execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return { ok: false, error: 'Incorrect verification code.' };
  }
  await execute('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
  cookieStore.delete(CHALLENGE_COOKIE);

  const user = await one<any>(
    `SELECT u.*, r.key AS role_key, r.name AS role_name, m.membership_no
       FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN members m ON m.id = u.member_id
      WHERE u.id = $1`,
    [userId],
  );
  const security = await getSecuritySettings();
  const { ip, userAgent } = await requestMeta();
  return completeLogin(user, security, ip, userAgent, remember);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
export async function activeSessions(userId: number) {
  return query(
    `SELECT id, ip_address, user_agent, created_at, last_seen_at, expires_at, revoked_at
       FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );
}

export async function loginAttemptsSummary(identifier?: string) {
  const params: any[] = [];
  let where = 'WHERE created_at > now() - interval \'7 days\'';
  if (identifier) {
    params.push(identifier);
    where += ` AND identifier = $1`;
  }
  return one<any>(
    `SELECT count(*) FILTER (WHERE success) AS successes,
            count(*) FILTER (WHERE NOT success) AS failures
       FROM login_attempts ${where}`,
    params,
  );
}
