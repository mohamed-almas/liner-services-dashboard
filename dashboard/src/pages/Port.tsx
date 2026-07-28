import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, AreaChart, Area,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import { useTheme } from '../lib/theme'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, SectionTitle, Select, Tabs, BarList,
  ROUTE_COLORS, ROUTE_ORDER, CustomTooltip, pivotByRoute, fmtTeu, fmt,
  MIN_YEAR, MAX_YEAR,
} from '../components/ui'
import WorldMap from '../components/WorldMap'
import {
  routesForPort, routesForPortAt, routeStatsForPort, routeStatsForPortAt,
  toMapRoutes, endpointsFromRoutes, type RouteRow, type RouteStats,
} from '../lib/routes'

const LOOKBACK = ['3 months', '6 months', '12 months', '24 months', '36 months'] as const
const LOOKBACK_MONTHS: Record<string, number> = {
  '3 months': 3, '6 months': 6, '12 months': 12, '24 months': 24, '36 months': 36,
}

/** Latest quarter-end at or before today — matches the mv_service_month grain. */
function currentQuarterAnchor(): Date {
  const now = new Date()
  const qm = [3, 6, 9, 12].filter(m => m <= now.getMonth() + 1).pop() ?? 12
  return new Date(Date.UTC(now.getFullYear(), qm - 1, 1))
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const shiftMonths = (d: Date, m: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - m, 1))

type Snap = {
  as_of: string
  partner_ports: number; direct_ports: number; indirect_ports: number
  partner_countries: number; direct_countries: number; indirect_countries: number
}

export default function Port() {
  const { palette } = useTheme()
  const [port, setPort] = useState('AEAUH')
  const [lookback, setLookback] = useState<string>('12 months')
  const [mapMode, setMapMode] = useState<'Current network' | 'Compare periods'>('Current network')

  const anchor = useMemo(() => currentQuarterAnchor(), [])
  const prevDate = useMemo(
    () => iso(shiftMonths(anchor, LOOKBACK_MONTHS[lookback])), [anchor, lookback])

  const ports = useQuery(async () => {
    const res = await supabase.from('mv_port_map')
      .select('port_code,port_name,country_name')
      .eq('is_chokepoint', false).gt('active_services', 0)
      .order('port_name').limit(1000)
    return unwrap(res) as { port_code: string; port_name: string; country_name: string }[]
  }, [])

  // Core port facts: KPIs, annual trend, connectivity now and historically.
  const core = useQuery(async () => {
    const [kpi, conn, byYear, snaps, partners, services] = await Promise.all([
      supabase.from('mv_port_current')
        .select('port_name,country_name,coastal_region,region,continent,active_services,lines_calling,service_capacity_teu,annual_capacity_teu,annual_calls_at_port,has_berth_calls')
        .eq('port_code', port).maybeSingle(),
      supabase.from('mv_port_connectivity_current')
        .select('partner_ports,direct_ports,indirect_ports,partner_countries,direct_countries,indirect_countries,partner_coastal_regions')
        .eq('port_code', port).maybeSingle(),
      supabase.from('mv_port_year')
        .select('year,route_type,service_count,service_capacity_teu,annual_rotations')
        .eq('port_code', port).gte('year', MIN_YEAR).lte('year', MAX_YEAR).order('year'),
      supabase.from('mv_port_connectivity_qtr')
        .select('as_of,partner_ports,direct_ports,indirect_ports,partner_countries,direct_countries,indirect_countries')
        .eq('port_code', port).lte('as_of', iso(anchor)).order('as_of'),
      supabase.from('mv_port_partner_country')
        .select('partner_country_short_name,partner_ports')
        .eq('port_code', port).order('partner_ports', { ascending: false }).limit(16),
      supabase.from('mv_service_port_berth').select('service_version_id').eq('port_code', port).limit(1000),
    ])

    const ids = (unwrap(services) as { service_version_id: number }[]).map(r => r.service_version_id)
    const svc = ids.length
      ? await supabase.from('mv_service_base')
          .select('service_master_name,alliance_code,trade_route_1,service_version_roundtrip_days,service_version_frequency_days,service_capacity_teu,vessels_deployed')
          .in('service_version_id', ids.slice(0, 500)).eq('is_current', true)
          .order('service_capacity_teu', { ascending: false, nullsFirst: false })
      : { data: [], error: null }

    const snapRows = unwrap(snaps) as Snap[]
    return {
      kpi: kpi.data as Record<string, never> | null,
      conn: conn.data as Record<string, number> | null,
      byYear: unwrap(byYear) as { year: number; route_type: string; service_count: number; service_capacity_teu: number; annual_rotations: number }[],
      snaps: snapRows,
      now: snapRows.find(s => s.as_of === iso(anchor)) ?? snapRows[snapRows.length - 1] ?? null,
      prev: snapRows.find(s => s.as_of === prevDate) ?? null,
      partners: unwrap(partners) as { partner_country_short_name: string; partner_ports: number }[],
      services: (svc.data ?? []) as {
        service_master_name: string; alliance_code: string | null; trade_route_1: string | null
        service_version_roundtrip_days: number | null; service_version_frequency_days: number | null
        service_capacity_teu: number | null; vessels_deployed: number | null
      }[],
    }
  }, [port, prevDate], { skip: !port })

  // Route geometry — current network, or both periods when comparing.
  const geo = useQuery(async () => {
    if (!port) return null
    if (mapMode === 'Current network') {
      const [rows, stats] = await Promise.all([routesForPort(port), routeStatsForPort(port)])
      return { now: rows, then: [] as RouteRow[], stats, statsThen: null as RouteStats | null }
    }
    const [now, then, stats, statsThen] = await Promise.all([
      routesForPortAt(port, iso(anchor)),
      routesForPortAt(port, prevDate),
      routeStatsForPortAt(port, iso(anchor)),
      routeStatsForPortAt(port, prevDate),
    ])
    return { now, then, stats, statsThen }
  }, [port, mapMode, prevDate], { skip: !port })

  const portLookup = useMemo(() => {
    const m = new Map<string, { lat: number; lon: number; name: string; country: string }>()
    return m // filled below from the geo endpoints query
  }, [])

  // Coordinates for the route endpoints.
  const coords = useQuery(async () => {
    const res = await supabase.from('mv_port_map')
      .select('port_code,port_name,country_name,lat,lon').order('port_code').limit(1000)
    const rows = unwrap(res) as {
      port_code: string; port_name: string; country_name: string; lat: number; lon: number
    }[]
    const m = new Map(rows.map(r => [r.port_code, {
      lat: r.lat, lon: r.lon, name: r.port_name, country: r.country_name,
    }]))
    return m
  }, [])

  const lookup = coords.data ?? portLookup
  const nowRows = geo.data?.now ?? []
  const thenRows = geo.data?.then ?? []
  const stats = geo.data?.stats ?? null
  const statsThen = geo.data?.statsThen ?? null

  const compare = useMemo(() => {
    if (mapMode !== 'Compare periods') return null
    const nowIds = new Set(nowRows.map(r => r.route_id))
    const thenIds = new Set(thenRows.map(r => r.route_id))
    return {
      retained: nowRows.filter(r => thenIds.has(r.route_id)),
      gained: nowRows.filter(r => !thenIds.has(r.route_id)),
      lost: thenRows.filter(r => !nowIds.has(r.route_id)),
    }
  }, [mapMode, nowRows, thenRows])

  const mapRoutes = useMemo(() => {
    if (compare) {
      return [
        ...toMapRoutes(compare.lost, '#DC2626', true),
        ...toMapRoutes(compare.retained, palette.muted),
        ...toMapRoutes(compare.gained, '#059669'),
      ]
    }
    return toMapRoutes(nowRows)
  }, [compare, nowRows, palette.muted])

  const mapPoints = useMemo(
    () => endpointsFromRoutes(compare ? [...nowRows, ...thenRows] : nowRows, lookup),
    [compare, nowRows, thenRows, lookup])

  const k = core.data?.kpi as {
    port_name?: string; country_name?: string; coastal_region?: string; continent?: string
    active_services?: number; lines_calling?: number
    service_capacity_teu?: number; annual_capacity_teu?: number
    annual_calls_at_port?: number; has_berth_calls?: boolean
  } | null | undefined

  const c = core.data?.conn
  const delta = (a?: number | null, b?: number | null) =>
    a == null || b == null ? null : a - b

  const capByYear = useMemo(() => {
    if (!core.data) return []
    return Array.from(core.data.byYear.reduce((m, r) => {
      const cur = m.get(r.year) ?? { year: r.year, capacity: 0, calls: 0 }
      cur.capacity += r.service_capacity_teu ?? 0
      cur.calls += r.annual_rotations ?? 0
      m.set(r.year, cur)
      return m
    }, new Map<number, { year: number; capacity: number; calls: number }>()).values())
      .sort((a, b) => a.year - b.year)
  }, [core.data])

  const sharpDrop = !!(core.data?.now && core.data?.prev && core.data.prev.partner_ports > 0 &&
    core.data.now.partner_ports / core.data.prev.partner_ports < 0.75)

  return (
    <div className="space-y-5">
      <PageHeader
        title={k?.port_name ? `${k.port_name} — Port Overview` : 'Port Overview'}
        subtitle={k ? [k.country_name, k.coastal_region, k.continent].filter(Boolean).join(' · ') : undefined}
      >
        <Select value={port} onChange={setPort} placeholder=""
                options={(ports.data ?? []).map(p => ({
                  value: p.port_code, label: `${p.port_name} — ${p.country_name}`,
                }))} />
      </PageHeader>

      {core.loading ? <Spinner /> : core.error ? <ErrorMsg msg={core.error} /> : !core.data ? null : (
        <>
          {/* ---------- Snapshot ---------- */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <KPICard label="Active Services" value={k?.active_services ?? 0} accent sub="as of today" />
            <KPICard label="Lines Calling" value={k?.lines_calling ?? 0} />
            <KPICard label="Deployed Capacity" value={fmtTeu(k?.service_capacity_teu)} sub="TEU per rotation" />
            <KPICard label="Annual Calls" value={fmtTeu(k?.annual_calls_at_port)} sub="rotations × calls" />
            <KPICard label="Partner Ports" value={c?.partner_ports ?? 0}
                     sub="reachable on one service"
                     delta={delta(core.data.now?.partner_ports, core.data.prev?.partner_ports)} />
            <KPICard label="Direct" value={c?.direct_ports ?? 0} sub="next call in rotation"
                     delta={delta(core.data.now?.direct_ports, core.data.prev?.direct_ports)} />
            <KPICard label="Partner Countries" value={c?.partner_countries ?? 0}
                     delta={delta(core.data.now?.partner_countries, core.data.prev?.partner_countries)} />
          </div>

          {k?.has_berth_calls === false && (
            <div className="text-[11px] rounded px-3 py-2 border"
                 style={{ background: 'var(--panel-alt)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
              This port has no berth-arrival records in the feed, so service and connectivity figures
              read zero. That is a coverage gap rather than an absence of traffic.
            </div>
          )}

          {core.data.prev && (
            <div className="text-[11px] rounded px-3 py-2 border"
                 style={{ background: 'var(--panel-alt)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
              Deltas compare <span style={{ color: 'var(--text-2)' }}>{iso(anchor)}</span> against{' '}
              <span style={{ color: 'var(--text-2)' }}>{prevDate}</span> ({lookback} earlier).
              <span className="ml-2"><Tabs value={lookback} onChange={setLookback} options={[...LOOKBACK]} size="sm" /></span>
            </div>
          )}

          {sharpDrop && (
            <div className="text-[11px] leading-relaxed rounded px-3 py-2 border"
                 style={{ background: 'rgba(217,164,0,0.10)', borderColor: '#B98A1A' }}>
              <span className="font-semibold" style={{ color: '#B98A1A' }}>
                Read the latest quarter with care.
              </span>{' '}
              <span style={{ color: 'var(--text-2)' }}>
                The newest snapshot is{' '}
                {Math.round((1 - (core.data.now!.partner_ports / core.data.prev!.partner_ports)) * 100)}%
                below {lookback} earlier. History is fully backfilled but forward schedules are not: a
                service version drops out once its published validity window lapses, even if the
                carrier later republishes it. The Power BI model reports the same shape.
              </span>
            </div>
          )}

          {/* ---------- Route map ---------- */}
          <SectionTitle title="Nautical network"
                        note={stats ? `${fmt(stats.active_services)} services · ${fmt(stats.legs)} legs` : undefined} />

          {geo.error ? <ErrorMsg msg={geo.error} /> : (
            <>
              {compare ? (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  <KPICard label="Active Services" value={stats?.active_services ?? 0} accent sub={iso(anchor)} />
                  <KPICard label={`Services ${lookback} ago`} value={statsThen?.active_services ?? 0} sub={prevDate} />
                  <KPICard label="Legs now" value={stats?.legs ?? 0} sub={iso(anchor)} />
                  <KPICard label={`Legs ${lookback} ago`} value={statsThen?.legs ?? 0} sub={prevDate} />
                  <KPICard label="Gained" value={compare.gained.length} sub="new legs" />
                  <KPICard label="Lost" value={compare.lost.length} sub="no longer served" />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                  <KPICard label="Active Services" value={stats?.active_services ?? 0} accent sub="on these legs" />
                  <KPICard label="Legs" value={stats?.legs ?? 0} sub="distinct port pairs" />
                  <KPICard label="Ports Reached" value={stats?.ports ?? 0} />
                  <KPICard label="Total Distance" value={fmt(stats?.total_nm)} sub="nautical miles" />
                  <KPICard label="Antimeridian Legs" value={stats?.antimeridian_legs ?? 0} sub="trans-Pacific" />
                </div>
              )}

              <Card
                title={compare ? 'Connectivity change' : 'Route network'}
                subtitle={compare
                  ? 'green = gained · grey = retained · red dashed = lost'
                  : 'line thickness reflects how many services share the leg'}
                actions={
                  <Tabs value={mapMode} onChange={v => setMapMode(v as typeof mapMode)}
                        options={['Current network', 'Compare periods']} size="sm" />
                }
              >
                {geo.loading ? <Spinner />
                 : mapRoutes.length === 0 ? <Empty msg="No route geometry for this port." />
                 : (
                  <WorldMap
                    routes={mapRoutes} points={mapPoints} height={500} fit="world"
                    emphasisPort={k?.port_name}
                    legend={compare ? [
                      { color: '#059669', label: 'Gained' },
                      { color: palette.muted, label: 'Retained' },
                      { color: '#DC2626', label: 'Lost' },
                    ] : undefined}
                  />
                )}
              </Card>

              {stats && stats.legs > nowRows.length && (
                <div className="text-[11px] rounded px-3 py-2 border"
                     style={{ background: 'var(--panel-alt)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  Showing {fmt(nowRows.length)} of {fmt(stats.legs)} legs on the map to keep it
                  legible. The figures above cover the full network.
                </div>
              )}
            </>
          )}

          {/* ---------- Trend ---------- */}
          <SectionTitle title="Trend" note="services calling during each year" />

          {core.data.byYear.length === 0 ? <Card><Empty msg="No berth-arrival history." /></Card> : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card title="Services by Trade Route">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={pivotByRoute(core.data.byYear)} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="year" tick={{ fill: palette.axis, fontSize: 11 }}
                           axisLine={{ stroke: palette.grid }} tickLine={false} />
                    <YAxis tick={{ fill: palette.axis, fontSize: 11 }} width={38} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: palette.grid, fillOpacity: 0.25 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    {ROUTE_ORDER.map(rt => (
                      <Bar key={rt} dataKey={rt} stackId="a" fill={ROUTE_COLORS[rt]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Capacity & Calls">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={capByYear} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="year" tick={{ fill: palette.axis, fontSize: 11 }}
                           axisLine={{ stroke: palette.grid }} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fill: palette.axis, fontSize: 11 }} width={46}
                           axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fill: palette.axis, fontSize: 11 }}
                           width={44} axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: palette.grid, fillOpacity: 0.25 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    <Bar yAxisId="l" dataKey="capacity" name="Capacity (TEU)"
                         fill={palette.neutralBar} radius={[2, 2, 0, 0]} />
                    <Line yAxisId="r" dataKey="calls" name="Annual calls"
                          stroke="#D9A400" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          {/* ---------- Connectivity evolution ---------- */}
          {core.data.snaps.length > 1 && (
            <>
              <SectionTitle title="Connectivity evolution" note="quarter-end point-in-time snapshots" />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card title="Partner ports" subtitle="direct versus indirect reach">
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={core.data.snaps} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <XAxis dataKey="as_of" tick={{ fill: palette.axis, fontSize: 10 }}
                             tickFormatter={v => String(v).slice(0, 7)}
                             axisLine={{ stroke: palette.grid }} tickLine={false} />
                      <YAxis tick={{ fill: palette.axis, fontSize: 11 }} width={38} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                      <Area type="monotone" dataKey="direct_ports" name="Direct" stackId="1"
                            stroke={palette.accent} fill={palette.accent} fillOpacity={0.55} />
                      <Area type="monotone" dataKey="indirect_ports" name="Indirect" stackId="1"
                            stroke={ROUTE_COLORS['Feeders']} fill={ROUTE_COLORS['Feeders']} fillOpacity={0.35} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>

                <Card title="Top partner countries" subtitle="by distinct partner ports reachable">
                  <BarList rows={core.data.partners.map(p => ({
                    label: p.partner_country_short_name, value: p.partner_ports,
                  }))} color={ROUTE_COLORS['East/West']} maxRows={14} />
                </Card>
              </div>
            </>
          )}

          {/* ---------- Services calling ---------- */}
          <SectionTitle title="Services calling"
                        note={`${core.data.services.length} currently active version${core.data.services.length === 1 ? '' : 's'}`} />
          <Card>
            {core.data.services.length === 0 ? <Empty /> : (
              <div className="overflow-auto max-h-[360px]">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}
                        className="sticky top-0" >
                      <th className="pb-2 pr-3 font-medium" style={{ background: 'var(--panel)' }}>Service</th>
                      <th className="pb-2 pr-3 font-medium" style={{ background: 'var(--panel)' }}>Route</th>
                      <th className="pb-2 pr-3 font-medium" style={{ background: 'var(--panel)' }}>Alliance</th>
                      <th className="pb-2 pr-3 font-medium text-right" style={{ background: 'var(--panel)' }}>RT</th>
                      <th className="pb-2 pr-3 font-medium text-right" style={{ background: 'var(--panel)' }}>Freq</th>
                      <th className="pb-2 pr-3 font-medium text-right" style={{ background: 'var(--panel)' }}>Vessels</th>
                      <th className="pb-2 font-medium text-right" style={{ background: 'var(--panel)' }}>TEU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {core.data.services.map((s, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="py-1.5 pr-3 max-w-[200px] truncate" style={{ color: 'var(--text-2)' }}
                            title={s.service_master_name}>{s.service_master_name}</td>
                        <td className="py-1.5 pr-3" style={{ color: 'var(--dim)' }}>{s.trade_route_1 ?? '—'}</td>
                        <td className="py-1.5 pr-3" style={{ color: 'var(--dim)' }}>{s.alliance_code ?? '—'}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(s.service_version_roundtrip_days)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(s.service_version_frequency_days)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(s.vessels_deployed, 1)}</td>
                        <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--accent)' }}>
                          {fmtTeu(s.service_capacity_teu)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--faint)' }}>
            <strong style={{ color: 'var(--dim)' }}>Direct</strong> means the partner port is the very
            next call in the rotation; every other reachable port on the same service counts as
            indirect. KPI cards are point-in-time; annual bars count services calling at any point in
            the year, so they read higher. Both reconcile with the Power BI model.
          </p>
        </>
      )}
    </div>
  )
}
