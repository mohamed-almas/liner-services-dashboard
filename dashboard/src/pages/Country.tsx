import { useState } from 'react'
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
import ExecutiveInsight from '../components/ExecutiveInsight'

export default function Country() {
  const { palette } = useTheme()
  const [country, setCountry] = useState('AE')

  // Full country name in the picker; charts use the short form.
  const countries = useQuery(async () => {
    const res = await supabase.from('mv_country_current')
      .select('country_code,country_name,country_short_name,active_services')
      .gt('active_services', 0).order('country_name').limit(300)
    return unwrap(res) as {
      country_code: string; country_name: string; country_short_name: string; active_services: number
    }[]
  }, [])

  const q = useQuery(async () => {
    const [kpi, byYear, ports, topCountries] = await Promise.all([
      supabase.from('mv_country_current')
        .select('country_name,country_short_name,region,continent,region_un,subregion_un,income_group_wb,active_services,port_count,active_liners,service_capacity_teu,annual_capacity_teu')
        .eq('country_code', country).maybeSingle(),
      supabase.from('mv_country_year')
        .select('year,route_type,service_count,port_count')
        .eq('country_code', country).gte('year', MIN_YEAR).lte('year', MAX_YEAR).order('year'),
      supabase.from('mv_port_map')
        .select('port_code,port_name,country_name,active_services,lines_calling,service_capacity_teu,lat,lon')
        .eq('country_code', country).eq('is_chokepoint', false)
        .order('active_services', { ascending: false }).limit(200),
      supabase.from('mv_country_current')
        .select('country_code,country_short_name,active_services')
        .order('active_services', { ascending: false }).limit(12),
    ])
    return {
      kpi: kpi.data as Record<string, never> | null,
      byYear: unwrap(byYear) as { year: number; route_type: string; service_count: number }[],
      ports: unwrap(ports) as {
        port_code: string; port_name: string; country_name: string
        active_services: number; lines_calling: number
        service_capacity_teu: number; lat: number; lon: number
      }[],
      topCountries: unwrap(topCountries) as { country_code: string; country_short_name: string; active_services: number }[],
    }
  }, [country], { skip: !country })

  const k = q.data?.kpi as {
    country_name?: string; country_short_name?: string; region?: string; continent?: string
    region_un?: string; subregion_un?: string; income_group_wb?: string
    active_services?: number; port_count?: number; active_liners?: number
    service_capacity_teu?: number; annual_capacity_teu?: number
  } | null | undefined

  return (
    <div className="space-y-5">
      <PageHeader
        title={k?.country_name ? `${k.country_name} — Country Overview` : 'Country Overview'}
        subtitle={k ? [k.subregion_un, k.continent, k.income_group_wb].filter(Boolean).join(' · ') : undefined}
      >
        <Select
          value={country} onChange={setCountry} placeholder=""
          options={(countries.data ?? []).map(c => ({
            value: c.country_code, label: c.country_name ?? c.country_short_name,
          }))}
        />
      </PageHeader>

      {q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !q.data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <KPICard label="Active Services" value={k?.active_services ?? 0} accent sub="as of today" />
            <KPICard label="Ports" value={k?.port_count ?? 0} sub="with berth calls" />
            <KPICard label="Active Liners" value={k?.active_liners ?? 0} />
            <KPICard label="Deployed Capacity" value={fmtTeu(k?.service_capacity_teu)} sub="TEU per rotation" />
            <KPICard label="Annual Capacity" value={fmtTeu(k?.annual_capacity_teu)} sub="TEU/yr" />
          </div>

          <ExecutiveInsight scope="country" scopeKey={country} entityLabel={k?.country_name ?? country}
                             kpis={k ?? {}} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Active Services by Trade Route" subtitle="services calling during each year">
              {q.data.byYear.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={270}>
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

            <Card title={`Ports in ${k?.country_name ?? country}`} subtitle="by active services">
              <BarList
                rows={q.data.ports.map(p => ({ label: p.port_name ?? p.port_code, value: p.active_services }))}
                color={ROUTE_COLORS['Feeders']} maxRows={14}
              />
            </Card>
          </div>

          <Card title="Port Locations"
                subtitle="bubble area scales with active services">
            {q.data.ports.length === 0 ? <Empty msg="No mapped ports." /> : (
              <WorldMap
                fit="data"
                height={380}
                showGraticule={false}
                points={q.data.ports.map(p => ({
                  lon: p.lon, lat: p.lat, label: p.port_name,
                  sublabel: `${fmt(p.active_services)} services · ${fmt(p.lines_calling)} lines · ${fmtTeu(p.service_capacity_teu)} TEU`,
                  value: p.active_services,
                }))}
              />
            )}
          </Card>

          <Card title="Global Ranking" subtitle="top countries by active services">
            <BarList
              rows={q.data.topCountries.map(c => ({
                label: c.country_short_name, value: c.active_services,
              }))}
              color={ROUTE_COLORS['East/West']} maxRows={12}
            />
          </Card>
        </>
      )}
    </div>
  )
}
