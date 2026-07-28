import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, Tabs, CustomTooltip, fmt,
} from '../components/ui'

const LOOKBACK = ['3 months', '6 months', '12 months', '24 months', '36 months'] as const
const LOOKBACK_MONTHS: Record<string, number> = {
  '3 months': 3, '6 months': 6, '12 months': 12, '24 months': 24, '36 months': 36,
}

type Snap = {
  as_of: string
  partner_ports: number
  direct_ports: number
  indirect_ports: number
  partner_countries: number
  direct_countries: number
  indirect_countries: number
}

/** Most recent quarter-end at or before today, matching the mv_..._qtr grain. */
function currentQuarterAnchor(): Date {
  const now = new Date()
  const qm = [3, 6, 9, 12].filter(m => m <= now.getMonth() + 1).pop() ?? 12
  const yr = qm === 12 && now.getMonth() + 1 < 3 ? now.getFullYear() - 1 : now.getFullYear()
  return new Date(Date.UTC(yr, qm - 1, 1))
}

function shiftMonths(d: Date, months: number): string {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1))
  return r.toISOString().slice(0, 10)
}

export default function PortConnectivity() {
  const [port, setPort] = useState('AEAUH')
  const [lookback, setLookback] = useState<string>('12 months')

  const ports = useQuery(async () => {
    const res = await supabase.from('mv_port_connectivity_current')
      .select('port_code,port_name').gt('partner_ports', 0)
      .order('port_name').limit(1000)
    return unwrap(res) as { port_code: string; port_name: string }[]
  }, [])

  const q = useQuery(async () => {
    const anchor = currentQuarterAnchor()
    const anchorStr = anchor.toISOString().slice(0, 10)
    const prevStr = shiftMonths(anchor, LOOKBACK_MONTHS[lookback])

    const [current, series, name] = await Promise.all([
      supabase.from('mv_port_connectivity_current')
        .select('partner_ports,direct_ports,indirect_ports,partner_countries,direct_countries,indirect_countries,partner_coastal_regions,versions')
        .eq('port_code', port).maybeSingle(),
      supabase.from('mv_port_connectivity_qtr')
        .select('as_of,partner_ports,direct_ports,indirect_ports,partner_countries,direct_countries,indirect_countries')
        .eq('port_code', port).lte('as_of', anchorStr).order('as_of'),
      supabase.from('mv_port_dim').select('port_name,country_name,coastal_region').eq('port_code', port).maybeSingle(),
    ])

    const snaps = unwrap(series) as Snap[]
    return {
      current: current.data as Record<string, number> | null,
      snaps,
      now: snaps.find(s => s.as_of === anchorStr) ?? snaps[snaps.length - 1] ?? null,
      prev: snaps.find(s => s.as_of === prevStr) ?? null,
      anchorStr, prevStr,
      meta: name.data as { port_name: string; country_name: string; coastal_region: string } | null,
    }
  }, [port, lookback], { skip: !port })

  const d = q.data
  const delta = (a?: number | null, b?: number | null) =>
    a === undefined || a === null || b === undefined || b === null ? null : a - b

  // Flag when the newest snapshot falls far below the comparison period — almost
  // always forward-schedule incompleteness rather than a real connectivity loss.
  const sharpDrop = !!(d?.now && d?.prev && d.prev.partner_ports > 0 &&
    d.now.partner_ports / d.prev.partner_ports < 0.75)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Port Connectivity Evolution"
        subtitle={d?.meta ? `${d.meta.port_name} · ${d.meta.country_name}` : undefined}
      >
        <Select
          value={port} onChange={setPort} placeholder=""
          options={(ports.data ?? []).map(p => ({ value: p.port_code, label: `${p.port_name} (${p.port_code})` }))}
        />
        <Tabs value={lookback} onChange={setLookback} options={[...LOOKBACK]} />
      </PageHeader>

      {q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !d ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPICard label="Partner Ports" value={d.current?.partner_ports ?? 0} accent
                     sub="as of today" delta={delta(d.now?.partner_ports, d.prev?.partner_ports)} />
            <KPICard label="Direct Connections" value={d.current?.direct_ports ?? 0}
                     sub="next call in rotation" delta={delta(d.now?.direct_ports, d.prev?.direct_ports)} />
            <KPICard label="Indirect Connections" value={d.current?.indirect_ports ?? 0}
                     sub="via transshipment" delta={delta(d.now?.indirect_ports, d.prev?.indirect_ports)} />
            <KPICard label="Partner Countries" value={d.current?.partner_countries ?? 0}
                     delta={delta(d.now?.partner_countries, d.prev?.partner_countries)} />
            <KPICard label="Direct Countries" value={d.current?.direct_countries ?? 0}
                     delta={delta(d.now?.direct_countries, d.prev?.direct_countries)} />
            <KPICard label="Coastal Regions" value={d.current?.partner_coastal_regions ?? 0} sub="reached" />
          </div>

          {d.prev && (
            <div className="text-[11px] text-[#7D93B4] bg-[#0B1830] border border-[#1E3A5F] rounded px-3 py-2">
              Deltas compare <span className="text-[#CBD5E1]">{d.anchorStr}</span> against{' '}
              <span className="text-[#CBD5E1]">{d.prevStr}</span> ({lookback} earlier), using
              quarter-end point-in-time snapshots.
            </div>
          )}

          {sharpDrop && (
            <div className="text-[11px] leading-relaxed bg-[#2A1A0B] border border-[#7A4A12] rounded px-3 py-2">
              <span className="text-[#E0A64A] font-semibold">Read the latest quarter with care.</span>
              <span className="text-[#C9A882]">
                {' '}The most recent snapshot is {Math.round((1 - (d.now!.partner_ports / d.prev!.partner_ports)) * 100)}%
                below {lookback} earlier. Historical periods are fully backfilled, but forward
                schedules are not: a service version drops out of the current snapshot once its
                published validity window lapses, even if the carrier later republishes it. This
                understates the present rather than showing a real loss of connectivity. The Power BI
                model reports the same shape.
              </span>
            </div>
          )}

          {d.snaps.length === 0 ? (
            <Card title="Evolution"><Empty msg="No connectivity history for this port." /></Card>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card title="Port Connectivity Evolution" subtitle="quarter-end snapshots, direct vs indirect">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={d.snaps} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="as_of" tick={{ fill: '#94A3B8', fontSize: 10 }}
                           tickFormatter={v => String(v).slice(0, 7)} axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={38} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    <Area type="monotone" dataKey="direct_ports" name="Direct" stackId="1"
                          stroke="#00C2CB" fill="#00C2CB" fillOpacity={0.55} />
                    <Area type="monotone" dataKey="indirect_ports" name="Indirect" stackId="1"
                          stroke="#4169E1" fill="#4169E1" fillOpacity={0.35} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Country Reach Evolution" subtitle="distinct partner countries by quarter">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={d.snaps} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="as_of" tick={{ fill: '#94A3B8', fontSize: 10 }}
                           tickFormatter={v => String(v).slice(0, 7)} axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={38} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    <Line type="monotone" dataKey="partner_countries" name="All countries"
                          stroke="#87CEEB" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="direct_countries" name="Direct"
                          stroke="#FFD700" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          <p className="text-[10px] text-[#3E5878] leading-relaxed">
            Connectivity is derived from the full port-pair network: for every call on a rotation,
            every other port on that same service counts as a partner, and the next call in sequence
            counts as a direct connection. This mirrors the Power BI <em>ports_by_service</em>
            cross-join. Latest quarters understate slightly, since only {fmt(108)} of{' '}
            {fmt(1777)} active service versions carry a forward end date.
          </p>
        </>
      )}
    </div>
  )
}
