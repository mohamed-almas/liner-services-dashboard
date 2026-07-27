import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select } from '../components/ui'

export default function PortConnectivity() {
  const [ports, setPorts] = useState<{ value: string; label: string }[]>([])
  const [selectedPort, setSelectedPort] = useState('AEAUH')
  const [prevMonths, setPrevMonths] = useState(60)
  const [current, setCurrent] = useState<{ active_services: number; lines_calling: number; port_name: string } | null>(null)
  const [historical, setHistorical] = useState<{ year: number; service_count: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('mv_port_kpis_current').select('port_code,port_name').order('port_name').limit(500)
      .then(({ data }) => setPorts((data ?? []).map(p => ({ value: p.port_code, label: `${p.port_name} (${p.port_code})` }))))
  }, [])

  useEffect(() => {
    if (!selectedPort) return
    setLoading(true); setError('')
    const histYear = new Date().getFullYear() - Math.floor(prevMonths / 12)
    Promise.all([
      supabase.from('mv_port_kpis_current').select('active_services,lines_calling,port_name').eq('port_code', selectedPort).single(),
      supabase.from('mv_port_by_year').select('year,service_count:service_count.sum()').eq('port_code', selectedPort).eq('year', histYear).single(),
    ]).then(([curRes, histRes]) => {
      setCurrent(curRes.data)
      setHistorical(histRes.data ? { year: histYear, service_count: histRes.data.service_count ?? 0 } : { year: histYear, service_count: 0 })
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selectedPort, prevMonths])

  const delta = (current?.active_services ?? 0) - (historical?.service_count ?? 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-white">Port Connectivity Evolution</h1>
        <Select value={selectedPort} onChange={setSelectedPort} options={ports} placeholder="Select port..." />
        <label className="flex items-center gap-2 text-sm text-[#94A3B8]">
          Previous months:
          <input
            type="number" value={prevMonths} min={1} max={120}
            onChange={e => setPrevMonths(Number(e.target.value))}
            className="w-16 bg-[#0F2040] border border-[#1E3A5F] text-white text-sm rounded px-2 py-1"
          />
        </label>
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : (
        <div className="grid grid-cols-2 gap-6">
          <Card title={`Current — ${current?.port_name ?? selectedPort}`}>
            <div className="grid grid-cols-2 gap-3">
              <KPICard label="Active Services" value={current?.active_services} accent />
              <KPICard label="Lines Calling" value={current?.lines_calling} />
            </div>
          </Card>

          <Card title={`${prevMonths} months ago (${historical?.year})`}>
            <div className="grid grid-cols-2 gap-3">
              <KPICard label="Services (approx)" value={historical?.service_count} />
              <KPICard label="Change vs. current" value={
                <span className={delta >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
                </span>
              } />
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
