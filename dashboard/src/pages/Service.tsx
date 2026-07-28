import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap, fetchAll } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, fmtTeu, fmt,
} from '../components/ui'

type Proforma = {
  port_name: string
  port_code: string
  service_call_order: number
  proforma_terminal_name: string | null
  proforma_distance_to_next_nm: number | null
  proforma_speed_to_next_kn: number | null
  proforma_days_to_next: number | null
  port_stay_proforma_days: number | null
  berth_stay_proforma_days: number | null
}

type VSA = {
  company_code: string
  vsa_role: string | null
  vsa_percentage: number | null
  avg_trade_cap_per_vsa_proforma_capacity: number | null
  company_name?: string
}

export default function Service() {
  const [version, setVersion] = useState('')

  // ~1,693 current services exceeds the 1000-row response cap, so page through.
  const services = useQuery(() => fetchAll<{
    current_version_id: number; service_master_name: string
    service_master_name_incl_trade_lane: string
  }>((from, to) =>
    supabase.from('mv_service_names')
      .select('current_version_id,service_master_name,service_master_name_incl_trade_lane')
      .eq('has_current', true).order('service_master_name').range(from, to)
  ), [])

  useEffect(() => {
    if (!version && services.data?.length) setVersion(String(services.data[0].current_version_id))
  }, [services.data, version])

  const q = useQuery(async () => {
    const vid = Number(version)
    const [svc, pf, vsa] = await Promise.all([
      supabase.from('mv_service_base').select('*').eq('service_version_id', vid).maybeSingle(),
      // PORT_ARRIVAL for the rotation: includes chokepoint transits, which are
      // part of the route and carry the distance/speed legs.
      supabase.from('eesea_service_proformas')
        .select('port_name,port_code,service_call_order,proforma_terminal_name,proforma_distance_to_next_nm,proforma_speed_to_next_kn,proforma_days_to_next,port_stay_proforma_days,berth_stay_proforma_days')
        .eq('service_version_id', vid).eq('event_type', 'PORT_ARRIVAL')
        .order('service_call_order'),
      supabase.from('eesea_vsa')
        .select('company_code,vsa_role,vsa_percentage,avg_trade_cap_per_vsa_proforma_capacity')
        .eq('service_version_id', vid).order('vsa_percentage', { ascending: false, nullsFirst: false }),
    ])

    const vsaRows = unwrap(vsa) as VSA[]
    const codes = vsaRows.map(v => v.company_code).filter(Boolean)
    let enriched = vsaRows
    if (codes.length) {
      const companies = await supabase.from('eesea_companies')
        .select('company_code,company_name').in('company_code', codes)
      const map = new Map(((companies.data ?? []) as { company_code: string; company_name: string }[])
        .map(c => [c.company_code, c.company_name]))
      enriched = vsaRows.map(v => ({ ...v, company_name: map.get(v.company_code) ?? v.company_code }))
    }

    return {
      svc: svc.data as Record<string, never> | null,
      proformas: unwrap(pf) as Proforma[],
      vsas: enriched,
    }
  }, [version], { skip: !version })

  const s = q.data?.svc as {
    service_master_name?: string; service_master_name_incl_trade_lane?: string
    alliance_code?: string; trade_route_1?: string; trade_route_3?: string
    service_version_roundtrip_days?: number; service_version_frequency_days?: number
    service_version_port_count?: number; service_version_call_count?: number
    service_version_slot_count?: number; vessels_deployed?: number
    service_capacity_teu?: number; annual_capacity_teu?: number
    annual_rotations?: number; service_version_average_vessel_capacity_teu?: number
    service_version_rotation_by_names?: string; validity_status?: string
  } | null | undefined

  const totalDistance = q.data?.proformas.reduce((a, p) => a + (p.proforma_distance_to_next_nm ?? 0), 0) ?? 0
  const totalSeaDays  = q.data?.proformas.reduce((a, p) => a + (p.proforma_days_to_next ?? 0), 0) ?? 0
  const totalPortDays = q.data?.proformas.reduce((a, p) => a + (p.port_stay_proforma_days ?? 0), 0) ?? 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Overview"
        subtitle={s ? [s.trade_route_1, s.trade_route_3, s.alliance_code].filter(Boolean).join(' · ') : undefined}
      >
        <Select
          value={version} onChange={setVersion} placeholder=""
          options={(services.data ?? []).map(v => ({
            value: String(v.current_version_id),
            label: v.service_master_name_incl_trade_lane ?? v.service_master_name,
          }))}
        />
      </PageHeader>

      {services.loading || q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !q.data || !s ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <KPICard label="Round Trip" value={fmt(s.service_version_roundtrip_days)} accent sub="days" />
            <KPICard label="Frequency" value={fmt(s.service_version_frequency_days)} sub="days between sailings" />
            <KPICard label="Vessels Deployed" value={fmt(s.vessels_deployed, 1)} sub="round trip ÷ frequency" />
            <KPICard label="Ports" value={fmt(s.service_version_port_count)} />
            <KPICard label="Calls / Rotation" value={fmt(s.service_version_call_count)} />
            <KPICard label="Deployed Capacity" value={fmtTeu(s.service_capacity_teu)} sub="TEU per rotation" />
            <KPICard label="Annual Capacity" value={fmtTeu(s.annual_capacity_teu)}
                     sub={`${fmt(s.annual_rotations, 1)} rotations/yr`} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Total Distance" value={fmt(totalDistance)} sub="nautical miles" />
            <KPICard label="Days at Sea" value={fmt(totalSeaDays, 1)} />
            <KPICard label="Days in Port" value={fmt(totalPortDays, 1)} />
            <KPICard label="Avg Vessel Size" value={fmtTeu(s.service_version_average_vessel_capacity_teu)} sub="TEU" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <Card className="xl:col-span-3" title="Port Rotation"
                  subtitle="proforma schedule, port-arrival basis">
              {q.data.proformas.length === 0 ? <Empty /> : (
                <div className="overflow-auto max-h-[420px]">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-[#94A3B8] border-b border-[#1E3A5F] sticky top-0 bg-[#0F2040]">
                        <th className="pb-2 pr-2 font-medium">#</th>
                        <th className="pb-2 pr-2 font-medium">Port</th>
                        <th className="pb-2 pr-2 font-medium">Terminal</th>
                        <th className="pb-2 pr-2 font-medium text-right">Stay</th>
                        <th className="pb-2 pr-2 font-medium text-right">Dist</th>
                        <th className="pb-2 pr-2 font-medium text-right">Speed</th>
                        <th className="pb-2 font-medium text-right">Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.proformas.map((p, i) => (
                        <tr key={i} className="border-b border-[#132852] hover:bg-[#132852]">
                          <td className="py-1 pr-2 text-[#5A7196] tabular-nums">{p.service_call_order}</td>
                          <td className="py-1 pr-2 text-[#CBD5E1]">
                            {p.port_name}
                            <span className="text-[#4A6082] ml-1">{p.port_code}</span>
                          </td>
                          <td className="py-1 pr-2 text-[#7D93B4] max-w-[130px] truncate"
                              title={p.proforma_terminal_name ?? ''}>
                            {p.proforma_terminal_name ?? '—'}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">{fmt(p.port_stay_proforma_days, 1)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{fmt(p.proforma_distance_to_next_nm)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{fmt(p.proforma_speed_to_next_kn, 1)}</td>
                          <td className="py-1 text-right tabular-nums">{fmt(p.proforma_days_to_next, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="xl:col-span-2" title="VSA Participation"
                  subtitle="slot allocation by carrier">
              {q.data.vsas.length === 0 ? <Empty msg="No VSA records." /> : (
                <div className="overflow-auto max-h-[420px]">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-[#94A3B8] border-b border-[#1E3A5F] sticky top-0 bg-[#0F2040]">
                        <th className="pb-2 pr-2 font-medium">Carrier</th>
                        <th className="pb-2 pr-2 font-medium">Role</th>
                        <th className="pb-2 pr-2 font-medium text-right">Share</th>
                        <th className="pb-2 font-medium text-right">TEU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.vsas.map((v, i) => (
                        <tr key={i} className="border-b border-[#132852] hover:bg-[#132852]">
                          <td className="py-1.5 pr-2 text-[#CBD5E1] max-w-[130px] truncate" title={v.company_name}>
                            {v.company_name}
                          </td>
                          <td className="py-1.5 pr-2 text-[#7D93B4] text-[10px]">{v.vsa_role ?? '—'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-[#00C2CB]">
                            {v.vsa_percentage !== null ? `${v.vsa_percentage}%` : '—'}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {fmtTeu(v.avg_trade_cap_per_vsa_proforma_capacity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {s.service_version_rotation_by_names && (
            <Card title="Rotation String">
              <p className="text-xs text-[#CBD5E1] leading-relaxed">{s.service_version_rotation_by_names}</p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
