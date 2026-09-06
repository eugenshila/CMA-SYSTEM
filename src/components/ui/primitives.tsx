import Link from 'next/link';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { money, initials as toInitials, percent } from '@/lib/money';
import { fmtDate } from '@/lib/dates';

export function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------- Card ------------------------------- */
export function Card({
  className,
  children,
  padded = true,
}: {
  className?: string;
  children: React.ReactNode;
  padded?: boolean;
}) {
  return <div className={cn('card', padded && 'card-pad', className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-4', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon ? (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-800">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="card-title truncate">{title}</h2>
          {subtitle ? <p className="card-sub mt-0.5">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------ StatCard ----------------------------- */
export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'navy',
  progress,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'navy' | 'gold' | 'green' | 'red' | 'blue' | 'slate';
  progress?: { value: number; total: number; color?: string };
  href?: string;
}) {
  const tones: Record<string, string> = {
    navy: 'bg-navy-50 text-navy-800',
    gold: 'bg-gold-50 text-gold-700',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="stat-label">{label}</span>
        {icon ? <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tones[tone])}>{icon}</span> : null}
      </div>
      <span className="stat-value">{value}</span>
      {progress ? (
        <div className="mt-2">
          <ProgressBar value={progress.value} total={progress.total} color={progress.color} />
        </div>
      ) : null}
      {sub ? <span className="stat-foot">{sub}</span> : null}
    </>
  );
  if (href)
    return (
      <Link href={href} className="stat-card hover:border-navy-300 hover:shadow-pop transition-all">
        {body}
      </Link>
    );
  return <div className="stat-card">{body}</div>;
}

/* ------------------------------- Badge ------------------------------- */
const STATUS_TONES: Record<string, string> = {
  paid: 'badge-green',
  completed: 'badge-green',
  active: 'badge-green',
  success: 'badge-green',
  accepted: 'badge-green',
  approved: 'badge-green',
  present: 'badge-green',
  valid: 'badge-green',
  disbursed: 'badge-green',
  exempted: 'badge-grey',
  partial: 'badge-amber',
  pending: 'badge-amber',
  submitted: 'badge-blue',
  open: 'badge-blue',
  under_review: 'badge-blue',
  committee_review: 'badge-blue',
  guarantor_pending: 'badge-blue',
  review: 'badge-blue',
  late: 'badge-amber',
  apology: 'badge-blue',
  unpaid: 'badge-red',
  overdue: 'badge-red',
  rejected: 'badge-red',
  defaulted: 'badge-red',
  failed: 'badge-red',
  reversed: 'badge-red',
  cancelled: 'badge-grey',
  inactive: 'badge-grey',
  suspended: 'badge-red',
  deceased: 'badge-grey',
  transferred: 'badge-blue',
  resigned: 'badge-grey',
  draft: 'badge-grey',
  closed: 'badge-grey',
  withdrawn: 'badge-grey',
  frozen: 'badge-amber',
  dormant: 'badge-grey',
  paid_out: 'badge-green',
  written_off: 'badge-red',
  restructured: 'badge-amber',
};

export function Badge({ children, tone = 'badge-grey', className }: { children: React.ReactNode; tone?: string; className?: string }) {
  return <span className={cn(tone, className)}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = String(status || '').toLowerCase();
  const tone = STATUS_TONES[key] || 'badge-grey';
  const text = label || String(status || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return <span className={tone}>{text}</span>;
}

/* ------------------------------ Progress ----------------------------- */
export function ProgressBar({
  value,
  total,
  color,
  label,
  height = 'h-2',
}: {
  value: number;
  total: number;
  color?: string;
  label?: string;
  height?: string;
}) {
  const pct = Math.max(0, Math.min(100, percent(value, total)));
  return (
    <div>
      {label ? (
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 mb-1">
          <span>{label}</span>
          <span className="tabular-nums">{pct.toFixed(0)}%</span>
        </div>
      ) : null}
      <div className={cn('progress', height)}>
        <div className={color ? 'h-full rounded-full transition-all duration-500' : 'progress-bar'}
          style={{ width: `${pct}%`, backgroundColor: color || undefined }}
        />
      </div>
    </div>
  );
}

/* ------------------------------- Avatar ------------------------------ */
export function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.36) };
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || 'member'}
        style={style}
        className={cn('rounded-full object-cover ring-2 ring-white shadow-sm bg-slate-100', className)}
      />
    );
  return (
    <span
      style={style}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-navy-800 font-bold text-white ring-2 ring-white shadow-sm',
        className,
      )}
    >
      {toInitials(name)}
    </span>
  );
}

/* ---------------------------- Empty state ---------------------------- */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center', className)}>
      {icon ? <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">{icon}</span> : null}
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ------------------------------- Table ------------------------------- */
export function Table({
  children,
  className,
  compact,
}: {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className="table-wrap scrollbar-thin">
      <table className={cn('table', compact && 'table-compact', className)}>{children}</table>
    </div>
  );
}

export function Th({ children, className, align }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <th className={cn(align === 'right' && 'text-right', align === 'center' && 'text-center', className)}>{children}</th>
  );
}

export function Td({ children, className, align }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <td className={cn(align === 'right' && 'numeric', align === 'center' && 'text-center', className)}>{children}</td>
  );
}

/* ------------------------------ Key/value ---------------------------- */
export function KeyValue({ items, columns = 2 }: { items: [React.ReactNode, React.ReactNode][]; columns?: 1 | 2 | 3 }) {
  const grid = columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', grid)}>
      {items.map(([label, value], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-800 break-words">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------ Pagination --------------------------- */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  query: qs = {},
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  query?: Record<string, string | number | undefined | null>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = (p: number) => {
    const params = new URLSearchParams();
    Object.entries(qs).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    params.set('page', String(p));
    return `${basePath}?${params.toString()}`;
  };
  if (total <= pageSize) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
      <p className="text-xs text-slate-500">
        Showing <span className="font-semibold text-slate-700">{(page - 1) * pageSize + 1}</span>–
        <span className="font-semibold text-slate-700">{Math.min(page * pageSize, total)}</span> of{' '}
        <span className="font-semibold text-slate-700">{total}</span> records
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={link(page - 1)} className="btn-outline btn-sm">
            Previous
          </Link>
        ) : null}
        <span className="px-2 text-xs font-semibold text-slate-600">
          Page {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={link(page + 1)} className="btn-outline btn-sm">
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------- Misc -------------------------------- */
export function Money({ value, className, compact }: { value: any; className?: string; compact?: boolean }) {
  return <span className={cn('tabular-nums font-semibold text-navy-900', className)}>{money(value)}</span>;
}

export function DateText({ value, className }: { value: any; className?: string }) {
  return <span className={cn('text-slate-600', className)}>{fmtDate(value)}</span>;
}

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="page-title">{title}</h2>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}
