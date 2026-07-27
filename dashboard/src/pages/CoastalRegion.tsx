import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select, ROUTE_COLORS, CustomTooltip, pivotByRouteType } from '../components/ui'

export default function CoastalRegion() {
  const [regions, setRegions] = useState<{ value: string; label: string }[]>([])
  const [selected, setSelected] = useState('')
  const [byYear, setByYear] = useState<Record<string, number>[]>([])
  const [kpi, setKpi] = useState({ services: 0, ports: 0, countries: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('mv_coastal_region_by_year').select('coastal_region_code,coastal_region_name').order('coastal_region_name').limit(200)
      .then(({ data }) => {
        const unique = [...new Map((data ?? []).map(r => [r.coastal_region_code, r])).values()]
        setRegions(unique.map(r => ({ value: r.coastal_region_code, label: r.coastal_region_name ?? r.coastal_region_code })))
        if (unique.length > 0 && !selected) setSelected(unique[0].coastal_region_code)
      })
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true); setError('')
    Promise.all([
      supabase.from('mv_coastal_region_by_year').select('*').eq('coastal_region_code', selected).gte('year', 2019).lte('year', 2026).order('year'),
      supabase.from('mv_port_kpis_current').select('port_code,port_country_code').eq('coastal_region_code', selected).limit(200),
    ]).then(([byYearRes, portsRes]) => {
      setByYear(pivotByRouteType((byYearRes.data ?? []) as { year: number; route_type: string; service_count: number }[]))
      const ports = portsRes.data ?? []
      const countries = new Set(ports.map(p => p.port_country_code)).size
      setKpi({ services: (byYearRes.data ?? []).filter(r => r.year === 2025).reduce((s, r) => s + (r.service_count ?? 0), 0), ports: ports.length, countries })
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selected])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">Coastal Region Overview</h1>
        <Select value={selected} onChange={setSelected} options={regions} placeholder="Select region..." />
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <KPICard label="Currently Active Services" value={kpi.services} accent />
            <KPICard label="No. of Countries" value={kpi.countries} />
            <KPICard label="No. of Ports" value={kpi.ports} />
          </div>
          <Card title="Active Services Evolution">
            <ResponsiveContainer width="100%" height={280}>
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
        </>
      )}
    </div>
  )
}
