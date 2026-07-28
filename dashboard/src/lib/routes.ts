import { supabase } from './supabase'
import type { MapRoute, MapPoint } from '../components/WorldMap'

export type RouteRow = {
  route_id: number
  origin_port_code: string
  destination_port_code: string
  origin_port_name?: string | null
  destination_port_name?: string | null
  route_distance_nm: number | null
  crosses_antimeridian: boolean
  services?: number
  coords: [number, number][]
}

/** Coerce the jsonb coords payload into clean [lon, lat] tuples. */
function parseCoords(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return []
  const out: [number, number][] = []
  for (const c of raw) {
    if (!Array.isArray(c) || c.length < 2) continue
    const lon = Number(c[0]), lat = Number(c[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat])
  }
  return out
}

function normalise(rows: unknown[]): RouteRow[] {
  return (rows as Record<string, unknown>[])
    .map(r => ({
      route_id: Number(r.route_id),
      origin_port_code: String(r.origin_port_code ?? ''),
      destination_port_code: String(r.destination_port_code ?? ''),
      origin_port_name: (r.origin_port_name as string) ?? null,
      destination_port_name: (r.destination_port_name as string) ?? null,
      route_distance_nm: r.route_distance_nm === null ? null : Number(r.route_distance_nm),
      crosses_antimeridian: Boolean(r.crosses_antimeridian),
      services: r.services === undefined ? undefined : Number(r.services),
      coords: parseCoords(r.coords),
    }))
    .filter(r => r.coords.length > 1)
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<RouteRow[]> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return normalise((data ?? []) as unknown[])
}

/**
 * True totals for a route set.
 *
 * Must be fetched separately from the geometry: the geometry RPCs cap their
 * payload to keep the map legible (routes_for_liner defaults to 900), and MSC
 * hits that cap exactly — so counting the returned rows understates. These come
 * from server-side aggregates over the whole set.
 */
export type RouteStats = {
  legs: number
  active_services: number
  ports: number
  total_nm: number
  antimeridian_legs: number
}

const EMPTY_STATS: RouteStats = {
  legs: 0, active_services: 0, ports: 0, total_nm: 0, antimeridian_legs: 0,
}

async function statsRpc(fn: string, args: Record<string, unknown>): Promise<RouteStats> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return EMPTY_STATS
  const r = row as Record<string, unknown>
  return {
    legs: Number(r.legs ?? 0),
    active_services: Number(r.active_services ?? 0),
    ports: Number(r.ports ?? 0),
    total_nm: Number(r.total_nm ?? 0),
    antimeridian_legs: Number(r.antimeridian_legs ?? 0),
  }
}

export const routeStatsForService = (versionId: number) =>
  statsRpc('route_stats_for_service', { p_version_id: versionId })
export const routeStatsForPort = (portCode: string) =>
  statsRpc('route_stats_for_port', { p_port_code: portCode })
export const routeStatsForLiner = (companyCode: string) =>
  statsRpc('route_stats_for_liner', { p_company_code: companyCode })
export const routeStatsForPortAt = (portCode: string, asOf: string) =>
  statsRpc('route_stats_for_port_at', { p_port_code: portCode, p_as_of: asOf })

export const routesForService = (versionId: number) =>
  rpc('routes_for_service', { p_version_id: versionId })

export const routesForPort = (portCode: string, limit = 400) =>
  rpc('routes_for_port', { p_port_code: portCode, p_limit: limit })

export const routesForLiner = (companyCode: string, limit = 900) =>
  rpc('routes_for_liner', { p_company_code: companyCode, p_limit: limit })

export const routesForPortAt = (portCode: string, asOf: string, limit = 400) =>
  rpc('routes_for_port_at', { p_port_code: portCode, p_as_of: asOf, p_limit: limit })

/** Route rows -> map layer, thickness driven by how many services share the leg. */
export function toMapRoutes(rows: RouteRow[], color?: string, dashed = false): MapRoute[] {
  return rows.map(r => ({
    coords: r.coords,
    label: `${r.origin_port_name ?? r.origin_port_code} → ${r.destination_port_name ?? r.destination_port_code}`,
    weight: r.services ?? 1,
    color,
    dashed,
  }))
}

/**
 * Derive the distinct port endpoints of a route set, sized by how many legs
 * touch each one — so hubs read larger than spokes without a second query.
 */
export function endpointsFromRoutes(
  rows: RouteRow[],
  portLookup: Map<string, { lat: number; lon: number; name: string; country: string }>,
): MapPoint[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    counts.set(r.origin_port_code, (counts.get(r.origin_port_code) ?? 0) + 1)
    counts.set(r.destination_port_code, (counts.get(r.destination_port_code) ?? 0) + 1)
  }
  const out: MapPoint[] = []
  for (const [code, n] of counts) {
    const p = portLookup.get(code)
    if (!p) continue
    out.push({
      lon: p.lon, lat: p.lat, label: p.name,
      sublabel: `${p.country} · ${n} leg${n === 1 ? '' : 's'}`,
      value: n,
    })
  }
  return out.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
}
