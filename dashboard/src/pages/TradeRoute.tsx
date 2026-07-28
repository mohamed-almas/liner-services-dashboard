import { useState, useEffect } from 'react'
import { XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar, Line } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import { useTheme } from '../lib/theme'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, Tabs, BarList,
  ROUTE_COLORS, CustomTooltip, fmtTeu, fmt, MIN_YEAR, MAX_YEAR,
} from '../components/ui'

const ROUTE_1 = ['East/West', 'North/South', 'Intra-Regional', 'Feeders']

export default function TradeRoute() {
  const { palette } = useTheme()
  const [route1, setRoute1] = useState('East/West')
  const [route2, setRoute2] = useState('')   // '' = all
  const [route3, setRoute3] = useState('')   // '' = all

  // Sub-route options from the 13-row classification tree
  const subs = useQuery(async () => {
    const res = await supabase.from('v_trade_route_tree')
      .select('trade_route_2,trade_route_3').eq('trade_route_1', route1)
    const rows = unwrap(res) as { trade_route_2: string; trade_route_3: string }[]
    return {
      level2: Array.from(new Set(rows.map(r => r.trade_route_2).filter(Boolean))).sort(),
      pairs: rows,
    }
  }, [route1])

  // Reset the deeper levels whenever level 1 changes
  useEffect(() => { setRoute2(''); setRoute3('') }, [route1])
  useEffect(() => { setRoute3('') }, [route2])

  const level3 = Array.from(new Set(
    (subs.data?.pairs ?? [])
      .filter(r => !route2 || r.trade_route_2 === route2)
      .map(r => r.trade_route_3).filter(Boolean)
  )).sort()

  const q = useQuery(async () => {
    let sel = supabase.from('mv_trade_route_year')
      .select('year,trade_route_2,trade_route_3,service_count,service_capacity_teu,annual_capacity_teu,vessels_deployed,avg_speed_kn,avg_ports_per_service')
      .eq('trade_route_1', route1)
      .gte('year', MIN_YEAR).lte('year', MAX_YEAR)
    if (route2) sel = sel.eq('trade_route_2', route2)
    if (route3) sel = sel.eq('trade_route_3', route3)

    const [series, topCountries, topPorts] = await Promise.all([
      sel.order('year'),
      supabase.from('mv_country_year')
        .select('country_code,country_short_name,service_count')
        .eq('route_type', route1).eq('year', MAX_YEAR - 1)
        .order('service_count', { ascending: false }).limit(14),
      supabase.from('mv_port_year')
        .select('port_code,port_name,service_count')
        .eq('route_type', route1).eq('year', MAX_YEAR - 1)
        .order('service_count', { ascending: false }).limit(14),
    ])

    const rows = unwrap(series) as {
      year: number; service_count: number; service_capacity_teu: number
      annual_capacity_teu: number; vessels_deployed: number
      avg_speed_kn: number; avg_ports_per_service: number
    }[]

    // Roll up across the sub-route rows that survived the filters
    const byYear = Array.from(rows.reduce((m, r) => {
      const cur = m.get(r.year) ?? { year: r.year, services: 0, capacity: 0, annual: 0, vessels: 0 }
      cur.services += r.service_count ?? 0
      cur.capacity += r.service_capacity_teu ?? 0
      cur.annual   += r.annual_capacity_teu ?? 0
      cur.vessels  += r.vessels_deployed ?? 0
      m.set(r.year, cur)
      return m
    }, new Map<number, { year: number; services: number; capacity: number; annual: number; vessels: number }>()).values())
      .sort((a, b) => a.year - b.year)

    const latest = byYear.find(r => r.year === MAX_YEAR - 1)
    const speedRows = rows.filter(r => r.year === MAX_YEAR - 1 && r.avg_speed_kn)
    return {
      byYear, latest,
      avgSpeed: speedRows.length ? speedRows.reduce((s, r) => s + r.avg_speed_kn, 0) / speedRows.length : null,
      avgPorts: speedRows.length ? speedRows.reduce((s, r) => s + (r.avg_ports_per_service ?? 0), 0) / speedRows.length : null,
      topCountries: unwrap(topCountries) as { country_code: string; country_short_name: string; service_count: number }[],
      topPorts: unwrap(topPorts) as { port_code: string; port_name: string; service_count: number }[],
    }
  }, [route1, route2, route3])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trade Route Overview"
        subtitle={[route1, route2, route3].filter(Boolean).join(' › ')}
      >
        <Tabs value={route1} onChange={setRoute1} options={ROUTE_1} />
      </PageHeader>

      <div className="flex gap-3 flex-wrap">
        {(subs.data?.level2.length ?? 0) > 1 && (
          <Select value={route2} onChange={setRoute2} placeholder="All sub-routes"
                  options={(subs.data?.level2 ?? []).map(v => ({ value: v, label: v }))} />
        )}
        {level3.length > 1 && (
          <Select value={route3} onChange={setRoute3} placeholder="All lanes"
                  options={level3.map(v => ({ value: v, label: v }))} />
        )}
      </div>

      {q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !q.data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <KPICard label={`Services (${MAX_YEAR - 1})`} value={q.data.latest?.services ?? 0} accent sub="calling during year" />
            <KPICard label="Deployed Capacity" value={fmtTeu(q.data.latest?.capacity)} sub="TEU per rotation" />
            <KPICard label="Annual Capacity" value={fmtTeu(q.data.latest?.annual)} sub="TEU/yr" />
            <KPICard label="Vessels Deployed" value={fmt(q.data.latest?.vessels)} />
            <KPICard label="Avg Speed" value={q.data.avgSpeed ? q.data.avgSpeed.toFixed(1) + ' kn' : '—'}
                     sub="port-arrival basis" />
          </div>

          <Card title="Services & Capacity Evolution" subtitle="capacity from VSA proforma allocations">
            {q.data.byYear.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={q.data.byYear} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <XAxis dataKey="year" tick={{ fill: palette.axis, fontSize: 11 }} axisLine={{ stroke: palette.grid }} tickLine={false} />
                  <YAxis yAxisId="l" tick={{ fill: palette.axis, fontSize: 11 }} width={42} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fill: palette.axis, fontSize: 11 }} width={46}
                         axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: palette.grid, fillOpacity: 0.25 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                  <Bar yAxisId="l" dataKey="services" name="Services" fill={ROUTE_COLORS['East/West']} radius={[2, 2, 0, 0]} />
                  <Line yAxisId="r" dataKey="capacity" name="Capacity (TEU)" stroke="#D9A400" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Top Countries" subtitle={`on ${route1} routes, ${MAX_YEAR - 1}`}>
              <BarList rows={q.data.topCountries.map(c => ({ label: c.country_short_name, value: c.service_count }))}
                       color={ROUTE_COLORS['Intra-Regional']} maxRows={14} />
            </Card>
            <Card title="Top Ports" subtitle={`on ${route1} routes, ${MAX_YEAR - 1}`}>
              <BarList rows={q.data.topPorts.map(p => ({ label: p.port_name ?? p.port_code, value: p.service_count }))}
                       color={ROUTE_COLORS['Feeders']} maxRows={14} />
            </Card>
          </div>

          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--faint)' }}>
            Route hierarchy follows the eeSea trade-lane classification: level 1 (East/West,
            North/South, Intra-Regional, Feeders) › level 2 (E/W Primary vs Secondary) › level 3
            (individual lanes such as E/W FE_NAM). Distance and speed use{' '}
            <span style={{ color: 'var(--dim)' }}>PORT_ARRIVAL</span> events, which include chokepoint
            transits since those are part of the route.
          </p>
        </>
      )}
    </div>
  )
}
