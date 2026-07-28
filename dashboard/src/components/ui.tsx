import type { ReactNode } from 'react'
import { useTheme } from '../lib/theme'

/** Route-type palette, matching the Power BI report. Mid-tone hues chosen so
 *  they stay legible against both the light and dark surfaces. */
export const ROUTE_COLORS: Record<string, string> = {
  'East/West': '#00808B',
  'North/South': '#5BA4CF',
  'Intra-Regional': '#3E7CA6',
  'Feeders': '#4156C8',
  'Other': '#7A8699',
}
export const ROUTE_ORDER = ['East/West', 'North/South', 'Intra-Regional', 'Feeders', 'Other']

export const MAX_YEAR = new Date().getFullYear()
export const MIN_YEAR = 2018

export function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2"
           style={{ borderColor: 'var(--accent)' }} />
    </div>
  )
}

export function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-48 px-4 text-red-500 text-sm text-center">
      {msg}
    </div>
  )
}

export function Empty({ msg = 'No data for this selection.' }: { msg?: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--dim)' }}>
      {msg}
    </div>
  )
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
    <div className="rounded-lg px-4 py-3 flex flex-col justify-center min-h-[92px] border"
         style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold leading-none"
              style={{ color: accent ? 'var(--accent)' : 'var(--text)' }}>
          {typeof value === 'number' ? fmt(value) : (value ?? '—')}
        </span>
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span className={`text-xs font-semibold ${delta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {delta > 0 ? '▲' : '▼'} {fmt(Math.abs(delta))}
          </span>
        )}
      </div>
      <span className="text-[11px] mt-1.5 leading-tight" style={{ color: 'var(--muted)' }}>{label}</span>
      {sub && <span className="text-[10px] mt-0.5 leading-tight" style={{ color: 'var(--dim)' }}>{sub}</span>}
    </div>
  )
}

export function Card({
  title, subtitle, children, className = '', actions,
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  className?: string
  actions?: ReactNode
}) {
  return (
    <div className={`rounded-lg p-4 border ${className}`}
         style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            {title && (
              <h3 className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--text-2)' }}>{title}</h3>
            )}
            {subtitle && <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>{subtitle}</p>}
          </div>
          {actions}
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
        <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--text)' }}>{title}</h1>
        {subtitle && <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-3 flex-wrap">{children}</div>}
    </div>
  )
}

/** Section divider, for pages that fold several former pages together. */
export function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-3 pt-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--accent)' }}>{title}</h2>
      <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
      {note && <span className="text-[10px]" style={{ color: 'var(--dim)' }}>{note}</span>}
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
      className={`text-sm rounded px-3 py-1.5 border focus:outline-none
                  min-w-[200px] max-w-[340px] ${className}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text)' }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Tabs({
  value, onChange, options, size = 'md',
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  size?: 'sm' | 'md'
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(o => {
        const active = value === o
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`rounded border transition-colors ${
              size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
            } ${active ? 'font-semibold' : ''}`}
            style={
              active
                ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-ink)' }
                : { background: 'transparent', borderColor: 'var(--border)', color: 'var(--muted)' }
            }
          >
            {o}
          </button>
        )
      })}
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
  const { palette } = useTheme()
  if (!active || !payload?.length) return null
  const rows = payload.filter(p => p.value !== undefined && p.value !== null && p.value !== 0)
  if (!rows.length) return null
  return (
    <div className="rounded px-3 py-2 text-xs shadow-xl border"
         style={{ background: palette.tooltipBg, borderColor: palette.tooltipBorder }}>
      {label !== undefined && (
        <p className="font-bold mb-1" style={{ color: palette.text }}>{label}</p>
      )}
      {rows.map((p, i) => (
        <p key={i} style={{ color: p.color ?? p.fill ?? palette.accent }} className="leading-relaxed">
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
 *  and avoids label truncation on long port and carrier names. */
export function BarList({
  rows, valueFormat = fmt, color, maxRows = 12,
}: {
  rows: { label: string; value: number; sub?: string }[]
  valueFormat?: (n: number) => string
  color?: string
  maxRows?: number
}) {
  const { palette } = useTheme()
  const shown = rows.slice(0, maxRows)
  const max = Math.max(...shown.map(r => r.value), 1)
  if (!shown.length) return <Empty />
  return (
    <div className="space-y-1.5">
      {shown.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-4 text-right tabular-nums shrink-0" style={{ color: 'var(--faint)' }}>
            {i + 1}
          </span>
          <span className="w-32 truncate shrink-0" style={{ color: 'var(--text-2)' }} title={r.label}>
            {r.label}
          </span>
          <div className="flex-1 h-4 rounded-sm overflow-hidden min-w-[40px]"
               style={{ background: 'var(--panel-alt)' }}>
            <div className="h-full rounded-sm transition-all"
                 style={{ width: `${(r.value / max) * 100}%`,
                          backgroundColor: color ?? palette.accent }} />
          </div>
          <span className="w-16 text-right font-semibold tabular-nums shrink-0"
                style={{ color: 'var(--text)' }}>
            {valueFormat(r.value)}
          </span>
        </div>
      ))}
    </div>
  )
}
