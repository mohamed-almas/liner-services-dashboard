import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select, ROUTE_COLORS, CustomTooltip, pivotByRouteType } from '../components/ui'

type VersionRow = {
  service_version_id: number
  service_master_name: string
  service_version_validity_status: string
  service_version_valid_from: string
  service_version_valid_to: string
  service_version_roundtrip_days: number
  service_version_port_count: number
  service_version_slot_count: number
  service_version_average_vessel_capacity_teu: number
  alliance_code: string
}

export default function ServiceEvolution() {
  const [services, setServices] = useState<{ value: string; label: string }[]>([])
  const [selectedMaster, setSelectedMaster] = useState('')
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [byYearData, setByYearData] = useState<Record<string, number>[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Load unique master service names
  useEffect(() => {
    supabase.from('mv_service_overview')
      .select('service_master_id,service_master_name,service_master_name_incl_trade_lane')
      .order('service_master_name').limit(500)
      .then(({ data }) => {
        const unique = [...new Map((data ?? []).map(r => [r.service_master_id, r])).values()]
        setServices(unique.map(s => ({ value: String(s.service_master_id), label: s.service_master_name_incl_trade_lane ?? s.service_master_name })))
        if (unique.length > 0 && !selectedMaster) setSelectedMaster(String(unique[0].service_master_id))
      })
  }, [])

  useEffect(() => {
    if (!selectedMaster) return
    setLoading(true); setError('')
    Promise.all([
      supabase.from('mv_service_overview').select('*').eq('service_master_id', Number(selectedMaster)).order('service_version_valid_from', { ascending: false }),
      supabase.from('mv_liner_by_year').select('year,route_type,service_count')
        .eq('company_code', '__ALL__').gte('year', 2017).lte('year', 2026),
    ]).then(([versRes]) => {
      setVersions(versRes.data ?? [])
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selectedMaster])

  // Build evolution table: one row per version, key columns
  const kpiCurrent = versions.find(v => v.service_version_validity_status?.startsWith('0'))
  const historicalCount = versions.filter(v => !v.service_version_validity_status?.startsWith('0')).length

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">Service Evolution</h1>
        <div className="flex-1 max-w-md">
          <Select value={selectedMaster} onChange={setSelectedMaster} options={services} placeholder="Select service..." />
        </div>
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : versions.length === 0 ? (
        <p className="text-[#94A3B8]">No versions found for this service.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <KPICard label="Current Round Trip (days)" value={kpiCurrent?.service_version_roundtrip_days ?? '—'} accent />
            <KPICard label="Current Port Count" value={kpiCurrent?.service_version_port_count ?? '—'} />
            <KPICard label="Current Vessels" value={kpiCurrent?.service_version_slot_count ?? '—'} />
            <KPICard label="Historical Versions" value={historicalCount} />
          </div>

          <Card title="Version History">
            <div className="overflow-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-[#94A3B8] border-b border-[#1E3A5F]">
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Valid From</th>
                    <th className="pb-2 pr-3">Valid To</th>
                    <th className="pb-2 pr-3 text-right">RT (days)</th>
                    <th className="pb-2 pr-3 text-right">Ports</th>
                    <th className="pb-2 pr-3 text-right">Vessels</th>
                    <th className="pb-2 pr-3 text-right">Avg TEU</th>
                    <th className="pb-2 text-right">Alliance</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v, i) => {
                    const isCurrent = v.service_version_validity_status?.startsWith('0')
                    return (
                      <tr key={i} className={`border-b border-[#132852] hover:bg-[#132852] ${isCurrent ? 'text-[#00C2CB]' : 'text-[#CBD5E1]'}`}>
                        <td className="py-1.5 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${isCurrent ? 'bg-[#00C2CB20] text-[#00C2CB]' : 'bg-[#1E3A5F] text-[#94A3B8]'}`}>
                            {isCurrent ? 'ACTIVE' : 'HISTORICAL'}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3">{v.service_version_valid_from?.slice(0, 10) ?? '—'}</td>
                        <td className="py-1.5 pr-3">{v.service_version_valid_to?.slice(0, 10) ?? '—'}</td>
                        <td className="py-1.5 pr-3 text-right">{v.service_version_roundtrip_days ?? '—'}</td>
                        <td className="py-1.5 pr-3 text-right">{v.service_version_port_count ?? '—'}</td>
                        <td className="py-1.5 pr-3 text-right">{v.service_version_slot_count ?? '—'}</td>
                        <td className="py-1.5 pr-3 text-right">{v.service_version_average_vessel_capacity_teu?.toLocaleString() ?? '—'}</td>
                        <td className="py-1.5 text-right">{v.alliance_code ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
