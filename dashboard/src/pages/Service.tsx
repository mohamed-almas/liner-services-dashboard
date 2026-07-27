import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { KPICard, Card, Spinner, ErrorMsg, Select } from '../components/ui'

type ServiceOverview = {
  service_version_id: number
  service_master_name: string
  service_master_name_incl_trade_lane: string
  alliance_code: string
  service_version_roundtrip_days: number
  service_version_frequency_days: number
  service_version_port_count: number
  service_version_call_count: number
  service_version_slot_count: number
  service_version_average_vessel_capacity_teu: number
  service_version_rotation_by_names: string
}

type Proforma = {
  port_name: string
  service_call_order: number
  proforma_distance_to_next_nm: number
  proforma_speed_to_next_kn: number
  proforma_days_to_next: number
  port_stay_proforma_days: number
}

type VSA = {
  company_code: string
  vsa_role: string
  vsa_percentage: number
  company_name?: string
}

export default function Service() {
  const [services, setServices] = useState<{ value: string; label: string }[]>([])
  const [selected, setSelected] = useState('')
  const [svc, setSvc] = useState<ServiceOverview | null>(null)
  const [proformas, setProformas] = useState<Proforma[]>([])
  const [vsas, setVsas] = useState<VSA[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('mv_service_overview').select('service_version_id,service_master_name_incl_trade_lane,service_master_name')
      .eq('service_version_validity_status', '0 : Currently active version')
      .order('service_master_name').limit(500)
      .then(({ data }) => {
        setServices((data ?? []).map(s => ({ value: String(s.service_version_id), label: s.service_master_name_incl_trade_lane ?? s.service_master_name })))
        if (data?.length && !selected) setSelected(String(data[0].service_version_id))
      })
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true); setError('')
    const vid = Number(selected)
    Promise.all([
      supabase.from('mv_service_overview').select('*').eq('service_version_id', vid).single(),
      supabase.from('eesea_service_proformas')
        .select('port_name,service_call_order,proforma_distance_to_next_nm,proforma_speed_to_next_kn,proforma_days_to_next,port_stay_proforma_days')
        .eq('service_version_id', vid).eq('event_type', 'PORT_DEPARTURE').order('service_call_order'),
      supabase.from('eesea_vsa').select('company_code,vsa_role,vsa_percentage').eq('service_version_id', vid),
    ]).then(async ([svcRes, pfRes, vsaRes]) => {
      setSvc(svcRes.data)
      setProformas(pfRes.data ?? [])
      const vsaRows = vsaRes.data ?? []
      const codes = vsaRows.map(v => v.company_code)
      if (codes.length > 0) {
        const { data: companies } = await supabase.from('eesea_companies').select('company_code,company_name').in('company_code', codes)
        const cMap = new Map((companies ?? []).map(c => [c.company_code, c.company_name]))
        setVsas(vsaRows.map(v => ({ ...v, company_name: cMap.get(v.company_code) ?? v.company_code })))
      } else setVsas([])
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selected])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">Service Overview</h1>
        <div className="flex-1 max-w-md">
          <Select value={selected} onChange={setSelected} options={services} placeholder="Select service..." />
        </div>
      </div>

      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : svc && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <KPICard label="Round Trip (days)" value={svc.service_version_roundtrip_days} accent />
            <KPICard label="Frequency (days)" value={svc.service_version_frequency_days} />
            <KPICard label="Ports" value={svc.service_version_port_count} />
            <KPICard label="Port Calls / RT" value={svc.service_version_call_count} />
            <KPICard label="Vessels Deployed" value={svc.service_version_slot_count} />
            <KPICard label="Avg Vessel (TEU)" value={svc.service_version_average_vessel_capacity_teu?.toLocaleString()} />
            <KPICard label="Alliance" value={svc.alliance_code ?? '—'} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card title="Port Sequence (Proforma)">
              <div className="overflow-auto max-h-[380px]">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-[#94A3B8] border-b border-[#1E3A5F] sticky top-0 bg-[#0F2040]">
                      <th className="pb-2 pr-2">#</th>
                      <th className="pb-2 pr-2">Port</th>
                      <th className="pb-2 pr-2 text-right">Dist (nm)</th>
                      <th className="pb-2 pr-2 text-right">Speed (kn)</th>
                      <th className="pb-2 pr-2 text-right">Days</th>
                      <th className="pb-2 text-right">Stay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proformas.map((p, i) => (
                      <tr key={i} className="border-b border-[#132852] hover:bg-[#132852]">
                        <td className="py-1 pr-2 text-[#94A3B8]">{p.service_call_order}</td>
                        <td className="py-1 pr-2 text-[#CBD5E1]">{p.port_name}</td>
                        <td className="py-1 pr-2 text-right">{p.proforma_distance_to_next_nm?.toFixed(0) ?? '—'}</td>
                        <td className="py-1 pr-2 text-right">{p.proforma_speed_to_next_kn?.toFixed(1) ?? '—'}</td>
                        <td className="py-1 pr-2 text-right">{p.proforma_days_to_next?.toFixed(1) ?? '—'}</td>
                        <td className="py-1 text-right">{p.port_stay_proforma_days?.toFixed(1) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Liner / VSA Participation">
              <div className="overflow-auto max-h-[380px]">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-[#94A3B8] border-b border-[#1E3A5F] sticky top-0 bg-[#0F2040]">
                      <th className="pb-2 pr-3">Liner</th>
                      <th className="pb-2 pr-3">Code</th>
                      <th className="pb-2 pr-3">Role</th>
                      <th className="pb-2 text-right">VSA %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vsas.map((v, i) => (
                      <tr key={i} className="border-b border-[#132852] hover:bg-[#132852]">
                        <td className="py-1.5 pr-3 text-[#CBD5E1]">{v.company_name}</td>
                        <td className="py-1.5 pr-3 text-[#00C2CB]">{v.company_code}</td>
                        <td className="py-1.5 pr-3 text-[#94A3B8]">{v.vsa_role}</td>
                        <td className="py-1.5 text-right">{v.vsa_percentage ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {svc.service_version_rotation_by_names && (
            <Card title="Port Rotation">
              <p className="text-sm text-[#CBD5E1] leading-relaxed">{svc.service_version_rotation_by_names}</p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
