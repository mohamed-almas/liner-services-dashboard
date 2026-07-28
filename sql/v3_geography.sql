-- =====================================================================
-- Liner Services — v3 geography layer (maps)
--
-- Sources:
--   ml_liners_ports_&_geo         — port lat/lon + country/region attributes
--   eesea_routes_service_versions — nautical port-to-port path geometry
--
-- The routes table holds 127,486 rows but only 8,649 distinct route_id values,
-- each with stable geometry, so geometry is stored once (mv_route_geom) and
-- bridged to service versions separately (mv_route_service).
--
-- route_truncated_linestring is a comma-separated list of "lon lat" pairs —
-- LONGITUDE FIRST. Power BI transforms this two ways:
--   * 'Routes by service (Azure-geodesic)' explodes every vertex into its own
--     row with First/Middle/Last position, and derives IsGeodesic as
--     abs(startLon - endLon) > 180 to flag antimeridian crossings.
--   * 'Routes by service (icon)' keeps the path as WKT LINESTRING(...) and
--     appends the endpoints separately as POINT(...) with a Type column.
-- Neither shape suits a React SVG map, so here geometry is emitted as a JSON
-- [[lon,lat], ...] array the client can project directly. The antimeridian flag
-- is preserved for labelling; the actual cut is done by d3-geo's stream
-- clipping at render time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- mv_route_geom — deduplicated, decimated route geometry (8,649 rows)
-- Decimated to <= 48 vertices, always keeping first and last. Average 18.4
-- points / ~376 bytes of JSON per route; 298 routes cross the antimeridian.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_route_geom CASCADE;
CREATE MATERIALIZED VIEW mv_route_geom AS
WITH src AS (
  SELECT DISTINCT route_id, origin_port_code, destination_port_code,
         route_distance_nm, route_truncated_linestring
  FROM eesea_routes_service_versions
  WHERE route_truncated_linestring IS NOT NULL
),
pts AS (
  SELECT s.route_id, s.origin_port_code, s.destination_port_code, s.route_distance_nm,
         t.ord,
         NULLIF(split_part(btrim(t.p), ' ', 1), '')::float8 AS lon,
         NULLIF(split_part(btrim(t.p), ' ', 2), '')::float8 AS lat,
         COUNT(*) OVER (PARTITION BY s.route_id) AS n_points
  FROM src s
  CROSS JOIN LATERAL unnest(string_to_array(s.route_truncated_linestring, ','))
             WITH ORDINALITY AS t(p, ord)
),
clean AS (
  SELECT * FROM pts
  WHERE lon IS NOT NULL AND lat IS NOT NULL
    AND lon BETWEEN -180 AND 180 AND lat BETWEEN -90 AND 90
),
keep AS (
  SELECT *, GREATEST(1, CEIL(n_points / 48.0)::int) AS step FROM clean
),
decimated AS (
  SELECT * FROM keep WHERE ord = 1 OR ord = n_points OR (ord % step) = 0
)
SELECT
  d.route_id, d.origin_port_code, d.destination_port_code,
  MAX(d.route_distance_nm) AS route_distance_nm,
  MAX(d.n_points)          AS source_points,
  COUNT(*)                 AS points,
  jsonb_agg(jsonb_build_array(
      ROUND(d.lon::numeric, 4), ROUND(d.lat::numeric, 4)
    ) ORDER BY d.ord)      AS coords,
  (ABS( MIN(d.lon) FILTER (WHERE d.ord = 1)
      - MIN(d.lon) FILTER (WHERE d.ord = d.n_points) ) > 180) AS crosses_antimeridian
FROM decimated d
GROUP BY d.route_id, d.origin_port_code, d.destination_port_code;
CREATE UNIQUE INDEX ON mv_route_geom (route_id);
CREATE INDEX ON mv_route_geom (origin_port_code);
CREATE INDEX ON mv_route_geom (destination_port_code);
GRANT SELECT ON mv_route_geom TO anon, authenticated;

DROP MATERIALIZED VIEW IF EXISTS mv_route_service CASCADE;
CREATE MATERIALIZED VIEW mv_route_service AS
SELECT DISTINCT service_version_id, route_id FROM eesea_routes_service_versions;
CREATE INDEX ON mv_route_service (service_version_id);
CREATE INDEX ON mv_route_service (route_id);
GRANT SELECT ON mv_route_service TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_port_map — compact port point layer
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_port_map CASCADE;
CREATE MATERIALIZED VIEW mv_port_map AS
SELECT
  pc.port_code, pc.port_name,
  pc.country_code, pc.country_name, pc.country_short_name,
  pc.coastal_region, pc.continent,
  pc.port_lat AS lat, pc.port_lon AS lon,
  pc.is_chokepoint,
  pc.active_services, pc.lines_calling,
  pc.service_capacity_teu, pc.annual_calls_at_port,
  COALESCE(cc.partner_ports, 0)     AS partner_ports,
  COALESCE(cc.partner_countries, 0) AS partner_countries
FROM mv_port_current pc
LEFT JOIN mv_port_connectivity_current cc ON cc.port_code = pc.port_code
WHERE pc.port_lat IS NOT NULL AND pc.port_lon IS NOT NULL;
CREATE UNIQUE INDEX ON mv_port_map (port_code);
CREATE INDEX ON mv_port_map (country_code);
CREATE INDEX ON mv_port_map (coastal_region);
CREATE INDEX ON mv_port_map (active_services DESC);
GRANT SELECT ON mv_port_map TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_port_cluster — 5x5 degree concentration grid (296 cells).
-- Bubble sits at the mean position of the ports in the cell, not the cell
-- centre, so markers land on the real cluster rather than an arbitrary square.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_port_cluster CASCADE;
CREATE MATERIALIZED VIEW mv_port_cluster AS
SELECT
  FLOOR(lon / 5.0)::int           AS cell_x,
  FLOOR(lat / 5.0)::int           AS cell_y,
  FLOOR(lon / 5.0)::int * 5 + 2.5 AS cell_lon,
  FLOOR(lat / 5.0)::int * 5 + 2.5 AS cell_lat,
  ROUND(AVG(lon)::numeric, 3)     AS lon,
  ROUND(AVG(lat)::numeric, 3)     AS lat,
  COUNT(*)                        AS ports,
  SUM(active_services)            AS services,
  SUM(lines_calling)              AS lines,
  ROUND(SUM(service_capacity_teu)) AS capacity_teu,
  (ARRAY_AGG(port_name ORDER BY active_services DESC NULLS LAST))[1]         AS top_port,
  (ARRAY_AGG(country_short_name ORDER BY active_services DESC NULLS LAST))[1] AS top_country
FROM mv_port_map
WHERE NOT is_chokepoint AND active_services > 0
GROUP BY 1,2,3,4;
CREATE INDEX ON mv_port_cluster (services DESC);
GRANT SELECT ON mv_port_cluster TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Route-map RPCs. Serving filtered sets from the server avoids shipping the
-- whole ~3.2 MB geometry table and sidesteps PostgREST's 1000-row cap.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION routes_for_service(p_version_id bigint)
RETURNS TABLE (
  route_id numeric, origin_port_code text, destination_port_code text,
  origin_port_name text, destination_port_name text,
  route_distance_nm double precision, crosses_antimeridian boolean, coords jsonb
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT g.route_id, g.origin_port_code, g.destination_port_code,
         po.port_name, pd.port_name,
         g.route_distance_nm, g.crosses_antimeridian, g.coords
  FROM mv_route_service rs
  JOIN mv_route_geom g ON g.route_id = rs.route_id
  LEFT JOIN mv_port_dim po ON po.port_code = g.origin_port_code
  LEFT JOIN mv_port_dim pd ON pd.port_code = g.destination_port_code
  WHERE rs.service_version_id = p_version_id
  ORDER BY g.route_distance_nm DESC;
$$;
GRANT EXECUTE ON FUNCTION routes_for_service(bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION routes_for_port(p_port_code text, p_limit int DEFAULT 400)
RETURNS TABLE (
  route_id numeric, origin_port_code text, destination_port_code text,
  origin_port_name text, destination_port_name text,
  route_distance_nm double precision, crosses_antimeridian boolean,
  services int, coords jsonb
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT g.route_id, g.origin_port_code, g.destination_port_code,
         po.port_name, pd.port_name,
         g.route_distance_nm, g.crosses_antimeridian,
         COUNT(DISTINCT rs.service_version_id)::int, g.coords
  FROM mv_route_geom g
  JOIN mv_route_service rs ON rs.route_id = g.route_id
  JOIN mv_service_base sb  ON sb.service_version_id = rs.service_version_id AND sb.is_current
  LEFT JOIN mv_port_dim po ON po.port_code = g.origin_port_code
  LEFT JOIN mv_port_dim pd ON pd.port_code = g.destination_port_code
  WHERE g.origin_port_code = p_port_code OR g.destination_port_code = p_port_code
  GROUP BY g.route_id, g.origin_port_code, g.destination_port_code,
           po.port_name, pd.port_name, g.route_distance_nm,
           g.crosses_antimeridian, g.coords
  ORDER BY 8 DESC, g.route_distance_nm DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION routes_for_port(text, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION routes_for_liner(p_company_code text, p_limit int DEFAULT 900)
RETURNS TABLE (
  route_id numeric, origin_port_code text, destination_port_code text,
  origin_port_name text, destination_port_name text,
  route_distance_nm double precision, crosses_antimeridian boolean,
  services int, coords jsonb
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT g.route_id, g.origin_port_code, g.destination_port_code,
         po.port_name, pd.port_name,
         g.route_distance_nm, g.crosses_antimeridian,
         COUNT(DISTINCT rs.service_version_id)::int, g.coords
  FROM eesea_vsa v
  JOIN mv_service_base sb  ON sb.service_version_id = v.service_version_id AND sb.is_current
  JOIN mv_route_service rs ON rs.service_version_id = v.service_version_id
  JOIN mv_route_geom g     ON g.route_id = rs.route_id
  LEFT JOIN mv_port_dim po ON po.port_code = g.origin_port_code
  LEFT JOIN mv_port_dim pd ON pd.port_code = g.destination_port_code
  WHERE v.company_code = p_company_code
  GROUP BY g.route_id, g.origin_port_code, g.destination_port_code,
           po.port_name, pd.port_name, g.route_distance_nm,
           g.crosses_antimeridian, g.coords
  ORDER BY 8 DESC, g.route_distance_nm DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION routes_for_liner(text, int) TO anon, authenticated;

-- Point-in-time variant for the period-comparison map. p_as_of must be a
-- month_start present in mv_service_month.
CREATE OR REPLACE FUNCTION routes_for_port_at(
  p_port_code text, p_as_of date, p_limit int DEFAULT 400
)
RETURNS TABLE (
  route_id numeric, origin_port_code text, destination_port_code text,
  route_distance_nm double precision, crosses_antimeridian boolean,
  services int, coords jsonb
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT g.route_id, g.origin_port_code, g.destination_port_code,
         g.route_distance_nm, g.crosses_antimeridian,
         COUNT(DISTINCT rs.service_version_id)::int, g.coords
  FROM mv_route_geom g
  JOIN mv_route_service rs ON rs.route_id = g.route_id
  JOIN mv_service_month sm ON sm.service_version_id = rs.service_version_id
                          AND sm.month_start = p_as_of
  WHERE g.origin_port_code = p_port_code OR g.destination_port_code = p_port_code
  GROUP BY g.route_id, g.origin_port_code, g.destination_port_code,
           g.route_distance_nm, g.crosses_antimeridian, g.coords
  ORDER BY 6 DESC, g.route_distance_nm DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION routes_for_port_at(text, date, int) TO anon, authenticated;

-- =====================================================================
-- NOTE: the refresh function in v2_matviews.sql must include the four
-- geography matviews, in this order (mv_port_map reads
-- mv_port_connectivity_current, so it has to follow it):
--   mv_route_geom, mv_route_service, mv_port_map, mv_port_cluster
-- =====================================================================
