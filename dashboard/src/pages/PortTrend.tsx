import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select,
  ROUTE_COLORS, ROUTE_ORDER, CustomTooltip, pivotByRoute, fmtTeu,
  MIN_YEAR, MAX_YEAR,
} from '../components/ui'

export default function PortTrend() {
  const [port, setPort] = useState('AEAUH')

  // Full country name in the picker label, per the naming convention.
  const ports = useQuery(async () => {
    const res = await supabase.from('mv_port_current')
      .select('port_code,port_name,country_name')
      .eq('is_chokepoint', false).gt('active_services', 0)
      .order('port_name').limit(1000)
    return unwrap(res) as { port_code: string; port_name: string; country_name: string }[]
  }, [])

  const q = useQuery(async () => {
    const [byYear, kpi] = await Promise.all([
      supabase.from('mv_port_year')
        .select('year,route_type,service_count,service_capacity_teu,annual_rotations')
        .eq('port_code', port).gte('year', MIN_YEAR).lte('year', MAX_YEAR).order('year'),
      supabase.from('mv_port_current')
        .select('port_name,country_name,coastal_region,active_services,lines_calling,service_capacity_teu,annual_capacity_teu,annual_calls_at_port')
        .eq('port_code', port).maybeSingle(),
    ])
    return {
      byYear: unwrap(byYear) as { year: number; route_type: string; service_count: number; service_capacity_teu: number; annual_rotations: number }[],
      kpi: kpi.data as {
        port_name: string; country_name: string; coastal_region: string
        active_services: number; lines_calling: number
        service_capacity_teu: number | null; annual_capacity_teu: number | null
        annual_calls_at_port: number | null
      } | null,
    }
  }, [port], { skip: !port })

  const capByYear = q.data ? Array.from(
    q.data.byYear.reduce((m, r) => {
      const cur = m.get(r.year) ?? { year: r.year, services: 0, capacity: 0, calls: 0 }
      cur.services += r.service_count ?? 0
      cur.capacity += r.service_capacity_teu ?? 0
      cur.calls    += r.annual_rotations ?? 0
      m.set(r.year, cur)
      return m
    }, new Map<number, { year: number; services: number; capacity: number; calls: number }>()).values()
  ).sort((a, b) => a.year - b.year) : []

  return (
    <div className="space-y-5">
      <PageHeader
        title="Port Trend"
        subtitle={q.data?.kpi ? `${q.data.kpi.country_name} · ${q.data.kpi.coastal_region ?? '—'}` : undefined}
      >
        <Select
          value={port} onChange={setPort} placeholder=""
          options={(ports.data ?? []).map(p => ({ value: p.port_code, label: `${p.port_name} — ${p.country_name}` }))}
        />
      </PageHeader>

      {q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !q.data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <KPICard label="Active Services" value={q.data.kpi?.active_services ?? 0} accent sub="as of today" />
            <KPICard label="Lines Calling" value={q.data.kpi?.lines_calling ?? 0} />
            <KPICard label="Deployed Capacity" value={fmtTeu(q.data.kpi?.service_capacity_teu)} sub="TEU per rotation" />
            <KPICard label="Annual Capacity" value={fmtTeu(q.data.kpi?.annual_capacity_teu)} sub="TEU/yr" />
            <KPICard label="Annual Calls" value={fmtTeu(q.data.kpi?.annual_calls_at_port)} sub="rotations × calls" />
          </div>

          {q.data.byYear.length === 0 ? (
            <Card title="Trend"><Empty msg="No berth-arrival history for this port." /></Card>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card title="Services by Trade Route" subtitle="services calling during each year">
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={pivotByRoute(q.data.byYear)} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} width={38} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff08' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    {ROUTE_ORDER.map(rt => (
                      <Bar key={rt} dataKey={rt} stackId="a" fill={ROUTE_COLORS[rt]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Capacity & Calls" subtitle="deployed TEU vs annual call volume">
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart data={capByYear} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="year" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: '#1E3A5F' }} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fill: '#94A3B8', fontSize: 11 }} width={46}
                           axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fill: '#94A3B8', fontSize: 11 }} width={44}
                           axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff08' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    <Bar yAxisId="l" dataKey="capacity" name="Capacity (TEU)" fill="#1E4E6B" radius={[2, 2, 0, 0]} />
                    <Line yAxisId="r" dataKey="calls" name="Annual calls" stroke="#FFD700" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          <p className="text-[10px] text-[#3E5878] leading-relaxed">
            KPI cards are point-in-time (currently active versions only). Annual bars count services
            calling at any point in the year, so they read higher — both figures reconcile with the
            Power BI model. {MAX_YEAR} is partial.
          </p>
        </>
      )}
    </div>
  )
}
