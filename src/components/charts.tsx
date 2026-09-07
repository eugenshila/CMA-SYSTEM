'use client';

import {
  ResponsiveContainer,
  BarChart as RBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart as RLineChart,
  Line,
  AreaChart as RAreaChart,
  Area,
  PieChart as RPieChart,
  Pie,
  Cell,
} from 'recharts';
import { money, moneyCompact, num } from '@/lib/money';
import { periodLabel } from '@/lib/dates';

const PALETTE = ['#0e2340', '#d4af37', '#356bb0', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#ea580c'];

function fmtTick(v: any, currency?: boolean) {
  if (currency) return moneyCompact(v);
  const s = String(v);
  return s.length > 12 ? `${s.slice(0, 11)}…` : s;
}

function CurrencyTooltip({ active, payload, label, currency, labelFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-bold text-navy-900">{labelFormatter ? labelFormatter(label) : label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey ?? p.name} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="font-medium">{p.name}</span>
          <span className="ml-auto tabular-nums font-semibold text-navy-900">
            {currency ? money(p.value) : Number(p.value).toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  );
}

export function BarChartCard({
  data,
  xKey,
  series,
  height = 260,
  currency = true,
  periodLabels = false,
}: {
  data: any[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
  height?: number;
  currency?: boolean;
  periodLabels?: boolean;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6eaf1" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => (periodLabels ? periodLabel(String(v)).slice(0, 3) : fmtTick(v, false))}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmtTick(v, currency)} axisLine={false} tickLine={false} width={62} />
          <Tooltip content={<CurrencyTooltip currency={currency} labelFormatter={periodLabels ? periodLabel : undefined} />} cursor={{ fill: '#f1f5f9' }} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" /> : null}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} maxBarSize={44} />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineChartCard({
  data,
  xKey,
  series,
  height = 260,
  currency = true,
  periodLabels = false,
  area = true,
}: {
  data: any[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
  height?: number;
  currency?: boolean;
  periodLabels?: boolean;
  area?: boolean;
}) {
  const Chart: any = area ? RAreaChart : RLineChart;
  const Shape: any = area ? Area : Line;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color || PALETTE[i % PALETTE.length]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color || PALETTE[i % PALETTE.length]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6eaf1" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => (periodLabels ? periodLabel(String(v)).slice(0, 3) : fmtTick(v, false))}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmtTick(v, currency)} axisLine={false} tickLine={false} width={62} />
          <Tooltip content={<CurrencyTooltip currency={currency} labelFormatter={periodLabels ? periodLabel : undefined} />} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" /> : null}
          {series.map((s, i) => (
            <Shape
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color || PALETTE[i % PALETTE.length]}
              strokeWidth={2.4}
              fill={area ? `url(#grad-${s.key})` : 'transparent'}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChartCard({
  data,
  height = 240,
  currency = true,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  currency?: boolean;
  centerLabel?: string;
  centerValue?: string;
}) {
  const rows = data.filter((d) => num(d.value) > 0);
  const total = rows.reduce((a, r) => a + num(r.value), 0);
  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row">
      <div style={{ height }} className="relative w-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <RPieChart>
            <Pie data={rows} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="#fff">
              {rows.map((r, i) => (
                <Cell key={r.label} fill={r.color || PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<CurrencyTooltip currency={currency} />} />
          </RPieChart>
        </ResponsiveContainer>
        {centerValue ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{centerLabel}</span>
            <span className="text-base font-bold text-navy-900 tabular-nums">{centerValue}</span>
          </div>
        ) : null}
      </div>
      <ul className="w-full space-y-1.5 sm:w-1/2">
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color || PALETTE[i % PALETTE.length] }} />
            <span className="truncate text-slate-600">{r.label}</span>
            <span className="ml-auto tabular-nums font-semibold text-navy-900">
              {currency ? money(r.value) : Number(r.value).toLocaleString()}
            </span>
            <span className="w-10 text-right tabular-nums text-slate-400">
              {total ? `${((num(r.value) / total) * 100).toFixed(0)}%` : '0%'}
            </span>
          </li>
        ))}
        {!rows.length ? <li className="text-xs text-slate-400">No data available.</li> : null}
      </ul>
    </div>
  );
}

export function MiniSpark({ data, color = '#0e2340', height = 40 }: { data: number[]; color?: string; height?: number }) {
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RAreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#spark-${color.replace('#', '')})`} />
        </RAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
