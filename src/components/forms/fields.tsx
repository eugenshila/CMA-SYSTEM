import { cn } from '@/components/ui/primitives';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Layout helpers shared by every form in the system (server + client)
 * ------------------------------------------------------------------ */

export function FormGrid({ children, className, cols = 2 }: { children: React.ReactNode; className?: string; cols?: 1 | 2 | 3 }) {
  const grid = cols === 1 ? 'grid-cols-1' : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';
  return <div className={cn('grid gap-4', grid, className)}>{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  span,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  span?: boolean;
}) {
  return (
    <div className={cn('min-w-0', span && 'sm:col-span-2 lg:col-span-3', className)}>
      {label ? (
        <label className="label">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="error-text">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Fieldset({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn('rounded-xl border border-slate-200 bg-slate-50/50 p-4', className)}>
      <legend className="px-1 text-xs font-bold uppercase tracking-wide text-navy-800">{title}</legend>
      {description ? <p className="mb-3 text-xs text-slate-500">{description}</p> : null}
      {children}
    </fieldset>
  );
}

export function TextInput({
  name,
  type = 'text',
  placeholder,
  defaultValue,
  required,
  min,
  max,
  step,
  readOnly,
  className,
  autoComplete,
  autoFocus,
  pattern,
  id,
  onChange,
}: {
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string | number | null;
  required?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  readOnly?: boolean;
  className?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  pattern?: string;
  id?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      id={id}
      name={name}
      type={type}
      placeholder={placeholder}
      defaultValue={defaultValue ?? undefined}
      required={required}
      min={min}
      max={max}
      step={step}
      readOnly={readOnly}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      pattern={pattern}
      onChange={onChange}
      className={cn('input', readOnly && 'bg-slate-50 text-slate-500', className)}
    />
  );
}

export function TextArea({
  name,
  placeholder,
  defaultValue,
  rows = 3,
  required,
  className,
  onChange,
}: {
  name: string;
  placeholder?: string;
  defaultValue?: string | null;
  rows?: number;
  required?: boolean;
  className?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      name={name}
      placeholder={placeholder}
      defaultValue={defaultValue ?? undefined}
      rows={rows}
      required={required}
      onChange={onChange}
      className={cn('input resize-y', className)}
    />
  );
}

export function Select({
  name,
  options,
  defaultValue,
  placeholder = 'Select…',
  required,
  className,
  disabled,
  onChange,
}: {
  name: string;
  options: { value: string | number | null; label: string }[];
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ''} required={required} disabled={disabled} onChange={onChange} className={cn('select', className)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value ?? '')}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  name,
  label,
  defaultChecked,
  className,
  hint,
  onChange,
}: {
  name: string;
  label: React.ReactNode;
  defaultChecked?: boolean;
  className?: string;
  hint?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm hover:border-navy-300', className)}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} onChange={onChange} className="checkbox mt-0.5" />
      <span className="min-w-0">
        <span className="font-medium text-slate-700">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

export function CheckboxGroup({ name, options, className }: { name: string; options: { value: string; label: string }[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-navy-300">
          <input type="checkbox" name={name} value={o.value} className="checkbox" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Result banner fed by a server action result. */
export function ResultAlert({ result, className }: { result?: { ok?: boolean; message?: string; error?: string } | null; className?: string }) {
  if (!result || (!result.ok && !result.error && !result.message)) return null;
  const tone = result.ok ? 'alert-success' : 'alert-error';
  const Icon = result.ok ? CheckCircle2 : AlertTriangle;
  return (
    <div className={cn('alert', tone, className)} role="status">
      <Icon className="h-4 w-4 shrink-0" />
      <p className="text-xs font-medium">{result.error || result.message}</p>
    </div>
  );
}

export function InfoNote({ children, tone = 'info', className }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'success'; className?: string }) {
  const tones = { info: 'alert-info', warn: 'alert-warn', success: 'alert-success' };
  return (
    <div className={cn('alert', tones[tone], className)}>
      {children}
    </div>
  );
}
