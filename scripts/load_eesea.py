"""
Weekly BigQuery → Supabase loader for Eesea liner services data.
Runs via GitHub Actions; credentials come from environment variables.
"""
import csv
import io
import json
import logging
import os
import sys
import tempfile

import psycopg2
from google.cloud import bigquery
from google.oauth2 import service_account

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BQ_PROJECT = "eesea-deep-blue-external"
BQ_DATASET = "ad_ports"

TABLES = [
    ("companies_table",           "eesea_companies"),
    ("vessels_table",             "eesea_vessels"),
    ("ports_and_terminals",       "eesea_ports_and_terminals"),
    ("service_versions_table",    "eesea_service_versions"),
    ("port_vessels_per_service",  "eesea_port_vessels_per_service"),
    ("service_proformas_table",   "eesea_service_proformas"),
    ("routes_service_versions",   "eesea_routes_service_versions"),
    ("vsa_table",                 "eesea_vsa"),
]

MATVIEWS = [
    "mv_service_overview",
    "mv_terminals",
    "mv_port_activity",
    "mv_reliability_monthly",
]


def bq_client():
    key_json = os.environ["BQ_SA_KEY_JSON"]
    info = json.loads(key_json)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/bigquery.readonly"]
    )
    return bigquery.Client(project=BQ_PROJECT, credentials=creds)


def pg_conn():
    return psycopg2.connect(
        host=os.environ["SUPABASE_DB_HOST"],
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        dbname="postgres",
        user="postgres",
        password=os.environ["SUPABASE_DB_PASSWORD"],
        sslmode="require",
        connect_timeout=30,
    )


def bq_to_csv(client, bq_table: str) -> tuple[io.StringIO, list[str]]:
    """Stream BQ table to an in-memory CSV, return (buffer, columns)."""
    query = f"SELECT * FROM `{BQ_PROJECT}.{BQ_DATASET}.{bq_table}`"
    log.info("Querying BQ: %s", bq_table)
    result = client.query(query).result(page_size=5000)

    columns = [f.name for f in result.schema]
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(columns)

    row_count = 0
    for row in result:
        writer.writerow([None if v is None else str(v) for v in row.values()])
        row_count += 1
        if row_count % 100_000 == 0:
            log.info("  ... %d rows streamed", row_count)

    log.info("  total: %d rows", row_count)
    buf.seek(0)
    return buf, columns


def load_table(conn, bq_table: str, pg_table: str, bq_client_obj):
    buf, columns = bq_to_csv(bq_client_obj, bq_table)
    cols_sql = ", ".join(f'"{c}"' for c in columns)
    with conn.cursor() as cur:
        cur.execute(f'truncate table "{pg_table}"')
        copy_sql = f'COPY "{pg_table}" ({cols_sql}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL \'None\')'
        cur.copy_expert(copy_sql, buf)
    conn.commit()
    log.info("Loaded %s → %s", bq_table, pg_table)


def refresh_matviews(conn):
    with conn.cursor() as cur:
        for mv in MATVIEWS:
            log.info("Refreshing %s ...", mv)
            cur.execute(f"REFRESH MATERIALIZED VIEW {mv}")
    conn.commit()
    log.info("All materialized views refreshed")


def log_result(conn, status: str, details: str):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO eesea_refresh_log (status, details) VALUES (%s, %s)",
            (status, details),
        )
    conn.commit()


def main():
    client = bq_client()
    conn = pg_conn()
    errors = []

    for bq_table, pg_table in TABLES:
        try:
            load_table(conn, bq_table, pg_table, client)
        except Exception as e:
            log.error("Failed %s: %s", bq_table, e)
            errors.append(f"{bq_table}: {e}")

    if not errors:
        try:
            refresh_matviews(conn)
        except Exception as e:
            log.error("Matview refresh failed: %s", e)
            errors.append(f"matviews: {e}")

    status = "error" if errors else "ok"
    details = "; ".join(errors) if errors else "All tables and matviews refreshed successfully"
    log_result(conn, status, details)
    conn.close()

    if errors:
        log.error("Finished with errors: %s", details)
        sys.exit(1)
    log.info("Done: %s", details)


if __name__ == "__main__":
    main()
