-- =====================================================================
-- Liner Services — v2 materialized views
-- Aligned to the Power BI model "Liner Services_vGC"
--
-- KEY CORRECTIONS vs v1:
--   * event_type: BERTH_ARRIVAL for port/country/coastal analytics (excludes
--     chokepoints structurally); PORT_ARRIVAL for route distance/time metrics.
--     v1 used PORT_DEPARTURE, which let the 5 chokepoints into port rankings.
--   * No. of Services = DISTINCTCOUNT(service_master_name), NOT version id.
--   * Capacity comes from eesea_vsa.avg_trade_cap_per_vsa_proforma_capacity,
--     matching PBI [Service Capacity]. v1 used port-call TEU (different concept).
--   * Annual Capacity = (365 / frequency_days) * Service Capacity.
--   * Vessels Deployed = roundtrip_days / frequency_days (PBI formula).
--   * Trade lane hierarchy uses the full 3-level classification, not a
--     single-level A/B/C/D/E parse.
--   * Port dimension sourced from ml_liners_ports_&_geo, which collapses the
--     PBI 02b Ports + 03a1 Country + 03a4 ADPG Cluster + 03a5 Coastal Region
--     chain into one table (1155 ports, joins cleanly on "Port ID" = port_code).
--
-- CHOKEPOINTS: the four maritime passages, by name, matching Power BI:
--   Suez Canal, Panama Canal, Cape of Good Hope, Cape Horn.
-- Do NOT infer this from "has PORT_ARRIVAL but no BERTH_ARRIVAL" — that also
-- catches Canakkale, which is a real port on the Dardanelles Strait
-- (portofcanakkale.com). It appears with 1 service and no berth-level detail,
-- which is a coverage gap in the feed, not a passage.
--
-- COUNTRY LABELS: country_name is the full form ("United States of America")
-- for page headers and pickers; country_short_name is the compact form
-- ("USA", "S. Korea") for chart axis labels. Never render a raw ISO code in
-- a chart — carry the name column through the aggregate instead.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Trade lane classification (from PBI '01e Tradelane_Classification',
-- originally an Excel file on a local OneDrive path)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS ref_tradelane_classification CASCADE;
CREATE TABLE ref_tradelane_classification (
  trade_lane_eesea text PRIMARY KEY,
  trade_route_1    text NOT NULL,
  trade_route_2    text NOT NULL,
  trade_route_3    text NOT NULL,
  trade_grouping_1 text NOT NULL
);

INSERT INTO ref_tradelane_classification VALUES
('D: Intra-regionals',                            'Intra-Regional','Intra-Regional','Intra-Regional','Intra-Regional'),
('E: Feeders',                                    'Feeders',       'Feeders',       'Feeders',       'Feeders'),
('A: Far East - North America (E/W Primary)',     'East/West',     'E/W Primary',   'E/W FE_NAM',    'MLO'),
('A: Far East - Europe (E/W Primary)',            'East/West',     'E/W Primary',   'E/W FE_EUR',    'MLO'),
('A: Pendulum services (E/W Primary)',            'East/West',     'E/W Primary',   'E/W Pendulum',  'MLO'),
('A: Europe - North America (E/W Primary)',       'East/West',     'E/W Primary',   'E/W EU_NAM',    'MLO'),
('B: Far East - Middle East (E/W Secondary)',     'East/West',     'E/W Secondary', 'E/W FE_MEA',    'MLO'),
('B: Europe - Middle East (E/W Secondary)',       'East/West',     'E/W Secondary', 'E/W EU_ME',     'MLO'),
('B: North America - Middle East (E/W Secondary)','East/West',     'E/W Secondary', 'E/W NA_ME',     'MLO'),
('C: Oceania (N/S)',                              'North/South',   'North/South',   'N/S Oceania',   'MLO'),
('C: Africa (N/S)',                               'North/South',   'North/South',   'N/S Africa',    'MLO'),
('C: South America - West Coast (N/S)',           'North/South',   'North/South',   'N/S SAM_WCNA',  'MLO'),
('C: South America - East Coast (N/S)',           'North/South',   'North/South',   'N/S SAM_ECNA',  'MLO');

GRANT SELECT ON ref_tradelane_classification TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_service_base — one row per service version, PBI measure inputs resolved
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_service_base CASCADE;
CREATE MATERIALIZED VIEW mv_service_base AS
WITH vsa_cap AS (
  SELECT service_version_id,
         SUM(avg_trade_cap_per_vsa_proforma_capacity) AS service_capacity_teu,
         COUNT(DISTINCT NULLIF(company_code,'#Unknown')) AS vsa_liner_count,
         SUM(vsa_percentage)                          AS vsa_pct_total
  FROM eesea_vsa
  WHERE avg_trade_cap_per_vsa_proforma_capacity IS NOT NULL
  GROUP BY 1
)
SELECT
  sv.service_version_id, sv.service_id,
  sv.service_master_name, sv.service_master_name_incl_trade_lane,
  sv.service_version_number, sv.service_version_name, sv.alliance_code,
  sv.trade_lane_category,
  t.trade_route_1, t.trade_route_2, t.trade_route_3, t.trade_grouping_1,
  CASE sv.service_version_validity_status
    WHEN '0 : Currently active version' THEN 'Current'
    WHEN '- : Past version'             THEN 'Past'
    WHEN '+ : Future version'            THEN 'Future'
  END AS validity_status,
  (sv.service_version_validity_status = '0 : Currently active version') AS is_current,
  sv.service_version_start_datetime_lt::date AS valid_from,
  sv.service_version_end_datetime_lt::date   AS valid_to,
  sv.service_version_roundtrip_days, sv.service_version_frequency_days,
  sv.service_version_port_count, sv.service_version_call_count,
  sv.service_version_slot_count, sv.service_version_average_vessel_capacity_teu,
  sv.service_version_rotation_by_names,
  CASE WHEN sv.service_version_frequency_days > 0
       THEN 365.0 / sv.service_version_frequency_days END AS annual_rotations,
  CASE WHEN sv.service_version_frequency_days > 0
       THEN sv.service_version_roundtrip_days::numeric / sv.service_version_frequency_days END AS vessels_deployed,
  vc.service_capacity_teu, vc.vsa_liner_count, vc.vsa_pct_total,
  CASE WHEN sv.service_version_frequency_days > 0
       THEN (365.0 / sv.service_version_frequency_days) * vc.service_capacity_teu END AS annual_capacity_teu
FROM eesea_service_versions sv
LEFT JOIN ref_tradelane_classification t ON t.trade_lane_eesea = sv.trade_lane_category
LEFT JOIN vsa_cap vc ON vc.service_version_id = sv.service_version_id
WHERE sv.service_version_id IS NOT NULL;

CREATE UNIQUE INDEX ON mv_service_base (service_version_id);
CREATE INDEX ON mv_service_base (is_current);
CREATE INDEX ON mv_service_base (trade_route_1);
CREATE INDEX ON mv_service_base (service_master_name);
GRANT SELECT ON mv_service_base TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_port_dim — port dimension from the flat geo master + chokepoint flag
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_port_dim CASCADE;
CREATE MATERIALIZED VIEW mv_port_dim AS
WITH berth_ports AS (
  SELECT DISTINCT port_code FROM eesea_service_proformas WHERE event_type='BERTH_ARRIVAL'
)
SELECT
  m."Port ID" AS port_code, m."Port" AS port_name, m."Port alias" AS port_alias,
  m."adpg_port_id", m."portLat" AS port_lat, m."portLon" AS port_lon,
  m."Coastal Region" AS coastal_region, m."Clarksons Region" AS clarksons_region,
  m."Project" AS project, m."Project Region" AS project_region,
  m."iso2Code"           AS country_code,
  m."countryName"        AS country_name,        -- full form, for headers/pickers
  m."Country Short Name" AS country_short_name,  -- compact form, for chart labels
  m."Country"            AS country_sort_name,
  m."adpg_country_id", m."Region" AS region,
  m."Continent" AS continent, m."Continent Code" AS continent_code,
  m."Region (UN)" AS region_un, m."Sub-region (UN)" AS subregion_un,
  m."Region (WB)" AS region_wb, m."Income group (WB)" AS income_group_wb,
  m."Flag" AS flag, m."ADPG Group" AS adpg_group, m."ADPG Ports" AS adpg_ports,
  (m."Port" IN ('Suez Canal','Panama Canal','Cape of Good Hope','Cape Horn')) AS is_chokepoint,
  CASE WHEN m."Port" IN ('Suez Canal','Panama Canal','Cape of Good Hope','Cape Horn')
       THEN 'Chokepoint' ELSE 'Port' END AS port_or_chokepoint,
  (b.port_code IS NOT NULL) AS has_berth_calls
FROM "ml_liners_ports_&_geo" m
LEFT JOIN berth_ports b ON b.port_code = m."Port ID";

CREATE UNIQUE INDEX ON mv_port_dim (port_code);
CREATE INDEX ON mv_port_dim (country_code);
CREATE INDEX ON mv_port_dim (coastal_region);
CREATE INDEX ON mv_port_dim (is_chokepoint);
GRANT SELECT ON mv_port_dim TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_service_year — annual approximation of the PBI services_validity
-- daily bridge. TODO (phase 2): replace with true daily grain.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_service_year CASCADE;
CREATE MATERIALIZED VIEW mv_service_year AS
SELECT sb.service_version_id, sb.service_master_name, sb.trade_lane_category,
       sb.trade_route_1, sb.trade_route_2, sb.trade_route_3, sb.is_current,
       y.yr AS year, sb.annual_rotations, sb.service_capacity_teu,
       sb.annual_capacity_teu, sb.vessels_deployed, sb.service_version_port_count
FROM mv_service_base sb
CROSS JOIN generate_series(2017, 2028) AS y(yr)
WHERE sb.valid_from IS NOT NULL
  AND EXTRACT(YEAR FROM sb.valid_from) <= y.yr
  AND COALESCE(EXTRACT(YEAR FROM sb.valid_to), 2028) >= y.yr;

CREATE INDEX ON mv_service_year (year);
CREATE INDEX ON mv_service_year (service_version_id);
CREATE INDEX ON mv_service_year (trade_route_1, year);
GRANT SELECT ON mv_service_year TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_service_port_berth — service x port at BERTH_ARRIVAL (no chokepoints)
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_service_port_berth CASCADE;
CREATE MATERIALIZED VIEW mv_service_port_berth AS
SELECT DISTINCT service_version_id, port_code
FROM eesea_service_proformas WHERE event_type = 'BERTH_ARRIVAL';
CREATE INDEX ON mv_service_port_berth (port_code);
CREATE INDEX ON mv_service_port_berth (service_version_id);
GRANT SELECT ON mv_service_port_berth TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_port_year / mv_port_current
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_port_year CASCADE;
CREATE MATERIALIZED VIEW mv_port_year AS
SELECT spb.port_code, pd.port_name, pd.country_code, pd.coastal_region, sy.year,
       COALESCE(sy.trade_route_1,'Other') AS route_type,
       COUNT(DISTINCT sy.service_master_name) AS service_count,
       COUNT(DISTINCT sy.service_version_id)  AS version_count,
       ROUND(SUM(sy.service_capacity_teu))    AS service_capacity_teu,
       ROUND(SUM(sy.annual_capacity_teu))     AS annual_capacity_teu,
       ROUND(SUM(sy.annual_rotations))        AS annual_rotations
FROM mv_service_port_berth spb
JOIN mv_service_year sy ON sy.service_version_id = spb.service_version_id
JOIN mv_port_dim   pd  ON pd.port_code = spb.port_code
GROUP BY 1,2,3,4,5,6;
CREATE INDEX ON mv_port_year (port_code, year);
CREATE INDEX ON mv_port_year (year);
GRANT SELECT ON mv_port_year TO anon, authenticated;

DROP MATERIALIZED VIEW IF EXISTS mv_port_current CASCADE;
CREATE MATERIALIZED VIEW mv_port_current AS
WITH cur AS (
  SELECT spb.port_code, sb.service_version_id, sb.service_master_name,
         sb.service_capacity_teu, sb.annual_capacity_teu, sb.annual_rotations
  FROM mv_service_port_berth spb
  JOIN mv_service_base sb ON sb.service_version_id = spb.service_version_id
  WHERE sb.is_current
),
svc AS (
  SELECT port_code,
         COUNT(DISTINCT service_master_name) AS active_services,
         COUNT(DISTINCT service_version_id)  AS active_versions,
         ROUND(SUM(service_capacity_teu))    AS service_capacity_teu,
         ROUND(SUM(annual_capacity_teu))     AS annual_capacity_teu,
         ROUND(SUM(annual_rotations))        AS annual_rotations
  FROM cur GROUP BY 1
),
lines AS (
  SELECT c.port_code, COUNT(DISTINCT NULLIF(v.company_code,'#Unknown')) AS lines_calling
  FROM cur c JOIN eesea_vsa v ON v.service_version_id = c.service_version_id GROUP BY 1
)
SELECT pd.port_code, pd.port_name, pd.country_code, pd.country_name, pd.country_short_name,
       pd.coastal_region, pd.region, pd.continent, pd.port_lat, pd.port_lon,
       pd.is_chokepoint, pd.flag,
       COALESCE(svc.active_services,0) AS active_services,
       COALESCE(svc.active_versions,0) AS active_versions,
       COALESCE(lines.lines_calling,0) AS lines_calling,
       svc.service_capacity_teu, svc.annual_capacity_teu,
       svc.annual_rotations AS annual_calls_at_port
FROM mv_port_dim pd
LEFT JOIN svc   ON svc.port_code   = pd.port_code
LEFT JOIN lines ON lines.port_code = pd.port_code;
CREATE UNIQUE INDEX ON mv_port_current (port_code);
CREATE INDEX ON mv_port_current (country_code);
CREATE INDEX ON mv_port_current (active_services DESC);
GRANT SELECT ON mv_port_current TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Country / coastal region / global
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_country_year CASCADE;
CREATE MATERIALIZED VIEW mv_country_year AS
SELECT pd.country_code, pd.country_name, sy.year,
       COALESCE(sy.trade_route_1,'Other') AS route_type,
       COUNT(DISTINCT sy.service_master_name) AS service_count,
       COUNT(DISTINCT spb.port_code)          AS port_count
FROM mv_service_port_berth spb
JOIN mv_service_year sy ON sy.service_version_id = spb.service_version_id
JOIN mv_port_dim   pd  ON pd.port_code = spb.port_code
GROUP BY 1,2,3,4;
CREATE INDEX ON mv_country_year (country_code, year);
GRANT SELECT ON mv_country_year TO anon, authenticated;

DROP MATERIALIZED VIEW IF EXISTS mv_country_current CASCADE;
CREATE MATERIALIZED VIEW mv_country_current AS
WITH cur AS (
  SELECT pd.country_code, spb.port_code, sb.service_version_id, sb.service_master_name,
         sb.service_capacity_teu, sb.annual_capacity_teu
  FROM mv_service_port_berth spb
  JOIN mv_service_base sb ON sb.service_version_id = spb.service_version_id AND sb.is_current
  JOIN mv_port_dim   pd  ON pd.port_code = spb.port_code
),
agg AS (SELECT country_code, COUNT(DISTINCT service_master_name) AS active_services,
               COUNT(DISTINCT port_code) AS port_count FROM cur GROUP BY 1),
cap AS (SELECT country_code, ROUND(SUM(service_capacity_teu)) AS service_capacity_teu,
               ROUND(SUM(annual_capacity_teu)) AS annual_capacity_teu
        FROM (SELECT DISTINCT country_code, service_version_id, service_capacity_teu,
                     annual_capacity_teu FROM cur) d GROUP BY 1),
lin AS (SELECT c.country_code, COUNT(DISTINCT NULLIF(v.company_code,'#Unknown')) AS active_liners
        FROM cur c JOIN eesea_vsa v ON v.service_version_id = c.service_version_id GROUP BY 1)
SELECT DISTINCT pd.country_code, pd.country_name, pd.country_short_name, pd.flag,
       pd.continent, pd.region, pd.region_un, pd.subregion_un, pd.income_group_wb,
       COALESCE(agg.active_services,0) AS active_services,
       COALESCE(agg.port_count,0)      AS port_count,
       COALESCE(lin.active_liners,0)   AS active_liners,
       cap.service_capacity_teu, cap.annual_capacity_teu
FROM mv_port_dim pd
LEFT JOIN agg ON agg.country_code = pd.country_code
LEFT JOIN cap ON cap.country_code = pd.country_code
LEFT JOIN lin ON lin.country_code = pd.country_code;
CREATE UNIQUE INDEX ON mv_country_current (country_code);
GRANT SELECT ON mv_country_current TO anon, authenticated;

DROP MATERIALIZED VIEW IF EXISTS mv_coastal_year CASCADE;
CREATE MATERIALIZED VIEW mv_coastal_year AS
SELECT pd.coastal_region, sy.year,
       COALESCE(sy.trade_route_1,'Other') AS route_type,
       COUNT(DISTINCT sy.service_master_name) AS service_count,
       COUNT(DISTINCT spb.port_code)          AS port_count,
       COUNT(DISTINCT pd.country_code)        AS country_count
FROM mv_service_port_berth spb
JOIN mv_service_year sy ON sy.service_version_id = spb.service_version_id
JOIN mv_port_dim   pd  ON pd.port_code = spb.port_code
WHERE pd.coastal_region IS NOT NULL
GROUP BY 1,2,3;
CREATE INDEX ON mv_coastal_year (coastal_region, year);
GRANT SELECT ON mv_coastal_year TO anon, authenticated;

DROP MATERIALIZED VIEW IF EXISTS mv_global_year CASCADE;
CREATE MATERIALIZED VIEW mv_global_year AS
SELECT year, COALESCE(trade_route_1,'Other') AS route_type,
       COUNT(DISTINCT service_master_name) AS service_count,
       COUNT(DISTINCT service_version_id)  AS version_count,
       ROUND(SUM(service_capacity_teu))    AS service_capacity_teu,
       ROUND(SUM(annual_capacity_teu))     AS annual_capacity_teu,
       ROUND(SUM(vessels_deployed))        AS vessels_deployed
FROM mv_service_year GROUP BY 1,2;
CREATE INDEX ON mv_global_year (year);
GRANT SELECT ON mv_global_year TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Trade route (PORT_ARRIVAL for distance/time) / liners
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_trade_route_year CASCADE;
CREATE MATERIALIZED VIEW mv_trade_route_year AS
WITH pa AS (
  SELECT service_version_id,
         SUM(proforma_distance_to_next_nm) AS total_distance_nm,
         SUM(proforma_days_to_next)        AS total_days,
         AVG(proforma_speed_to_next_kn)    AS avg_speed_kn,
         COUNT(DISTINCT port_code)         AS ports_on_route
  FROM eesea_service_proformas WHERE event_type = 'PORT_ARRIVAL' GROUP BY 1
)
SELECT sy.year, sy.trade_route_1, sy.trade_route_2, sy.trade_route_3, sy.trade_lane_category,
       COUNT(DISTINCT sy.service_master_name) AS service_count,
       COUNT(DISTINCT sy.service_version_id)  AS version_count,
       ROUND(SUM(sy.service_capacity_teu))    AS service_capacity_teu,
       ROUND(SUM(sy.annual_capacity_teu))     AS annual_capacity_teu,
       ROUND(SUM(sy.vessels_deployed))        AS vessels_deployed,
       ROUND(SUM(pa.total_distance_nm))       AS total_distance_nm,
       ROUND(AVG(pa.avg_speed_kn)::numeric,2) AS avg_speed_kn,
       ROUND(AVG(pa.ports_on_route)::numeric,1) AS avg_ports_per_service
FROM mv_service_year sy
LEFT JOIN pa ON pa.service_version_id = sy.service_version_id
WHERE sy.trade_route_1 IS NOT NULL
GROUP BY 1,2,3,4,5;
CREATE INDEX ON mv_trade_route_year (trade_route_1, year);
CREATE INDEX ON mv_trade_route_year (year);
GRANT SELECT ON mv_trade_route_year TO anon, authenticated;

DROP MATERIALIZED VIEW IF EXISTS mv_liner_year CASCADE;
CREATE MATERIALIZED VIEW mv_liner_year AS
SELECT v.company_code, c.company_name, c.company_type, sy.year,
       COALESCE(sy.trade_route_1,'Other') AS route_type,
       COUNT(DISTINCT sy.service_master_name) AS service_count,
       COUNT(DISTINCT sy.service_version_id)  AS version_count,
       ROUND(SUM(sy.service_capacity_teu))    AS service_capacity_teu,
       ROUND(SUM(sy.annual_capacity_teu))     AS annual_capacity_teu,
       ROUND(SUM(sy.service_capacity_teu * v.vsa_percentage / 100.0)) AS vsa_capacity_teu
FROM eesea_vsa v
JOIN mv_service_year sy ON sy.service_version_id = v.service_version_id
LEFT JOIN eesea_companies c ON c.company_code = v.company_code
WHERE v.company_code <> '#Unknown' AND v.company_code IS NOT NULL
GROUP BY 1,2,3,4,5;
CREATE INDEX ON mv_liner_year (company_code, year);
CREATE INDEX ON mv_liner_year (year);
GRANT SELECT ON mv_liner_year TO anon, authenticated;

DROP MATERIALIZED VIEW IF EXISTS mv_liner_current CASCADE;
CREATE MATERIALIZED VIEW mv_liner_current AS
WITH cur AS (
  SELECT DISTINCT v.company_code, c.company_name, c.company_type,
         sb.service_version_id, sb.service_master_name,
         sb.service_capacity_teu, sb.annual_capacity_teu, v.vsa_percentage
  FROM eesea_vsa v
  JOIN mv_service_base sb ON sb.service_version_id = v.service_version_id AND sb.is_current
  LEFT JOIN eesea_companies c ON c.company_code = v.company_code
  WHERE v.company_code <> '#Unknown' AND v.company_code IS NOT NULL
)
SELECT company_code, MAX(company_name) AS company_name, MAX(company_type) AS company_type,
       COUNT(DISTINCT service_master_name) AS active_services,
       COUNT(DISTINCT service_version_id)  AS active_versions,
       ROUND(SUM(service_capacity_teu))    AS service_capacity_teu,
       ROUND(SUM(annual_capacity_teu))     AS annual_capacity_teu,
       ROUND(SUM(service_capacity_teu * vsa_percentage / 100.0)) AS vsa_capacity_teu
FROM cur GROUP BY 1;
CREATE UNIQUE INDEX ON mv_liner_current (company_code);
CREATE INDEX ON mv_liner_current (service_capacity_teu DESC);
GRANT SELECT ON mv_liner_current TO anon, authenticated;

-- =====================================================================
-- PHASE 2 — point-in-time bridge + connectivity network
-- =====================================================================

-- ---------------------------------------------------------------------
-- mv_service_month — point-in-time snapshot bridge.
-- A service version belongs to month M if it is valid ON the last day of M.
-- PBI expands to one row per DAY (4.7M rows) because its slicer allows any
-- date; the dashboard compares by month and PBI's Prev_Months measure uses
-- EDATE() (month-end -> month-end), so month grain returns identical answers
-- at ~3% of the rows. 154,805 rows / 312 months (2001-01 .. 2026-12).
-- Cross-checked: Jul-2026 gives 1,697 services vs is_current 1,693.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_service_month CASCADE;
CREATE MATERIALIZED VIEW mv_service_month AS
WITH bounds AS (
  SELECT (SELECT MAX(service_version_end_datetime_lt::date) FROM eesea_service_versions) AS global_max
),
months AS (
  SELECT (m)::date AS month_start,
         (m + INTERVAL '1 month - 1 day')::date AS month_end
  FROM bounds b,
       generate_series(date_trunc('month',(SELECT MIN(service_version_start_datetime_lt::date)
                                           FROM eesea_service_versions)),
                       date_trunc('month', b.global_max),
                       INTERVAL '1 month') AS m
)
SELECT sb.service_version_id, sb.service_master_name, sb.alliance_code,
       sb.trade_route_1, sb.trade_route_2, sb.trade_route_3, sb.trade_lane_category,
       sb.service_capacity_teu, sb.annual_capacity_teu,
       sb.annual_rotations, sb.vessels_deployed, sb.service_version_port_count,
       mo.month_start, mo.month_end,
       EXTRACT(YEAR  FROM mo.month_start)::int AS year,
       EXTRACT(MONTH FROM mo.month_start)::int AS month
FROM mv_service_base sb
CROSS JOIN bounds b
JOIN months mo
  ON sb.valid_from <= mo.month_end
 AND COALESCE(sb.valid_to, b.global_max) >= mo.month_end
WHERE sb.valid_from IS NOT NULL;

CREATE INDEX ON mv_service_month (month_start);
CREATE INDEX ON mv_service_month (service_version_id);
CREATE INDEX ON mv_service_month (month_start, trade_route_1);
CREATE INDEX ON mv_service_month (year, month);
GRANT SELECT ON mv_service_month TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_port_connectivity — replicates the PBI 'ports_by_service' Power Query
-- cross-join. For every call on a rotation, emits one row per OTHER call on
-- that rotation (the "partner"), carrying the NEXT call in sequence
-- (circular: last wraps to first). BERTH_ARRIVAL grain -> no chokepoints.
-- 862,514 rows / 983 origin ports / 13,445 versions.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_port_connectivity CASCADE;
CREATE MATERIALIZED VIEW mv_port_connectivity AS
WITH calls AS (
  SELECT sp.service_version_id, sp.port_code, sp.service_call_order,
         sp.service_event_order, sp.proforma_terminal_name,
         ROW_NUMBER() OVER (PARTITION BY sp.service_version_id
                            ORDER BY sp.service_call_order, sp.service_event_order) AS rn,
         COUNT(*)     OVER (PARTITION BY sp.service_version_id) AS n_calls
  FROM eesea_service_proformas sp
  WHERE sp.event_type = 'BERTH_ARRIVAL'
),
with_next AS (
  SELECT c.*,
         COALESCE(LEAD(c.port_code) OVER w, FIRST_VALUE(c.port_code) OVER w) AS next_port_code,
         COALESCE(LEAD(c.service_call_order) OVER w, FIRST_VALUE(c.service_call_order) OVER w) AS next_call_order,
         COALESCE(LEAD(c.proforma_terminal_name) OVER w, FIRST_VALUE(c.proforma_terminal_name) OVER w) AS next_terminal
  FROM calls c
  WINDOW w AS (PARTITION BY c.service_version_id ORDER BY c.rn)
)
SELECT
  o.service_version_id,
  o.port_code, o.service_call_order AS call_order, o.proforma_terminal_name AS terminal,
  od.country_code, od.coastal_region,
  p.port_code AS partner_port_code, p.service_call_order AS partner_call_order,
  p.proforma_terminal_name AS partner_terminal,
  pdim.country_code AS partner_country_code, pdim.coastal_region AS partner_coastal_region,
  o.next_port_code, o.next_call_order, o.next_terminal,
  nd.country_code AS next_country_code,
  (p.port_code = o.next_port_code) AS is_direct,
  CASE WHEN p.port_code = o.next_port_code THEN 'Direct' ELSE 'Indirect' END AS partner_next_port_same,
  CASE WHEN od.country_code = pdim.country_code THEN 'Repeated' ELSE 'Distinct' END AS distinct_partner_country,
  CASE WHEN o.port_code = p.port_code           THEN 'Repeated' ELSE 'Distinct' END AS distinct_partner_port,
  CASE WHEN od.country_code = nd.country_code   THEN 'Repeated' ELSE 'Distinct' END AS distinct_next_country,
  CASE WHEN o.port_code = o.next_port_code      THEN 'Repeated' ELSE 'Distinct' END AS distinct_next_port
FROM with_next o
JOIN with_next p ON p.service_version_id = o.service_version_id AND p.rn <> o.rn
LEFT JOIN mv_port_dim od   ON od.port_code   = o.port_code
LEFT JOIN mv_port_dim pdim ON pdim.port_code = p.port_code
LEFT JOIN mv_port_dim nd   ON nd.port_code   = o.next_port_code;

CREATE INDEX ON mv_port_connectivity (port_code);
CREATE INDEX ON mv_port_connectivity (service_version_id);
CREATE INDEX ON mv_port_connectivity (port_code, is_direct);
CREATE INDEX ON mv_port_connectivity (country_code);
GRANT SELECT ON mv_port_connectivity TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_port_connectivity_current — PBI Partners measures.
-- Validated vs PBI: Shanghai 280/283 partner ports, Busan 270/273,
-- Singapore 236/239, Rotterdam 221/224; partner countries near-exact.
-- AEAUH: 8 services / 11 liners — exact match to PBI.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_port_connectivity_current CASCADE;
CREATE MATERIALIZED VIEW mv_port_connectivity_current AS
WITH cc AS (
  SELECT c.* FROM mv_port_connectivity c
  JOIN mv_service_base sb ON sb.service_version_id = c.service_version_id
  WHERE sb.is_current
)
SELECT
  pd.port_code, pd.port_name, pd.country_code, pd.country_name,
  pd.coastal_region, pd.port_lat, pd.port_lon,
  COUNT(DISTINCT cc.partner_port_code)                                    AS partner_ports,
  COUNT(DISTINCT cc.partner_port_code) FILTER (WHERE cc.is_direct)        AS direct_ports,
  COUNT(DISTINCT cc.partner_port_code)
    - COUNT(DISTINCT cc.partner_port_code) FILTER (WHERE cc.is_direct)    AS indirect_ports,
  COUNT(DISTINCT cc.partner_port_code)
    FILTER (WHERE cc.distinct_partner_port = 'Distinct')                  AS partner_ports_ex_same,
  COUNT(DISTINCT cc.partner_country_code)                                 AS partner_countries,
  COUNT(DISTINCT cc.partner_country_code) FILTER (WHERE cc.is_direct)     AS direct_countries,
  COUNT(DISTINCT cc.partner_country_code)
    - COUNT(DISTINCT cc.partner_country_code) FILTER (WHERE cc.is_direct) AS indirect_countries,
  COUNT(DISTINCT cc.partner_country_code)
    FILTER (WHERE cc.distinct_partner_country = 'Distinct')               AS partner_countries_ex_same,
  COUNT(DISTINCT cc.partner_coastal_region)                               AS partner_coastal_regions,
  COUNT(DISTINCT cc.service_version_id)                                   AS versions
FROM mv_port_dim pd
LEFT JOIN cc ON cc.port_code = pd.port_code
GROUP BY 1,2,3,4,5,6,7;

CREATE UNIQUE INDEX ON mv_port_connectivity_current (port_code);
CREATE INDEX ON mv_port_connectivity_current (partner_ports DESC);
GRANT SELECT ON mv_port_connectivity_current TO anon, authenticated;

-- ---------------------------------------------------------------------
-- mv_port_connectivity_qtr — quarterly snapshots (26,672 rows / 39 dates).
-- Supports the Prev_Months comparison (3/6/9/12/24/36 back) without
-- materializing all 312 months (~630ms each = too slow to refresh).
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_port_connectivity_qtr CASCADE;
CREATE MATERIALIZED VIEW mv_port_connectivity_qtr AS
SELECT c.port_code, sm.month_start::date AS as_of, sm.year,
       EXTRACT(QUARTER FROM sm.month_start)::int AS quarter,
       COUNT(DISTINCT c.service_version_id)                                  AS versions,
       COUNT(DISTINCT c.partner_port_code)                                   AS partner_ports,
       COUNT(DISTINCT c.partner_port_code) FILTER (WHERE c.is_direct)        AS direct_ports,
       COUNT(DISTINCT c.partner_port_code)
         - COUNT(DISTINCT c.partner_port_code) FILTER (WHERE c.is_direct)    AS indirect_ports,
       COUNT(DISTINCT c.partner_country_code)                                AS partner_countries,
       COUNT(DISTINCT c.partner_country_code) FILTER (WHERE c.is_direct)     AS direct_countries,
       COUNT(DISTINCT c.partner_country_code)
         - COUNT(DISTINCT c.partner_country_code) FILTER (WHERE c.is_direct) AS indirect_countries
FROM mv_port_connectivity c
JOIN mv_service_month sm ON sm.service_version_id = c.service_version_id
WHERE sm.month IN (3,6,9,12) AND sm.year BETWEEN 2017 AND 2026
GROUP BY 1,2,3,4;

CREATE INDEX ON mv_port_connectivity_qtr (port_code, as_of);
CREATE INDEX ON mv_port_connectivity_qtr (as_of);
GRANT SELECT ON mv_port_connectivity_qtr TO anon, authenticated;

-- =====================================================================
-- PHASE 3 — views that exist specifically to keep the client honest.
--
-- PostgREST caps any single response at 1000 rows and returns no error when it
-- truncates. Aggregating in the browser therefore produced a silently wrong
-- "1,000 active services" KPI (true value 1,693) and 1.3M TEU (true 5.6M).
-- Anything the dashboard needs as a TOTAL is now aggregated server-side.
-- =====================================================================

-- Single-row global KPI roll-up.
DROP MATERIALIZED VIEW IF EXISTS mv_global_current CASCADE;
CREATE MATERIALIZED VIEW mv_global_current AS
SELECT
  1 AS id,
  (SELECT COUNT(DISTINCT service_master_name) FROM mv_service_base WHERE is_current)       AS active_services,
  (SELECT COUNT(*)                            FROM mv_service_base WHERE is_current)       AS active_versions,
  (SELECT ROUND(SUM(service_capacity_teu))    FROM mv_service_base WHERE is_current)       AS service_capacity_teu,
  (SELECT ROUND(SUM(annual_capacity_teu))     FROM mv_service_base WHERE is_current)       AS annual_capacity_teu,
  (SELECT ROUND(SUM(vessels_deployed))        FROM mv_service_base WHERE is_current)       AS vessels_deployed,
  (SELECT COUNT(*) FROM mv_country_current WHERE active_services > 0)                      AS countries,
  (SELECT COUNT(*) FROM mv_port_current    WHERE active_services > 0 AND NOT is_chokepoint) AS ports,
  (SELECT COUNT(*) FROM mv_port_current    WHERE is_chokepoint)                            AS chokepoints,
  (SELECT COUNT(*) FROM mv_liner_current)                                                  AS liners;
CREATE UNIQUE INDEX ON mv_global_current (id);
GRANT SELECT ON mv_global_current TO anon, authenticated;

-- Partner countries per origin port. The raw connectivity rows for a large port
-- run into the thousands and would be truncated client-side.
DROP MATERIALIZED VIEW IF EXISTS mv_port_partner_country CASCADE;
CREATE MATERIALIZED VIEW mv_port_partner_country AS
SELECT c.port_code, c.partner_country_code,
       COUNT(DISTINCT c.partner_port_code)                            AS partner_ports,
       COUNT(DISTINCT c.partner_port_code) FILTER (WHERE c.is_direct) AS direct_ports,
       COUNT(DISTINCT c.service_version_id)                           AS services
FROM mv_port_connectivity c
JOIN mv_service_base sb ON sb.service_version_id = c.service_version_id
WHERE sb.is_current AND c.partner_country_code IS NOT NULL
GROUP BY 1,2;
CREATE INDEX ON mv_port_partner_country (port_code, partner_ports DESC);
GRANT SELECT ON mv_port_partner_country TO anon, authenticated;

-- Coastal region DISTINCT totals per year — one row per region-year. Summing the
-- per-route-type rows double-counts services whose versions span trade lanes.
DROP MATERIALIZED VIEW IF EXISTS mv_coastal_year_total CASCADE;
CREATE MATERIALIZED VIEW mv_coastal_year_total AS
SELECT pd.coastal_region, sy.year,
       COUNT(DISTINCT sy.service_master_name) AS service_count,
       COUNT(DISTINCT spb.port_code)          AS port_count,
       COUNT(DISTINCT pd.country_code)        AS country_count
FROM mv_service_port_berth spb
JOIN mv_service_year sy ON sy.service_version_id = spb.service_version_id
JOIN mv_port_dim   pd  ON pd.port_code = spb.port_code
WHERE pd.coastal_region IS NOT NULL
GROUP BY 1,2;
CREATE INDEX ON mv_coastal_year_total (year, service_count DESC);
GRANT SELECT ON mv_coastal_year_total TO anon, authenticated;

-- 13-row route hierarchy for the cascading Trade Route pickers.
DROP VIEW IF EXISTS v_trade_route_tree CASCADE;
CREATE VIEW v_trade_route_tree AS
SELECT DISTINCT trade_route_1, trade_route_2, trade_route_3
FROM ref_tradelane_classification;
GRANT SELECT ON v_trade_route_tree TO anon, authenticated;

-- One row per service master name, with a representative version, whether any
-- version is currently active, and the version count. Backs the Service and
-- Service Evolution pickers (still paged: 3,381 names exceed the 1000 cap).
DROP MATERIALIZED VIEW IF EXISTS mv_service_names CASCADE;
CREATE MATERIALIZED VIEW mv_service_names AS
WITH pick AS (
  SELECT DISTINCT ON (sb.service_master_name)
         sb.service_master_name, sb.service_master_name_incl_trade_lane,
         sb.service_version_id AS current_version_id,
         sb.trade_route_1, sb.service_capacity_teu, sb.is_current
  FROM mv_service_base sb
  ORDER BY sb.service_master_name, sb.is_current DESC, sb.valid_from DESC NULLS LAST
),
counts AS (
  SELECT service_master_name, COUNT(*) AS version_count FROM mv_service_base GROUP BY 1
)
SELECT p.service_master_name, p.service_master_name_incl_trade_lane,
       p.current_version_id, p.trade_route_1, p.service_capacity_teu,
       p.is_current AS has_current, c.version_count
FROM pick p JOIN counts c USING (service_master_name);
CREATE UNIQUE INDEX ON mv_service_names (service_master_name);
CREATE INDEX ON mv_service_names (has_current, service_capacity_teu DESC);
GRANT SELECT ON mv_service_names TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Refresh function (statement_timeout = 0 bypasses the PostgREST 10s limit)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_eesea_matviews()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET statement_timeout = 0
AS $$
BEGIN
  -- Legacy (kept until the dashboard is fully migrated off them)
  REFRESH MATERIALIZED VIEW mv_service_overview;
  REFRESH MATERIALIZED VIEW mv_terminals;
  REFRESH MATERIALIZED VIEW mv_port_activity;
  REFRESH MATERIALIZED VIEW mv_reliability_monthly;
  REFRESH MATERIALIZED VIEW mv_port_calls_by_year;

  -- Dimensions and base
  REFRESH MATERIALIZED VIEW mv_service_base;
  REFRESH MATERIALIZED VIEW mv_port_dim;
  REFRESH MATERIALIZED VIEW mv_service_port_berth;
  REFRESH MATERIALIZED VIEW mv_service_names;

  -- Time bridges
  REFRESH MATERIALIZED VIEW mv_service_year;
  REFRESH MATERIALIZED VIEW mv_service_month;

  -- Aggregations
  REFRESH MATERIALIZED VIEW mv_port_year;
  REFRESH MATERIALIZED VIEW mv_port_current;
  REFRESH MATERIALIZED VIEW mv_country_year;
  REFRESH MATERIALIZED VIEW mv_country_current;
  REFRESH MATERIALIZED VIEW mv_coastal_year;
  REFRESH MATERIALIZED VIEW mv_coastal_year_total;
  REFRESH MATERIALIZED VIEW mv_global_year;
  REFRESH MATERIALIZED VIEW mv_trade_route_year;
  REFRESH MATERIALIZED VIEW mv_liner_year;
  REFRESH MATERIALIZED VIEW mv_liner_current;

  -- Connectivity (must follow mv_port_dim + mv_service_month)
  REFRESH MATERIALIZED VIEW mv_port_connectivity;
  REFRESH MATERIALIZED VIEW mv_port_connectivity_current;
  REFRESH MATERIALIZED VIEW mv_port_connectivity_qtr;
  REFRESH MATERIALIZED VIEW mv_port_partner_country;

  -- Geography / maps (see v3_geography.sql).
  -- mv_port_map reads mv_port_connectivity_current, so it must follow it.
  REFRESH MATERIALIZED VIEW mv_route_geom;
  REFRESH MATERIALIZED VIEW mv_route_service;
  REFRESH MATERIALIZED VIEW mv_port_map;
  REFRESH MATERIALIZED VIEW mv_port_cluster;

  -- Global roll-up last: it reads the views above
  REFRESH MATERIALIZED VIEW mv_global_current;
END;
$$;

-- =====================================================================
-- DASHBOARD NOTES
--
-- 1. Point-in-time vs annual are DIFFERENT questions and differ a lot.
--    AEAUH: 8 services active right now, but 41 called during 2026 and 55
--    during 2025. Both verified against PBI. Label KPI cards "as of today"
--    and annual charts "services calling during year" so the gap reads as
--    intentional rather than a bug.
--
-- 2. Do NOT SUM(service_count) across route_type rows to get a total. A
--    service master name can have versions on different trade lanes, so the
--    segments slightly exceed the distinct total (AEAUH 2023: 45 summed vs 44
--    distinct). Fine inside a stacked bar; wrong for a KPI. PBI behaves the
--    same way.
--
-- 3. Forward months are thin. Only 108 of 1,777 current versions carry an end
--    date, so open-ended ones ride to the global max (2026-12-20) while
--    ended ones drop out — later snapshots understate. Cap charts at the
--    current month.
-- =====================================================================
