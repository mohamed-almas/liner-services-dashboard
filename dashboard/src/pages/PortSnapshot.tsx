import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, BarList, fmtTeu, fmt,
} from '../components/ui'

type Svc = {
  service_master_name: string
  alliance_code: string | null
  trade_route_1: string | null
  service_version_roundtrip_days: number | null
  service_version_frequency_days: number | null
  service_capacity_teu: number | null
  vessels_deployed: number | null
}

export default function PortSnapshot() {
  const [port, setPort] = useState('AEJEA')

  const ports = useQuery(async () => {
    const res = await supabase.from('mv_port_current')
      .select('port_code,port_name').eq('is_chokepoint', false).gt('active_services', 0)
      .order('port_name').limit(1000)
    return unwrap(res) as { port_code: string; port_name: string }[]
  }, [])

  const q = useQuery(async () => {
    // Services currently calling this port at berth
    const bridge = await supabase.from('mv_service_port_berth')
      .select('service_version_id').eq('port_code', port).limit(1000)
    const ids = (unwrap(bridge) as { service_version_id: number }[]).map(r => r.service_version_id)

    const [kpi, conn, services, partners] = await Promise.all([
      supabase.from('mv_port_current')
        .select('port_name,country_name,coastal_region,region,continent,port_lat,port_lon,active_services,lines_calling,service_capacity_teu,annual_capacity_teu,flag')
        .eq('port_code', port).maybeSingle(),
      supabase.from('mv_port_connectivity_current')
        .select('partner_ports,direct_ports,indirect_ports,partner_countries,direct_countries,indirect_countries,partner_coastal_regions')
        .eq('port_code', port).maybeSingle(),
      ids.length
        ? supabase.from('mv_service_base')
            .select('service_master_name,alliance_code,trade_route_1,service_version_roundtrip_days,service_version_frequency_days,service_capacity_teu,vessels_deployed')
            .in('service_version_id', ids.slice(0, 500)).eq('is_current', true)
            .order('service_capacity_teu', { ascending: false, nullsFirst: false })
        : Promise.resolve({ data: [], error: null }),
      // Pre-aggregated server-side; the raw connectivity rows for a big port
      // exceed the 1000-row response cap and would silently truncate.
      supabase.from('mv_port_partner_country')
        .select('partner_country_code,partner_ports,direct_ports')
        .eq('port_code', port).order('partner_ports', { ascending: false }).limit(20),
    ])

    return {
      kpi: kpi.data as Record<string, never> | null,
      conn: conn.data as Record<string, number> | null,
      services: (services.data ?? []) as Svc[],
      topPartnerCountries: ((partners.data ?? []) as {
        partner_country_code: string; partner_ports: number
      }[]).map(r => ({ label: r.partner_country_code, value: r.partner_ports })),
    }
  }, [port], { skip: !port })

  const k = q.data?.kpi as {
    port_name?: string; country_name?: string; coastal_region?: string
    region?: string; continent?: string; port_lat?: number; port_lon?: number
    active_services?: number; lines_calling?: number
    service_capacity_teu?: number; annual_capacity_teu?: number; flag?: string
  } | null | undefined

  return (
    <div className="space-y-5">
      <PageHeader
        title="Port Snapshot"
        subtitle={k ? `${k.country_name} · ${k.coastal_region ?? '—'} · ${k.continent ?? ''}` : undefined}
      >
        <Select
          value={port} onChange={setPort} placeholder=""
          options={(ports.data ?? []).map(p => ({ value: p.port_code, label: `${p.port_name} (${p.port_code})` }))}
        />
      </PageHeader>

      {q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !q.data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <KPICard label="Active Services" value={k?.active_services ?? 0} accent sub="as of today" />
            <KPICard label="Lines Calling" value={k?.lines_calling ?? 0} />
            <KPICard label="Deployed Capacity" value={fmtTeu(k?.service_capacity_teu)} sub="TEU" />
            <KPICard label="Partner Ports" value={q.data.conn?.partner_ports ?? 0} sub="reachable on one service" />
            <KPICard label="Direct" value={q.data.conn?.direct_ports ?? 0} sub="next call in rotation" />
            <KPICard label="Partner Countries" value={q.data.conn?.partner_countries ?? 0} />
            <KPICard label="Coastal Regions" value={q.data.conn?.partner_coastal_regions ?? 0} sub="reached" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card title="Top Partner Countries" subtitle="by distinct partner ports reachable">
              <BarList rows={q.data.topPartnerCountries} color="#008B8B" maxRows={14} />
            </Card>

            <Card className="xl:col-span-2" title="Currently Active Services"
                  subtitle={`${q.data.services.length} version${q.data.services.length === 1 ? '' : 's'} calling at berth`}>
              {q.data.services.length === 0 ? <Empty /> : (
                <div className="overflow-auto max-h-[340px]">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-[#94A3B8] border-b border-[#1E3A5F] sticky top-0 bg-[#0F2040]">
                        <th className="pb-2 pr-3 font-medium">Service</th>
                        <th className="pb-2 pr-3 font-medium">Route</th>
                        <th className="pb-2 pr-3 font-medium">Alliance</th>
                        <th className="pb-2 pr-3 font-medium text-right">RT</th>
                        <th className="pb-2 pr-3 font-medium text-right">Freq</th>
                        <th className="pb-2 pr-3 font-medium text-right">Vessels</th>
                        <th className="pb-2 font-medium text-right">TEU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.services.map((s, i) => (
                        <tr key={i} className="border-b border-[#132852] hover:bg-[#132852]">
                          <td className="py-1.5 pr-3 text-[#CBD5E1] max-w-[180px] truncate" title={s.service_master_name}>
                            {s.service_master_name}
                          </td>
                          <td className="py-1.5 pr-3 text-[#7D93B4]">{s.trade_route_1 ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-[#7D93B4]">{s.alliance_code ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(s.service_version_roundtrip_days)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(s.service_version_frequency_days)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(s.vessels_deployed, 1)}</td>
                          <td className="py-1.5 text-right tabular-nums text-[#00C2CB]">{fmtTeu(s.service_capacity_teu)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <p className="text-[10px] text-[#3E5878] leading-relaxed">
            <strong className="text-[#5A7196]">Direct</strong> means the partner port is the very next
            call in the rotation; all other reachable ports on the same service count as indirect.
            Berth-arrival basis, so chokepoints are excluded. RT = round-trip days, Freq = days
            between departures.
          </p>
        </>
      )}
    </div>
  )
}
