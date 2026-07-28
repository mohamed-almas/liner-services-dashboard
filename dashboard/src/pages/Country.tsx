import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, BarList,
  ROUTE_COLORS, ROUTE_ORDER, CustomTooltip, pivotByRoute, fmtTeu,
  MIN_YEAR, MAX_YEAR,
} from '../components/ui'

export default function Country() {
  const [country, setCountry] = useState('AE')

  const countries = useQuery(async () => {
    const res = await supabase.from('mv_country_current')
      .select('country_code,country_short_name,active_services')
      .gt('active_services', 0).order('country_short_name').limit(300)
    return unwrap(res) as { country_code: string; country_short_name: string; active_services: number }[]
  }, [])

  const q = useQuery(async () => {
    const [kpi, byYear, ports, topCountries] = await Promise.all([
      supabase.from('mv_country_current')
        .select('country_name,country_short_name,region,continent,region_un,subregion_un,income_group_wb,active_services,port_count,active_liners,service_capacity_teu,annual_capacity_teu')
        .eq('country_code', country).maybeSingle(),
      supabase.from('mv_country_year')
        .select('year,route_type,service_count,port_count')
        .eq('country_code', country).gte('year', MIN_YEAR).lte('year', MAX_YEAR).order('year'),
      supabase.from('mv_port_current')
        .select('port_code,port_name,active_services,lines_calling,service_capacity_teu')
        .eq('country_code', country).eq('is_chokepoint', false)
        .order('active_services', { ascending: false }).limit(20),
      supabase.from('mv_country_current')
        .select('country_code,country_short_name,active_services')
        .order('active_services', { ascending: false }).limit(12),
    ])
    return {
      kpi: kpi.data as Record<string, never> | null,
      byYear: unwrap(byYear) as { year: number; route_type: string; service_count: number }[],
      ports: unwrap(ports) as { port_code: string; port_name: string; active_services: number; lines_calling: number; service_capacity_teu: number }[],
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
        title="Country Overview"
        subtitle={k ? [k.subregion_un, k.continent, k.income_group_wb].filter(Boolean).join(' · ') : undefined}
      >
        <Select
          value={country} onChange={setCountry} placeholder=""
          options={(countries.data ?? []).map(c => ({
            value: c.country_code, label: `${c.country_short_name ?? c.country_code} (${c.country_code})`,
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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Active Services by Trade Route" subtitle="services calling during each year">
              {q.data.byYear.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={pivotByRoute(q.data.byYear)} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={38} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff08' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    {ROUTE_ORDER.map(rt => (
                      <Bar key={rt} dataKey={rt} stackId="a" fill={ROUTE_COLORS[rt]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title={`Ports in ${k?.country_short_name ?? country}`} subtitle="by active services">
              <BarList
                rows={q.data.ports.map(p => ({ label: p.port_name ?? p.port_code, value: p.active_services }))}
                color="#4169E1" maxRows={14}
              />
            </Card>
          </div>

          <Card title="Global Ranking" subtitle="top countries by active services">
            <BarList
              rows={q.data.topCountries.map(c => ({
                label: c.country_short_name ?? c.country_code, value: c.active_services,
              }))}
              color="#008B8B" maxRows={12}
            />
          </Card>
        </>
      )}
    </div>
  )
}
