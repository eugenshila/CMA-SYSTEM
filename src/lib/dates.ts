import {
  addMonths,
  addDays,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  endOfMonth,
  format,
  isValid,
  lastDayOfMonth,
  parseISO,
  startOfMonth,
  startOfYear,
  endOfYear,
  subMonths,
} from 'date-fns';

export { addMonths, addDays, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, lastDayOfMonth };

export function toDate(v: any): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : parseISO(String(v));
  return isValid(d) ? d : null;
}

export function fmtDate(v: any, pattern = 'dd MMM yyyy'): string {
  const d = toDate(v);
  return d ? format(d, pattern) : '—';
}

export function fmtDateTime(v: any, pattern = 'dd MMM yyyy HH:mm'): string {
  const d = toDate(v);
  return d ? format(d, pattern) : '—';
}

export function fmtTime(v: any): string {
  const d = toDate(v);
  return d ? format(d, 'HH:mm') : '—';
}

/** 'YYYY-MM' */
export function periodKey(v: any = new Date()): string {
  const d = toDate(v) || new Date();
  return format(d, 'yyyy-MM');
}

export function periodLabel(period: string): string {
  const d = toDate(`${period}-01`);
  return d ? format(d, 'MMMM yyyy') : period;
}

export function periodFromDate(v: any): string {
  return periodKey(v);
}

/** Previous / next month keys for a `yyyy-MM` period. */
export function prevPeriod(period: string): string {
  return periodKey(subMonths(toDate(`${period}-01`) || new Date(), 1));
}

export function nextPeriod(period: string): string {
  return periodKey(addMonths(toDate(`${period}-01`) || new Date(), 1));
}

export function periodStart(period: string): Date {
  return startOfMonth(toDate(`${period}-01`) || new Date());
}

export function periodEnd(period: string): Date {
  return endOfMonth(toDate(`${period}-01`) || new Date());
}

export function lastNPeriods(n: number, from: any = new Date()): string[] {
  const out: string[] = [];
  let d = toDate(from) || new Date();
  for (let i = 0; i < n; i++) {
    out.unshift(periodKey(d));
    d = subMonths(d, 1);
  }
  return out;
}

export function periodsBetween(startPeriod: string, endPeriod: string): string[] {
  const start = toDate(`${startPeriod}-01`);
  const end = toDate(`${endPeriod}-01`);
  if (!start || !end) return [];
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(periodKey(d));
    d = addMonths(d, 1);
  }
  return out;
}

/** Due date for a given period and configured due-day-of-month. */
export function dueDateFor(period: string, dueDay: number): Date {
  const base = toDate(`${period}-01`) || new Date();
  const last = lastDayOfMonth(base).getDate();
  const day = Math.min(Math.max(1, dueDay || last), last);
  return new Date(base.getFullYear(), base.getMonth(), day);
}

export function daysUntil(v: any): number {
  const d = toDate(v);
  if (!d) return 0;
  return differenceInCalendarDays(d, new Date());
}

export function daysSince(v: any): number {
  const d = toDate(v);
  if (!d) return 0;
  return differenceInCalendarDays(new Date(), d);
}

export function monthsBetween(a: any, b: any): number {
  const d1 = toDate(a);
  const d2 = toDate(b);
  if (!d1 || !d2) return 0;
  return differenceInCalendarMonths(d2, d1);
}

export function isPast(v: any): boolean {
  const d = toDate(v);
  return d ? d.getTime() < Date.now() : false;
}

export function isoDate(v: any): string {
  const d = toDate(v);
  return d ? format(d, 'yyyy-MM-dd') : '';
}

export function sqlDate(v: any): string | null {
  const d = toDate(v);
  return d ? format(d, 'yyyy-MM-dd') : null;
}

export function relativeTime(v: any): string {
  const d = toDate(v);
  if (!d) return '—';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins} min${mins > 0 ? ' ago' : 's from now'}`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours} hour${Math.abs(hours) === 1 ? '' : 's'}${hours > 0 ? ' ago' : ' from now'}`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days} day${Math.abs(days) === 1 ? '' : 's'}${days > 0 ? ' ago' : ' from now'}`;
  return fmtDate(d);
}

export function ageGroup(dob: any): string {
  const d = toDate(dob);
  if (!d) return 'Unknown';
  const years = Math.floor(differenceInCalendarDays(new Date(), d) / 365.25);
  if (years < 25) return '18–24';
  if (years < 35) return '25–34';
  if (years < 45) return '35–44';
  if (years < 55) return '45–54';
  if (years < 65) return '55–64';
  return '65+';
}

export function age(dob: any): number | null {
  const d = toDate(dob);
  if (!d) return null;
  return Math.floor(differenceInCalendarDays(new Date(), d) / 365.25);
}

export function financialYearLabel(d: any = new Date(), startMonth = 1): string {
  const date = toDate(d) || new Date();
  const startYear = date.getMonth() + 1 >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
  return `FY ${startYear}`;
}
