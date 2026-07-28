import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, Empty, PageHeader, Select, BarList,
  ROUTE_COLORS, ROUTE_ORDER, CustomTooltip, pivotByRoute, fmtTeu, fmt,
  MIN_YEAR, MAX_YEAR,
} from '../components/ui'

export default function Liners() {
  const [liner, setLiner] = useState('')

  const liners = useQuery(async () => {
    const res = await supabase.from('mv_liner_current')
      .select('company_code,company_name,vsa_capacity_teu')
      .order('vsa_capacity_teu', { ascending: false, nullsFirst: false }).limit(500)
    return unwrap(res) as { company_code: string; company_name: string; vsa_capacity_teu: number }[]
  }, [])

  useEffect(() => {
    if (!liner && liners.data?.length) setLiner(liners.data[0].company_code)
  }, [liners.data, liner])

  const q = useQuery(async () => {
    const [kpi, byYear, market] = await Promise.all([
      supabase.from('mv_liner_current')
        .select('company_name,company_type,active_services,active_versions,service_capacity_teu,annual_capacity_teu,vsa_capacity_teu')
        .eq('company_code', liner).maybeSingle(),
      supabase.from('mv_liner_year')
        .select('year,route_type,service_count,service_capacity_teu,vsa_capacity_teu')
        .eq('company_code', liner).gte('year', MIN_YEAR).lte('year', MAX_YEAR).order('year'),
      supabase.from('mv_liner_current')
        .select('company_code,company_name,vsa_capacity_teu,active_services')
        .order('vsa_capacity_teu', { ascending: false, nullsFirst: false }).limit(15),
    ])

    const rows = unwrap(byYear) as { year: number; route_type: string; service_count: number; vsa_capacity_teu: number }[]
    const top = unwrap(market) as { company_code: string; company_name: string; vsa_capacity_teu: number; active_services: number }[]

    // Route mix in the last complete year
    const mix = new Map<string, number>()
    for (const r of rows.filter(r => r.year === MAX_YEAR - 1)) {
      const key = ROUTE_ORDER.includes(r.route_type) ? r.route_type : 'Other'
      mix.set(key, (mix.get(key) ?? 0) + (r.vsa_capacity_teu ?? 0))
    }

    return {
      kpi: kpi.data as Record<string, never> | null,
      byYear: rows,
      mix: Array.from(mix.entries()).map(([route_type, value]) => ({ route_type, value })).filter(r => r.value > 0),
      top,
      rank: top.findIndex(t => t.company_code === liner),
    }
  }, [liner], { skip: !liner })

  const k = q.data?.kpi as {
    company_name?: string; company_type?: string
    active_services?: number; active_versions?: number
    service_capacity_teu?: number; annual_capacity_teu?: number; vsa_capacity_teu?: number
  } | null | undefined

  return (
    <div className="space-y-5">
      <PageHeader
        title="Liner Overview"
        subtitle={k ? [k.company_type, q.data && q.data.rank >= 0 ? `#${q.data.rank + 1} by own capacity` : null].filter(Boolean).join(' · ') : undefined}
      >
        <Select
          value={liner} onChange={setLiner} placeholder=""
          options={(liners.data ?? []).map(l => ({ value: l.company_code, label: l.company_name ?? l.company_code }))}
        />
      </PageHeader>

      {liners.loading || q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !q.data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <KPICard label="Active Services" value={k?.active_services ?? 0} accent sub="as of today" />
            <KPICard label="Own Capacity" value={fmtTeu(k?.vsa_capacity_teu)} sub="TEU, VSA-weighted share" />
            <KPICard label="Services Capacity" value={fmtTeu(k?.service_capacity_teu)} sub="TEU incl. partners' share" />
            <KPICard label="Annual Capacity" value={fmtTeu(k?.annual_capacity_teu)} sub="TEU/yr" />
            <KPICard label="Versions" value={fmt(k?.active_versions)} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Services by Trade Route" subtitle="services operated during each year">
              {q.data.byYear.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
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
              )}
            </Card>

            <Card title="Own Capacity by Trade Route" subtitle={`VSA-weighted TEU, ${MAX_YEAR - 1}`}>
              {q.data.mix.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={q.data.mix} dataKey="value" nameKey="route_type"
                         cx="50%" cy="50%" outerRadius={92} innerRadius={54} paddingAngle={2}
                         label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                         labelLine={false}>
                      {q.data.mix.map((e, i) => (
                        <Cell key={i} fill={ROUTE_COLORS[e.route_type] ?? '#6B7280'} stroke="#0F2040" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [fmtTeu(Number(v)), String(n)]}
                             contentStyle={{ background: '#0B1830', border: '1px solid #2F5480', borderRadius: 4, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          <Card title="Market Ranking" subtitle="top liners by own VSA-weighted capacity">
            <BarList
              rows={q.data.top.map(t => ({ label: t.company_name ?? t.company_code, value: t.vsa_capacity_teu ?? 0 }))}
              valueFormat={fmtTeu} color="#4682B4" maxRows={15}
            />
          </Card>

          <p className="text-[10px] text-[#3E5878] leading-relaxed">
            <strong className="text-[#5A7196]">Own capacity</strong> applies each carrier's VSA
            percentage to the deployed service capacity, so slots are attributed to the carrier that
            controls them. <strong className="text-[#5A7196]">Services capacity</strong> is the full
            capacity of every service the carrier participates in, including partners' shares — the
            two differ substantially on heavily shared alliance services.
          </p>
        </>
      )}
    </div>
  )
}
