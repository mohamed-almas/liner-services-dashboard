import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select, ROUTE_COLORS, CustomTooltip, pivotByRouteType } from '../components/ui'

export default function Liners() {
  const [liners, setLiners] = useState<{ value: string; label: string }[]>([])
  const [selected, setSelected] = useState('')
  const [byYear, setByYear] = useState<Record<string, number>[]>([])
  const [byRoute, setByRoute] = useState<{ route_type: string; service_count: number }[]>([])
  const [kpi, setKpi] = useState({ services: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('mv_liner_by_year').select('company_code,company_name').eq('year', 2025).limit(300)
      .then(({ data }) => {
        const unique = [...new Map((data ?? []).map(r => [r.company_code, r])).values()]
          .sort((a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? ''))
        setLiners(unique.map(r => ({ value: r.company_code, label: r.company_name ?? r.company_code })))
        if (unique.length > 0 && !selected) setSelected(unique[0].company_code)
      })
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true); setError('')
    Promise.all([
      supabase.from('mv_liner_by_year').select('*').eq('company_code', selected).gte('year', 2019).lte('year', 2026).order('year'),
      supabase.from('mv_liner_by_year').select('route_type,service_count').eq('company_code', selected).eq('year', 2025),
    ]).then(([byYearRes, byRouteRes]) => {
      setByYear(pivotByRouteType((byYearRes.data ?? []) as { year: number; route_type: string; service_count: number }[]))
      const routeAgg = new Map<string, number>()
      for (const r of byRouteRes.data ?? []) {
        routeAgg.set(r.route_type, (routeAgg.get(r.route_type) ?? 0) + (r.service_count ?? 0))
      }
      const routeData = Array.from(routeAgg.entries()).map(([route_type, service_count]) => ({ route_type, service_count }))
      setByRoute(routeData)
      setKpi({ services: routeData.reduce((s, r) => s + r.service_count, 0) })
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selected])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">Liner Overview</h1>
        <Select value={selected} onChange={setSelected} options={liners} placeholder="Select liner..." />
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <KPICard label="Currently Active Services" value={kpi.services} accent />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Card title="Active Services Evolution">
              <ResponsiveContainer width="100%" height={260}>
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

            <Card title="Capacity by Trade Route (2025)">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={byRoute} dataKey="service_count" nameKey="route_type" cx="50%" cy="50%" outerRadius={90} innerRadius={50} label={({ route_type, percent }) => `${route_type} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {byRoute.map((entry, i) => (
                      <Cell key={i} fill={ROUTE_COLORS[entry.route_type] ?? '#6B7280'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
