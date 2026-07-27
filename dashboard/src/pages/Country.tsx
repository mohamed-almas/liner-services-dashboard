import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select, ROUTE_COLORS, CustomTooltip, pivotByRouteType } from '../components/ui'

export default function Country() {
  const [countries, setCountries] = useState<{ value: string; label: string }[]>([])
  const [selected, setSelected] = useState('AE')
  const [kpi, setKpi] = useState<{ active_services: number; port_count: number; active_liners: number } | null>(null)
  const [byYear, setByYear] = useState<Record<string, number>[]>([])
  const [callsByYear, setCallsByYear] = useState<{ year: number; proforma: number; actual: number }[]>([])
  const [topCountries, setTopCountries] = useState<{ country_code: string; active_services: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('mv_country_kpis_current').select('country_code,active_services').order('country_code').limit(250)
      .then(({ data }) => setCountries((data ?? []).map(c => ({ value: c.country_code, label: c.country_code }))))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true); setError('')
    Promise.all([
      supabase.from('mv_country_kpis_current').select('*').eq('country_code', selected).single(),
      supabase.from('mv_country_by_year').select('*').eq('country_code', selected).gte('year', 2019).lte('year', 2026).order('year'),
      supabase.from('mv_port_kpis_current').select('port_code').eq('port_country_code', selected).limit(50),
      supabase.from('mv_country_kpis_current').select('country_code,active_services').order('active_services', { ascending: false }).limit(15),
    ]).then(async ([kpiRes, byYearRes, portsRes, topCtryRes]) => {
      setKpi(kpiRes.data)
      setByYear(pivotByRouteType((byYearRes.data ?? []) as { year: number; route_type: string; service_count: number }[]))
      setTopCountries(topCtryRes.data ?? [])

      const portCodes = (portsRes.data ?? []).map(p => p.port_code)
      if (portCodes.length > 0) {
        const { data } = await supabase.from('mv_port_calls_by_year')
          .select('year,proforma_calls,actual_calls')
          .in('port_code', portCodes)
          .gte('year', 2019).lte('year', 2026).order('year')
        const aggMap = new Map<number, { proforma: number; actual: number }>()
        for (const r of data ?? []) {
          const cur = aggMap.get(r.year) ?? { proforma: 0, actual: 0 }
          cur.proforma += r.proforma_calls ?? 0
          cur.actual += r.actual_calls ?? 0
          aggMap.set(r.year, cur)
        }
        setCallsByYear(Array.from(aggMap.entries()).map(([year, v]) => ({ year, ...v })).sort((a, b) => a.year - b.year))
      }
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selected])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">Country Overview</h1>
        <Select value={selected} onChange={setSelected} options={countries} placeholder="Select country..." />
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <KPICard label="Active Services" value={kpi?.active_services} accent />
            <KPICard label="No. of Ports" value={kpi?.port_count} />
            <KPICard label="Active Liners" value={kpi?.active_liners} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Card title="Active Services Evolution">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byYear} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={35} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {Object.entries(ROUTE_COLORS).map(([rt, color]) => (
                    <Bar key={rt} dataKey={rt} stackId="a" fill={color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Port Calls Evolution">
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={callsByYear} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={40} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="proforma" name="Proforma" fill="#1E3A5F" />
                  <Bar dataKey="actual" name="Actual" fill="#00C2CB" />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Top Countries (global)">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topCountries} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 30 }}>
                  <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis type="category" dataKey="country_code" tick={{ fill: '#CBD5E1', fontSize: 11 }} width={36} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="active_services" name="Services" fill="#008B8B" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
