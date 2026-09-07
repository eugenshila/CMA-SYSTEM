'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import {
  X, Search, Eye, EyeOff, Check, Copy, AlertTriangle, Info, CheckCircle2, XCircle,
  Loader2, Upload, Trash2, ChevronDown, Bell, Printer,
} from 'lucide-react';
import { cn } from './primitives';

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */
type Toast = { id: number; title: string; description?: string; tone: 'success' | 'error' | 'info' | 'warn' };
type ToastFn = (t: Toast) => void;

const listeners = new Set<ToastFn>();
export function toast(t: Omit<Toast, 'id'>) {
  listeners.forEach((l) => l({ ...t, id: Date.now() + Math.random() }));
}
export const toastSuccess = (title: string, description?: string) => toast({ title, description, tone: 'success' });
export const toastError = (title: string, description?: string) => toast({ title, description, tone: 'error' });
export const toastInfo = (title: string, description?: string) => toast({ title, description, tone: 'info' });

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const fn: ToastFn = (t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 5200);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
    error: <XCircle className="h-5 w-5 text-red-600" />,
    info: <Info className="h-5 w-5 text-blue-600" />,
    warn: <AlertTriangle className="h-5 w-5 text-amber-600" />,
  };

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-96">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto animate-slide-up rounded-xl border border-slate-200 bg-white p-3.5 shadow-pop"
          role="status"
        >
          <div className="flex gap-3">
            <span className="mt-0.5">{icons[t.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-navy-900">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-xs text-slate-600 break-words">{t.description}</p> : null}
            </div>
            <button onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'relative z-10 w-full animate-slide-up overflow-hidden rounded-t-2xl bg-white shadow-pop sm:rounded-2xl',
          widths[size],
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/60 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-navy-900">{title}</h3>
            {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Form helpers
 * ------------------------------------------------------------------ */
export function SubmitButton({
  children,
  className,
  variant = 'primary',
  pendingText = 'Working…',
  disabled,
  icon,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'gold' | 'outline' | 'danger' | 'success' | 'ghost';
  pendingText?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  const variants: Record<string, string> = {
    primary: 'btn-primary',
    gold: 'btn-gold',
    outline: 'btn-outline',
    danger: 'btn-danger',
    success: 'btn-success',
    ghost: 'btn-ghost',
  };
  return (
    <button type="submit" disabled={pending || disabled} className={cn(variants[variant], className)}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {pending ? pendingText : children}
    </button>
  );
}

export function ActionButton({
  action,
  children,
  className,
  variant = 'outline',
  icon,
  confirm,
  disabled,
}: {
  action: () => Promise<any> | any;
  children: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'gold' | 'outline' | 'danger' | 'success' | 'ghost';
  icon?: React.ReactNode;
  confirm?: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const variants: Record<string, string> = {
    primary: 'btn-primary',
    gold: 'btn-gold',
    outline: 'btn-outline',
    danger: 'btn-danger',
    success: 'btn-success',
    ghost: 'btn-ghost',
  };
  return (
    <button
      type="button"
      disabled={pending || disabled}
      className={cn(variants[variant], 'btn-sm', className)}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          await action();
        });
      }}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function PasswordInput({
  name,
  id,
  placeholder,
  autoComplete = 'current-password',
  required,
  className,
  defaultValue,
}: {
  name: string;
  id?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  className?: string;
  defaultValue?: string;
}) {
  const [show, setShow] = useState(false);
  const generated = useId();
  return (
    <div className={cn('relative', className)}>
      <input
        id={id || generated}
        name={name}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        className="input pr-11"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function FileInput({
  name,
  label,
  hint,
  accept = 'image/*,.pdf',
  multiple,
  required,
  onFiles,
}: {
  name: string;
  label?: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  onFiles?: (files: File[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      {label ? <span className="label">{label}</span> : null}
      <div
        className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-5 text-center transition hover:border-navy-400 hover:bg-navy-50/40"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mx-auto h-6 w-6 text-slate-400" />
        <p className="mt-1.5 text-xs font-medium text-slate-600">
          {files.length ? `${files.length} file(s) selected` : 'Tap to choose a file'}
        </p>
        <p className="text-[11px] text-slate-400">{hint || 'PNG, JPG, PDF, Word or Excel — up to 10 MB'}</p>
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          required={required && !files.length}
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files || []);
            setFiles(list);
            onFiles?.(list);
          }}
        />
      </div>
      {files.length ? (
        <ul className="mt-2 space-y-1">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5 text-xs ring-1 ring-slate-200">
              <span className="truncate font-medium text-slate-700">{f.name}</span>
              <span className="shrink-0 text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn('btn-ghost btn-sm', className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toastError('Could not copy to clipboard');
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Search box — keeps filters in the URL so pages stay shareable
 * ------------------------------------------------------------------ */
export function SearchInput({
  placeholder = 'Search…',
  param = 'q',
  className,
  extraParams,
  autoFocus,
}: {
  placeholder?: string;
  param?: string;
  className?: string;
  extraParams?: Record<string, string>;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(param) || '');
  const timer = useRef<any>(null);

  const push = useCallback(
    (v: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (v) params.set(param, v);
      else params.delete(param);
      Object.entries(extraParams || {}).forEach(([k, val]) => params.set(k, val));
      params.delete('page');
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, param, extraParams],
  );

  useEffect(() => {
    setValue(searchParams.get(param) || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, param]);

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => push(v), 350);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(timer.current);
            push((e.target as HTMLInputElement).value);
          }
        }}
        placeholder={placeholder}
        className="input pl-9"
      />
    </div>
  );
}

export function SelectFilter({
  param,
  options,
  placeholder = 'All',
  className,
  label,
}: {
  param: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(param) || '';
  return (
    <select
      aria-label={label || param}
      className={cn('select', className)}
      value={value}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value) params.set(param, e.target.value);
        else params.delete(param);
        params.delete('page');
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ *
 * Accordion / disclosure
 * ------------------------------------------------------------------ */
/** URL-driven date range filter (from / to) — keeps server components clean. */
export function DateRangeFilter({
  fromParam = 'from',
  toParam = 'to',
  className,
}: {
  fromParam?: string;
  toParam?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const from = searchParams.get(fromParam) || '';
  const to = searchParams.get(toParam) || '';

  const push = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <input
        type="date"
        value={from}
        max={to || undefined}
        aria-label="From date"
        onChange={(e) => push(fromParam, e.target.value)}
        className="input !w-36 sm:!w-40"
      />
      <span className="text-xs text-slate-400">to</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        aria-label="To date"
        onChange={(e) => push(toParam, e.target.value)}
        className="input !w-36 sm:!w-40"
      />
      {from || to ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete(fromParam);
            params.delete(toParam);
            params.delete('page');
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

/** Browser print (used by receipts and statements). */
export function PrintButton({ className = 'btn btn-outline btn-sm', label = 'Print' }: { className?: string; label?: string }) {
  const mounted = useMounted();
  if (!mounted) return <span className={className} aria-hidden>{label}</span>;
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> {label}
    </button>
  );
}

export function Accordion({ title, children, defaultOpen = false, tone }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; tone?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white', tone)}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className="text-sm font-semibold text-navy-900">{title}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? <div className="border-t border-slate-200 px-4 py-4">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Link tabs (used on member profile and report pages)
 * ------------------------------------------------------------------ */
export function LinkTabs({ items, className }: { items: { href: string; label: string; count?: number }[]; className?: string }) {
  const pathname = usePathname();
  return (
    <div className={cn('tabs scrollbar-thin', className)}>
      {items.map((t) => (
        <Link key={t.href} href={t.href} className={cn('tab', pathname === t.href && 'tab-active')}>
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Confirm + delete
 * ------------------------------------------------------------------ */
export function ConfirmButton({
  action,
  label = 'Delete',
  confirm = 'Are you sure?',
  variant = 'danger',
  className,
  icon,
}: {
  action: () => Promise<any>;
  label?: string;
  confirm?: string;
  variant?: 'danger' | 'outline' | 'primary';
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <ActionButton action={action} confirm={confirm} variant={variant} className={className} icon={icon || <Trash2 className="h-3.5 w-3.5" />}>
      {label}
    </ActionButton>
  );
}

/* ------------------------------------------------------------------ *
 * Notification bell (mobile + desktop)
 * ------------------------------------------------------------------ */
export function BellButton({ count, href = '/notifications' }: { count: number; href?: string }) {
  return (
    <Link href={href} className="relative rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Notifications">
      <Bell className="h-5 w-5" />
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-navy-950">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}

export function useConfirmLeave(dirty: boolean) {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return useMemo(() => v, [v]);
}
