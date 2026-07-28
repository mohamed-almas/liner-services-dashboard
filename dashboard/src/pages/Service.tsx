import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap, fetchAll } from '../lib/useQuery'
import { useTheme } from '../lib/theme'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, SectionTitle, Select,
  ROUTE_COLORS, CustomTooltip, fmtTeu, fmt,
} from '../components/ui'
import WorldMap from '../components/WorldMap'
import { routesForService, routeStatsForService, toMapRoutes, endpointsFromRoutes } from '../lib/routes'

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
  annual_rotations: number | null
  service_version_average_vessel_capacity_teu: number | null
  service_version_rotation_by_names: string | null
}

type Proforma = {
  port_name: string; port_code: string; service_call_order: number
  proforma_terminal_name: string | null
  proforma_distance_to_next_nm: number | null
  proforma_speed_to_next_kn: number | null
  proforma_days_to_next: number | null
  port_stay_proforma_days: number | null
}

type VSA = {
  company_code: string; vsa_role: string | null; vsa_percentage: number | null
  avg_trade_cap_per_vsa_proforma_capacity: number | null; company_name?: string
}

export default function Service() {
  const { palette } = useTheme()
  const [master, setMaster] = useState('')
  const [version, setVersion] = useState('')

  // Master-name picker; active services first, then most-revised.
  const names = useQuery(async () => {
    const rows = await fetchAll<{
      service_master_name: string; service_master_name_incl_trade_lane: string
      version_count: number; has_current: boolean
    }>((from, to) =>
      supabase.from('mv_service_names')
        .select('service_master_name,service_master_name_incl_trade_lane,version_count,has_current')
        .order('has_current', { ascending: false })
        .order('service_master_name')
        .range(from, to)
    )
    return rows.map(r => ({
      value: r.service_master_name,
      label: `${r.service_master_name_incl_trade_lane ?? r.service_master_name}`
        + (r.version_count > 1 ? ` · ${r.version_count} versions` : '')
        + (r.has_current ? '' : ' (inactive)'),
    }))
  }, [])

  useEffect(() => {
    if (!master && names.data?.length) setMaster(names.data[0].value)
  }, [names.data, master])

  // Every version of the selected service.
  const hist = useQuery(async () => {
    const res = await supabase.from('mv_service_base')
      .select('service_version_id,service_version_number,validity_status,is_current,valid_from,valid_to,alliance_code,trade_route_1,trade_route_3,service_version_roundtrip_days,service_version_frequency_days,service_version_port_count,service_version_call_count,vessels_deployed,service_capacity_teu,annual_capacity_teu,annual_rotations,service_version_average_vessel_capacity_teu,service_version_rotation_by_names')
      .eq('service_master_name', master)
      .order('valid_from', { ascending: true })
    const versions = unwrap(res) as Version[]
    const active = versions.find(v => v.is_current)
    return { versions, isLive: !!active, current: active ?? versions[versions.length - 1] ?? null }
  }, [master], { skip: !master })

  // Default the version selector to the live (or latest) version.
  useEffect(() => {
    const c = hist.data?.current
    if (c) setVersion(String(c.service_version_id))
  }, [hist.data])

  const detail = useQuery(async () => {
    const vid = Number(version)
    const [pf, vsa, routes, stats] = await Promise.all([
      supabase.from('eesea_service_proformas')
        .select('port_name,port_code,service_call_order,proforma_terminal_name,proforma_distance_to_next_nm,proforma_speed_to_next_kn,proforma_days_to_next,port_stay_proforma_days')
        .eq('service_version_id', vid).eq('event_type', 'PORT_ARRIVAL')
        .order('service_call_order'),
      supabase.from('eesea_vsa')
        .select('company_code,vsa_role,vsa_percentage,avg_trade_cap_per_vsa_proforma_capacity')
        .eq('service_version_id', vid).order('vsa_percentage', { ascending: false, nullsFirst: false }),
      routesForService(vid),
      routeStatsForService(vid),
    ])

    const vsaRows = unwrap(vsa) as VSA[]
    const codes = vsaRows.map(v => v.company_code).filter(Boolean)
    let enriched = vsaRows
    if (codes.length) {
      const co = await supabase.from('eesea_companies')
        .select('company_code,company_name').in('company_code', codes)
      const map = new Map(((co.data ?? []) as { company_code: string; company_name: string }[])
        .map(c => [c.company_code, c.company_name]))
      enriched = vsaRows.map(v => ({ ...v, company_name: map.get(v.company_code) ?? v.company_code }))
    }
    return { proformas: unwrap(pf) as Proforma[], vsas: enriched, routes, stats }
  }, [version], { skip: !version })

  const coords = useQuery(async () => {
    const res = await supabase.from('mv_port_map')
      .select('port_code,port_name,country_name,lat,lon').order('port_code').limit(1000)
    const rows = unwrap(res) as {
      port_code: string; port_name: string; country_name: string; lat: number; lon: number
    }[]
    return new Map(rows.map(r => [r.port_code, {
      lat: r.lat, lon: r.lon, name: r.port_name, country: r.country_name,
    }]))
  }, [])

  const s = useMemo(
    () => hist.data?.versions.find(v => String(v.service_version_id) === version) ?? hist.data?.current,
    [hist.data, version])

  const label = hist.data?.isLive ? 'Current' : 'Final'
  const first = hist.data?.versions[0]
  const growth = s && first?.service_capacity_teu
    ? ((s.service_capacity_teu ?? 0) - first.service_capacity_teu) / first.service_capacity_teu * 100
    : null

  const chart = useMemo(() => (hist.data?.versions ?? [])
    .filter(v => v.valid_from)
    .map(v => ({
      label: v.valid_from!.slice(0, 7),
      capacity: v.service_capacity_teu ?? 0,
      ports: v.service_version_port_count ?? 0,
      roundtrip: v.service_version_roundtrip_days ?? 0,
      vessel: v.service_version_average_vessel_capacity_teu ?? 0,
    })), [hist.data])

  const routes = detail.data?.routes ?? []
  const stats = detail.data?.stats ?? null
  const mapRoutes = useMemo(() => toMapRoutes(routes), [routes])
  const mapPoints = useMemo(
    () => endpointsFromRoutes(routes, coords.data ?? new Map()), [routes, coords.data])

  const totalDistance = detail.data?.proformas.reduce((a, p) => a + (p.proforma_distance_to_next_nm ?? 0), 0) ?? 0
  const totalSeaDays = detail.data?.proformas.reduce((a, p) => a + (p.proforma_days_to_next ?? 0), 0) ?? 0
  const totalPortDays = detail.data?.proformas.reduce((a, p) => a + (p.port_stay_proforma_days ?? 0), 0) ?? 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Overview"
        subtitle={s ? [s.trade_route_1, s.trade_route_3, s.alliance_code,
                       hist.data?.isLive ? null : 'no longer active'].filter(Boolean).join(' · ') : undefined}
      >
        <Select value={master} onChange={setMaster} placeholder="" options={names.data ?? []} />
        {(hist.data?.versions.length ?? 0) > 1 && (
          <Select value={version} onChange={setVersion} placeholder=""
                  options={[...(hist.data?.versions ?? [])].reverse().map(v => ({
                    value: String(v.service_version_id),
                    label: `v.${v.service_version_number} · ${v.valid_from?.slice(0, 10) ?? '—'}`
                      + (v.is_current ? ' (active)' : ''),
                  }))} />
        )}
      </PageHeader>

      {names.loading || hist.loading ? <Spinner />
       : hist.error ? <ErrorMsg msg={hist.error} />
       : !s ? null : (
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

          {/* ---------- Route map ---------- */}
          <SectionTitle title="Nautical rotation"
                        note={stats ? `${fmt(stats.legs)} legs · ${fmt(stats.ports)} ports` : undefined} />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Legs" value={stats?.legs ?? 0} accent sub="in rotation" />
            <KPICard label="Total Distance" value={fmt(stats?.total_nm || totalDistance)} sub="nautical miles" />
            <KPICard label="Days at Sea" value={fmt(totalSeaDays, 1)} />
            <KPICard label="Days in Port" value={fmt(totalPortDays, 1)} />
          </div>

          <Card title="Route map" subtitle="proforma nautical path, zoomed to the rotation">
            {detail.loading ? <Spinner />
             : mapRoutes.length === 0 ? <Empty msg="No route geometry for this version." />
             : <WorldMap routes={mapRoutes} points={mapPoints} height={440} fit="data" showGraticule={false} />}
          </Card>

          {/* ---------- Rotation & VSA ---------- */}
          <SectionTitle title="Rotation detail" />
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <Card className="xl:col-span-3" title="Port rotation" subtitle="proforma schedule, port-arrival basis">
              {detail.loading ? <Spinner />
               : (detail.data?.proformas.length ?? 0) === 0 ? <Empty />
               : (
                <div className="overflow-auto max-h-[400px]">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                        {['#', 'Port', 'Terminal', 'Stay', 'Dist', 'Speed', 'Days'].map((h, i) => (
                          <th key={h} className={`pb-2 font-medium ${i >= 3 ? 'text-right pr-2' : 'pr-2'}`}
                              style={{ background: 'var(--panel)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data!.proformas.map((p, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="py-1 pr-2 tabular-nums" style={{ color: 'var(--faint)' }}>{p.service_call_order}</td>
                          <td className="py-1 pr-2" style={{ color: 'var(--text-2)' }}>
                            {p.port_name} <span style={{ color: 'var(--faint)' }}>{p.port_code}</span>
                          </td>
                          <td className="py-1 pr-2 max-w-[130px] truncate" style={{ color: 'var(--dim)' }}
                              title={p.proforma_terminal_name ?? ''}>{p.proforma_terminal_name ?? '—'}</td>
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

            <Card className="xl:col-span-2" title="VSA participation" subtitle="slot allocation by carrier">
              {detail.loading ? <Spinner />
               : (detail.data?.vsas.length ?? 0) === 0 ? <Empty msg="No VSA records." />
               : (
                <div className="overflow-auto max-h-[400px]">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                        <th className="pb-2 pr-2 font-medium" style={{ background: 'var(--panel)' }}>Carrier</th>
                        <th className="pb-2 pr-2 font-medium" style={{ background: 'var(--panel)' }}>Role</th>
                        <th className="pb-2 pr-2 font-medium text-right" style={{ background: 'var(--panel)' }}>Share</th>
                        <th className="pb-2 font-medium text-right" style={{ background: 'var(--panel)' }}>TEU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data!.vsas.map((v, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="py-1.5 pr-2 max-w-[130px] truncate" style={{ color: 'var(--text-2)' }}
                              title={v.company_name}>{v.company_name}</td>
                          <td className="py-1.5 pr-2 text-[10px]" style={{ color: 'var(--dim)' }}>{v.vsa_role ?? '—'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums" style={{ color: 'var(--accent)' }}>
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
            <Card title="Rotation string">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {s.service_version_rotation_by_names}
              </p>
            </Card>
          )}

          {/* ---------- Evolution ---------- */}
          {(hist.data?.versions.length ?? 0) > 1 && (
            <>
              <SectionTitle title="Evolution across versions"
                            note={`${hist.data!.versions.length} versions on record`} />

              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KPICard label="Versions" value={hist.data!.versions.length} accent sub="full history" />
                <KPICard label={`${label} Round Trip`} value={fmt(hist.data!.current?.service_version_roundtrip_days)} sub="days" />
                <KPICard label={`${label} Ports`} value={fmt(hist.data!.current?.service_version_port_count)} />
                <KPICard label={`${label} Vessels`} value={fmt(hist.data!.current?.vessels_deployed, 1)} />
                <KPICard label={`${label} Capacity`} value={fmtTeu(hist.data!.current?.service_capacity_teu)} sub="TEU" />
                <KPICard label="Capacity Growth" sub="vs first version"
                         value={growth === null ? '—' : `${growth > 0 ? '+' : ''}${growth.toFixed(0)}%`}
                         accent={growth !== null && growth > 0} />
              </div>

              {chart.length > 1 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <Card title="Capacity & vessel size by version">
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <XAxis dataKey="label" tick={{ fill: palette.axis, fontSize: 10 }}
                               axisLine={{ stroke: palette.grid }} tickLine={false} />
                        <YAxis tick={{ fill: palette.axis, fontSize: 11 }} width={46}
                               axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                        <Line type="monotone" dataKey="capacity" name="Service capacity"
                              stroke={palette.accent} strokeWidth={2} dot={{ r: 2 }} />
                        <Line type="monotone" dataKey="vessel" name="Avg vessel size"
                              stroke="#D9A400" strokeWidth={2} dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card title="Network shape by version">
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <XAxis dataKey="label" tick={{ fill: palette.axis, fontSize: 10 }}
                               axisLine={{ stroke: palette.grid }} tickLine={false} />
                        <YAxis tick={{ fill: palette.axis, fontSize: 11 }} width={38}
                               axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                        <Line type="monotone" dataKey="ports" name="Ports"
                              stroke={ROUTE_COLORS['Feeders']} strokeWidth={2} dot={{ r: 2 }} />
                        <Line type="monotone" dataKey="roundtrip" name="Round trip (days)"
                              stroke={ROUTE_COLORS['North/South']} strokeWidth={2} dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                </div>
              )}

              <Card title="Version history" subtitle="click a version in the header selector to inspect it">
                <div className="overflow-auto max-h-[380px]">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                        {['v.', 'Status', 'From', 'To', 'Alliance', 'RT', 'Freq', 'Ports', 'Vessels', 'TEU']
                          .map((h, i) => (
                          <th key={h} className={`pb-2 font-medium ${i >= 5 ? 'text-right pr-2' : 'pr-2'}`}
                              style={{ background: 'var(--panel)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...hist.data!.versions].reverse().map(v => (
                        <tr key={v.service_version_id}
                            onClick={() => setVersion(String(v.service_version_id))}
                            className="cursor-pointer"
                            style={{
                              borderBottom: '1px solid var(--border)',
                              background: String(v.service_version_id) === version
                                ? 'var(--panel-alt)' : undefined,
                            }}>
                          <td className="py-1.5 pr-2 tabular-nums" style={{ color: 'var(--faint)' }}>
                            {v.service_version_number}
                          </td>
                          <td className="py-1.5 pr-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                  style={v.is_current
                                    ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
                                    : { background: 'var(--border)', color: 'var(--muted)' }}>
                              {v.validity_status ?? '—'}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums" style={{ color: 'var(--text-2)' }}>{v.valid_from ?? '—'}</td>
                          <td className="py-1.5 pr-2 tabular-nums" style={{ color: 'var(--dim)' }}>{v.valid_to ?? 'open'}</td>
                          <td className="py-1.5 pr-2" style={{ color: 'var(--dim)' }}>{v.alliance_code ?? '—'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(v.service_version_roundtrip_days)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(v.service_version_frequency_days)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(v.service_version_port_count)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(v.vessels_deployed, 1)}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--accent)' }}>
                            {fmtTeu(v.service_capacity_teu)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--faint)' }}>
            Versions are grouped by service master name — a carrier revises a service by publishing a
            new version, so round-trip days, port count and deployed capacity across versions show how
            the network and vessel deployment changed. The rotation table and route map use
            PORT_ARRIVAL events, which include chokepoint transits since those are part of the path.
          </p>
        </>
      )}
    </div>
  )
}
