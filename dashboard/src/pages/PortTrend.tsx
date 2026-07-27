import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select, ROUTE_COLORS, CustomTooltip, pivotByRouteType } from '../components/ui'

export default function PortTrend() {
  const [ports, setPorts] = useState<{ value: string; label: string }[]>([])
  const [selectedPort, setSelectedPort] = useState('AEAUH')
  const [kpi, setKpi] = useState<{ active_services: number; lines_calling: number } | null>(null)
  const [byYear, setByYear] = useState<Record<string, number>[]>([])
  const [calls, setCalls] = useState<{ year: number; proforma_calls: number; actual_calls: number; total_capacity_teu: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('mv_port_kpis_current').select('port_code,port_name').order('port_name').limit(500)
      .then(({ data }) => {
        setPorts((data ?? []).map(p => ({ value: p.port_code, label: `${p.port_name} (${p.port_code})` })))
      })
  }, [])

  useEffect(() => {
    if (!selectedPort) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('mv_port_kpis_current').select('active_services,lines_calling').eq('port_code', selectedPort).single(),
      supabase.from('mv_port_by_year').select('*').eq('port_code', selectedPort).gte('year', 2019).lte('year', 2026).order('year'),
      supabase.from('mv_port_calls_by_year').select('*').eq('port_code', selectedPort).order('year'),
    ]).then(([kpiRes, byYearRes, callsRes]) => {
      setKpi(kpiRes.data)
      setByYear(pivotByRouteType((byYearRes.data ?? []) as { year: number; route_type: string; service_count: number }[]))
      setCalls((callsRes.data ?? []) as typeof calls)
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selectedPort])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">Port Trend</h1>
        <Select value={selectedPort} onChange={setSelectedPort} options={ports} placeholder="Select port..." />
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <KPICard label="Active Services" value={kpi?.active_services} accent />
            <KPICard label="Lines Calling" value={kpi?.lines_calling} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card title="No. of Services by Route">
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

            <Card title="Calls Capacity">
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={calls} margin={{ top: 5, right: 40, bottom: 0, left: 0 }}>
                  <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fill: '#94A3B8', fontSize: 11 }} width={40} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94A3B8', fontSize: 11 }} width={55} tickFormatter={v => (v / 1e6).toFixed(1) + 'M'} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="proforma_calls" name="Proforma" fill="#1E3A5F" />
                  <Bar yAxisId="left" dataKey="actual_calls" name="Actual" fill="#00C2CB" />
                  <Line yAxisId="right" dataKey="total_capacity_teu" name="Capacity (TEU)" stroke="#FFD700" dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
