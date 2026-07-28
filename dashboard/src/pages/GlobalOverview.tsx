import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap, fetchAll } from '../lib/useQuery'
import { useTheme } from '../lib/theme'
import {
  KPICard, Card, Spinner, ErrorMsg, PageHeader, SectionTitle, BarList, Tabs,
  ROUTE_COLORS, ROUTE_ORDER, CustomTooltip, pivotByRoute, fmtTeu, fmt,
  MIN_YEAR, MAX_YEAR,
} from '../components/ui'
import WorldMap, { type MapPoint } from '../components/WorldMap'

type Metric = 'Services' | 'Capacity' | 'Liners' | 'Partner ports'
const METRICS: Metric[] = ['Services', 'Capacity', 'Liners', 'Partner ports']
type MapView = 'Clusters' | 'Individual ports'
const VIEWS: MapView[] = ['Clusters', 'Individual ports']

type Cluster = {
  lon: number; lat: number; ports: number; services: number; lines: number
  capacity_teu: number; top_port: string; top_country: string
}
type Port = {
  port_code: string; port_name: string; country_name: string
  lat: number; lon: number; active_services: number; lines_calling: number
  service_capacity_teu: number | null; partner_ports: number
}

export default function GlobalOverview() {
  const { palette } = useTheme()
  const [metric, setMetric] = useState<Metric>('Services')
  const [mapView, setMapView] = useState<MapView>('Clusters')

  const q = useQuery(async () => {
    const [kpi, byYear, topCountries, topLiners, topPorts, clusters, ports] = await Promise.all([
      supabase.from('mv_global_current').select('*').maybeSingle(),
      supabase.from('mv_global_year')
        .select('year,route_type,service_count,service_capacity_teu')
        .gte('year', MIN_YEAR).lte('year', MAX_YEAR).order('year'),
      supabase.from('mv_country_current')
        .select('country_code,country_name,country_short_name,active_services,port_count')
        .order('active_services', { ascending: false }).limit(12),
      supabase.from('mv_liner_current')
        .select('company_name,active_services,vsa_capacity_teu')
        .order('vsa_capacity_teu', { ascending: false, nullsFirst: false }).limit(12),
      supabase.from('mv_port_current')
        .select('port_code,port_name,active_services')
        .eq('is_chokepoint', false)
        .order('active_services', { ascending: false }).limit(12),
      supabase.from('mv_port_cluster')
        .select('lon,lat,ports,services,lines,capacity_teu,top_port,top_country')
        .order('services', { ascending: false }),
      fetchAll<Port>((from, to) =>
        supabase.from('mv_port_map')
          .select('port_code,port_name,country_name,lat,lon,active_services,lines_calling,service_capacity_teu,partner_ports')
          .eq('is_chokepoint', false).gt('active_services', 0)
          .order('port_code').range(from, to)
      ),
    ])

    const k = kpi.data as {
      active_services: number; service_capacity_teu: number; annual_capacity_teu: number
      vessels_deployed: number; countries: number; ports: number; liners: number
      chokepoints: number
    } | null

    return {
      k,
      byYear: unwrap(byYear) as { year: number; route_type: string; service_count: number; service_capacity_teu: number }[],
      topCountries: unwrap(topCountries) as { country_short_name: string; country_name: string; active_services: number }[],
      topLiners: unwrap(topLiners) as { company_name: string; vsa_capacity_teu: number }[],
      topPorts: unwrap(topPorts) as { port_code: string; port_name: string; active_services: number }[],
      clusters: unwrap(clusters) as Cluster[],
      ports,
    }
  }, [])

  const d = q.data

  const capacityByYear = useMemo(() => {
    if (!d) return []
    return Array.from(
      d.byYear.reduce((m, r) => {
        const cur = m.get(r.year) ?? { year: r.year, services: 0, capacity: 0 }
        cur.services += r.service_count ?? 0
        cur.capacity += r.service_capacity_teu ?? 0
        m.set(r.year, cur)
        return m
      }, new Map<number, { year: number; services: number; capacity: number }>()).values()
    ).sort((a, b) => a.year - b.year)
  }, [d])

  const mapPoints: MapPoint[] = useMemo(() => {
    if (!d) return []
    if (mapView === 'Clusters') {
      const pick = (c: Cluster) =>
        metric === 'Capacity' ? c.capacity_teu : metric === 'Liners' ? c.lines : c.services
      return d.clusters.map(c => ({
        lon: c.lon, lat: c.lat,
        label: `${c.ports} port${c.ports === 1 ? '' : 's'} · ${c.top_country}`,
        sublabel: `${fmt(c.services)} services · ${fmtTeu(c.capacity_teu)} TEU · largest: ${c.top_port}`,
        value: Math.max(0, pick(c)),
      }))
    }
    return d.ports.map(p => ({
      lon: p.lon, lat: p.lat, label: p.port_name,
      sublabel: `${p.country_name} · ${fmt(p.active_services)} services · ${fmt(p.lines_calling)} lines`,
      value:
        metric === 'Capacity' ? (p.service_capacity_teu ?? 0)
        : metric === 'Liners' ? p.lines_calling
        : metric === 'Partner ports' ? p.partner_ports
        : p.active_services,
    }))
  }, [d, mapView, metric])

  const topClusters = useMemo(() => {
    if (!d) return []
    const pick = (c: Cluster) =>
      metric === 'Capacity' ? c.capacity_teu : metric === 'Liners' ? c.lines : c.services
    return [...d.clusters].sort((a, b) => pick(b) - pick(a)).slice(0, 12)
      .map(c => ({ label: `${c.top_country} · ${c.top_port}`, value: pick(c) }))
  }, [d, metric])

  if (q.loading) return <Spinner />
  if (q.error) return <ErrorMsg msg={q.error} />
  if (!d) return null

  return (
    <div className="space-y-5">
      <PageHeader
        title="Global Overview"
        subtitle="Currently active services · berth-arrival basis, chokepoints excluded"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPICard label="Active Services" value={d.k?.active_services ?? 0} accent sub="distinct master names" />
        <KPICard label="Countries" value={d.k?.countries ?? 0} />
        <KPICard label="Ports" value={d.k?.ports ?? 0} sub={`excl. ${d.k?.chokepoints ?? 4} chokepoints`} />
        <KPICard label="Active Liners" value={d.k?.liners ?? 0} />
        <KPICard label="Deployed Capacity" value={fmtTeu(d.k?.service_capacity_teu)} sub="TEU per rotation" />
        <KPICard label="Annual Capacity" value={fmtTeu(d.k?.annual_capacity_teu)} sub="TEU/yr" />
      </div>

      <SectionTitle title="Evolution" note="services calling during each year" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Active Services by Trade Route">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={pivotByRoute(d.byYear)} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="year" tick={{ fill: palette.axis, fontSize: 11 }}
                     axisLine={{ stroke: palette.grid }} tickLine={false} />
              <YAxis tick={{ fill: palette.axis, fontSize: 11 }} width={42} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: palette.grid, fillOpacity: 0.25 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
              {ROUTE_ORDER.map(rt => (
                <Bar key={rt} dataKey={rt} stackId="a" fill={ROUTE_COLORS[rt]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Services vs Deployed Capacity" subtitle="capacity from VSA proforma allocations">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={capacityByYear} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="year" tick={{ fill: palette.axis, fontSize: 11 }}
                     axisLine={{ stroke: palette.grid }} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fill: palette.axis, fontSize: 11 }} width={42}
                     axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: palette.axis, fontSize: 11 }}
                     width={46} axisLine={false} tickLine={false} tickFormatter={fmtTeu} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: palette.grid, fillOpacity: 0.25 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
              <Bar yAxisId="l" dataKey="services" name="Services" fill={palette.neutralBar} radius={[2, 2, 0, 0]} />
              <Line yAxisId="r" dataKey="capacity" name="Capacity (TEU)" stroke="#D9A400" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <SectionTitle title="Port concentration" note={`${fmt(d.ports.length)} active ports · ${d.clusters.length} cells`} />

      <Card
        title={mapView === 'Clusters' ? 'Global port clusters' : 'Individual ports'}
        subtitle={
          mapView === 'Clusters'
            ? `bubble area scales with ${metric.toLowerCase()}; ports grouped into 5° cells at their weighted centroid`
            : `bubble area scales with ${metric.toLowerCase()}`
        }
        actions={
          <div className="flex gap-2 flex-wrap">
            <Tabs value={mapView} onChange={v => setMapView(v as MapView)} options={VIEWS} size="sm" />
            <Tabs value={metric} onChange={v => setMetric(v as Metric)} options={METRICS} size="sm" />
          </div>
        }
      >
        <WorldMap points={mapPoints} height={520} fit="world" />
      </Card>

      <SectionTitle title="Leaders" />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card title="Top Countries" subtitle="by active services">
          <BarList rows={d.topCountries.map(c => ({
            label: c.country_short_name ?? c.country_name, value: c.active_services,
          }))} color={ROUTE_COLORS['East/West']} />
        </Card>
        <Card title="Top Ports" subtitle="by active services">
          <BarList rows={d.topPorts.map(p => ({
            label: p.port_name ?? p.port_code, value: p.active_services,
          }))} color={ROUTE_COLORS['Feeders']} />
        </Card>
        <Card title="Top Liners" subtitle="by own VSA-weighted capacity">
          <BarList rows={d.topLiners.map(l => ({
            label: l.company_name, value: l.vsa_capacity_teu ?? 0,
          }))} valueFormat={fmtTeu} color={ROUTE_COLORS['Intra-Regional']} />
        </Card>
        <Card title={`Leading clusters`} subtitle={`by ${metric.toLowerCase()}`}>
          <BarList rows={topClusters}
                   valueFormat={metric === 'Capacity' ? fmtTeu : fmt}
                   color={ROUTE_COLORS['North/South']} />
        </Card>
      </div>

      <p className="text-[10px] leading-relaxed" style={{ color: 'var(--faint)' }}>
        Services are counted as distinct master names, matching the Power BI measure. Port and country
        figures use BERTH_ARRIVAL events, which structurally excludes the four chokepoints (Suez,
        Panama, Cape of Good Hope, Cape Horn). Annual charts count services calling at any point in
        the year, so they read higher than the point-in-time KPIs above; {MAX_YEAR} is partial.
      </p>
    </div>
  )
}
