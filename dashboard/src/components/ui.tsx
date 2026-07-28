import type { ReactNode } from 'react'

/** Route-type palette, matching the Power BI report. */
export const ROUTE_COLORS: Record<string, string> = {
  'East/West': '#008B8B',
  'North/South': '#87CEEB',
  'Intra-Regional': '#4682B4',
  'Feeders': '#4169E1',
  'Other': '#6B7280',
}
export const ROUTE_ORDER = ['East/West', 'North/South', 'Intra-Regional', 'Feeders', 'Other']

/** Latest month with reliable data. Forward months are thin: only 108 of 1,777
 *  current service versions carry an end date, so later snapshots understate. */
export const MAX_YEAR = new Date().getFullYear()
export const MIN_YEAR = 2018

export function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00C2CB]" />
    </div>
  )
}

export function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-48 px-4 text-red-400 text-sm text-center">
      {msg}
    </div>
  )
}

export function Empty({ msg = 'No data for this selection.' }: { msg?: string }) {
  return <div className="flex items-center justify-center h-40 text-[#64748B] text-sm">{msg}</div>
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

/** Compact TEU formatting: 5,636,595 -> "5.6M" */
export function fmtTeu(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K'
  return String(Math.round(n))
}

export function KPICard({
  label, value, accent, sub, delta,
}: {
  label: string
  value: ReactNode
  accent?: boolean
  sub?: string
  delta?: number | null
}) {
  return (
    <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-lg px-4 py-3 flex flex-col justify-center min-h-[92px]">
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold leading-none ${accent ? 'text-[#00C2CB]' : 'text-white'}`}>
          {typeof value === 'number' ? fmt(value) : (value ?? '—')}
        </span>
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span className={`text-xs font-semibold ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {delta > 0 ? '▲' : '▼'} {fmt(Math.abs(delta))}
          </span>
        )}
      </div>
      <span className="text-[11px] text-[#94A3B8] mt-1.5 leading-tight">{label}</span>
      {sub && <span className="text-[10px] text-[#5A7196] mt-0.5 leading-tight">{sub}</span>}
    </div>
  )
}

export function Card({
  title, subtitle, children, className = '',
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`bg-[#0F2040] border border-[#1E3A5F] rounded-lg p-4 ${className}`}>
      {title && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold text-[#CBD5E1] uppercase tracking-wide">{title}</h3>
          {subtitle && <p className="text-[10px] text-[#5A7196] mt-0.5">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

export function PageHeader({
  title, subtitle, children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-xl font-bold text-white leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-[#5A7196] mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-3 flex-wrap">{children}</div>}
    </div>
  )
}

export function Select({
  value, onChange, options, placeholder = 'Select...', className = '',
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-[#0F2040] border border-[#1E3A5F] text-white text-sm rounded px-3 py-1.5
                  focus:outline-none focus:border-[#00C2CB] min-w-[200px] max-w-[340px] ${className}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Tabs({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-3 py-1 text-xs rounded border transition-colors ${
            value === o
              ? 'bg-[#00C2CB] border-[#00C2CB] text-[#062032] font-semibold'
              : 'border-[#1E3A5F] text-[#94A3B8] hover:text-white hover:border-[#2F5480]'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

type TooltipPayload = { name?: string; value?: number; color?: string; fill?: string }

export function CustomTooltip({
  active, payload, label,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(p => p.value !== undefined && p.value !== null && p.value !== 0)
  if (!rows.length) return null
  return (
    <div className="bg-[#0B1830] border border-[#2F5480] rounded px-3 py-2 text-xs shadow-xl">
      {label !== undefined && <p className="font-bold mb-1 text-white">{label}</p>}
      {rows.map((p, i) => (
        <p key={i} style={{ color: p.color ?? p.fill ?? '#00C2CB' }} className="leading-relaxed">
          {p.name}: <span className="font-semibold">{fmt(p.value)}</span>
        </p>
      ))}
    </div>
  )
}

/** Pivot long rows (year, route_type, value) into wide rows keyed by route type,
 *  so Recharts can stack them. Missing combinations default to 0. */
export function pivotByRoute<T extends Record<string, unknown>>(
  rows: T[],
  yearKey: keyof T = 'year' as keyof T,
  routeKey: keyof T = 'route_type' as keyof T,
  valueKey: keyof T = 'service_count' as keyof T,
): Record<string, number>[] {
  const map = new Map<number, Record<string, number>>()
  for (const r of rows) {
    const yr = Number(r[yearKey])
    if (!Number.isFinite(yr)) continue
    if (!map.has(yr)) {
      const seed: Record<string, number> = { year: yr }
      for (const rt of ROUTE_ORDER) seed[rt] = 0
      map.set(yr, seed)
    }
    const route = String(r[routeKey] ?? 'Other')
    const key = ROUTE_ORDER.includes(route) ? route : 'Other'
    map.get(yr)![key] += Number(r[valueKey] ?? 0)
  }
  return Array.from(map.values()).sort((a, b) => a.year - b.year)
}

/** Horizontal bar list — clearer than a Recharts vertical BarChart for rankings,
 *  and avoids label truncation on long port/liner names. */
export function BarList({
  rows, valueFormat = fmt, color = '#008B8B', maxRows = 12,
}: {
  rows: { label: string; value: number; sub?: string }[]
  valueFormat?: (n: number) => string
  color?: string
  maxRows?: number
}) {
  const shown = rows.slice(0, maxRows)
  const max = Math.max(...shown.map(r => r.value), 1)
  if (!shown.length) return <Empty />
  return (
    <div className="space-y-1.5">
      {shown.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-4 text-right text-[#5A7196] tabular-nums shrink-0">{i + 1}</span>
          <span className="w-32 truncate text-[#CBD5E1] shrink-0" title={r.label}>{r.label}</span>
          <div className="flex-1 h-4 bg-[#0A1628] rounded-sm overflow-hidden min-w-[40px]">
            <div
              className="h-full rounded-sm transition-all"
              style={{ width: `${(r.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-16 text-right font-semibold text-white tabular-nums shrink-0">
            {valueFormat(r.value)}
          </span>
        </div>
      ))}
    </div>
  )
}
