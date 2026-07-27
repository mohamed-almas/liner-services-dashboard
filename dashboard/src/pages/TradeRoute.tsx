import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select, CustomTooltip } from '../components/ui'

const ROUTE_TYPES = ['East/West', 'North/South', 'Intra-Regional', 'Feeders']

export default function TradeRoute() {
  const [routeType, setRouteType] = useState('East/West')
  const [subRoutes, setSubRoutes] = useState<{ value: string; label: string }[]>([])
  const [subRoute, setSubRoute] = useState('')
  const [byYear, setByYear] = useState<{ year: number; service_count: number; total_capacity_teu: number }[]>([])
  const [topCountries, setTopCountries] = useState<{ country_code: string; service_count: number }[]>([])
  const [topPorts, setTopPorts] = useState<{ port_code: string; service_count: number }[]>([])
  const [kpi, setKpi] = useState({ services: 0, capacity: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('mv_trade_route_by_year').select('trade_lane_category,route_type').eq('route_type', routeType).limit(100)
      .then(({ data }) => {
        const unique = [...new Map((data ?? []).map(r => [r.trade_lane_category, r])).values()]
        setSubRoutes(unique.map(r => ({ value: r.trade_lane_category, label: r.trade_lane_category })))
        setSubRoute('')
      })
  }, [routeType])

  useEffect(() => {
    setLoading(true); setError('')
    const filter = subRoute || routeType
    const isSubRoute = !!subRoute
    Promise.all([
      supabase.from('mv_trade_route_by_year').select('year,service_count,total_capacity_teu')
        .eq(isSubRoute ? 'trade_lane_category' : 'route_type', filter)
        .gte('year', 2019).lte('year', 2026).order('year'),
      supabase.from('mv_country_by_year').select('country_code,service_count').eq('route_type', routeType).eq('year', 2025).order('service_count', { ascending: false }).limit(15),
      supabase.from('mv_port_by_year').select('port_code,service_count').eq('route_type', routeType).eq('year', 2025).order('service_count', { ascending: false }).limit(15),
    ]).then(([byYearRes, topCtryRes, topPortRes]) => {
      const rows = byYearRes.data ?? []
      // Aggregate by year (multiple sub-route rows per year possible)
      const map = new Map<number, { service_count: number; total_capacity_teu: number }>()
      for (const r of rows) {
        const cur = map.get(r.year) ?? { service_count: 0, total_capacity_teu: 0 }
        cur.service_count += r.service_count ?? 0
        cur.total_capacity_teu += r.total_capacity_teu ?? 0
        map.set(r.year, cur)
      }
      const agg = Array.from(map.entries()).map(([year, v]) => ({ year, ...v })).sort((a, b) => a.year - b.year)
      setByYear(agg)
      const cur2025 = agg.find(r => r.year === 2025)
      setKpi({ services: cur2025?.service_count ?? 0, capacity: cur2025?.total_capacity_teu ?? 0 })
      setTopCountries(topCtryRes.data ?? [])
      setTopPorts(topPortRes.data ?? [])
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [routeType, subRoute])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-white">Trade Route Overview</h1>
        <div className="flex gap-2">
          {ROUTE_TYPES.map(rt => (
            <button key={rt} onClick={() => setRouteType(rt)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${routeType === rt ? 'bg-[#00C2CB] border-[#00C2CB] text-black font-semibold' : 'border-[#1E3A5F] text-[#94A3B8] hover:text-white'}`}>
              {rt}
            </button>
          ))}
        </div>
        {subRoutes.length > 0 && <Select value={subRoute} onChange={setSubRoute} options={subRoutes} placeholder="All sub-routes" />}
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <KPICard label="Active Services (2025)" value={kpi.services} accent />
            <KPICard label="Total Capacity (TEU, 2025)" value={kpi.capacity ? (kpi.capacity / 1e6).toFixed(1) + 'M' : '—'} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Card title="Active Services Evolution">
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={byYear} margin={{ top: 5, right: 40, bottom: 0, left: 0 }}>
                  <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fill: '#94A3B8', fontSize: 11 }} width={40} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94A3B8', fontSize: 11 }} width={55} tickFormatter={v => (v / 1e9).toFixed(1) + 'B'} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="service_count" name="Services" fill="#008B8B" />
                  <Line yAxisId="right" dataKey="total_capacity_teu" name="Capacity (TEU)" stroke="#FFD700" dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
            <div className="grid gap-4">
              <Card title="Top Countries (2025)">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={topCountries} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 30 }}>
                    <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 10 }} />
                    <YAxis type="category" dataKey="country_code" tick={{ fill: '#CBD5E1', fontSize: 10 }} width={36} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="service_count" name="Services" fill="#4682B4" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card title="Top Ports (2025)">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={topPorts} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 45 }}>
                    <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 10 }} />
                    <YAxis type="category" dataKey="port_code" tick={{ fill: '#CBD5E1', fontSize: 10 }} width={45} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="service_count" name="Services" fill="#4169E1" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
