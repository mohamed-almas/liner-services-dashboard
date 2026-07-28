import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoMercator, geoPath, geoGraticule10 } from 'd3-geo'
import type { GeoProjection, GeoPermissibleObjects } from 'd3-geo'

/**
 * Self-contained SVG world map.
 *
 * Deliberately has NO runtime network dependency: the basemap is
 * world-atlas/countries-110m.json (107 KB), pulled in via dynamic import so it
 * is bundled at build time and served from our own origin as a separate chunk.
 * The earlier Bolt build died because react-simple-maps fetched topology from a
 * CDN at render time, which the sandbox blocked and which then cascaded into
 * blank pages.
 *
 * Antimeridian handling is delegated to d3-geo: routes are fed in as GeoJSON
 * LineStrings, and geoPath's stream pipeline cuts them at ±180° so trans-Pacific
 * legs don't streak backwards across the map. (mv_route_geom also carries a
 * crosses_antimeridian flag, mirroring the Power BI IsGeodesic column, which we
 * use for labelling rather than geometry.)
 */

export type MapPoint = {
  lon: number
  lat: number
  label: string
  sublabel?: string
  value?: number
  color?: string
}

export type MapRoute = {
  coords: [number, number][]      // [lon, lat] pairs
  label?: string
  weight?: number                  // relative line thickness driver
  color?: string
  dashed?: boolean
}

type Topology = {
  type: 'Topology'
  objects: { countries: unknown }
  arcs: unknown
  transform?: unknown
}

type LandCache = { land: GeoPermissibleObjects | null; error: string }
let landCache: LandCache | null = null
let landPromise: Promise<LandCache> | null = null

async function loadLand(): Promise<LandCache> {
  if (landCache) return landCache
  if (!landPromise) {
    landPromise = (async () => {
      try {
        const [topoMod, tjMod] = await Promise.all([
          import('world-atlas/countries-110m.json'),
          import('topojson-client'),
        ])
        const topology = ((topoMod as unknown as { default?: Topology }).default ??
          topoMod) as unknown as Topology
        const fc = tjMod.feature(
          topology as never,
          topology.objects.countries as never,
        ) as unknown as GeoPermissibleObjects
        landCache = { land: fc, error: '' }
      } catch (e) {
        // Map degrades to points/routes on a plain ocean rather than blanking.
        landCache = { land: null, error: e instanceof Error ? e.message : String(e) }
      }
      return landCache!
    })()
  }
  return landPromise
}

export default function WorldMap({
  points = [],
  routes = [],
  height = 420,
  fit = 'world',
  pointRadius,
  showGraticule = true,
  emphasisPort,
  legend,
}: {
  points?: MapPoint[]
  routes?: MapRoute[]
  height?: number
  /** 'world' keeps the whole globe; 'data' zooms to the supplied features. */
  fit?: 'world' | 'data'
  /** Override point sizing; default scales by `value` when present. */
  pointRadius?: (p: MapPoint) => number
  showGraticule?: boolean
  /** Draw a highlight ring around this port label. */
  emphasisPort?: string
  legend?: { color: string; label: string }[]
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(880)
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; p: MapPoint } | null>(null)

  useEffect(() => {
    let alive = true
    loadLand().then(r => { if (alive) setLand(r.land) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(Math.floor(w))
    })
    ro.observe(el)
    setWidth(Math.floor(el.getBoundingClientRect().width) || 880)
    return () => ro.disconnect()
  }, [])

  const { pathFn, projection } = useMemo(() => {
    let proj: GeoProjection
    if (fit === 'data' && (points.length || routes.length)) {
      const coords: [number, number][] = [
        ...points.map(p => [p.lon, p.lat] as [number, number]),
        ...routes.flatMap(r => r.coords),
      ].filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
      proj = geoMercator()
      if (coords.length) {
        const collection = { type: 'MultiPoint' as const, coordinates: coords }
        try {
          proj.fitExtent([[24, 20], [Math.max(width - 24, 60), height - 20]],
            collection as unknown as GeoPermissibleObjects)
        } catch {
          proj = geoNaturalEarth1().fitExtent(
            [[8, 8], [Math.max(width - 8, 60), height - 8]],
            { type: 'Sphere' } as unknown as GeoPermissibleObjects)
        }
      }
    } else {
      proj = geoNaturalEarth1().fitExtent(
        [[6, 6], [Math.max(width - 6, 60), height - 6]],
        { type: 'Sphere' } as unknown as GeoPermissibleObjects)
    }
    return { pathFn: geoPath(proj), projection: proj }
  }, [width, height, fit, points, routes])

  const spherePath = pathFn({ type: 'Sphere' } as unknown as GeoPermissibleObjects) ?? ''
  const gratPath = showGraticule ? (pathFn(geoGraticule10()) ?? '') : ''
  const landPath = land ? (pathFn(land) ?? '') : ''

  const maxRouteWeight = Math.max(1, ...routes.map(r => r.weight ?? 1))
  const maxPointValue = Math.max(1, ...points.map(p => p.value ?? 0))

  const radiusOf = (p: MapPoint) => {
    if (pointRadius) return pointRadius(p)
    if (p.value === undefined) return 3
    return 2.5 + Math.sqrt(p.value / maxPointValue) * 9
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg width={width} height={height} className="block select-none"
           role="img" aria-label="Map">
        {/* ocean */}
        <path d={spherePath} fill="#08172E" stroke="#1E3A5F" strokeWidth={0.6} />
        {showGraticule && (
          <path d={gratPath} fill="none" stroke="#123055" strokeWidth={0.4} opacity={0.7} />
        )}
        <path d={landPath} fill="#16283F" stroke="#28486E" strokeWidth={0.4} />

        {/* routes under points */}
        <g>
          {routes.map((r, i) => {
            const d = pathFn({
              type: 'LineString',
              coordinates: r.coords,
            } as unknown as GeoPermissibleObjects)
            if (!d) return null
            const w = 0.6 + ((r.weight ?? 1) / maxRouteWeight) * 2.2
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={r.color ?? '#00C2CB'}
                strokeWidth={w}
                strokeOpacity={0.75}
                strokeLinecap="round"
                strokeDasharray={r.dashed ? '3 3' : undefined}
              />
            )
          })}
        </g>

        {/* points */}
        <g>
          {points.map((p, i) => {
            const xy = projection([p.lon, p.lat])
            if (!xy) return null
            const isEmph = emphasisPort && p.label === emphasisPort
            const r = radiusOf(p)
            return (
              <g key={i}>
                {isEmph && (
                  <circle cx={xy[0]} cy={xy[1]} r={r + 5} fill="none"
                          stroke="#FFD700" strokeWidth={1.6} opacity={0.9} />
                )}
                <circle
                  cx={xy[0]} cy={xy[1]} r={r}
                  fill={p.color ?? (isEmph ? '#FFD700' : '#00C2CB')}
                  fillOpacity={0.78}
                  stroke="#04101F" strokeWidth={0.7}
                  onMouseEnter={() => setHover({ x: xy[0], y: xy[1], p })}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            )
          })}
        </g>
      </svg>

      {legend && legend.length > 0 && (
        <div className="absolute left-2 bottom-2 flex flex-wrap gap-x-3 gap-y-1
                        bg-[#08172ECC] border border-[#1E3A5F] rounded px-2 py-1">
          {legend.map((l, i) => (
            <span key={i} className="flex items-center gap-1.5 text-[10px] text-[#94A3B8]">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 bg-[#0B1830] border border-[#2F5480]
                     rounded px-2 py-1 text-[11px] text-white shadow-xl whitespace-nowrap"
          style={{
            left: Math.min(Math.max(hover.x + 10, 4), Math.max(width - 190, 4)),
            top: Math.max(hover.y - 34, 2),
          }}
        >
          <div className="font-semibold">{hover.p.label}</div>
          {hover.p.sublabel && <div className="text-[#94A3B8]">{hover.p.sublabel}</div>}
        </div>
      )}

      {!land && (
        <div className="absolute right-2 top-2 text-[10px] text-[#4A6082]">
          loading basemap…
        </div>
      )}
    </div>
  )
}
