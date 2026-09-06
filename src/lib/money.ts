
/** Coerce anything coming from Postgres NUMERIC into a JS number. */
export function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function round2(v: number): number {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + num(b), 0));
}

/** KSh 12,345.00 */
export function money(v: any, opts: { symbol?: boolean; decimals?: number } = {}): string {
  const { symbol = true, decimals = 2 } = opts;
  const n = num(v);
  const formatted = n.toLocaleString('en-KE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return symbol ? `KSh ${formatted}` : formatted;
}

/** Compact form for charts / cards: KSh 1.2M, KSh 340K */
export function moneyCompact(v: any): string {
  const n = Math.abs(num(v));
  const sign = num(v) < 0 ? '-' : '';
  if (n >= 1_000_000_000) return `${sign}KSh ${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${sign}KSh ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${sign}KSh ${(n / 1_000).toFixed(1)}K`;
  return `${sign}KSh ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

export function percent(part: any, total: any, decimals = 0): number {
  const t = num(total);
  if (!t) return 0;
  const p = (num(part) / t) * 100;
  const f = 10 ** decimals;
  return Math.round(p * f) / f;
}

export function percentLabel(part: any, total: any): string {
  return `${percent(part, total).toFixed(1)}%`;
}

/** Phone normalisation to the 254XXXXXXXXX format used by Daraja. */
export function normalisePhone(input?: string | null, defaultCode = '254'): string | null {
  if (!input) return null;
  let p = String(input).replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = defaultCode + p.slice(1);
  if (p.length === 9) p = defaultCode + p;
  if (p.startsWith(defaultCode) === false && p.length === 12) p = defaultCode + p.slice(-9);
  return /^\d{9,15}$/.test(p) ? p : null;
}

export function phoneDisplay(p?: string | null): string {
  if (!p) return '—';
  const s = String(p).replace(/\D/g, '');
  if (s.length === 12 && s.startsWith('254')) return `0${s.slice(3)}`;
  return s;
}

export function initials(name?: string | null): string {
  if (!name) return 'CM';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(s: string | null | undefined, n = 60): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
