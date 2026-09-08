import 'server-only';
import { cache } from 'react';
import type { PoolClient } from 'pg';
import { one, query, execute } from './db';

export type SettingValue = Record<string, any>;

const memoryCache = new Map<string, { value: SettingValue; at: number }>();
const TTL_MS = 15_000;

async function loadAll(): Promise<Map<string, SettingValue>> {
  const rows = await query<{ key: string; value: SettingValue }>(
    'SELECT key, value FROM system_settings',
  );
  const map = new Map<string, SettingValue>();
  for (const r of rows) map.set(r.key, r.value ?? {});
  return map;
}

export function invalidateSettings() {
  memoryCache.clear();
}

/** Fetch a single setting group (object) with a short in-process cache.
 *  When a `client` is supplied (inside a transaction with PGPOOL_MAX=1),
 *  the query uses that client and bypasses the in-process cache to avoid
 *  deadlocking on the single pooled connection. */
export async function getSetting<T extends SettingValue = SettingValue>(
  key: string,
  fallback: T = {} as T,
  client?: PoolClient,
): Promise<T> {
  if (!client) {
    const cached = memoryCache.get(key);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value as T;
  }
  const row = await one<{ value: SettingValue }>('SELECT value FROM system_settings WHERE key = $1', [key], client);
  const value = (row?.value ?? fallback) as T;
  if (!client) memoryCache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(
  key: string,
  value: SettingValue,
  opts: { updatedBy?: number | null; groupName?: string; description?: string; isSecret?: boolean } = {},
) {
  await execute(
    `INSERT INTO system_settings (key, value, group_name, description, is_secret, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (key) DO UPDATE
       SET value = system_settings.value || EXCLUDED.value,
           updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), opts.groupName || 'general', opts.description || null, opts.isSecret ?? false, opts.updatedBy ?? null],
  );
  memoryCache.delete(key);
}

/**
 * Replace (not merge) a setting group. Previously this ran a bare UPDATE, so a
 * key with no row yet was silently dropped — the caller saw success while the
 * value never changed. Upsert so first writes behave like every other write.
 */
export async function replaceSetting(
  key: string,
  value: SettingValue,
  opts: { updatedBy?: number | null } = {},
) {
  await execute(
    `INSERT INTO system_settings (key, value, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), opts.updatedBy ?? null],
  );
  memoryCache.delete(key);
}

export async function allSettings() {
  const map = await loadAll();
  return Object.fromEntries(map) as Record<string, SettingValue>;
}

/* ----------------------------- typed accessors ---------------------------- */

export interface OrganisationSettings {
  name: string;
  short_name: string;
  country: string;
  archdiocese: string;
  diocese: string;
  deanery: string;
  parish: string;
  church: string;
  scc: string;
  motto: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  currency_symbol: string;
  logo_url: string | null;
  stamp_url: string | null;
}

export const getOrganisation = cache(async (client?: PoolClient): Promise<OrganisationSettings> => {
  const s = await getSetting<OrganisationSettings>('organisation', {} as OrganisationSettings, client);
  return {
    name: s.name || 'Catholic Men Association (CMA)',
    short_name: s.short_name || 'CMA',
    country: s.country || 'Kenya',
    archdiocese: s.archdiocese || '',
    diocese: s.diocese || '',
    deanery: s.deanery || '',
    parish: s.parish || '',
    church: s.church || '',
    scc: s.scc || '',
    motto: s.motto || '',
    email: s.email || '',
    phone: s.phone || '',
    address: s.address || '',
    currency: s.currency || 'KES',
    currency_symbol: s.currency_symbol || 'KSh',
    logo_url: s.logo_url || null,
    stamp_url: s.stamp_url || null,
  };
});

export const getContributionSettings = cache(async (client?: PoolClient) => {
  const s = await getSetting('contributions', {}, client);
  return {
    monthly_amount: Number(s.monthly_amount ?? 200),
    due_day: Number(s.due_day ?? 10),
    financial_year_start_month: Number(s.financial_year_start_month ?? 1),
    penalty_enabled: Boolean(s.penalty_enabled ?? true),
    penalty_amount: Number(s.penalty_amount ?? 50),
    penalty_after_days: Number(s.penalty_after_days ?? 7),
    auto_bill: Boolean(s.auto_bill ?? true),
    sacco_min_monthly_savings: Number(s.sacco_min_monthly_savings ?? 500),
    exemptions: (s.exemptions as string[]) || ['deceased', 'suspended'],
  };
});

export const getShareSettings = cache(async (client?: PoolClient) => {
  const s = await getSetting('shares', {}, client);
  return {
    value_per_share: Number(s.value_per_share ?? 1000),
    min_shares: Number(s.min_shares ?? 1),
    max_shares_per_member: Number(s.max_shares_per_member ?? 500),
    transferable: s.transferable !== false,
    certificate_prefix: String(s.certificate_prefix ?? 'CMA/SH'),
  };
});

export const getSaccoSettings = cache(async (client?: PoolClient) => {
  const s = await getSetting('sacco', {}, client);
  return {
    account_prefix: String(s.account_prefix ?? 'SDP'),
    min_monthly_savings: Number(s.min_monthly_savings ?? 500),
    max_savings_withdrawal_pct: Number(s.max_savings_withdrawal_pct ?? 50),
    withdrawal_notice_days: Number(s.withdrawal_notice_days ?? 30),
    interest_on_deposits_pct: Number(s.interest_on_deposits_pct ?? 0),
    dividend_policy: String(s.dividend_policy ?? 'pro-rata on share capital'),
  };
});

export const getLoanSettings = cache(async (client?: PoolClient) => {
  const s = await getSetting('loans', {}, client);
  return {
    default_interest_method: String(s.default_interest_method ?? 'reducing'),
    first_due_date_offset_days: Number(s.first_due_date_offset_days ?? 30),
    max_loan_to_savings_ratio: Number(s.max_loan_to_savings_ratio ?? 3),
    allow_early_repayment: s.allow_early_repayment !== false,
    early_repayment_fee_pct: Number(s.early_repayment_fee_pct ?? 0),
    arrears_grace_days: Number(s.arrears_grace_days ?? 7),
    auto_penalty: s.auto_penalty !== false,
    committee_role: String(s.committee_role ?? 'loan_committee'),
  };
});

export const getGuarantorSettings = cache(async (client?: PoolClient) => {
  const s = await getSetting('guarantors', {}, client);
  return {
    max_exposure_multiple: Number(s.max_exposure_multiple ?? 3),
    max_guarantees_active: Number(s.max_guarantees_active ?? 5),
    count_savings_as_capacity: s.count_savings_as_capacity !== false,
    notify_on_request: s.notify_on_request !== false,
  };
});

export const getPaymentSettings = cache(async (client?: PoolClient) => {
  const s = await getSetting('payments', {}, client);
  return {
    mpesa: {
      enabled: Boolean(s.mpesa?.enabled),
      mode: String(s.mpesa?.mode ?? 'sandbox'),
      short_code: s.mpesa?.short_code ?? null,
      passkey: s.mpesa?.passkey ?? null,
      consumer_key: s.mpesa?.consumer_key ?? null,
      consumer_secret: s.mpesa?.consumer_secret ?? null,
      callback_url: s.mpesa?.callback_url ?? null,
      stk_timeout_seconds: Number(s.mpesa?.stk_timeout_seconds ?? 60),
    },
    airtel: { enabled: Boolean(s.airtel?.enabled), client_id: s.airtel?.client_id ?? null },
    bank: { enabled: s.bank?.enabled !== false, ...(s.bank || {}) },
    cash: { enabled: s.cash?.enabled !== false },
    manual_entry: { enabled: s.manual_entry?.enabled !== false, requires_verification: Boolean(s.manual_entry?.requires_verification) },
  } as any;
});

export const getNotificationSettings = cache(async (client?: PoolClient) => {
  const s = await getSetting('notifications', {}, client);
  return {
    channels: {
      in_system: s.channels?.in_system !== false,
      sms: Boolean(s.channels?.sms),
      email: Boolean(s.channels?.email),
      whatsapp: Boolean(s.channels?.whatsapp),
    },
    sms_provider: String(s.sms_provider ?? 'none'),
    sms_sender_id: String(s.sms_sender_id ?? 'CMA'),
    email_provider: String(s.email_provider ?? 'none'),
    smtp_from: String(s.smtp_from ?? 'no-reply@cma.or.ke'),
    reminder_days_before_due: Number(s.reminder_days_before_due ?? 3),
    escalation_days_after_due: Number(s.escalation_days_after_due ?? 7),
    _raw: s,
  };
});

export const getSecuritySettings = cache(async (client?: PoolClient) => {
  const s = await getSetting('security', {}, client);
  return {
    password_min_length: Number(s.password_min_length ?? 8),
    max_failed_attempts: Number(s.max_failed_attempts ?? 5),
    lockout_minutes: Number(s.lockout_minutes ?? 30),
    session_hours: Number(s.session_hours ?? 12),
    remember_me_days: Number(s.remember_me_days ?? 30),
    two_factor_enabled: Boolean(s.two_factor_enabled),
    two_factor_methods: (s.two_factor_methods as string[]) || ['sms', 'email'],
    force_password_reset_days: Number(s.force_password_reset_days ?? 180),
    data_protection_notice: String(
      s.data_protection_notice ??
        'Personal data is processed under the Kenya Data Protection Act, 2019.',
    ),
  };
});
