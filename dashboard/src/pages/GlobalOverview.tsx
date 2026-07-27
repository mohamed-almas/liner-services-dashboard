import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, ROUTE_COLORS, CustomTooltip, pivotByRouteType } from '../components/ui'

export default function GlobalOverview() {
  const [kpis, setKpis] = useState({ services: 0, countries: 0, ports: 0, liners: 0 })
  const [byYear, setByYear] = useState<Record<string, number>[]>([])
  const [callsByYear, setCallsByYear] = useState<{ year: number; proforma: number; actual: number; capacity: number }[]>([])
  const [topCountries, setTopCountries] = useState<{ country_code: string; active_services: number; port_count: number }[]>([])
  const [topLiners, setTopLiners] = useState<{ company_name: string; service_count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const [svRes, ctryRes, portRes, linerRes, byYearRes, callsRes, topCtryRes, topLinerRes] = await Promise.all([
          supabase.from('eesea_service_versions').select('*', { count: 'exact', head: true }).eq('service_version_validity_status', '0 : Currently active version'),
          supabase.from('mv_country_kpis_current').select('*', { count: 'exact', head: true }),
          supabase.from('mv_port_kpis_current').select('*', { count: 'exact', head: true }),
          supabase.from('mv_liner_by_year').select('company_code', { count: 'exact', head: true }).eq('year', 2025),
          supabase.from('mv_global_by_year').select('*').gte('year', 2019).lte('year', 2026).order('year'),
          supabase.from('mv_port_calls_by_year').select('year,proforma_calls,actual_calls,total_capacity_teu').gte('year', 2019).lte('year', 2028).order('year'),
          supabase.from('mv_country_kpis_current').select('country_code,active_services,port_count').order('active_services', { ascending: false }).limit(15),
          supabase.from('mv_liner_by_year').select('company_code,company_name,route_type,service_count').eq('year', 2025).order('service_count', { ascending: false }).limit(60),
        ])
        setKpis({
          services: svRes.count ?? 0,
          countries: ctryRes.count ?? 0,
          ports: portRes.count ?? 0,
          liners: linerRes.count ?? 0,
        })
        setByYear(pivotByRouteType((byYearRes.data ?? []) as { year: number; route_type: string; service_count: number }[]))

        // Aggregate calls by year
        const callMap = new Map<number, { proforma: number; actual: number; capacity: number }>()
        for (const r of callsRes.data ?? []) {
          const cur = callMap.get(r.year) ?? { proforma: 0, actual: 0, capacity: 0 }
          cur.proforma += r.proforma_calls ?? 0
          cur.actual += r.actual_calls ?? 0
          cur.capacity += r.total_capacity_teu ?? 0
          callMap.set(r.year, cur)
        }
        setCallsByYear(Array.from(callMap.entries()).map(([year, v]) => ({ year, ...v })).sort((a, b) => a.year - b.year))
        setTopCountries((topCtryRes.data ?? []) as typeof topCountries)

        // Aggregate top liners
        const lMap = new Map<string, { company_name: string; service_count: number }>()
        for (const r of topLinerRes.data ?? []) {
          const cur = lMap.get(r.company_code) ?? { company_name: r.company_name ?? r.company_code, service_count: 0 }
          cur.service_count += r.service_count ?? 0
          lMap.set(r.company_code, cur)
        }
        setTopLiners(Array.from(lMap.values()).sort((a, b) => b.service_count - a.service_count).slice(0, 15))
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <Spinner />
  if (error) return <ErrorMsg msg={error} />

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-white">Global Overview</h1>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Currently Active Services" value={kpis.services} accent />
        <KPICard label="No. of Countries" value={kpis.countries} />
        <KPICard label="No. of Ports" value={kpis.ports} />
        <KPICard label="Currently Active Liners" value={kpis.liners} />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Active Services Evolution">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byYear} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={40} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
              {Object.entries(ROUTE_COLORS).map(([rt, color]) => (
                <Bar key={rt} dataKey={rt} stackId="a" fill={color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Calls Capacity Evolution">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={callsByYear} margin={{ top: 5, right: 40, bottom: 0, left: 0 }}>
              <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: '#94A3B8', fontSize: 11 }} width={50} tickFormatter={v => (v / 1000).toFixed(0) + 'K'} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94A3B8', fontSize: 11 }} width={55} tickFormatter={v => (v / 1e9).toFixed(1) + 'B'} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
              <Bar yAxisId="left" dataKey="proforma" name="Proforma Calls" fill="#1E3A5F" />
              <Bar yAxisId="left" dataKey="actual" name="Actual Calls" fill="#00C2CB" />
              <Line yAxisId="right" dataKey="capacity" name="Capacity (TEU)" stroke="#FFD700" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Top Countries (by active services)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topCountries} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 30 }}>
              <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis type="category" dataKey="country_code" tick={{ fill: '#CBD5E1', fontSize: 11 }} width={36} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
              <Bar dataKey="active_services" name="Services" fill="#008B8B" />
              <Bar dataKey="port_count" name="Ports" fill="#4169E1" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Top Lines (2025, by services)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topLiners} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 70 }}>
              <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis type="category" dataKey="company_name" tick={{ fill: '#CBD5E1', fontSize: 10 }} width={70} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="service_count" name="Services" fill="#4682B4" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  )
}
