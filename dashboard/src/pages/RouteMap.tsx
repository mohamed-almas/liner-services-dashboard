import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap, fetchAll } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, Tabs, fmt,
} from '../components/ui'
import WorldMap from '../components/WorldMap'
import {
  routesForService, routesForPort, routesForLiner, routesForPortAt,
  routeStatsForService, routeStatsForPort, routeStatsForLiner, routeStatsForPortAt,
  toMapRoutes, endpointsFromRoutes, type RouteRow, type RouteStats,
} from '../lib/routes'

type Mode = 'Service' | 'Port' | 'Liner' | 'Compare periods'
const MODES: Mode[] = ['Service', 'Port', 'Liner', 'Compare periods']

const LOOKBACK = ['6 months', '12 months', '24 months', '36 months'] as const
const LOOKBACK_MONTHS: Record<string, number> = {
  '6 months': 6, '12 months': 12, '24 months': 24, '36 months': 36,
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

export default function RouteMap() {
  const [mode, setMode] = useState<Mode>('Service')
  const [service, setService] = useState('')
  const [port, setPort] = useState('AEAUH')
  const [liner, setLiner] = useState('')
  const [lookback, setLookback] = useState<string>('12 months')

  // Port coordinate lookup, shared by every mode.
  const portDim = useQuery(async () => {
    const rows = await fetchAll<{
      port_code: string; port_name: string; country_name: string
      lat: number; lon: number
    }>((from, to) =>
      supabase.from('mv_port_map')
        .select('port_code,port_name,country_name,lat,lon')
        .order('port_code').range(from, to)
    )
    const map = new Map(rows.map(r => [r.port_code, {
      lat: r.lat, lon: r.lon, name: r.port_name, country: r.country_name,
    }]))
    return map
  }, [])

  const services = useQuery(() => fetchAll<{
    current_version_id: number; service_master_name: string
    service_master_name_incl_trade_lane: string
  }>((from, to) =>
    supabase.from('mv_service_names')
      .select('current_version_id,service_master_name,service_master_name_incl_trade_lane')
      .eq('has_current', true).order('service_master_name').range(from, to)
  ), [])

  const ports = useQuery(async () => {
    const res = await supabase.from('mv_port_map')
      .select('port_code,port_name,country_name')
      .eq('is_chokepoint', false).gt('active_services', 0)
      .order('port_name').limit(1000)
    return unwrap(res) as { port_code: string; port_name: string; country_name: string }[]
  }, [])

  const liners = useQuery(async () => {
    const res = await supabase.from('mv_liner_current')
      .select('company_code,company_name,vsa_capacity_teu')
      .order('vsa_capacity_teu', { ascending: false, nullsFirst: false }).limit(400)
    return unwrap(res) as { company_code: string; company_name: string }[]
  }, [])

  useEffect(() => {
    if (!service && services.data?.length) setService(String(services.data[0].current_version_id))
  }, [services.data, service])
  useEffect(() => {
    if (!liner && liners.data?.length) setLiner(liners.data[0].company_code)
  }, [liners.data, liner])

  const anchor = useMemo(() => currentQuarterAnchor(), [])
  const prevDate = useMemo(
    () => iso(shiftMonths(anchor, LOOKBACK_MONTHS[lookback])), [anchor, lookback])

  const empty = { now: [] as RouteRow[], then: [] as RouteRow[],
                  stats: null as RouteStats | null, statsThen: null as RouteStats | null }

  const q = useQuery(async () => {
    // Geometry and statistics are fetched separately: the geometry RPCs cap
    // their payload for legibility, so KPI counts come from the stats RPCs.
    if (mode === 'Service') {
      if (!service) return empty
      const [now, stats] = await Promise.all([
        routesForService(Number(service)), routeStatsForService(Number(service)),
      ])
      return { ...empty, now, stats }
    }
    if (mode === 'Port') {
      if (!port) return empty
      const [now, stats] = await Promise.all([
        routesForPort(port), routeStatsForPort(port),
      ])
      return { ...empty, now, stats }
    }
    if (mode === 'Liner') {
      if (!liner) return empty
      const [now, stats] = await Promise.all([
        routesForLiner(liner), routeStatsForLiner(liner),
      ])
      return { ...empty, now, stats }
    }
    if (!port) return empty
    const [now, then, stats, statsThen] = await Promise.all([
      routesForPortAt(port, iso(anchor)),
      routesForPortAt(port, prevDate),
      routeStatsForPortAt(port, iso(anchor)),
      routeStatsForPortAt(port, prevDate),
    ])
    return { now, then, stats, statsThen }
  }, [mode, service, port, liner, prevDate])

  const lookupMap = portDim.data ?? new Map()
  const nowRows = q.data?.now ?? []
  const thenRows = q.data?.then ?? []

  // In compare mode, classify legs as retained / lost / gained.
  const compare = useMemo(() => {
    if (mode !== 'Compare periods') return null
    const nowIds = new Set(nowRows.map(r => r.route_id))
    const thenIds = new Set(thenRows.map(r => r.route_id))
    return {
      retained: nowRows.filter(r => thenIds.has(r.route_id)),
      gained:   nowRows.filter(r => !thenIds.has(r.route_id)),
      lost:     thenRows.filter(r => !nowIds.has(r.route_id)),
    }
  }, [mode, nowRows, thenRows])

  const mapRoutes = useMemo(() => {
    if (compare) {
      return [
        ...toMapRoutes(compare.lost, '#EF4444', true),
        ...toMapRoutes(compare.retained, '#4A6082'),
        ...toMapRoutes(compare.gained, '#10B981'),
      ]
    }
    return toMapRoutes(nowRows, mode === 'Service' ? '#00C2CB' : '#00C2CB')
  }, [compare, nowRows, mode])

  const mapPoints = useMemo(() => {
    const rows = compare ? [...nowRows, ...thenRows] : nowRows
    return endpointsFromRoutes(rows, lookupMap)
  }, [compare, nowRows, thenRows, lookupMap])

  const stats = q.data?.stats ?? null
  const statsThen = q.data?.statsThen ?? null
  const truncated = stats ? stats.legs > nowRows.length : false
  const focusPort = (mode === 'Port' || mode === 'Compare periods')
    ? lookupMap.get(port)?.name : undefined

  const subtitle =
    mode === 'Service' ? 'Nautical rotation of one service version'
    : mode === 'Port' ? 'All legs reachable from this port on currently active services'
    : mode === 'Liner' ? "Operator's active network"
    : `Legs at ${iso(anchor)} versus ${prevDate}`

  return (
    <div className="space-y-5">
      <PageHeader title="Route Map" subtitle={subtitle}>
        <Tabs value={mode} onChange={v => setMode(v as Mode)} options={MODES} />
      </PageHeader>

      <div className="flex gap-3 flex-wrap">
        {mode === 'Service' && (
          <Select value={service} onChange={setService} placeholder=""
                  options={(services.data ?? []).map(s => ({
                    value: String(s.current_version_id),
                    label: s.service_master_name_incl_trade_lane ?? s.service_master_name,
                  }))} />
        )}
        {(mode === 'Port' || mode === 'Compare periods') && (
          <Select value={port} onChange={setPort} placeholder=""
                  options={(ports.data ?? []).map(p => ({
                    value: p.port_code, label: `${p.port_name} — ${p.country_name}`,
                  }))} />
        )}
        {mode === 'Liner' && (
          <Select value={liner} onChange={setLiner} placeholder=""
                  options={(liners.data ?? []).map(l => ({
                    value: l.company_code, label: l.company_name ?? l.company_code,
                  }))} />
        )}
        {mode === 'Compare periods' && (
          <Tabs value={lookback} onChange={setLookback} options={[...LOOKBACK]} />
        )}
      </div>

      {q.loading || portDim.loading ? <Spinner />
       : q.error ? <ErrorMsg msg={q.error} />
       : (
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
              <KPICard label="Active Services" value={stats?.active_services ?? 0} accent
                       sub={mode === 'Service' ? 'this version' : 'currently active'} />
              <KPICard label="Legs" value={stats?.legs ?? 0}
                       sub={mode === 'Service' ? 'in rotation' : 'distinct port pairs'} />
              <KPICard label="Ports Touched" value={stats?.ports ?? 0} />
              <KPICard label="Total Distance" value={fmt(stats?.total_nm)} sub="nautical miles" />
              <KPICard label="Antimeridian Legs" value={stats?.antimeridian_legs ?? 0} sub="trans-Pacific" />
            </div>
          )}

          {truncated && (
            <div className="text-[11px] text-[#7D93B4] bg-[#0B1830] border border-[#1E3A5F] rounded px-3 py-2">
              Showing {fmt(nowRows.length)} of {fmt(stats?.legs)} legs on the map to keep it legible.
              The figures above cover the full network.
            </div>
          )}

          <Card
            title={mode === 'Compare periods' ? 'Connectivity change' : 'Nautical routes'}
            subtitle={
              compare
                ? 'green = gained · grey = retained · red dashed = lost'
                : 'line thickness reflects how many services share the leg'
            }
          >
            {mapRoutes.length === 0 ? (
              <Empty msg="No route geometry for this selection." />
            ) : (
              <WorldMap
                routes={mapRoutes}
                points={mapPoints}
                height={mode === 'Service' ? 460 : 520}
                fit={mode === 'Service' ? 'data' : 'world'}
                emphasisPort={focusPort}
                legend={
                  compare
                    ? [
                        { color: '#10B981', label: 'Gained' },
                        { color: '#4A6082', label: 'Retained' },
                        { color: '#EF4444', label: 'Lost' },
                      ]
                    : undefined
                }
              />
            )}
          </Card>

          {compare && (compare.gained.length > 0 || compare.lost.length > 0) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card title="Gained legs" subtitle={`served now, not at ${prevDate}`}>
                {compare.gained.length === 0 ? <Empty msg="None." /> : (
                  <div className="overflow-auto max-h-[240px]">
                    <table className="w-full text-xs text-left">
                      <tbody>
                        {compare.gained.slice(0, 40).map(r => (
                          <tr key={r.route_id} className="border-b border-[#132852]">
                            <td className="py-1 pr-2 text-[#CBD5E1]">
                              {lookupMap.get(r.origin_port_code)?.name ?? r.origin_port_code}
                              <span className="text-[#4A6082]"> → </span>
                              {lookupMap.get(r.destination_port_code)?.name ?? r.destination_port_code}
                            </td>
                            <td className="py-1 text-right tabular-nums text-[#10B981]">
                              {fmt(r.route_distance_nm)} nm
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card title="Lost legs" subtitle={`served at ${prevDate}, not now`}>
                {compare.lost.length === 0 ? <Empty msg="None." /> : (
                  <div className="overflow-auto max-h-[240px]">
                    <table className="w-full text-xs text-left">
                      <tbody>
                        {compare.lost.slice(0, 40).map(r => (
                          <tr key={r.route_id} className="border-b border-[#132852]">
                            <td className="py-1 pr-2 text-[#CBD5E1]">
                              {lookupMap.get(r.origin_port_code)?.name ?? r.origin_port_code}
                              <span className="text-[#4A6082]"> → </span>
                              {lookupMap.get(r.destination_port_code)?.name ?? r.destination_port_code}
                            </td>
                            <td className="py-1 text-right tabular-nums text-red-400">
                              {fmt(r.route_distance_nm)} nm
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          <p className="text-[10px] text-[#3E5878] leading-relaxed">
            Geometry comes from the eeSea nautical routing table: {fmt(8649)} distinct port-pair
            paths, decimated to at most 48 vertices each for rendering. Trans-Pacific legs are cut at
            the 180° meridian so they draw the short way round — the same problem the Power BI report
            solves with its <em>IsGeodesic</em> flag.
            {compare && ' Comparison periods are quarter-end point-in-time snapshots; the most ' +
              'recent quarter understates slightly because forward validity windows are thin.'}
          </p>
        </>
      )}
    </div>
  )
}
