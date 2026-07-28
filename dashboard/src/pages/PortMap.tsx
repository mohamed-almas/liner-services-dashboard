import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery, unwrap, fetchAll } from '../lib/useQuery'
import {
  KPICard, Card, Spinner, ErrorMsg, PageHeader, Tabs, BarList, fmt, fmtTeu,
} from '../components/ui'
import WorldMap, { type MapPoint } from '../components/WorldMap'

type Metric = 'Services' | 'Capacity' | 'Liners' | 'Partner ports'
const METRICS: Metric[] = ['Services', 'Capacity', 'Liners', 'Partner ports']

type View = 'Clusters' | 'Individual ports'
const VIEWS: View[] = ['Clusters', 'Individual ports']

type Cluster = {
  lon: number; lat: number; ports: number; services: number; lines: number
  capacity_teu: number; top_port: string; top_country: string
}

type Port = {
  port_code: string; port_name: string; country_short_name: string; country_name: string
  coastal_region: string; lat: number; lon: number
  active_services: number; lines_calling: number
  service_capacity_teu: number | null; partner_ports: number
}

export default function PortMap() {
  const [metric, setMetric] = useState<Metric>('Services')
  const [view, setView] = useState<View>('Clusters')

  const q = useQuery(async () => {
    const [clusters, ports] = await Promise.all([
      supabase.from('mv_port_cluster')
        .select('lon,lat,ports,services,lines,capacity_teu,top_port,top_country')
        .order('services', { ascending: false }),
      fetchAll<Port>((from, to) =>
        supabase.from('mv_port_map')
          .select('port_code,port_name,country_short_name,country_name,coastal_region,lat,lon,active_services,lines_calling,service_capacity_teu,partner_ports')
          .eq('is_chokepoint', false).gt('active_services', 0)
          .order('port_code').range(from, to)
      ),
    ])
    return {
      clusters: unwrap(clusters) as Cluster[],
      ports,
    }
  }, [])

  const d = q.data

  const valueOf = (metric: Metric) => (c: { services: number; capacity_teu: number; lines: number }) =>
    metric === 'Capacity' ? c.capacity_teu : metric === 'Liners' ? c.lines : c.services

  const points: MapPoint[] = useMemo(() => {
    if (!d) return []
    if (view === 'Clusters') {
      const f = valueOf(metric)
      return d.clusters.map(c => ({
        lon: c.lon, lat: c.lat,
        label: `${c.ports} port${c.ports === 1 ? '' : 's'} · ${c.top_country}`,
        sublabel: `${fmt(c.services)} services · ${fmtTeu(c.capacity_teu)} TEU · largest: ${c.top_port}`,
        value: Math.max(0, f({ services: c.services, capacity_teu: c.capacity_teu, lines: c.lines })),
      }))
    }
    return d.ports.map(p => ({
      lon: p.lon, lat: p.lat,
      label: p.port_name,
      sublabel: `${p.country_name} · ${fmt(p.active_services)} services · ${fmt(p.lines_calling)} lines`,
      value:
        metric === 'Capacity' ? (p.service_capacity_teu ?? 0)
        : metric === 'Liners' ? p.lines_calling
        : metric === 'Partner ports' ? p.partner_ports
        : p.active_services,
    }))
  }, [d, view, metric])

  const totals = useMemo(() => {
    if (!d) return null
    return {
      ports: d.ports.length,
      cells: d.clusters.length,
      services: d.clusters.reduce((s, c) => s + c.services, 0),
      capacity: d.clusters.reduce((s, c) => s + (c.capacity_teu ?? 0), 0),
    }
  }, [d])

  const topClusters = useMemo(() => {
    if (!d) return []
    const f = valueOf(metric)
    return [...d.clusters]
      .sort((a, b) => f(b) - f(a))
      .slice(0, 14)
      .map(c => ({
        label: `${c.top_country} · ${c.top_port}`,
        value: f(c),
      }))
  }, [d, metric])

  const fmtMetric = metric === 'Capacity' ? fmtTeu : fmt

  return (
    <div className="space-y-5">
      <PageHeader
        title="Global Port Map"
        subtitle="Port concentrations worldwide · berth-arrival basis, chokepoints excluded"
      >
        <Tabs value={view} onChange={v => setView(v as View)} options={VIEWS} />
        <Tabs value={metric} onChange={v => setMetric(v as Metric)} options={METRICS} />
      </PageHeader>

      {q.loading ? <Spinner /> : q.error ? <ErrorMsg msg={q.error} /> : !d ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Active Ports" value={totals?.ports ?? 0} accent sub="with berth calls" />
            <KPICard label="Cluster Cells" value={totals?.cells ?? 0} sub="5° × 5° grid" />
            <KPICard label="Service Calls" value={fmt(totals?.services)} sub="summed across ports" />
            <KPICard label="Deployed Capacity" value={fmtTeu(totals?.capacity)} sub="TEU" />
          </div>

          <Card
            title={view === 'Clusters' ? 'Port concentration' : 'Individual ports'}
            subtitle={
              view === 'Clusters'
                ? `bubble area scales with ${metric.toLowerCase()}; ports grouped into 5° cells at their weighted centroid`
                : `bubble area scales with ${metric.toLowerCase()}`
            }
          >
            <WorldMap points={points} height={540} fit="world" />
          </Card>

          <Card title={`Leading clusters by ${metric.toLowerCase()}`}
                subtitle="labelled by the largest port in each cell">
            <BarList rows={topClusters} valueFormat={fmtMetric} color="#008B8B" maxRows={14} />
          </Card>

          <p className="text-[10px] text-[#3E5878] leading-relaxed">
            Clusters group ports into 5°×5° cells and place the bubble at the service-weighted
            centroid, so a marker sits on the actual concentration rather than the middle of an
            arbitrary square. Switch to <span className="text-[#5A7196]">Individual ports</span> to
            see all {fmt(totals?.ports)} separately. The four chokepoints — Suez, Panama, Cape of
            Good Hope and Cape Horn — are passages rather than ports and are excluded throughout.
          </p>
        </>
      )}
    </div>
  )
}
