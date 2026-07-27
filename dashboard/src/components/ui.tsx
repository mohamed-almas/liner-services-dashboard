import { ReactNode } from 'react'

export const ROUTE_COLORS: Record<string, string> = {
  'East/West': '#008B8B',
  'Feeders': '#4169E1',
  'Intra-Regional': '#4682B4',
  'North/South': '#87CEEB',
  'Other': '#6B7280',
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00C2CB]" />
    </div>
  )
}

export function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-red-400 text-sm">
      {msg}
    </div>
  )
}

export function KPICard({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px]">
      <span className={`text-2xl font-bold ${accent ? 'text-[#00C2CB]' : 'text-white'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value ?? '—'}
      </span>
      <span className="text-xs text-[#94A3B8] mt-1 text-center leading-tight">{label}</span>
    </div>
  )
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-[#0F2040] border border-[#1E3A5F] rounded-lg p-4 ${className}`}>
      {title && <h3 className="text-sm font-semibold text-[#94A3B8] mb-3 uppercase tracking-wide">{title}</h3>}
      {children}
    </div>
  )
}

export function PageHeader({ title }: { title: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
    </div>
  )
}

export function Select({ value, onChange, options, placeholder = 'Select...' }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-[#0F2040] border border-[#1E3A5F] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#00C2CB] min-w-[200px]"
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; fill: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#0F2040] border border-[#1E3A5F] rounded p-3 text-xs text-white shadow-xl">
      <p className="font-bold mb-1 text-[#94A3B8]">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.fill ?? '#00C2CB' }}>
          {p.name}: <span className="font-semibold">{p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

export function pivotByRouteType(rows: { year: number; route_type: string; service_count: number }[]) {
  const map = new Map<number, Record<string, number>>()
  for (const r of rows) {
    if (!map.has(r.year)) map.set(r.year, { year: r.year })
    map.get(r.year)![r.route_type] = r.service_count
  }
  return Array.from(map.values()).sort((a, b) => a.year - b.year)
}
