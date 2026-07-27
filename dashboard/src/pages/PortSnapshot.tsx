import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select, CustomTooltip } from '../components/ui'

export default function PortSnapshot() {
  const [ports, setPorts] = useState<{ value: string; label: string }[]>([])
  const [selectedPort, setSelectedPort] = useState('AEJEA')
  const [kpi, setKpi] = useState<{ active_services: number; lines_calling: number; partner_countries: number; partner_ports: number } | null>(null)
  const [topCountries, setTopCountries] = useState<{ country_code: string; active_services: number; port_count: number }[]>([])
  const [services, setServices] = useState<{ service_master_name: string; alliance_code: string; service_version_port_count: number; service_version_roundtrip_days: number; service_version_slot_count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('mv_port_kpis_current').select('port_code,port_name').order('port_name').limit(500)
      .then(({ data }) => setPorts((data ?? []).map(p => ({ value: p.port_code, label: `${p.port_name} (${p.port_code})` }))))
  }, [])

  useEffect(() => {
    if (!selectedPort) return
    setLoading(true); setError('')
    Promise.all([
      supabase.from('mv_port_kpis_current').select('*').eq('port_code', selectedPort).single(),
      supabase.from('mv_country_kpis_current').select('country_code,active_services,port_count').order('active_services', { ascending: false }).limit(15),
      supabase.from('eesea_service_proformas').select('service_version_id').eq('port_code', selectedPort).eq('event_type', 'PORT_DEPARTURE').limit(200),
    ]).then(async ([kpiRes, ctryRes, spRes]) => {
      setKpi(kpiRes.data)
      setTopCountries(ctryRes.data ?? [])
      const vids = [...new Set((spRes.data ?? []).map(r => r.service_version_id))].slice(0, 50)
      if (vids.length > 0) {
        const { data } = await supabase.from('mv_service_overview')
          .select('service_master_name,alliance_code,service_version_port_count,service_version_roundtrip_days,service_version_slot_count')
          .eq('service_version_validity_status', '0 : Currently active version')
          .in('service_version_id', vids)
          .limit(30)
        setServices(data ?? [])
      }
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selectedPort])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">Port Snapshot</h1>
        <Select value={selectedPort} onChange={setSelectedPort} options={ports} placeholder="Select port..." />
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <KPICard label="Active Services" value={kpi?.active_services} accent />
            <KPICard label="Lines Calling" value={kpi?.lines_calling} />
            <KPICard label="Partner Countries" value={kpi?.partner_countries ?? '—'} />
            <KPICard label="Partner Ports" value={kpi?.partner_ports ?? '—'} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card title="Countries Connected (global ranking)">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topCountries} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 30 }}>
                  <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis type="category" dataKey="country_code" tick={{ fill: '#CBD5E1', fontSize: 11 }} width={36} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="active_services" name="Services" fill="#008B8B" />
                  <Bar dataKey="port_count" name="Ports" fill="#4169E1" />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Valid Services at Port">
              <div className="overflow-auto max-h-[300px]">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-[#94A3B8] border-b border-[#1E3A5F]">
                      <th className="pb-2 pr-3">Service</th>
                      <th className="pb-2 pr-3">Alliance</th>
                      <th className="pb-2 pr-3 text-right">Ports</th>
                      <th className="pb-2 pr-3 text-right">RT (days)</th>
                      <th className="pb-2 text-right">Vessels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((s, i) => (
                      <tr key={i} className="border-b border-[#132852] hover:bg-[#132852]">
                        <td className="py-1.5 pr-3 text-[#CBD5E1] max-w-[180px] truncate">{s.service_master_name}</td>
                        <td className="py-1.5 pr-3 text-[#00C2CB]">{s.alliance_code ?? '—'}</td>
                        <td className="py-1.5 pr-3 text-right">{s.service_version_port_count}</td>
                        <td className="py-1.5 pr-3 text-right">{s.service_version_roundtrip_days}</td>
                        <td className="py-1.5 text-right">{s.service_version_slot_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
