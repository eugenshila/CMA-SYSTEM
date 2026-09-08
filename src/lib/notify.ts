import 'server-only';
import { execute, one, query } from './db';
import { getNotificationSettings, getOrganisation } from './settings';
import { logAudit } from './audit';
import type { Queryable } from './db';

export type Channel = 'in_system' | 'sms' | 'email' | 'whatsapp';

export interface NotifyInput {
  /** Recipient user id (preferred) */
  userId?: number | null;
  /** Recipient member id (used when the member has no user account) */
  memberId?: number | null;
  title: string;
  body: string;
  category?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  link?: string;
  channels?: Channel[];
  referenceType?: string;
  referenceId?: number | string | null;
  client?: Queryable;
}

/**
 * Creates an in-system notification and dispatches it over every enabled
 * external channel (SMS / Email / WhatsApp). Providers are pluggable: when no
 * credentials are configured the message is written to `notification_logs`
 * with status `skipped` (development sandbox) so nothing is ever lost.
 */
export async function notify(input: NotifyInput): Promise<number | null> {
  const db = input.client;
  const channels: Channel[] = input.channels && input.channels.length ? input.channels : ['in_system'];

  let userId = input.userId ?? null;
  let memberId = input.memberId ?? null;

  if (!userId && memberId) {
    const row = await one<{ id: number }>('SELECT id FROM users WHERE member_id = $1 AND deleted_at IS NULL', [memberId], db);
    userId = row?.id ?? null;
  }
  if (!memberId && userId) {
    const row = await one<{ member_id: number }>('SELECT member_id FROM users WHERE id = $1', [userId], db);
    memberId = row?.member_id ?? null;
  }

  const inserted = await one<{ id: number }>(
    `INSERT INTO notifications
       (user_id, member_id, title, body, category, priority, channels, link, reference_type, reference_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      userId,
      memberId,
      input.title,
      input.body,
      input.category || 'general',
      input.priority || 'normal',
      JSON.stringify(channels),
      input.link || null,
      input.referenceType || null,
      input.referenceId ? String(input.referenceId) : null,
    ],
    db,
  );
  const notificationId = inserted?.id ?? null;

  const settings = await getNotificationSettings();
  for (const channel of channels) {
    if (channel === 'in_system') {
      await logChannel(notificationId, channel, null, 'none', 'sent', 'Delivered in-system');
      continue;
    }
    if (!settings.channels[channel]) {
      await logChannel(notificationId, channel, null, 'none', 'skipped', `${channel.toUpperCase()} channel is disabled in system settings`);
      continue;
    }
    const destination = await destinationFor(userId, memberId, channel);
    if (!destination) {
      await logChannel(notificationId, channel, null, 'none', 'failed', `No ${channel} destination on record for this member`);
      continue;
    }
    const result = await dispatch(channel, destination, input);
    await logChannel(notificationId, channel, destination, result.provider, result.status, result.message);
  }

  return notificationId;
}

async function logChannel(
  notificationId: number | null,
  channel: Channel,
  destination: string | null,
  provider: string,
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'skipped',
  message: string,
) {
  try {
    await execute(
      `INSERT INTO notification_logs (notification_id, channel, destination, provider, status, message, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5 IN ('sent','delivered') THEN now() ELSE NULL END)`,
      [notificationId, channel, destination, provider, status, message],
    );
  } catch (e: any) {
    console.error('[notify] log failed', e?.message);
  }
}

async function destinationFor(
  userId: number | null,
  memberId: number | null,
  channel: Channel,
): Promise<string | null> {
  const row = await one<any>(
    `SELECT u.phone AS user_phone, u.email AS user_email, m.phone AS member_phone, m.email AS member_email, m.alt_phone
       FROM users u FULL OUTER JOIN members m ON m.id = u.member_id
      WHERE ($1::bigint IS NULL OR u.id = $1) AND ($2::bigint IS NULL OR m.id = $2)
      LIMIT 1`,
    [userId, memberId],
  );
  if (!row) return null;
  if (channel === 'email') return row.user_email || row.member_email || null;
  return row.user_phone || row.member_phone || row.alt_phone || null;
}

/**
 * Channel dispatch. Replace the bodies below with real provider calls
 * (Africa's Talking / Twilio for SMS, SMTP/Resend/SendGrid for email,
 * Meta Cloud API for WhatsApp) — the interface is intentionally provider-agnostic.
 */
async function dispatch(
  channel: Channel,
  destination: string,
  input: NotifyInput,
): Promise<{ provider: string; status: 'sent' | 'failed' | 'skipped'; message: string }> {
  const settings = await getNotificationSettings();
  const org = await getOrganisation();
  const provider =
    channel === 'sms'
      ? settings.sms_provider
      : channel === 'email'
        ? settings.email_provider
        : 'none';

  if (!provider || provider === 'none') {
    console.log(
      `[notify:sandbox] ${channel.toUpperCase()} -> ${destination} :: ${input.title} — ${input.body}`,
    );
    return {
      provider: 'sandbox',
      status: 'skipped',
      message: `No ${channel} provider configured — message logged only (${org.short_name})`,
    };
  }

  try {
    const raw: any = settings._raw as any;
    if (channel === 'sms' && raw?.sms_api_url) {
      const res = await fetch(String(raw.sms_api_url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${raw.sms_api_key || ''}`,
        },
        body: JSON.stringify({
          to: destination,
          message: `${input.title}: ${input.body}`,
          sender: settings.sms_sender_id,
        }),
      });
      return {
        provider,
        status: res.ok ? 'sent' : 'failed',
        message: res.ok ? 'Accepted by SMS gateway' : `Gateway responded ${res.status}`,
      };
    }
    if (channel === 'email' && raw?.email_api_url) {
      const res = await fetch(String(raw.email_api_url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${raw.email_api_key || ''}`,
        },
        body: JSON.stringify({
          to: destination,
          from: settings.smtp_from,
          subject: input.title,
          text: input.body,
        }),
      });
      return {
        provider,
        status: res.ok ? 'sent' : 'failed',
        message: res.ok ? 'Accepted by mail gateway' : `Gateway responded ${res.status}`,
      };
    }
    return { provider, status: 'skipped', message: `Provider "${provider}" is configured but no endpoint supplied` };
  } catch (e: any) {
    return { provider, status: 'failed', message: e?.message || 'Dispatch error' };
  }
}

/* ------------------------------------------------------------------ *
 * OTP delivery (password reset / two factor)
 * ------------------------------------------------------------------ */
export async function sendOtp(opts: {
  to: string;
  channel: 'sms' | 'email';
  name: string;
  code: string;
  purpose: 'password_reset' | 'two_factor' | 'phone_verify' | 'email_verify';
  userId?: number;
}) {
  const org = await getOrganisation();
  const title =
    opts.purpose === 'password_reset'
      ? `${org.short_name} password reset code`
      : `${org.short_name} verification code`;
  const body =
    opts.purpose === 'password_reset'
      ? `Dear ${opts.name}, your ${org.short_name} password reset code is ${opts.code}. It expires in 15 minutes. Never share this code with anyone.`
      : `Dear ${opts.name}, your ${org.short_name} verification code is ${opts.code}. It expires in 10 minutes.`;

  const id = await notify({
    userId: opts.userId ?? null,
    title,
    body,
    category: 'security',
    priority: 'high',
    channels: [opts.channel],
  });
  await logAudit({
    userId: opts.userId ?? null,
    userName: opts.name,
    action: 'otp.sent',
    entityType: 'user',
    entityId: opts.userId ?? null,
    description: `${opts.purpose} OTP sent via ${opts.channel}`,
  });
  return id;
}

/* ------------------------------------------------------------------ *
 * Bulk / campaign helpers used by the Secretary & Treasurer
 * ------------------------------------------------------------------ */
export async function notifyMembers(
  memberIds: number[],
  input: Omit<NotifyInput, 'userId' | 'memberId'>,
): Promise<number> {
  let sent = 0;
  for (const memberId of memberIds) {
    await notify({ ...input, memberId });
    sent++;
  }
  return sent;
}

export async function notifyRole(roleKey: string, input: Omit<NotifyInput, 'userId' | 'memberId'>) {
  const rows = await query<{ id: number }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.key = $1 AND u.deleted_at IS NULL AND u.status = 'active'`,
    [roleKey],
  );
  for (const r of rows) await notify({ ...input, userId: r.id });
  return rows.length;
}

export async function unreadCount(userId: number | null, memberId: number | null): Promise<number> {
  const row = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM notifications
      WHERE read_at IS NULL AND (user_id = $1 OR (member_id = $2 AND $1 IS NULL))`,
    [userId, memberId],
  );
  return row?.c ?? 0;
}
