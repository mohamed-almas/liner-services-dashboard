import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap, fetchAll } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, CustomTooltip, fmtTeu, fmt,
} from '../components/ui'

type Version = {
  service_version_id: number
  service_version_number: string
  validity_status: string | null
  is_current: boolean
  valid_from: string | null
  valid_to: string | null
  alliance_code: string | null
  trade_route_1: string | null
  trade_route_3: string | null
  service_version_roundtrip_days: number | null
  service_version_frequency_days: number | null
  service_version_port_count: number | null
  service_version_call_count: number | null
  vessels_deployed: number | null
  service_capacity_teu: number | null
  annual_capacity_teu: number | null
  service_version_average_vessel_capacity_teu: number | null
}

export default function ServiceEvolution() {
  const [service, setService] = useState('')

  // Services with more than one version, so there is actually an evolution to
  // show. Paged: the full name list (3,381) exceeds the 1000-row cap.
  const names = useQuery(async () => {
    const rows = await fetchAll<{
      service_master_name: string; service_master_name_incl_trade_lane: string
      version_count: number; has_current: boolean
    }>((from, to) =>
      supabase.from('mv_service_names')
        .select('service_master_name,service_master_name_incl_trade_lane,version_count,has_current')
        .gt('version_count', 1)
        // Active services first, then most-revised, so the default selection is
        // a live service rather than one whose versions have all lapsed.
        .order('has_current', { ascending: false })
        .order('version_count', { ascending: false })
        .range(from, to)
    )
    return rows.map(r => ({
      value: r.service_master_name,
      label: `${r.service_master_name_incl_trade_lane ?? r.service_master_name} · ${r.version_count} versions${r.has_current ? '' : ' (inactive)'}`,
    }))
  }, [])

  useEffect(() => {
    if (!service && names.data?.length) setService(names.data[0].value)
  }, [names.data, service])

  const q = useQuery(async () => {
    const res = await supabase.from('mv_service_base')
      .select('service_version_id,service_version_number,validity_status,is_current,valid_from,valid_to,alliance_code,trade_route_1,trade_route_3,service_version_roundtrip_days,service_version_frequency_days,service_version_port_count,service_version_call_count,vessels_deployed,service_capacity_teu,annual_capacity_teu,service_version_average_vessel_capacity_teu')
      .eq('service_master_name', service)
      .order('valid_from', { ascending: true })
    const versions = unwrap(res) as Version[]
    const active = versions.find(v => v.is_current)
    return {
      versions,
      isLive: !!active,
      // Fall back to the newest version when nothing is currently active, so the
      // headline cards describe the service's final state instead of showing "—".
      current: active ?? versions[versions.length - 1] ?? null,
      chart: versions
        .filter(v => v.valid_from)
        .map(v => ({
          label: v.valid_from!.slice(0, 7),
          capacity: v.service_capacity_teu ?? 0,
          ports: v.service_version_port_count ?? 0,
          roundtrip: v.service_version_roundtrip_days ?? 0,
          vessel: v.service_version_average_vessel_capacity_teu ?? 0,
        })),
    }
  }, [service], { skip: !service })

  const c = q.data?.current
  const label = q.data?.isLive ? 'Current' : 'Final'
  const first = q.data?.versions[0]
  const growth = c && first && first.service_capacity_teu
    ? ((c.service_capacity_teu ?? 0) - first.service_capacity_teu) / first.service_capacity_teu * 100
    : null

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Evolution"
        subtitle={c ? [c.trade_route_1, c.trade_route_3, c.alliance_code,
                       q.data?.isLive ? null : 'no longer active'].filter(Boolean).join(' · ') : undefined}
      >
        <Select
          value={service} onChange={setService} placeholder=""
          options={names.data ?? []}
        />
      </PageHeader>

      {names.loading || q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !q.data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPICard label="Versions" value={q.data.versions.length} accent sub="across full history" />
            <KPICard label={`${label} Round Trip`} value={fmt(c?.service_version_roundtrip_days)} sub="days" />
            <KPICard label={`${label} Ports`} value={fmt(c?.service_version_port_count)} />
            <KPICard label={`${label} Vessels`} value={fmt(c?.vessels_deployed, 1)} />
            <KPICard label={`${label} Capacity`} value={fmtTeu(c?.service_capacity_teu)} sub="TEU per rotation" />
            <KPICard label="Capacity Growth" sub="vs first version"
                     value={growth === null ? '—' : `${growth > 0 ? '+' : ''}${growth.toFixed(0)}%`}
                     accent={growth !== null && growth > 0} />
          </div>

          {q.data.chart.length < 2 ? (
            <Card title="Evolution"><Empty msg="Only one version on record — nothing to compare." /></Card>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card title="Capacity & Vessel Size by Version" subtitle="deployed TEU per rotation">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={q.data.chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="label" tick={{ fill: '#94A3B8', fontSize: 10 }}
                           axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={46}
                           axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    <Line type="monotone" dataKey="capacity" name="Service capacity" stroke="#00C2CB" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="vessel" name="Avg vessel size" stroke="#FFD700" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Network Shape by Version" subtitle="ports called and round-trip duration">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={q.data.chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="label" tick={{ fill: '#94A3B8', fontSize: 10 }}
                           axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={38} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    <Line type="monotone" dataKey="ports" name="Ports" stroke="#4169E1" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="roundtrip" name="Round trip (days)" stroke="#87CEEB" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          <Card title="Version History" subtitle={`${q.data.versions.length} versions`}>
            <div className="overflow-auto max-h-[420px]">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-[#94A3B8] border-b border-[#1E3A5F] sticky top-0 bg-[#0F2040]">
                    <th className="pb-2 pr-2 font-medium">v.</th>
                    <th className="pb-2 pr-2 font-medium">Status</th>
                    <th className="pb-2 pr-2 font-medium">From</th>
                    <th className="pb-2 pr-2 font-medium">To</th>
                    <th className="pb-2 pr-2 font-medium">Alliance</th>
                    <th className="pb-2 pr-2 font-medium text-right">RT</th>
                    <th className="pb-2 pr-2 font-medium text-right">Freq</th>
                    <th className="pb-2 pr-2 font-medium text-right">Ports</th>
                    <th className="pb-2 pr-2 font-medium text-right">Vessels</th>
                    <th className="pb-2 font-medium text-right">TEU</th>
                  </tr>
                </thead>
                <tbody>
                  {[...q.data.versions].reverse().map(v => (
                    <tr key={v.service_version_id}
                        className={`border-b border-[#132852] hover:bg-[#132852] ${v.is_current ? 'bg-[#00C2CB0A]' : ''}`}>
                      <td className="py-1.5 pr-2 text-[#5A7196] tabular-nums">{v.service_version_number}</td>
                      <td className="py-1.5 pr-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          v.is_current ? 'bg-[#00C2CB22] text-[#00C2CB]'
                          : v.validity_status === 'Future' ? 'bg-[#FFD70018] text-[#D9B300]'
                          : 'bg-[#1E3A5F] text-[#7D93B4]'
                        }`}>
                          {v.validity_status ?? '—'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-[#CBD5E1] tabular-nums">{v.valid_from ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-[#7D93B4] tabular-nums">{v.valid_to ?? 'open'}</td>
                      <td className="py-1.5 pr-2 text-[#7D93B4]">{v.alliance_code ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(v.service_version_roundtrip_days)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(v.service_version_frequency_days)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(v.service_version_port_count)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(v.vessels_deployed, 1)}</td>
                      <td className="py-1.5 text-right tabular-nums text-[#00C2CB]">{fmtTeu(v.service_capacity_teu)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="text-[10px] text-[#3E5878] leading-relaxed">
            Versions are grouped by service master name. A carrier revises a service by publishing a
            new version, so tracking round-trip days, port count and deployed capacity across
            versions shows how the network and vessel deployment changed over time. Only one version
            is normally flagged current.
          </p>
        </>
      )}
    </div>
  )
}
