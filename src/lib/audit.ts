import 'server-only';
import { execute, query } from './db';

export interface AuditInput {
  userId?: number | null;
  userName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: number | string | null;
  entityLabel?: string | null;
  description?: string | null;
  oldValues?: any;
  newValues?: any;
  ip?: string | null;
  userAgent?: string | null;
  severity?: 'info' | 'warning' | 'critical';
  client?: any;
}

const SKIP_KEYS = new Set([
  'password_hash',
  'password',
  'new_password',
  'current_password',
  'confirm_password',
  'two_factor_secret',
  'otp',
  'code',
  'consumer_secret',
  'smtp_password',
]);

export function sanitise(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitise);
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEYS.has(k.toLowerCase())) {
        out[k] = '[redacted]';
      } else if (v && typeof v === 'object') {
        out[k] = sanitise(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return value;
}

/** Minimal, always-safe field level diff used for old/new audit values. */
export function diffObjects(before: any, after: any): { changed: string[]; old: any; new: any } {
  const old: Record<string, any> = {};
  const nw: Record<string, any> = {};
  const changed: string[] = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (SKIP_KEYS.has(k.toLowerCase())) continue;
    const a = before?.[k];
    const b = after?.[k];
    const sa = a instanceof Date ? a.toISOString() : a;
    const sb = b instanceof Date ? b.toISOString() : b;
    if (JSON.stringify(sa ?? null) !== JSON.stringify(sb ?? null)) {
      changed.push(k);
      old[k] = sa ?? null;
      nw[k] = sb ?? null;
    }
  }
  return { changed, old, new: nw };
}

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_logs
         (user_id, user_name, action, entity_type, entity_id, entity_label, description,
          old_values, new_values, ip_address, user_agent, severity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        input.userId ?? null,
        input.userName ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ? String(input.entityId) : null,
        input.entityLabel ?? null,
        input.description ?? null,
        input.oldValues ? JSON.stringify(sanitise(input.oldValues)) : null,
        input.newValues ? JSON.stringify(sanitise(input.newValues)) : null,
        input.ip ?? null,
        input.userAgent ? String(input.userAgent).slice(0, 300) : null,
        input.severity ?? 'info',
      ],
      input.client,
    );
  } catch (err: any) {
    // Auditing must never break a business transaction.
    console.error('[audit] failed to write log:', err?.message);
  }
}

export async function recentAudit(limit = 50, filters: { entityType?: string; userId?: number } = {}) {
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters.entityType) {
    params.push(filters.entityType);
    clauses.push(`entity_type = $${params.length}`);
  }
  if (filters.userId) {
    params.push(filters.userId);
    clauses.push(`user_id = $${params.length}`);
  }
  params.push(limit);
  return query(
    `SELECT * FROM audit_logs ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
}
