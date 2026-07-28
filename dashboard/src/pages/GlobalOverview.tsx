import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, PageHeader, BarList,
  ROUTE_COLORS, ROUTE_ORDER, CustomTooltip, pivotByRoute, fmtTeu, fmt,
  MIN_YEAR, MAX_YEAR,
} from '../components/ui'

export default function GlobalOverview() {
  const q = useQuery(async () => {
    const [kpi, byYear, topCountries, topLiners, topPorts] = await Promise.all([
      // Aggregated server-side. PostgREST caps responses at 1000 rows, so summing
      // mv_service_base in the client silently truncated services and capacity.
      supabase.from('mv_global_current').select('*').maybeSingle(),
      supabase.from('mv_global_year')
        .select('year,route_type,service_count,service_capacity_teu')
        .gte('year', MIN_YEAR).lte('year', MAX_YEAR).order('year'),
      supabase.from('mv_country_current')
        .select('country_code,country_short_name,active_services,port_count')
        .order('active_services', { ascending: false }).limit(12),
      supabase.from('mv_liner_current')
        .select('company_name,active_services,vsa_capacity_teu')
        .order('vsa_capacity_teu', { ascending: false, nullsFirst: false }).limit(12),
      supabase.from('mv_port_current')
        .select('port_code,port_name,active_services')
        .eq('is_chokepoint', false)
        .order('active_services', { ascending: false }).limit(12),
    ])

    const k = kpi.data as {
      active_services: number; service_capacity_teu: number; annual_capacity_teu: number
      vessels_deployed: number; countries: number; ports: number; liners: number
    } | null

    return {
      services: k?.active_services ?? 0,
      capacity: k?.service_capacity_teu ?? 0,
      annualCapacity: k?.annual_capacity_teu ?? 0,
      vessels: k?.vessels_deployed ?? 0,
      ports: k?.ports ?? 0,
      countries: k?.countries ?? 0,
      liners: k?.liners ?? 0,
      byYear: unwrap(byYear) as { year: number; route_type: string; service_count: number; service_capacity_teu: number }[],
      topCountries: unwrap(topCountries) as { country_code: string; country_short_name: string; active_services: number; port_count: number }[],
      topLiners: unwrap(topLiners) as { company_name: string; active_services: number; vsa_capacity_teu: number }[],
      topPorts: unwrap(topPorts) as { port_code: string; port_name: string; active_services: number }[],
    }
  }, [])

  if (q.loading) return <Spinner />
  if (q.error) return <ErrorMsg msg={q.error} />
  if (!q.data) return null
  const d = q.data

  const servicesByYear = pivotByRoute(d.byYear)
  const capacityByYear = Array.from(
    d.byYear.reduce((m, r) => {
      const cur = m.get(r.year) ?? { year: r.year, services: 0, capacity: 0 }
      cur.services += r.service_count ?? 0
      cur.capacity += r.service_capacity_teu ?? 0
      m.set(r.year, cur)
      return m
    }, new Map<number, { year: number; services: number; capacity: number }>()).values()
  ).sort((a, b) => a.year - b.year)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Global Overview"
        subtitle="Currently active services · berth-arrival basis, chokepoints excluded"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPICard label="Active Services" value={d.services} accent sub="distinct master names" />
        <KPICard label="Countries" value={d.countries} />
        <KPICard label="Ports" value={d.ports} sub="excl. 5 chokepoints" />
        <KPICard label="Active Liners" value={d.liners} />
        <KPICard label="Deployed Capacity" value={fmtTeu(d.capacity)} sub="TEU per rotation" />
        <KPICard label="Annual Capacity" value={fmtTeu(d.annualCapacity)} sub="TEU/yr" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Active Services by Trade Route" subtitle="services calling during each year">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={servicesByYear} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
              <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={42} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff08' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
              {ROUTE_ORDER.map(rt => (
                <Bar key={rt} dataKey={rt} stackId="a" fill={ROUTE_COLORS[rt]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Services vs Deployed Capacity" subtitle="capacity from VSA proforma allocations">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={capacityByYear} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fill: '#94A3B8', fontSize: 11 }} width={42} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: '#94A3B8', fontSize: 11 }} width={46}
                     axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff08' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
              <Bar yAxisId="l" dataKey="services" name="Services" fill="#1E4E6B" radius={[2, 2, 0, 0]} />
              <Line yAxisId="r" dataKey="capacity" name="Capacity (TEU)" stroke="#FFD700" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top Countries" subtitle="by active services">
          <BarList
            rows={d.topCountries.map(c => ({
              label: c.country_short_name ?? c.country_code,
              value: c.active_services,
            }))}
            color="#008B8B"
          />
        </Card>

        <Card title="Top Ports" subtitle="by active services, berth arrivals">
          <BarList
            rows={d.topPorts.map(p => ({ label: p.port_name ?? p.port_code, value: p.active_services }))}
            color="#4169E1"
          />
        </Card>

        <Card title="Top Liners" subtitle="by own VSA-weighted capacity">
          <BarList
            rows={d.topLiners.map(l => ({ label: l.company_name, value: l.vsa_capacity_teu ?? 0 }))}
            valueFormat={fmtTeu}
            color="#4682B4"
          />
        </Card>
      </div>

      <p className="text-[10px] text-[#3E5878] leading-relaxed">
        Services counted as distinct master names, matching the Power BI measure. Port and country
        figures use <span className="text-[#5A7196]">BERTH_ARRIVAL</span> events, which structurally
        excludes the five chokepoints (Suez, Panama, Canakkale, Cape of Good Hope, Cape Horn).
        Annual charts show services calling at any point in the year, so they read higher than the
        point-in-time KPIs above. {fmt(MAX_YEAR)} is partial.
      </p>
    </div>
  )
}
