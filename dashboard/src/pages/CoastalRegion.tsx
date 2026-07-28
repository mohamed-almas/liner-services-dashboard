import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import { useTheme } from '../lib/theme'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, BarList,
  ROUTE_COLORS, ROUTE_ORDER, CustomTooltip, pivotByRoute, fmtTeu, fmt,
  MIN_YEAR, MAX_YEAR,
} from '../components/ui'
import WorldMap from '../components/WorldMap'

export default function CoastalRegion() {
  const { palette } = useTheme()
  const [region, setRegion] = useState('')

  const regions = useQuery(async () => {
    const res = await supabase.from('mv_coastal_year_total')
      .select('coastal_region').eq('year', MAX_YEAR - 1).order('coastal_region')
    const rows = unwrap(res) as { coastal_region: string }[]
    return Array.from(new Set(rows.map(r => r.coastal_region).filter(Boolean))).sort()
  }, [])

  // Default to the first region once the list arrives
  useEffect(() => {
    if (!region && regions.data?.length) setRegion(regions.data[0])
  }, [regions.data, region])

  const q = useQuery(async () => {
    const [byYear, ports, allRegions] = await Promise.all([
      supabase.from('mv_coastal_year')
        .select('year,route_type,service_count,port_count,country_count')
        .eq('coastal_region', region).gte('year', MIN_YEAR).lte('year', MAX_YEAR).order('year'),
      supabase.from('mv_port_map')
        .select('port_code,port_name,country_name,active_services,lines_calling,service_capacity_teu,lat,lon')
        .eq('coastal_region', region).eq('is_chokepoint', false)
        .order('active_services', { ascending: false }).limit(300),
      // Distinct totals per region-year, pre-aggregated: summing the per-route
      // rows would double-count services that span multiple trade lanes.
      supabase.from('mv_coastal_year_total')
        .select('coastal_region,service_count,port_count,country_count')
        .eq('year', MAX_YEAR - 1).order('service_count', { ascending: false }),
    ])

    const rows = unwrap(byYear) as { year: number; route_type: string; service_count: number; port_count: number; country_count: number }[]
    const totals = unwrap(allRegions) as {
      coastal_region: string; service_count: number; port_count: number; country_count: number
    }[]
    const mine = totals.find(t => t.coastal_region === region)

    return {
      byYear: rows,
      ports: unwrap(ports) as {
        port_code: string; port_name: string; country_name: string
        active_services: number; lines_calling: number
        service_capacity_teu: number; lat: number; lon: number
      }[],
      ranking: totals.map(t => ({ label: t.coastal_region, value: t.service_count })),
      services: mine?.service_count ?? 0,
      countries: mine?.country_count ?? 0,
    }
  }, [region], { skip: !region })

  const capacity = q.data?.ports.reduce((s, p) => s + (p.service_capacity_teu ?? 0), 0) ?? 0

  return (
    <div className="space-y-5">
      <PageHeader title="Coastal Region Overview" subtitle={region || undefined}>
        <Select
          value={region} onChange={setRegion} placeholder="Select region..."
          options={(regions.data ?? []).map(r => ({ value: r, label: r }))}
        />
      </PageHeader>

      {regions.loading || q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !q.data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label={`Services (${MAX_YEAR - 1})`} value={q.data.services} accent sub="calling during year" />
            <KPICard label="Countries" value={q.data.countries} />
            <KPICard label="Ports" value={q.data.ports.length} sub="with berth calls" />
            <KPICard label="Deployed Capacity" value={fmtTeu(capacity)} sub="TEU across region ports" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Active Services by Trade Route" subtitle="services calling during each year">
              {q.data.byYear.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={pivotByRoute(q.data.byYear)} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="year" tick={{ fill: palette.axis, fontSize: 11 }} axisLine={{ stroke: palette.grid }} tickLine={false} />
                    <YAxis tick={{ fill: palette.axis, fontSize: 11 }} width={38} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: palette.grid, fillOpacity: 0.25 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    {ROUTE_ORDER.map(rt => (
                      <Bar key={rt} dataKey={rt} stackId="a" fill={ROUTE_COLORS[rt]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Ports in Region" subtitle="by active services">
              <BarList
                rows={q.data.ports.map(p => ({ label: p.port_name ?? p.port_code, value: p.active_services }))}
                color={ROUTE_COLORS['Feeders']} maxRows={14}
              />
            </Card>
          </div>

          <Card title="Port Locations" subtitle="bubble area scales with active services">
            {q.data.ports.length === 0 ? <Empty msg="No mapped ports." /> : (
              <WorldMap
                fit="data"
                height={400}
                showGraticule={false}
                points={q.data.ports.map(p => ({
                  lon: p.lon, lat: p.lat, label: p.port_name,
                  sublabel: `${p.country_name} · ${fmt(p.active_services)} services · ${fmtTeu(p.service_capacity_teu)} TEU`,
                  value: p.active_services,
                }))}
              />
            )}
          </Card>

          <Card title="All Coastal Regions" subtitle={`ranked by services calling in ${MAX_YEAR - 1}`}>
            <BarList rows={q.data.ranking} color={ROUTE_COLORS['Intra-Regional']} maxRows={16} />
          </Card>
        </>
      )}
    </div>
  )
}
